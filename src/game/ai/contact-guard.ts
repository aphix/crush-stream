import { hypot2, detSin, detCos, detAtan2 } from "../kernel/physics-core.js";
import type { DriveInput } from "../vehicle/car-drive.ts";
import { DERBY_RULES, type AiCar } from "./derby-ai.ts";
import { clamp } from "../kernel/scalar.ts";
import { GUARD_BRAKE_IDX, GUARD_DT_IDX, GUARD_LEAD_IDX, GUARD_NEED_IDX, GUARD_PUSH_IDX, GUARD_STEER_NEED_IDX, GUARD_TURN_IDX } from "./constants.ts";

/** Seconds ahead the guard looks for a contact, in steps of `STEP`. */
const HORIZON = 1.5;
const STEP = 0.1;
/** Half-axes (m) of the contact zone around a car, in its own frame (a car is 1.9 × 4.6 m: the zone is the car plus 0.5 m at the sides and 1.4 m at the ends). */
const LAT = 2.4;
const LON = 6;
/** Closing speed (m/s) at a contact that is a nudge, not a hit (3/4 of the derby's own hit threshold): a car edging round a stopped one is not held in front of it. */
const TAP = DERBY_RULES.hitSpeed * 0.75;
/** Sideways acceleration (m/s²) a car can steer away with. */
const STEER_ACC = 6;
/** The most the guard moves the wheel (of full lock): a nudge to clear a side-swipe, never a swerve off the road or the route. */
const STEER_CAP = 0.35;
/** A yaw rate (rad/s) under this is a straight line. */
const STRAIGHT = 1e-3;
/** Seconds the steer push fades over once the look-ahead stops finding the contact: a grazing path flips contact/none on the 0.1 s grid, and an instant release rocked the wheel at the step rate. */
const PUSH_RELEASE_S = 0.3;
/** Share of full lock a second the push moves toward what the look-ahead asks. */
const PUSH_RATE = 3.5;
/** The braking demand comes at once and fades over `NEED_RELEASE_S`; the share of it that straightens the steer rises at `NEED_STEER_RATE` a second (instant, it flipped gas and brake 4 to 8 times a second). */
const NEED_RELEASE_S = 0.3;
const NEED_STEER_RATE = 4;
/** A held push or demand under this (of full lock or brake) is gone. */
const PUSH_FLOOR = 0.002;

/**
 * The look-ahead's sample times: 0 to `HORIZON` in steps of `STEP`, accumulated as the first version of the guard did. The last,
 * 1.5000000000000002 s, is not under `HORIZON`, so a contact first met there is not acted on: the guard acts on contacts within 1.4 s.
 */
const TIMES = sampleTimes();
const STEPS = TIMES.length;
/** Where the guarded car is (`DX`, `DZ`: its displacement), which way it points (`GX`, `GZ`) and how it moves (`VX`, `VZ`) at each sample time, filled once per call. */
const DX = new Float64Array(STEPS);
const DZ = new Float64Array(STEPS);
const GX = new Float64Array(STEPS);
const GZ = new Float64Array(STEPS);
const VX = new Float64Array(STEPS);
const VZ = new Float64Array(STEPS);

function sampleTimes(): Float64Array {
  const times: number[] = [];
  for (let t = 0; t <= HORIZON + 1e-9; t += STEP) times.push(t);
  return Float64Array.from(times);
}

/**
 * The last rule of every racing drive: do not drive into a car you are closing on. The guarded car is followed at its
 * speed round the arc its steer asks for (`turn`: yaw rate at full lock, rad/s), each car of `cars` (ids below `count`) that
 * is not `spare[id]` (the ones the driver means to hit) in the line it is driving, shedding speed at `lead` (m/s²: the leader's whole class brake, the hardest it can shed
 * speed, which only raises the closing speed); `HORIZON` s on, the first moment the
 * guarded car and the other overlap, each wearing the contact zone, is the contact. The soonest contact is steered clear of
 * (by its off-centre share, or in full while there is time to move sideways out of the zone: `STEER_ACC`) and every contact
 * ahead that steering cannot clear is braked for, at the deceleration that takes the closing speed off, down to a `TAP`,
 * in the time left (`brake`, m/s²). A pair already touching and moving apart is left to the physics. No allocation.
 * `brake`, `lead` and `turn` come in the `tune` buffer (`GUARD_*_IDX`). `steer`: the wheel the driver asked for, which the arc is
 * worked out on; `out.steer` is where its hands have the wheel now (`InputFade` lags the ask), and an arc on it reached a car
 * the driver was steering into 0.05 s late.
 *
 * Cost: the guarded car's own arc is worked out once, and only when some other car is near enough to reach it: a pair
 * whose centres are further apart than the zone plus what the two cars can close in `HORIZON` s (their speeds added) cannot touch.
 */
