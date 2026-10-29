import { describe, expect, it } from "vitest";
import { todoRow } from "../kernel/todo-row.test-util.ts";
import * as THREE from "three";
import type { DeformableCar } from "./car.ts";
import type { ExitPane } from "./car-core.ts";
import { FREEWHEEL, launch, makeCar, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { BARRIER_HALF } from "../contact/sat.ts";
import { ejectionVelocity, ejectThreshold, killSpeed, THROW_OUT, type Ejection } from "./ejection.ts";
import { collide, fleetCar, headOn, worn } from "./ejection.test-util.ts";
import { RANGE } from "../scenes/range.ts";
import { assignClass, armKill, DEFAULT_REALISM, killClass, killTravel, VEHICLE_CLASS_IDS } from "./vehicle-classes.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

/** Run the crash 2.5 s through the engine's frame: each throw as [car, exit, pre-hit speed]. */
function throws(cars: DeformableCar[], barrier = false): [number, ExitPane, number][] {
  const w = makeWorld(cars, barrier, false, FREEWHEEL);
  for (let f = 0; f < 150; f++) tickWorld(w);
  return w.ejections
    .map((e): [number, ExitPane, number] => {
      // His own velocity is the car's pre-hit one plus the throw out of the pane (the way out, `THROW_OUT` along `dir`).
      const v = ejectionVelocity(e, new THREE.Vector3());
      return [e.car, e.exit, Math.hypot(v.x - e.dir.x * THROW_OUT, v.z - e.dir.z * THROW_OUT)];
    })
    .sort((a, b) => a[0] - b[0]);
}

/** The throws as [car, exit] rows, compared row by row. */
function expectThrown(out: [number, ExitPane, number][], expected: [number, ExitPane][]) {
  expect(out, "throws").toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) expect(firstMismatch([out[i]![0], out[i]![1]], expected[i]!), `throw ${i} [car, exit]`).toBeUndefined();
}

