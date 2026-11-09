import { hypot2 } from "../../kernel/physics-core.js";
import {
  ALARM_DELAY_JITTER_SHARE,
  ALARM_DELAY_MAX_SECONDS,
  ALARM_DELAY_MIN_SECONDS,
  ALARM_DELAY_STEPS,
  ALARM_DELAY_STEPS_PER_SECOND,
  ALARM_SIGHT,
  ATTENTION_DOWNED,
  CALL_MINUTES,
  CENTIMETRES_PER_METRE,
  DECISION_HZ,
  FLAG,
  LOOK_ON_DOWNED_MINUTES,
  NEURO_INDOORS_FLOOR,
  NEURO_INDOORS_SLOPE,
  NEURO_LOOK_ON_FLOOR,
  NEURO_REACT_FLOOR,
  NO_PLACE,
  PURPOSE,
  RESIDENT_INT,
  RESIDENT_INT_STRIDE,
  STREAM,
  TICKS_PER_GAME_MINUTE,
} from "./civilian-constants.ts";
import { residentDraws } from "./civilian-draws.ts";
import { legPose } from "./civilian-leg.ts";
import { EVENT_CODE } from "./civilian-names.ts";
import { standOutside } from "./civilian-plan.ts";
import { logHistory, markDirty, residentName, setVisitMood, type CityState } from "./civilian-state.ts";
import { residentNeuroticism } from "./civilian-temperament.ts";
import { fleeHome, isDwelling, isFreePerson, nearestPlaceTo } from "./society-reactions.ts";
import { isOutdoorPurpose } from "./society-venues.ts";

/** What a resident can see a hazard from: nowhere (indoors, hurt, held, a named resident, in a car), the street they are walking (their spot is in `state.pose`), or the door they stand out at. */
const SEES = { nothing: 0, walking: 1, standing: 2 } as const;

/** What `resident` sees from at `tick`, with where (m) in `state.pose`. */
function seeingFrom(state: CityState, resident: number, tick: number): number {
  if (!isFreePerson(state, resident)) return SEES.nothing;
  const base = resident * RESIDENT_INT_STRIDE;
  if (isDwelling(state, resident, tick)) {
    if (!isOutdoorPurpose(state.ints[base + RESIDENT_INT.legPurpose]!)) return SEES.nothing;
    const door = state.map.places[state.ints[base + RESIDENT_INT.place]!]!;
    state.pose.x = door.doorX;
    state.pose.z = door.doorZ;
    return SEES.standing;
  }
  return legPose(state, resident, tick / DECISION_HZ, state.pose) ? SEES.walking : SEES.nothing;
}

/** A line in the resident's log for what they saw or did, and its mood unless an earlier event's still holds (`setVisitMood`); the row goes out in the answer. */
function noteSight(state: CityState, resident: number, code: number, subject: number, tick: number): void {
  logHistory(state, resident, code, subject, tick);
  setVisitMood(state, resident, code, tick);
  markDirty(state, resident);
}

/** The step of `ALARM_DELAY_STEPS_PER_SECOND` a person of neuroticism `neuroticism` starts reacting on, `jitter` (a unit draw) moving it a share of the span: the jumpiest first, the calmest last. */
function delayStepOf(neuroticism: number, jitter: number): number {
  const slow = (1 - neuroticism) * (1 - ALARM_DELAY_JITTER_SHARE) + jitter * ALARM_DELAY_JITTER_SHARE;
  return Math.round((ALARM_DELAY_MIN_SECONDS + (ALARM_DELAY_MAX_SECONDS - ALARM_DELAY_MIN_SECONDS) * slow) * ALARM_DELAY_STEPS_PER_SECOND);
}

/** The first step at or after `step` (wrapping) that this alarm has not given out, taken; `step` itself when every one is. */
function takeFreeStep(state: CityState, step: number): number {
  for (let ahead = 0; ahead < ALARM_DELAY_STEPS; ahead++) {
    const candidate = (step + ahead) % ALARM_DELAY_STEPS;
    if (state.alarmSlots[candidate] !== 0) continue;
    state.alarmSlots[candidate] = 1;
    return candidate;
  }
  return step;
}

/**
 * A hazard at (x, z) that `victim` (-1: none) is hurt by, seen at `tick`, drawing `attention`: every free person out within `ALARM_SIGHT` looks up by their own seeded draw and neuroticism (the calm often do not), and
 * their row remembers it (`alarmTick` and the moment they noticed: the drawing flinches them, a step back, then). One at a door goes in (the jumpy more than the calm) or looks on for `lookOnMinutes` (the jumpy
 * longer); a walker walks on. Each who reacts has a step of their own to start on.
 */
