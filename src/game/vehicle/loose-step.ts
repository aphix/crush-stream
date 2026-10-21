import * as THREE from "three";
import { applyGroundFriction } from "../deform/physics-util.ts";
import { TYRE_R } from "../deform/deform-state.ts";
import { GRAVITY } from "../kernel/constants.ts";
import { detAsin, detCos, detSin } from "../kernel/physics-core.js";
import { NO_FLOOR } from "../world/ground.ts";
import { C_DEPTH, C_GRIP, C_H, C_NX, C_NZ, clearOf, HIT_SIZE, holdTops, pointContact, PQ_SIZE, PQ_VX, PQ_VY, PQ_VZ, PQ_X, PQ_Y, PQ_Z, stirNear } from "../world/surfaces.ts";
import { body, centreOfMass, moveBody, placeBody, standAtCentre, bindBody, type TopMet } from "./car-air-body.ts";
import { loadShape, readPoints } from "./car-air-points.ts";
import { openRows, solveRows } from "./car-air.ts";
import { DENT_MIN_DV, recordDent, type DentState } from "./loose-dent.ts";
import type { DetachPart, LooseBody, LooseShape } from "./car-core.ts";

const _c = new THREE.Vector3();
const _dv = new THREE.Vector3();
const _v0 = new THREE.Vector3();
const _q = new Float64Array(PQ_SIZE);
const _hit = new Float64Array(HIT_SIZE);

/** Height above its rest (m) at which a free body still slides on what is under it. */
const GROUND_BAND = 0.005;
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
  pointContact(_q, skip, _hit);
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
    pointContact(_q, skip, _hit);
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

/** The body's own points, as many as its shape can hold: a box's eight corners and twelve edge middles, a wheel's two rims. */
const SHAPE_POINTS = 20;

/** A shape for a body of at most `SHAPE_POINTS` points, empty until `boxShape` or `wheelShape` fills it. */
export function newLooseShape(): LooseShape {
  return { points: new Float64Array(3 * SHAPE_POINTS), count: 0, centre: new THREE.Vector3(), invI: new THREE.Vector3(), reach: 0, asleep: false, sleepX: 0, sleepZ: 0, airborne: false, restFor: 0 };
}

/** The thinnest a box's half extent is taken (m): a sheet of no thickness would have no spin about its own length. */
const MIN_HALF = 0.01;
const _box = new THREE.Box3();
const _geoBox = new THREE.Box3();
const _size = new THREE.Vector3();

/** `object`'s meshes' bounds in its own frame, unioned into `_box` (`m`: the frame of `o` in `object`'s). */
function growBox(o: THREE.Object3D, m: THREE.Matrix4): void {
  if (o instanceof THREE.Mesh) {
    const geo = o.geometry as THREE.BufferGeometry;
    if (geo.boundingBox === null) geo.computeBoundingBox();
    _box.union(_geoBox.copy(geo.boundingBox!).applyMatrix4(m));
  }
  for (const child of o.children) growBox(child, new THREE.Matrix4().multiplyMatrices(m, child.matrix));
}

/**
 * `shape` as `object`'s box in its own frame, as drawn (`halfBox`). Measured once per part, when it first flies (`stepLoose`), and again
 * when it has been put back on its car (`count` 0). Its drawn shape changes after (a crushed arch), so a keyframe carries the box.
 */
export function boxShape(shape: LooseShape, object: THREE.Object3D): void {
  _box.makeEmpty();
  growBox(object, new THREE.Matrix4());
  if (_box.isEmpty()) _box.set(_size.set(-MIN_HALF, -MIN_HALF, -MIN_HALF), _geoBox.max.set(MIN_HALF, MIN_HALF, MIN_HALF));
  _box.getCenter(shape.centre);
  _box.getSize(_size).multiplyScalar(0.5);
  halfBox(shape, Math.max(MIN_HALF, _size.x), Math.max(MIN_HALF, _size.y), Math.max(MIN_HALF, _size.z));
}

/** Index in a box shape's `points` of its last corner, (+hx, +hy, +hz): its half extents. */
export const BOX_HALVES = 7 * 3;

