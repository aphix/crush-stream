import * as THREE from "three";
import { applyGroundFriction } from "../deform/physics-util.ts";
import { GRAVITY } from "../kernel/constants.ts";
import { detAsin, detCos, detSin } from "../kernel/physics-core.js";
import { NO_FLOOR } from "../world/ground.ts";
import { C_DEPTH, C_GRIP, C_H, C_NX, C_NZ, clearOf, HIT_SIZE, holdTops, pointContact, PQ_SIZE, PQ_VX, PQ_VY, PQ_VZ, PQ_X, PQ_Y, PQ_Z, stirNear, type StirCar } from "../world/surfaces.ts";
import { body, centreOfMass, moveBody, placeBody, standAtCentre, bindBody, type TopMet } from "./car-air-body.ts";
import { loadShape, readPoints } from "./car-air-points.ts";
import { openRows, solveRows } from "./car-air.ts";
import { DENT_MIN_DV, recordDent, type DentState } from "./loose-dent.ts";
import type { DetachPart, LooseBody, LooseShape, LooseWheel } from "./car-core.ts";

const _c = new THREE.Vector3();
const _dv = new THREE.Vector3();
const _v0 = new THREE.Vector3();
const _q = new Float64Array(PQ_SIZE);
const _hit = new Float64Array(HIT_SIZE);

/** Height above its rest (m) at which a free body still slides on what is under it. */
const GROUND_BAND = 0.005;
/** A point `landOn` asks the far answer of (`pointContact`: height alone) rests at least this far above its floor, twice the band so the far test's rounding never meets the band's edge, where `landOn` reads the surface's grip. */
const FAR_GAP = 2 * GROUND_BAND;
/** `pointContact`'s `travel2` for a caller that reads no normal of a point the far answer covers. */
const NO_NORMAL = -1;
/** Share of a free body's fall speed it bounces back up with off what it lands on. */
const LAND_BOUNCE = 0.28;
/** Share of a free body's spin that is left after a second in the air: its spin dies as it always did. */
const SPIN_KEPT_PER_S = 0.72;
/** A box's corners, the first of its points: a box flying free asks them alone until one touches. */
const BOX_CORNERS = 8;
/** The speed (m/s, rad/s) under which a part on two points or more is at rest: twice the pull of gravity over 1/120 s, the number it was tuned at, which is still 1.5 times what the pacer's coarsest slice (1/90 s) lets gravity add (`GRAVITY / 90`). A slice's own `dt` here put a slide's stop at 0.16 m/s in a 1/120 s slice and 0.053 in a 1/360 s one, so the distance a part slid depended on how the world cut the step. */
const REST_SPEED = (2 * GRAVITY) / 120;
/** How long (s) a part rests on two points before it sleeps (on three it sleeps at once): a bumper across two wreck tops holds there, where one rocking through still moves on (a slab tipping off two posts from 0.01 rad/s passes rest speed 0.8 s in). */
const TWO_POINT_REST_S = 1;
/** The longest (s) a part just torn off a car, or a wheel just popped from its hub, may sit in its own car's hull without meeting it: of 20 tears (all styles, parked and at 20 m/s) the parts that fly clear leave it within 1 s; one still in it then is put out. */
export const SEAT_S = 1;

/**
 * A free point (an FX bit: a spark, a glass dot, a metal chip) meets what is under it and beside it by the one point query
 * (`pointContact`: the ground, the prisms of the scene and the cars' tops, car `skip`'s left out; -1: none). A side it is in
 * parts it (out by its depth and its radius `floor`, its inbound speed along the face gone); under it, it rests `floor` m over the surface,
 * bounces off it and, within `GROUND_BAND` of its rest, slides at Coulomb `mu` times the surface's grip. Returns its height over that
 * surface (Infinity where there is none: past the fleet disc's rim it falls on).
 */
