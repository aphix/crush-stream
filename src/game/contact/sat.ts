import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { SAMPLE, sampleAt, type CageFields, type CageStyle } from "../vehicle/car-cage.ts";
import { cageLift } from "../vehicle/car-cage-rig.ts";
import { PLATFORM_HALF } from "../vehicle/car-rig.ts";
import { hypot2 } from "../deform/physics-util.ts";
import { detSin, detCos } from "../kernel/physics-core.js";
import { FINE_HZ } from "../kernel/constants.ts";
import { OUTLINE_REACH, outlineOf, VERTICAL_CLEAR, type CageOutline } from "./cage-outline.ts";
import { activeGround } from "../world/ground.ts";

export const BARRIER_HALF = { x: 0.38, z: 1.96 };
/** The slab's top (m): `makeJerseyBarrier`'s profile peak. A car whose every mass clears it flies over (a ramp jump). */
export const BARRIER_TOP = 0.81;
export const BARRIER_MASS = 14000;

const _bRight = new THREE.Vector3();
const _bFwd = new THREE.Vector3();
/** `deepestIn`'s band of the other cage around a node: lowest and highest height. */
const _band = new Float64Array(2);
/** A pair's contact normal this near square to its centre line (cosine, 0.3 = 17° off square) is turned to it (`satCars`). */
const PERPENDICULAR = 0.3;

/** Max displacement per physics slice so a 30 m/s car cannot skip a 0.76 m wall; never shorter than `floor` (s, the fine floor unless the pacer is shedding load). */
export function physicsSlice(dt: number, vmax: number, floor = 1 / FINE_HZ): number {
  const maxMove = 0.07;
  const cap = maxMove / Math.max(vmax, 4);
  return Math.min(dt, Math.max(floor, cap));
}

/** Fastest car this frame; `physicsSlice` sizes the sub-steps from it. A wreck's `speed` is the
 *  last driven value, so read the velocity followGroup measured from its masses. */
export function sliceSpeed(cars: readonly DeformableCar[]): number {
  let vmax = 8;
  for (let i = 0; i < cars.length; i++) vmax = Math.max(vmax, hypot2(cars[i]!.velocity.x, cars[i]!.velocity.z));
  return vmax;
}

/**
 * The clip's keeps on the platform (m from the car's origin): its nose (2.05) and its cabin's side (1.08), each carried by this car's
 * own box over the platform's (`PLATFORM_HALF`). On the platform's alone, a shorter coupe sliding sideways at 24 m/s was clipped to a
 * stop 2 cm short of the slab, its body never touching it and no hit armed (`strikeCar`).
 */
const NOSE_KEEP = 2.05;
const CABIN_KEEP = 1.08;

/** A lifted car whose origin stands this close (m) to the ground under it is on its wheels: its frame, axles and wheels, which the cage does not draw, reach from its body down to that ground. */
const STANDS_WITHIN = 0.3;

/** Keep the cabin from crossing the jersey face. leftover=1 → bumper still on the face. */
export function clipCarToBarrier(
  car: DeformableCar,
  yaw: number,
  origin: THREE.Vector3,
  hx: number,
  leftover: number,
): boolean {
  car.refreshBasis();
  _bRight.set(detCos(yaw), 0, -detSin(yaw));
  _bFwd.set(detSin(yaw), 0, detCos(yaw));
  const px = car.group.position.x - origin.x;
  const pz = car.group.position.z - origin.z;
  const lx = px * _bRight.x + pz * _bRight.z;
  const lz = px * _bFwd.x + pz * _bFwd.z;
  const alongFwd = Math.abs(car.fwdFlat.x * _bRight.x + car.fwdFlat.z * _bRight.z) * (NOSE_KEEP + (car.frame.half.z - PLATFORM_HALF.z));
  const bumperKeep = hx + 0.22 + alongFwd * 0.85 * leftover;
  const cabinKeep = hx + CABIN_KEEP + (car.frame.half.x - PLATFORM_HALF.x);
  const minLx = THREE.MathUtils.lerp(cabinKeep, bumperKeep, leftover);
  if (Math.abs(lz) > BARRIER_HALF.z + 1.1) return false;
  // Face from position — a rebound vel flip must not drag the car through the slab.
  const side = lx >= 0 ? 1 : -1;
  if (lx * side >= minLx) return false;
  const extra = minLx - lx * side;
  const push = Math.min(extra, 0.16);
  car.group.position.x += _bRight.x * side * push;
  car.group.position.z += _bRight.z * side * push;
  car.refreshBasis();
  const vn = car.velocity.x * _bRight.x * side + car.velocity.z * _bRight.z * side;
  if (car.deform.massActive) {
    car.deform.separateAlong(_bRight.x * side, 0, _bRight.z * side, push);
    if (vn < 0) car.deform.kickCore(_bRight.x * side, 0, _bRight.z * side, -vn);
  }
  if (vn < 0) {
    car.velocity.x -= _bRight.x * side * vn;
    car.velocity.z -= _bRight.z * side * vn;
  }
  return true;
}

