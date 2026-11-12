import { detAtan2, hypot2 } from "../../kernel/physics-core.js";
import { ALARM_DELAY_STEPS_PER_SECOND, CAR_OUT_TICKS, CENTIMETRES_PER_METRE, DECISION_HZ, EVADE_HOLD_SECONDS, EVADE_PACE_CALM, EVADE_PACE_JUMPY, EVADE_REACH, LATERAL_FADE_DISTANCE, MAX_PATH_NODES, NEVER_TICK, RESIDENT_FLOAT, RESIDENT_FLOAT_STRIDE, RESIDENT_INT, RESIDENT_INT_STRIDE } from "./civilian-constants.ts";
import type { CityState } from "./civilian-state.ts";
import { residentNeuroticism } from "./civilian-temperament.ts";
import { isCrossingBetween } from "./society-crossing.ts";

/** Where a walker is and which way it faces (heading 0 = +Z, positive toward +X): the out parameter of the position functions. */
export class LegPose {
  x = 0;
  z = 0;
  dirX = 0;
  dirZ = 1;
  yaw = 0;
  /** Metres a second along `dirX`, `dirZ` (the way the path runs): the leg's pace, 0 while waiting, negative going back along it; and whether it is clearing a danger (so not as its schedule has it). */
  speed = 0;
  evading = false;
  /** Whether the walker is held at a kerb for a walk light (its speed then 0). */
  waiting = false;
  /** What `evadeAlarm` is given and hands back, as fields: a double passed to a call that is not inlined is boxed. */
  clock = 0;
  walked = 0;
  /** The nodes of the path she is between, the one she left and the one she walks to. */
  from = 0;
  to = 0;
}

/**
 * The metres the leg's schedule has walked at `out.clock` (written to `out.walked`), with its waits at kerbs for a walk light: each holds the walker at its node while it lasts, and what is walked after it is that much later
 * (`out.waiting` says they are held now). Held in fields, not arguments and a result: a double passed to or returned from a call that is not inlined is boxed.
 */
function waitedWalk(state: CityState, resident: number, out: LegPose): void {
  const { ints, floats, pathDistance } = state;
  const intBase = resident * RESIDENT_INT_STRIDE;
  const first = resident * MAX_PATH_NODES;
  const pace = floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed]!;
  const elapsed = out.clock - ints[intBase + RESIDENT_INT.departTick]! / DECISION_HZ;
  const waits = ints[intBase + RESIDENT_INT.waitCount]!;
  let lost = 0;
  out.waiting = false;
  for (let wait = 0; wait < waits; wait++) {
    const distance = pathDistance[first + ints[intBase + RESIDENT_INT.waitIndex0 + wait]!]!;
    const reach = distance / pace + lost;
    const held = ints[intBase + RESIDENT_INT.waitTicks0 + wait]! / DECISION_HZ;
    if (elapsed < reach) {
      out.walked = pace * (elapsed - lost);
      return;
    }
    if (elapsed < reach + held) {
      out.walked = distance;
      out.waiting = true;
      return;
    }
    lost += held;
  }
  out.walked = pace * (elapsed - lost);
}

/**
 * A walker on a road crossing when a hazard was seen near it (its row's `alarmTick`, the moment it noticed, and the spot): `out.walked` (on the schedule, at `out.clock`) is where it really is, clearing the road to the nearer
 * kerb at a hurry or a run by its neuroticism, `out.speed` how fast it goes (negative backwards) and `out.evading` that it is not on its schedule. Ahead: it runs to the kerb and waits for the schedule to come level. Behind: it
 * runs back, waits `EVADE_HOLD_SECONDS`, and runs forward to meet the schedule. A pure function of the row and the time.
 */
