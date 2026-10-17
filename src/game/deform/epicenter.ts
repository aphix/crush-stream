import { CONTACT_WINDOW } from "./constants.ts";

/**
 * Epicenter activation (`whole | epicenter`): the switch and every threshold of it, in one object a run can move (the Debug panel's Epicenter sliders and the share URL's `epi.*` keys
 * write it, `EPICENTER_KNOBS`; the camera's `CHASE` knobs are the precedent). Values are numbers so each is a slider and a URL field: switches are 0/1,
 * and 0 turns a threshold off. A replay records the whole object (`reel-codec`).
 *
 * `on` 0 is `whole`, today: every crashed car runs the soft-body structure step and the frame re-measure every slice, bit for bit. 1: a crashed car whose quiet time
 * has reached `relockHold` is frozen: its masses ride the car's frame (the rigid velocity field, one pass), no solve and no frame re-measure; any write to a mass or
 * to its contact clock thaws it (`DeformRig.thaw`). Phase A (8 scenes at 1x sim time, the owner's fleet traces of two and three cars head on, the piston
 * matrix of five classes x eight pistons x 15-75 mph) is the evidence for each default.
 */
export const EPICENTER = {
  /** 0 `whole`, 1 `epicenter`. */
  on: 0,
  /** Quiet time (s) a crashed car reaches before it freezes. Today's `CONTACT_WINDOW`: past it the solver already stops and every mass is overwritten with the rigid body's velocity; the owner's traces show every mass within 0.1 mm per 0.25 s from 0.39 s. Lower (0.2) freezes nodes that still move (8-32 % of node-time in the 0.25-0.5 s age bin). */
  relockHold: CONTACT_WINDOW,
  /** The body must be slower than this (m/s) to freeze; 0 is off. The 2 s+ wrecks of the city bench are racing cars with damage (99.9 % above 5 m/s), so this is the lever between 'freeze the driving wrecks' and 'only the stopped ones'. */
  settleMps: 0,
  /** The body must turn slower than this (rad/s) to freeze; 0 is off. */
  settleSpin: 0,
  /** 1: a crashed car re-poses its parts on a rendered frame only when something their pose reads changed (hinge values, door swing, flap, the bumper masses and the sensors under them, the car's own pose, the skin): `partsDirty` is set by every step, so a car sitting still re-posed every part, doors' ground probes and bumpers' searches included, 60 times a second. Drawing only: the poses are those of 0 to a nanometre (`POSE_EPSILON`). */
  presentSkip: 0,
  /** 1: a wreck's belly-segment pass (`stepFree`) skips the segments that run over another wreck's top: their ridge and edge crossings always end in the row being dropped (a wreck takes no support from another wreck's top), so the answer is the same and the crossings (a full surface query per step along each segment) are not made. 0 is today. Result-exact: the rows and the pose are bit for bit those of 0. */
  nearPrune: 0,
  /** 1: a frozen car checks at every slice that nothing wrote to it: no mass's car-frame place moved, every mass is where the frame puts it and its contact clock did not restart; a writer that forgot `thaw` counts a breach (`frozenBreaches`). Debug and the rows only: 20 masses a slice. */
  frozenCheck: 0,
  /** Seconds after a thaw before the car may freeze again, on top of `relockHold`'s quiet time. 0: the next quiet slice (a car a contact feeds every slice freezes and thaws every slice: the pending slice after each freeze takes the whole path, so it costs bookkeeping, not accuracy). The hold keeps such a car whole; the city's wrecks are touched about every 30 ms, so a long hold gives their relock away. */
  thawHold: 0,
  /** Metres of crush a frozen car's resting contact may feed in one slice before it is let in (`feedOverlap`): under this the feed is dropped and counted (`crushDroppedUm`) and the wreck stays frozen; 0 lets in every feed over 10 um as today (each thaws the car). A resting pile feeds sub-millimetre crush every slice; the dropped total over a run is the bound to read. */
  feedMin: 0,
  /** 1: a brake (or handbrake) held on a wreck that is at rest (`!moving`, no throttle) neither wakes it nor restarts its rest timer, so it falls asleep like an unbraked one (`applyDrive`). 0 is today: a held brake resets the timer every slice and a braked, standing wreck never sleeps. Not exact: a sleeping wreck skips the rigid step a braked one ran; it stands still either way. */
  holdWakes: 0,
};

/** Every knob as the module loaded it: the off values a clip recorded before a knob existed reads it at. */
const DEFAULTS = { ...EPICENTER };

export type EpicenterKnobId = `epi.${keyof typeof EPICENTER}`;

/** One Debug-panel slider / share-URL field of the epicenter activation (`ChaseKnob`'s shape). */
export type EpicenterKnob = {
  id: EpicenterKnobId;
  group: "Epicenter";
  label: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (value: number) => void;
};

const ROWS: readonly [keyof typeof EPICENTER, string, number, number, number][] = [
  ["on", "Epicenter (0 whole, 1 on)", 0, 1, 1],
  ["relockHold", "Freeze after quiet (s)", 0.1, 3, 0.05],
  ["settleMps", "Freeze below speed (m/s, 0 off)", 0, 40, 0.5],
  ["settleSpin", "Freeze below spin (rad/s, 0 off)", 0, 6, 0.1],
  ["presentSkip", "Skip parts re-pose at rest", 0, 1, 1],
  ["nearPrune", "Skip belly crossings over wrecks", 0, 1, 1],
  ["frozenCheck", "Check frozen cars (debug)", 0, 1, 1],
  ["thawHold", "No refreeze after a thaw (s)", 0, 1, 0.05],
  ["feedMin", "Frozen car drops feeds under (m, 0 off)", 0, 0.005, 0.0001],
  ["holdWakes", "Brake on a wreck at rest lets it sleep", 0, 1, 1],
];

/** The knob rows, in panel order. */
export const EPICENTER_KNOBS: readonly EpicenterKnob[] = ROWS.map(([key, label, min, max, step]) => ({
  id: `epi.${key}`,
  group: "Epicenter",
  label,
  min,
  max,
  step,
  get: () => EPICENTER[key],
  set: (value: number) => {
    EPICENTER[key] = value;
  },
}));

/** Whether `epicenter` activation is on. */
export function epicenterOn(): boolean {
  return EPICENTER.on === 1;
}

const KEYS = Object.keys(EPICENTER) as (keyof typeof EPICENTER)[];
/** How many knobs there are: a clip carrying more was recorded by a build that knew knobs this one does not, and a replay without them would not be the sim it recorded (`readClip` refuses it). */
export const EPICENTER_FIELDS = KEYS.length;

/** The object's values in declaration order: what a clip records of a run that was on (the clip carries however many there are, `REPLAY_VERSION` 114's count byte; a knob added later goes at the end with its off value as default). */
export function epicenterValues(): number[] {
  return KEYS.map((k) => EPICENTER[k]);
}

/** Writes `values` (`epicenterValues`' order) over the object; a knob a shorter list (a clip recorded before the knob existed) does not carry takes its default, which is its off value. */
export function loadEpicenter(values: readonly number[]): void {
  for (let i = 0; i < KEYS.length; i++) EPICENTER[KEYS[i]!] = values[i] ?? DEFAULTS[KEYS[i]!];
}
