import * as THREE from "three";
import type { Collider, ColliderDesc, World } from "@dimforge/rapier3d-simd";
import type { Rapier } from "../kernel/rapier.ts";
import { activeGround } from "../world/ground.ts";
import { GRID, P_AX, P_BX, P_CX, P_OX, P_OY, P_OZ, P_RAD2, P_STEP, P_STEPV, P_STRIDE, P_U0, P_V0, PRISM, Q_KIND, Q_NU, Q_NV, Q_SOLID, Q_STRIDE, type Surface } from "../world/surfaces.ts";
import type { Track } from "../world/track.ts";
import { DOLL_FLOOR_GROUPS, PROP_FLOOR_GROUPS } from "./ragdoll-config.ts";
import { prismSolid, type Solid } from "./ragdoll-solids.ts";
import { hypot2 } from "../kernel/physics-core.js";

/** The course under a throw: `track` gives its ground (none for a scene's own solids, the Lab's), `solids` its walls and every other solid (`courseSolids`). */
type Course = { track: Track | null; solids: readonly Solid[] };
/** A sandbox lamp post (`LampPole`'s fields that matter here): a thin upright cylinder while it stands. */
export type Pole = { group: { position: { x: number; z: number }; visible: boolean }; intact: boolean; radius: number };
/** Half-thickness (m) of a flat solid's slab, and how far under its lowest node a tilted patch's prism reaches. */
const SLAB = 0.5;
/** Sandbox lamp post height (m): the cinematic eye's occluder for it. */
const POLE_H = 5.3;

/** Course ground patch cell size (m). */
const PATCH_CELL = 2;
/** A dummy's patch around a throw (`groundColliders`' `half`): 96 m across. */
export const PATCH_HALF = 48;
/** Metres down a throw that the patch built for it is centred. */
export const PATCH_AHEAD = 24;
/** Half-size (m) of the sandbox's flat pad collider: past any spot a car reaches. */
const FLAT_HALF = 1000;
/**
 * The dummies' grip on the ground he lands on (pad, the range's sand, road, ramps, terrain; Max rule, over his own low `SLIDE`, which still holds
 * on cars, glass and props): clothing or skin sliding on asphalt, not a toy skating on it (owner, 2026-10-18). A sand of 3 spun a forearm planted
 * under the whole dummy about its own length at 160 rad/s in one step, its edge 6–11 cm into the ground.
 */
const GROUND_GRIP = 0.6;

const _q = new THREE.Quaternion();
const _r = new THREE.Vector3();

/** A one-cell grid patch (a plane, a ramp's face): its four nodes are all there is to it. */
function oneCell(s: Surface, k: number): boolean {
  const qo = k * Q_STRIDE;
  return s.q[qo + Q_KIND] === GRID && s.q[qo + Q_NU] === 2 && s.q[qo + Q_NV] === 2;
}

/**
 * The solid of one-cell patch `k` of `s`: a level one is a slab 0.5 m thick under its top (a cuboid, at most `FLAT_HALF` out
 * from its middle: the pad; a cylinder where the patch is round: the fleet disc), a tilted one the prism from its face down to
 * 0.5 m under its lowest node (a ramp's wedge).
 */
function cellSolid(R: Rapier, s: Surface, k: number): ColliderDesc | null {
  const P = s.p;
  const o = k * P_STRIDE;
  const hs = s.nodes[k]!;
  const ox = P[o + P_OX]!;
  const oy = P[o + P_OY]!;
  const oz = P[o + P_OZ]!;
  const [ax, ay, az] = [P[o + P_AX]!, P[o + P_AX + 1]!, P[o + P_AX + 2]!];
  const [bx, by, bz] = [P[o + P_BX]!, P[o + P_BX + 1]!, P[o + P_BX + 2]!];
  const [cx, cy, cz] = [P[o + P_CX]!, P[o + P_CX + 1]!, P[o + P_CX + 2]!];
  const u0 = P[o + P_U0]!;
  const v0 = P[o + P_V0]!;
  const du = P[o + P_STEP]!;
  const dv = P[o + P_STEPV]!;
  const level = by === 1 && ay === 0 && cy === 0 && hs[1] === hs[0] && hs[2] === hs[0] && hs[3] === hs[0];
  if (level) {
    const top = oy + hs[0]!;
    const r2 = P[o + P_RAD2]!;
    if (r2 > 0) return R.ColliderDesc.cylinder(SLAB, Math.sqrt(r2)).setTranslation(ox, top - SLAB, oz).setFriction(0.9);
    const um = u0 + du / 2;
    const vm = v0 + dv / 2;
    _q.setFromAxisAngle(_r.set(0, 1, 0), Math.atan2(-az, ax));
    return R.ColliderDesc.cuboid(Math.min(Math.abs(du) / 2, FLAT_HALF), SLAB, Math.min(Math.abs(dv) / 2, FLAT_HALF))
      .setTranslation(ox + ax * um + cx * vm, top - SLAB, oz + az * um + cz * vm)
      .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
  }
  const pts: number[] = [];
  let low = Infinity;
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const u = u0 + i * du;
      const v = v0 + j * dv;
      const h = hs[j * 2 + i]!;
      const y = oy + ay * u + by * h + cy * v;
      low = Math.min(low, y);
      pts.push(ox + ax * u + bx * h + cx * v, y, oz + az * u + bz * h + cz * v);
    }
  }
  for (let m = 0; m < 4; m++) pts.push(pts[m * 3]!, low - SLAB, pts[m * 3 + 2]!);
  return R.ColliderDesc.convexHull(new Float32Array(pts))?.setFriction(0.9) ?? null;
}

