import * as THREE from "three";
import { hypot2 } from "../../kernel/physics-core.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { SHOP_GROUND_STOREY, type InteriorPlan } from "../../world/openworld/interior-kinds.ts";
import { DOOR_FACE, interiorDoors, interiorSolids, planInterior, planKey, vestibuleSolids, type DoorLeaf, type InteriorSolid } from "../../world/openworld/interior-plan.ts";
import { drawnHalf } from "../../world/openworld/openworld-facade-solids.ts";
import type { OpenWorldMap, Place } from "../../world/openworld/walk-graph.ts";
import { FACADE_OPEN_MAX, setOpenFacades } from "../facades.ts";
import { FACE, type SightField } from "../openworld-sight.ts";
import { buildDetail, buildShell } from "./interior-build.ts";
import { DETAIL_BUILDS_PER_FRAME, GLASS_OPACITY, INTERIOR_FAR, INTERIOR_LINGER, INTERIOR_NEAR, SHELL_BUILDS_PER_FRAME, SHELL_FAR, SHELL_NEAR, SHOPFRONT_ROOMS, SOLIDS_NEAR, VESTIBULE_REACH } from "./interior-constants.ts";
import { DoorSet, type DoorOpeners } from "./interior-doors.ts";

/** What of an interior the physics holds: nothing, the vestibules behind its street doors, or all of it. */
const SOLIDS = { none: 0, vestibule: 1, full: 2 } as const;
type Solids = (typeof SOLIDS)[keyof typeof SOLIDS];

/** One place with an interior: whether it is a business (not a home), its footprint's half sides (drawn depth, width), its doors in the door set, what is built of it now, how long it has been out of range, and this frame's distance from the eye and whether its street front is in view (a business within range). */
type Entry = {
  place: Place;
  plan: InteriorPlan;
  business: boolean;
  distance: number;
  shopfront: boolean;
  halfDepth: number;
  halfWidth: number;
  firstDoor: number;
  doorCount: number;
  shell: THREE.BufferGeometry | null;
  shellGlass: THREE.BufferGeometry | null;
  detail: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
  detailGlass: THREE.BufferGeometry | null;
  shellAway: number;
  detailAway: number;
  solids: Solids;
};

type SolidsListener = (solids: readonly InteriorSolid[]) => void;

/** What the interiors ask of the open world's sight field. */
type InteriorSight = Pick<SightField, "claim" | "release" | "seenThroughFace" | "recordSighting" | "unseenFor" | "playerInside" | "hideGrace">;

/** An interior this frame: neither built anew nor dropped (`kept`), wanted (a player inside, a business's street front in view, or an open street door of it seen within range), or hidden (none of them, for the hide grace). */
const VIEW = { kept: 0, wanted: 1, hidden: 2 } as const;
type View = (typeof VIEW)[keyof typeof VIEW];
const NO_IDS = -1;

/** Puts `index` among the nearest kept so far (the arrays' length at most, ascending by `distance`), pushing the farthest out when they are full; returns how many are kept now. */
function keepNearest(indices: Int32Array, distances: Float64Array, count: number, index: number, distance: number): number {
  const capacity = indices.length;
  if (count === capacity && distance >= distances[capacity - 1]!) return count;
  let at = count < capacity ? count : capacity - 1;
  while (at > 0 && distances[at - 1]! > distance) {
    indices[at] = indices[at - 1]!;
    distances[at] = distances[at - 1]!;
    at--;
  }
  indices[at] = index;
  distances[at] = distance;
  return count < capacity ? count + 1 : count;
}

/** What the streamed interiors cost right now: places with an envelope, places furnished, vertices drawn, and draw calls (one per merged mesh that has any). The doors and vestibules add two draws, always; the glass is a fourth merged mesh. */
type InteriorStats = { shells: number; details: number; vertices: number; drawCalls: number };

/**
 * The interiors of a map's places. Every door is a hinged leaf, shut until someone stands at it, with a small vestibule behind each street door; the rooms behind are built only while a player
 * is inside, or a street door of theirs is open and some eye within range sees that doorway, or (a business: shop, bar, cafe, office, store) some eye within `INTERIOR_NEAR` sees its street front,
 * the nearest `SHOPFRONT_ROOMS` of them, so its windows show the lit room from the street with no door open; they are dropped once none has held for the sight field's hide grace (or the eye has been
 * past their far radius for `INTERIOR_LINGER`): the ground floor's envelope within `SHELL_NEAR`, the furnished rooms within `INTERIOR_NEAR`. A civilian swinging a door no player sees builds nothing.
 * The rooms are merged into four meshes (envelopes, lit furniture, unlit lamps and screens, glass). The physics holds a built interior's solids within `SOLIDS_NEAR` of the eye, and a vestibule's while
 * the player's walker is at its door.
 */
