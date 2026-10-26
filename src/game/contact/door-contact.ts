import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { DOOR_OPEN_MAX, HINGE_TEAR_J, MIRROR_BREAK_J, MIRROR_FOLD_MAX } from "../vehicle/car-core.ts";
import { CLASSES, carClass } from "../vehicle/vehicle-classes.ts";
import type { LidProfile } from "../vehicle/car-parts.ts";
import type { BodyStyle } from "../vehicle/car-variants.ts";
import { MIRROR_REACH } from "../vehicle/part-geometry.ts";
import { PANEL_BEND_NM, PANEL_FRAGILE_J, PANEL_FRAGILE_T, PANEL_PULL_J, PANEL_SLAM_J } from "../vehicle/car-wear.ts";
import { detAcos, detSin, detCos, hypot2 } from "../kernel/physics-core.js";
import type { ContactBox } from "./external-contact.ts";

/** The sideways kick (m/s) a broken mirror leaves with, away from its side of the car. */
const MIRROR_PUSH_X = 0.8;

/** The striker seen from the struck car on one side: the lane it sweeps and its run along the car. */
type Lane = {
  /** Travel along the car: +1 rear→front, −1 front→rear. */
  dir: 1 | -1;
  /** |x| of the striker's edge nearest the car, and its width outward (m). */
  inner: number;
  width: number;
  /** Bottom and top in the style's own frame (m above the car's ground, the class's lift taken off): the heights its doors, mirrors and panels are built at. */
  bottom: number;
  top: number;
  /** Leading face along car z (m) and the striker's length along its travel. */
  face: number;
  length: number;
  /** Speed along the travel relative to the car (m/s) and mass (kg). */
  u: number;
  kg: number;
};

type Door = BodyStyle["door"];

export const _lane: Lane = { dir: 1, inner: 0, width: 0, bottom: 0, top: 0, face: 0, length: 0, u: 0, kg: 0 };
const _push = new THREE.Vector3();
export const SIDES = [-1, 1] as const;
/** Striker ↔ door restitution. */
const DOOR_RESTITUTION = 0.2;

/** Result of the last `partContact` (reused, read it before the next call). */
export const partHit = {
  /** The striker met a door or a mirror. */
  touched: false,
  /** Speed the striker lost along its travel (m/s). */
  du: 0,
  /** World direction of that travel (unit, xz). */
  nx: 0,
  nz: 0,
};

/** The cap's trailing face's inboard reach from the base (m) on a mirror of `MIRROR_REACH`; a style's scales with its own `mirrorReach`. */
const CAP_INBOARD = 0.11;

/** How far along the run the mirror cap's trailing face has swung at fold `phi` (m, from the base): pinned where the lane's inner edge (`gap` out) crosses it, never inboard of the cap. */
function mirrorSweep(phi: number, gap: number, d: Door): number {
  const r = Math.max(gap / detCos(phi), CAP_INBOARD * (d.mirrorReach / MIRROR_REACH));
  return r * detSin(phi) - d.mirrorHalfDepth * detCos(phi);
}

/**
 * Mirror on a shut door: the face folds the cap about its base; at `MIRROR_FOLD_MAX` the stop holds the striker or, past
 * `MIRROR_BREAK_J`, snaps off. ponytail: shut doors only; an open door's mirror rides by the A-pillar, behind the slab.
 */
export function hitMirror(car: DeformableCar, side: -1 | 1, lane: Lane): void {
  if (car.partOff(side < 0 ? "mirrorL" : "mirrorR")) return;
  const door = car.doorHinge(side);
  if (door.theta > 1e-4) return;
  const d = car.style.door;
  if (lane.bottom > car.mirrorSpanY[1] || lane.top < car.mirrorSpanY[0]) return;
  const gap = lane.inner - car.mirrorBaseX;
  const s = lane.dir;
  // Face travel past the base along the run (the seat stands `mirrorZ` behind the hinge), against how far the cap's trailing face has swung.
  const reach = s * (lane.face - (d.hingeZ - (d.mirrorZ ?? 0)));
  const fold = Math.abs(door.mirrorFold);
  if (reach <= mirrorSweep(fold, gap, d) || gap / detCos(fold) > d.mirrorReach) return;
  if (reach - lane.length > d.mirrorReach) return;
  partHit.touched = true;
  // The cap's tip slides along the face and clears it at `clear`; short of the stop the striker passes there, however far a slice carried it.
  const clear = gap > 0 ? detAcos(gap / d.mirrorReach) : MIRROR_FOLD_MAX;
  const most = Math.min(clear, MIRROR_FOLD_MAX);
  if (reach <= mirrorSweep(most, gap, d)) {
    let lo = fold;
    let hi = most;
    for (let k = 0; k < 16; k++) {
      const mid = (lo + hi) * 0.5;
      if (mirrorSweep(mid, gap, d) < reach) lo = mid;
      else hi = mid;
    }
    car.setMirrorFold(side, -side * s * hi);
    return;
  }
  if (most < MIRROR_FOLD_MAX) {
    car.setMirrorFold(side, -side * s * Math.max(fold, most));
    return;
  }
  // Folded flat and still in the lane: the stop takes the striker.
  if (0.5 * lane.kg * lane.u * lane.u < MIRROR_BREAK_J) {
    car.setMirrorFold(side, -side * s * MIRROR_FOLD_MAX);
    lane.u = 0;
    return;
  }
  lane.u = Math.sqrt(lane.u * lane.u - (2 * MIRROR_BREAK_J) / lane.kg);
  car.breakMirror(side, _push.set(side * MIRROR_PUSH_X, 0.6, s * lane.u));
}

