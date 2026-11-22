import { ACTIVITIES, codesOf } from "./resident-spine.ts";

/** What a civilian is doing that her drawing animates; `none` is walking, or standing when she does not move. */
export const ACTIVITY = codesOf(ACTIVITIES);

export type ActivityName = keyof typeof ACTIVITY;

const WORDS_BY_CODE: readonly (string | null)[] = Object.values(ACTIVITIES).map((row) => row.words);

/** What a civilian is doing, in words for the bubble, by `ACTIVITY` code; null when the line above it already says it. */
export function activityLine(activity: number): string | null {
  return WORDS_BY_CODE[activity] ?? null;
}

/** Seconds a finite activity's clip lasts; 0 loops until its owner ends it. */
// The cast holds: one entry per activity key (pinned by the spine's test).
export const ACTIVITY_SECONDS = Object.fromEntries(Object.entries(ACTIVITIES).map(([id, row]) => [id, row.clip])) as Readonly<Record<ActivityName, number>>;

/** The `left` an owner gives an activity whose end it does not know (s). */
export const ACTIVITY_OPEN_ENDED = 1e9;

/**
 * Where an arrest's two stand (m), both facing the suspect's way: while `cuffing`/`arresting` the cop is `cuffBehind` behind her back;
 * while `cuffed`/`escorting` she walks `escortAhead` ahead of him and `escortAcross` to his right (-x), where his right hand holds her arm.
 */
export const ARREST = { cuffBehind: 0.5, escortAhead: 0.35, escortAcross: 0.38 } as const;
