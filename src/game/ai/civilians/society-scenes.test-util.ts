import { ACTIVITY } from "./civilian-activity.ts";
import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { DECISION_HZ, FLAG, FRIDAY, NEED, NO_PLACE, PURPOSE, RESIDENT_INT } from "./civilian-constants.ts";
import { EVENT_CODE } from "./civilian-names.ts";
import { tickOfHour } from "./civilian-run.test-util.ts";
import type { CityState } from "./civilian-state.ts";
import { weekdayOf } from "./civilian-story.ts";
import { createCityState } from "./society.ts";
import { ActivityReading, readActivity } from "./society-activity.ts";
import { COFFEE_SHOP, PIZZA, buildSocietyMap, decideAs, intAt, needsWith, placeIn, stageResident } from "./society.test-util.ts";

export const societyMap = buildSocietyMap();
const SEED = 5;
/** Scenes run on the first day from this one that is not a Friday (Friday evening has the rooftop party). */
const FIRST_DAY = 2;
/** A shift that starts late, so a resident at home by day has no work on their mind. */
const EVENING_SHIFT = 18;
const OLD_AGE = 70;

const HOME_B2 = placeIn(societyMap, "Rowhome B2-1");
const HOME_A1 = placeIn(societyMap, "Rowhome A1-1");
const HOME_A1_NEXT = placeIn(societyMap, "Rowhome A1-2");
const MINI_MART = placeIn(societyMap, "Mifflin Mini Mart");
const PIZZA_PLACE = placeIn(societyMap, PIZZA);
const BODEGA = placeIn(societyMap, PLACE_NAMES.bodega);

/** The people a scene is staged with, in a city nobody has stepped: the resident it is about, a neighbour and a victim (generated residents, whose rows the scene writes). */
export type Cast = { state: CityState; tick: number; resident: number; neighbour: number; victim: number };

export type Scene = {
  hour: number;
  stage: (cast: Cast) => void;
  purpose: number;
  /** The place they go to by name, or its kind when it is any of a kind. */
  place?: string;
  placeKind?: number;
  /** What `readActivity` says `readAfter` seconds after they get there. */
  activity: number;
  readAfter: number;
  /** A crime row fires in a share of decisions; the rest of the scene holds when it does. */
  gated?: boolean;
  after?: (cast: Cast) => void;
};

export function newCast(hour: number): Cast {
  const state = createCityState(SEED, societyMap, 60);
  const resident = state.cast.length;
  let day = FIRST_DAY;
  while (weekdayOf(state, day) === FRIDAY) day++;
  return { state, tick: tickOfHour(state, day, hour), resident, neighbour: resident + 1, victim: resident + 2 };
}

function stageNeighbour(cast: Cast, flags: number, purpose: number, carPlace = NO_PLACE): void {
  stageResident(cast.state, cast.neighbour, { place: HOME_A1_NEXT, tick: cast.tick, nextDecision: cast.tick + 1000, flags, purpose, carPlace });
}

function stageCriminal(cast: Cast): void {
  cast.state.headcount[BODEGA] = 2;
  stageResident(cast.state, cast.resident, { place: HOME_A1, tick: cast.tick, flags: FLAG.criminal });
}

function stageNeighbourScene(cast: Cast, moodEvent: number): void {
  stageResident(cast.state, cast.resident, {
    place: HOME_A1,
    tick: cast.tick,
    work: MINI_MART,
    shiftStart: EVENING_SHIFT,
    needs: needsWith({ [NEED.social]: 0.9 }),
    moodEvent,
  });
  stageNeighbour(cast, 0, 0);
}

