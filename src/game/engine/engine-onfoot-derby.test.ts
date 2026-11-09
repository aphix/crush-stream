import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DeformableCar } from "../vehicle/car.ts";
import { carRuns } from "../vehicle/car-drive.ts";
import { standingBite } from "../vehicle/wheel-bite.ts";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";
import { must } from "../kernel/must.test-util.ts";

const FALL_WITHIN_S = 1.5;
/** A derby grid's cars brake hard (12 m/s²) until green: the rival that runs him down starts this close and this fast to meet him above the strike speed (4 m/s). */
const GRID_RUN_UP_M = 2.5;
const GRID_HIT_MPS = 11;
/** The crown comes within this many seconds of the green light (s): the grid and the countdown are 4.5 s, a held car is not counted out for a minute. */
const CROWNED_WITHIN_S = 15;
/** Where the rivals' wrecks are put (m): the far side of the arena from the player's grid spot, in a row. */
const WRECKS_AT_X = 22;
const WRECKS_SPACING_Z = 5;
/** What driving off must move his car (m) in 2 s. */
const DRIVES_OFF_M = 2;
/** Sim s past the green light the eject rows start at: the grid and countdown are 4.5 s, and the cars are rolling by then. */
const RUN_TO_S = 3;
/** How long a row watches a thrown driver's car (s). */
const WATCH_S = 2;
/** A car this fast (m/s) is driving when its driver goes out. */
const ROLLING_MPS = 2;
/** The eject rows' derby field seed: unpinned, `toggleDerby` rolls one, and some fields have no rival rolling when the second row starts. */
const DERBY_SEED = 1;

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
  expect(drivable(car), "the car stands on its wheels").toBeTruthy();
  rig.engine["ejection"].throwDriverNow(rig.cars(), i);
  rig.engine["keys"].add("KeyW");
  let coasted = false;
  for (let t = 0; t < WATCH_S; t += FRAME) {
    rig.run(FRAME);
    expect(noPedals(car), `+${t.toFixed(2)} s: throttle ${car.drive.throttle}, brake ${car.drive.brake}, steer ${car.drive.steer}`).toBeTruthy();
    coasted ||= car.drive.neutral;
  }
  rig.engine["keys"].delete("KeyW");
  expect(coasted, "it freewheels").toBeTruthy();
  expect(car.driverOut, "his seat stays empty").toBe("windshield");
}

beforeAll(async () => {
  rig = await OnFootRig.boot();
  rig.engine["looping"] = false;
});
afterAll(() => rig.dispose());

describe("given the real engine in a derby, the player at the wheel of his car on the grid among the rivals", () => {
  beforeAll(() => {
    rig.engine.toggleDerby();
    rig.run(0.5);
    expect(rig.engine.derbyMode, "the derby is on").toBeTruthy();
    rig.sit(0);
    rig.run(FRAME);
    expect(rig.engine["seat"].mode, "the player has the wheel").toBe("drive");
  });

  // mutation: sed -i 's/return this.begin("exiting", sense.car, "exitStarted");/return this.refuse("tooFast");/' src/game/present/onfoot-flow.ts  (getting out is always refused: red at the climb out)
  it("when he gets out on the grid, is run down by a rival, and every rival's engine then dies, then his car is the last one alive and wins while he is still on foot, and he gets back in and drives", () => {
    const self = rig.engine["seat"].carIndex;
    const own = rig.cars()[self]!;
    const rival = rig.cars().find((_, i) => i !== self)!;
    rig.getOut();
    expect(rig.away(), "his car is the one he left").toBe(self);
    rig.walkTo(rig.beside(own, 2, 3), 1.5, 15);
    rig.runDownBy(rival, own, "ahead", GRID_HIT_MPS, GRID_RUN_UP_M);
    for (let t = 0; t < FALL_WITHIN_S && rig.walker().state === "stand"; t += FRAME) rig.run(FRAME);
    expect(rig.walker().state, "the rival knocked him down").not.toBe("stand");
    // Every rival's engine dies, each on the far side of the arena (a wreck stopping at his door would be in his way).
    for (const [i, car] of rig.cars().entries()) {
      if (i === self) continue;
      car.spawnFacing(WRECKS_AT_X, WRECKS_SPACING_Z * (i - 2), 0, 0);
      car.disable();
    }
    for (let t = 0; t < CROWNED_WITHIN_S && derby().winnerId == null; t += FRAME) rig.run(FRAME);
    expect(derby().winnerId, "the last car alive won").toBe(self);
    expect(derby().decided, "by the rivals' wrecks").toBe("wreck");
    expect(rig.phase(), "he was on foot when it was decided").not.toBe("inCar");
    rig.getUp();
    rig.getIn();
    const driven = own.group.position.clone();
    rig.hold("KeyW", 2);
    expect(own.group.position.distanceTo(driven), `he drove his car again: ${own.group.position.distanceTo(driven).toFixed(1)} m`).toBeGreaterThan(DRIVES_OFF_M);
  });
});

describe("given the real engine in a derby, past the green light, the player at the wheel among AI rivals", () => {
  beforeAll(() => {
    // A derby the first group left decided goes back to the fleet; the seeded one starts fresh.
    if (rig.engine.derbyMode) rig.engine.toggleDerby();
    rig.normalTime();
    rig.engine["onFoot"].reset();
    rig.engine["ragdolls"].reset();
    rig.engine["pinnedSeed"] = DERBY_SEED;
    rig.engine.toggleDerby();
    rig.run(0.5);
    expect(rig.engine.derbyMode, "the derby is on").toBeTruthy();
    expect(derby().winnerId ?? null, "the control: a new derby, nobody has won").toBeNull();
    rig.sit(0);
    rig.engine["keys"].add("KeyW");
    while (derby().time < RUN_TO_S) rig.run(FRAME);
    rig.engine["keys"].delete("KeyW");
  });

  it("when the player's driver is thrown out with the gas held, then his car takes no pedals, coasts, and is out of the heat", () => {
    const self = rig.engine["seat"].carIndex;
    const own = rig.cars()[self]!;
    expect(own.velocity.length(), `his car runs at ${own.velocity.length().toFixed(1)} m/s`).toBeGreaterThan(ROLLING_MPS);
    expect(row(self).alive).toBe(true);
    throwAndWatch(self);
    expect(row(self).alive, "a thrown driver's car is a wreck to the rules").toBe(false);
  });

  it("when an AI rival's driver is thrown out, then its car takes no pedals and is out; once every car but one has lost its driver, that one wins by wreck", () => {
    const self = rig.engine["seat"].carIndex;
    const running = rig.cars().flatMap((c, i) => (carRuns(c) ? [i] : []));
    const rolling = running.find((i) => i !== self && rig.cars()[i]!.velocity.length() > ROLLING_MPS);
    must(rolling !== undefined, "a rival is driving");
    throwAndWatch(rolling);
    expect(row(rolling).alive, "a thrown driver's car is a wreck to the rules").toBe(false);
    const last = running.find((i) => i !== rolling)!;
    for (const i of running) if (i !== rolling && i !== last && derby().winnerId == null) rig.engine["ejection"].throwDriverNow(rig.cars(), i);
    rig.run(0.1);
    expect(derby().winnerId, "the last car with a driver in it won").toBe(last);
    expect(derby().decided).toBe("wreck");
  });
});
