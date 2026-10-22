import * as THREE from "three";
import type { DeformableCar } from "./car.ts";
import { HIT_SIZE, PQ_BODY, PQ_SIZE } from "../world/surfaces.ts";
import { carFrame, type CarFrame } from "./car-rig.ts";
import { CAR_STYLES } from "./car-variants.ts";
import { CarSurfaces } from "./car-surfaces.ts";
import { CAGE_HELD_VERTICES, CAGE_TUB_VERTICES, CAGE_VERTICES, SILL_CAPACITY } from "./car-cage.ts";
import { centreY } from "./car-cage-rig.ts";

export const G = 9.6;
/** Sizes the per-slice tables and the unbound body: every frame's belly and wheels share the sedan's layout. */
const PLATFORM = carFrame(CAR_STYLES.sedan);
/** Room for a style's cage vertices at most (`CAGE_VERTICES`, the underside points held over it, `CAGE_HELD_VERTICES`, and its bed's tubs, `CAGE_TUB_VERTICES`), a wreck's sill samples (`SILL_CAPACITY`) and the belly: `loadPoints` fills it per body each slice. */
export const POINT_CAPACITY = CAGE_VERTICES + CAGE_HELD_VERTICES + CAGE_TUB_VERTICES + SILL_CAPACITY + PLATFORM.belly.length;
/** The loaded points as flat car-local x, y (class lift on), z rows: `hullPoint` reads them per slice without unpacking a tuple. */
export const POINT_X = new Float64Array(POINT_CAPACITY);
export const POINT_Y = new Float64Array(POINT_CAPACITY);
export const POINT_Z = new Float64Array(POINT_CAPACITY);
/** Per belly point this slice: 1 while a wreck has no drawn body over it (the cage's bottom has no node there: a bumper's rounded corner), so it is no point. */
export const BELLY_ABSENT = new Uint8Array(PLATFORM.belly.length);
export const HUBS = ["hubFL", "hubFR", "hubRL", "hubRR"] as const;
/** Neighbouring belly points as belly index pairs (along x at one z, along z at one x): where the two stand on different patches,
 *  the belly between them meets that patch's edge (`edgeCross`), as a ramp's crest does between rows half a metre apart. */
export const SEGS: Int16Array = (() => {
  const belly = PLATFORM.belly;
  const pairs = new Int16Array(belly.length * belly.length);
  let m = 0;
  for (let i = 0; i < belly.length; i++) {
    for (let j = i + 1; j < belly.length; j++) {
      const [xi, , zi] = belly[i]!;
      const [xj, , zj] = belly[j]!;
      if (xi !== xj && zi !== zj) continue;
      let between = false;
      for (const [xk, , zk] of belly) {
        if (zi === zj && zk === zi && (xk - xi) * (xk - xj) < 0) between = true;
        if (xi === xj && xk === xi && (zk - zi) * (zk - zj) < 0) between = true;
      }
      if (between) continue;
      pairs[m++] = i;
      pairs[m++] = j;
    }
  }
  return pairs.slice(0, m);
})();
/**
 * A tyre's points that meet side faces (`readTyreSides`), as (across, along) shares of its half-width and radius: its four corners in plan
 * at hub height. A face that stands no higher over the hub than the tyre mounts is its floor (`wheelContact` asks from the hub too); points
 * under the hub met a kerb the tread climbs as a wall.
 */
export const TYRE_POINTS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const;
/** Contacts a body can hold in one slice: its four tyres' spring rows and every tyre point's side row, its points, and a belly segment's edge each. */
export const CONTACTS = 4 * (1 + TYRE_POINTS.length) + POINT_CAPACITY + SEGS.length / 2;
/** A wheel this close (m) to the ground counts as down. */
export const TOUCH = 0.03;
/** Restitution of a body point closing faster than `BOUNCE_V` (m/s); slower contacts and tyres (their springs,
 *  `Suspension`, take a landing) don't bounce. */
