import { ACTIVITY } from "../civilians/civilian-activity.ts";
import { MOOD } from "../civilians/civilian-names.ts";
import { EVENT_KIND } from "../civilians/civilian-constants.ts";
import { ACTIVITY_INTEREST, AMBULANCE_INTEREST, COP_PATROL_INTEREST, COP_PURSUIT_INTEREST, COP_RUN_SPEED, DRIVER_BASE_INTEREST, DRIVER_FULL_SPEED, DRIVER_SPEED_INTEREST, DRIVER_STOPPED_SPEED, EVENT_INTEREST, EVENT_SECONDS, MOOD_INTEREST, SIREN_INTEREST } from "./auto-constants.ts";

/** The bubble's words for an `ACTIVITY`, by code; a gap is an activity the title already says. */
const ACTIVITY_LINES: readonly (string | null)[] = [null, null, "talking", "buying at the counter", "going through a door", null, null, null, "bumped into someone", "swinging a punch", "blocking a punch", "taking a hit", null, "cuffing a suspect", "in handcuffs", "making an arrest", "leading a suspect away", "getting into a car", "getting out of a car", "on the phone to the police", "kneeling by someone hurt", "flinching from a hit"];

/** How interesting what a civilian is doing is (0-1), by `ACTIVITY` code. */
export function activityInterest(activity: number): number {
  return ACTIVITY_INTEREST[activity] ?? ACTIVITY_INTEREST[ACTIVITY.none];
}

/** How interesting a mood is (0-1), by `MOOD` code. */
export function moodInterest(mood: number): number {
  return MOOD_INTEREST[mood] ?? MOOD_INTEREST[MOOD.fine];
}

/** An event `ageSeconds` after it began: its interest falls from the kind's own to nothing over the kind's window; nothing before it began, once it is over, or for a kind that names no subject. */
export function eventInterest(kind: number, ageSeconds: number): number {
  const window = EVENT_SECONDS[kind] ?? 0;
  if (kind === EVENT_KIND.alongside || kind === EVENT_KIND.walker || ageSeconds < 0 || ageSeconds >= window) return 0;
  return EVENT_INTEREST[kind]! * (1 - ageSeconds / window);
}

/** What a civilian is doing, in words for the bubble; null for a walk, a stand or a sit, which the line above it already says. */
export function activityLine(activity: number): string | null {
  return ACTIVITY_LINES[activity] ?? null;
}

/** The ambulance by `AMBULANCE` state: its call is the one on screen when it is out, nothing when it is not. */
export function ambulanceInterest(state: number): number {
  return AMBULANCE_INTEREST[state] ?? 0;
}

/** A foot cop: what he is doing, else at a run in pursuit and at a walk on his beat. */
export function copInterest(activity: number, speed: number): number {
  return Math.max(activityInterest(activity), speed >= COP_RUN_SPEED ? COP_PURSUIT_INTEREST : COP_PATROL_INTEREST);
}

/** A car with a driver: a patrol car with its siren lit is the hottest; a car on a trip is more to watch the faster it goes, and a stopped one is not. */
export function driverInterest(speed: number, sirens: boolean): number {
  if (sirens) return SIREN_INTEREST;
  if (speed < DRIVER_STOPPED_SPEED) return DRIVER_BASE_INTEREST / 2;
  return DRIVER_BASE_INTEREST + DRIVER_SPEED_INTEREST * Math.min(1, speed / DRIVER_FULL_SPEED);
}