export function landOn(pos: THREE.Vector3, vel: THREE.Vector3, floor: number, mu: number, dt: number, skip: number): number {
  _q[PQ_X] = pos.x;
  _q[PQ_Y] = pos.y;
  _q[PQ_Z] = pos.z;
  _q[PQ_VX] = vel.x;
  _q[PQ_VY] = vel.y;
  _q[PQ_VZ] = vel.z;
  pointContact(_q, skip, _hit, NO_NORMAL, floor + FAR_GAP);
  if (_hit[C_H] === NO_FLOOR && _hit[C_DEPTH]! > 0) {
    const nx = _hit[C_NX]!;
    const nz = _hit[C_NZ]!;
    const out = _hit[C_DEPTH]! + floor;
    pos.x += nx * out;
    pos.z += nz * out;
    const inbound = vel.x * nx + vel.z * nz;
    if (inbound < 0) {
      vel.x -= inbound * nx;
      vel.z -= inbound * nz;
    }
    _q[PQ_X] = pos.x;
    _q[PQ_Z] = pos.z;
    pointContact(_q, skip, _hit, NO_NORMAL, floor + FAR_GAP);
  }
  const ground = _hit[C_H]!;
  if (ground === NO_FLOOR) return Infinity;
  const rest = ground + floor;
  if (pos.y < rest) {
    pos.y = rest;
    if (vel.y < 0) vel.y *= -LAND_BOUNCE;
  }
  if (pos.y <= rest + GROUND_BAND) applyGroundFriction(vel, dt, mu * _hit[C_GRIP]!, true);
  return pos.y - ground;
}

/** The body's own points, as many as its shape can hold: a box's eight corners and twelve edge middles (or its shell's points farthest along those twenty ways), a wheel's two rims. */
export const SHAPE_POINTS = 20;

/** A shape for a body of at most `SHAPE_POINTS` points, empty until `boxShape` or `wheelShape` fills it; `shell`: it may fly as its drawn shell's own points (`LooseShape.shell`). */
export function newLooseShape(shell = false): LooseShape {
  return { points: new Float64Array(3 * SHAPE_POINTS), count: 0, centre: new THREE.Vector3(), half: new THREE.Vector3(), plate: 0, box: false, shell, invI: new THREE.Vector3(), reach: 0, asleep: false, sleepX: 0, sleepZ: 0, airborne: false, restFor: 0, seatFor: 0 };
}

/** `shape` as `newLooseShape` made it: not measured, awake, no sleep place. A body back on its car (`resetVisual`) flies afresh when next torn, as a new car's would. */
export function clearShape(shape: LooseShape): void {
  shape.points.fill(0);
  shape.count = 0;
  shape.centre.set(0, 0, 0);
  shape.half.set(0, 0, 0);
  shape.plate = 0;
  shape.box = false;
  shape.invI.set(0, 0, 0);
  shape.reach = 0;
  shape.asleep = false;
  shape.sleepX = 0;
  shape.sleepZ = 0;
  shape.airborne = false;
  shape.restFor = 0;
  shape.seatFor = 0;
}

/** The thinnest a box's half extent is taken (m): a sheet of no thickness would have no spin about its own length. */
const MIN_HALF = 0.01;
/**
 * How near (m) a drawn point must stand to every corner of its bounding box for a part that may (`LooseShape.shell`) to fly as that box. A box
 * with a corner farther from its shell than this has an empty corner the part rests on: a torn bumper's wrapped ends and seam cover make it a U
 * in plan and an L side-on (its corners 19-34 cm from the shell), and as one box its shell hovered 13.4 cm off the ground and 16.2 cm off a wall
 * on that corner. It flies as its shell's own points.
 */
const CORNER_FILL = 0.02;
const _box = new THREE.Box3();
const _geoBox = new THREE.Box3();
const _vertBox = new THREE.Box3();
const _size = new THREE.Vector3();
const _p = new THREE.Vector3();
/** The drawn points a shape is measured over, in the part's own frame (x, y, z), grown as needed: measured once per flight. */
const SHELL = { xyz: new Float64Array(3 * 1024), n: 0 };
/** A shell's drawn triangles' area projected on each of the part's axes (|x|, |y|, |z| of each area vector summed), measured with `SHELL`. */
const FACING = new Float64Array(3);
const _tri = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _cross = new THREE.Vector3();

function shellPush(p: THREE.Vector3): void {
  if (SHELL.n * 3 + 3 > SHELL.xyz.length) {
    const grown = new Float64Array(SHELL.xyz.length * 2);
    grown.set(SHELL.xyz);
    SHELL.xyz = grown;
  }
  p.toArray(SHELL.xyz, SHELL.n * 3);
  SHELL.n++;
}

