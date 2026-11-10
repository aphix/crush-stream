import { describe, expect, it } from "vitest";
import { must } from "../../kernel/must.test-util.ts";
import { ACTIVITY } from "../civilians/civilian-activity.ts";
import { CASE_PHASE, SUBJECT_MODE } from "./case-table.ts";
import { CAR_LINGER_SECONDS, ESCORT_ARRIVE, ESCORT_SECONDS, ESCORT_SPEED, GRIP_SECONDS } from "./crime-constants.ts";
import { footX, harness, NODE_SPACING, runFor, runUntil, STATION_NODE, type Harness } from "./crime-fixture.test-util.ts";
import { COP_MODE } from "./foot-cops.ts";

const CRIMINAL = 1;
const WALKER = 2;
const CRIME_X = 20;
const CAR_CRIME_X = 60;
const CROSSING_X = 65;
/** The station's door on the line city, and the least a cuffed suspect takes to be walked to it (s) from where she is cuffed. */
const STATION_X = STATION_NODE * NODE_SPACING;
const walkSeconds = (fromX: number): number => (STATION_X - fromX - ESCORT_ARRIVE) / ESCORT_SPEED;

/** A crime at x = 20 with a cop standing on it and a police station down the street: the cuffs go on at the first poll. */
function arrestWithStation(): Harness {
  const run = harness([CRIME_X, 0, 0], { station: true });
  run.offences.x[CRIMINAL] = CRIME_X;
  run.offences.commitCrime(CRIMINAL);
  return run;
}

/** A crime at x = 60 with a cop standing on it, and a patrol car that reaches the scene before the cuffs are on. */
function arrestWithCar(): Harness {
  const run = harness([CAR_CRIME_X, 0, 0], { station: true, withCars: true });
  const { street } = run;
  must(street, "the harness has a street");
  street.leaseAt = { x: CAR_CRIME_X, z: -20, yaw: 0 };
  run.offences.x[CRIMINAL] = CAR_CRIME_X;
  run.offences.commitCrime(CRIMINAL);
  return run;
}

describe("an arrest on a map with a police station", () => {
  // mutation: sed -i 's/if (!escorted || !this.arrests.endsAtStation) this.raiseArrest/if (true) this.raiseArrest/' src/game/ai/openworld-crime/foot-law.ts
  it("when the cuffs go on, then the host's bust is not raised yet: she is led along the street past the six seconds a street arrest lasts", () => {
    const run = arrestWithStation();
    runFor(run, GRIP_SECONDS + ESCORT_SECONDS + 4);
    expect(run.busts, "busts raised").toHaveLength(0);
    expect(run.scene.foot.table.mode[0], "she is being led away").toBe(SUBJECT_MODE.escorted);
    expect(run.poses.shown[CRIMINAL], "still on the street").toBe(1);
    expect(run.poses.activity[CRIMINAL], "cuffed").toBe(ACTIVITY.cuffed);
  });

  // mutation: sed -i 's/ESCORT_TO.station, station.x, station.z/ESCORT_TO.station, station.x - 30, station.z/' src/game/ai/openworld-crime/arrests.ts
  it("when she is walked the whole way, then the bust is raised with her cop at the station's door, after a walk's time, and she is gone from the street and the case closes", () => {
    const run = arrestWithStation();
    runUntil(run, 2 * walkSeconds(CRIME_X), () => run.busts.length > 0);
    expect(run.busts, "busts raised").toHaveLength(1);
    expect(run.busts[0]!.resident, "who").toBe(CRIMINAL);
    expect(run.busts[0]!.seconds, "after the walk's time at the least").toBeGreaterThan(walkSeconds(CRIME_X));
    const { table } = run.scene.foot;
    expect(footX(run, table.holder[0]!), "her cop stands at the door").toBeGreaterThanOrEqual(STATION_X - ESCORT_ARRIVE);
    runFor(run, 1);
    expect(run.poses.shown[CRIMINAL], "gone from the street").toBe(0);
    expect(table.phase[0], "the case is closed").toBe(CASE_PHASE.free);
  });

  // mutation: sed -i 's/    this.sendOtherCopsBack(caseIndex, cop);//' src/game/ai/openworld-crime/arrests.ts
  it("when the cuffs go on with no one left to catch, then the case's other cop goes back to patrol while hers leads her away", () => {
    const run = arrestWithStation();
    const { cops, table } = run.scene.foot;
    runFor(run, 1);
    expect(cops.caseOf[1], "the second cop answered the case").toBe(0);
    runFor(run, GRIP_SECONDS + 1);
    expect(table.mode[0], "she is led away").toBe(SUBJECT_MODE.escorted);
    expect(cops.mode[1], "the second cop is back on patrol").toBe(COP_MODE.patrol);
    expect(cops.caseOf[1], "no longer on the case").toBe(-1);
    expect(cops.mode[table.holder[0]!], "hers leads her").toBe(COP_MODE.escort);
  });

  // mutation: sed -i 's/ESCORT_TO.station ? STATION_ESCORT_SECONDS : ESCORT_SECONDS/ESCORT_SECONDS/' src/game/ai/openworld-crime/arrests.ts
  it("when a cop stops a jaywalker, then the jaywalk arrest is raised at the door too, not a bust", () => {
    const run = harness([40, 0, 0], { station: true });
    run.offences.x[WALKER] = CROSSING_X;
    run.signals.against = true;
    runFor(run, ESCORT_SECONDS + 4);
    expect(run.jaywalks, "raised while she is still walked").toHaveLength(0);
    runUntil(run, 2 * walkSeconds(CROSSING_X), () => run.jaywalks.length > 0);
    expect(run.jaywalks.map((arrest) => arrest.resident).join(","), "the jaywalker").toBe(String(WALKER));
    expect(run.jaywalks[0]!.seconds, "after the walk's time").toBeGreaterThan(walkSeconds(CROSSING_X));
    expect(run.busts, "no bust").toHaveLength(0);
  });
});

