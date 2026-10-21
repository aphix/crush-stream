import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { assignClass, armKill, killClass, CLASSES, HANDLING, VEHICLE_CLASS_IDS, type VehicleClassId } from "./vehicle-classes.ts";
import { droop, sagOffsets, Suspension } from "./car-suspension.ts";
import { carFrame } from "./car-rig.ts";
import { CAR_STYLES } from "./car-variants.ts";
import { newWorld, stepWorld, type World } from "../engine/world-step.ts";
import { INITIAL_HUD } from "../hud/hud-store.ts";
import { assertSameNumbers, DT, paint } from "./test-support.ts";
import { HIT_SIZE } from "../world/surfaces.ts";
import { REST_SPEED } from "./car-air-body.ts";
import { applyDrive, idleDrive } from "./car-drive.ts";
import { PLATFORM_DIMS } from "./car-styles/platform.ts";

const IDLE = idleDrive();
const SEDAN = carFrame(CAR_STYLES.sedan);

/**
 * A wreck missing wheels rests on the body corners where they were (and on the wheels it still has), as the drawn
 * body mesh: not into the ground, not hovering over an empty corner, still after a few seconds.
 */

const HUBS = ["hubFL", "hubFR", "hubRL", "hubRR"] as const;
const NAMES = ["FL", "FR", "RL", "RR"];
/** Wheel sets lost: one corner, a front, rear and side pair, a diagonal pair. */
const SETS: readonly (readonly number[])[] = [[0], [3], [0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
const _v = new THREE.Vector3();

type Rest = { low: number; corners: number[]; fresh: number[]; all: number[]; speed: number; drift: number };

/** A parked `cls` car at (`x`, `z`), hit once on its nose so it is a wreck. */
function struck(cls: VehicleClassId, x = 0, nose = 2.05, z = 0): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, CLASSES[cls].style);
  car.deform.squash = INITIAL_HUD.squash;
  car.deform.buckle = INITIAL_HUD.buckle;
  car.deform.setMode(INITIAL_HUD.deformMode);
  assignClass(car, cls);
  armKill(car.deform, killClass(car), HANDLING.realism, "default");
  car.spawnFacing(x, z, 0, 0);
  car.group.updateMatrixWorld(true);
  car.updateSkin();
  if (nose > 0) car.applyImpact(car.group.position.clone().addScaledVector(car.forward, nose), car.forward.clone().negate(), 0.5, 0.5);
  return car;
}

/** One step of `w`: the idle pedals a wreck nobody drives rolls on (`CrashEngine.wreckCoast`), then the world. */
function tick(w: World, cars: readonly DeformableCar[]): void {
  for (const car of cars) applyDrive(car, IDLE, DT);
  stepWorld(w, DT);
  for (const car of cars) {
    car.stepBreakage(DT);
    car.updateSkin();
  }
}

/** A parked car hit once (so it is a wreck), its wheels `lost` popped, run `secs` s; then the body mesh read. */
function rest(cls: VehicleClassId, lost: readonly number[], secs = 5): Rest {
  const car = struck(cls, 0, 0);
  const bodyY = (): number[] => {
    car.group.updateMatrixWorld(true);
    car.body.updateWorldMatrix(true, false);
    const pos = car.body.geometry.getAttribute("position");
    const hubs = HUBS.map((n) => car.deform.masses.find((m) => m.name === n)!.world);
    const low = [9, 9, 9, 9, 9];
    for (let k = 0; k < pos.count; k++) {
      _v.fromBufferAttribute(pos, k).applyMatrix4(car.body.matrixWorld);
      low[4] = Math.min(low[4]!, _v.y);
      for (let i = 0; i < 4; i++) if (Math.hypot(_v.x - hubs[i]!.x, _v.z - hubs[i]!.z) < 0.6) low[i] = Math.min(low[i]!, _v.y);
    }
    return low;
  };
  const fresh = bodyY();
  car.applyImpact(car.group.position.clone().addScaledVector(car.forward, 2.05), car.forward.clone().negate(), 0.5, 0.5);
  for (const i of lost) car.deform.popHub(car.deform.masses.find((m) => m.name === HUBS[i])!);
  const w = newWorld([car]);
  let before: number[] = [];
  for (let f = 0; f < secs * 60; f++) {
    if (f === (secs - 1) * 60) before = bodyY();
    stepWorld(w, DT);
    car.stepBreakage(DT);
    car.updateSkin();
  }
  const low = bodyY();
  return {
    low: low[4]!,
    corners: lost.map((i) => low[i]!),
    fresh,
    all: low,
    speed: car.velocity.length(),
    drift: Math.max(...low.map((y, i) => Math.abs(y - before[i]!))),
  };
}