describe("given two cars crashing, where a disabling head-on or side hit, or a door slammed into a hit at a frontal kill's speed, throws a driver out", () => {
  it("when two cars drive head-on at 56 km/h each, then both engines die and both drivers are thrown out through the windshield at their pre-hit speed", () => {
    const a = makeCar();
    const b = makeCar();
    launch(a, -5, 0, Math.PI / 2, 56 / 3.6, 0);
    launch(b, 5, 0, -Math.PI / 2, -56 / 3.6, 0);
    const out = throws([a, b]);
    expect(!a.deform.drivetrainAlive && !b.deform.drivetrainAlive, "the head-on disabled both").toBeTruthy();
    expectThrown(out, [[0, "windshield"], [1, "windshield"]]);
    for (const [, , speed] of out) expect(Math.abs(speed - 56 / 3.6), `thrown from ${speed.toFixed(2)} m/s`).toBeLessThan(0.5);
    expect(a.driverOut, "the car carries the flag").toBe("windshield");
    expect(b.driverOut).toBe("windshield");
  });

  it("when a T-bone finishes a worn-out car, then its driver is thrown out of the struck side's window (doorR: +x, the car's left and the driver's own door) and the striking car's driver stays in", () => {
    const struck = worn(makeCar());
    const bullet = makeCar();
    launch(struck, 0, 0, 0, 0, 0);
    launch(bullet, 6, 0, -Math.PI / 2, -50 / 3.6, 0);
    const out = throws([struck, bullet]);
    expect(!struck.deform.drivetrainAlive, "the T-bone disabled the worn car").toBe(true);
    expectThrown(out, [[0, "doorR"]]);
    expect(bullet.driverOut, "the bullet's driver stays in").toBe(null);
  });

  it("when two cars drive head-on at 28 km/h each and both engines keep running, then nobody is thrown out", () => {
    const a = makeCar();
    const b = makeCar();
    launch(a, -5, 0, Math.PI / 2, 28 / 3.6, 0);
    launch(b, 5, 0, -Math.PI / 2, -28 / 3.6, 0);
    const out = throws([a, b]);
    expect(a.deform.drivetrainAlive && b.deform.drivetrainAlive, "the hit did not disable").toBeTruthy();
    expect(out).toHaveLength(0);
    expect(a.driverOut).toBe(null);
  });

  it("when a fleet car meets another head-on at 72 km/h each (the HUD's 0–32 m/s launch range) at the default realism, then neither car dies yet both drivers are thrown out", () => {
    const [a, b] = headOn(20);
    const out = throws([a, b]);
    expect(a.deform.drivetrainAlive && b.deform.drivetrainAlive, "the default realism leaves both engines running").toBeTruthy();
    expectThrown(out, [[0, "windshield"], [1, "windshield"]]);
  });

  // todo -> after the plan: recalibrate the off-centre scrape's crush against the lever's spin. The 12 deg scrape at 80 km/h leaves the worn
  // car's drivetrain at health 0.544 (the test needs it dead, 0) with the engine packed 0.010 m and no driver thrown; the lever's spin takes
  // the energy the crush used to take.
  todoRow("when an 80 km/h scrape down the barrier's flank finishes a worn-out car, then nobody is thrown out", true, () => {
    const car = worn(fleetCar());
    // Angled 12° into the barrier's +x face, the left flank 0.3 m off it: the front-left corner meets it near z = 0.
    const v = 80 / 3.6;
    const a = (12 * Math.PI) / 180;
    const t = 0.3 / (v * Math.sin(a));
    launch(car, BARRIER_HALF.x + 1.2, -v * Math.cos(a) * t - 2.2, -a, -v * Math.sin(a), v * Math.cos(a));
    const out = throws([car], true);
    expect(!car.deform.drivetrainAlive, "the scrape finished the worn car").toBe(true);
    expect(Math.abs(car.deform.impactInward.x), "struck along its flank").toBeGreaterThan(4 * Math.abs(car.deform.impactInward.z));
    expect(out).toHaveLength(0);
    expect(car.driverOut).toBe(null);
  });

  it("when a 50 km/h rear hit finishes a worn-out car, then nobody is thrown out", () => {
    const car = worn(makeCar());
    launch(car, BARRIER_HALF.x + 6.2, 0, Math.PI / 2, -50 / 3.6, 0);
    const out = throws([car], true);
    expect(!car.deform.drivetrainAlive, "the rear hit disabled the worn car").toBe(true);
    expect(car.deform.impactInward.z, "it was struck from behind").toBeGreaterThan(Math.abs(car.deform.impactInward.x));
    expect(out).toHaveLength(0);
  });

  it("when a fleet sedan slides sideways into the barrier at 22 m/s, then its engine keeps running and its driver is thrown out of the door window that met the barrier", () => {
    const car = fleetCar();
    // Facing +z, sliding along +x: its right side (car-local +x) leads into the barrier's -x face.
    launch(car, -BARRIER_HALF.x - 2.4, 0, 0, 22, 0);
    const out = throws([car], true);
    expect(car.deform.drivetrainAlive, "the side blow left the engine running").toBeTruthy();
    expectThrown(out, [[0, "doorR"]]);
  });

  it("when two fleet sedans slide sideways together, 10 and 18 m/s across their run, and the faster one's door meets the other's at 8 m/s, then nobody is thrown out", () => {
    const a = fleetCar();
    const b = fleetCar();
    // Both facing +x at 30 m/s, sliding toward +z; b, 2.3 m to a's right (-z), closes on a's right door with its left.
    launch(a, 0, 0, Math.PI / 2, 30, 10);
    launch(b, 0, -2.3, Math.PI / 2, 30, 18);
    const out = throws([a, b]);
    expect(a.crashed && b.crashed, "their doors met hard enough to dent").toBeTruthy();
    expect(out).toHaveLength(0);
  });
});

