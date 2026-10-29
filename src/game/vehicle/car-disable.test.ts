import { describe, expect, it } from "vitest";
import { launch, makeCar, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { carLayout } from "../net/car-pose.ts";
import { makeCarFrame } from "../net/codec.ts";
import type { DeformableCar } from "./car.ts";
import { DT } from "./test-support.ts";

/** `from`'s wreck section (what a highlight keyframe and a netplay snapshot carry of a wreck) laid on `to`, as a replay restores it. */
function restoreWreck(from: DeformableCar, to: DeformableCar): void {
  const f = makeCarFrame(carLayout(from));
  from.deform.readNetState(f.deform);
  from.readPartNetState(f.parts);
  if ((f.deform.flags & 1) !== 0) to.deform.armMasses(to.group, to.velocity, to.angular);
  to.writeNetState(f.deform, f.parts);
}

describe("given a car whose engine is killed from outside the crash sim (a guard's gunfire)", () => {
  it("when it was doing 15 m/s and nobody drives it, then it rolls to a stop and sleeps like a crash-killed wreck, not on at its speed for good", () => {
    const car = makeCar();
    launch(car, 0, 0, 0, 0, 15);
    const w = makeWorld([car], false, false);
    for (let f = 0; f < 30; f++) tickWorld(w, DT);
    const from = car.group.position.clone();
    car.disable();
    let slept = -1;
    for (let f = 0; f < 600 && slept < 0; f++) {
      tickWorld(w, DT);
      if (car.asleep) slept = f;
    }
    expect(slept, "asleep within 10 s").toBeGreaterThanOrEqual(0);
    expect(car.group.position.distanceTo(from), `stopped within 20 m, rolled ${car.group.position.distanceTo(from).toFixed(1)} m`).toBeLessThan(20);
  });

  it("when its engine is killed, then it is a wreck with a dead drivetrain and the kill is counted for the recorder, not as a placement", () => {
    const car = makeCar();
    launch(car, 0, 0, 0, 0, 0);
    const placed = car.placements;
    car.disable();
    expect(car.deform.drivetrainAlive, "the engine").toBe(false);
    expect(car.crashed && car.deform.massActive, "a wreck").toBeTruthy();
    expect(car.kills, "counted as a kill").toBe(1);
    expect(car.placements, "not put anywhere").toBe(placed);
  });

  const testCases = [
    { it: "when a shot-dead car's wreck section restores a running wreck (a highlight replay's keyframe), then the restored car's engine is dead", disabled: true, expectedAlive: false },
    { it: "when a running wreck's section restores a shot-dead car, then the restored car's engine runs", disabled: false, expectedAlive: true },
  ] as const;

  for (const testCase of testCases) {
    it(testCase.it, () => {
      const recorded = makeCar();
      launch(recorded, 0, 0, 0, 0, 0);
      const replayed = makeCar();
      launch(replayed, 0, 0, 0, 0, 0);
      // Both are wrecks (the kill makes the shot car one): only the engine differs.
      for (const car of [recorded, replayed]) {
        car.deform.armMasses(car.group, car.velocity, car.angular);
        car.crashed = true;
      }
      if (testCase.disabled) recorded.disable();
      else replayed.disable();
      restoreWreck(recorded, replayed);
      expect(replayed.deform.drivetrainAlive, "the replayed car's engine").toBe(testCase.expectedAlive);
    });
  }
});
