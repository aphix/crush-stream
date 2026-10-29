import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { FREEWHEEL, launch, makeWorld, PARKED, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { FLAT_GROUND, Ground, setGround } from "../world/ground.ts";
import { layOnGround, loadPoints } from "./car-air-points.ts";
import type { DeformableCar } from "./car.ts";
import { buildCar } from "./drawn-body.test-util.ts";
import { BELLY_ABSENT, POINT_X, POINT_Y, POINT_Z, REST_SPEED } from "./car-air-body.ts";
import { UPRIGHT_UP_Y } from "./car-suspension.ts";
import { PartSeat } from "./part-geometry.ts";
import { CLASSES, type VehicleClassId } from "./vehicle-classes.ts";

/**
 * A wreck rests on its own crushed underside. A head-on crush pushes a sill or a fender down in the car's frame, which moves a body
 * point into the ground with no speed of the rigid body's; the wreck then sat on its tyres with that point 4-19 cm in the road (the
 * owner's clips: wrecks 0.13-0.47 m sunk). Bar: no drawn point (tyres included) more than 3 cm in the ground under it. The cage the
 * rigid step rests on is the drawn skin to a few cm (`SKIN`), and 2.6 cm of the drawn rocker under the ground is what it measures
 * of that after the fix; before it, 4-7 cm.
 */
const SINK_M = 0.03;
const DEG = 180 / Math.PI;
const SETTLE_MAX_S = 12;
/** Brakes on from here: a wreck left in neutral slides off a slope for good. */
const PARK_AFTER_S = 2;

/** The plane `heightAt` = x·tan(pitch) (degrees): a car facing +x sees `pitch` as its slope. */
class Slope extends Ground {
  constructor(pitchDeg: number) {
    super();
    const tp = Math.tan(pitchDeg / DEG);
    const e = 1e4;
    this.addGrid({ nu: 2, nv: 2, step: 2 * e, stepV: 2 * e, u0: -e, v0: -e, heights: new Float32Array([-e * tp, e * tp, -e * tp, e * tp]), ox: 0, oy: 0, oz: 0, reach: Infinity });
  }
}

type Hit = { name: string; a: VehicleClassId; b: VehicleClassId; kphA: number; kphB: number; offset: number; yawB: number };

/** Head-on hits (the second car's heading yawed, its nose offset across) that left a wreck with its crushed underside in the ground. */
const HITS: Hit[] = [
  { name: "a muscle car at 104 km/h into a police car at 90 km/h", a: "muscle", b: "police", kphA: 103.6, kphB: 89.9, offset: 0.45, yawB: -0.19 },
  { name: "a police car at 150 km/h into a sedan at 46 km/h", a: "police", b: "sedan", kphA: 150.5, kphB: 45.7, offset: -0.26, yawB: 0.13 },
  { name: "a truck at 121 km/h into a monster at 142 km/h", a: "truck", b: "monster", kphA: 121.4, kphB: 141.8, offset: 0.35, yawB: 0.21 },
  { name: "a sedan at 125 km/h into a sedan at 125 km/h", a: "sedan", b: "sedan", kphA: 124.6, kphB: 124.6, offset: 0.36, yawB: -0.46 },
];

const _v = new THREE.Vector3();

/** The drawn body's lowest point over the ground under it (m; negative: in the ground), every visible mesh of the car, tyres included, and the mesh it is on. */
function lowestDrawn(car: DeformableCar, ground: Ground): { clearance: number; mesh: string } {
  car.flushDeferredSkin();
  car.updateSkin();
  car.group.updateMatrixWorld(true);
  // The truck's frame and axles are posed as PartBatch.sync poses them before it draws (`CarUnderbody.follow`): unposed they stood at the
  // constructor's pose (a monster's popped-wheel axle stubs read 21-26 cm in the ground).
  car.underbody?.follow();
  car.group.updateMatrixWorld(true);
  const inverse = car.group.matrixWorld.clone().invert();
  const lowest = { clearance: Infinity, mesh: "" };
  car.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh || o instanceof PartSeat)) return;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name === "deform-rig" || !p.visible) return;
    // A part seat shows its `drawn` part, not the platform shape the sim measures (`geometry`): the wipers' seat rides the windshield with
    // their drawn blades in its car space, so the platform blades about the seat stood at the car's origin, ground level under the cab,
    // and on a slope read 6.7 cm in it (CarTrucks9 5fc74f76, the truck>monster 10° row).
    const position = (o instanceof PartSeat ? o.drawn : o.geometry).getAttribute("position");
    if (!position) return;
    for (let k = 0; k < position.count; k++) {
      _v.fromBufferAttribute(position, k).applyMatrix4(o.matrixWorld);
      const clearance = _v.y - ground.heightAt(_v.x, _v.z, _v.y);
      if (clearance >= lowest.clearance) continue;
      lowest.clearance = clearance;
      lowest.mesh = `${o.name || o.geometry.type} of ${o.parent?.name || o.parent?.type} at ${_v.clone().applyMatrix4(inverse).toArray().map((n) => n.toFixed(2))}`;
    }
  });
  return lowest;
}