export const RESTITUTION = 0.25;
export const BOUNCE_V = 1.5;
/** The closing speed (m/s) from which a contact is a crash, not a touch: into a fixed solid's face (`wallBounce`), or onto another car's top (`CLOSING`). */
export const WALL_CRUSH = 5.5;
/** Friction: the body scraping (the rigid step's and a fixed solid's face, `wallBounce`, and a torn part's metal on any ground: published body drag factors on pavement run 0.4-0.65 g), a tyre across its tread (it rolls freely along it). */
export const MU_BODY = 0.6;
/** Contact is solved at this rate (Hz) however long the physics step (`stepWorld` splits it): a face's crush depth is the slice's own discretisation otherwise (8 % apart at 60 and 240 Hz). */
export const CONTACT_HZ = 480;
/** A top flatter than this (normal's up component: the body's friction cone, `MU_BODY`) holds a body point that comes down on it; a steeper one, met at crash speed, is a car's flank or edge. */
export const HOLDING_NY = 1 / Math.sqrt(1 + MU_BODY * MU_BODY);
/** A tyre on a face this shallow (normal's up component over it: a slope under 70°) pushes and lifts straight up, in its springs and past their stop alike (no drag on the world: the drive grips). A steeper face is a wall: the tyre pushes along its normal. */
export const CLIMB_NY = 0.34;
/** A point at crash speed deeper than this many slices of its closing is not on a top it came down on but inside the car it crossed the plan of (`readPoints`). */
export const SIDE_ENTRY_SLICES = 2;
/** The depth (m) a point may sit past `SIDE_ENTRY_SLICES` slices of closing before it counts as inside: the cage's own fit (a few cm). */
export const SIDE_ENTRY_SLACK = 0.02;

export const _r = new THREE.Vector3();
/** The body's centre of mass in the world, moved through the slice by `moveBody` and then by the solve (`solveRows`). */
export const centreOfMass = new THREE.Vector3();
const _axis = new THREE.Vector3();
export const _dq = new THREE.Quaternion();
export const _eul = new THREE.Euler();
export const UP = new THREE.Vector3(0, 1, 0);
export const _up = new THREE.Vector3();
export const _fd = new THREE.Vector3();
/** A driven car's Euler yaw drifts by up to this (rad) in a rigid turn before it is a tumble (a flip is no heading). */
export const YAW_HOLD = 0.5;
const _qi = new THREE.Quaternion();
export const _x = new THREE.Vector3();
export const _z = new THREE.Vector3();
export const _vp = new THREE.Vector3();
const _rn = new THREE.Vector3();
const _k = new THREE.Vector3();
export const _tn = new THREE.Vector3();
export const R = Array.from({ length: CONTACTS }, () => new THREE.Vector3());
export const _lift = new THREE.Vector3();
/**
 * Scalars the solver hands between its functions (a double passed or returned across a call that is not inlined is boxed, an allocation
 * per call): the impulse `give` and `push` give and the part of it that stops closing, the speed `reach` reads, the closing the weight
 * brings (`weightClosing`) and the depth `bodyContact` takes.
 */
export const _s = new Float64Array(7);
export const S_J = 0;
export const S_JD = 1;
export const S_REACH = 2;
export const S_WEIGHT = 3;
export const S_PEN = 4;
/** How far (m) the farthest loaded body point stands from the centre of mass (`loadPoints`). */
export const S_POINT_REACH = 5;
/** How deep (m) the deepest row a wreck at rest still lifts out of the world's ground stands in it (`solveRows`, this step's car). */
export const S_LIFTING = 6;
export const N = Array.from({ length: CONTACTS }, () => new THREE.Vector3());
/** Per contact: the direction its impulse and its lift go: up for a tyre on a face it can climb, else the face's normal. */
export const DIR = Array.from({ length: CONTACTS }, () => UP);
export const TYRE = Array.from({ length: CONTACTS }, () => false);
export const SOFT = Array.from({ length: CONTACTS }, () => false);
/** Per contact: a wreck's hub floor, which its masses hold where they stand: the lift puts the body up out of it however deep the crush drove it. */
export const HUB = Array.from({ length: CONTACTS }, () => false);
/** Per contact: the face slot it presses (-1 rigid), the car whose top it stands on (-1 the world), how far that point follows its crush, its sink past what holds it. */
export const SLOT = Array.from({ length: CONTACTS }, () => -1);
export const OWN = Array.from({ length: CONTACTS }, () => -1);
export const FOLLOW = Array.from({ length: CONTACTS }, () => 1);
export const SINK = Array.from({ length: CONTACTS }, () => 0);
/** Per tyre in its springs: how far (m, vertical) its spring is pressed past the rest ride, negative while it hangs toward its droop. */
export const PRESS = new Float64Array(CONTACTS);
/** Per tyre in its springs: the share of the body's weight its spring holds at the rest ride, by where the centre of mass stands over the wheels (a quarter each over their middle). */
export const SHARE = new Float64Array(CONTACTS);
/** Per tyre in its springs: the impulse (per unit mass) its spring and damper push with this slice, what its face carries of it. */
export const ASK = new Float64Array(CONTACTS);
/**
 * Per contact of the rigid solve: its normal impulse over the passes; the first contact pressing the same face slot (-1: a rigid
 * surface); and, at that first contact, what the slot carries this slice, the most its contacts asked of it, and their sum in a pass.
 */
