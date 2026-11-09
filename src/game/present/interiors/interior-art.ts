import * as THREE from "three";
import { hypot2 } from "../../kernel/physics-core.js";
import { SHOP_GROUND_STOREY, type InteriorPlan } from "../../world/openworld/interior-kinds.ts";
import { DOOR_FACE, interiorDoors, interiorSolids, planInterior, planKey, vestibuleSolids, type DoorLeaf, type InteriorSolid } from "../../world/openworld/interior-plan.ts";
import { drawnHalf } from "../../world/openworld/openworld-facade-solids.ts";
import type { OpenWorldMap, Place } from "../../world/openworld/walk-graph.ts";
import { FACADE_DARK_MAX, FACADE_OPEN_MAX, FACADE_OPEN_SLOT_FLOATS, setDarkFacades, setOpenFacades } from "../facades.ts";
import { FACE, type SightField } from "../openworld-sight.ts";
import { buildDetail, buildShell } from "./interior-build.ts";
import { CLOSED_GLOW, DETAIL_BUILDS_PER_FRAME, GLASS_OPACITY, INTERIOR_FAR, INTERIOR_DIM, INTERIOR_LINGER, INTERIOR_NEAR, OPEN_FADE_SECONDS, PACK_START_VERTICES, SHELL_BUILDS_PER_FRAME, SHELL_FAR, SHELL_NEAR, SHOPFRONT_ROOMS, SOLIDS_NEAR, VESTIBULE_REACH } from "./interior-constants.ts";
import { DoorSet, type DoorOpeners } from "./interior-doors.ts";
import { NO_SLOT, PackedMesh } from "./interior-pack.ts";

/** What of an interior the physics holds: nothing, the vestibules behind its street doors, or all of it. */
const SOLIDS = { none: 0, vestibule: 1, full: 2 } as const;
type Solids = (typeof SOLIDS)[keyof typeof SOLIDS];

/** One place with an interior: whether it is a business (not a home), its footprint's half sides (drawn depth, width), its doors in the door set, what is built of it now (whether, and the slot each piece of it holds in its packed mesh), whether its street front is in view this frame (a business within range), and whether it is to be dropped once its windows have shut. */
type Entry = {
  place: Place;
  plan: InteriorPlan;
  placeIndex: number;
  business: boolean;
  shopfront: boolean;
  closing: boolean;
  locked: boolean;
  dimmed: boolean;
  halfDepth: number;
  halfWidth: number;
  firstDoor: number;
  doorCount: number;
  shellBuilt: boolean;
  detailBuilt: boolean;
  shellSlot: number;
  shellGlassSlot: number;
  detailSlot: number;
  glowSlot: number;
  detailGlassSlot: number;
  solids: Solids;
};

type SolidsListener = (solids: readonly InteriorSolid[]) => void;

/** What the interiors ask of the open world's sight field. */
type InteriorSight = Pick<SightField, "claim" | "release" | "probe" | "seenThroughFace" | "recordSighting" | "unseenFor" | "playerInside" | "hideGrace">;

/** An interior this frame: neither built anew nor dropped (`kept`), wanted (a player inside, a business's street front in view, or an open street door of it seen within range), or hidden (none of them, for the hide grace). */
const VIEW = { kept: 0, wanted: 1, hidden: 2 } as const;
type View = (typeof VIEW)[keyof typeof VIEW];
const NO_IDS = -1;

/** Points the sight field's probe at the front of `entry`'s footprint, centred at (x, z), up to `top` m: the numbers go in its fields, not through a call, which would box them. */
function aimAtFront(sight: Pick<SightField, "probe">, entry: { place: Place; halfDepth: number; halfWidth: number }, x: number, z: number, top: number): void {
  const probe = sight.probe;
  probe.x = x;
  probe.z = z;
  probe.yaw = entry.place.yaw;
  probe.halfDepth = entry.halfDepth;
  probe.halfWidth = entry.halfWidth;
  probe.top = top;
}

/** Puts `index` among the nearest kept so far (`slots`' length at most, ascending by `distanceOf`, each entry's distance from the eye), pushing the farthest out when they are full; returns how many are kept now. */
function keepNearest(slots: Int32Array, count: number, index: number, distanceOf: Float64Array): number {
  const capacity = slots.length;
  const distance = distanceOf[index]!;
  if (count === capacity && distance >= distanceOf[slots[capacity - 1]!]!) return count;
  let at = count < capacity ? count : capacity - 1;
  while (at > 0 && distanceOf[slots[at - 1]!]! > distance) {
    slots[at] = slots[at - 1]!;
    at--;
  }
  slots[at] = index;
  return count < capacity ? count + 1 : count;
}