/** Stages `hit` (each car's speed times `scale`) on `ground` and runs it until both cars sleep (or `SETTLE_MAX_S`): the cars the hit left wrecks, at rest. Each class on its own body (`CLASSES[cls].style`). */
function wrecksAtRest(hit: Hit, ground: Ground, scale = 1): DeformableCar[] {
  setGround(ground);
  const cars = [buildCar(CLASSES[hit.a].style, hit.a), buildCar(CLASSES[hit.b].style, hit.b)] as const;
  const [a, b] = cars;
  launch(a, -5, 0, Math.PI / 2, (scale * hit.kphA) / 3.6, 0);
  launch(b, 5, hit.offset, -Math.PI / 2 + hit.yawB, ((-scale * hit.kphB) / 3.6) * Math.cos(hit.yawB), ((-scale * hit.kphB) / 3.6) * Math.sin(hit.yawB));
  for (const car of cars) {
    car.group.position.y = ground.heightAt(car.group.position.x, car.group.position.z, 1);
    layOnGround(car);
  }
  const world = makeWorld([a, b], false, false);
  for (const car of cars) world.pedals.set(car, FREEWHEEL);
  for (let f = 0; f < SETTLE_MAX_S * FRAME_HZ && !(a.asleep && b.asleep); f++) {
    if (f === PARK_AFTER_S * FRAME_HZ) for (const car of cars) world.pedals.set(car, PARKED);
    tickWorld(world, 1 / FRAME_HZ);
  }
  return cars.filter((car) => car.deform.massActive);
}

/** Directions (pitch, roll about the car's own axes, degrees) a wreck can lie with its underside down within: the steepest slope plus the tilt a wreck settles at. */
const LIE_RANGE_DEG = 30;
const LIE_STEP_DEG = 5;

/**
 * How far (m) the drawn body's skin reaches past the rigid step's own points (the cage's hull and sill samples, and the belly where it is
 * drawn), lowest along each direction within `LIE_RANGE_DEG` of straight down in the car's frame, and where the worst vertex stands there:
 * a wreck the step rests on those points, in any pose, has that much of its skin in the ground. A pose no settle can move.
 */
function skinReachPastCage(wreck: DeformableCar): { gap: number; at: string } {
  wreck.flushDeferredSkin();
  wreck.updateSkin();
  wreck.group.updateMatrixWorld(true);
  const bellyFrom = loadPoints(wreck);
  const points: number[] = [];
  for (let k = 0; k < bellyFrom + wreck.frame.belly.length; k++) if (k < bellyFrom || BELLY_ABSENT[k - bellyFrom] === 0) points.push(POINT_X[k]!, POINT_Y[k]!, POINT_Z[k]!);
  const toCar = wreck.group.matrixWorld.clone().invert().multiply(wreck.body.matrixWorld);
  const position = wreck.body.geometry.getAttribute("position");
  const skin = new Float64Array(position.count * 3);
  for (let k = 0; k < position.count; k++) skin.set(_v.fromBufferAttribute(position, k).applyMatrix4(toCar).toArray(), k * 3);
  const furthest = (cloud: ArrayLike<number>, d: THREE.Vector3): { reach: number; at: number } => {
    let best = { reach: -Infinity, at: -1 };
    for (let k = 0; k < cloud.length; k += 3) {
      const reach = cloud[k]! * d.x + cloud[k + 1]! * d.y + cloud[k + 2]! * d.z;
      if (reach > best.reach) best = { reach, at: k };
    }
    return best;
  };
  let worst = { gap: -Infinity, at: "" };
  for (let pitch = -LIE_RANGE_DEG; pitch <= LIE_RANGE_DEG; pitch += LIE_STEP_DEG) {
    for (let roll = -LIE_RANGE_DEG; roll <= LIE_RANGE_DEG; roll += LIE_STEP_DEG) {
      const down = new THREE.Vector3(0, -1, 0).applyEuler(new THREE.Euler(pitch / DEG, 0, roll / DEG));
      if (-down.y < Math.cos(LIE_RANGE_DEG / DEG)) continue;
      const drawn = furthest(skin, down);
      const gap = drawn.reach - furthest(points, down).reach;
      if (gap > worst.gap) worst = { gap, at: `car-frame ${[0, 1, 2].map((a) => skin[drawn.at + a]!.toFixed(2)).join(",")} lying pitch ${pitch}° roll ${roll}°` };
    }
  }
  return worst;
}