export const SCENES: Readonly<Record<string, Scene>> = {
  "coffee on the way to work": {
    hour: 7,
    stage: (cast) => stageResident(cast.state, cast.resident, { place: HOME_B2, tick: cast.tick, work: PIZZA_PLACE, flags: FLAG.coffeeFan }),
    purpose: PURPOSE.coffee,
    place: COFFEE_SHOP,
    activity: ACTIVITY.buy,
    readAfter: 1,
  },
  "morning coffee out of work": {
    hour: 8,
    stage: (cast) => stageResident(cast.state, cast.resident, { place: HOME_B2, tick: cast.tick, flags: FLAG.coffeeFan }),
    purpose: PURPOSE.coffee,
    place: COFFEE_SHOP,
    activity: ACTIVITY.buy,
    readAfter: 1,
  },
  "a drink after work": {
    hour: 18,
    stage: (cast) =>
      stageResident(cast.state, cast.resident, {
        place: MINI_MART,
        home: HOME_B2,
        tick: cast.tick,
        dwell: 480,
        work: MINI_MART,
        flags: FLAG.drinker,
        needs: needsWith({ [NEED.rest]: 0.5 }),
        risePerHour: [0.1, 0, 0, 0, 0, 0],
      }),
    purpose: PURPOSE.drink,
    place: PLACE_NAMES.bar,
    activity: ACTIVITY.buy,
    readAfter: 1,
  },
  "a drink to forget": {
    hour: 19,
    stage: (cast) => stageResident(cast.state, cast.resident, { place: HOME_B2, tick: cast.tick, moodEvent: EVENT_CODE.fired }),
    purpose: PURPOSE.drink,
    place: PLACE_NAMES.bar,
    activity: ACTIVITY.buy,
    readAfter: 1,
  },
  "sitting out on the stoop in the evening": {
    hour: 20,
    stage: (cast) => stageResident(cast.state, cast.resident, { place: HOME_A1, tick: cast.tick, needs: needsWith({ [NEED.social]: 0.9 }) }),
    purpose: PURPOSE.stoopSit,
    place: "Rowhome A1-1",
    activity: ACTIVITY.sitSteps,
    readAfter: 3,
  },
  "sitting out on the stoop by day": {
    hour: 11,
    stage: (cast) => stageResident(cast.state, cast.resident, { place: HOME_A1, tick: cast.tick, age: OLD_AGE, needs: needsWith({ [NEED.social]: 0.9 }) }),
    purpose: PURPOSE.stoopSit,
    place: "Rowhome A1-1",
    activity: ACTIVITY.sitSteps,
    readAfter: 3,
  },
  "a chat with a neighbour": {
    hour: 11,
    stage: (cast) => stageNeighbourScene(cast, 0),
    purpose: PURPOSE.stoopTalk,
    place: "Rowhome A1-2",
    activity: ACTIVITY.talk,
    readAfter: 1,
    after: (cast) => {
      expectPair(cast, PURPOSE.stoopTalk);
    },
  },
  "a row with a neighbour": {
    hour: 15,
    stage: (cast) => stageNeighbourScene(cast, EVENT_CODE.stoopWrecked),
    purpose: PURPOSE.argue,
    place: "Rowhome A1-2",
    activity: ACTIVITY.talk,
    readAfter: 1,
    after: (cast) => {
      expectPair(cast, PURPOSE.argue);
    },
  },
  "loitering when broke": {
    hour: 13,
    stage: (cast) => stageResident(cast.state, cast.resident, { place: HOME_A1, tick: cast.tick, flags: FLAG.broke }),
    purpose: PURPOSE.loiter,
    place: PLACE_NAMES.bodega,
    activity: ACTIVITY.idle,
    readAfter: 1,
  },
  "lifting from a shop": {
    hour: 12,
    stage: stageCriminal,
    purpose: PURPOSE.shoplift,
    place: PLACE_NAMES.bodega,
    activity: ACTIVITY.buy,
    readAfter: 1,
    gated: true,
  },
  "mugging someone on their stoop": {
    hour: 22,
    stage: (cast) => {
      stageCriminal(cast);
      stageNeighbour(cast, 0, PURPOSE.stoopSit);
    },
    purpose: PURPOSE.mug,
    place: "Rowhome A1-2",
    activity: ACTIVITY.idle,
    readAfter: 1,
    gated: true,
  },
  "trying the parked cars": {
    hour: 23,
    stage: (cast) => {
      stageCriminal(cast);
      stageNeighbour(cast, FLAG.hasCar, 0, HOME_A1_NEXT);
    },
    purpose: PURPOSE.breakIn,
    place: "Rowhome A1-2",
    activity: ACTIVITY.idle,
    readAfter: 1,
    gated: true,
  },
  "lying low while wanted": {
    hour: 15,
    stage: (cast) => stageResident(cast.state, cast.resident, { place: HOME_A1, tick: cast.tick, flags: FLAG.criminal | FLAG.wanted }),
    purpose: PURPOSE.flee,
    placeKind: PLACE_KIND.hide,
    activity: ACTIVITY.none,
    readAfter: 1,
  },
};

/** The resident and the neighbour they came for are linked and the neighbour is out at their own door for the same purpose. */
function expectPair(cast: Cast, purpose: number): void {
  const { state } = cast;
  if (intAt(state, cast.resident, RESIDENT_INT.companion) !== cast.neighbour) throw new Error("the visitor does not name the neighbour");
  if (intAt(state, cast.neighbour, RESIDENT_INT.companion) !== cast.resident) throw new Error("the neighbour does not name the visitor");
  if (intAt(state, cast.neighbour, RESIDENT_INT.legPurpose) !== purpose) throw new Error("the neighbour is not out for the same purpose");
}

/** What one decision of the scene's resident came to. */
export type Outcome = { purpose: number; place: number; code: number; placed: boolean; partner: number; cast: Cast };

const reading = new ActivityReading();

/** The scene's resident decides for the `count`th time; their choice, and what they are doing `readAfter` seconds after they arrive. The scene's `after` runs on that same state. */
export function decideScene(scene: Scene, cast: Cast, count: number): Outcome {
  scene.stage(cast);
  decideAs(cast.state, cast.resident, cast.tick, count);
  const { state, resident } = cast;
  readActivity(state, resident, intAt(state, resident, RESIDENT_INT.arriveTick) / DECISION_HZ + scene.readAfter, reading);
  const outcome = { purpose: intAt(state, resident, RESIDENT_INT.legReason), place: intAt(state, resident, RESIDENT_INT.place), code: reading.code, placed: reading.placed, partner: reading.partner, cast };
  if (outcome.purpose === scene.purpose) scene.after?.(cast);
  return outcome;
}