export class InteriorSet {
  readonly group = new THREE.Group();
  private readonly entries: Entry[] = [];
  private readonly doors: DoorSet;
  private readonly empty = new THREE.BufferGeometry();
  private readonly solidMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  private readonly glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  private readonly glassMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: GLASS_OPACITY, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
  private readonly shellMesh: THREE.Mesh;
  private readonly detailMesh: THREE.Mesh;
  private readonly glowMesh: THREE.Mesh;
  private readonly glassMesh: THREE.Mesh;
  private solidsListener: SolidsListener | null = null;
  /** The first of the sight field's ids, one per entry, claimed at the first frame from `claimedFrom`, and given back to it on dispose. */
  private sightBase = NO_IDS;
  private claimedFrom: InteriorSight | null = null;
  private shellBuilds = 0;
  private detailBuilds = 0;
  /** The x, z of every building whose room is built whole (its envelope and its rooms above), as the facade's shader takes them. */
  private readonly builtAt: Float32Array;
  /** The nearest businesses in view (entry indices, their distances), and the nearest built buildings the facade lists, filled each frame. */
  private readonly shopfrontAt = new Int32Array(SHOPFRONT_ROOMS);
  private readonly shopfrontDistance = new Float64Array(SHOPFRONT_ROOMS);
  private readonly listedAt = new Int32Array(FACADE_OPEN_MAX);
  private readonly listedDistance = new Float64Array(FACADE_OPEN_MAX);

  constructor(map: OpenWorldMap) {
    this.group.name = "interiors";
    this.builtAt = new Float32Array(2 * FACADE_OPEN_MAX);
    const plans = new Map<string, InteriorPlan>();
    const leaves: DoorLeaf[] = [];
    for (const place of map.places) {
      if (place.interior === undefined || place.doorNode < 0) continue;
      const key = planKey(place);
      let plan = plans.get(key);
      if (plan === undefined) {
        plan = planInterior(place);
        plans.set(key, plan);
      }
      const doors = interiorDoors(place, plan);
      this.entries.push({ place, plan, business: place.interior !== "rowhome", distance: 0, shopfront: false, halfDepth: drawnHalf(place.depth), halfWidth: drawnHalf(place.width), firstDoor: leaves.length, doorCount: doors.length, shell: null, shellGlass: null, detail: null, glow: null, detailGlass: null, shellAway: 0, detailAway: 0, solids: SOLIDS.none });
      leaves.push(...doors);
    }
    this.doors = new DoorSet(leaves);
    this.group.add(this.doors.group);
    this.shellMesh = this.makeMesh("interior-shells", this.solidMaterial);
    this.detailMesh = this.makeMesh("interior-furniture", this.solidMaterial);
    this.glowMesh = this.makeMesh("interior-lights", this.glowMaterial);
    this.glassMesh = this.makeMesh("interior-glass", this.glassMaterial);
  }

  /** Swing the doors, build what is wanted near the eye, drop what is hidden or left behind, and hand the physics what it holds now, merging the meshes that changed. */
  update(eyeX: number, eyeZ: number, dt: number, sight: InteriorSight, openers: DoorOpeners): void {
    if (this.claimedFrom === null) {
      this.sightBase = sight.claim(this.entries.length);
      this.claimedFrom = sight;
    }
    this.doors.update(eyeX, eyeZ, dt, openers);
    this.pickShopfronts(eyeX, eyeZ, sight);
    this.shellBuilds = 0;
    this.detailBuilds = 0;
    let shellsChanged = false;
    let detailsChanged = false;
    let solidsChanged = false;
    for (let at = 0; at < this.entries.length; at++) {
      const entry = this.entries[at]!;
      const { distance } = entry;
      const view = this.viewOf(entry, this.sightBase + at, distance, sight);
      if (this.streamShell(entry, distance, view, dt)) {
        shellsChanged = true;
        this.showVestibules(entry, entry.shell === null);
      }
      if (this.streamDetail(entry, distance, view, dt)) detailsChanged = true;
      const solids = this.solidsOf(entry, distance, openers.walker);
      if (solids !== entry.solids) {
        entry.solids = solids;
        solidsChanged = true;
      }
    }
    this.showBuiltThrough();
    if (solidsChanged) this.solidsListener?.(this.heldSolids());
    if (shellsChanged) this.merge(this.shellMesh, this.entries.map((entry) => entry.shell));
    if (detailsChanged) {
      this.merge(this.detailMesh, this.entries.map((entry) => entry.detail));
      this.merge(this.glowMesh, this.entries.map((entry) => entry.glow));
    }
    if (shellsChanged || detailsChanged) this.merge(this.glassMesh, this.entries.flatMap((entry) => [entry.shellGlass, entry.detailGlass]));
  }