function evadeAlarm(state: CityState, resident: number, out: LegPose): void {
  const { ints, floats, pathNodes, pathDistance } = state;
  const { nodeX, nodeZ } = state.map.graph;
  const intBase = resident * RESIDENT_INT_STRIDE;
  const first = resident * MAX_PATH_NODES;
  const pace = floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed]!;
  const departSeconds = ints[intBase + RESIDENT_INT.departTick]! / DECISION_HZ;
  const startSeconds = ints[intBase + RESIDENT_INT.alarmTick]! / DECISION_HZ + ints[intBase + RESIDENT_INT.alarmDelay]! / ALARM_DELAY_STEPS_PER_SECOND;
  const since = out.clock - startSeconds;
  if (since < 0 || startSeconds <= departSeconds) return;
  const count = ints[intBase + RESIDENT_INT.pathCount]!;
  let there = pace * (startSeconds - departSeconds);
  if (ints[intBase + RESIDENT_INT.waitCount]! > 0) {
    const nowClock = out.clock;
    const nowWalked = out.walked;
    const nowWaiting = out.waiting;
    out.clock = startSeconds;
    waitedWalk(state, resident, out);
    there = out.walked;
    out.clock = nowClock;
    out.walked = nowWalked;
    out.waiting = nowWaiting;
  }
  if (there >= pathDistance[first + count - 1]!) return;
  let step = 0;
  while (step + 2 < count && pathDistance[first + step + 1]! <= there) step++;
  const from = pathNodes[first + step]!;
  const to = pathNodes[first + step + 1]!;
  if (!isCrossingBetween(state, from, to)) return;
  const kerbBehind = pathDistance[first + step]!;
  const kerbAhead = pathDistance[first + step + 1]!;
  const share = (there - kerbBehind) / (kerbAhead - kerbBehind);
  const hereX = nodeX[from]! + (nodeX[to]! - nodeX[from]!) * share;
  const hereZ = nodeZ[from]! + (nodeZ[to]! - nodeZ[from]!) * share;
  const alarmDx = hereX - ints[intBase + RESIDENT_INT.alarmX]! / CENTIMETRES_PER_METRE;
  const alarmDz = hereZ - ints[intBase + RESIDENT_INT.alarmZ]! / CENTIMETRES_PER_METRE;
  // Squared and in place: a double handed to `hypot2` is boxed whenever it is not inlined, and this runs every frame for every walker an alarm reaches.
  if (alarmDx * alarmDx + alarmDz * alarmDz > EVADE_REACH * EVADE_REACH) return;
  const run = pace * (EVADE_PACE_CALM + (EVADE_PACE_JUMPY - EVADE_PACE_CALM) * residentNeuroticism(state, resident));
  if (kerbAhead - there <= there - kerbBehind) {
    const dash = Math.min(kerbAhead, there + run * since);
    if (out.walked >= dash) return;
    out.walked = dash;
    out.speed = dash < kerbAhead ? run : 0;
    out.evading = true;
    return;
  }
  const backTime = (there - kerbBehind) / run;
  out.evading = true;
  if (since < backTime) {
    out.walked = there - run * since;
    out.speed = -run;
  } else if (since < backTime + EVADE_HOLD_SECONDS) {
    out.walked = kerbBehind;
    out.speed = 0;
  } else {
    const caught = kerbBehind + run * (since - backTime - EVADE_HOLD_SECONDS);
    if (caught >= out.walked) out.evading = false;
    else {
      out.walked = caught;
      out.speed = run;
    }
  }
}

/**
 * Writes where resident `resident` stands on its leg at crowd time `seconds` into `out`; false when it is not on a leg then (not yet departed, arrived, no leg, or in the car). A pure function of the row and the time: any frame
 * rate, no state, no allocation. A leg by car is a walk to it, standing at it getting in, the drive (nobody on foot), standing at it getting out and a walk from it; the metres walked are worked out here, not in a helper: a helper
 * that returns a number boxes it for every civilian every frame.
 */