export const ACC = new Float64Array(CONTACTS);
export const FIRST = new Int32Array(CONTACTS);
export const ROOM = new Float64Array(CONTACTS);
export const DEMAND = new Float64Array(CONTACTS);
export const SUMF = new Float64Array(CONTACTS);
/**
 * Per contact: the speed (m/s) it closes on its surface at before the solve (0 for a point moving off). Only a contact closing slower than a
 * crash (`WALL_CRUSH`) rests on the car under it (`CarSurfaces.commit`, `restsOn`): a monster's bumper meeting a sedan's bonnet head-on at
 * 55 m/s each rode up it as a ramp, read as resting on it, and the pair's crush never ran.
 */
export const CLOSING = new Float64Array(CONTACTS);
/** Per contact: the speed (m/s) its gap to the surface lets it close at over this slice (0 for a point in the surface). */
export const GAPV = new Float64Array(CONTACTS);
/** A point this close (m) over its surface is a contact already: it is held where it would arrive within the slice, not after it. */
export const SPECULATIVE_GAP = 0.0002;
/** Margin (m) the whole-body clear check keeps for its own rounding against each point's test (both are ~1e-15 of a few metres). */
export const CLEAR_ROUND = 1e-6;
/** Passes of the contact solve over a slice's contacts: a contact parting gives back its rest impulse over them (a sedan on a roof stood still). */
export const PASSES = 12;
/** Passes for a body at rest (what a slice's gravity leaves it, under `REST_SPEED`, as `loose-step.ts` counts rest): 12 left the car-on-car friction unconverged (rebuilt from 0 every slice), and the house of cards' top car crept 0.13 mm in 10 s on the residual. 24 passes crept, 48 stood still. ponytail: more passes at rest, not a warm start; a friction+normal warm start across slices if the rest cost shows in the cost rows. */
export const REST_PASSES = 48;
export const REST_SPEED = (2 * G) / 120;
/** The speed (m/s) a body at rest parts from what it stands in (a wreck from the ground, a tyre from the face it pressed): under `REST_SPEED`, so it stays at rest and may sleep. */
export const GROUND_LIFT_V = REST_SPEED / 3;
/** The most (in G·dt) the solve's change of velocity moves the body within its own slice (half of it, the trapezoid rule). */
export const SOLVE_MOVE_G = 1.5;
/** Per contact: the depth (m) along its normal the lift has still to take out (-Infinity: a row that does not lift). */
export const LEFT = new Float64Array(CONTACTS);
/** Per contact: the belly resting on the world's ground (it only resists, see `stepFree`). */
export const UNDER = Array.from({ length: CONTACTS }, () => false);
/**
 * Per contact: the car whose top it is on when that car is in the rigid step (null: the world's ground, or a car its wheels or its
 * masses hold, which stays put), that car's arm to the point from its centre of mass, and the stepping car's mass over its.
 */
export const HELD = Array.from({ length: CONTACTS }, (): DeformableCar | null => null);
const ARM = Array.from({ length: CONTACTS }, () => new THREE.Vector3());
export const RATIO = new Float64Array(CONTACTS);
/** Per contact: the friction impulse (world, per unit mass) it has given over the passes, held within its friction of `ACC`. */
export const FRA = Array.from({ length: CONTACTS }, () => new THREE.Vector3());
/**
 * Per contact this slice: the closing its own gravity and the weight borne on the stepping car bring there, left to stop against the car
 * under as fixed (a tyre in its springs: its quarter of the weight), and the impulse beyond it that moved that car at once.
 */