/** What the streamed interiors cost right now: places with an envelope, places furnished, vertices drawn, and draw calls (one per packed mesh that has any). The doors and vestibules add two draws, always; the glass is a fourth packed mesh. */
type InteriorStats = { shells: number; details: number; vertices: number; drawCalls: number };

/**
 * The interiors of a map's places. Every door is a hinged leaf, shut until someone stands at it, with a small vestibule behind each street door; the rooms behind are built only while a player
 * is inside, or a street door of theirs is open and some eye within range sees that doorway, or (a business: shop, bar, cafe, office, store) some eye within `INTERIOR_NEAR` sees its street front,
 * the nearest `SHOPFRONT_ROOMS` of them, so its windows show the lit room from the street with no door open; they are dropped once none has held for the sight field's hide grace (or the eye has been
 * past their far radius for `INTERIOR_LINGER`): the ground floor's envelope within `SHELL_NEAR`, the furnished rooms within `INTERIOR_NEAR`. A civilian swinging a door no player sees builds nothing.
 * The rooms are packed into four meshes (envelopes, lit furniture, unlit lamps and screens, glass), each a storage made once that a build writes into and a drop closes over (`PackedMesh`). The physics holds a built interior's solids within `SOLIDS_NEAR` of the eye, and a vestibule's while
 * the player's walker is at its door.
 */
export class InteriorSet {
  readonly group = new THREE.Group();
  private readonly entries: Entry[] = [];
  private readonly doors: DoorSet;
  private readonly solidMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, color: new THREE.Color(INTERIOR_DIM, INTERIOR_DIM, INTERIOR_DIM), roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  private readonly glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  private readonly glassMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: GLASS_OPACITY, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
  private readonly shells: PackedMesh;
  private readonly details: PackedMesh;
  private readonly glows: PackedMesh;
  private readonly glass: PackedMesh;
  private solidsListener: SolidsListener | null = null;
  /** The first of the sight field's ids, one per entry, claimed at the first frame from `claimedFrom`, and given back to it on dispose. */
  private sightBase = NO_IDS;
  private claimedFrom: InteriorSight | null = null;
  private shellBuilds = 0;
  private detailBuilds = 0;
  /** The x, z of every building whose room is built whole (its envelope and its rooms above), as the facade's shader takes them. */
  private readonly builtAt: Float32Array;
  /** The nearest businesses in view and the nearest built buildings the facade lists (entry indices, nearest first), filled each frame. */
  private readonly shopfrontAt = new Int32Array(SHOPFRONT_ROOMS);
  private readonly listedAt = new Int32Array(FACADE_OPEN_MAX);
  /** The nearest shut businesses (entry indices, nearest first) and their positions, as the facade's dark list takes them. */
  private readonly darkAt = new Int32Array(FACADE_DARK_MAX);
  private readonly darkPositions = new Float32Array(2 * FACADE_DARK_MAX);
  /** Per entry, in arrays and not in the entries (a double stored in an object may be a new box on every store): its door's distance from the eye this frame, and how long (s) its envelope and its furnishing have been past their far radius. */
  private readonly distance: Float64Array;
  private readonly shellAway: Float64Array;
  private readonly detailAway: Float64Array;
  /** Per entry, how far its windows are open (0 painted to 1 seen through): up while its rooms are built whole and wanted, down to shut before they are dropped. */
  private readonly openness: Float64Array;
  /** This frame's seconds: a double handed to a method may be boxed anew at each call, so the methods read it here. */
  private readonly seconds = new Float64Array(1);