export function legPose(state: CityState, resident: number, seconds: number, out: LegPose): boolean {
  const { ints, floats, pathNodes, pathDistance } = state;
  const { nodeX, nodeZ } = state.map.graph;
  const intBase = resident * RESIDENT_INT_STRIDE;
  const count = ints[intBase + RESIDENT_INT.pathCount]!;
  if (count === 0) return false;
  const departSeconds = ints[intBase + RESIDENT_INT.departTick]! / DECISION_HZ;
  if (seconds < departSeconds || seconds >= ints[intBase + RESIDENT_INT.arriveTick]! / DECISION_HZ) return false;
  const first = resident * MAX_PATH_NODES;
  const floatBase = resident * RESIDENT_FLOAT_STRIDE;
  const total = pathDistance[first + count - 1]!;
  const speed = floats[floatBase + RESIDENT_FLOAT.speed]!;
  const leaveTick = ints[intBase + RESIDENT_INT.driveLeaveTick]!;
  let walked = speed * (seconds - departSeconds);
  out.waiting = false;
  if (leaveTick === NEVER_TICK && ints[intBase + RESIDENT_INT.waitCount]! > 0) {
    out.clock = seconds;
    waitedWalk(state, resident, out);
    walked = out.walked;
  }
  if (leaveTick !== NEVER_TICK) {
    const parkSeconds = ints[intBase + RESIDENT_INT.driveParkTick]! / DECISION_HZ;
    if (seconds < leaveTick / DECISION_HZ) walked = Math.min(walked, pathDistance[first + ints[intBase + RESIDENT_INT.driveFirst]!]!);
    else if (seconds < parkSeconds) return false;
    else walked = pathDistance[first + ints[intBase + RESIDENT_INT.driveLast]!]! + speed * Math.max(0, seconds - parkSeconds - CAR_OUT_TICKS / DECISION_HZ);
  }
  out.speed = out.waiting ? 0 : speed;
  out.evading = false;
  if (ints[intBase + RESIDENT_INT.alarmTick] !== NEVER_TICK && leaveTick === NEVER_TICK) {
    out.clock = seconds;
    out.walked = walked;
    evadeAlarm(state, resident, out);
    walked = out.walked;
  }
  walked = Math.min(total, walked);
  let step = 0;
  while (step + 2 < count && pathDistance[first + step + 1]! <= walked) step++;
  const from = pathNodes[first + step]!;
  const to = pathNodes[first + Math.min(step + 1, count - 1)]!;
  out.from = from;
  out.to = to;
  const spanX = nodeX[to]! - nodeX[from]!;
  const spanZ = nodeZ[to]! - nodeZ[from]!;
  const span = hypot2(spanX, spanZ);
  const segment = pathDistance[first + Math.min(step + 1, count - 1)]! - pathDistance[first + step]!;
  const along = segment > 0 ? Math.min(1, (walked - pathDistance[first + step]!) / segment) : 0;
  if (span > 0) {
    out.dirX = spanX / span;
    out.dirZ = spanZ / span;
    out.yaw = out.speed < 0 ? detAtan2(-out.dirX, -out.dirZ) : detAtan2(out.dirX, out.dirZ);
  }
  const fade = Math.max(0, Math.min(1, walked / LATERAL_FADE_DISTANCE, (total - walked) / LATERAL_FADE_DISTANCE));
  const offset = floats[floatBase + RESIDENT_FLOAT.lateral]! * fade;
  out.x = nodeX[from]! + spanX * along + out.dirZ * offset;
  out.z = nodeZ[from]! + spanZ * along - out.dirX * offset;
  return true;
}

/** `legPose` for a walker the crowd shows: also false while the resident is dead or off the street run down (a knock hides them from its tick on, before any answer says so). */
export function legPositionAt(state: CityState, resident: number, seconds: number, out: LegPose): boolean {
  if (state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.alive] === 0) return false;
  const tick = seconds * DECISION_HZ;
  if (tick >= state.hiddenFromTick[resident]! && tick < state.hiddenUntilTick[resident]!) return false;
  return legPose(state, resident, seconds, out);
}