  /** Every entry's distance from the eye; the businesses whose street front an eye sees within reach (a furnished one keeps its place out to `INTERIOR_FAR`, so a step across the near radius does not drop it) are ranked, and the nearest `SHOPFRONT_ROOMS` are marked. */
  private pickShopfronts(eyeX: number, eyeZ: number, sight: InteriorSight): void {
    let kept = 0;
    for (let at = 0; at < this.entries.length; at++) {
      const entry = this.entries[at]!;
      const { place } = entry;
      entry.distance = hypot2(place.doorX - eyeX, place.doorZ - eyeZ);
      entry.shopfront = false;
      if (!entry.business || entry.distance >= (entry.detail === null ? INTERIOR_NEAR : INTERIOR_FAR)) continue;
      if (sight.seenThroughFace(place.x, place.z, place.yaw, entry.halfDepth, entry.halfWidth, SHOP_GROUND_STOREY, FACE.front)) kept = keepNearest(this.shopfrontAt, this.shopfrontDistance, kept, at, entry.distance);
    }
    for (let rank = 0; rank < kept; rank++) this.entries[this.shopfrontAt[rank]!]!.shopfront = true;
  }

  /** The facades of the buildings whose rooms are built (the ground floor's envelope and the rooms above it) show their windows through to them, the nearest `FACADE_OPEN_MAX` of them; every other keeps its windows painted. */
  private showBuiltThrough(): void {
    let count = 0;
    for (let at = 0; at < this.entries.length; at++) {
      const entry = this.entries[at]!;
      if (entry.shell === null || entry.detail === null) continue;
      count = keepNearest(this.listedAt, this.listedDistance, count, at, entry.distance);
    }
    for (let slot = 0; slot < count; slot++) {
      const { place } = this.entries[this.listedAt[slot]!]!;
      this.builtAt[2 * slot] = place.x;
      this.builtAt[2 * slot + 1] = place.z;
    }
    setOpenFacades(this.builtAt, count);
  }

  /** Only an interior in range or built is looked at: a player inside it, a business's street front in view (`pickShopfronts`), or an open street door of it whose doorway an eye within range sees, keeps its clock fresh. */
  private viewOf(entry: Entry, id: number, distance: number, sight: InteriorSight): View {
    if (distance >= SHELL_NEAR && entry.shell === null && entry.detail === null && entry.glow === null) return VIEW.kept;
    const { place } = entry;
    const seen = sight.playerInside(place.x, place.z, place.yaw, entry.halfDepth, entry.halfWidth) || entry.shopfront || (distance < SHELL_NEAR && this.openDoorSeen(entry, sight));
    sight.recordSighting(id, seen);
    if (seen) return VIEW.wanted;
    return sight.unseenFor(id) >= sight.hideGrace ? VIEW.hidden : VIEW.kept;
  }

  /** Some street door of the interior is open and an eye sees into its doorway. */
  private openDoorSeen(entry: Entry, sight: InteriorSight): boolean {
    for (let door = entry.firstDoor; door < entry.firstDoor + entry.doorCount; door++) {
      const leaf = this.doors.leaves[door]!;
      if (leaf.face !== DOOR_FACE.street || !this.doors.isOpen(door)) continue;
      if (sight.seenThroughFace(leaf.boxX, leaf.boxZ, entry.place.yaw, entry.halfDepth, leaf.width / 2, leaf.floorY + leaf.height, FACE.front)) return true;
    }
    return false;
  }

  /** A built interior within `SOLIDS_NEAR` is held whole; one the player's walker stands at the door of, only its vestibules. */
  private solidsOf(entry: Entry, distance: number, walker: DoorOpeners["walker"]): Solids {
    if (entry.shell !== null && distance < SOLIDS_NEAR) return SOLIDS.full;
    if (walker === null) return SOLIDS.none;
    for (let door = entry.firstDoor; door < entry.firstDoor + entry.doorCount; door++) {
      const leaf = this.doors.leaves[door]!;
      if (leaf.face === DOOR_FACE.street && hypot2(walker.x - leaf.x, walker.z - leaf.z) <= VESTIBULE_REACH) return SOLIDS.vestibule;
    }
    return SOLIDS.none;
  }

  private showVestibules(entry: Entry, shown: boolean): void {
    for (let door = entry.firstDoor; door < entry.firstDoor + entry.doorCount; door++) this.doors.showVestibule(door, shown);
  }

