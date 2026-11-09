import { describe, expect, it } from "vitest";
import { SCAN_SECONDS } from "./auto-constants.ts";
import { AutoDirector, type AutoCandidates, SUBJECT, type SubjectKind } from "./auto-director.ts";

const SEED = 21;
/** The owner's numbers, not the code's: a subject is held 5 to 10 seconds. */
const HOLD_MIN_SECONDS = 5;
const HOLD_MAX_SECONDS = 10;
const FRAME_S = 0.1;
const CAPACITY = 16;
/** A frame's slack on the hold's ends: the director is stepped in frames of `FRAME_S`. */
const SLACK_S = FRAME_S + 1e-9;
const RUN_S = 600;
/** More than a scan a second over twenty seconds of nothing is a scan a frame. */
const MOST_SCANS = 60;

type Subject = { kind: SubjectKind; id: number; interest: number; here: boolean };

/** A world scripted by the row: the subjects now in it, with how interesting each is and whether it can still be watched. */
class ScriptedScan {
  subjects: Subject[];
  scans = 0;

  constructor(subjects: Subject[]) {
    this.subjects = subjects;
  }

  fill(table: AutoCandidates): void {
    this.scans++;
    for (const subject of this.subjects) if (subject.here) table.add(subject.kind, subject.id, subject.interest);
  }

  watchable(kind: SubjectKind, id: number): boolean {
    return this.subjects.some((subject) => subject.here && subject.kind === kind && subject.id === id);
  }
}

const walker = (id: number, interest: number): Subject => ({ kind: SUBJECT.civilian, id, interest, here: true });
const driver = (id: number, interest: number): Subject => ({ kind: SUBJECT.driver, id, interest, here: true });

type Cut = { at: number; kind: number; id: number };

/** Runs the director over `seconds` in frames, noting every cut; `each` may change the world at each frame's start. */
function run(director: AutoDirector, scan: ScriptedScan, seconds: number, each: (now: number) => void = () => {}): Cut[] {
  const cuts: Cut[] = [];
  for (let frame = 0; frame * FRAME_S < seconds; frame++) {
    const now = frame * FRAME_S;
    each(now);
    if (director.step(FRAME_S, scan)) cuts.push({ at: now + FRAME_S, kind: director.kind, id: director.id });
  }
  return cuts;
}

/** One civilian everyone looks at first, and four quiet ones. */
const crowdOfFive = () => new ScriptedScan([walker(0, 0.9), ...[1, 2, 3, 4].map((id) => walker(id, 0.2))]);

describe("given the director over a street of five civilians, one of them more to watch than the rest", () => {
  it(`when ten minutes run, then every subject is held ${HOLD_MIN_SECONDS} to ${HOLD_MAX_SECONDS} seconds before the cut to the next`, () => {
    const cuts = run(new AutoDirector(CAPACITY, SEED), crowdOfFive(), RUN_S);
    const holds = cuts.slice(1).map((cut, at) => cut.at - cuts[at]!.at);
    expect(cuts.length, "cuts in ten minutes").toBeGreaterThan(RUN_S / HOLD_MAX_SECONDS - 2);
    expect(Math.min(...holds), "the shortest hold (s)").toBeGreaterThanOrEqual(HOLD_MIN_SECONDS - SLACK_S);
    expect(Math.max(...holds), "the longest hold (s)").toBeLessThanOrEqual(HOLD_MAX_SECONDS + SLACK_S);
    expect(new Set(holds.map((hold) => Math.round(hold * 2))).size, "distinct hold lengths (half seconds): the hold is seeded, not fixed").toBeGreaterThan(3);
  });

  it("when the same seed runs twice, then the cuts are the same, and another seed cuts elsewhere", () => {
    const same = [run(new AutoDirector(CAPACITY, SEED), crowdOfFive(), RUN_S), run(new AutoDirector(CAPACITY, SEED), crowdOfFive(), RUN_S)];
    const other = run(new AutoDirector(CAPACITY, SEED + 1), crowdOfFive(), RUN_S);
    expect(JSON.stringify(same[1]), "the second run of the seed").toBe(JSON.stringify(same[0]));
    expect(JSON.stringify(other), "a run of another seed").not.toBe(JSON.stringify(same[0]));
  });

  it("when it cuts through a long run, then it never cuts to the subject on screen or to the one it left", () => {
    const cuts = run(new AutoDirector(CAPACITY, SEED), crowdOfFive(), RUN_S);
    const repeats = cuts.filter((cut, at) => at >= 1 && cut.id === cuts[at - 1]!.id).length;
    const returns = cuts.filter((cut, at) => at >= 2 && cut.id === cuts[at - 2]!.id).length;
    expect(repeats, "cuts to the subject already on screen").toBe(0);
    expect(returns, "cuts straight back to the subject just left").toBe(0);
  });
});