export const REST = new Float64Array(CONTACTS);
export const DYN = new Float64Array(CONTACTS);
/** Per contact this slice: the rest impulse it has taken (its share of stopping gravity and the borne weight), given back as it parts. */
export const RIMP = new Float64Array(CONTACTS);
/** The weight borne on the stepping car since its last step (`CarSurfaces.takeBorne`): its velocity and spin change. */
export const _lv = new THREE.Vector3();
export const _lw = new THREE.Vector3();
/** The body's velocity before the slice's gravity and solve (its centre moves by it), and the change the solve made. */
export const _vMove = new THREE.Vector3();
export const _dvSolve = new THREE.Vector3();
/** Per belly point (`POINTS` index) this slice: its world position, its rise (surface height less its own) and its patch (`patchOf`). */
export const BX = new Float64Array(POINT_CAPACITY);
export const BY = new Float64Array(POINT_CAPACITY);
export const BZ = new Float64Array(POINT_CAPACITY);
export const BRISE = new Float64Array(POINT_CAPACITY);
export const BPATCH = new Float64Array(POINT_CAPACITY);
/** Per belly point this slice: 1 while its reading is not taken (nothing stands within its slice's travel of it, `readBelly`). */
export const UNREAD = new Uint8Array(POINT_CAPACITY);
/** The surfaces of a car in no world (a bare harness): the world's ground alone. */
export const LOCAL = new CarSurfaces();
export const HIT = new Float64Array(HIT_SIZE);
/** The query point `pointContact` is asked (world x, z and the asking height y). */
export const PQ = new Float64Array(PQ_SIZE);
PQ[PQ_BODY] = 1;
/** Per contact: its Coulomb coefficient against its face (a car's body or a torn part `MU_BODY`, a tyre's `MU_TYRE`). */
export const MU = new Float64Array(CONTACTS);
/**
 * Per car-owned contact the rows of a solve exchange momentum with a car (`HELD`): whether `noteClosing` has read it this solve, the speed
 * (m/s) its point first closed on the car at along the row's plan normal (`CLOSE_FIRST`, the way the pair contact reads a closing: the
 * horizontal one), and the point in the world (`CRUSH_POINT`, x y z). `collectCrush` turns them into the hit each car's crush is armed with.
 */
export const NOTED = new Uint8Array(CONTACTS);
export const CLOSE_FIRST = new Float64Array(CONTACTS);
export const CRUSH_POINT = new Float64Array(CONTACTS * 3);
export const _crushPoint = new THREE.Vector3();
export const _crushNormal = new THREE.Vector3();
export const _crushBack = new THREE.Vector3();

/** A torn part or popped wheel of car `own` met car `top`'s top (`stepLoose`): what moved it is in the world, which a highlight clip with `own` must keep. */
export type TopMet = (own: number, top: number) => void;
const NO_MET: TopMet = () => {};

/**
 * The body the rigid step moves, set by `bindBody`. Every body takes the same step (`moveBody`, `placeBody`, `readPoints`, `openRows`,
 * `solveRows`): `stepFree` adds a car's tyres, springs, belly and face budgets between them, `stepLoose` a part's sleep and its gating
 * of the point reads. `q`, `pos`, `v`, `w` are the body's own pose and its velocity and spin (unit mass), `centre` its centre of mass in
 * its own frame, `invI` its inverse inertia per unit mass about its own axes, `skip` its slot asked of the world, `surf` the faces it
 * shares with other cars, `mass` its mass over theirs. `driven`, `parked`, `powered` are a car's drive state (its tyres' friction),
 * `nearing` that a point not yet in a surface reaches it within the slice at its closing speed, `met` what a part's point on a car's top reports,
 * `panel` that the part is a torn panel (`stepLoose` with its mass), not a popped wheel.
 */
export const body = {
  q: new THREE.Quaternion(),
  pos: new THREE.Vector3(),
  v: new THREE.Vector3(),
  w: new THREE.Vector3(),
  centre: PLATFORM.centre,
  invI: PLATFORM.invI,
  skip: -1,
  part: false,
  dt: 0,
  wreck: false,
  surf: LOCAL,
  mass: 0,
  driven: false,
  parked: false,
  powered: false,
  nearing: false,
  met: NO_MET,
  panel: false,
};