describe("given a throw (the ejection event: everything a dummy needs to be launched again)", () => {
  /** The 2×56 km/h head-on, each throw checked against the car as the sim had it that very step. */
  function observed(): { seen: Ejection[]; checked: number } {
    const a = makeCar();
    const b = makeCar();
    launch(a, -5, 0, Math.PI / 2, 56 / 3.6, 0);
    launch(b, 5, 0, -Math.PI / 2, -56 / 3.6, 0);
    const w = makeWorld([a, b], false, false, FREEWHEEL);
    const seen: Ejection[] = [];
    let checked = 0;
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    w.onEject = (e) => {
      seen.push(e);
      const car = w.cars[e.car]!;
      // The car-local position is the world one in the car's frame, at the step he left in.
      p.copy(e.local).applyQuaternion(q.copy(car.group.quaternion)).add(car.group.position);
      expect(p.distanceTo(e.pos), `local ${e.local.toArray()} is not world ${e.pos.toArray()} in the car's frame (${p.distanceTo(e.pos)} m)`).toBeLessThan(1e-4);
      // Out of the pane: unit, and level for a windshield exit.
      expect(Math.abs(e.dir.length() - 1), "unit direction").toBeLessThan(1e-6);
      // His own velocity is the car's plus the relative one: the car's own, as the sim has it that step, is in the event.
      expect(e.carVel.distanceTo(car.velocity), "the car's own velocity rides along").toBeLessThan(1e-5);
      expect(e.cop).toBe(false);
      checked++;
    };
    for (let f = 0; f < 150; f++) tickWorld(w);
    return { seen, checked };
  }

  it("when two cars crash head-on at 56 km/h each, then each throw's car-local and world exit agree in the car's frame, its direction is a unit vector and its numbers are exact in 32-bit floats", () => {
    const { seen, checked } = observed();
    expect(checked).toBe(2);
    for (const e of seen) {
      for (const v of [e.pos, e.local, e.dir, e.rel, e.carVel, e.spin]) for (const x of v.toArray()) expect(Math.fround(x), "f32-exact").toBe(x);
      for (const x of e.quat.toArray()) expect(Math.fround(x), "f32-exact").toBe(x);
    }
  });

  it("when two cars crash head-on at 56 km/h each, then each driver leaves the windshield on his own side, the car's left (+x), where the steering wheel is", () => {
    const { seen } = observed();
    expect(seen.length).toBe(2);
    for (const e of seen) expect(e.exit === "windshield" && e.local.x > 0.15, `out of ${e.exit} at car-local x ${e.local.x.toFixed(2)}`).toBeTruthy();
  });

  it("when the same crash is run twice, then it gives the very same throws, since the decision is deterministic simulation state", () => {
    const run = (): string => JSON.stringify(observed().seen);
    expect(run()).toBe(run());
  });

  it("when a later hit lands on a car whose driver is already out, then that driver is not thrown again but the other car's driver is", () => {
    const a = makeCar();
    const b = makeCar();
    launch(a, -5, 0, Math.PI / 2, 56 / 3.6, 0);
    launch(b, 5, 0, -Math.PI / 2, -56 / 3.6, 0);
    a.driverOut = "windshield";
    const w = makeWorld([a, b], false, false, FREEWHEEL);
    for (let f = 0; f < 150; f++) tickWorld(w);
    expect(firstMismatch(w.ejections.map((e) => e.car), [1])).toBeUndefined();
  });

  it("when the car is put back (a respawn), then its driver is back in", () => {
    const a = fleetCar();
    a.driverOut = "doorL";
    a.spawnFacing(0, 0, 0, 0);
    expect(a.driverOut).toBe(null);
  });
});