/**
 * Per direction of `deepestIn`, sums over the overlap patch, each node weighted by its depth: the weight, the place in the world (x, z,
 * then height), and the container's outline normal (x, z) in its frame there.
 */
const F_W = 0;
const F_X = 1;
const F_Z = 2;
const F_Y = 3;
const F_NX = 4;
const F_NZ = 5;
const F_BEST = 6;
const _inA = new Float64Array(7);
const _inB = new Float64Array(7);
const _grad = new Float64Array(2);

/** `a`'s frame into `b`'s, both full poses (`frameInto`): per axis of `b` (x, y, z), its offset and its x, y, z coefficients on a point of `a`'s. */
const _ab = new Float64Array(12);

/** `_ab` ← `a`'s frame (world matrix elements `ea`) into `b`'s (`eb`): the groups are rotations and translations, so `b`'s inverse is its transpose. */
function frameInto(ea: readonly number[], eb: readonly number[]): void {
  const ox = ea[12]! - eb[12]!;
  const oy = ea[13]! - eb[13]!;
  const oz = ea[14]! - eb[14]!;
  for (let o = 0; o < 12; o += 4) {
    const ux = eb[o]!;
    const uy = eb[o + 1]!;
    const uz = eb[o + 2]!;
    _ab[o] = ux * ox + uy * oy + uz * oz;
    _ab[o + 1] = ux * ea[0]! + uy * ea[1]! + uz * ea[2]!;
    _ab[o + 2] = ux * ea[4]! + uy * ea[5]! + uz * ea[6]!;
    _ab[o + 3] = ux * ea[8]! + uy * ea[9]! + uz * ea[10]!;
  }
}

/**
 * `deepestIn`'s numbers for `boxMissed`, `meet` and `meetAt` (a double passed across a call V8 does not inline is a heap number): `b`'s
 * plan box `reach` out (x min, x max, z min, z max), `a`'s height range (class lift on), `reach`, `b`'s class lift, and the node `meet`
 * places: its frame x and z, the height up `a` it stands at, its band's low and high up `b`, how far short of the box and plan it may
 * be, the height up `b` of its frame's zero height, and the height up `b` `meetAt` places it at.
 */
const _in = new Float64Array(17);
const I_LOW = 4;
const I_HIGH = 5;
const I_REACH = 6;
const I_LIFT_B = 7;
const I_X = 8;
const I_Z = 9;
const I_Y = 10;
const I_A_LOW = 11;
const I_A_HIGH = 12;
const I_MARGIN = 13;
const I_YC = 14;
const I_AT = 15;
const I_HANG = 16;
/** What the last `meet` found: the node's depth in `b`'s plan, its place (x, z) in `b`'s frame, the heights the two bodies share there in `b`'s frame (the node's own where `b` has no band), whether `b` has one there (1), the heights `b` stands at there, and whether those are its own column's (1) or its band's. */
const _meet = new Float64Array(9);
const M_DEPTH = 0;
const M_X = 1;
const M_Z = 2;
const M_LOW = 3;
const M_HIGH = 4;
const M_BANDED = 5;
const M_STAND_LOW = 6;
const M_STAND_HIGH = 7;
const M_COLUMN = 8;
/** `_meet` of the end of a slanted band `deepestIn` placed first, while it places the other. */
const _deeper = new Float64Array(9);
/** `_meet` of an end first placed past its cell's column, while `endAt` places it again at that column's end. */
const _again = new Float64Array(9);
/** How far (m) inside the heights two bands share their ends are sampled: on an end itself, whether the cell it lands in holds it is rounding. */
const BAND_INSET = VERTICAL_CLEAR / 4;
/** An end's own cell's end this close (m) to where the end was placed is the same place: no second placement. */
const END_MOVED = 1e-4;

/**
 * Whether every node of `outline` at a height in `a`'s range, placed in `b`'s frame by `_ab`, misses `b`'s box. A node's own sum adds
 * the same terms in the same order as these bounds, each monotone in its coordinate (and so is its rounding), so it never lies beyond.
 */