export function alarmAt(state: CityState, x: number, z: number, tick: number, victim: number, lookOnMinutes: number, attention: number): void {
  const near = nearestPlaceTo(state, x, z, NO_PLACE);
  state.alarmSlots.fill(0);
  for (let resident = 0; resident < state.capacity; resident++) {
    if (resident === victim) continue;
    const sees = seeingFrom(state, resident, tick);
    if (sees === SEES.nothing || hypot2(state.pose.x - x, state.pose.z - z) > ALARM_SIGHT) continue;
    const neuroticism = residentNeuroticism(state, resident);
    const draw = residentDraws(state.seed, resident, STREAM.alarm, tick);
    if (draw() >= (NEURO_REACT_FLOOR + (1 - NEURO_REACT_FLOOR) * neuroticism) * attention) continue;
    const base = resident * RESIDENT_INT_STRIDE;
    state.ints[base + RESIDENT_INT.alarmTick] = tick;
    state.ints[base + RESIDENT_INT.alarmDelay] = takeFreeStep(state, delayStepOf(neuroticism, draw()));
    state.ints[base + RESIDENT_INT.alarmX] = Math.round(x * CENTIMETRES_PER_METRE);
    state.ints[base + RESIDENT_INT.alarmZ] = Math.round(z * CENTIMETRES_PER_METRE);
    state.ints[base + RESIDENT_INT.alarmVictim] = victim;
    noteSight(state, resident, EVENT_CODE.sawDanger, near, tick);
    if (sees === SEES.walking) continue;
    if (draw() < NEURO_INDOORS_FLOOR + NEURO_INDOORS_SLOPE * neuroticism) fleeHome(state, resident, tick);
    else standOutside(state, resident, tick, PURPOSE.lookOn, Math.round(lookOnMinutes * (NEURO_LOOK_ON_FLOOR + neuroticism) * TICKS_PER_GAME_MINUTE));
  }
}

/** Someone run down, seen: the knock's spot is where the alarm is, and the one down is who it is about. */
export function alarmAtKnock(state: CityState, victim: number, tick: number): void {
  if ((state.ints[victim * RESIDENT_INT_STRIDE + RESIDENT_INT.flags]! & FLAG.hurt) === 0) return;
  const base = victim * RESIDENT_INT_STRIDE;
  alarmAt(state, state.ints[base + RESIDENT_INT.knockX]! / CENTIMETRES_PER_METRE, state.ints[base + RESIDENT_INT.knockZ]! / CENTIMETRES_PER_METRE, tick, victim, LOOK_ON_DOWNED_MINUTES, ATTENTION_DOWNED);
}

/** The call for an ambulance for `victim`, who is down where they were run down: the nearest person out at a door within sight (not them) is the one who phones. */
export function callAmbulanceFor(state: CityState, victim: number, tick: number): void {
  const victimBase = victim * RESIDENT_INT_STRIDE;
  if ((state.ints[victimBase + RESIDENT_INT.flags]! & FLAG.hurt) === 0) return;
  const x = state.ints[victimBase + RESIDENT_INT.knockX]! / CENTIMETRES_PER_METRE;
  const z = state.ints[victimBase + RESIDENT_INT.knockZ]! / CENTIMETRES_PER_METRE;
  let caller = -1;
  let nearest = ALARM_SIGHT;
  for (let resident = 0; resident < state.capacity; resident++) {
    if (resident === victim || seeingFrom(state, resident, tick) !== SEES.standing) continue;
    const distance = hypot2(state.pose.x - x, state.pose.z - z);
    if (distance >= nearest) continue;
    nearest = distance;
    caller = resident;
  }
  if (caller === -1) return;
  const base = caller * RESIDENT_INT_STRIDE;
  state.ints[base + RESIDENT_INT.alarmTick] = tick;
  state.ints[base + RESIDENT_INT.alarmX] = Math.round(x * CENTIMETRES_PER_METRE);
  state.ints[base + RESIDENT_INT.alarmZ] = Math.round(z * CENTIMETRES_PER_METRE);
  state.ints[base + RESIDENT_INT.alarmVictim] = victim;
  standOutside(state, caller, tick, PURPOSE.callAmbulance, CALL_MINUTES * TICKS_PER_GAME_MINUTE);
  noteSight(state, caller, EVENT_CODE.calledAmbulance, residentName(state, victim), tick);
}