/**
 * `object`'s meshes' bounds in its own frame, unioned into `_box` (`m`: the frame of `o` in `object`'s), and with `shell` their points into
 * `SHELL` and their triangles' facing into `FACING`: a mesh's vertices, or the corners of its bounding box where that is not its vertices'
 * (a geometry whose box was set apart from them; no torn part's is today).
 */
function growBox(o: THREE.Object3D, m: THREE.Matrix4, shell: boolean): void {
  if (o instanceof THREE.Mesh) {
    const geo = o.geometry as THREE.BufferGeometry;
    if (geo.boundingBox === null) geo.computeBoundingBox();
    _box.union(_geoBox.copy(geo.boundingBox!).applyMatrix4(m));
    if (shell) {
      facingOf(geo, m);
      shellOf(geo, m);
    }
  }
  for (const child of o.children) growBox(child, new THREE.Matrix4().multiplyMatrices(m, child.matrix), shell);
}

/** `geo`'s triangles' area projected on each axis of the part's frame (`m`), added into `FACING`: a sheet faces its broad side, as a bumper's face does however far its ends wrap back. */
function facingOf(geo: THREE.BufferGeometry, m: THREE.Matrix4): void {
  const pos = geo.getAttribute("position");
  if (!pos) return;
  const index = geo.index;
  const triangles = (index ? index.count : pos.count) / 3;
  for (let t = 0; t < triangles; t++) {
    for (let c = 0; c < 3; c++) _tri[c]!.fromBufferAttribute(pos, index ? index.getX(3 * t + c) : 3 * t + c).applyMatrix4(m);
    _cross.subVectors(_tri[1]!, _tri[0]!).cross(_p.subVectors(_tri[2]!, _tri[0]!));
    FACING[0]! += Math.abs(_cross.x);
    FACING[1]! += Math.abs(_cross.y);
    FACING[2]! += Math.abs(_cross.z);
  }
}

/** `geo`'s points into `SHELL` in the part's frame (`m`): its vertices, or its bounding box's corners where that box is not its vertices'. */
function shellOf(geo: THREE.BufferGeometry, m: THREE.Matrix4): void {
  const pos = geo.getAttribute("position");
  _vertBox.makeEmpty();
  if (pos) for (let k = 0; k < pos.count; k++) _vertBox.expandByPoint(_p.fromBufferAttribute(pos, k));
  if (pos && _vertBox.equals(geo.boundingBox!)) {
    for (let k = 0; k < pos.count; k++) shellPush(_p.fromBufferAttribute(pos, k).applyMatrix4(m));
    return;
  }
  const b = geo.boundingBox!;
  for (let c = 0; c < 8; c++) shellPush(_p.set(c & 1 ? b.max.x : b.min.x, c & 2 ? b.max.y : b.min.y, c & 4 ? b.max.z : b.min.z).applyMatrix4(m));
}

/**
 * `shape` as `object` drawn, in its own frame: its bounding box (`halfBox`), or, for a shape that may (`LooseShape.shell`) and whose shell does
 * not fill every corner of that box, its shell's own points (`supportShape`). Measured once per part, when it first flies (`stepLoose`), and
 * again when it has been put back on its car (`count` 0). Its drawn shape changes after (a crushed arch), so a keyframe carries the shape.
 */
export function boxShape(shape: LooseShape, object: THREE.Object3D): void {
  _box.makeEmpty();
  SHELL.n = 0;
  FACING.fill(0);
  growBox(object, new THREE.Matrix4(), shape.shell);
  if (_box.isEmpty()) _box.set(_size.set(-MIN_HALF, -MIN_HALF, -MIN_HALF), _geoBox.max.set(MIN_HALF, MIN_HALF, MIN_HALF));
  _box.getCenter(shape.centre);
  _box.getSize(_size).multiplyScalar(0.5);
  halfBox(shape, Math.max(MIN_HALF, _size.x), Math.max(MIN_HALF, _size.y), Math.max(MIN_HALF, _size.z));
  shape.plate = plateOf(shape);
  if (shape.shell && SHELL.n > 0 && !cornersFilled(shape)) supportShape(shape);
}

