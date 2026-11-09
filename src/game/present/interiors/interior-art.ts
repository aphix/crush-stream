import * as THREE from "three";
import { hypot2 } from "../../kernel/physics-core.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { SHOPFRONT, type InteriorPlan } from "../../world/openworld/interior-kinds.ts";
import { interiorSolids, planInterior, type InteriorSolid } from "../../world/openworld/interior-plan.ts";
import type { OpenWorldMap, Place } from "../../world/openworld/walk-graph.ts";
import { FACE, type SightField } from "../openworld-sight.ts";
import { buildDetail, buildShell } from "./interior-build.ts";
import { DETAIL_BUILDS_PER_FRAME, INTERIOR_FAR, INTERIOR_KEEP, INTERIOR_LINGER, INTERIOR_NEAR, SHELL_BUILDS_PER_FRAME, SHELL_FAR, SHELL_NEAR, SOLIDS_NEAR } from "./interior-constants.ts";

/** One place with an interior: what is built of it now, and how long it has been out of range. */
type Entry = {
  place: Place;
  plan: InteriorPlan;
  /** The top of its highest street opening above the ground (m): what an eye can see into through the front; and half its footprint's diagonal, which a player's keep is measured past. */
  openingTop: number;
  reach: number;
  shell: THREE.BufferGeometry | null;
  detail: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
  shellAway: number;
  detailAway: number;
  /** Its solids are with the physics. */
  inReach: boolean;
};

type SolidsListener = (solids: readonly InteriorSolid[]) => void;

/** What the interiors ask of the open world's sight field. */
type InteriorSight = Pick<SightField, "claim" | "seenThroughFace" | "recordSighting" | "unseenFor" | "near" | "hideGrace">;

/** An interior this frame: neither built anew nor dropped (`kept`), wanted (seen, or a player beside it), or hidden (no eye has seen it for the hide grace and no player is beside it). */
const VIEW = { kept: 0, wanted: 1, hidden: 2 } as const;
type View = (typeof VIEW)[keyof typeof VIEW];
const NO_IDS = -1;

/** What the set costs right now: places with an envelope, places furnished, vertices drawn, and draw calls (one per merged mesh that has any). */
type InteriorStats = { shells: number; details: number; vertices: number; drawCalls: number };

/**
 * The interiors of a map's places, streamed by distance from the eye and by sight: an envelope (walls, floor, ceiling) within `SHELL_NEAR`, so a doorway or shopfront window never shows through to the
 * world, and the furnished rooms within `INTERIOR_NEAR`, each built while some eye sees it (or a player is beside it) and dropped once none has for the sight field's hide grace. Everything is merged
 * into three meshes (envelopes, lit furniture, unlit lamps and screens), so the draw calls do not grow with the interiors. The physics' solids follow distance alone, never sight.
 */
export class InteriorSet {
  readonly group = new THREE.Group();
  private readonly entries: Entry[] = [];
  private readonly empty = new THREE.BufferGeometry();
  private readonly solidMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  private readonly glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  private readonly shellMesh: THREE.Mesh;
  private readonly detailMesh: THREE.Mesh;
  private readonly glowMesh: THREE.Mesh;
  private solidsListener: SolidsListener | null = null;
  /** The first of the sight field's ids, one per entry, claimed at the first frame. */
  private sightBase = NO_IDS;
  private shellBuilds = 0;
  private detailBuilds = 0;

  constructor(map: OpenWorldMap) {
    this.group.name = "interiors";
    const plans = new Map<string, InteriorPlan>();
    for (const place of map.places) {
      if (place.interior === undefined || place.doorNode < 0) continue;
      const key = `${place.interior}:${place.width}:${place.depth}`;
      let plan = plans.get(key);
      if (plan === undefined) {
        plan = planInterior(place.interior, place.width, place.depth);
        plans.set(key, plan);
      }
      this.entries.push({ place, plan, openingTop: plan.floors[0]! + Math.max(...SHOPFRONT[place.interior].map((opening) => opening.top)), reach: hypot2(place.width / 2, place.depth / 2), shell: null, detail: null, glow: null, shellAway: 0, detailAway: 0, inReach: false });
    }
    this.shellMesh = this.makeMesh("interior-shells", this.solidMaterial);
    this.detailMesh = this.makeMesh("interior-furniture", this.solidMaterial);
    this.glowMesh = this.makeMesh("interior-lights", this.glowMaterial);
  }