describe("given two cars crushed head-on, left to rest on the ground", () => {
  afterEach(() => setGround(null));

  const sites = [
    { site: "flat ground", pitch: 0 },
    { site: "a 10° slope", pitch: 10 },
  ] as const;
  for (const { site, pitch } of sites) {
    for (const hit of HITS) {
      it(`when ${hit.name} on ${site}, then no point of either wreck is drawn more than 3 cm in the ground under it`, () => {
        const ground = pitch === 0 ? FLAT_GROUND : new Slope(pitch);
        const wrecks = wrecksAtRest(hit, ground);
        expect(wrecks.length, "the hit left no wreck").toBeGreaterThan(0);
        for (const wreck of wrecks) {
          const { clearance, mesh } = lowestDrawn(wreck, ground);
          expect(clearance, `lowest drawn point ${(clearance * 100).toFixed(1)} cm over the ground (negative: in it), on ${mesh}; asleep ${wreck.asleep}`).toBeGreaterThanOrEqual(-SINK_M);
        }
      });
    }
  }

  // A wreck lying over (up under `UPRIGHT_UP_Y`) with its low tyres on the ground rolled on them as if on its wheels, no row of it
  // gripping: the monster wreck, on its side across the slope with its brakes held, rolled down it at 1.3 to 4.5 m/s, never asleep.
  for (const hit of HITS) {
    it(`when ${hit.name} on a 10° slope, then no wreck lying on its side or roof is still moving after ${SETTLE_MAX_S} s: none rolls away on the tyres of a side it lies on`, () => {
      const wrecks = wrecksAtRest(hit, new Slope(10));
      for (const wreck of wrecks) {
        const upY = 1 - 2 * (wreck.group.quaternion.x ** 2 + wreck.group.quaternion.z ** 2);
        if (upY >= UPRIGHT_UP_Y) continue;
        const speed = wreck.velocity.length();
        expect(speed, `a wreck lying over (up ${upY.toFixed(2)}) still moves at ${speed.toFixed(2)} m/s after ${SETTLE_MAX_S} s`).toBeLessThan(REST_SPEED);
      }
    });
  }

  // Each hit a little slower and faster, on gentler and steeper slopes: where a wreck comes to rest (on its wheels, side or roof) turns on
  // every shape or tuning change, so one staged case flips with them; a defect that puts a wreck's drawn hub, wheel or part in the ground
  // on some of the ways it can lie shows on a handful of them.
  for (const scale of [0.9, 1.1]) {
    for (const pitch of [5, 15]) {
      for (const hit of HITS) {
        it(`when ${hit.name}, ${scale < 1 ? "10 % slower" : "10 % faster"}, on a ${pitch}° slope, then no point of either wreck is drawn more than 3 cm in the ground under it`, () => {
          const ground = new Slope(pitch);
          const wrecks = wrecksAtRest(hit, ground, scale);
          expect(wrecks.length, "the hit left no wreck").toBeGreaterThan(0);
          for (const wreck of wrecks) {
            const { clearance, mesh } = lowestDrawn(wreck, ground);
            expect(clearance, `lowest drawn point ${(clearance * 100).toFixed(1)} cm over the ground (negative: in it), on ${mesh}; asleep ${wreck.asleep}`).toBeGreaterThanOrEqual(-SINK_M);
          }
        });
      }
    }
  }

  // The rows above rest each wreck however its sim settles (a wheelless nose lands on a sill or a fender, a few cm either way, with every
  // change to the sim), so a cage that falls short of the drawn body there reads green on one settle and red on the next. These read the
  // crushed shape alone: with the cage's rigid-step points under the wreck whichever way it lies (`LIE_RANGE_DEG`: any pitch and roll to
  // 30°, a 15° slope and the tilt a wreck settles at), no vertex of its drawn body stands more than 3 cm beyond them, so none can be
  // in the ground. The truck and monster stand on a body lift the sim's own pose sync sets (`cageLift`): not read here.
  for (const hit of HITS.filter((h) => h.a !== "truck")) {
    it(`when ${hit.name} leaves wrecks, then the points each rests on reach within 3 cm of its drawn body's skin whichever way it lies`, () => {
      const wrecks = wrecksAtRest(hit, new Slope(15), 1);
      expect(wrecks.length, "the hit left no wreck").toBeGreaterThan(0);
      for (const wreck of wrecks) {
        const { gap, at } = skinReachPastCage(wreck);
        expect(gap, `${wreck.style.id}: the drawn body reaches ${(gap * 100).toFixed(1)} cm past the cage's points at ${at}`).toBeLessThanOrEqual(SINK_M);
      }
    });
  }
});
