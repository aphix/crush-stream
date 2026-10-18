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
  /** The race's step schedule (1/80 s steps, `World.loners` engaged) rather than the fine floor (1/240 s, one slice a step: nothing for the lone cut to skip). */
  race?: boolean;
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
  "intact-alone-race": {
    about: "intact-alone on the race's step schedule (1/80 s steps, cut to 1/240 s slices only in contact, lone cars once a step): 16 sedans 40 m apart; the race's per-sim-second cost of a lone intact car",
    sizes: "the baseline the city actually pays (the lone-car cut engaged); intact-alone is the per-slice cost",
    lone: true,
    race: true,
    warmS: 2,
    windowS: 12,
  },
  "intact-convoy-race": {
    about: "intact-convoy on the race's step schedule: 16 sedans in 2 columns inside the lone reach, so no car is lone and every step is cut to 3 slices only where a car is in contact (none here)",
    sizes: "the near-car cost as the race pays it; against intact-alone-race it is nearness plus the lone cut lost",
    lone: true,
    race: true,
    warmS: 2,
    windowS: 12,
  },
  "wreck-driving-apart-race": {
    about: "wreck-driving-apart on the race's step schedule: 8 driving wrecks 40 m apart (lone), 1/80 s steps",
    sizes: "the relock on a driving wreck as the race pays it",
    lone: true,
    race: true,
    warmS: 2,
    windowS: 12,
  },
  "present-asleep": {
    about: "8 dead wrecks standing apart (asleep within a second), a rendered frame every 1/60 sim-s drawing every car (`updateSkin`: skin, lamps, panels, glass, the parts' pose): what presentSkip is for",
    sizes: "presentSkip: posePart and followGlass calls per drawn frame and us per drawn frame, `--arm ps0:epi.presentSkip=0` against the default; a still scene should pose nothing",
    lone: false,
    warmS: 3,
    windowS: 10,
  },
  "present-stopped": {
    about: "8 braked wrecks standing apart with the drivetrain alive (awake: frozen with `epi.on`), drawn every 1/60 sim-s as present-asleep",
    sizes: "presentSkip on awake wrecks: the frames still carry the sim's tiny motion, so the calls per frame show what the nanometre tolerance (`POSE_EPSILON`) lets through",
    lone: false,
    warmS: 3,
    windowS: 10,
  },
  city: {
    about: "the in-app city bench through the real engine (BENCH_RACE: 15 AI racers and police, the bench's seed, nothing drawn, pacer pinned to the fine floor): AI drives, so the arms may do different work",
    sizes: "end-to-end confirmation only: per-unit rows and the counters, never totals",
    lone: true,
    warmS: 20,
    windowS: 30,
  },
  "city-race": {
    about: "the same city bench race on the race's step schedule (pace pinned coarse: 1/80 s steps, cut to 1/240 s slices in contact, lone cars once a step): what a phone that keeps up runs; AI drives",
    sizes: "end-to-end confirmation of the lone-car and relock cuts: per-unit rows, the counters and fineCuts, never totals",
    lone: true,
    race: true,
    warmS: 20,
    windowS: 30,
  },
  mall: {
    about: "the in-app National Mall bench (`?bench=city&course=national-mall`: 16 racers, the bench's seed) through the real engine on the race's step schedule, nothing drawn: the map where the owner's epi card lost (wreck per unit 101 -> 158 us, freezes = thaws 638/s)",
    sizes: "the freeze/thaw thrash on piles: thawHold / feedMin sweeps, thaws by site, per-unit wreck us against off",
    lone: true,
    race: true,
    warmS: 20,
    windowS: 30,
  },
  "dam-spine": {
    about: "the in-app dam-spine bench (`?bench=city&course=dam-spine`: the longest course, 16 racers, the bench's seed) through the real engine on the race's step schedule, nothing drawn",
    sizes: "end-to-end: per-unit wreck us and freezes against off on the map where the owner's epi card won",
    lone: true,
    race: true,
    warmS: 20,
    windowS: 30,
  },
  strip: {
    about: "the in-app `?bench=strip` card through the real engine (16 racers and the traffic on the 6 km straight, one sedan body, the bench's seed, nothing drawn) on the race's step schedule: the headless twin of the owner's off/on cards",
    sizes: "does the activation touch intact cars (per-unit integrate and drive on both arms, run in alternating order); end-to-end, per-unit rows and counters, never totals",
    lone: true,
    race: true,
    warmS: 10,
    windowS: 30,
  },
  "sideswipe-15-race": {
    about: "two sedans abeam 3.5 m apart (hulls 1.6 m clear) at 15 m/s on the race's step schedule, the far one steering across at full lock: near and not closing, then closing, then in contact",
    sizes: "SAFETY row of a tighter lone test: the census's false negatives (not-closing car-steps followed by a contact) and the arms' end states",
    lone: true,
    race: true,
    warmS: 0,
    windowS: 4,
  },
  "sideswipe-30-race": {
    about: "the same side-swipe at 30 m/s: the closing begins later in the step count and the contact is harder",
    sizes: "SAFETY row of a tighter lone test at highway speed",
    lone: true,
    race: true,
    warmS: 0,
    windowS: 4,
  },
  "derby-8-s3": {
    about: "a derby heat of 8 AI cars of the fleet's mix on the derby arena (seed 3), frame-sized slices through stepWorld, the derby's kill rules armed (`DerbySim`): wrecks pile up and rest; the AI drives, so arms may do different work",
    sizes: "end-to-end confirmation for resting piles: thaws by site, who wakes a wreck, asleep share, per-unit rows",
    lone: false,
    warmS: 5,
    windowS: 40,
  },
  "derby-8-s8": {
    about: "the same derby heat with seed 8",
    sizes: "end-to-end confirmation for resting piles (second seed)",
    lone: false,
    warmS: 5,
    windowS: 40,
  },
  "dam-spine-race": {
    about: "the city bench field (15 AI racers and police, the bench's seed) on the Dam Spine course on the race's step schedule",
    sizes: "the ground proof: `--verify` over the course's static ground (a dam's crease and decks)",
    lone: true,
    race: true,
    warmS: 10,
    windowS: 20,
  },
  "national-mall-race": {
    about: "the city bench field on the National Mall course on the race's step schedule",
    sizes: "the ground proof: `--verify` over the Mall's static ground and props",
    lone: true,
    race: true,
    warmS: 10,
    windowS: 20,
  },
  "havana-race": {
    about: "the city bench field on the off-menu Havana course on the race's step schedule",
    sizes: "the ground proof: `--verify` over Havana's static ground and its wall",
    lone: true,
    race: true,
    warmS: 10,
    windowS: 20,
  },
  "fleet-ramps": {
    about: "the Fleet's two ramps (moving prisms in the ground's store), two cars head-on up them at 15 m/s with the throttle held",
    sizes: "the ground proof: `--verify` where the static store holds `moves` patches (they fall back to the layered path, counted as whole answers)",
    lone: false,
    warmS: 2,
    windowS: 8,
  },
};