/**
 * The axis `shape`'s wind plate faces: for a part that flies as its shell, the axis its drawn triangles face most (a torn bumper's wrapped ends
 * and seam cover make its box as deep as it is tall, its face still the broad side); for one that flies as its box (a mirror's pod, the light bar), its thinnest.
 */
function plateOf(shape: LooseShape): LooseShape["plate"] {
  if (shape.shell && SHELL.n > 0) return FACING[1]! > FACING[0]! ? (FACING[2]! > FACING[1]! ? 2 : 1) : FACING[2]! > FACING[0]! ? 2 : 0;
  const { x, y, z } = shape.half;
  return x <= y && x <= z ? 0 : y <= z ? 1 : 2;
}

/** Whether a point of `SHELL` stands within `CORNER_FILL` of each of the eight corners of `shape`'s box. */
function cornersFilled(shape: LooseShape): boolean {
  const c = shape.centre;
  for (let k = 0; k < BOX_CORNERS; k++) {
    const cx = c.x + shape.points[k * 3]!;
    const cy = c.y + shape.points[k * 3 + 1]!;
    const cz = c.z + shape.points[k * 3 + 2]!;
    let near = Infinity;
    for (let i = 0; i < SHELL.n * 3 && near > CORNER_FILL * CORNER_FILL; i += 3) {
      near = Math.min(near, (SHELL.xyz[i]! - cx) ** 2 + (SHELL.xyz[i + 1]! - cy) ** 2 + (SHELL.xyz[i + 2]! - cz) ** 2);
    }
    if (near > CORNER_FILL * CORNER_FILL) return false;
  }
  return true;
}

/**
 * `shape`'s points as its shell's own: for each of its box's twenty points (`halfBox`, already in `points`), the shell point farthest along
 * the way from the middle to it (the nearer to it of those as far), so every point a contact meets is drawn. Its box's inertia and plate stay.
 */
function supportShape(shape: LooseShape): void {
  const c = shape.centre;
  for (let k = 0; k < SHAPE_POINTS; k++) {
    const bx = shape.points[k * 3]!;
    const by = shape.points[k * 3 + 1]!;
    const bz = shape.points[k * 3 + 2]!;
    let far = -Infinity;
    let near = Infinity;
    let at = 0;
    for (let i = 0; i < SHELL.n * 3; i += 3) {
      const x = SHELL.xyz[i]! - c.x;
      const y = SHELL.xyz[i + 1]! - c.y;
      const z = SHELL.xyz[i + 2]! - c.z;
      const along = x * bx + y * by + z * bz;
      const off = (x - bx) ** 2 + (y - by) ** 2 + (z - bz) ** 2;
      if (along > far + 1e-9 || (along > far - 1e-9 && off < near)) {
        far = Math.max(far, along);
        near = off;
        at = i;
      }
    }
    shape.points[k * 3] = SHELL.xyz[at]! - c.x;
    shape.points[k * 3 + 1] = SHELL.xyz[at + 1]! - c.y;
    shape.points[k * 3 + 2] = SHELL.xyz[at + 2]! - c.z;
  }
  completeTwins(shape);
  let reach = 0;
  for (let k = 0; k < SHAPE_POINTS * 3; k += 3) reach = Math.max(reach, Math.sqrt(shape.points[k]! ** 2 + shape.points[k + 1]! ** 2 + shape.points[k + 2]! ** 2));
  shape.reach = reach;
  shape.box = false;
}

const CORNER_FILL_SQ = CORNER_FILL * CORNER_FILL;

/** Whether a point of `shape` (about its middle) stands within `CORNER_FILL` of (`x`, `y`, `z`). */
function supportNear(shape: LooseShape, x: number, y: number, z: number): boolean {
  for (let k = 0; k < SHAPE_POINTS * 3; k += 3) {
    if ((shape.points[k]! - x) ** 2 + (shape.points[k + 1]! - y) ** 2 + (shape.points[k + 2]! - z) ** 2 <= CORNER_FILL_SQ) return true;
  }
  return false;
}

/** The last slot of `shape` whose point an earlier slot holds as well (the farthest point along two ways is one), -1 where none repeats. */
function repeatedSlot(shape: LooseShape): number {
  for (let k = SHAPE_POINTS - 1; k > 0; k--) {
    for (let j = 0; j < k; j++) {
      if ((shape.points[k * 3]! - shape.points[j * 3]!) ** 2 + (shape.points[k * 3 + 1]! - shape.points[j * 3 + 1]!) ** 2 + (shape.points[k * 3 + 2]! - shape.points[j * 3 + 2]!) ** 2 < 1e-12) return k;
    }
  }
  return -1;
}

