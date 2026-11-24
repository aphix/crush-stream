import { describe, expect, it } from "vitest";
import { pooledCar } from "../../contact/crash-scenarios.test-util.ts";
import { DOOR, type Frontage, STOOP } from "../../world/openworld/openworld-facade-solids.ts";
import { Stoops } from "../../world/openworld/openworld-stoops.ts";
import { harness, NODE_SPACING, runFor, STEP_SECONDS, type Harness } from "./crime-fixture.test-util.ts";

/** The line city's corner whose door a rowhome's stoop runs out from, east along the street (x = 60, z = 0): its facade is `DOOR.across` north of the line. */
const DOOR_NODE = 6;
const DOOR_X = DOOR_NODE * NODE_SPACING;
const HOUSE: Frontage = { x: DOOR_X, z: -DOOR.across, yaw: 0, depth: 10, style: "federal", storeys: 3, variant: 0 };
const CRIMINAL = 1;

/** A harness with the rowhome's stoop in the law's scene: cops 0 on the landing at the door, 1 on the sidewalk 3 m out from the facade and 2 beside the stoop at the facade (2 m across the door's line). */
function stoopRun(): Harness {
  const run = harness([DOOR_X, DOOR_X + 3, DOOR_X]);
  run.scene.foot.walkers.place(2, DOOR_X, 2);
  run.scene.stoops = new Stoops([HOUSE], [DOOR_NODE]);
  return run;
}

describe("given a foot cop standing on a rowhome's stoop and others on the sidewalk", () => {
  it("when the cops are drawn, then the one on the landing is at the door sill's height and those on the sidewalk, in front of the stoop and beside it, are at the street's", () => {
    const run = stoopRun();
    runFor(run, 2 * STEP_SECONDS);
    const cops = run.scene.copPoses;
    expect(cops.feetY[0], "on the landing (m)").toBeCloseTo(STOOP.sill, 2);
    expect(cops.feetY[1], "3 m out on the sidewalk (m)").toBe(0);
    expect(cops.feetY[2], "beside the stoop at the facade (m)").toBe(0);
  });

  it("when a punch puts the cop on the landing down, then he is thrown from where he is drawn: the sill's height", () => {
    const run = stoopRun();
    runFor(run, 2 * STEP_SECONDS);
    for (let blow = 0; blow < 3; blow++) run.scene.punchCop(DOOR_X - 1, 0, 1, 0, run.now);
    const strikes = run.scene.takeCopStrikes();
    expect(strikes.length, "one throw").toBe(1);
    expect(strikes[0]!.y, "where the thrown cop starts (m)").toBeCloseTo(STOOP.sill, 2);
  });
});

describe("given a guest whose host punched down the cop on a rowhome's landing", () => {
  it("when it throws him from the host's knock, then he starts at the sill's height, as the host's throw of him does", () => {
    const run = harness([DOOR_X, DOOR_X + 3, DOOR_X], { authority: false });
    run.scene.stoops = new Stoops([HOUSE], [DOOR_NODE]);
    const car = pooledCar(0);
    car.group.position.set(DOOR_X + 20, 0, 0);
    run.cars.push(car);
    runFor(run, 2 * STEP_SECONDS);
    run.scene.hearCopDown(0, run.now);
    runFor(run, 2 * STEP_SECONDS);
    const strikes = run.scene.takeCopStrikes();
    expect(strikes.length, "one throw").toBe(1);
    expect(strikes[0]!.y, "where the thrown cop starts (m)").toBeCloseTo(STOOP.sill, 2);
  });
});

