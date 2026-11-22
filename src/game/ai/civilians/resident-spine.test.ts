import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { firstMismatch } from "../../kernel/compare-arrays.test-util.ts";
import { ACTIVITY, ACTIVITY_SECONDS, activityLine } from "./civilian-activity.ts";
import { CRIME_KIND, EVENT_KIND, NEED, NEED_COUNT, PURPOSE } from "./civilian-constants.ts";
import { EVENT_CODE, MOOD, MOOD_WORDS, NEED_MOODS, PURPOSE_LABELS, PURPOSE_LOG_TEXT, PURPOSE_MOODS, VISIT_BASE, moodOfCode } from "./civilian-names.ts";
import { ACTIVITIES, EVENT_KINDS, LEG_PURPOSES, NEEDS, PURPOSES, VENUES } from "./resident-spine.ts";
import { crimeKindOf } from "./society-crime.ts";
import { VENUE, isCounterVenue, isOutdoorPurpose, isSeatedVenue } from "./society-venues.ts";

// The hand-kept tables the spine replaced, verbatim as they stood before it (main 671efc2cf).
const OLD_NEED = { rest: 0, food: 1, work: 2, social: 3, errand: 4, solitude: 5 };
const OLD_PURPOSE = { salPigeons: 6, kowalskiBroom: 7, biscuitSteals: 8, jamalFlyers: 9, deeCoffee: 10, okaforParty: 11, vanRepair: 12, tabbyPlay: 13, dogChase: 14, mechanicOut: 15, partyGuest: 16, busAway: 17, coffee: 18, drink: 19, stoopSit: 20, stoopTalk: 21, argue: 22, loiter: 23, report: 24, flee: 25, shoplift: 26, mug: 27, breakIn: 28, fight: 29, lookOn: 30, callAmbulance: 31 };
const OLD_EVENT_KIND = { knock: 0, wreck: 1, crime: 2, bust: 3, push: 4, fight: 5, alongside: 6, walker: 7, jaywalk: 8, copDown: 9, ambulance: 10, danger: 11, ambulanceStage: 12, car: 13, arrestRide: 14, arrestAlight: 15 };
const OLD_CRIME_KIND = { none: 0, theft: 1, mugging: 2, breakIn: 3 };
const OLD_ACTIVITY = { none: 0, idle: 1, talk: 2, buy: 3, door: 4, sitDown: 5, sit: 6, standUp: 7, bump: 8, swing: 9, block: 10, hit: 11, sitSteps: 12, cuffing: 13, cuffed: 14, arresting: 15, escorting: 16, carIn: 17, carOut: 18, phoneCall: 19, kneel: 20, recoil: 21 };
const OLD_MOOD = { fine: 0, happy: 1, proud: 2, sad: 3, busy: 4, exhausted: 5, hurt: 6, afraid: 7, hungry: 8, lonely: 9, restless: 10, angry: 11, annoyed: 12, worried: 13 };
const OLD_VENUE = { other: 0, home: 1, office: 2, coffee: 3, bar: 4, diner: 5, shop: 6, supermarket: 7, park: 8, transit: 9 };
const OLD_EVENT_CODE = { none: 0, arrived: 1, born: 2, gotJob: 3, retired: 4, fired: 5, promoted: 6, relationship: 7, breakup: 8, married: 9, baby: 10, moved: 11, injured: 12, cured: 13, knocked: 14, backFromHospital: 15, workplaceClosed: 16, workplaceReopened: 17, lostSomeone: 18, familyKnocked: 19, stoopWrecked: 20, staticComplaint: 21, backOnBus: 22, shoplifted: 23, muggedSomeone: 24, brokeIntoCar: 25, wasMugged: 26, carBrokenInto: 27, shopRobbed: 28, reportedCrime: 29, fledDanger: 30, arrested: 31, released: 32, fought: 33, foughtStranger: 34, foughtWalker: 35, jaywalkArrest: 36, sawDanger: 37, calledAmbulance: 38 };
const OLD_ACTIVITY_SECONDS = { none: 0, idle: 0, talk: 0, buy: 3.2, door: 1.8, sitDown: 1.2, sit: 0, standUp: 1.1, bump: 0.7, swing: 0.6, block: 0, hit: 0.9, sitSteps: 0, cuffing: 1.5, cuffed: 0, arresting: 1.5, escorting: 0, carIn: 2.6, carOut: 2.4, phoneCall: 0, kneel: 0, recoil: 0.9 };
const OLD_ACTIVITY_WORDS = [null, null, "talking", "buying at the counter", "going through a door", "sitting down", "sitting", "getting up", "bumped into someone", "swinging a punch", "blocking a punch", "taking a hit", "sitting out on the stoop", "cuffing a suspect", "in handcuffs", "making an arrest", "leading a suspect away", "getting into a car", "getting out of a car", "phoning for an ambulance", "kneeling by someone hurt", "flinching back"];
const M = OLD_MOOD;
const OLD_NEED_MOODS = [M.exhausted, M.hungry, M.restless, M.lonely, M.busy, M.restless];
const OLD_EVENT_MOODS = [
  M.fine, M.happy, M.happy, M.proud, M.fine, M.sad, M.proud, M.busy, M.sad, M.happy, M.exhausted, M.happy, M.hurt, M.happy,
  M.hurt, M.happy, M.sad, M.happy, M.sad, M.sad, M.angry, M.annoyed,
  -1, M.worried, M.worried, M.worried, M.afraid, M.angry, M.angry, M.busy, M.afraid, M.sad, M.annoyed, M.angry, M.angry,
  M.angry, M.annoyed, M.afraid, M.worried,
];
const OLD_PURPOSE_LABELS = ["rest", "a meal", "work", "company", "an errand", "some quiet", "feeding the pigeons", "chasing the cat off with a broom", "stealing fish", "looking for Pepper", "coffee before the broadcast", "the Friday party", "fixing the van", "a run", "chasing the cats", "looking at the wreck", "the Friday party", "the bus", "a coffee", "a drink", "sitting out on the stoop", "a chat with a neighbour", "a row with a neighbour", "hanging about", "calling the police", "getting away", "shoplifting", "looking for someone to mug", "trying the parked cars", "a fight", "looking on", "calling an ambulance"];
const OLD_PURPOSE_LOG_TEXT = ["went home to rest at", "went to eat at", "started a shift at", "went out for company at", "ran an errand at", "went off alone to", "fed the pigeons at", "went after Biscuit with a broom at", "stole fish from", "put up flyers for Pepper around", "walked to the bodega for coffee at", "went to the Friday party at", "went to fix the van, again, at", "ran across", "chased the tabby gang across", "came out to look at the wreck at", "went up to the Friday party at", "took the bus from", "went for a coffee at", "went for a drink at", "sat out on the stoop at", "stopped to chat at", "went to have it out at", "hung about outside", "called the police from", "ran for it to", "went to lift something from", "went looking for trouble at", "went to try the cars outside", "got into a fight outside", "stood looking at the trouble outside", "called an ambulance from"];
const OLD_PURPOSE_MOODS = [-1, -1, -1, -1, -1, -1, M.happy, M.angry, M.hungry, M.worried, M.restless, M.happy, M.restless, M.happy, M.restless, M.busy, M.happy, -1, -1, -1, -1, M.happy, M.angry, -1, M.busy, M.afraid, M.worried, M.worried, M.worried, M.angry, M.afraid, M.worried];
const P = OLD_PURPOSE;
const OLD_OUTDOOR_PURPOSES = [P.stoopSit, P.stoopTalk, P.argue, P.loiter, P.report, P.mug, P.breakIn, P.fight, P.lookOn, P.callAmbulance];
const OLD_DRIVABLE_PURPOSES = [OLD_NEED.rest, OLD_NEED.food, OLD_NEED.work, OLD_NEED.social, OLD_NEED.errand, P.coffee, P.drink];
const OLD_DEFAULT_HOURS = [null, null, null, [6, 15], [16, 3], [7, 23], [7, 22], [8, 21], null, null];
const V = OLD_VENUE;
/** Codes past the last purpose, so a table read beyond its rows answers as the old one did. */
const PROBE_CODES = 48;