/**
 * A shell drawn the same either side of its car's middle plane (a bumper) is supported the same either side. The farthest point along a way
 * can tie between a pair of mirror images (a bumper's two lower front ends) and one slot takes one of them, which left the part on a lone
 * front point that tipped it forward end over end as it slid. A drawn mirror image of a chosen point that no chosen point stands at goes in
 * a slot another repeats.
 */
function completeTwins(shape: LooseShape): void {
  const c = shape.centre;
  for (let k = 0; k < SHAPE_POINTS; k++) {
    const x = -shape.points[k * 3]! - 2 * c.x;
    const y = shape.points[k * 3 + 1]!;
    const z = shape.points[k * 3 + 2]!;
    if (supportNear(shape, x, y, z)) continue;
    let near = CORNER_FILL_SQ;
    let at = -1;
    for (let i = 0; i < SHELL.n * 3; i += 3) {
      const off = (SHELL.xyz[i]! - c.x - x) ** 2 + (SHELL.xyz[i + 1]! - c.y - y) ** 2 + (SHELL.xyz[i + 2]! - c.z - z) ** 2;
      if (off <= near) {
        near = off;
        at = i;
      }
    }
    const slot = at < 0 ? -1 : repeatedSlot(shape);
    if (slot < 0) continue;
    shape.points[slot * 3] = SHELL.xyz[at]! - c.x;
    shape.points[slot * 3 + 1] = SHELL.xyz[at + 1]! - c.y;
    shape.points[slot * 3 + 2] = SHELL.xyz[at + 2]! - c.z;
  }
}

/** `shape` as a box of half extents `hx`, `hy`, `hz` about its `centre`: its eight corners and twelve edge middles, and the inverse inertia per unit mass of a solid box that size (a hood is a sheet: its spin about its own length is as easy as its tilt). */
function halfBox(shape: LooseShape, hx: number, hy: number, hz: number): void {
  // The eight corners, then the middle of each of the twelve edges (a part across a roof's ridge rests on the ridge, not on its corners).
  for (let c = 0; c < 8; c++) {
    shape.points[c * 3] = c & 1 ? hx : -hx;
    shape.points[c * 3 + 1] = c & 2 ? hy : -hy;
    shape.points[c * 3 + 2] = c & 4 ? hz : -hz;
  }
  for (let e = 0; e < 12; e++) {
    const o = (8 + e) * 3;
    const axis = e >> 2;
    shape.points[o] = axis === 0 ? 0 : e & 1 ? hx : -hx;
    shape.points[o + 1] = axis === 1 ? 0 : e & (axis === 0 ? 1 : 2) ? hy : -hy;
    shape.points[o + 2] = axis === 2 ? 0 : e & 2 ? hz : -hz;
  }
  shape.half.set(hx, hy, hz);
  shape.box = true;
  shape.invI.set(3 / (hy * hy + hz * hz), 3 / (hx * hx + hz * hz), 3 / (hx * hx + hy * hy));
  shape.count = 20;
  shape.reach = Math.sqrt(hx * hx + hy * hy + hz * hz);
  shape.asleep = false;
  shape.airborne = false;
  shape.restFor = 0;
}

/** `shape` as a keyframe carries it (`part-state.ts`): its box of half extents `hx`, `hy`, `hz` facing `plate`, and its shell's twenty points from `src` at `at` unless it flies as the box. */
export function keyedShape(shape: LooseShape, hx: number, hy: number, hz: number, plate: LooseShape["plate"], box: boolean, src: Float64Array, at: number): void {
  shape.plate = plate;
  halfBox(shape, hx, hy, hz);
  if (box) return;
  let reach = 0;
  for (let k = 0; k < SHAPE_POINTS * 3; k += 3) {
    const px = src[at + k]!;
    const py = src[at + k + 1]!;
    const pz = src[at + k + 2]!;
    shape.points[k] = px;
    shape.points[k + 1] = py;
    shape.points[k + 2] = pz;
    reach = Math.max(reach, Math.sqrt(px * px + py * py + pz * pz));
  }
  shape.reach = reach;
  shape.box = false;
}