/**
 * Points the rigid step at the body whose pose is `object`'s, with its velocity `v` and spin `w` (unit mass), its centre of mass `centre`
 * in its own frame and its inverse inertia `invI`, asked of the world as slot `skip`, for a slice of `dt` s. A `part` (a torn panel, a
 * popped wheel) meets a prism's side face through rows of its own, takes a car's top for the world (no face budget, no weight on that
 * car) and rubs at a locked tyre's μ times its face's grip, a torn panel (`panel`) at the body's `MU_BODY`; a car's tyres, belly and `sideContact` do all that.
 */
export function bindBody(object: THREE.Object3D, v: THREE.Vector3, w: THREE.Vector3, centre: THREE.Vector3, invI: THREE.Vector3, skip: number, part: boolean, dt: number): void {
  body.q = object.quaternion;
  body.pos = object.position;
  body.v = v;
  body.w = w;
  body.centre = centre;
  body.invI = invI;
  body.skip = skip;
  body.part = part;
  body.dt = dt;
  body.wreck = false;
  body.surf = LOCAL;
  body.mass = 0;
  body.driven = false;
  body.parked = false;
  body.powered = false;
  body.nearing = false;
  body.met = NO_MET;
  body.panel = false;
  // No car under it bears weight onto it (`takeBorne` sets these for a car).
  if (part) {
    _lv.set(0, 0, 0);
    _lw.set(0, 0, 0);
  }
}

/**
 * The body through the slice's start: its centre of mass moves by the slice's start velocity, and by half the change the solve makes
 * (the trapezoid rule, `SOLVE_MOVE_G`) after: a body moved before solving crept down a 10° wedge by g sin(a) dt² every slice, 14-39
 * mm/s with its tyres holding. Its velocity takes the slice's gravity, and it turns about its centre by its spin.
 */
export function moveBody(): void {
  const { q, pos, v, w, dt, centre } = body;
  _vMove.copy(v);
  v.y -= G * dt;
  centreOfMass.copy(_r.copy(centre).applyQuaternion(q)).add(pos).addScaledVector(_vMove, dt);
  const spin = w.length();
  if (spin > 1e-9) q.premultiply(_dq.setFromAxisAngle(_axis.copy(w).divideScalar(spin), spin * dt));
}

/** The body's origin where its centre of mass is, for its orientation (after the solve: a car's `CarSurfaces.commit` reads its pose from before it). */
export function standAtCentre(): void {
  body.pos.copy(centreOfMass).sub(_r.copy(body.centre).applyQuaternion(body.q));
}

/** The moved body settled at its orientation: the inverse of it (`_qi`, read by the solve) and its origin at its centre of mass. */
export function placeBody(): void {
  _qi.copy(body.q).invert();
  standAtCentre();
}

/** Contact `n` (its arm `R[n]` set) on car `own`'s top (-1: the world's ground): the car that takes its reaction (`HELD`), for a stepping car of `mass`. */
export function carrier(surf: CarSurfaces, n: number, own: number, mass: number): void {
  const o = own >= 0 ? surf.cars[own]! : null;
  if (o === null || !o.rigid) {
    HELD[n] = null;
    return;
  }
  HELD[n] = o;
  RATIO[n] = mass / o.deform.totalMass;
  ARM[n]!.copy(centreOfMass).add(R[n]!).sub(o.group.position).sub(_r.set(0, centreY(o), 0).applyQuaternion(o.group.quaternion));
}

/** World inverse inertia (body orientation `q`, its inverse `qi`; `inertia` its inverse inertia per unit mass about its own axes) applied to `x` in place. */
export function invInertia(x: THREE.Vector3, q: THREE.Quaternion, qi: THREE.Quaternion, inertia: THREE.Vector3): THREE.Vector3 {
  return x.applyQuaternion(qi).multiply(inertia).applyQuaternion(q);
}

/** Impulse `_s[S_J]` along unit `dir` at `r` (from the centre of mass) on unit mass `v`, `w`. */
export function push(v: THREE.Vector3, w: THREE.Vector3, q: THREE.Quaternion, r: THREE.Vector3, dir: THREE.Vector3): void {
  const j = _s[S_J]!;
  v.addScaledVector(dir, j);
  w.addScaledVector(invInertia(_rn.crossVectors(r, dir), q, _qi, body.invI), j);
}