function boxMissed(outline: CageOutline): boolean {
  const yLo = _in[I_LOW]!;
  const yHi = _in[I_HIGH]!;
  for (let o = 0; o <= 8; o += 8) {
    const kx = _ab[o + 1]!;
    const ky = _ab[o + 2]!;
    const kz = _ab[o + 3]!;
    const least = _ab[o]! + Math.min(kx * outline.xLo, kx * outline.xHi) + Math.min(ky * yLo, ky * yHi) + Math.min(kz * outline.zLo, kz * outline.zHi);
    const most = _ab[o]! + Math.max(kx * outline.xLo, kx * outline.xHi) + Math.max(ky * yLo, ky * yHi) + Math.max(kz * outline.zLo, kz * outline.zHi);
    const m = o >> 2;
    if (most < _in[m]! || least > _in[m + 1]!) return true;
  }
  return false;
}

/**
 * `_meet` ← the node in `_in` placed in `b`'s frame (`_ab`): its depth in `b`'s plan (-Infinity off the box with the margin more, or the
 * margin or more short of the plan), the heights the two bodies share there, and the heights `b` stands at there: its own column on a
 * covered node taller than `VERTICAL_CLEAR`, else its band (an outline node's own column is a sliver of the body's edge).
 */
function meet(plan: Float32Array, style: CageStyle, outlineB: CageOutline, fields: CageFields): void {
  const x = _in[I_X]!;
  const y = _in[I_Y]!;
  const z = _in[I_Z]!;
  const margin = _in[I_MARGIN]!;
  const bx = _ab[0]! + _ab[1]! * x + _ab[2]! * y + _ab[3]! * z;
  const bz = _ab[8]! + _ab[9]! * x + _ab[10]! * y + _ab[11]! * z;
  _meet[M_DEPTH] = -Infinity;
  _meet[M_X] = bx;
  _meet[M_Z] = bz;
  if (bx < _in[0]! - margin || bx > _in[1]! + margin || bz < _in[2]! - margin || bz > _in[3]! + margin) return;
  SAMPLE[0] = bx;
  SAMPLE[1] = bz;
  sampleAt(plan, style);
  _meet[M_DEPTH] = _in[I_REACH]! - SAMPLE[2]!;
  if (!(_meet[M_DEPTH]! > -margin)) return;
  const i = Math.round((bx - style.u0) / style.step) | 0;
  const j = Math.round((bz - style.v0) / style.step) | 0;
  outlineB.band(i, j, _band);
  const lift = _in[I_LIFT_B]!;
  // A node of a car standing wholly under the heights of a lifted body that stands on its wheels meets it at its own heights.
  const bridged = _in[I_HANG]! > 0 && _in[I_A_HIGH]! >= 0 && _band[0]! + lift > _in[I_A_HIGH]!;
  const banded = _band[0]! <= _band[1]! && !bridged;
  _meet[M_BANDED] = banded ? 1 : 0;
  _meet[M_LOW] = banded ? Math.max(_in[I_A_LOW]!, _band[0]! + lift) : _in[I_A_LOW]!;
  _meet[M_HIGH] = banded ? Math.min(_in[I_A_HIGH]!, _band[1]! + lift) : _in[I_A_HIGH]!;
  const k = j * style.nu + i;
  const column = i >= 0 && j >= 0 && i < style.nu && j < style.nv && fields.covered[k] !== 0 && fields.top[k]! - fields.bottom[k]! > VERTICAL_CLEAR;
  _meet[M_COLUMN] = column ? 1 : 0;
  _meet[M_STAND_LOW] = column ? fields.bottom[k]! + lift : banded ? _band[0]! + lift : _in[I_A_LOW]!;
  _meet[M_STAND_HIGH] = column ? fields.top[k]! + lift : banded ? _band[1]! + lift : _in[I_A_HIGH]!;
}

/** `_meet` ← the node in `_in` placed `_in[I_AT]` up `b`; its depth -Infinity unless the two bands share more than `VERTICAL_CLEAR` where it lands and `b` stands at that height there. */
function meetAt(plan: Float32Array, style: CageStyle, outlineB: CageOutline, fields: CageFields): void {
  const at = _in[I_AT]!;
  _in[I_Y] = (at - _in[I_YC]!) / _ab[6]!;
  meet(plan, style, outlineB, fields);
  if (_meet[M_BANDED] === 1 && (_meet[M_HIGH]! - _meet[M_LOW]! <= VERTICAL_CLEAR || at < _meet[M_STAND_LOW]! || at > _meet[M_STAND_HIGH]!)) _meet[M_DEPTH] = -Infinity;
}