  constructor(map: OpenWorldMap) {
    this.group.name = "interiors";
    this.builtAt = new Float32Array(FACADE_OPEN_SLOT_FLOATS * FACADE_OPEN_MAX);
    const plans = new Map<string, InteriorPlan>();
    const leaves: DoorLeaf[] = [];
    for (let placeIndex = 0; placeIndex < map.places.length; placeIndex++) {
      const place = map.places[placeIndex]!;
      if (place.interior === undefined || place.doorNode < 0) continue;
      const key = planKey(place);
      let plan = plans.get(key);
      if (plan === undefined) {
        plan = planInterior(place);
        plans.set(key, plan);
      }
      const doors = interiorDoors(place, plan);
      this.entries.push({ place, plan, placeIndex, business: place.interior !== "rowhome", shopfront: false, closing: false, locked: false, dimmed: false, halfDepth: drawnHalf(place.depth), halfWidth: drawnHalf(place.width), firstDoor: leaves.length, doorCount: doors.length, shellBuilt: false, detailBuilt: false, shellSlot: NO_SLOT, shellGlassSlot: NO_SLOT, detailSlot: NO_SLOT, glowSlot: NO_SLOT, detailGlassSlot: NO_SLOT, solids: SOLIDS.none });
      leaves.push(...doors);
    }
    this.distance = new Float64Array(this.entries.length);
    this.shellAway = new Float64Array(this.entries.length);
    this.detailAway = new Float64Array(this.entries.length);
    this.openness = new Float64Array(this.entries.length);
    this.doors = new DoorSet(leaves);
    this.group.add(this.doors.group);
    this.shells = this.packed("interior-shells", this.solidMaterial, PACK_START_VERTICES.shell);
    this.details = this.packed("interior-furniture", this.solidMaterial, PACK_START_VERTICES.detail);
    this.glows = this.packed("interior-lights", this.glowMaterial, PACK_START_VERTICES.glow);
    this.glass = this.packed("interior-glass", this.glassMaterial, PACK_START_VERTICES.glass);
  }

  /** Swing the doors, build what is wanted near the eye, drop what is hidden or left behind, and hand the physics what it holds now. */
  update(eyeX: number, eyeZ: number, dt: number, sight: InteriorSight, openers: DoorOpeners): void {
    if (this.claimedFrom === null) {
      this.sightBase = sight.claim(this.entries.length);
      this.claimedFrom = sight;
    }
    this.seconds[0] = dt;
    this.doors.update(eyeX, eyeZ, dt, openers);
    this.pickShopfronts(eyeX, eyeZ, sight);
    this.shellBuilds = 0;
    this.detailBuilds = 0;
    let solidsChanged = false;
    for (let at = 0; at < this.entries.length; at++) {
      const entry = this.entries[at]!;
      const view = this.viewOf(entry, at, sight);
      entry.closing = false;
      if (this.streamShell(entry, at, view)) this.showVestibules(entry, !entry.shellBuilt);
      this.streamDetail(entry, at, view);
      this.keepShut(entry, openers.closed);
      const open = entry.shellBuilt && entry.detailBuilt && !entry.closing ? 1 : 0;
      const step = this.seconds[0]! / OPEN_FADE_SECONDS;
      this.openness[at] = open === 1 ? Math.min(1, this.openness[at]! + step) : Math.max(0, this.openness[at]! - step);
      const solids = this.solidsOf(entry, at, openers.walker);
      if (solids !== entry.solids) {
        entry.solids = solids;
        solidsChanged = true;
      }
    }
    this.showBuiltThrough();
    this.showShutDark();
    if (solidsChanged) this.solidsListener?.(this.heldSolids());
  }

  /** Every entry's distance from the eye; the businesses whose street front an eye sees within reach (a furnished one keeps its place out to `INTERIOR_FAR`, so a step across the near radius does not drop it) are ranked, and the nearest `SHOPFRONT_ROOMS` are marked. */
  private pickShopfronts(eyeX: number, eyeZ: number, sight: InteriorSight): void {
    let kept = 0;
    for (let at = 0; at < this.entries.length; at++) {
      const entry = this.entries[at]!;
      const { place } = entry;
      const distance = hypot2(place.doorX - eyeX, place.doorZ - eyeZ);
      this.distance[at] = distance;
      entry.shopfront = false;
      if (!entry.business || distance >= (entry.detailBuilt ? INTERIOR_FAR : INTERIOR_NEAR)) continue;
      aimAtFront(sight, entry, place.x, place.z, SHOP_GROUND_STOREY);
      if (sight.seenThroughFace(FACE.front)) kept = keepNearest(this.shopfrontAt, kept, at, this.distance);
    }
    for (let rank = 0; rank < kept; rank++) this.entries[this.shopfrontAt[rank]!]!.shopfront = true;
  }

