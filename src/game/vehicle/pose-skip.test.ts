import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { EPICENTER,  epicenterValues, loadEpicenter } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import { FREEWHEEL, launch, makeCar, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { layOnGround } from "./car-air-points.ts";
import type { DriveInput } from "./car-drive.ts";
import { DeformableCar } from "./car.ts";
import { carInState } from "./drawn-body.test-util.ts";
import { FACE_NOSE } from "../deform/load-crush.ts";
import { BUMPER_F } from "./constants.ts";
import { assertSameNumbers } from "./test-support.ts";
import { Ground, setGround } from "../world/ground.ts";

/**
 * `presentSkip` re-poses a crashed car's parts only when something the pose reads changed: the poses it leaves must be those of re-posing every frame
 * (it is drawing only), while a car sitting still no longer pays for the doors' ground probes and the bumpers' search each frame.
 */

const KPH = 1 / 3.6;
const FRAMES = 360;
/** A resting wreck's masses carry 1e-13 of rounding noise (`POSE_EPSILON`): the poses agree to within a nanometre, no more. */
const POSE_TOLERANCE = 1e-8;
const GAS: DriveInput = { throttle: 1, steer: 0, brake: 0, ebrake: false, boost: false };
const saved = epicenterValues();
afterEach(() => loadEpicenter(saved));
afterEach(() => setGround(null));

type Rec = { poses: number[]; calls: number };

/** Every attached part's position, turn and scale on every 3rd frame of `FRAMES`, and how many times `posePart` ran. */
function film(scene: "settled head-on" | "driven wreck", skip: boolean): Rec {
  loadEpicenter(EPICENTER_AT_LOAD);
  EPICENTER.presentSkip = skip ? 1 : 0;
  const proto = DeformableCar.prototype as unknown as { posePart: (p: unknown) => void };
  const posePart = vi.spyOn(proto, "posePart");
  try {
    const a = makeCar("shape");
    const b = scene === "settled head-on" ? makeCar("shape") : null;
    if (b) {
      launch(a, -5, 0, Math.PI / 2, 20, 0);
      launch(b, 5, 0, -Math.PI / 2, -20, 0);
      layOnGround(b);
    } else launch(a, 6.2, 0, -Math.PI / 2, -50 * KPH, 0);
    layOnGround(a);
    const cars = b ? [a, b] : [a];
    const w = makeWorld(cars, !b, false, FREEWHEEL);
    for (const car of cars) w.pedals.set(car, scene === "driven wreck" ? GAS : FREEWHEEL);
    const poses: number[] = [];
    for (let f = 0; f < FRAMES; f++) {
      tickWorld(w);
      if (f % 3 !== 0) continue;
      for (const car of cars) {
        for (const p of (car as unknown as { parts: { detached: boolean; object: THREE.Object3D }[] }).parts) {
          if (p.detached) continue;
          p.object.position.toArray(poses, poses.length);
          p.object.quaternion.toArray(poses, poses.length);
          p.object.scale.toArray(poses, poses.length);
        }
      }
    }
    return { poses, calls: posePart.mock.calls.length };
  } finally {
    posePart.mockRestore();
  }
}

describe("given a crash filmed with and without skipping the re-posing of parts that have not changed", () => {
  for (const scene of ["settled head-on", "driven wreck"] as const) {
    it(`when the ${scene} is run both ways, then every part's pose in every filmed frame is the same to a nanometre`, () => {
      const every = film(scene, false);
      const skipping = film(scene, true);
      expect(every.poses.length, "no parts filmed").toBeGreaterThan(0);
      assertSameNumbers(skipping.poses, every.poses, "part poses", POSE_TOLERANCE);
      if (scene === "settled head-on") expect(skipping.calls, `${skipping.calls} part poses against ${every.calls}: it skipped too few frames to be a saving`).toBeLessThan(0.5 * every.calls);
    });
  }
});

const LOAD_M = 0.012; // under SPRING_YIELD: no wreck
function loadedCar(): DeformableCar {
  const car = carInState("untouched", "police", "sedan"); // upright at origin
  car.deform.crush[FACE_NOSE] = LOAD_M;
  car.deform.bakeLoadCrush();
  car.deform.skinLoaded(); // as car-surfaces.ts does in the slice
  expect(car.crashed, "control: no wreck").toBe(false);
  expect(car.panelsFollow, "control: loaded branch").toBe(true);
  car.updateSkin(); // the frame the skin lands: poseParts poses (no signature yet)
  return car;
}
function deepen(car: DeformableCar): void {
  car.deform.crush[FACE_NOSE] += 0.01;
  car.deform.bakeLoadCrush();
  car.deform.skinLoaded();
}

/** A flat road at height `y`, under everything. */
class RaisedRoad extends Ground {
  constructor(y: number) {
    super();
    this.addPlane(y, -1e4, 1e4, -1e4, 1e4, Infinity);
  }
}

/** Flat ground with a 0.5 m step only where x > 3 and z > 1.5: under a car's nose once it has driven 4+ m along x. */
class NoseStep extends Ground {
  constructor() {
    super();
    this.addPlane(0, -1e4, 1e4, -1e4, 1e4, Infinity);
    this.addPlane(0.5, 3, 1e4, 1.5, 1e4, Infinity);
  }
}

describe("given a cruiser a load crushed that leaves it no wreck", () => {
  it("when it drives on with no new crush, then no part is posed", () => {
    const car = loadedCar();
    const before = car.partWrites;
    for (let f = 0; f < 5; f++) {
      car.group.position.x += 1;
      car.group.rotation.y += 0.02;
      car.group.updateMatrixWorld(true);
      car.updateSkin();
    }
    expect(car.partWrites).toBe(before);
  });

  it("when the load deepens and it is re-skinned, then the front bumper is posed on its masses", () => {
    const car = loadedCar();
    const bumper = car["parts"].find((p) => p.name === BUMPER_F)!;
    deepen(car);
    const before = car.partWrites;
    car.updateSkin();
    expect(car.partWrites).toBeGreaterThan(before);
    const fl = car.deform.massLocal("bumperFL");
    const fr = car.deform.massLocal("bumperFR");
    expect(Math.abs(bumper.object.position.z - (fl.z + fr.z) / 2)).toBeLessThan(1e-9);
  });

  it("when the load deepens off-screen and its skin is flushed late, then its parts still stand on the masses", () => {
    const car = loadedCar();
    deepen(car);
    car.deform.skinDeferred = true; // engine.scheduleSkins: the level of detail defers the skin
    const before = car.partWrites;
    car.updateSkin(); // no skin written; the masses moved
    car.flushDeferredSkin(); // engine.flushVisibleSkins, after updateSkin
    car.updateSkin();
    expect(car.partWrites).toBeGreaterThan(before);
  });

  it("when a raised road lifted its bumper and it drives on to flat ground, then the bumper is not left lifted", () => {
    const car = loadedCar();
    const bumper = car["parts"].find((p) => p.name === BUMPER_F)!;
    const offMasses = (): number => {
      const fl = car.deform.massLocal("bumperFL");
      const fr = car.deform.massLocal("bumperFR");
      return Math.abs(bumper.object.position.y - (fl.y + fr.y) / 2);
    };
    expect(offMasses(), "control: on flat ground it stands on its masses").toBeLessThan(1e-9);
    setGround(new RaisedRoad(0.5));
    deepen(car); // the masses move, so the signature changes and the parts are posed over the raised road
    car.updateSkin();
    expect(offMasses(), "control: the raised road lifted the bumper").toBeGreaterThan(0.01);
    setGround(null);
    for (let f = 0; f < 3; f++) {
      car.group.position.x += 1;
      car.group.updateMatrixWorld(true);
      car.updateSkin();
    }
    expect(offMasses()).toBeLessThan(1e-9);
  });

  it("when a raised road lifted its bumper and the car rises clear of it, the ground under its corners unchanged, then the bumper is not left lifted", () => {
    const car = loadedCar();
    const bumper = car["parts"].find((p) => p.name === BUMPER_F)!;
    const offMasses = (): number => {
      const fl = car.deform.massLocal("bumperFL");
      const fr = car.deform.massLocal("bumperFR");
      return Math.abs(bumper.object.position.y - (fl.y + fr.y) / 2);
    };
    expect(offMasses(), "control: on flat ground it stands on its masses").toBeLessThan(1e-9);
    setGround(new RaisedRoad(0.5));
    deepen(car); // the masses move, so the signature changes and the parts are posed over the raised road
    car.updateSkin();
    expect(offMasses(), "control: the raised road lifted the bumper").toBeGreaterThan(0.01);
    // The car rises 0.5 m with its masses unmoved: the corner ground still reads 0.5, so only the standing lift can re-pose it.
    car.group.position.y += 0.5;
    car.group.updateMatrixWorld(true);
    car.updateSkin();
    const off = offMasses();
    setGround(null);
    expect(off).toBeLessThan(1e-9);
  });

  it("when the car is reset and the same load lands again, then the front bumper is posed on its masses again", () => {
    const car = loadedCar();
    const bumper = car["parts"].find((p) => p.name === BUMPER_F)!;
    car.resetVisual(); // the replay loop's respawn: ClipSim.spawn → spawnFacing → resetVisual
    car.updateSkin(); // a frame between the rewind and the re-dent
    car.deform.crush[FACE_NOSE] = LOAD_M;
    car.deform.bakeLoadCrush();
    car.deform.skinLoaded();
    const fl = car.deform.massLocal("bumperFL");
    const fr = car.deform.massLocal("bumperFR");
    expect(Math.abs(bumper.object.position.z - (fl.z + fr.z) / 2), "control: the reset left the bumper at rest").toBeGreaterThan(1e-6);
    const before = car.partWrites;
    car.updateSkin();
    expect(car.partWrites).toBeGreaterThan(before);
    expect(Math.abs(bumper.object.position.z - (fl.z + fr.z) / 2)).toBeLessThan(1e-9);
  });

  it("when a car posed clear on flat ground drives on to a step under its nose with no new crush, then its bumper is re-posed and lifted", () => {
    const car = loadedCar();
    const bumper = car["parts"].find((p) => p.name === BUMPER_F)!;
    const offMasses = (): number => {
      const fl = car.deform.massLocal("bumperFL");
      const fr = car.deform.massLocal("bumperFR");
      return Math.abs(bumper.object.position.y - (fl.y + fr.y) / 2);
    };
    setGround(new NoseStep()); // the car stands at x = 0, clear of it
    expect(offMasses(), "control: on flat ground the bumper stands on its masses").toBeLessThan(1e-9);
    const before = car.partWrites;
    car.group.position.x += 1; // still clear of the step (corners at x <= 1.88, the step from x = 3)
    car.group.updateMatrixWorld(true);
    car.updateSkin();
    expect(car.partWrites, "control: a pure move over clear ground poses nothing").toBe(before);
    expect(offMasses(), "control: and the bumper still stands on its masses").toBeLessThan(1e-9);
    car.group.position.x += 5; // the nose is now over the step (x = 6, corners at x >= 5.12)
    car.group.updateMatrixWorld(true);
    car.updateSkin();
    expect(car.partWrites, "the ground under its corners moved: the parts are posed").toBeGreaterThan(before);
    expect(offMasses(), "and the step lifted the bumper").toBeGreaterThan(0.01);
  });
});