/** The point `radius` m along door `d`'s plan line from its hinge, the door open `theta` rad, in the car's frame: `across` outward from the car's middle, `along` forward (m). */
const doorPoint = { across: 0, along: 0 };

function doorPointAt(d: Door, radius: number, theta: number): typeof doorPoint {
  doorPoint.across = d.hingeX + radius * detSin(theta);
  doorPoint.along = d.hingeZ - radius * detCos(theta);
  return doorPoint;
}

/** Whether a body from `bottom` to `top` (m above the car's ground) reaches door `d`'s own heights. */
function doorInHeights(d: Door, bottom: number, top: number): boolean {
  return bottom <= d.hingeY + d.halfHeight && top >= d.hingeY - d.halfHeight;
}

/**
 * Door slab (top view: hinge → trailing edge) against the face. Free door: one restitution impulse through the door's effective
 * mass I/k² (k = lever across the travel). Door on its stop and pushed open: the strap takes the striker's closing energy.
 */
export function hitDoor(car: DeformableCar, side: -1 | 1, lane: Lane): void {
  if (car.partOff(side < 0 ? "doorL" : "doorR")) return;
  const d = car.style.door;
  if (!doorInHeights(d, lane.bottom, lane.top)) return;
  const door = car.doorHinge(side);
  const sin = detSin(door.theta);
  if (sin < 1e-3) return;
  const rLo = (lane.inner - d.hingeX) / sin;
  const rHi = Math.min(d.length, (lane.inner + lane.width - d.hingeX) / sin);
  if (rLo > rHi || rHi <= 0) return;
  const s = lane.dir;
  // A rear→front face meets the trailing (lowest-z) end of the slab in the lane first.
  const r = s > 0 ? rHi : Math.max(rLo, 0);
  const depth = s * (lane.face - doorPointAt(d, r, door.theta).along);
  if (depth <= 0 || depth > lane.length) return;
  partHit.touched = true;
  const k = Math.max(r * sin, 0.02);
  const closing = lane.u - s * k * door.omega;
  if (s > 0 && door.theta >= DOOR_OPEN_MAX - 1e-4) {
    if (closing <= 0) return;
    const before = door.load;
    const energy = 0.5 * lane.kg * closing * closing;
    // What the striker still carries after paying for the tear.
    const left = Math.sqrt(Math.max(0, lane.u * lane.u - (2 * Math.max(0, HINGE_TEAR_J - before)) / lane.kg));
    if (car.loadDoorStop(side, energy, _push.set(side * 0.9, 0.8, s * Math.max(left, 1)))) lane.u = left;
    else {
      lane.u = 0;
      door.omega = 0;
    }
    return;
  }
  if (closing > 0) {
    const mEff = door.spec.inertia / (k * k);
    const j = ((1 + DOOR_RESTITUTION) * closing) / (1 / lane.kg + 1 / mEff);
    lane.u -= j / lane.kg;
    door.omega += (s * j * k) / door.spec.inertia;
  }
  // Push the slab out of the face.
  door.theta = THREE.MathUtils.clamp(door.theta + (s * depth) / k, 0, DOOR_OPEN_MAX);
}

/**
 * A stretched quarter panel (top view: the sheet's chord from the hinge at the tail to its free end ahead, which leans outboard where the body
 * widens), the door slab's mirror image: rear→front pushes it back onto the body (it stays dented, `bendPanel`), front→rear pulls it out.
 * The striker pays `PANEL_BEND_NM` of plastic work over the angle moved, no rebound; one carrying more than the tear energy rips the panel off (`PANEL_FRAGILE_T`: at a nudge).
 */
