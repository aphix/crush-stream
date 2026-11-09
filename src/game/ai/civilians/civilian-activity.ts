/** What a civilian is doing that her drawing animates; `none` is walking, or standing when she does not move. */
export const ACTIVITY = { none: 0, idle: 1, talk: 2, buy: 3, door: 4, sitDown: 5, sit: 6, standUp: 7, bump: 8, swing: 9, block: 10, hit: 11, sitSteps: 12, cuffing: 13, cuffed: 14, arresting: 15, escorting: 16, carIn: 17, carOut: 18, phoneCall: 19, kneel: 20, recoil: 21 } as const;

export type ActivityName = keyof typeof ACTIVITY;

/** The look-at bubble's words for each activity: what the line above it (name, purpose, place, mood) does not already say; null for a walk or a stand. */
const ACTIVITY_WORDS = { none: null, idle: null, talk: "talking", buy: "buying at the counter", door: "going through a door", sitDown: "sitting down", sit: "sitting", standUp: "getting up", bump: "bumped into someone", swing: "swinging a punch", block: "blocking a punch", hit: "taking a hit", sitSteps: "sitting out on the stoop", cuffing: "cuffing a suspect", cuffed: "in handcuffs", arresting: "making an arrest", escorting: "leading a suspect away", carIn: "getting into a car", carOut: "getting out of a car", phoneCall: "phoning for an ambulance", kneel: "kneeling by someone hurt", recoil: "flinching back" } as const satisfies Record<ActivityName, string | null>;
const WORDS_BY_CODE: (string | null)[] = [];
for (const name of Object.keys(ACTIVITY) as ActivityName[]) WORDS_BY_CODE[ACTIVITY[name]] = ACTIVITY_WORDS[name];

/** What a civilian is doing, in words for the bubble, by `ACTIVITY` code; null when the line above it already says it. */
export function activityLine(activity: number): string | null {
  return WORDS_BY_CODE[activity] ?? null;
}

/** Seconds a finite activity's clip lasts; 0 loops until its owner ends it. */
export const ACTIVITY_SECONDS = { none: 0, idle: 0, talk: 0, buy: 3.2, door: 1.8, sitDown: 1.2, sit: 0, standUp: 1.1, bump: 0.7, swing: 0.6, block: 0, hit: 0.9, sitSteps: 0, cuffing: 1.5, cuffed: 0, arresting: 1.5, escorting: 0, carIn: 2.6, carOut: 2.4, phoneCall: 0, kneel: 0, recoil: 0.9 } as const satisfies Record<ActivityName, number>;

/** The `left` an owner gives an activity whose end it does not know (s). */
export const ACTIVITY_OPEN_ENDED = 1e9;

/**
 * Where an arrest's two stand (m), both facing the suspect's way: while `cuffing`/`arresting` the cop is `cuffBehind` behind her back;
 * while `cuffed`/`escorting` she walks `escortAhead` ahead of him and `escortAcross` to his right (-x), where his right hand holds her arm.
 */
export const ARREST = { cuffBehind: 0.5, escortAhead: 0.35, escortAcross: 0.38 } as const;
