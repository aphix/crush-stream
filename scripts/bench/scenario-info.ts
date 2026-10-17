/**
 * What each scenario of the scenario bench is, as data the driver can print without loading the sim (`scenarios.ts` builds them): the cars, what is held, the one variable, the cut it sizes.
 * The lone-car reach the convoy rows sit inside is `CONTACT_REACH` + `LONE_MARGIN` (`engine/world-step.ts`: 5.3 + 1 m); `bench.test.ts` holds the spacing to it.
 */
export interface ScenarioInfo {
  /** What the row is, in a line: the cars, what is held, the one variable. */
  about: string;
  /** The cut it sizes. */
  sizes: string;
  /** The race's lone-car schedule on (`World.lone`: on in a race, off in the Fleet). */
  lone: boolean;
  /** Warm-up before the window opens (sim s: the relock hold and the first sleep checks pass), and the window itself. */
  warmS: number;
  windowS: number;
}

export const SCENARIO_INFO: Record<string, ScenarioInfo> = {
  "intact-alone": {
    about: "16 sedans, intact, 40 m apart in a line, all at 15 m/s with the throttle held (none within any reach of another)",
    sizes: "the per-car baseline of an intact racer; the control for rows 1-3 (epicenter changes nothing: the arms must be bit-identical)",
    lone: true,
    warmS: 2,
    windowS: 12,
  },
  "intact-convoy": {
    about: `16 sedans in 2 columns of 8, 5 m nose to tail and 3.5 m across (inside the lone reach 6.3 m), same speed and throttle as intact-alone: the one variable is nearness`,
    sizes: "the near-car cost of intact racers (readPoints tops reads, pair tests): nearPrune/topsGate/pointPrune/topsMaxY",
    lone: true,
    warmS: 2,
    windowS: 12,
  },
  "intact-convoy-mixed": {
    about: "intact-convoy with the four classes mixed (sedan, muscle, truck, monster): the one variable is the class mix",
    sizes: "whether the near-car cost depends on the class (point counts differ by class)",
    lone: true,
    warmS: 2,
    windowS: 12,
  },
  "wreck-driving-apart": {
    about: "8 sedan wrecks (4 head-on crashes, 12 m/s each, 65 % face, then moved 40 m apart keeping their damage), drivetrain alive, throttle held, 15 m/s",
    sizes: "the relock on a crashed car that keeps driving (the city's 2 s+ wreck class)",
    lone: true,
    warmS: 2,
    windowS: 12,
  },
  "wreck-stopped-apart": {
    about: "the same 8 wrecks standing 40 m apart, drivetrain alive, brake held: the one variable vs wreck-driving-apart is driving vs stopped",
    sizes: "the relock on a standing wreck whose drivetrain is alive (holdWakes, sleepOnWreck)",
    lone: true,
    warmS: 2,
    windowS: 12,
  },
  "wreck-dead-apart": {
    about: "the same 8 wrecks standing 40 m apart with the drivetrain dead: the one variable vs wreck-stopped-apart is alive vs dead at rest",
    sizes: "the sleep chain (sleepOnWreck/sleepContacts/asleepSkip) and the relock on resting hulls",
    lone: true,
    warmS: 2,
    windowS: 12,
  },
  "wreck-pile-pushed": {
    about: "the same 8 dead wrecks thrown together 3.0 m apart (2 columns of 4, a 1.4 m overlap): the pair pass pushes them apart in every slice, so every wreck is touched every slice",
    sizes: "correctness: a wreck that is pushed every slice must stay on the whole path (the arms are bit-identical); the freeze/thaw thrash",
    lone: true,
    warmS: 2,
    windowS: 4,
  },
  "wreck-dead-piled": {
    about: "the same 8 dead wrecks in a touching pile (2 columns of 4, 4.2 m x 2.1 m, a 0.24 m overlap): the one variable vs wreck-dead-apart is apart vs piled",
    sizes: "resting-pair work and the freeze/thaw thrash (feedOverlap): pairRestSkip, epi.feedMin",
    lone: true,
    warmS: 2,
    windowS: 12,
  },
};
