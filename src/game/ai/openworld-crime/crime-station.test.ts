import { detCos } from "../../kernel/physics-core.js";
import { describe, expect, it } from "vitest";
import { must } from "../../kernel/must.test-util.ts";
import { ACTIVITY } from "../civilians/civilian-activity.ts";
import { CASE_PHASE, SUBJECT_MODE } from "./case-table.ts";
import { ACTIVITY_SECONDS } from "../civilians/civilian-activity.ts";
import { BESIDE_COP, CAR_LINGER_SECONDS, ESCORT_ARRIVE, ESCORT_SECONDS, ESCORT_SPEED, GRIP_SECONDS, MAX_PATROL_CARS, PATROL_COPS } from "./crime-constants.ts";
import { footX, harness, NODE_SPACING, runFor, runUntil, STATION_NODE, type Harness } from "./crime-fixture.test-util.ts";
import type { FakeStreet } from "./crime-street.test-util.ts";
import { COP_MODE } from "./foot-cops.ts";

const CRIMINAL = 1;
const WALKER = 2;
const CRIME_X = 20;
const CAR_CRIME_X = 60;
const CROSSING_X = 65;
/** The station's door on the line city, and the least a cuffed suspect takes to be walked to it (s) from where she is cuffed. */
const STATION_X = STATION_NODE * NODE_SPACING;
const walkSeconds = (fromX: number): number => (STATION_X - fromX - ESCORT_ARRIVE) / ESCORT_SPEED;

/** The harness's street, which a row that asks for cars has. */
function streetOf(run: Harness): FakeStreet {
  const { street } = run;
  must(street, "the harness has a street");
  return street;
}

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
  streetOf(run).leaseAt = { x: CAR_CRIME_X, z: -20, yaw: 0 };
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
  // mutation: sed -i 's/ || this.table.allCaught(caseIndex)) return;/) return;/' src/game/ai/openworld-crime/foot-law.ts
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
  // mutation: sed -i 's/<= BOARD_REACH && cars.isStill(car)) {/<= -1) {/' src/game/ai/openworld-crime/arrests.ts
  it("when she is cuffed, then she and her cop get into the car at its driver's door, the door swinging with the clip, and are off the street once it is over", () => {
    const run = arrestWithCar();
    const street = streetOf(run);
    const { table, cops } = run.scene.foot;
    runUntil(run, 20, () => table.mode[0] === SUBJECT_MODE.boarding);
    expect(table.mode[0], "she is getting in").toBe(SUBJECT_MODE.boarding);
    runFor(run, 1);
    expect(run.poses.activity[CRIMINAL], "her clip").toBe(ACTIVITY.carIn);
    expect(run.scene.copPoses.activity[table.holder[0]!], "his clip").toBe(ACTIVITY.carIn);
    expect(run.poses.x[CRIMINAL], "at the driver's door").toBeCloseTo(street.snaps[0]!.x + street.doorBeside + BESIDE_COP * detCos(-Math.PI / 2), 1);
    expect(street.doorRadians[0], "the door is open").toBeGreaterThan(0);
    expect(run.busts, "busts raised").toHaveLength(0);
    runFor(run, ACTIVITY_SECONDS.carIn);
    expect(table.mode[0], "she is in the car").toBe(SUBJECT_MODE.conveyed);
    expect(run.poses.shown[CRIMINAL], "off the street").toBe(0);
    expect(cops.onStreet(table.holder[0]!), "her cop with her").toBe(false);
    expect(street.doorRadians[0], "the door is shut").toBe(0);
  });

  // mutation: sed -i '/^    this.ports.setSirens(handle, false);$/d' src/game/ai/openworld-crime/patrol-cars.ts
  it("when the car drives to the station, then its siren is off, and there they get out and walk in at the door, where the bust is raised with her cop", () => {
    const run = arrestWithCar();
    const street = streetOf(run);
    const { table } = run.scene.foot;
    runUntil(run, 60, () => table.mode[0] === SUBJECT_MODE.conveyed);
    expect(street.sirens[0], "siren off on the way").toBe(false);
    expect(street.redirects.at(-1)!.x, "the car was sent to the station's door").toBe(STATION_X);
    runUntil(run, 60, () => table.mode[0] === SUBJECT_MODE.alighting);
    expect(table.mode[0], "she is getting out").toBe(SUBJECT_MODE.alighting);
    expect(street.snaps[0]!.x, "the car is at the station").toBeCloseTo(STATION_X, 0);
    runFor(run, 1);
    expect(run.poses.activity[CRIMINAL], "her clip").toBe(ACTIVITY.carOut);
    expect(run.busts, "busts raised").toHaveLength(0);
    runUntil(run, 60, () => run.busts.length > 0);
    expect(run.busts, "busts raised").toHaveLength(1);
    expect(run.busts[0]!.seconds, "sooner than the whole walk would take").toBeLessThan(walkSeconds(CAR_CRIME_X));
  });

  // mutation: sed -i 's/    if (slot < MAX_PATROL_CARS) {/    if (false) {/' src/game/ai/openworld-crime/patrol-cars.ts
  it("when the arrest is over, then the case's car is put away in a few seconds", () => {
    const run = arrestWithCar();
    const street = streetOf(run);
    runUntil(run, 60, () => run.busts.length > 0);
    expect(street.released, "not put away yet").toHaveLength(0);
    runFor(run, CAR_LINGER_SECONDS + 1);
    expect(street.released, "put away").toContain(0);
  });

  // mutation: sed -i 's/    if (mode === SUBJECT_MODE.boarding && cars.convey(car, station.x, station.z, seconds)) {/    if (mode === SUBJECT_MODE.boarding) {/' src/game/ai/openworld-crime/arrests.ts
  it("when the car finds no way to the station, then she is walked there instead", () => {
    const run = arrestWithCar();
    const street = streetOf(run);
    street.redirect = () => false;
    runUntil(run, 2 * walkSeconds(CAR_CRIME_X), () => run.busts.length > 0);
    expect(run.busts, "busts raised").toHaveLength(1);
    expect(run.busts[0]!.seconds, "after the walk's time at the least").toBeGreaterThan(walkSeconds(CAR_CRIME_X) - ESCORT_SECONDS);
  });
});