/** What the derived maps are called in the cases. */
const DERIVED_MAPS: Readonly<Record<string, Readonly<Record<string, number>>>> = { NEED, PURPOSE, EVENT_KIND, CRIME_KIND, ACTIVITY, MOOD, VENUE, EVENT_CODE, ACTIVITY_SECONDS };

function entriesOf(map: Readonly<Record<string, number>>): string[] {
  return Object.entries(map).map(([id, value]) => `${id}=${value}`);
}

const codeCases = [
  { it: "when the need codes are derived, then they are the hand-kept ones", derived: "NEED", expected: OLD_NEED },
  { it: "when the purpose codes are derived, then they are the hand-kept ones", derived: "PURPOSE", expected: OLD_PURPOSE },
  { it: "when the event kinds are derived, then they are the wire's hand-kept ones", derived: "EVENT_KIND", expected: OLD_EVENT_KIND },
  { it: "when the crime kinds are derived, then they are the hand-kept ones", derived: "CRIME_KIND", expected: OLD_CRIME_KIND },
  { it: "when the activity codes are derived, then they are the hand-kept ones", derived: "ACTIVITY", expected: OLD_ACTIVITY },
  { it: "when the mood codes are derived, then they are the hand-kept ones", derived: "MOOD", expected: OLD_MOOD },
  { it: "when the venue codes are derived, then they are the hand-kept ones", derived: "VENUE", expected: OLD_VENUE },
  { it: "when the life log codes are derived, then they are the hand-kept ones", derived: "EVENT_CODE", expected: OLD_EVENT_CODE },
  { it: "when the activity clip lengths are derived, then they are the hand-kept ones", derived: "ACTIVITY_SECONDS", expected: OLD_ACTIVITY_SECONDS },
] as const;

