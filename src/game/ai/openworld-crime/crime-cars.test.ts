import { describe, expect, it } from "vitest";
import { CAR_COP, RED_LIGHT_SIGHT } from "./crime-constants.ts";
import { COP_MODE } from "./foot-cops.ts";
import { bustedResidents, harness, runFor, type Harness } from "./crime-fixture.test-util.ts";

const RUNNER_RESIDENT = 2;
const EAST = Math.PI / 2;
/** Where the light is: the runner crosses it on red at (60, 0). */
const LIGHT_X = 60;

/** A red light at x = 60 with a foot cop forty metres west of it and a patrol car that would start at the west end, facing the light. */
function lightRun(options: { runnerSpeed: number; resident: number; traffic: boolean }): { run: Harness; runner: number } {
  const run = harness([40, 0, 0], { withCars: true });
  const street = run.street!;
  street.leaseAt = { x: 0, z: 0, yaw: EAST };
  const runner = street.addCar(LIGHT_X, 0, EAST, options.runnerSpeed, options.resident, options.traffic);
  return { run, runner };
}

describe("a red-light runner a cop sees is pursued and arrested", () => {
  it("sends a patrol car after a traffic car that ran the light, makes it pull over and busts its driver", () => {
    const { run, runner } = lightRun({ runnerSpeed: 12, resident: RUNNER_RESIDENT, traffic: true });
    expect(run.scene.reportRedLight(runner, LIGHT_X, 0), "a cop saw it").toBe(true);
    expect(run.street!.sirens[1], "the patrol car's siren is on").toBe(true);
    runFor(run, 45);
    expect(bustedResidents(run)).toBe(String(RUNNER_RESIDENT));
    expect(run.street!.snaps[runner]!.vx, "the runner stopped").toBeCloseTo(0, 1);
  });

  it("does not chase a car no cop saw", () => {
    const run = harness([0, 0, 0], { withCars: true });
    const runner = run.street!.addCar(110, 0, EAST, 12, RUNNER_RESIDENT, true);
    expect(run.scene.foot.copSees(110, 0, RED_LIGHT_SIGHT), "no cop within sight of the light").toBe(false);
    expect(run.scene.reportRedLight(runner, 110, 0)).toBe(false);
    expect(run.street!.leases, "no car left the pool").toBe(0);
  });

  it("lets the traffic have the car back and lets the patrol car go after the impound", () => {
    const { run, runner } = lightRun({ runnerSpeed: 12, resident: RUNNER_RESIDENT, traffic: true });
    run.scene.reportRedLight(runner, LIGHT_X, 0);
    runFor(run, 80);
    expect(run.street!.drivers[runner], "the traffic's own driver again").toBeNull();
    expect(run.street!.released.join(","), "the patrol car was let go").toBe("1");
  });
});

describe("a human is held longer than a traffic driver", () => {
  it("busts a stopped human only after Survival's hold, and the player's car is the engine's to deal with", () => {
    const { run, runner } = lightRun({ runnerSpeed: 0, resident: -1, traffic: false });
    run.scene.reportRedLight(runner, LIGHT_X, 0);
    runFor(run, 12);
    expect(run.playerBusts, "the hold is longer than twelve seconds from when the cop is near").toHaveLength(0);
    runFor(run, 30);
    expect(run.playerBusts.join(",")).toBe(String(runner));
    expect(run.busts, "no resident is busted").toHaveLength(0);
  });

  it("holds a traffic driver for the race's time, shorter than a human's", () => {
    const { run, runner } = lightRun({ runnerSpeed: 0, resident: RUNNER_RESIDENT, traffic: true });
    run.scene.reportRedLight(runner, LIGHT_X, 0);
    runFor(run, 12);
    expect(bustedResidents(run)).toBe(String(RUNNER_RESIDENT));
    expect(run.busts[0]!.seconds, "inside the twelve seconds a human is held after the cop is near").toBeLessThan(12);
  });
});

describe("a patrol car comes to a crime", () => {
  it("drives to the scene, stops short of it, and its cop steps out and joins the case", () => {
    const run = harness([0, 0, 0], { withCars: true });
    run.street!.leaseAt = { x: 60, z: -40, yaw: 0 };
    run.offences.x[1] = 60;
    run.offences.commitCrime(1);
    runFor(run, 12);
    const { table, cops } = run.scene.foot;
    expect(run.street!.leases, "one car leased").toBe(1);
    expect(run.street!.sirens[0], "with its siren on").toBe(true);
    expect(cops.mode[CAR_COP], "its cop is out").not.toBe(COP_MODE.off);
    expect(table.copAt(0, 2), "the case's last cop slot").toBe(CAR_COP);
    expect(run.street!.snaps[0]!.z, "the car stopped on the street short of the door").toBeLessThan(-3);
  });
});

describe("a driver who keeps running people down is chased", () => {
  function recklessRun(): { run: Harness; car: number } {
    const run = harness([0, 0, 0], { withCars: true });
    const car = run.street!.addCar(60, 0, EAST, 0, -1, false);
    runFor(run, 0.1);
    return { run, car };
  }

  it("sends a patrol car after the car on its third knock within a minute, not before", () => {
    const { run, car } = recklessRun();
    expect(run.scene.noteKnock(car, 60, 0)).toBe(false);
    expect(run.scene.noteKnock(car, 60, 0)).toBe(false);
    expect(run.street!.leases, "no car sent yet").toBe(0);
    expect(run.scene.noteKnock(car, 60, 0)).toBe(true);
    expect(run.street!.leases, "one patrol car sent").toBe(1);
  });

  it("forgets knocks a minute apart", () => {
    const { run, car } = recklessRun();
    run.scene.noteKnock(car, 60, 0);
    runFor(run, 65);
    run.scene.noteKnock(car, 60, 0);
    expect(run.scene.noteKnock(car, 60, 0), "two in this minute").toBe(false);
    expect(run.street!.leases).toBe(0);
  });
});