describe("given a guest with the host's frames whose last one hid the cop on the landing before the host's knock came due", () => {
  it("when it throws him, then he starts at the landing's height from the host's last record of him", () => {
    const run = harness([DOOR_X, DOOR_X + 3, DOOR_X], { authority: false });
    run.scene.stoops = new Stoops([HOUSE], [DOOR_NODE]);
    const car = pooledCar(0);
    car.group.position.set(DOOR_X + 20, 0, 0);
    run.cars.push(car);
    run.scene.heardPoses = true;
    const cops = run.scene.copPoses;
    cops.shown[0] = 1;
    cops.x[0] = DOOR_X;
    cops.z[0] = 0;
    run.scene.markHeardCops();
    run.scene.liftHeard(run.poses);
    cops.shown[0] = 0;
    run.scene.foot.walkers.place(0, 0, 0);
    runFor(run, 2 * STEP_SECONDS);
    run.scene.hearCopDown(0, run.now);
    runFor(run, 2 * STEP_SECONDS);
    const strikes = run.scene.takeCopStrikes();
    expect(strikes.length, "one throw").toBe(1);
    expect(strikes[0]!.x, "from where the host drew him (m)").toBeCloseTo(DOOR_X, 1);
    expect(strikes[0]!.y, "where the thrown cop starts (m)").toBeCloseTo(STOOP.sill, 2);
  });
});

describe("given a guest with the host's frames that has heard no record for a cop", () => {
  it("when his knock comes due, then he is thrown from the law walker's spot, not from the origin", () => {
    const run = harness([DOOR_X, DOOR_X + 3, DOOR_X], { authority: false });
    const car = pooledCar(0);
    car.group.position.set(DOOR_X + 20, 0, 0);
    run.cars.push(car);
    run.scene.heardPoses = true;
    run.scene.foot.walkers.place(0, DOOR_X + 1, 0);
    runFor(run, 2 * STEP_SECONDS);
    run.scene.hearCopDown(0, run.now);
    runFor(run, 2 * STEP_SECONDS);
    const strikes = run.scene.takeCopStrikes();
    expect(strikes.length, "one throw").toBe(1);
    expect(strikes[0]!.x, "from the law walker's spot, x (m)").toBeCloseTo(DOOR_X + 1, 0);
    expect(strikes[0]!.z, "from the law walker's spot, z (m)").toBeCloseTo(0, 0);
  });
});

describe("given a suspect the law holds on a rowhome's stoop", () => {
  /** A crime at the stoop's door with a cop on it: the cuffs go on at the first poll. */
  function cuffsOn(): Harness {
    const run = stoopRun();
    run.offences.x[CRIMINAL] = DOOR_X;
    run.offences.commitCrime(CRIMINAL);
    runFor(run, 1);
    return run;
  }

  it("when she is drawn in the cop's hands at the door, then she is at the door sill's height, the crowd is told to keep her on its steps, and a resident the law does not hold is at the street's", () => {
    const run = cuffsOn();
    expect(run.poses.shown[CRIMINAL], "she is drawn").toBe(1);
    expect(run.poses.feetY[CRIMINAL], "at the sill (m)").toBeCloseTo(STOOP.sill, 2);
    expect(run.poses.onSpur[CRIMINAL], "kept on the steps, not moved off them").toBe(1);
    expect(run.poses.feetY[0], "a resident the law does not hold (m)").toBe(0);
    expect(run.poses.onSpur[0], "is not marked").toBe(0);
  });

  it("when a guest has the host's poses drawn, then the same rule lifts its cop on the landing and the suspect, and leaves the cop on the sidewalk on the street", () => {
    const run = cuffsOn();
    run.scene.heardPoses = true;
    const cops = run.scene.copPoses;
    cops.feetY.fill(0);
    cops.shown.fill(0);
    for (const [cop, x] of [[0, DOOR_X], [1, DOOR_X + 3]] as const) {
      cops.shown[cop] = 1;
      cops.x[cop] = x;
      cops.z[cop] = 0;
    }
    run.poses.feetY.fill(0);
    run.poses.onSpur.fill(0);
    run.scene.liftHeard(run.poses);
    expect(cops.feetY[0], "a cop on the landing (m)").toBeCloseTo(STOOP.sill, 2);
    expect(cops.feetY[1], "a cop 3 m out (m)").toBe(0);
    expect(run.poses.feetY[CRIMINAL], "the suspect (m)").toBeCloseTo(STOOP.sill, 2);
    expect(run.poses.onSpur[CRIMINAL], "marked").toBe(1);
  });
});