  /** The envelope: built when wanted within `SHELL_NEAR` (the frame's budget allowing), dropped when hidden or past `SHELL_FAR` for the linger; true when it changed. */
  private streamShell(entry: Entry, distance: number, view: View, dt: number): boolean {
    if (entry.shell === null) {
      if (view !== VIEW.wanted || distance >= SHELL_NEAR || this.shellBuilds >= SHELL_BUILDS_PER_FRAME) return false;
      const built = buildShell(entry.plan, entry.place);
      entry.shell = built.solid;
      entry.shellGlass = built.glass;
      entry.shellAway = 0;
      this.shellBuilds++;
      return true;
    }
    entry.shellAway = distance <= SHELL_FAR ? 0 : entry.shellAway + dt;
    if (view !== VIEW.hidden && entry.shellAway < INTERIOR_LINGER) return false;
    entry.shell.dispose();
    entry.shellGlass?.dispose();
    entry.shell = null;
    entry.shellGlass = null;
    return true;
  }

  /** The furniture, partitions, stairs and upper floors: the envelope's rule, within `INTERIOR_NEAR` and `INTERIOR_FAR`. */
  private streamDetail(entry: Entry, distance: number, view: View, dt: number): boolean {
    if (entry.detail === null && entry.glow === null) {
      if (view !== VIEW.wanted || distance >= INTERIOR_NEAR || this.detailBuilds >= DETAIL_BUILDS_PER_FRAME) return false;
      const built = buildDetail(entry.plan, entry.place);
      entry.detail = built.solid;
      entry.glow = built.glow;
      entry.detailGlass = built.glass;
      entry.detailAway = 0;
      this.detailBuilds++;
      return true;
    }
    entry.detailAway = distance <= INTERIOR_FAR ? 0 : entry.detailAway + dt;
    if (view !== VIEW.hidden && entry.detailAway < INTERIOR_LINGER) return false;
    entry.detail?.dispose();
    entry.glow?.dispose();
    entry.detailGlass?.dispose();
    entry.detail = null;
    entry.glow = null;
    entry.detailGlass = null;
    return true;
  }

  stats(): InteriorStats {
    let vertices = 0;
    let drawCalls = 0;
    for (const mesh of [this.shellMesh, this.detailMesh, this.glowMesh, this.glassMesh]) {
      if (!mesh.visible) continue;
      drawCalls++;
      vertices += mesh.geometry.getAttribute("position").count;
    }
    return { shells: this.entries.filter((entry) => entry.shell !== null).length, details: this.entries.filter((entry) => entry.detail !== null).length, vertices, drawCalls };
  }

  /** Doors standing open (or swinging) now. */
  openDoors(): number {
    return this.doors.openCount();
  }

  /** `listener` gets every solid the physics should hold (the whole list each time it changes, empty when none), for the walker. */
  onSolids(listener: SolidsListener): void {
    this.solidsListener = listener;
  }

  private heldSolids(): InteriorSolid[] {
    return this.entries.flatMap((entry) => (entry.solids === SOLIDS.full ? interiorSolids(entry.place, entry.plan) : entry.solids === SOLIDS.vestibule ? vestibuleSolids(entry.place, entry.plan) : []));
  }

  dispose(): void {
    if (this.entries.some((entry) => entry.solids !== SOLIDS.none)) this.solidsListener?.([]);
    for (const entry of this.entries) {
      entry.shell?.dispose();
      entry.shellGlass?.dispose();
      entry.detail?.dispose();
      entry.glow?.dispose();
      entry.detailGlass?.dispose();
    }
    for (const mesh of [this.shellMesh, this.detailMesh, this.glowMesh, this.glassMesh]) mesh.geometry.dispose();
    setOpenFacades(this.builtAt, 0);
    this.doors.dispose();
    this.empty.dispose();
    this.solidMaterial.dispose();
    this.glowMaterial.dispose();
    this.glassMaterial.dispose();
    this.claimedFrom?.release(this.sightBase, this.entries.length);
    this.group.removeFromParent();
  }

  private makeMesh(name: string, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(this.empty, material);
    mesh.name = name;
    mesh.visible = false;
    this.group.add(mesh);
    return mesh;
  }

  /** `mesh` shows the merge of the geometries that exist, or nothing. */
  private merge(mesh: THREE.Mesh, parts: readonly (THREE.BufferGeometry | null)[]): void {
    if (mesh.geometry !== this.empty) mesh.geometry.dispose();
    const live = parts.filter((part): part is THREE.BufferGeometry => part !== null);
    mesh.geometry = live.length > 0 ? mergeGeometries(live)! : this.empty;
    mesh.visible = live.length > 0;
  }
}