  /** The facades of the buildings whose rooms are built (the ground floor's envelope and the rooms above it) show their windows through to them, the nearest `FACADE_OPEN_MAX` of them; every other keeps its windows painted. */
  private showBuiltThrough(): void {
    let count = 0;
    for (let at = 0; at < this.entries.length; at++) {
      const entry = this.entries[at]!;
      if (!entry.shellBuilt || !entry.detailBuilt) continue;
      count = keepNearest(this.listedAt, count, at, this.distance);
    }
    for (let slot = 0; slot < count; slot++) {
      const { place } = this.entries[this.listedAt[slot]!]!;
      this.builtAt[FACADE_OPEN_SLOT_FLOATS * slot] = place.x;
      this.builtAt[FACADE_OPEN_SLOT_FLOATS * slot + 1] = place.z;
      this.builtAt[FACADE_OPEN_SLOT_FLOATS * slot + 2] = this.openness[this.listedAt[slot]!]!;
    }
    setOpenFacades(this.builtAt, count);
  }

  /** Only an interior in range or built is looked at: a player inside it, a business's street front in view (`pickShopfronts`), or an open street door of it whose doorway an eye within range sees, keeps its clock fresh. */
  private viewOf(entry: Entry, at: number, sight: InteriorSight): View {
    const distance = this.distance[at]!;
    const id = this.sightBase + at;
    if (distance >= SHELL_NEAR && !entry.shellBuilt && !entry.detailBuilt) return VIEW.kept;
    const { place } = entry;
    aimAtFront(sight, entry, place.x, place.z, 0);
    const seen = sight.playerInside() || entry.shopfront || (distance < SHELL_NEAR && this.openDoorSeen(entry, sight));
    sight.recordSighting(id, seen);
    if (seen) return VIEW.wanted;
    return sight.unseenFor(id) >= sight.hideGrace ? VIEW.hidden : VIEW.kept;
  }

  /** Some street door of the interior is open and an eye sees into its doorway. */
  private openDoorSeen(entry: Entry, sight: InteriorSight): boolean {
    for (let door = entry.firstDoor; door < entry.firstDoor + entry.doorCount; door++) {
      const leaf = this.doors.leaves[door]!;
      if (leaf.face !== DOOR_FACE.street || !this.doors.isOpen(door)) continue;
      aimAtFront(sight, entry, leaf.boxX, leaf.boxZ, leaf.floorY + leaf.height);
      sight.probe.halfWidth = leaf.width / 2;
      if (sight.seenThroughFace(FACE.front)) return true;
    }
    return false;
  }

  /** A built interior within `SOLIDS_NEAR` is held whole; one the player's walker stands at the door of, only its vestibules. */
  private solidsOf(entry: Entry, at: number, walker: DoorOpeners["walker"]): Solids {
    if (entry.shellBuilt && this.distance[at]! < SOLIDS_NEAR) return SOLIDS.full;
    if (walker === null) return SOLIDS.none;
    for (let door = entry.firstDoor; door < entry.firstDoor + entry.doorCount; door++) {
      const leaf = this.doors.leaves[door]!;
      if (leaf.face === DOOR_FACE.street && hypot2(walker.x - leaf.x, walker.z - leaf.z) <= VESTIBULE_REACH) return SOLIDS.vestibule;
    }
    return SOLIDS.none;
  }

  /** The nearest shut businesses are listed for the facade: their ground band's windows do not light at dusk. */
  private showShutDark(): void {
    let count = 0;
    for (let at = 0; at < this.entries.length; at++) if (this.entries[at]!.business && this.entries[at]!.locked) count = keepNearest(this.darkAt, count, at, this.distance);
    for (let slot = 0; slot < count; slot++) {
      const { place } = this.entries[this.darkAt[slot]!]!;
      this.darkPositions[2 * slot] = place.x;
      this.darkPositions[2 * slot + 1] = place.z;
    }
    setDarkFacades(this.darkPositions, count);
  }

  /** A shut shop (a wreck, or outside its hours) has its street doors locked and its lamps and screens dimmed; open again, they are as they were. */
  private keepShut(entry: Entry, closed: Uint8Array | null): void {
    const shut = closed !== null && closed[entry.placeIndex] === 1;
    if (shut !== entry.locked) {
      for (let door = entry.firstDoor; door < entry.firstDoor + entry.doorCount; door++) if (this.doors.leaves[door]!.face === DOOR_FACE.street) this.doors.setLocked(door, shut);
      entry.locked = shut;
    }
    if (entry.glowSlot !== NO_SLOT && shut !== entry.dimmed) {
      this.glows.scaleColor(entry.glowSlot, shut ? CLOSED_GLOW : 1 / CLOSED_GLOW);
      entry.dimmed = shut;
    }
  }