describe("given a parked car of each vehicle class, hit once so it is a wreck, with some of its wheels popped off", () => {
  for (const cls of VEHICLE_CLASS_IDS) {
    it(`when a ${cls} loses one corner, a front, rear or side pair, or a diagonal pair of wheels and settles for 5 s, then it is still, its body lies on the ground without sinking into it or hovering over it, and no empty corner hovers`, () => {
      for (const lost of SETS) {
        const r = rest(cls, lost);
        // A lifted body is held up on its standing tyres' arches before its underside reaches the ground, most of all on
        // the two diagonal tyres of a monster truck (a 0.45 m spring stroke over the ground).
        const diagonal = lost.length === 2 && lost[0]! + lost[1]! === 3;
        // How much higher this body rides than the platform's: the class's lift plus its style's own ride height over the platform's.
        const rise = CLASSES[cls].lift + (CAR_STYLES[CLASSES[cls].style].dims.rideHeight - PLATFORM_DIMS.rideHeight);
        const touch = diagonal && CLASSES[cls].lift > 0.3 ? 0.35 : 0.03 + 0.12 * rise;
        const tag = `${cls} minus ${lost.map((i) => NAMES[i]).join("+")}`;
        assert.ok(r.speed < 0.05, `${tag}: still moving at ${r.speed.toFixed(3)} m/s`);
        // The drawn body leans on its resting rigid body's slice-to-slice jitter, with a gain of cg / (track · ω²) (`car-load.ts`): up to
        // 1 cm on a lifted body (the monster), a fraction of a millimetre on the others.
        const still = CLASSES[cls].lift > 0.3 ? 0.01 : 0.003;
        assert.ok(r.drift < still, `${tag}: body still settling after 4 s, moved ${(r.drift * 1000).toFixed(1)} mm in the last second`);
        assert.ok(r.low > -0.02, `${tag}: body ${(-r.low * 100).toFixed(1)} cm into the ground`);
        assert.ok(r.low < touch, `${tag}: body hovers ${(r.low * 100).toFixed(1)} cm over the ground`);
        // A diagonal pair lost leaves the body on the other diagonal's tyres: it tips about the line through them until one empty corner is
        // down. The two empty corners, mirrored across that line, go down and up by the same amount, and the line stands no higher than the
        // fresh body did, so the risen one is at most twice its fresh height less the low one's: on a lifted body (the monster's 0.48 m) that
        // is over the flat bar.
        const hover = Math.max(...r.corners);
        const low = Math.min(...r.corners);
        const tipped = 2 * Math.max(...lost.map((i) => r.fresh[i]!)) - low + 0.01;
        const bound = diagonal && CLASSES[cls].lift > 0.3 ? tipped : 0.1 + 0.2 * rise + (diagonal ? 0.2 : 0);
        const down = 0.03 + 0.12 * rise;
        if (diagonal) assert.ok(low < down, `${tag}: no empty corner down, the lower at ${(low * 100).toFixed(1)} cm`);
        assert.ok(hover < bound, `${tag}: an empty corner hovers ${(hover * 100).toFixed(1)} cm (bound ${(bound * 100).toFixed(1)} cm)`);
      }
    });
  }
});

describe("given a sedan with its front-left and rear-right wheels popped off", () => {
  it("when 3 s pass after the wheels go, then the body is down on its corners and still (under 1 mm of movement in the third second), having eased down rather than dropped at once", () => {
    const r = rest("sedan", [0, 3], 3);
    assert.ok(r.drift < 0.001, `still moving ${(r.drift * 1000).toFixed(2)} mm in the third second`);
    const early = rest("sedan", [0, 3], 0.1);
    assert.ok(early.low > r.low + 0.01, `after 0.1 s the body is already ${(early.low * 100).toFixed(1)} cm over the ground (at rest ${(r.low * 100).toFixed(1)} cm)`);
  });
});

describe("given a sedan with all four wheels on", () => {
  it("when it settles for 5 s after one hit, then each corner's lowest point stays within 4 mm of the same corner on the fresh car, with no sag where nothing is missing", () => {
    const r = rest("sedan", []);
    for (let i = 0; i < 4; i++) assert.ok(Math.abs(r.all[i]! - r.fresh[i]!) < 0.004, `${NAMES[i]} corner ${(r.all[i]! * 100).toFixed(1)} cm, fresh ${(r.fresh[i]! * 100).toFixed(1)} cm`);
  });
});