/**
 * `_meet` ← the deeper of the node in `_in` placed at either end (`BAND_INSET` inside) of the heights where its band and `b`'s body
 * meet where `meet` last placed it: `b`'s standing heights there, or the bands' shared heights where those leave too little.
 */
function deeperEnd(plan: Float32Array, style: CageStyle, outlineB: CageOutline, fields: CageFields): void {
  let low = Math.max(_in[I_A_LOW]!, _meet[M_STAND_LOW]!);
  let high = Math.min(_in[I_A_HIGH]!, _meet[M_STAND_HIGH]!);
  if (high - low <= 2 * BAND_INSET) {
    low = _meet[M_LOW]!;
    high = _meet[M_HIGH]!;
  }
  if (high - low <= 2 * BAND_INSET) return;
  _in[I_MARGIN] = 0;
  endAt(low + BAND_INSET, -1, plan, style, outlineB, fields);
  _deeper.set(_meet);
  endAt(high - BAND_INSET, 1, plan, style, outlineB, fields);
  if (_deeper[M_DEPTH]! > _meet[M_DEPTH]!) _meet.set(_deeper);
}

/**
 * `_meet` ← the node in `_in` placed `at` up `b` (`meetAt`); when that lands it in a cell whose own column stands short of `at` along
 * `dir` (+1 up, -1 down), placed again at that column's end (`BAND_INSET` inside, within its own band), the deeper of the two. The
 * middle's cell bounds the first placement, and a slanted band's end lands in another: a cop's hood under a 27° monster's tail stood
 * 1.7 cm lower in the end's cell than in the middle's, the end placed under the middle's top stood over it, and the pair read 0.10 m
 * shallow (0.408 m against the cages' 0.512). A band's heights (an outline's sliver, `meet`) are no column to place an end at. Only where
 * the end's column shares more than the two insets of the node's own band (as `deeperEnd` asks of the middle's): a raised monster
 * tail's band (1.044-1.653 m) over a cop's column topped at 1.042 m was placed at 1.029, under its own bottom, and read 0.30-0.80 m deep
 * where the cages stand apart (1 m up, 3.3 m back).
 */
function endAt(at: number, dir: number, plan: Float32Array, style: CageStyle, outlineB: CageOutline, fields: CageFields): void {
  _in[I_AT] = at;
  meetAt(plan, style, outlineB, fields);
  const stand = dir > 0 ? _meet[M_STAND_HIGH]! : _meet[M_STAND_LOW]!;
  if (_meet[M_COLUMN] !== 1 || !((at - stand) * dir > 0)) return;
  const low = Math.max(_in[I_A_LOW]!, _meet[M_STAND_LOW]!);
  const high = Math.min(_in[I_A_HIGH]!, _meet[M_STAND_HIGH]!);
  if (high - low <= 2 * BAND_INSET) return;
  const end = dir > 0 ? high - BAND_INSET : low + BAND_INSET;
  if ((at - end) * dir <= END_MOVED) return;
  _again.set(_meet);
  _in[I_AT] = end;
  meetAt(plan, style, outlineB, fields);
  if (_again[M_DEPTH]! > _meet[M_DEPTH]!) _meet.set(_again);
}

/** Whether lifted car `b`'s origin stands within `STANDS_WITHIN` of the ground under it. */
function standsOnWheels(b: DeformableCar): boolean {
  const e = b.group.matrixWorld.elements;
  return e[13]! - activeGround().heightAt(e[12]!, e[14]!, e[13]!) <= STANDS_WITHIN;
}

/**
 * How deep (m) the nodes of `a`'s plan outline reach into `b`'s plan (the signed distance field, the outline half a step further out
 * than its node, and `look` further: the travel the pair's closing carries it in the slice, so a contact whose crush keeps its faces
 * apart by that travel stays one), counting only nodes where the two bodies' heights overlap by more than `VERTICAL_CLEAR` there; 0
 * when none does. A node is placed through both cars' full poses (a car pitched 27° overhangs its level plan by up to 0.45 m at a
 * raised end). Its band is slanted in `b`'s frame and both cars are rigid in the slice, so its depth is linear in height: placed at its
 * middle, then at both ends of where it meets `b`'s body there, the deeper counts (`deeperEnd`; at a middle, a pitched cage read up to
 * 0.14 m shallow, and a raised tail's band met a cab's roof beside the hood it stood over).
 * That depth goes to `found[F_BEST]`; every such node also adds to `found`'s sums with its depth as weight: the overlap patch's centre
 * and outward normal (b's outline) in `b`'s frame, and its height in the world (`addToPatch`). Both cars' world matrices are fresh.
 */