describe("given a fleet sedan driving at 30 m/s on open road, struck once on its flank and then losing its drivetrain (a throw needs a hit behind the kill)", () => {
  /**
   * A fleet sedan at 30 m/s on open road, struck once on its flank (7 m/s closing), then `gap` s without a new hit, driven on
   * at 30 m/s (its masses held to it for the last 0.5 s: a racing car, not a wreck sliding to a stop), then its drivetrain
   * dies (`touch`: just after a graze touched it, as a car alongside does): the throws.
   */
  function killedAfter(gap: number, touch = false): Ejection[] {
    const car = fleetCar();
    launch(car, 0, 0, 0, 0, 30);
    const w = makeWorld([car], false, false, FREEWHEEL);
    car.applyImpact(new THREE.Vector3(-0.9, 0.5, -0.5), new THREE.Vector3(0.84, 0, -0.52), 7, 3.5);
    const frames = Math.round(gap * 60);
    for (let f = 0; f < frames; f++) {
      if (f >= frames - 30) for (const m of car.deform.masses) m.vel.set(0, 0, 30);
      tickWorld(w);
    }
    expect(car.deform.drivetrainAlive, "the hit left the engine running").toBeTruthy();
    if (touch) car.deform.notifyContact();
    car.deform.drivetrainAlive = false;
    for (let f = 0; f < 3; f++) tickWorld(w);
    return w.ejections;
  }

  it("when the drivetrain dies 0.1 s after the flank hit, then the driver is thrown out of the struck side", () => {
    expect(firstMismatch(killedAfter(0.1).map((e) => e.exit), ["doorL"])).toBeUndefined();
  });

  it("when the drivetrain dies 1.5 s or 20 s after the last contact (a damaged car over a crest, a last wheel gone), then nobody is thrown out", () => {
    expect(killedAfter(1.5)).toHaveLength(0);
    expect(killedAfter(20)).toHaveLength(0);
  });

  it("when a graze touches the car hit 5 s before, on the very step its drivetrain dies (a block already at the edge, a crest under it), then nobody is thrown out", () => {
    expect(killedAfter(5, true)).toHaveLength(0);
  });
});

describe("given the ejection range: a straight head-on into the barrier, at yaw 0° and ±3° with offsets up to ±1.2 m", () => {
  for (const cls of VEHICLE_CLASS_IDS) {
    it(`when a ${cls} drives at ${RANGE.kph} km/h straight into the barrier, then the driver is thrown out of the windshield along the run-up and never out of a side pane`, () => {
      const lateral = Math.tan((8 * Math.PI) / 180);
      for (const yawDeg of [0, 3, -3]) {
        for (const z of [0, 0.6, -0.6, 1.2, -1.2]) {
          const car = makeCar("shape", 0.32, 0.45);
          assignClass(car, cls);
          armKill(car.deform, killClass(car), DEFAULT_REALISM, "default");
          const yaw = Math.PI / 2 + (yawDeg * Math.PI) / 180;
          const v = RANGE.kph / 3.6;
          launch(car, -RANGE.run, z, yaw, Math.sin(yaw) * v, Math.cos(yaw) * v);
          const w = makeWorld([car], true, false, FREEWHEEL);
          for (let f = 0; f < 150; f++) tickWorld(w);
          const where = `yaw ${yawDeg}° z ${z}`;
          if (yawDeg === 0 && z === 0) expect(w.ejections.length, `${where}: the square hit throws the driver`).toBe(1);
          for (const e of w.ejections) {
            expect(e.exit, `${where}: thrown out of the ${e.exit}`).toBe("windshield");
            const out = ejectionVelocity(e, new THREE.Vector3());
            expect(Math.abs(out.z), `${where}: launched ${out.toArray().map((x) => x.toFixed(1))} m/s, ${((Math.atan2(Math.abs(out.z), out.x) * 180) / Math.PI).toFixed(1)}° off the run-up`).toBeLessThanOrEqual(out.x * lateral);
          }
          car.dispose();
        }
      }
    });
  }
});

describe("given a car placed so close to the barrier that its kill lands before the watch has one velocity sample", () => {
  it("when a fleet sedan, 0.3 m into the barrier's run (killed within its first step), is driven into it at 30 m/s, then its driver is thrown out of the windshield as when it started 0.5 s back", () => {
    const run = (nose: number): Ejection[] => {
      const car = fleetCar();
      launch(car, -BARRIER_HALF.x - 2.4 - nose, 0, Math.PI / 2, 30, 0);
      const w = makeWorld([car], true, false, FREEWHEEL);
      for (let f = 0; f < 150; f++) tickWorld(w);
      car.dispose();
      return w.ejections;
    };
    expect(run(15).length, "from 0.5 s back the hit throws him").toBe(1);
    expect(run(-0.3).length, "the same hit straight after placement throws him too").toBe(1);
  });
});

