/** What a civilian is doing that her drawing animates; `none` is walking, or standing when she does not move. */
export const ACTIVITY = { none: 0, idle: 1, talk: 2, buy: 3, door: 4, sitDown: 5, sit: 6, standUp: 7, bump: 8, swing: 9, block: 10, hit: 11, sitSteps: 12 } as const;

export type ActivityName = keyof typeof ACTIVITY;

/** Seconds a finite activity's clip lasts; 0 loops until its owner ends it. */
export const ACTIVITY_SECONDS = { none: 0, idle: 0, talk: 0, buy: 3.2, door: 1.8, sitDown: 1.2, sit: 0, standUp: 1.1, bump: 0.7, swing: 0.6, block: 0, hit: 0.9, sitSteps: 0 } as const satisfies Record<ActivityName, number>;

/** The `left` an owner gives an activity whose end it does not know (s). */
export const ACTIVITY_OPEN_ENDED = 1e9;