export function hitPanel(car: DeformableCar, side: -1 | 1, lane: Lane): void {
  const p = car.quarterPanel(side);
  // `folding` is the sim's (`syncAttachedParts`); `open` is the drawn shell's, set by the frame's pose: gating on it made a car's panel hit depend on whether it was drawn.
  if (p.detached || !p.folding) return;
  const r = p.region!;
  if (lane.bottom > r.span[1] || lane.top < r.span[0]) return;
  const t = p.hingeT;
  const theta = r.peel * t;
  if (detSin(theta) < 1e-3) return;
  const chord = hypot2(r.lean, r.reach);
  const outboard = (r.lean * detCos(theta) + r.reach * detSin(theta)) / chord;
  if (outboard < 1e-3) return;
  const along = (r.reach * detCos(theta) - r.lean * detSin(theta)) / chord;
  const hx = Math.abs(r.pivot[0]);
  const rLo = (lane.inner - hx) / outboard;
  const rHi = Math.min(chord, (lane.inner + lane.width - hx) / outboard);
  if (rLo > rHi || rHi <= 0) return;
  const s = lane.dir;
  // A rear→front face meets the slab's rear-most (lowest-z) end in the lane first, a front→rear face its front-most.
  const at = s > 0 ? Math.max(rLo, 0) : rHi;
  const depth = s * (lane.face - (r.pivot[1] + at * along));
  if (depth <= 0 || depth > lane.length) return;
  partHit.touched = true;
  const limit = t >= PANEL_FRAGILE_T ? PANEL_FRAGILE_J : s > 0 ? PANEL_SLAM_J : PANEL_PULL_J;
  if (0.5 * lane.kg * lane.u * lane.u >= limit) {
    // What the striker still carries after paying for the tear.
    lane.u = Math.sqrt(Math.max(0, lane.u * lane.u - (2 * limit) / lane.kg));
    car.ripPanel(side, _push.set(side * 0.9, 0.6, s * Math.max(lane.u, 1)));
    return;
  }
  // Push the slab out of the face: back (s > 0: the angle falls) or out (s < 0: it rises).
  const k = Math.max(at * outboard, 0.02);
  car.bendPanel(side, t - (s * depth) / (k * r.peel));
  const moved = Math.abs(p.hingeT - t) * r.peel;
  // A panel that cannot go further (full hinge) holds the striker.
  lane.u = moved > 0 ? Math.sqrt(Math.max(0, lane.u * lane.u - (2 * PANEL_BEND_NM * moved) / lane.kg)) : 0;
}

const _lid: LidProfile = { hingeY: 0, hingeZ: 0, edgeY: 0, edgeZ: 0, halfWidth: 0 };

/**
 * The rearmost point (m along the car) of the trunk lid as it hangs now that a rear→front face, centred `lx` with half width `ex`, reaches (side
 * view: a line from its hinge to its free edge, `halfWidth` either side of the car's axis): the line within the face's heights. `Infinity` where the
 * face's width or heights miss the lid.
 */
function lidRearmost(car: DeformableCar, lane: Lane, lx: number, ex: number): number {
  const lid = car.lidProfile(_lid);
  if (Math.abs(lx) - ex >= lid.halfWidth) return Infinity;
  const rise = lid.edgeY - lid.hingeY;
  const level = Math.abs(rise) < 1e-6;
  if (level && (lid.hingeY < lane.bottom || lid.hingeY > lane.top)) return Infinity;
  const at = (y: number): number => (level ? 0 : (y - lid.hingeY) / rise);
  const t0 = Math.min(Math.max(Math.min(at(lane.bottom), at(lane.top)), 0), 1);
  const t1 = Math.min(Math.max(Math.max(at(lane.bottom), at(lane.top)), 0), 1);
  if (!level && t0 === t1) return Infinity;
  return Math.min(lid.hingeZ + t0 * (lid.edgeZ - lid.hingeZ), lid.hingeZ + t1 * (lid.edgeZ - lid.hingeZ));
}

/**
 * The trunk lid against a rear→front face: a lid hanging on its stop has its strap (a drop gate's cables) take the striker's closing energy, as a
 * door pushed past its stop does (`hitDoor`): past the hinge's tear energy the lid leaves and the striker goes on with what it still carries. A
 * shut lid is held by its latch, which a blow opens by crushing the tail at it (`LID_LATCH_CRUSH_M`: the striker shifts off the latch), not by
 * its own energy: a face at the lid's heights that has passed the tail and crushed it that far springs the latch (the lid swings open on its
 * struts); a lighter blow leaves the lid latched. A lid between (sprung, swinging) is no collider.
 */