/** `shape` as a wheel of `radius` and `width` (m), axle along its x: eight points round each rim; the inertia of a solid disk. */
function wheelShape(shape: LooseShape, radius: number, width: number): void {
  shape.centre.set(0, 0, 0);
  for (let k = 0; k < 16; k++) {
    const a = ((k & 7) / 8) * 2 * Math.PI;
    shape.points[k * 3] = k < 8 ? -width / 2 : width / 2;
    shape.points[k * 3 + 1] = radius * detSin(a);
    shape.points[k * 3 + 2] = radius * detCos(a);
  }
  shape.half.set(width / 2, radius, radius);
  shape.box = false;
  shape.invI.set(2 / (radius * radius), 1 / (radius * radius * 0.25 + (width * width) / 12), 1 / (radius * radius * 0.25 + (width * width) / 12));
  shape.count = 16;
  shape.reach = Math.sqrt(radius * radius + (width * width) / 4);
  shape.asleep = false;
  shape.airborne = false;
  shape.restFor = 0;
}

/** `wheel`'s shape as the disk it flies as (`wheelShape`) at its own scale: a popped wheel's, whether it left its hub in a step or a keyframe put it loose. */
export function fitWheelShape(wheel: LooseWheel): void {
  wheelShape(wheel.shape, wheel.radius * wheel.object.scale.x, wheel.width * wheel.object.scale.x);
}

/** Air at sea level (kg/m³, the ISA standard atmosphere). */
export const AIR_DENSITY = 1.225;
/** A flat plate's normal-force coefficient broadside to the wind: Hoerner's square plate (Fluid-Dynamic Drag, 1965, fig. 29). */
export const PLATE_CN_BROADSIDE = 1.17;
/** Its rise per unit sin α below stall: a low-aspect-ratio plate's lift slope (πA/2 for A ≈ 1.3), meeting the broadside value at sin α 0.585 (36°), Hoerner's square plate's stall. */
const PLATE_CN_SLOPE = 2;
/** The centre of pressure stands this share of the chord ahead of the plate's middle up to `CP_QUARTER_TO` incidence, then moves linearly to the middle at `CP_MIDDLE_FROM` (Holmes, English and Letchford, flat plates as wind-borne debris, after Tachikawa 1983). */
const CP_QUARTER = 0.25;
const CP_QUARTER_TO = (20 * Math.PI) / 180;
const CP_MIDDLE_FROM = (60 * Math.PI) / 180;
/** A sheet lying on what it slides on takes this uplift coefficient on its plan area from the wind over its top: Wang and Letchford's sheet flight-initiation tests (ICWE 2003) for the Wills, Lee and Wyatt threshold model. */
const SHEET_LIFTOFF_CF = 0.15;

/** Part masses (kg) from a 2011 Honda Accord's teardown (NHTSA mass-reduction study, DOT HS 811 666): hood 17.9, front door 29.5, front fender 3.7 (an arch flare is its fender). A trunk lid's is its car's (`HingeSpec.kg`). */
const HOOD_KG = 17.9;
const DOOR_KG = 29.5;
const FENDER_KG = 3.7;
/** A rear quarter's outer skin: the fender's 0.85 mm steel (6.7 kg/m²) over a quarter's 1.3 m². */
const QUARTER_KG = 8.7;
/** A mid-size car's plastic bumper cover: fascias run 6-10 kg. */
const BUMPER_KG = 8;
/** A door mirror assembly: 1-2 kg with its glass and motor. */
const MIRROR_KG = 1.3;
/** A full-width police light bar: about 30 lb. */
const LIGHT_BAR_KG = 14;
const PART_KG: Record<Exclude<DetachPart["hinge"], "tail">, number> = { cowl: HOOD_KG, door: DOOR_KG, "two-point": BUMPER_KG, bar: LIGHT_BAR_KG, quarter: QUARTER_KG, arch: FENDER_KG };

/** Torn part `p`'s mass (kg): what the wind on its plan area moves (`blow`). */
export function partMass(p: DetachPart): number {
  if (p.mirror) return MIRROR_KG;
  return p.hinge === "tail" ? p.swing!.spec.kg : PART_KG[p.hinge];
}