  /** Build what the eye has come near and some eye sees, drop what it has left (for `INTERIOR_LINGER`) or no eye has seen for the hide grace, merging the meshes that changed. */
  update(eyeX: number, eyeZ: number, dt: number, sight: InteriorSight): void {
    if (this.sightBase === NO_IDS) this.sightBase = sight.claim(this.entries.length);
    this.shellBuilds = 0;
    this.detailBuilds = 0;
    let shellsChanged = false;
    let detailsChanged = false;
    let reachChanged = false;
    for (let at = 0; at < this.entries.length; at++) {
      const entry = this.entries[at]!;
      const distance = hypot2(entry.place.doorX - eyeX, entry.place.doorZ - eyeZ);
      const view = this.viewOf(entry, this.sightBase + at, distance, sight);
      const reached = distance < SOLIDS_NEAR;
      if (reached !== entry.inReach) {
        entry.inReach = reached;
        reachChanged = true;
      }
      if (this.streamShell(entry, distance, view, dt)) shellsChanged = true;
      if (this.streamDetail(entry, distance, view, dt)) detailsChanged = true;
    }
    if (reachChanged) this.solidsListener?.(this.reachableSolids());
    if (shellsChanged) this.merge(this.shellMesh, this.entries.map((entry) => entry.shell));
    if (detailsChanged) {
      this.merge(this.detailMesh, this.entries.map((entry) => entry.detail));
      this.merge(this.glowMesh, this.entries.map((entry) => entry.glow));
    }
  }

  /** Only an interior in range or built is looked at: an eye inside it, or before its street face with a clear line to it (the view through the doorway and the windows), keeps its clock fresh. */
  private viewOf(entry: Entry, id: number, distance: number, sight: InteriorSight): View {
    if (distance >= SHELL_NEAR && entry.shell === null && entry.detail === null && entry.glow === null) return VIEW.kept;
    const { place } = entry;
    const seen = sight.recordSighting(id, sight.seenThroughFace(place.x, place.z, place.yaw, place.depth / 2, place.width / 2, entry.openingTop, FACE.front));
    if (seen || sight.near(place.x, place.z, entry.reach + INTERIOR_KEEP)) return VIEW.wanted;
    return sight.unseenFor(id) >= sight.hideGrace ? VIEW.hidden : VIEW.kept;
  }

  /** The envelope: built when wanted within `SHELL_NEAR` (the frame's budget allowing), dropped when hidden or past `SHELL_FAR` for the linger; true when it changed. */
  private streamShell(entry: Entry, distance: number, view: View, dt: number): boolean {
    if (entry.shell === null) {
      if (view !== VIEW.wanted || distance >= SHELL_NEAR || this.shellBuilds >= SHELL_BUILDS_PER_FRAME) return false;
      entry.shell = buildShell(entry.plan, entry.place);
      entry.shellAway = 0;
      this.shellBuilds++;
      return true;
    }
    entry.shellAway = distance <= SHELL_FAR ? 0 : entry.shellAway + dt;
    if (view !== VIEW.hidden && entry.shellAway < INTERIOR_LINGER) return false;
    entry.shell.dispose();
    entry.shell = null;
    return true;
  }

  /** The furniture, partitions, stairs and upper floors: as the envelope, within `INTERIOR_NEAR` and `INTERIOR_FAR`. */
  private streamDetail(entry: Entry, distance: number, view: View, dt: number): boolean {
    if (entry.detail === null && entry.glow === null) {
      if (view !== VIEW.wanted || distance >= INTERIOR_NEAR || this.detailBuilds >= DETAIL_BUILDS_PER_FRAME) return false;
      const built = buildDetail(entry.plan, entry.place);
      entry.detail = built.solid;
      entry.glow = built.glow;
      entry.detailAway = 0;
      this.detailBuilds++;
      return true;
    }
    entry.detailAway = distance <= INTERIOR_FAR ? 0 : entry.detailAway + dt;
    if (view !== VIEW.hidden && entry.detailAway < INTERIOR_LINGER) return false;
    entry.detail?.dispose();
    entry.glow?.dispose();
    entry.detail = null;
    entry.glow = null;
    return true;
  }

  stats(): InteriorStats {
    let vertices = 0;
    let drawCalls = 0;
    for (const mesh of [this.shellMesh, this.detailMesh, this.glowMesh]) {
      if (!mesh.visible) continue;
      drawCalls++;
      vertices += mesh.geometry.getAttribute("position").count;
    }
    return { shells: this.entries.filter((entry) => entry.shell !== null).length, details: this.entries.filter((entry) => entry.detail !== null).length, vertices, drawCalls };
  }

  /** `listener` gets every solid of the interiors within `SOLIDS_NEAR` of the eye (the whole list each time it changes, empty when none), for the physics that lets a walker in. */
  onSolids(listener: SolidsListener): void {
    this.solidsListener = listener;
  }

  private reachableSolids(): InteriorSolid[] {
    return this.entries.filter((entry) => entry.inReach).flatMap((entry) => interiorSolids(entry.place));
  }

  dispose(): void {
    if (this.entries.some((entry) => entry.inReach)) this.solidsListener?.([]);
    for (const entry of this.entries) {
      entry.shell?.dispose();
      entry.detail?.dispose();
      entry.glow?.dispose();
    }
    for (const mesh of [this.shellMesh, this.detailMesh, this.glowMesh]) mesh.geometry.dispose();
    this.empty.dispose();
    this.solidMaterial.dispose();
    this.glowMaterial.dispose();
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