describe("given all four wheels on, for the suspension's sag offsets (how far each body corner drops or lifts for the wheels that are missing)", () => {
  it("when the sag offsets are computed, then every corner's offset is zero, so nothing sags where nothing is missing", () => {
    const o = new Float64Array(4).fill(7);
    sagOffsets(SEDAN, 0, 0.065, 0, o);
    assert.deepEqual([...o], [0, 0, 0, 0]);
  });
});

describe("given a missing front-left wheel at each class lift (0, 0.08 and 0.48 m)", () => {
  it("when the sag offsets are computed, then the front-left corner of the body drops by over 3 cm and the diagonal corner sits above it", () => {
    for (const lift of [0, 0.08, 0.48]) {
      const o = new Float64Array(4);
      sagOffsets(SEDAN, lift, 0.065 + lift, 1, o);
      const drop = (0.75 * o[0]! + 0.25 * o[1]! + 0.25 * o[2]! - 0.25 * o[3]!);
      assert.ok(drop < -0.03, `lift ${lift}: front-left corner ${drop.toFixed(3)} m`);
      assert.ok(o[3]! > o[0]!, `lift ${lift}: diagonal corner ${o[3]!.toFixed(3)} not above ${o[0]!.toFixed(3)}`);
    }
  });
});

describe("given a wreck's suspension that loses its front-left wheel and then its front-right wheel as well", () => {
  it("when it settles for 600 steps after each loss, then its corner offsets match the sag of the new set of missing wheels (within 1e-4 m), not the first set's", () => {
    const s = new Suspension(SEDAN);
    const g = new THREE.Group();
    g.updateMatrixWorld(true);
    const hit = new Float64Array(4 * HIT_SIZE);
    for (const gone of [1, 3]) {
      for (let i = 0; i < 600; i++) s.step(g, [], "sedan", 0, false, false, gone, 0, hit, DT);
      const want = new Float64Array(4);
      sagOffsets(SEDAN, 0, droop("sedan"), gone, want);
      assertSameNumbers(s.offset, want, `wheels gone ${gone}`, 1e-4);
    }
  });
});

/** Ticks `w` until `until()` holds: the 1-based frame it first did, or -1 if it never did within `limit` frames. */
function frames(w: World, cars: readonly DeformableCar[], limit: number, until: () => boolean): number {
  for (let f = 1; f <= limit; f++) {
    tick(w, cars);
    if (until()) return f;
  }
  return -1;
}