const _qi = new THREE.Quaternion();
const _vb = new THREE.Vector3();
const _air = new THREE.Vector3();
const _arm = new THREE.Vector3();

/**
 * One slice of the wind on a torn part of `mass` kg flying as a flat plate: its box's two extents across its facing (`LooseShape.plate`), the normal that axis.
 * The relative wind's normal force (½ρv²A C_N, C_N with the incidence α) pushes along that normal at the centre of pressure ahead of the
 * middle toward the leading edge, so it lifts, drags, pitches and tumbles the plate; one lying on a surface also takes the wind's uplift
 * over its top (`SHEET_LIFTOFF_CF`), which raises its leading edge once the wind is fast enough to carry its weight.
 */
function blow(p: LooseBody, mass: number, dt: number): void {
  const v = p.velocity;
  const speed2 = v.x * v.x + v.y * v.y + v.z * v.z;
  if (speed2 === 0) return;
  const s = p.shape;
  const hx = s.half.x;
  const hy = s.half.y;
  const hz = s.half.z;
  const normal = s.plate;
  const a = normal === 0 ? hy : hx;
  const b = normal === 2 ? hy : hz;
  const q = p.object.quaternion;
  _vb.copy(v).applyQuaternion(_qi.copy(q).invert());
  const vn = normal === 0 ? _vb.x : normal === 1 ? _vb.y : _vb.z;
  const va = normal === 0 ? _vb.y : _vb.x;
  const vc = normal === 2 ? _vb.y : _vb.z;
  const speed = Math.sqrt(speed2);
  const sinA = Math.min(1, Math.abs(vn) / speed);
  // The world's up component of the plate's normal: the share of the plate facing the sky.
  const up = normal === 0 ? 2 * (q.x * q.y + q.w * q.z) : normal === 1 ? 1 - 2 * (q.x * q.x + q.z * q.z) : 2 * (q.y * q.z - q.w * q.x);
  const cn = (vn > 0 ? -1 : 1) * Math.min(PLATE_CN_SLOPE * sinA, PLATE_CN_BROADSIDE) + (s.airborne ? 0 : SHEET_LIFTOFF_CF * up);
  const force = (0.5 * AIR_DENSITY * speed2 * 4 * a * b * cn) / mass;
  const along = Math.sqrt(va * va + vc * vc);
  let ahead = 0;
  if (along > 0) {
    const alpha = detAsin(sinA);
    const share = alpha <= CP_QUARTER_TO ? CP_QUARTER : alpha >= CP_MIDDLE_FROM ? 0 : (CP_QUARTER * (CP_MIDDLE_FROM - alpha)) / (CP_MIDDLE_FROM - CP_QUARTER_TO);
    // The chord through the middle along the wind's run over the plate, from the half extents it crosses first.
    ahead = (share * 2 * Math.min((a * along) / Math.abs(va), (b * along) / Math.abs(vc))) / along;
  }
  _air.set(normal === 0 ? force : 0, normal === 1 ? force : 0, normal === 2 ? force : 0);
  // The arm to the centre of pressure, in the plate's axes: along the in-plane wind, ahead of the middle.
  _arm.set(normal === 0 ? 0 : va * ahead, normal === 0 ? va * ahead : normal === 1 ? 0 : vc * ahead, normal === 2 ? 0 : vc * ahead);
  _arm.cross(_air).multiply(s.invI).multiplyScalar(dt).applyQuaternion(q);
  p.angular.add(_arm);
  v.add(_air.multiplyScalar(dt).applyQuaternion(q));
}

/**
 * One slice of a torn part's or a popped wheel's flight (`p.velocity` its middle's, `p.angular` its spin) by the rigid step every body
 * takes (`car-air.ts`: `moveBody`, `readPoints`, `openRows`, `solveRows`): the body's points (a part's box's eight corners, a wheel's
 * rims) meet what is under and beside them by the one point query, with the point's own velocity (`pointContact`: the ground, every
 * prism, every car's top and flank: its own car `owner`'s only once it has stood clear of it since it left its seat, `LooseShape.seated`), as every body's points do, so a part topples, rolls, slides off an edge and stops
 * at a wall. Here: its sleep, the gate that asks no point when nothing is near, its spin dying in the air, and its dent. A torn panel of `mass`
 * kg flies in the wind (`blow`) and meets surfaces as the body's metal (`body.panel`); 0, a popped wheel: no wind, its rims a locked tyre's
 * contact. True when a sleeper at rest woke because something came near it (`stirNear`; with `cars`, the world's, only a top whose car moves): a body woken by speed given it is not a stir. `met`
 * hears each of its points on a car's top (not its own's). No car feels a part: its contacts take no impulse, crush or touch.
 */