export function guardContact(self: AiCar, cars: readonly AiCar[], count: number, spare: Uint8Array, tune: Float64Array, out: DriveInput, steer = out.steer): void {
  const brake = tune[GUARD_BRAKE_IDX]!;
  const lead = tune[GUARD_LEAD_IDX]!;
  const turn = tune[GUARD_TURN_IDX]!;
  const nose = self.yaw;
  const sx = self.vx;
  const sz = self.vz;
  const speed = hypot2(sx, sz);
  // A nudge cannot start a hit, and a crawl is the plan's business.
  if (speed <= DERBY_RULES.hitSpeed) {
    tune[GUARD_PUSH_IDX] = 0;
    tune[GUARD_NEED_IDX] = 0;
    tune[GUARD_STEER_NEED_IDX] = 0;
    return;
  }
  const heading = detAtan2(sx, sz);
  const omega = steer * turn;
  const straight = Math.abs(omega) < STRAIGHT;
  const last = TIMES[STEPS - 1]!;
  let arc = false;
  let soonest = HORIZON;
  let lateral = 0;
  let offset = 0;
  let steerable = false;
  // The hardest braking any car ahead calls for, as a share of `brake`: the deceleration that takes its closing speed off in the time left.
  let need = 0;
  for (let k = 0; k < count; k++) {
    const o = cars[k]!;
    if (o.id === self.id || !o.alive || spare[o.id] === 1) continue;
    const ospeed = hypot2(o.vx, o.vz);
    // Out of reach: the two centres are further apart than the zone and the most they can close in `HORIZON` s.
    const gap = hypot2(o.x - self.x, o.z - self.z) - (speed + ospeed) * last;
    if (gap >= LON) continue;
    if (!arc) {
      arc = true;
      // Each step's heading and nose are the start's turned by `turned`: one sine and cosine of the turn per step, rotated in by the
      // angle-sum identities, instead of a sine and cosine for every sum.
      const ch = detCos(heading);
      const sh = detSin(heading);
      const cosNose = detCos(nose);
      const sinNose = detSin(nose);
      for (let i = 0; i < STEPS; i++) {
        const t = TIMES[i]!;
        const turned = omega * t;
        const ct = detCos(turned);
        const st = detSin(turned);
        const sinH = sh * ct + ch * st;
        const cosH = ch * ct - sh * st;
        DX[i] = straight ? sx * t : (speed / omega) * (ch - cosH);
        DZ[i] = straight ? sz * t : (speed / omega) * (sinH - sh);
        GX[i] = sinNose * ct + cosNose * st;
        GZ[i] = cosNose * ct - sinNose * st;
        VX[i] = straight ? sx : speed * sinH;
        VZ[i] = straight ? sz : speed * cosH;
      }
    }
    // `prev`: the zone metric at the last step (2 = outside before the first); `tc` < 0 until a contact is found.
    let prev = 2;
    let tc = -1;
    let cn = 0;
    let cl = 0;
    let cw = 0;
    let n0 = 0;
    let l0 = 0;
    const ox = ospeed > 0.1 ? o.vx / ospeed : detSin(o.yaw);
    const oz = ospeed > 0.1 ? o.vz / ospeed : detCos(o.yaw);
    for (let i = 0; i < STEPS; i++) {
      const t = TIMES[i]!;
      // The other keeps its heading and sheds speed at `lead` (a car ahead braking for what it sees), down to a stop.
      const te = Math.min(t, ospeed / lead);
      const shed = ospeed * te - 0.5 * lead * te * te;
      const rx = o.x + ox * shed - self.x - DX[i]!;
      const rz = o.z + oz * shed - self.z - DZ[i]!;
      const pn = rx * GX[i]! + rz * GZ[i]!;
      const pl = rx * GZ[i]! - rz * GX[i]!;
      // The zone is a car-shaped ellipse around either car: crossing traffic is long across the guarded car's path.
      const qn = -(rx * ox + rz * oz);
      const ql = -(rx * oz - rz * ox);
      const m = Math.min((pl / LAT) ** 2 + (pn / LON) ** 2, (ql / LAT) ** 2 + (qn / LON) ** 2);
      if (i === 0) {
        n0 = pn;
        l0 = pl;
      }
      if (prev < 1) {
        // Inside at t = 0: a contact now if it is still closing a step on, else the physics' business.
        if (m < prev) {
          tc = 0;
          cn = n0;
          cl = l0;
          cw = hypot2(ox * ospeed - VX[0]!, oz * ospeed - VZ[0]!);
        }
        break;
      }
      if (i > 0 && m < 1) {
        // The closing speed at the contact: the other's speed then, against the guarded car's.
        const ov = Math.max(0, ospeed - lead * t);
        tc = t;
        cn = pn;
        cl = pl;
        cw = hypot2(ox * ov - VX[i]!, oz * ov - VZ[i]!);
        break;
      }
      // Moving apart from outside the zone: nothing further out is a contact.
      if (i > 0 && m > prev) break;
      prev = m;
    }
    if (tc < 0) continue;
    // The sideways room the car can make by then: a contact it can steer clear of is not braked for.
    const room = 0.5 * STEER_ACC * tc * tc;
    const clear = room >= LAT - Math.abs(cl);
    if (cn > 0 && !clear) need = Math.max(need, Math.max(0, cw - TAP) / (2 * Math.max(tc, 0.05) * brake));
    if (tc < soonest) {
      soonest = tc;
      lateral = cl;
      offset = clamp(Math.abs(cl) / LAT, 0, 1);
      steerable = clear;
    }
  }
  if (soonest >= HORIZON) {
    releasePush(tune, out);
    return;
  }
  need = holdNeed(tune, clamp(need, 0, 1));
  const steerNeed = riseNeed(tune, need);
  // Braking hard is straight-line work (a steered, locked car sheds speed slowly), so the steer-away gives way to it, and a
  // steer toward the car (its side is the sign of `lateral`) is straightened out as the braking gets harder.
  const u = STEER_CAP * clamp(2 * (1 - soonest / HORIZON), 0, 1) * (steerable ? 1 : offset) * (1 - need);
  const toward = lateral >= 0 ? out.steer > 0 : out.steer < 0;
  const target = lateral >= 0 ? -u : u;
  const push = tune[GUARD_DT_IDX]! > 0 ? holdPush(tune, target) : target;
  tune[GUARD_PUSH_IDX] = push;
  out.steer = clamp((toward ? out.steer * (1 - steerNeed) : out.steer) * (1 - Math.abs(push)) + push, -1, 1);
  brakeFor(out, need, soonest <= 0);
}