describe("the foot cops' own patrol cars, on a map with a police station", () => {
  /** Three cars may be leased for the cops, and any case's car is a long way off: the crime at x = 20 has no car at its scene for a good while. */
  function homeRun(): Harness {
    const run = harness([CRIME_X, 0, 0], { station: true, withCars: true });
    const street = streetOf(run);
    street.homeCars = 3;
    street.leaseAt = { x: -300, z: 0, yaw: Math.PI / 2 };
    return run;
  }

  // mutation: sed -i 's/      cars.keepHome(cop, nodeX\[node\]!, nodeZ\[node\]!, this.seconds);//' src/game/ai/openworld-crime/foot-law.ts
  it("when the law starts, then each foot cop has a car of his own, siren off, sent to the kerb by his beat's start", () => {
    const run = homeRun();
    const street = streetOf(run);
    runFor(run, 1);
    expect(street.leases, "cars leased").toBe(PATROL_COPS);
    for (let cop = 0; cop < PATROL_COPS; cop++) {
      expect(street.tripX[cop], `where cop ${cop}'s car is sent`).toBe(run.scene.foot.cops.homeNode(cop) * NODE_SPACING);
      expect(street.sirens[cop], `cop ${cop}'s siren`).toBeFalsy();
    }
  });

  // mutation: sed -i 's/    if (cop >= HOME_CARS || this.mode\[home\] !== PATROL_MODE.parked) return -1;/    return -1;/' src/game/ai/openworld-crime/patrol-cars.ts
  it("when a cop makes an arrest with no case car at the scene, then his own car is called to him and takes her to the station", () => {
    const run = homeRun();
    const street = streetOf(run);
    run.offences.x[CRIMINAL] = CRIME_X;
    run.offences.commitCrime(CRIMINAL);
    const { table } = run.scene.foot;
    runUntil(run, 40, () => table.mode[0] === SUBJECT_MODE.boarding);
    expect(table.mode[0], "she is getting in").toBe(SUBJECT_MODE.boarding);
    expect(table.carOf[0], "a cop's own car (slots after the case cars)").toBeGreaterThanOrEqual(MAX_PATROL_CARS);
    expect(street.snaps[street.redirects.find((call) => call.x === CRIME_X)?.handle ?? 0]!.x, "the car was called to where they stand").toBeGreaterThan(CRIME_X - 5);
    runUntil(run, 90, () => run.busts.length > 0);
    expect(run.busts, "busts raised at the station").toHaveLength(1);
  });
});