/** `shape` as a box of half extents `hx`, `hy`, `hz` about its `centre`: its eight corners and twelve edge middles, and the inverse inertia per unit mass of a solid box that size (a hood is a sheet: its spin about its own length is as easy as its tilt). */
export function halfBox(shape: LooseShape, hx: number, hy: number, hz: number): void {
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
  shape.invI.set(3 / (hy * hy + hz * hz), 3 / (hx * hx + hz * hz), 3 / (hx * hx + hy * hy));
  shape.count = 20;
  shape.reach = Math.sqrt(hx * hx + hy * hy + hz * hz);
  shape.asleep = false;
  shape.airborne = false;
  shape.restFor = 0;
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
  shape.invI.set(2 / (radius * radius), 1 / (radius * radius * 0.25 + (width * width) / 12), 1 / (radius * radius * 0.25 + (width * width) / 12));
  shape.count = 16;
  shape.reach = Math.sqrt(radius * radius + (width * width) / 4);
  shape.asleep = false;
  shape.airborne = false;
  shape.restFor = 0;
}

/** A tyre's width (m) at wheel scale 1: a popped wheel flies as a disk this wide. */
const TYRE_WIDTH = 0.24;

/** `wheel`'s shape as the disk it flies as (`wheelShape`) at its own scale: a popped wheel's, whether it left its hub in a step or a keyframe put it loose. */
export function fitWheelShape(wheel: LooseBody): void {
  wheelShape(wheel.shape, TYRE_R * wheel.object.scale.x, TYRE_WIDTH * wheel.object.scale.x);
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

/** Part masses (kg) from a 2011 Honda Accord's teardown (NHTSA mass-reduction study, DOT HS 811 666): hood 17.9, front door 29.5, trunk lid 12.4, front fender 3.7 (an arch flare is its fender). */
const HOOD_KG = 17.9;
const DOOR_KG = 29.5;
const TRUNK_KG = 12.4;
const FENDER_KG = 3.7;
/** A rear quarter's outer skin: the fender's 0.85 mm steel (6.7 kg/m²) over a quarter's 1.3 m². */
const QUARTER_KG = 8.7;
/** A mid-size car's plastic bumper cover: fascias run 6-10 kg. */
const BUMPER_KG = 8;
/** A door mirror assembly: 1-2 kg with its glass and motor. */
const MIRROR_KG = 1.3;
/** A full-width police light bar: about 30 lb. */
const LIGHT_BAR_KG = 14;
const PART_KG: Record<DetachPart["hinge"], number> = { cowl: HOOD_KG, tail: TRUNK_KG, door: DOOR_KG, "two-point": BUMPER_KG, bar: LIGHT_BAR_KG, quarter: QUARTER_KG, arch: FENDER_KG };

/** Torn part `p`'s mass (kg): what the wind on its plan area moves (`blow`). */
export function partMass(p: DetachPart): number {
  return p.mirror ? MIRROR_KG : PART_KG[p.hinge];
}

const _qi = new THREE.Quaternion();
const _vb = new THREE.Vector3();
const _air = new THREE.Vector3();
const _arm = new THREE.Vector3();

/**
 * One slice of the wind on a torn part of `mass` kg flying as a flat plate: its box's two largest extents, the normal its thinnest axis.
 * The relative wind's normal force (½ρv²A C_N, C_N with the incidence α) pushes along that normal at the centre of pressure ahead of the
 * middle toward the leading edge, so it lifts, drags, pitches and tumbles the plate; one lying on a surface also takes the wind's uplift
 * over its top (`SHEET_LIFTOFF_CF`), which raises its leading edge once the wind is fast enough to carry its weight.
 */
function blow(p: LooseBody, mass: number, dt: number): void {
  const v = p.velocity;
  const speed2 = v.x * v.x + v.y * v.y + v.z * v.z;
  if (speed2 === 0) return;
  const s = p.shape;
  const hx = s.points[BOX_HALVES]!;
  const hy = s.points[BOX_HALVES + 1]!;
  const hz = s.points[BOX_HALVES + 2]!;
  const thin = hx <= hy && hx <= hz ? 0 : hy <= hz ? 1 : 2;
  const a = thin === 0 ? hy : hx;
  const b = thin === 2 ? hy : hz;
  const q = p.object.quaternion;
  _vb.copy(v).applyQuaternion(_qi.copy(q).invert());
  const vn = thin === 0 ? _vb.x : thin === 1 ? _vb.y : _vb.z;
  const va = thin === 0 ? _vb.y : _vb.x;
  const vc = thin === 2 ? _vb.y : _vb.z;
  const speed = Math.sqrt(speed2);
  const sinA = Math.min(1, Math.abs(vn) / speed);
  // The world's up component of the plate's normal: the share of the plate facing the sky.
  const up = thin === 0 ? 2 * (q.x * q.y + q.w * q.z) : thin === 1 ? 1 - 2 * (q.x * q.x + q.z * q.z) : 2 * (q.y * q.z - q.w * q.x);
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
  _air.set(thin === 0 ? force : 0, thin === 1 ? force : 0, thin === 2 ? force : 0);
  // The arm to the centre of pressure, in the plate's axes: along the in-plane wind, ahead of the middle.
  _arm.set(thin === 0 ? 0 : va * ahead, thin === 0 ? va * ahead : thin === 1 ? 0 : vc * ahead, thin === 2 ? 0 : vc * ahead);
  _arm.cross(_air).multiply(s.invI).multiplyScalar(dt).applyQuaternion(q);
  p.angular.add(_arm);
  v.add(_air.multiplyScalar(dt).applyQuaternion(q));
}

/**
 * One slice of a torn part's or a popped wheel's flight (`p.velocity` its middle's, `p.angular` its spin) by the rigid step every body
 * takes (`car-air.ts`: `moveBody`, `readPoints`, `openRows`, `solveRows`): the body's points (a part's box's eight corners, a wheel's
 * rims) meet what is under and beside them by the one point query, with the point's own velocity (`pointContact`: the ground, every
 * prism, the other cars' tops, car `skip`'s left out), as every body's points do, so a part topples, rolls, slides off an edge and stops
 * at a wall. Here: its sleep, the gate that asks no point when nothing is near, its spin dying in the air, and its dent. A torn panel of `mass`
 * kg flies in the wind (`blow`) and meets surfaces as the body's metal (`body.panel`); 0, a popped wheel: no wind, its rims a locked tyre's
 * contact. True when a sleeper at rest woke because something came near it (`stirNear`): a body woken by speed given it is not a stir. `met`
 * hears each of its points on another car's top.
 */
export function stepLoose(p: LooseBody, dt: number, skip: number, dent?: DentState, met?: TopMet, mass = 0): boolean {
  const shape = p.shape;
  const object = p.object;
  const v = p.velocity;
  const w = p.angular;
  if (shape.count === 0) boxShape(shape, object);
  let stirred = false;
  if (shape.asleep) {
    // At rest and nothing near that moves or changes: the step would hand it back where it is. A hit gave it speed or something came within its reach: it steps.
    const still = v.x * v.x + v.y * v.y + v.z * v.z + w.x * w.x + w.y * w.y + w.z * w.z === 0;
    if (still && !stirNear(shape.sleepX, shape.sleepZ, shape.reach, skip)) return false;
    shape.asleep = false;
    stirred = still;
  }
  if (mass > 0) blow(p, mass, dt);
  bindBody(object, v, w, shape.centre, shape.invI, skip, true, dt);
  if (met) body.met = met;
  body.panel = mass > 0;
  moveBody();
  // Its spin dies in the air as it always did.
  w.multiplyScalar(Math.pow(SPIN_KEPT_PER_S, dt));
  placeBody();
  if (dent) _v0.copy(v);

  // Over everything near (the statics, the solids and the car tops under its bounding square all lower than its lowest point) no point can touch: none is asked.
  const clear = clearOf(skip, centreOfMass.x, centreOfMass.z, shape.reach, centreOfMass.y - shape.reach);
  // Else the car tops are asked once for the body (every point is within its bounding radius of the middle), not once per point.
  const roofs = clear ? 0 : holdTops(skip, centreOfMass.x, centreOfMass.z, shape.reach);
  let n = 0;
  if (!clear) {
    const end = loadShape(shape);
    // Flying free (the last step touched nothing) with no car's roof near, a box's twelve edge middles wait until a corner touches: a flat floor or a wall is met by a corner first (a crowned roof by an edge's middle, so a roof near tests all).
    const first = shape.airborne && shape.count === 20 && roofs === 0 ? BOX_CORNERS : end;
    n = readPoints(0, first, end, 0, false);
    if (n > 0 && first < end) n = readPoints(first, end, end, n, false);
  }
  shape.airborne = n === 0;
  openRows(n);
  solveRows(n);
  standAtCentre();
  const slow = v.x * v.x + v.y * v.y + v.z * v.z < REST_SPEED * REST_SPEED && w.x * w.x + w.y * w.y + w.z * w.z < REST_SPEED * REST_SPEED;
  shape.restFor = slow && n >= 2 ? shape.restFor + dt : 0;
  // Resting on three points or more at no more than `REST_SPEED`, or on two for `TWO_POINT_REST_S`: at rest.
  if (slow && (n >= 3 || shape.restFor >= TWO_POINT_REST_S)) {
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