const _ov = new THREE.Vector3();
const _qo = new THREE.Quaternion();
/** Contact `c`'s point velocity on the stepping body (`v`, `w`) against its surface, into `out`: the top of a car in the rigid step moves with that car. */
export function pointVel(c: number, v: THREE.Vector3, w: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  out.crossVectors(w, R[c]!).add(v);
  const o = HELD[c];
  if (o !== null) out.sub(_ov.crossVectors(o.angular, ARM[c]!).add(o.velocity));
  return out;
}

/**
 * Impulse `j` along unit `dir` at contact `c` on the stepping body (unit mass `v`, `w`, orientation `q`), and its reaction at the same
 * point on the car under it (`HELD`), centre and spin both: the part `jd` that stops closing beyond this slice's weight at once, the
 * weight's part (`j - jd`) borne on it for its next step (`CarSurfaces.bear`), which its own contacts then hold and bear on. Taken at
 * that car's centre alone, a load off the middle of its roof never turned it, and a car turning back under a still rider lifted it
 * 48 mm in 0.1 s (329 J) on 54 J of its own spin.
 */
export function give(c: number, v: THREE.Vector3, w: THREE.Vector3, q: THREE.Quaternion, dir: THREE.Vector3, surf: CarSurfaces): void {
  const j = _s[S_J]!;
  const jd = _s[S_JD]!;
  push(v, w, q, R[c]!, dir);
  const o = HELD[c];
  if (o === null) return;
  const oq = o.group.quaternion;
  invInertia(_rn.crossVectors(ARM[c]!, dir), oq, _qo.copy(oq).invert(), o.frame.invI);
  o.velocity.addScaledVector(dir, -jd * RATIO[c]!);
  o.angular.addScaledVector(_rn, -jd * RATIO[c]!);
  if (j !== jd) surf.bear(OWN[c]!, dir, _rn, (jd - j) * RATIO[c]!);
}

/**
 * Unit-mass impulse per m/s of contact `c`'s closing speed along unit `dir`: 1 / (1 + dir · (I⁻¹(r × dir) × r)) for the stepping body,
 * with `both` the car under it (`HELD`) taking its share. Stopping the rider alone against a car of its own weight handed that car the
 * whole closing speed: an elastic pair, and a stack whose cars never came to rest.
 */
export function reach(c: number, dir: THREE.Vector3, along: THREE.Vector3, q: THREE.Quaternion, both: boolean): void {
  const own = along.dot(dir) + _k.crossVectors(invInertia(_rn.crossVectors(R[c]!, dir), q, _qi, body.invI), R[c]!).dot(along);
  let other = 0;
  const o = HELD[c];
  if (both && o !== null) {
    const oq = o.group.quaternion;
    other = RATIO[c]! * (along.dot(dir) + _k.crossVectors(invInertia(_rn.crossVectors(ARM[c]!, dir), oq, _qo.copy(oq).invert(), o.frame.invI), ARM[c]!).dot(along));
  }
  _s[S_REACH] = 1 / (own + other);
}

/** The speed (m/s) contact `c` closes at over a slice `dt` from its body's gravity and the weight borne on it (`takeBorne`): what it carries at rest. */
export function weightClosing(c: number): void {
  _s[S_WEIGHT] = Math.max(0, -_vp.crossVectors(_lw, R[c]!).add(_lv).addScaledVector(UP, -G * body.dt).dot(N[c]!));
}

const WHEELS = PLATFORM.wheels.length;
const AUGMENTED_STRIDE = WHEELS + 1;
/** The tyre springs' system for the slice: matrix, right side, the tyres still pushing, their rows, the augmented rows and the solution. */
const SPRING_LHS = new Float64Array(WHEELS * WHEELS);
const SPRING_RHS = new Float64Array(WHEELS);
const SPRING_PUSHING = Array.from({ length: WHEELS }, () => false);
const SPRING_ROW = new Int32Array(WHEELS);
const SPRING_AUGMENTED = new Float64Array(WHEELS * AUGMENTED_STRIDE);
const SPRING_SOLUTION = new Float64Array(WHEELS);
/** Per tyre: the spin one unit of impulse straight up at it gives the body (the body's inverse inertia on its arm × up). */
const SPIN_PER_PUSH = Array.from({ length: WHEELS }, () => new THREE.Vector3());