export function hitLid(car: DeformableCar, lane: Lane, lx: number, ex: number): void {
  const onStop = car.lidHangsOnStop();
  if (lane.dir < 0 || !(onStop || car.lidHinge().latched) || car.lidOff()) return;
  const rearmost = lidRearmost(car, lane, lx, ex);
  if (rearmost === Infinity) return;
  const depth = lane.face - (onStop ? rearmost : Math.min(rearmost, car.cage.fields.planBox[2]!));
  if (depth <= 0) return;
  if (!onStop) {
    car.noteLidStruck();
    return;
  }
  if (depth > lane.length) return;
  partHit.touched = true;
  strikeLidStrap(car, lane, 0.5 * lane.kg * lane.u * lane.u);
}

/** The strap of a lid on its stop takes `energy` (J) of a blow; past the hinge's tear energy the lid leaves and the striker keeps what the tear did not cost. */
function strikeLidStrap(car: DeformableCar, lane: Lane, energy: number): void {
  const hinge = car.lidHinge();
  const left = Math.sqrt(Math.max(0, lane.u * lane.u - (2 * Math.max(0, hinge.spec.tearJ - hinge.load)) / lane.kg));
  lane.u = car.loadLidStop(energy, _push.set(0, 0.8, Math.max(left, 1))) ? left : 0;
}

/** Plan samples along a door, hinge to trailing edge, a fixed solid is asked about: dense enough that no thin solid (a lamp post) fits between two. */
const DOOR_SAMPLES = 8;
/** The door skin's reach (m) past its plan line, the angle step (rad) a door is walked shut by (a small step of trailing edge, so the walk cannot jump a thin solid) and the halvings that then find the angle it clears at. */
const DOOR_SKIN = 0.03;
const DOOR_STEP = 0.03;
const DOOR_HALVINGS = 6;
/** An open door narrower than this (rad) is a door shut. */
const DOOR_SHUT = 0.02;

/** Whether door `side`, open `angle` rad, has a point of its plan line inside the fixed solid `box` (its heights taken as read). */
function doorMeetsSolid(car: DeformableCar, side: -1 | 1, angle: number, box: ContactBox): boolean {
  const p = car.group.position;
  const d = car.style.door;
  const c = detCos(box.yaw);
  const n = detSin(box.yaw);
  for (let k = 1; k <= DOOR_SAMPLES; k++) {
    const point = doorPointAt(d, (d.length * k) / DOOR_SAMPLES, angle);
    const lx = side * point.across;
    const dx = p.x + car.rightFlat.x * lx + car.fwdFlat.x * point.along - box.x;
    const dz = p.z + car.rightFlat.z * lx + car.fwdFlat.z * point.along - box.z;
    const meets = box.round ? dx * dx + dz * dz < (box.hx + DOOR_SKIN) * (box.hx + DOOR_SKIN) : Math.abs(dx * c - dz * n) < box.hx + DOOR_SKIN && Math.abs(dx * n + dz * c) < box.hz + DOOR_SKIN;
    if (meets) return true;
  }
  return false;
}

/** The angle (rad) door `side`, open `angle`, clears the fixed solid `box` at: walked shut by `DOOR_STEP`, then halved to the edge; 0 when even shut it meets the solid. */
function angleClearingSolid(car: DeformableCar, side: -1 | 1, angle: number, box: ContactBox): number {
  let hi = angle;
  let lo = angle - DOOR_STEP;
  while (lo > 0 && doorMeetsSolid(car, side, lo, box)) {
    hi = lo;
    lo -= DOOR_STEP;
  }
  lo = Math.max(lo, 0);
  if (lo === 0 && doorMeetsSolid(car, side, 0, box)) return 0;
  for (let k = 0; k < DOOR_HALVINGS; k++) {
    const mid = (lo + hi) / 2;
    if (doorMeetsSolid(car, side, mid, box)) hi = mid;
    else lo = mid;
  }
  return lo;
}

/**
 * The car's open doors against a fixed solid over a slice of `dt` s, beyond the body's footprint: a door stands out past the tyres
 * and is shut just far enough to clear the solid (`shutDoor`) at the closing rate that took; a jammed or over-slammed door tears off.
 * A door the solid stands against even shut is the body's to hold.
 */
export function shutDoorsOnSolid(car: DeformableCar, box: ContactBox, dt: number): void {
  const groundY = car.group.position.y + CLASSES[carClass(car)].lift;
  if (!doorInHeights(car.style.door, box.y - box.hy - groundY, box.y + box.hy - groundY)) return;
  for (let q = 0; q < SIDES.length; q++) {
    const side = SIDES[q]!;
    const angle = car.doorAngle(side);
    if (angle < DOOR_SHUT || !doorMeetsSolid(car, side, angle, box)) continue;
    const clearing = angleClearingSolid(car, side, angle, box);
    car.shutDoor(side, clearing, (angle - clearing) / dt);
    partHit.touched = true;
  }
}
