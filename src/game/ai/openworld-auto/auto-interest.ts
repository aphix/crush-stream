import { ACTIVITY } from "../civilians/civilian-activity.ts";
import { MOOD } from "../civilians/civilian-names.ts";
import { EVENT_KIND } from "../civilians/civilian-constants.ts";
import { ACTIVITY_INTEREST, COP_PATROL_INTEREST, COP_PURSUIT_INTEREST, COP_RUN_SPEED, DRIVER_BASE_INTEREST, DRIVER_FULL_SPEED, DRIVER_SPEED_INTEREST, DRIVER_STOPPED_SPEED, EVENT_INTEREST, EVENT_SECONDS, MOOD_INTEREST, SIREN_INTEREST } from "./auto-constants.ts";

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