describe("an arrest by a case whose patrol car has come, on a map with a police station", () => {
  // mutation: sed -i 's/if (arrived \&\& this.hooks.carry(caseIndex, station.x, station.z))/if (false \&\& this.hooks.carry(caseIndex, station.x, station.z))/' src/game/ai/openworld-crime/arrests.ts
  it("when she is cuffed, then she is led to the car and driven to the station, and the bust is raised when it gets there, sooner than a walk", () => {
    const run = arrestWithCar();
    const { street } = run;
    must(street, "the harness has a street");
    runUntil(run, 60, () => run.busts.length > 0);
    expect(run.busts, "busts raised").toHaveLength(1);
    expect(street.redirects.at(-1)!.x, "the car was sent to the station's door").toBe(STATION_X);
    expect(street.snaps[0]!.x, "the car is at the station").toBeCloseTo(STATION_X, 0);
    expect(run.busts[0]!.seconds, "sooner than the walk would take").toBeLessThan(walkSeconds(CAR_CRIME_X));
  });

  // mutation: sed -i 's/mode === SUBJECT_MODE.hidden || mode === SUBJECT_MODE.conveyed ||/mode === SUBJECT_MODE.hidden ||/' src/game/ai/openworld-crime/crime-poses.ts
  it("when she is in the car on the way, then she is off the street and the bust is not raised yet", () => {
    const run = arrestWithCar();
    const { table } = run.scene.foot;
    runUntil(run, 60, () => table.mode[0] === SUBJECT_MODE.conveyed);
    expect(table.mode[0], "she is driven").toBe(SUBJECT_MODE.conveyed);
    runFor(run, 0.1);
    expect(run.poses.shown[CRIMINAL], "off the street").toBe(0);
    expect(run.busts, "busts raised").toHaveLength(0);
  });

  // mutation: sed -i '/^    this.linger(slot, seconds, CAR_LINGER_SECONDS);$/d' src/game/ai/openworld-crime/patrol-cars.ts
  it("when the car has brought her, then its siren is on until it gets there, goes off at the station, and it is put away in a few seconds", () => {
    const run = arrestWithCar();
    const { street } = run;
    must(street, "the harness has a street");
    runUntil(run, 60, () => run.scene.foot.table.mode[0] === SUBJECT_MODE.conveyed);
    expect(street.sirens[0], "siren on the way").toBe(true);
    runUntil(run, 60, () => run.busts.length > 0);
    expect(street.sirens[0], "siren off at the station").toBe(false);
    expect(street.released, "not put away yet").toHaveLength(0);
    runFor(run, CAR_LINGER_SECONDS + 1);
    expect(street.released, "put away").toContain(0);
  });

  // mutation: sed -i 's/      else this.walkToStation(caseIndex, slot, cop, seconds, station);/      else this.board(caseIndex, slot, cop, seconds);/' src/game/ai/openworld-crime/arrests.ts
  it("when the car finds no way to the station, then she is walked there instead", () => {
    const run = arrestWithCar();
    const { street } = run;
    must(street, "the harness has a street");
    street.redirect = () => false;
    runUntil(run, 2 * walkSeconds(CAR_CRIME_X), () => run.busts.length > 0);
    expect(run.busts, "busts raised").toHaveLength(1);
    expect(run.busts[0]!.seconds, "after the walk's time at the least").toBeGreaterThan(walkSeconds(CAR_CRIME_X) - ESCORT_SECONDS);
  });
});