describe("given the spine's rows, the code maps the brain reads", () => {
  for (const testCase of codeCases) {
    it(testCase.it, () => {
      expect(firstMismatch(entriesOf(DERIVED_MAPS[testCase.derived]!), entriesOf(testCase.expected)), `${testCase.derived} id=code entries in order`).toBeUndefined();
    });
  }
});

describe("given the spine's rows, the words and moods the look-at panel and the life log show", () => {
  it("when a walk's purpose is named, then its label, log line and mood are the hand-kept ones", () => {
    expect(firstMismatch(PURPOSE_LABELS, OLD_PURPOSE_LABELS), "purpose labels").toBeUndefined();
    expect(firstMismatch(PURPOSE_LOG_TEXT, OLD_PURPOSE_LOG_TEXT), "purpose log lines").toBeUndefined();
    expect(firstMismatch(PURPOSE_MOODS, OLD_PURPOSE_MOODS), "purpose moods").toBeUndefined();
  });

  it("when a mood is worded or a pressing need colours it, then the words and need moods are the hand-kept ones", () => {
    expect(firstMismatch(MOOD_WORDS, Object.keys(OLD_MOOD)), "mood words").toBeUndefined();
    expect(firstMismatch(NEED_MOODS, OLD_NEED_MOODS), "need moods").toBeUndefined();
  });

  it("when an event or a walk colours a mood, then each code leaves the hand-kept mood and walks start after the last event", () => {
    expect(VISIT_BASE, "first walk code").toBe(39);
    const moods = Array.from({ length: VISIT_BASE + OLD_PURPOSE_MOODS.length }, (_, code) => moodOfCode(code));
    expect(firstMismatch(moods, [...OLD_EVENT_MOODS, ...OLD_PURPOSE_MOODS]), "mood of each life log code").toBeUndefined();
  });

  it("when an activity is worded for the bubble, then each code reads the hand-kept words", () => {
    const words = Array.from({ length: PROBE_CODES }, (_, code) => activityLine(code));
    expect(firstMismatch(words, Array.from({ length: PROBE_CODES }, (_, code) => OLD_ACTIVITY_WORDS[code] ?? null)), "activity words by code").toBeUndefined();
  });
});