/** The steer push held from the calls before, faded by this call's step; a one-off call (step 0) holds nothing, or a wreck would steer on its last contact's push for good. */
function heldPush(tune: Float64Array): number {
  const dt = tune[GUARD_DT_IDX]!;
  return dt > 0 ? tune[GUARD_PUSH_IDX]! * Math.exp(-dt / PUSH_RELEASE_S) : 0;
}

/** The push this call steers with: it moves toward `target` at `PUSH_RATE`, a smaller one on the same side is only reached as the held push fades, so the wheel never jumps by the look-ahead's grid. */
function holdPush(tune: Float64Array, target: number): number {
  const held = heldPush(tune);
  if (held * target >= 0 && Math.abs(target) <= Math.abs(held)) return held;
  const step = PUSH_RATE * tune[GUARD_DT_IDX]!;
  return Math.abs(target - held) <= step ? target : held + Math.sign(target - held) * step;
}

/** No contact ahead: what is left of the held push still steers, and fades. */
function releasePush(tune: Float64Array, out: DriveInput): void {
  const held = heldPush(tune);
  const push = Math.abs(held) < PUSH_FLOOR ? 0 : held;
  tune[GUARD_PUSH_IDX] = push;
  if (push !== 0) out.steer = clamp(out.steer * (1 - Math.abs(push)) + push, -1, 1);
  const need = holdNeed(tune, 0);
  tune[GUARD_STEER_NEED_IDX] = 0;
  brakeFor(out, need, false);
}

/** Throttle off and brake on for a braking demand `need`; a real stop (over half) or any demand `now` takes the brake and the gas off, a braking car gives up its boost. */
function brakeFor(out: DriveInput, need: number, now: boolean): void {
  if (need <= 0) return;
  out.throttle *= 1 - need;
  if (need > 0.5 || now) {
    out.brake = Math.max(out.brake, need);
    out.throttle = 0;
  }
  if (need > 0.1) out.boost = false;
}

/** The demand this call acts on: `need` at once if above the held one, else the held one faded; with no step to fade by, `need` itself. */
function holdNeed(tune: Float64Array, need: number): number {
  const dt = tune[GUARD_DT_IDX]!;
  const held = dt > 0 ? tune[GUARD_NEED_IDX]! * Math.exp(-dt / NEED_RELEASE_S) : 0;
  const next = Math.max(need, held < PUSH_FLOOR ? 0 : held);
  tune[GUARD_NEED_IDX] = next;
  return next;
}

/** The share of the demand the steer is straightened by: falls at once, rises at `NEED_STEER_RATE` a second. */
function riseNeed(tune: Float64Array, need: number): number {
  const dt = tune[GUARD_DT_IDX]!;
  const held = tune[GUARD_STEER_NEED_IDX]!;
  const next = dt > 0 && need > held ? Math.min(need, held + NEED_STEER_RATE * dt) : need;
  tune[GUARD_STEER_NEED_IDX] = next;
  return next;
}