function deepestIn(a: DeformableCar, b: DeformableCar, found: Float64Array, look: number): void {
  const outline = outlineOf(a);
  const outlineB = outlineOf(b);
  const style = b.cage.style;
  const reach = OUTLINE_REACH + look;
  const liftA = cageLift(a);
  // The field's zero stands OUTLINE_REACH out from the outermost outline node, which the drawn triangles' box does not reach: a node there reads a depth at once, not one that grows from nothing.
  const bound = OUTLINE_REACH + reach;
  _in[0] = outlineB.xLo - bound;
  _in[1] = outlineB.xHi + bound;
  _in[2] = outlineB.zLo - bound;
  _in[3] = outlineB.zHi + bound;
  _in[I_LOW] = outline.low + liftA;
  _in[I_HIGH] = outline.high + liftA;
  _in[I_REACH] = reach;
  _in[I_HANG] = standsOnWheels(b) ? cageLift(b) : 0;
  _in[I_LIFT_B] = cageLift(b);
  const eb = b.group.matrixWorld.elements;
  frameInto(a.group.matrixWorld.elements, eb);
  found.fill(0);
  if (boxMissed(outline)) return;
  const plan = b.cage.planField();
  const fields = b.cage.fields;
  const ty = _ab[4]!, kyx = _ab[5]!, kyy = _ab[6]!, kyz = _ab[7]!;
  const sweep = Math.abs(_ab[2]!) + Math.abs(_ab[10]!);
  let best = 0;
  for (let n = 0; n < outline.count; n++) {
    const yl = outline.lows[n]! + liftA;
    const yh = outline.highs[n]! + liftA;
    const yc = ty + kyx * outline.xs[n]! + kyz * outline.zs[n]!;
    _in[I_X] = outline.xs[n]!;
    _in[I_Z] = outline.zs[n]!;
    _in[I_Y] = (yl + yh) * 0.5;
    _in[I_A_LOW] = Math.min(yc + kyy * yl, yc + kyy * yh);
    _in[I_A_HIGH] = Math.max(yc + kyy * yl, yc + kyy * yh);
    // How far the band's ends stand from its middle in `b`'s plan: no farther does the node move where the heights meet.
    const slant = 0.5 * (yh - yl) * sweep;
    _in[I_MARGIN] = slant;
    meet(plan, style, outlineB, fields);
    if (!(_meet[M_DEPTH]! > -slant)) continue;
    if (slant > 0 && Math.abs(kyy) > 1e-6 && _meet[M_BANDED] === 1) {
      _in[I_YC] = yc;
      deeperEnd(plan, style, outlineB, fields);
    }
    const depth = _meet[M_DEPTH]!;
    if (!(depth > 0) || (_meet[M_BANDED] === 1 && _meet[M_HIGH]! - _meet[M_LOW]! <= VERTICAL_CLEAR)) continue;
    if (depth > best) best = depth;
    addToPatch(found, eb, plan, style);
  }
  found[F_BEST] = best;
}

/** `found`'s sums take the node `meet` placed, weighted by its depth: its place in the world at the middle of the heights shared there (`eb`: the container's, `b`'s, world matrix), and the outline normal there. */
function addToPatch(found: Float64Array, eb: readonly number[], plan: Float32Array, style: CageStyle): void {
  const depth = _meet[M_DEPTH]!;
  const bx = _meet[M_X]!;
  const by = (_meet[M_LOW]! + _meet[M_HIGH]!) * 0.5;
  const bz = _meet[M_Z]!;
  SAMPLE[0] = bx;
  SAMPLE[1] = bz;
  outlineNormal(plan, style);
  found[F_W] += depth;
  found[F_X] += depth * (eb[12]! + eb[0]! * bx + eb[4]! * by + eb[8]! * bz);
  found[F_Z] += depth * (eb[14]! + eb[2]! * bx + eb[6]! * by + eb[10]! * bz);
  found[F_Y] += depth * (eb[13]! + eb[1]! * bx + eb[5]! * by + eb[9]! * bz);
  found[F_NX] += depth * _grad[0]!;
  found[F_NZ] += depth * _grad[1]!;
}