  private showVestibules(entry: Entry, shown: boolean): void {
    for (let door = entry.firstDoor; door < entry.firstDoor + entry.doorCount; door++) this.doors.showVestibule(door, shown);
  }

  /** The envelope: built when wanted within `SHELL_NEAR` (the frame's budget allowing), dropped when hidden or past `SHELL_FAR` for the linger; true when it changed. */
  private streamShell(entry: Entry, at: number, view: View): boolean {
    const distance = this.distance[at]!;
    if (!entry.shellBuilt) {
      if (view !== VIEW.wanted || distance >= SHELL_NEAR || this.shellBuilds >= SHELL_BUILDS_PER_FRAME) return false;
      const built = buildShell(entry.plan);
      const { place } = entry;
      entry.shellSlot = this.shells.add(built.solid, place.yaw, place.x, place.z);
      entry.shellGlassSlot = this.glass.add(built.glass, place.yaw, place.x, place.z);
      entry.shellBuilt = true;
      this.shellAway[at] = 0;
      this.shellBuilds++;
      return true;
    }
    this.shellAway[at] = distance <= SHELL_FAR ? 0 : this.shellAway[at]! + this.seconds[0]!;
    if (view !== VIEW.hidden && this.shellAway[at]! < INTERIOR_LINGER) return false;
    if (this.openness[at]! > 0) {
      entry.closing = true;
      return false;
    }
    this.shells.remove(entry.shellSlot);
    this.glass.remove(entry.shellGlassSlot);
    entry.shellSlot = NO_SLOT;
    entry.shellGlassSlot = NO_SLOT;
    entry.shellBuilt = false;
    return true;
  }

  /** The furniture, partitions, stairs and upper floors: the envelope's rule, within `INTERIOR_NEAR` and `INTERIOR_FAR`. */
  private streamDetail(entry: Entry, at: number, view: View): boolean {
    const distance = this.distance[at]!;
    if (!entry.detailBuilt) {
      if (view !== VIEW.wanted || distance >= INTERIOR_NEAR || this.detailBuilds >= DETAIL_BUILDS_PER_FRAME) return false;
      const built = buildDetail(entry.plan);
      const { place } = entry;
      entry.detailSlot = this.details.add(built.solid, place.yaw, place.x, place.z);
      entry.glowSlot = this.glows.add(built.glow, place.yaw, place.x, place.z);
      entry.detailGlassSlot = this.glass.add(built.glass, place.yaw, place.x, place.z);
      entry.detailBuilt = true;
      this.detailAway[at] = 0;
      this.detailBuilds++;
      return true;
    }
    this.detailAway[at] = distance <= INTERIOR_FAR ? 0 : this.detailAway[at]! + this.seconds[0]!;
    if (view !== VIEW.hidden && this.detailAway[at]! < INTERIOR_LINGER) return false;
    if (this.openness[at]! > 0) {
      entry.closing = true;
      return false;
    }
    this.details.remove(entry.detailSlot);
    this.glows.remove(entry.glowSlot);
    this.glass.remove(entry.detailGlassSlot);
    entry.detailSlot = NO_SLOT;
    entry.glowSlot = NO_SLOT;
    entry.dimmed = false;
    entry.detailGlassSlot = NO_SLOT;
    entry.detailBuilt = false;
    return true;
  }

  stats(): InteriorStats {
    let vertices = 0;
    let drawCalls = 0;
    for (const packed of [this.shells, this.details, this.glows, this.glass]) {
      if (packed.vertices === 0) continue;
      drawCalls++;
      vertices += packed.vertices;
    }
    return { shells: this.entries.filter((entry) => entry.shellBuilt).length, details: this.entries.filter((entry) => entry.detailBuilt).length, vertices, drawCalls };
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
    for (const packed of [this.shells, this.details, this.glows, this.glass]) packed.dispose();
    setOpenFacades(this.builtAt, 0);
    setDarkFacades(this.darkPositions, 0);
    this.doors.dispose();
    this.solidMaterial.dispose();
    this.glowMaterial.dispose();
    this.glassMaterial.dispose();
    this.claimedFrom?.release(this.sightBase, this.entries.length);
    this.group.removeFromParent();
  }

  private packed(name: string, material: THREE.Material, startVertices: number): PackedMesh {
    const packed = new PackedMesh(name, material, startVertices);
    this.group.add(packed.mesh);
    return packed;
  }
}