describe("given a fleet sedan hit on its nose (its engine block packed past the realistic kill or stopping short of it), or slammed into a door, at a closing speed near the throw's threshold", () => {
  /** How far the block is packed past `killTravel` (m): the step's own overshoot, so the edge is crossed on the next step whatever the rounding. */
  const PACKED_OVER = 0.01;
  /** How far either side of the threshold a staged hit closes (m/s): wider than the barrier hit's own loss of speed before contact. */
  const NEAR = 0.6;
  /** How much of the kill travel the block of a running car's nose hit reaches when it stops short: the replay's police car at 160 km/h, 0.166 of 0.195 m. */
  const SHORT_OF_KILL = 0.85;
  /** The parked fleet sedan the nose hit is on (m): within the watch's reach of the impact point, clear of the car's path. A running car's share of the closing is then half. */
  const STRUCK_X = 2.6;
  const STRUCK_Z = 3;
  const SHARE = 0.5;

  /** A fleet sedan driving at `mps` into a square hit on its nose from a parked fleet sedan; `packed`: its block past the realistic kill (the context's), else short of it; `dies`: its drivetrain stops with it, else it runs on; `minigame`: a mini game's watch; `ctx`: the watch's kill context. */
  function noseHit(mps: number, packed: boolean, dies = false, minigame = false, ctx: "derby" | "default" = "default"): Ejection[] {
    const car = fleetCar();
    const struck = fleetCar();
    launch(car, 0, 0, 0, 0, mps);
    launch(struck, STRUCK_X, STRUCK_Z, 0, 0, 0);
    const w = makeWorld([car, struck], false, false, FREEWHEEL);
    w.world.ejection!.minigame = minigame;
    w.world.ejection!.ctx = ctx;
    for (let f = 0; f < 2; f++) tickWorld(w);
    car.applyImpact(new THREE.Vector3(0, 0.5, 2), new THREE.Vector3(0, 0, -1), 7, 3.5);
    const kill = killTravel(killClass(car), 1, ctx);
    car.deform.engineTravel = packed ? kill + PACKED_OVER : SHORT_OF_KILL * kill;
    if (dies) car.deform.drivetrainAlive = false;
    for (let f = 0; f < 3; f++) tickWorld(w);
    car.dispose();
    struck.dispose();
    return w.ejections;
  }

  /** A fleet sedan sliding sideways into the barrier at `mps`: the throws. */
  function slammed(mps: number, ctx: "derby" | "default" = "default"): Ejection[] {
    const car = fleetCar();
    launch(car, -BARRIER_HALF.x - 2.4, 0, 0, mps, 0);
    const w = makeWorld([car], true, false, FREEWHEEL);
    w.world.ejection!.ctx = ctx;
    for (let f = 0; f < 150; f++) tickWorld(w);
    car.dispose();
    return w.ejections;
  }

  it("when its block is packed past the kill at 12 m/s and its drivetrain dies with it, then the driver is thrown out of the windshield", () => {
    expect(firstMismatch(noseHit(12, true, true).map((e) => e.exit), ["windshield"])).toBeUndefined();
  });

  it("when its block is packed past the kill just under, and then just over, the alive threshold, then the driver stays in and is thrown", () => {
    const threshold = ejectThreshold(fleetCar(), false, false);
    expect(noseHit(threshold - NEAR, true), "just under").toHaveLength(0);
    expect(firstMismatch(noseHit(threshold + NEAR, true).map((e) => e.exit), ["windshield"]), "just over").toBeUndefined();
  });

  it("when its block stops short of the kill and its drivetrain runs, its share of the closing just under and then just over the alive threshold, then the driver stays in and is thrown out of the windshield", () => {
    const threshold = ejectThreshold(fleetCar(), false, false);
    expect(noseHit((threshold - NEAR) / SHARE, false), "just under").toHaveLength(0);
    expect(firstMismatch(noseHit((threshold + NEAR) / SHARE, false).map((e) => e.exit), ["windshield"]), "just over").toBeUndefined();
  });

  it("when its block is packed past the kill between the mini games' bar and the alive threshold, then a mini game throws the driver and anywhere else he stays in", () => {
    const between = (ejectThreshold(fleetCar(), true, false) + ejectThreshold(fleetCar(), false, false)) / 2;
    expect(firstMismatch(noseHit(between, true, false, true).map((e) => e.exit), ["windshield"]), "mini game").toBeUndefined();
    expect(noseHit(between, true), "anywhere else").toHaveLength(0);
  });

  it("when its block is packed past the kill with the drivetrain running at 1.0375 x its killSpeed, between the tuned 1.025 bar and the old 1.05 one, then the driver is thrown out of the windshield", () => {
    expect(firstMismatch(noseHit(1.0375 * killSpeed(fleetCar()), true).map((e) => e.exit), ["windshield"])).toBeUndefined();
  });

  it("when it slides sideways into the barrier just under, and then just over, the alive threshold, then the driver stays in and goes out of the door", () => {
    const threshold = ejectThreshold(fleetCar(), false, false);
    expect(slammed(threshold - NEAR), "just under").toHaveLength(0);
    expect(firstMismatch(slammed(threshold + NEAR).map((e) => e.exit), ["doorR"]), "just over").toBeUndefined();
  });

  it("when it slides its door into the barrier at 7.5 m/s, as the replay's police car slid into a car, then the driver stays in", () => {
    expect(slammed(7.5)).toHaveLength(0);
  });

  /** A derby ram between the alive threshold and the derby's harnessed one (m/s): it throws a running car's driver in a race, not in a derby. */
  const derbyRam = (): number => (ejectThreshold(fleetCar(), false, false) + ejectThreshold(fleetCar(), false, true)) / 2;

  it("when it slides its door into the barrier at a derby ram's speed with the engine running on, then a race throws the driver out of the door and a derby's harness keeps him in", () => {
    expect(firstMismatch(slammed(derbyRam()).map((e) => e.exit), ["doorR"]), "race").toBeUndefined();
    expect(slammed(derbyRam(), "derby"), "derby").toHaveLength(0);
  });

  it("when it slides its door into the barrier in a derby just under, and then just over, the harnessed threshold, then the driver stays in and a severe slam still throws him out of the door", () => {
    const harnessed = ejectThreshold(fleetCar(), false, true);
    expect(slammed(harnessed - NEAR, "derby"), "just under").toHaveLength(0);
    expect(firstMismatch(slammed(harnessed + NEAR, "derby").map((e) => e.exit), ["doorR"]), "just over").toBeUndefined();
  });

  it("when a derby nose hit takes its share of a derby ram, then a hit that kills the engine (block packed past the derby's kill, drivetrain dead) throws the driver and one that leaves it running keeps him in, where a race throws him", () => {
    const mps = derbyRam() / SHARE;
    expect(firstMismatch(noseHit(mps, true, true, false, "derby").map((e) => e.exit), ["windshield"]), "engine killed").toBeUndefined();
    expect(noseHit(mps, false, false, false, "derby"), "engine runs on").toHaveLength(0);
    expect(firstMismatch(noseHit(mps, false).map((e) => e.exit), ["windshield"]), "race").toBeUndefined();
  });
});

describe("given the hits of the owner's Survival replay staged on a flat field: a police car nose-first at 46 m/s into a parked muscle car's door, and a 30 km/h tap", () => {
  it("when the police car T-bones the parked muscle car, then both drivers are thrown", () => {
    const [striker, struck] = collide("t-bone", "police", "muscle", 46);
    expect(striker.thrown, `striker (block ${striker.travel.toFixed(3)} m)`).toBe(true);
    expect(struck.thrown, `struck (block ${struck.travel.toFixed(3)} m)`).toBe(true);
  });

  it("when a sedan taps a parked sedan's tail at 30 km/h, then nobody is thrown", () => {
    const [striker, struck] = collide("rear-end", "sedan", "sedan", 30 / 3.6);
    expect(firstMismatch([striker.thrown, struck.thrown], [false, false])).toBeUndefined();
  });
});