/** `_grad` ← the unit direction in which `plan` (a cage's plan distance field) grows fastest at frame (x, z): out of the outline; zero where it has none. */
function outlineNormal(plan: Float32Array, style: CageStyle): void {
  const h = style.step;
  const x = SAMPLE[0]!;
  const z = SAMPLE[1]!;
  SAMPLE[0] = x + h;
  sampleAt(plan, style);
  const xp = SAMPLE[2]!;
  SAMPLE[0] = x - h;
  sampleAt(plan, style);
  const gx = xp - SAMPLE[2]!;
  SAMPLE[0] = x;
  SAMPLE[1] = z + h;
  sampleAt(plan, style);
  const zp = SAMPLE[2]!;
  SAMPLE[1] = z - h;
  sampleAt(plan, style);
  const gz = zp - SAMPLE[2]!;
  const len = hypot2(gx, gz);
  _grad[0] = len > 1e-9 ? gx / len : 0;
  _grad[1] = len > 1e-9 ? gz / len : 0;
}

/**
 * Whether two cars' drawn bodies overlap in the plan, where their heights meet (the cage's top and bottom at each outline node; a
 * car over another or on its roof never does), or come within `look` m of it (the travel the pair closes in the slice: a crush that
 * takes the faces back as fast as the cars close keeps them apart by it, and the contact does not end where the crush keeps up).
 * Returns the depth (m) of the deeper side, negative for the gap while only within `look`, or null. The contact is the overlap patch
 * itself, both ways: `contactOut` is the depth-weighted centre of every covered outline node of either cage (the point the contact's
 * pressure acts at), `normalOut` the depth-weighted mean of the outline normals there, pointing b → a (turned to the side of the
 * centres where the two cross). Neither car's list order nor one corner node picks them. The cages are as of the last slice's sync.
 */
export function satCars(a: DeformableCar, b: DeformableCar, normalOut: THREE.Vector3, contactOut: THREE.Vector3, look = 0): number | null {
  const pa = a.group.position;
  const pb = b.group.position;
  const dx = pb.x - pa.x;
  const dz = pb.z - pa.z;
  if (dx * dx + dz * dz > 36) return null;

  a.refreshBasis();
  b.refreshBasis();
  deepestIn(a, b, _inA, look);
  deepestIn(b, a, _inB, look);
  const depthA = _inA[F_BEST]!;
  const depthB = _inB[F_BEST]!;
  if (depthA <= 0 && depthB <= 0) return null;

  // A's nodes inside B: B's frame, B's outline normal points out of B (b → a). B's nodes inside A: A's frame, A's normal points a → b.
  const wA = _inA[F_W]!;
  const wB = _inB[F_W]!;
  const w = wA + wB;
  const rb = b.rightFlat, fb = b.fwdFlat, ra = a.rightFlat, fa = a.fwdFlat;
  let nx = rb.x * _inA[F_NX]! + fb.x * _inA[F_NZ]! - (ra.x * _inB[F_NX]! + fa.x * _inB[F_NZ]!);
  let nz = rb.z * _inA[F_NX]! + fb.z * _inA[F_NZ]! - (ra.z * _inB[F_NX]! + fa.z * _inB[F_NZ]!);
  const nLen = hypot2(nx, nz);
  if (nLen > 1e-9) {
    nx /= nLen;
    nz /= nLen;
  } else {
    nx = 0;
    nz = 0;
  }
  const apart = nx * -dx + nz * -dz;
  const centres = hypot2(dx, dz);
  if (Math.abs(apart) < PERPENDICULAR * centres) {
    // A normal within 17° of square to the centre line has no side to turn to: two wrecks interlocked past the outline's reach (gradients in the deep overlap point either way) flipped it with a few mm of centre offset, and their push-out moved them 6 mm a slice, to and fro, for as long as the pile lay. The centre line is the one direction that parts them.
    nx = -dx / centres;
    nz = -dz / centres;
  } else if (apart < 0) {
    nx = -nx;
    nz = -nz;
  }
  if (nx === 0 && nz === 0) {
    const len = hypot2(dx, dz) || 1;
    nx = -dx / len;
    nz = -dz / len;
  }
  normalOut.x = nx;
  normalOut.y = 0;
  normalOut.z = nz;
  contactOut.x = (_inA[F_X]! + _inB[F_X]!) / w;
  contactOut.y = (_inA[F_Y]! + _inB[F_Y]!) / w;
  contactOut.z = (_inA[F_Z]! + _inB[F_Z]!) / w;
  return Math.max(depthA, depthB) - look;
}