/**
 * The ground under a throw at (`cx`, `cz`), `y` high: the active surface's own solids (`cellSolid` for its one-cell patches,
 * its `meshes`) and, where it has terrain (a multi-cell patch or a road deck), one heightfield patch of it `half` m to a side around the throw (its square, and the reach of the walls and solids built with it);
 * then the solids on it: the sandbox's standing `poles`, and on a `course` the road
 * walls, props, tunnels and decks near it. `groups`: the collision groups of the walls, poles and solids; the ground itself is
 * built twice (`floor`: `PROP_FLOOR_GROUPS`, `DOLL_FLOOR_GROUPS`).
 */
export function groundColliders(R: Rapier, world: World, groups: number, course: Course | null, poles: readonly Pole[], cx: number, cz: number, y: number, half: number): Collider[] {
  const ground = activeGround();
  const into: Collider[] = [];
  const place = (desc: ColliderDesc) => into.push(world.createCollider(desc.setCollisionGroups(groups)));
  const add = (desc: ColliderDesc, friction = 0.9) => place(desc.setFriction(friction));
  // A piece of ground twice: as it always was (0.9) for props, purses and boxes, and with `GROUND_GRIP` for the dummies alone.
  const floor = (desc: ColliderDesc) => {
    into.push(world.createCollider(desc.setFriction(0.9).setFrictionCombineRule(R.CoefficientCombineRule.Average).setCollisionGroups(PROP_FLOOR_GROUPS)));
    into.push(world.createCollider(desc.setFriction(GROUND_GRIP).setFrictionCombineRule(R.CoefficientCombineRule.Max).setCollisionGroups(DOLL_FLOOR_GROUPS)));
  };
  const n = Math.round((2 * half) / PATCH_CELL);
  const size = n * PATCH_CELL;
  let terrain = false;
  for (let k = 0; k < ground.count; k++) {
    // A scene's own prisms (the fleet's ramps and slab, the press plates) as the cars meet them, where they stand now.
    if (ground.q[k * Q_STRIDE + Q_KIND] === PRISM) {
      const desc = prismSolid(ground, k)?.make(R);
      if (desc) floor(desc);
      continue;
    }
    if (ground.q[k * Q_STRIDE + Q_SOLID] === 0) continue;
    if (!oneCell(ground, k)) {
      terrain = true;
      continue;
    }
    const desc = cellSolid(R, ground, k);
    if (desc) floor(desc);
  }
  for (const m of ground.meshes) floor(R.ColliderDesc.trimesh(m.vertices, m.indices));
  // A course's heightfield; a scene's own solids (the Lab's bench and floor, `setSolids`) carry its ground, edges sharp.
  if (terrain && course?.track !== null) {
    // Its vertices lie on the world's `PATCH_CELL` lattice, so every patch (any size, anywhere) has the same triangles where they
    // overlap, and what a body lands on does not hang on where its patch was centred.
    const x0 = Math.round((cx - size / 2) / PATCH_CELL) * PATCH_CELL;
    const z0 = Math.round((cz - size / 2) / PATCH_CELL) * PATCH_CELL;
    const heights = new Float32Array((n + 1) * (n + 1));
    for (let ix = 0; ix <= n; ix++) {
      for (let iz = 0; iz <= n; iz++) {
        // A bridge deck counts only for a throw at its height: under it the heightfield is the road.
        const h = ground.heightAt(x0 + ix * PATCH_CELL, z0 + iz * PATCH_CELL, y);
        // Rapier's heightfield: rows run along z, columns along x.
        heights[iz + ix * (n + 1)] = Number.isFinite(h) ? h : -40;
      }
    }
    // Its triangles' inner edges are fixed (`FIX_INTERNAL_EDGES`): a body sliding over the seam between two never catches on
    // it. Without, a crate slid flat at 11 m/s across the flat infield tipped 88° on a seam instead of sliding 7 m upright.
    floor(R.ColliderDesc.heightfield(n, n, heights, { x: size, y: 1, z: size }, R.HeightFieldFlags.FIX_INTERNAL_EDGES).setTranslation(x0 + size / 2, 0, z0 + size / 2));
  }
  // Off a course every solid is built; on one, those near it.
  const reach = course ? size / 2 : Infinity;
  for (const p of poles) {
    if (!p.intact || !p.group.visible) continue;
    add(R.ColliderDesc.cylinder(POLE_H / 2, p.radius).setTranslation(p.group.position.x, POLE_H / 2, p.group.position.z));
  }
  if (course) {
    for (const s of course.solids) {
      if (hypot2(s.x - cx, s.z - cz) > reach + s.r) continue;
      const desc = s.make(R);
      if (desc) add(desc);
    }
  }
  return into;
}
