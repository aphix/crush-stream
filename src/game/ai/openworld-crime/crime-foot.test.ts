import { describe, expect, it } from "vitest";
import { CASE_PHASE, SUBJECT_MODE } from "./case-table.ts";
import { CRIME_STREAM, FIND_CHANCE, FOOT_COP_COUNT, GRIP_SECONDS } from "./crime-constants.ts";
import { crimeDraw } from "./crime-draw.ts";
import { bustedResidents, EAST_HIDE, FAR_TICK, footX, harness, NODE_SPACING, runFor, seedWhere } from "./crime-fixture.test-util.ts";

const CRIMINAL = 1;
const CRIMINAL_WALKER = FOOT_COP_COUNT;

describe("a crime calls the nearest cops", () => {
  it("sends the two nearest free cops running at the criminal, and they close on them", () => {
    const run = harness([10, 0, 0]);
    run.offences.x[CRIMINAL] = 100;
    run.offences.commitCrime(CRIMINAL);
    runFor(run, 1);
    const { table } = run.scene.foot;
    expect(table.phase[0], "a case is open").toBe(CASE_PHASE.open);
    expect(table.copAt(0, 0), "the nearest cop").toBe(0);
    expect(table.copAt(0, 1), "then the next").toBe(1);
    const early = 100 - footX(run, 0);
    runFor(run, 3);
    expect(early - (100 - footX(run, 0)), "metres the nearest cop closed in three seconds").toBeGreaterThan(10);
  });
});

describe("a cop within reach busts", () => {
  it("cuffs a criminal a cop stands within arm's reach of and has the host raise the bust once", () => {
    const run = harness([60, 0, 0]);
    run.offences.x[CRIMINAL] = 60;
    run.offences.commitCrime(CRIMINAL);
    runFor(run, 10);
    expect(bustedResidents(run)).toBe(String(CRIMINAL));
    expect(run.busts[0]!.seconds, "the cuffs take GRIP_SECONDS from the poll that found the cop at arm's length").toBeCloseTo(0.5 + GRIP_SECONDS, 1);
    expect(run.scene.foot.table.phase[0], "the case is closed").toBe(CASE_PHASE.free);
  });

  it("lets a client lay the same hands on but leaves the event to the host", () => {
    const run = harness([60, 0, 0], { authority: false });
    run.offences.x[CRIMINAL] = 60;
    run.offences.commitCrime(CRIMINAL);
    runFor(run, 8);
    expect(run.busts, "no event raised").toHaveLength(0);
    expect(run.scene.stats.busts, "the suspect is still taken off the street").toBe(1);
  });
});

describe("a criminal runs from the cops", () => {
  it("runs east when the cops are west of them and west when they are east", () => {
    const eastBound = harness([40, 0, 0]);
    eastBound.offences.x[CRIMINAL] = 60;
    eastBound.offences.commitCrime(CRIMINAL);
    runFor(eastBound, 3.5);
    expect(footX(eastBound, CRIMINAL_WALKER), "run from cops to the west").toBeGreaterThan(66);
    const westBound = harness([80, 120, 120]);
    westBound.offences.x[CRIMINAL] = 60;
    westBound.offences.commitCrime(CRIMINAL);
    runFor(westBound, 3.5);
    expect(footX(westBound, CRIMINAL_WALKER), "run from cops to the east").toBeLessThan(54);
  });

  it("is drawn where the law has them, running, not where the crowd had them", () => {
    const run = harness([40, 0, 0]);
    run.offences.x[CRIMINAL] = 60;
    run.offences.commitCrime(CRIMINAL);
    runFor(run, 2);
    expect(run.scene.foot.table.mode[0]).toBe(SUBJECT_MODE.fleeing);
    expect(run.poses.shown[CRIMINAL]).toBe(1);
    expect(run.poses.x[CRIMINAL], "the overlay's place, blended between the last two grid steps").toBeCloseTo(run.scene.foot.walkers.drawnX(CRIMINAL_WALKER, run.scene.drawShare), 3);
    expect(run.poses.x[CRIMINAL], "not the crowd's").toBeGreaterThan(61);
    expect(run.poses.speed[CRIMINAL], "at a run").toBeGreaterThan(3);
  });
});

describe("a criminal hides", () => {
  const foundSeed = seedWhere((seed) => crimeDraw(seed, CRIME_STREAM.find, CRIMINAL, FAR_TICK), FIND_CHANCE, true);
  const missedSeed = seedWhere((seed) => crimeDraw(seed, CRIME_STREAM.find, CRIMINAL, FAR_TICK), FIND_CHANCE, false);

  function hidingRun(seed: number) {
    const run = harness([0, 0, 0], { seed });
    run.offences.x[CRIMINAL] = 60;
    run.offences.commitCrime(CRIMINAL);
    return run;
  }

  it("is found at the alley door by a cop who draws a find, and busted", () => {
    const run = hidingRun(foundSeed);
    runFor(run, 60);
    expect(bustedResidents(run)).toBe(String(CRIMINAL));
    expect(run.scene.foot.table.phase[0]).toBe(CASE_PHASE.free);
  });

  it("gets away when the search finds nothing, and stays off the street until a walk begins", () => {
    const run = hidingRun(missedSeed);
    runFor(run, 60);
    expect(run.busts).toHaveLength(0);
    expect(run.scene.stats.lost, "the search was given up").toBe(1);
    expect(run.poses.shown[CRIMINAL], "held off the street").toBe(0);
    expect(footX(run, CRIMINAL_WALKER), "at the east door").toBe(EAST_HIDE * NODE_SPACING);
    run.offences.departSeconds[CRIMINAL] = run.now + 0.5;
    runFor(run, 1);
    expect(run.poses.shown[CRIMINAL], "back in the crowd with their next walk").toBe(1);
  });
});
