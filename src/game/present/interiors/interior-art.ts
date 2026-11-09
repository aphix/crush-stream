import * as THREE from "three";
import { hypot2 } from "../../kernel/physics-core.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { InteriorPlan } from "../../world/openworld/interior-kinds.ts";
import { interiorSolids, planInterior, type InteriorSolid } from "../../world/openworld/interior-plan.ts";
import type { OpenWorldMap, Place } from "../../world/openworld/walk-graph.ts";
import { buildDetail, buildShell } from "./interior-build.ts";
import { DETAIL_BUILDS_PER_FRAME, INTERIOR_FAR, INTERIOR_LINGER, INTERIOR_NEAR, SHELL_BUILDS_PER_FRAME, SHELL_FAR, SHELL_NEAR, SOLIDS_NEAR } from "./interior-constants.ts";

/** One place with an interior: what is built of it now, and how long it has been out of range. */
type Entry = {
  place: Place;
  plan: InteriorPlan;
  shell: THREE.BufferGeometry | null;
  detail: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
  shellAway: number;
  detailAway: number;
  /** Its solids are with the physics. */
  inReach: boolean;
};

type SolidsListener = (solids: readonly InteriorSolid[]) => void;

/** What the set costs right now: places with an envelope, places furnished, vertices drawn, and draw calls (one per merged mesh that has any). */
type InteriorStats = { shells: number; details: number; vertices: number; drawCalls: number };

/**
 * The interiors of a map's places, streamed by distance from the eye: an envelope (walls, floor, ceiling) within `SHELL_NEAR`, so a doorway or shopfront window never shows through to the
 * world, and the furnished rooms within `INTERIOR_NEAR`. Everything is merged into three meshes (envelopes, lit furniture, unlit lamps and screens), so the draw calls do not grow with the interiors.
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
      this.entries.push({ place, plan, shell: null, detail: null, glow: null, shellAway: 0, detailAway: 0, inReach: false });
    }
    this.shellMesh = this.makeMesh("interior-shells", this.solidMaterial);
    this.detailMesh = this.makeMesh("interior-furniture", this.solidMaterial);
    this.glowMesh = this.makeMesh("interior-lights", this.glowMaterial);
  }

  /** Build what the eye has come near and drop what it has left (for `INTERIOR_LINGER`), merging the meshes that changed. */
  update(eyeX: number, eyeZ: number, dt: number): void {
    let shellBuilds = 0;
    let detailBuilds = 0;
    let shellsChanged = false;
    let detailsChanged = false;
    let reachChanged = false;
    for (let at = 0; at < this.entries.length; at++) {
      const entry = this.entries[at]!;
      const distance = hypot2(entry.place.doorX - eyeX, entry.place.doorZ - eyeZ);
      const reached = distance < SOLIDS_NEAR;
      if (reached !== entry.inReach) {
        entry.inReach = reached;
        reachChanged = true;
      }
      if (entry.shell === null) {
        if (distance < SHELL_NEAR && shellBuilds < SHELL_BUILDS_PER_FRAME) {
          entry.shell = buildShell(entry.plan, entry.place);
          entry.shellAway = 0;
          shellBuilds++;
          shellsChanged = true;
        }
      } else if (distance <= SHELL_FAR) entry.shellAway = 0;
      else if ((entry.shellAway += dt) >= INTERIOR_LINGER) {
        entry.shell.dispose();
        entry.shell = null;
        shellsChanged = true;
      }
      if (entry.detail === null && entry.glow === null) {
        if (distance < INTERIOR_NEAR && detailBuilds < DETAIL_BUILDS_PER_FRAME) {
          const built = buildDetail(entry.plan, entry.place);
          entry.detail = built.solid;
          entry.glow = built.glow;
          entry.detailAway = 0;
          detailBuilds++;
          detailsChanged = true;
        }
      } else if (distance <= INTERIOR_FAR) entry.detailAway = 0;
      else if ((entry.detailAway += dt) >= INTERIOR_LINGER) {
        entry.detail?.dispose();
        entry.glow?.dispose();
        entry.detail = null;
        entry.glow = null;
        detailsChanged = true;
      }
    }
    if (reachChanged) this.solidsListener?.(this.reachableSolids());
    if (shellsChanged) this.merge(this.shellMesh, this.entries.map((entry) => entry.shell));
    if (detailsChanged) {
      this.merge(this.detailMesh, this.entries.map((entry) => entry.detail));
      this.merge(this.glowMesh, this.entries.map((entry) => entry.glow));
    }
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