export function stepLoose(p: LooseBody, dt: number, owner: number, dent?: DentState, met?: TopMet, mass = 0, cars: readonly StirCar[] | null = null): boolean {
  const shape = p.shape;
  const object = p.object;
  const v = p.velocity;
  const w = p.angular;
  if (shape.count === 0) boxShape(shape, object);
  let stirred = false;
  if (shape.asleep) {
    // At rest and nothing near that moves or changes: the step would hand it back where it is. A hit gave it speed or something came within its reach: it steps.
    const still = v.x * v.x + v.y * v.y + v.z * v.z + w.x * w.x + w.y * w.y + w.z * w.z === 0;
    if (still && !stirNear(shape.sleepX, shape.sleepZ, shape.reach, -1, cars)) return false;
    shape.asleep = false;
    stirred = still;
  }
  if (mass > 0) blow(p, mass, dt);
  bindBody(object, v, w, shape.centre, shape.invI, -1, true, dt, owner);
  body.seated = shape.seatFor > 0;
  body.touchedOwn = false;
  if (met) body.met = met;
  if (cars !== null) body.cars = cars;
  body.panel = mass > 0;
  moveBody();
  // Its spin dies in the air as it always did.
  w.multiplyScalar(Math.pow(SPIN_KEPT_PER_S, dt));
  placeBody();
  if (dent) _v0.copy(v);

  // Over everything near (the statics, the solids and the car tops under its bounding square all lower than its lowest point) no point can touch: none is asked.
  const clear = clearOf(-1, centreOfMass.x, centreOfMass.z, shape.reach, centreOfMass.y - shape.reach);
  // Else the car tops are asked once for the body (every point is within its bounding radius of the middle), not once per point.
  const roofs = clear ? 0 : holdTops(-1, centreOfMass.x, centreOfMass.z, shape.reach);
  let n = 0;
  if (!clear) {
    const end = loadShape(shape);
    // Flying free (the last step touched nothing) with no car's roof near, a box's twelve edge middles wait until a corner touches: a flat floor or a wall is met by a corner first (a crowned roof by an edge's middle, so a roof near tests all).
    const first = shape.airborne && shape.box && roofs === 0 ? BOX_CORNERS : end;
    n = readPoints(0, first, end, 0, false);
    if (n > 0 && first < end) n = readPoints(first, end, end, n, false);
  }
  shape.airborne = n === 0;
  // A step that found none of its points in its own car's hull ends its seat; else it runs down.
  shape.seatFor = body.touchedOwn ? Math.max(0, shape.seatFor - dt) : 0;
  openRows(n);
  solveRows(n);
  standAtCentre();
  const slow = v.x * v.x + v.y * v.y + v.z * v.z < REST_SPEED * REST_SPEED && w.x * w.x + w.y * w.y + w.z * w.z < REST_SPEED * REST_SPEED;
  shape.restFor = slow && n >= 2 ? shape.restFor + dt : 0;
  // Resting on three points or more at no more than `REST_SPEED`, or on two for `TWO_POINT_REST_S`: at rest (not while it still sits at its seat: it would sleep in the hull it is to leave).
  if (slow && shape.seatFor === 0 && (n >= 3 || shape.restFor >= TWO_POINT_REST_S)) {
    v.set(0, 0, 0);
    w.set(0, 0, 0);
    shape.asleep = true;
    _c.copy(shape.centre).applyQuaternion(object.quaternion).add(object.position);
    shape.sleepX = _c.x;
    shape.sleepZ = _c.z;
  }
  if (dent) {
    // A settled part's tiny velocity change never reaches recordDent.
    _dv.copy(v).sub(_v0);
    if (_dv.x * _dv.x + _dv.y * _dv.y + _dv.z * _dv.z >= DENT_MIN_DV * DENT_MIN_DV) recordDent(dent, object, _dv);
  }
  return stirred;
}