/** `SPRING_LHS` x = `SPRING_RHS` over the tyres still pushing, into `ASK` (Gaussian elimination: the matrix is the identity plus a positive-definite response). */
function solveSpringSystem(tyres: number): void {
  let rows = 0;
  for (let c = 0; c < tyres; c++) if (SPRING_PUSHING[c]) SPRING_ROW[rows++] = c;
  for (let a = 0; a < rows; a++) {
    for (let b = 0; b < rows; b++) SPRING_AUGMENTED[a * AUGMENTED_STRIDE + b] = SPRING_LHS[SPRING_ROW[a]! * WHEELS + SPRING_ROW[b]!]!;
    SPRING_AUGMENTED[a * AUGMENTED_STRIDE + rows] = SPRING_RHS[SPRING_ROW[a]!]!;
  }
  for (let pivot = 0; pivot < rows; pivot++) {
    const diagonal = SPRING_AUGMENTED[pivot * AUGMENTED_STRIDE + pivot]!;
    for (let r = pivot + 1; r < rows; r++) {
      const factor = SPRING_AUGMENTED[r * AUGMENTED_STRIDE + pivot]! / diagonal;
      for (let col = pivot; col <= rows; col++) SPRING_AUGMENTED[r * AUGMENTED_STRIDE + col] = SPRING_AUGMENTED[r * AUGMENTED_STRIDE + col]! - factor * SPRING_AUGMENTED[pivot * AUGMENTED_STRIDE + col]!;
    }
  }
  for (let a = rows - 1; a >= 0; a--) {
    let rest = SPRING_AUGMENTED[a * AUGMENTED_STRIDE + rows]!;
    for (let b = a + 1; b < rows; b++) rest -= SPRING_AUGMENTED[a * AUGMENTED_STRIDE + b]! * SPRING_SOLUTION[b]!;
    SPRING_SOLUTION[a] = rest / SPRING_AUGMENTED[a * AUGMENTED_STRIDE + a]!;
  }
  for (let a = 0; a < rows; a++) ASK[SPRING_ROW[a]!] = SPRING_SOLUTION[a]!;
}

/**
 * The tyres in their springs push together, `ASK[c]` each (impulse per unit mass): `dt (G share + stiff x + damp u)` with u the press rate
 * of the slice's start and x the press at the end of it, after every tyre's push, moved by half the rate's change (the trapezoid rule
 * of the slice's move). One linear system over the four tyres, so no tyre's push depends on the order they are listed in, and a stiff
 * spring cannot swing the body from one side to the other every slice (the push of the slice's start state did: the roll mode of a
 * 24 Hz spring at 120 Hz, a limit cycle of 0.09°). A tyre the system would pull is left out and the rest solved again.
 */
export function springPushes(frame: CarFrame, tyres: number, stiff: number, damp: number, dt: number, q: THREE.Quaternion, v: THREE.Vector3, w: THREE.Vector3): void {
  const endForce = 0.5 * dt * stiff;
  for (let d = 0; d < tyres; d++) {
    SPRING_PUSHING[d] = SOFT[d]!;
    if (SOFT[d]) invInertia(SPIN_PER_PUSH[d]!.crossVectors(R[d]!, UP), q, _qi, frame.invI);
  }
  for (let c = 0; c < tyres; c++) {
    if (!SOFT[c]) continue;
    const rising = N[c]!.y > 0;
    const gravityRate = rising ? G * dt : 0;
    const startRate = rising ? -pointVel(c, v, w, _vp).dot(N[c]!) / N[c]!.y - G * dt : 0;
    SPRING_RHS[c] = dt * (SHARE[c]! * G + stiff * (PRESS[c]! + 0.5 * dt * gravityRate) + damp * startRate);
    for (let d = 0; d < tyres; d++) {
      const response = rising && SOFT[d] ? (N[c]!.y + _k.crossVectors(SPIN_PER_PUSH[d]!, R[c]!).dot(N[c]!)) / N[c]!.y : 0;
      SPRING_LHS[c * WHEELS + d] = (c === d ? 1 : 0) + dt * endForce * response;
    }
  }
  for (let round = 0; round < tyres; round++) {
    solveSpringSystem(tyres);
    let pulled = false;
    for (let c = 0; c < tyres; c++) {
      if (!SPRING_PUSHING[c] || ASK[c]! >= 0) continue;
      SPRING_PUSHING[c] = false;
      ASK[c] = 0;
      pulled = true;
    }
    if (!pulled) break;
  }
}
