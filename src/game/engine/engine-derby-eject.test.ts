import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DeformableCar } from "../vehicle/car.ts";
import { carRuns } from "../vehicle/car-drive.ts";
import { standingBite } from "../vehicle/wheel-bite.ts";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";

/** Sim s past the green light the rows start at: the grid and countdown are 4.5 s, and the cars are rolling by then. */
const RUN_TO_S = 3;
/** How long a row watches a thrown driver's car (s). */
const WATCH_S = 2;
/** A car this fast (m/s) is driving when its driver goes out. */
const ROLLING_MPS = 2;
/** The derby's field seed: unpinned, `toggleDerby` rolls one, and some fields have no rival rolling when the second row starts. */
const DERBY_SEED = 1;

describe("given the real engine in a derby, past the green light, the player at the wheel among AI rivals", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let rig: OnFootRig;
  const derby = () => rig.engine["derby"];
  const row = (id: number) => derby().board.find((r) => r.id === id)!;

  /** `car`'s last applied pedals and wheel are all zero. */
  function noPedals(car: DeformableCar): boolean {
    const d = car.drive;
    return d.throttle === 0 && d.brake === 0 && d.steer === 0 && !d.ebrake && !d.boost;
  }

  /** `car` runs and stands on wheels that bite: what the seat or the AI can drive. */
  const drivable = (car: DeformableCar): boolean => car.deform.drivetrainAlive && car.wheelsDown > 0 && standingBite(car) > 0;

  /**
   * Once car `i` stands on its wheels, the watch throws its driver out of the windshield (`EjectionWatch.throwDriverNow`) and the engine
   * runs `WATCH_S` with W held: no frame gives the car pedals, and it freewheels (`DriveInput.neutral`).
   */
  function throwAndWatch(i: number): void {
    const car = rig.cars()[i]!;
    for (let t = 0; t < WATCH_S && !drivable(car); t += FRAME) rig.run(FRAME);
    assert.ok(drivable(car), "the car stands on its wheels");
    rig.engine["ejection"].throwDriverNow(rig.cars(), i);
    rig.engine["keys"].add("KeyW");
    let coasted = false;
    for (let t = 0; t < WATCH_S; t += FRAME) {
      rig.run(FRAME);
      assert.ok(noPedals(car), `+${t.toFixed(2)} s: throttle ${car.drive.throttle}, brake ${car.drive.brake}, steer ${car.drive.steer}`);
      coasted ||= car.drive.neutral;
    }
    rig.engine["keys"].delete("KeyW");
    assert.ok(coasted, "it freewheels");
    assert.equal(car.driverOut, "windshield", "his seat stays empty");
  }

  before(async () => {
    rig = await OnFootRig.boot();
    rig.engine["looping"] = false;
    rig.engine["pinnedSeed"] = DERBY_SEED;
    rig.engine.toggleDerby();
    rig.run(0.5);
    assert.ok(rig.engine.derbyMode, "the derby is on");
    rig.sit(0);
    rig.engine["keys"].add("KeyW");
    while (derby().time < RUN_TO_S) rig.run(FRAME);
    rig.engine["keys"].delete("KeyW");
  });
  after(() => rig.dispose());

  it("when the player's driver is thrown out with the gas held, then his car takes no pedals, coasts, and is out of the heat", () => {
    const self = rig.engine["seat"].carIndex;
    const own = rig.cars()[self]!;
    assert.ok(own.velocity.length() > ROLLING_MPS, `his car runs at ${own.velocity.length().toFixed(1)} m/s`);
    assert.equal(row(self).alive, true);
    throwAndWatch(self);
    assert.equal(row(self).alive, false, "a thrown driver's car is a wreck to the rules");
  });

  it("when an AI rival's driver is thrown out, then its car takes no pedals and is out; once every car but one has lost its driver, that one wins by wreck", () => {
    const self = rig.engine["seat"].carIndex;
    const running = rig.cars().flatMap((c, i) => (carRuns(c) ? [i] : []));
    const rolling = running.find((i) => i !== self && rig.cars()[i]!.velocity.length() > ROLLING_MPS);
    assert.ok(rolling !== undefined, "a rival is driving");
    throwAndWatch(rolling);
    assert.equal(row(rolling).alive, false, "a thrown driver's car is a wreck to the rules");
    const last = running.find((i) => i !== rolling)!;
    for (const i of running) if (i !== rolling && i !== last && derby().winnerId == null) rig.engine["ejection"].throwDriverNow(rig.cars(), i);
    rig.run(0.1);
    assert.equal(derby().winnerId, last, "the last car with a driver in it won");
    assert.equal(derby().decided, "wreck");
  });
});
