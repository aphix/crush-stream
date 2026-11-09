import { hypot2 } from "../../kernel/physics-core.js";
import { DECISION_HZ, ALARM_INDOORS_SHARE, ALARM_SHARE, ALARM_SIGHT, CALL_MINUTES, CENTIMETRES_PER_METRE, LOOK_ON_DOWNED_MINUTES, NO_PLACE, PURPOSE, RESIDENT_INT, RESIDENT_INT_STRIDE, STREAM, TICKS_PER_GAME_MINUTE, FLAG } from "./civilian-constants.ts";
import { residentDraws } from "./civilian-draws.ts";
import { legPose } from "./civilian-leg.ts";
import { EVENT_CODE } from "./civilian-names.ts";
import { standOutside } from "./civilian-plan.ts";
import { residentName, type CityState } from "./civilian-state.ts";
import { noteEvent } from "./society-day.ts";
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

/**
 * A hazard at (x, z) that `victim` (-1: none) is hurt by, seen at `tick`: every free person out within `ALARM_SIGHT` reacts by their own seeded draw, and their row remembers it (`alarmTick`: the drawing flinches them, a step
 * back, then). One at a door goes in or looks on for `lookOnMinutes`; a walker walks on.
 */
export function alarmAt(state: CityState, x: number, z: number, tick: number, victim: number, lookOnMinutes: number): void {
  const near = nearestPlaceTo(state, x, z, NO_PLACE);
  for (let resident = 0; resident < state.capacity; resident++) {
    if (resident === victim) continue;
    const sees = seeingFrom(state, resident, tick);
    if (sees === SEES.nothing || hypot2(state.pose.x - x, state.pose.z - z) > ALARM_SIGHT) continue;
    const draw = residentDraws(state.seed, resident, STREAM.alarm, tick);
    if (draw() >= ALARM_SHARE) continue;
    const base = resident * RESIDENT_INT_STRIDE;
    state.ints[base + RESIDENT_INT.alarmTick] = tick;
    state.ints[base + RESIDENT_INT.alarmX] = Math.round(x * CENTIMETRES_PER_METRE);
    state.ints[base + RESIDENT_INT.alarmZ] = Math.round(z * CENTIMETRES_PER_METRE);
    state.ints[base + RESIDENT_INT.alarmVictim] = victim;
    noteEvent(state, resident, EVENT_CODE.sawDanger, near, tick);
    if (sees === SEES.walking) continue;
    if (draw() < ALARM_INDOORS_SHARE) fleeHome(state, resident, tick);
    else standOutside(state, resident, tick, PURPOSE.lookOn, lookOnMinutes * TICKS_PER_GAME_MINUTE);
  }
}

/** Someone run down, seen: the knock's spot is where the alarm is, and the one down is who it is about. */
export function alarmAtKnock(state: CityState, victim: number, tick: number): void {
  if ((state.ints[victim * RESIDENT_INT_STRIDE + RESIDENT_INT.flags]! & FLAG.hurt) === 0) return;
  const base = victim * RESIDENT_INT_STRIDE;
  alarmAt(state, state.ints[base + RESIDENT_INT.knockX]! / CENTIMETRES_PER_METRE, state.ints[base + RESIDENT_INT.knockZ]! / CENTIMETRES_PER_METRE, tick, victim, LOOK_ON_DOWNED_MINUTES);
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
  noteEvent(state, caller, EVENT_CODE.calledAmbulance, residentName(state, victim), tick);
}