describe("given a sedan hit once so it is a wreck, on level ground", () => {
  it("when it comes to rest, then it is asleep within 2 s; a 2 m/s push wakes it the next step and it sleeps again within 2 s of stopping", () => {
    const car = struck("sedan");
    const w = newWorld([car]);
    const rested = (): boolean => car.velocity.length() < REST_SPEED && car.angular.length() < REST_SPEED;
    const still = frames(w, [car], 10 * 60, () => rested() && car.contacts >= 3 && !car.deform.crushing);
    assert.ok(still > 0, "the wreck never came to rest");
    const slept = frames(w, [car], 2 * 60, () => car.asleep);
    assert.ok(slept > 0, `awake 2 s after it came to rest (frame ${still}, speed ${car.velocity.length().toFixed(3)} m/s)`);
    car.velocity.x = 2;
    tick(w, [car]);
    assert.ok(!car.asleep, "a 2 m/s velocity write did not wake it");
    assert.ok(car.group.position.x > 0, "it did not move on the push");
    const stopped = frames(w, [car], 10 * 60, () => rested());
    assert.ok(stopped > 0, "the pushed wreck never came to rest");
    assert.ok(frames(w, [car], 2 * 60, () => car.asleep) > 0, "awake 2 s after the push stopped");
  });

  it("when two wrecks rest 3 m apart, then both sleep and both stay asleep for 2 s", () => {
    const cars = [struck("sedan", 0), struck("sedan", 3)];
    const w = newWorld(cars);
    assert.ok(frames(w, cars, 10 * 60, () => cars[0]!.asleep && cars[1]!.asleep) > 0, "the pair never both slept");
    for (let f = 0; f < 2 * 60; f++) {
      tick(w, cars);
      assert.ok(cars[0]!.asleep && cars[1]!.asleep, `a wreck woke ${f} frames after both slept`);
    }
  });

  it("when three wrecks lie side by side (touching, then 0.5 m apart) and are shoved 0.4 s apart, then all sleep within 3 s of the last one's rest and stay asleep for 2 s", () => {
    const cars = [struck("sedan", 0, 2.05), struck("sedan", 2.0, 1.9), struck("sedan", 4.5, 1.7)];
    const w = newWorld(cars);
    for (let f = 0; f < 3 * 24; f++) {
      if (f % 24 === 0) cars[f / 24]!.velocity.z = 3;
      tick(w, cars);
    }
    const done = (): boolean => cars.every((c) => c.asleep);
    const slept = frames(w, cars, 3 * 60, done);
    assert.ok(slept > 0, `asleep ${cars.map((c) => c.asleep).join("/")} 3 s after the last shove (restS ${cars.map((c) => c.restS.toFixed(2)).join("/")})`);
    for (let f = 0; f < 2 * 60; f++) {
      tick(w, cars);
      assert.ok(done(), `a wreck woke ${f} frames after all slept`);
    }
  });

  it("when four wrecks rest in a row and the first is kept moving, then the awake wreck touching it does not stir the two at the far end: both sleep and stay asleep for 2 s", () => {
    // Slots 0..3 stand at x = 0 (rocking), 4.0, 5.78 and 1.78 (touching the rocker, so woken every slice, yet at rest): the far wrecks step before it,
    // so they read it right after a wake, with restS 0. Only a car that moves may stir a sleeper.
    const cars = [struck("sedan", 0, 2.05), struck("sedan", 4.0, 1.7), struck("sedan", 5.78, 1.9), struck("sedan", 1.78, 1.9)];
    const w = newWorld(cars);
    let n = 0;
    const rock = (): void => {
      cars[0]!.velocity.z = (Math.floor(n++ / 30) % 2 === 0 ? 1 : -1) * 0.6;
      tick(w, cars);
    };
    for (let f = 0; f < 10 * 60; f++) rock();
    const far = (): boolean => cars[1]!.asleep && cars[2]!.asleep;
    assert.ok(far(), `far wrecks asleep ${cars.map((c) => c.asleep).join("/")} 10 s on (restS ${cars.map((c) => c.restS.toFixed(2)).join("/")})`);
    for (let f = 0; f < 2 * 60; f++) {
      rock();
      assert.ok(far(), `a far wreck woke ${f} frames after both slept (asleep ${cars.map((c) => c.asleep).join("/")})`);
    }
  });

  it("when a wreck slides into another at 12 m/s and the two come to rest crushed together (their pair contact answers every slice), then both sleep within 10 s and stay asleep for 2 s", () => {
    // A pair contact between two still wrecks wakes neither (`wakePair`): waking both on every contact kept this pair awake (restS 0/0).
    const cars = [struck("sedan", 0), struck("sedan", 0, 2.05, 6)];
    const w = newWorld(cars);
    cars[1]!.velocity.z = -12;
    const both = (): boolean => cars[0]!.asleep && cars[1]!.asleep;
    assert.ok(frames(w, cars, 10 * 60, both) > 0, `asleep ${cars.map((c) => c.asleep).join("/")} after 10 s (restS ${cars.map((c) => c.restS.toFixed(2)).join("/")})`);
    for (let f = 0; f < 2 * 60; f++) {
      tick(w, cars);
      assert.ok(both(), `a wreck woke ${f} frames after both slept`);
    }
  });

  it("when a wreck slides into a sleeping one, then the sleeper wakes and is shoved along", () => {
    const cars = [struck("sedan", 0), struck("sedan", 0, 2.05, 6)];
    const w = newWorld(cars);
    assert.ok(frames(w, cars, 10 * 60, () => cars[0]!.asleep && cars[1]!.asleep) > 0, "the pair never both slept");
    const z0 = cars[0]!.group.position.z;
    cars[1]!.velocity.z = -10;
    assert.ok(frames(w, cars, 3 * 60, () => !cars[0]!.asleep) > 0, "the sleeper stayed asleep under the slider");
    for (let f = 0; f < 2 * 60; f++) tick(w, cars);
    assert.ok(cars[0]!.group.position.z < z0 - 0.05, `the sleeper was not shoved: moved ${(cars[0]!.group.position.z - z0).toFixed(3)} m`);
  });

  it("when a sleeping wreck lies beside the roof of a car the list then drops (survival takes a cop out), then the step does not throw and the sleeper stays asleep for 2 s", () => {
    // Slot 2's roof is patch 2: a list cut to two cars synced nothing past slot 1, so that roof kept its last box, and the sleeper's `stirNear` indexed `cars[2]`.
    const cars = [struck("sedan", 0), struck("sedan", 20), struck("sedan", 3)];
    const w = newWorld(cars);
    assert.ok(frames(w, cars, 10 * 60, () => cars.every((c) => c.asleep)) > 0, `the three never all slept (${cars.map((c) => c.asleep).join("/")})`);
    const kept = cars.slice(0, 2);
    w.cars = kept;
    for (let f = 0; f < 2 * 60; f++) {
      tick(w, kept);
      assert.ok(kept[0]!.asleep, `the sleeper woke ${f} frames after the car beside it left`);
    }
  });
});