describe("given the director holding a quiet civilian", () => {
  it("when a fight breaks out at 2 s, then the camera waits out the minimum hold and cuts to it at once after, not at the end of the hold", () => {
    const scan = new ScriptedScan([walker(0, 0.2), walker(1, 0.15)]);
    const director = new AutoDirector(CAPACITY, SEED);
    const cuts = run(director, scan, HOLD_MAX_SECONDS * 2, (now) => {
      if (now >= 2 && scan.subjects.length === 2) scan.subjects.push(walker(9, 1));
    });
    const toFight = cuts.find((cut) => cut.id === 9);
    expect(toFight, "a cut to the fight").toBeDefined();
    expect(toFight!.at, "when it cut to the fight (s)").toBeGreaterThanOrEqual(HOLD_MIN_SECONDS - SLACK_S);
    expect(toFight!.at, "when it cut to the fight (s)").toBeLessThanOrEqual(HOLD_MIN_SECONDS + SCAN_SECONDS + SLACK_S);
  });

  it("when nothing on the street is hotter than what is on screen, then the hold runs its length and the cut goes to the best of what is left", () => {
    const scan = new ScriptedScan([walker(0, 0.9), walker(1, 0.3), walker(2, 0.6), walker(3, 0.4)]);
    const director = new AutoDirector(CAPACITY, SEED);
    const cuts = run(director, scan, HOLD_MIN_SECONDS * 3);
    expect(cuts[0]!.id, "the first subject: the hottest").toBe(0);
    expect(cuts[1]!.id, "the second: the best of the rest, not the one just left").toBe(2);
    expect(cuts[1]!.at - cuts[0]!.at, "how long the first was held (s)").toBeGreaterThanOrEqual(HOLD_MIN_SECONDS - SLACK_S);
  });

  it("when the subject on screen is a civilian and a car is nearly as interesting as the best civilian, then it varies and cuts to the car", () => {
    const scan = new ScriptedScan([walker(0, 0.9), walker(1, 0.6), driver(2, 0.5)]);
    const cuts = run(new AutoDirector(CAPACITY, SEED), scan, HOLD_MAX_SECONDS + 1);
    expect(cuts.map((cut) => cut.id), "the first two subjects").toEqual([0, 2]);
  });

  it("when the subject on screen is gone, then the next frame cuts away from it at once", () => {
    const scan = new ScriptedScan([walker(0, 0.9), walker(1, 0.3), walker(2, 0.2)]);
    const director = new AutoDirector(CAPACITY, SEED);
    const cuts = run(director, scan, 3);
    expect(cuts.map((cut) => cut.id), "the first subject").toEqual([0]);
    scan.subjects[0]!.here = false;
    expect(director.step(FRAME_S, scan), "a cut the frame the subject goes").toBe(true);
    expect(director.id, "the subject cut to").toBe(1);
  });

  it("when nothing in the world is worth a look, then it holds where it is, tries again each scan, and cuts when something comes", () => {
    const scan = new ScriptedScan([walker(0, 0.9)]);
    const director = new AutoDirector(CAPACITY, SEED);
    run(director, scan, 1);
    const scans = scan.scans;
    expect(run(director, scan, HOLD_MAX_SECONDS * 2).length, "cuts with nobody else there").toBe(0);
    expect(scan.scans - scans, "scans in 20 s of nothing").toBeGreaterThan(HOLD_MAX_SECONDS);
    expect(scan.scans - scans, "scans in 20 s of nothing: one a scan period, not one a frame").toBeLessThan(MOST_SCANS);
    scan.subjects.push(walker(5, 0.5));
    const later = run(director, scan, SCAN_SECONDS * 2 + HOLD_MAX_SECONDS);
    expect(later[0]?.id, "the first cut once someone is there").toBe(5);
  });
});