describe("given the spine's rows, the purpose and venue rules the society applies", () => {
  const codes = Array.from({ length: PROBE_CODES }, (_, code) => code);

  it("when a walk ends, then it ends out at a door, takes a car and counts as a crime exactly as the hand-kept tables said", () => {
    expect(firstMismatch(codes.map((purpose) => isOutdoorPurpose(purpose)), codes.map((purpose) => OLD_OUTDOOR_PURPOSES.includes(purpose))), "outdoor by purpose").toBeUndefined();
    expect(firstMismatch(LEG_PURPOSES.map((row) => row.drive), LEG_PURPOSES.map((_, purpose) => OLD_DRIVABLE_PURPOSES.includes(purpose))), "drivable by purpose").toBeUndefined();
    const oldCrime = (purpose: number): number => (purpose === P.shoplift ? 1 : purpose === P.mug ? 2 : purpose === P.breakIn ? 3 : 0);
    expect(firstMismatch(codes.map((purpose) => crimeKindOf(purpose)), codes.map(oldCrime)), "crime kind by purpose").toBeUndefined();
    expect(codes.filter((purpose) => isOutdoorPurpose(purpose)), "outdoor purposes counted").toHaveLength(OLD_OUTDOOR_PURPOSES.length);
  });

  it("when a customer comes in, then she sits and buys at a counter where the hand-kept venue rules said, in their default hours", () => {
    const venues = codes.slice(0, 12);
    expect(firstMismatch(venues.map((venue) => isSeatedVenue(venue)), venues.map((venue) => venue === V.coffee || venue === V.bar || venue === V.diner)), "seated venues").toBeUndefined();
    expect(firstMismatch(venues.map((venue) => isCounterVenue(venue)), venues.map((venue) => [V.coffee, V.bar, V.diner, V.shop, V.supermarket].includes(venue))), "counter venues").toBeUndefined();
    expect(firstMismatch(Object.values(VENUES).map((row) => (row.hours === null ? "always" : row.hours.join("-"))), OLD_DEFAULT_HOURS.map((hours) => (hours === null ? "always" : hours.join("-")))), "default hours by venue").toBeUndefined();
  });
});

function declares(source: string, name: string): boolean {
  return new RegExp(`(function ${name}\\b|^\\s+(private |protected |static )*${name}\\()`, "m").test(source);
}

describe("given the spine's tables", () => {
  it("when a row names the code that launches it, then that file declares that function", () => {
    const rows = [...Object.entries(NEEDS), ...Object.entries(PURPOSES), ...Object.entries(ACTIVITIES)].map(([id, row]) => ({ id, launch: row.launch }));
    const kinds = Object.entries(EVENT_KINDS).map(([id, row]) => ({ id, launch: row.brain }));
    const launches = [...rows, ...kinds].flatMap((row) => row.launch.map((launch) => ({ id: row.id, launch })));
    const missing = launches.filter(({ launch }) => {
      const [file, name] = launch.split("#");
      return !declares(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), name!);
    });
    expect(missing.map(({ id, launch }) => `${id}: ${launch}`), "launches whose function is not declared").toHaveLength(0);
    expect(launches.length, "launches checked").toBeGreaterThan(LEG_PURPOSES.length);
  });

  it("when the needs are coded, then they are the first purposes and their count is the need count", () => {
    expect(NEED_COUNT, "need count").toBe(Object.keys(NEEDS).length);
    expect(LEG_PURPOSES[NEED_COUNT]!.label, "first purpose after the needs").toBe(PURPOSES.salPigeons.label);
  });
});
