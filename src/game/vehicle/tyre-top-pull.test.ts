import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { planPulled, stepFree } from "./car-air.ts";
import { wheelsAt } from "./car-air-points.ts";
import { cageLift } from "./car-cage-rig.ts";
import { BORNE_STATE, CarSurfaces, SKIN } from "./car-surfaces.ts";
import { droop } from "./car-suspension.ts";
import type { DeformableCar } from "./car.ts";
import { makeCar } from "./ground-probe.test-util.ts";
import { RAD } from "./wedge.test-util.ts";
import { Ground, setGround } from "../world/ground.ts";
import { armTops, C_H, C_NX, C_NY, C_NZ, HIT_SIZE } from "../world/surfaces.ts";
import { FINE_HZ } from "../kernel/constants.ts";

/** A sedan with its front tyres in their springs on a held sedan's tilted hood pulls along that face, and the car under takes the reaction, as on a world face of the same normal and height. */
const TILTS_DEG = [5, 10] as const;
const SLICE = 1 / FINE_HZ;
const SLICES = 4;
/** Carrier-local z (m) the upper car's front axle stands over: the hood's middle; and nearer its nose, where the fender's crest lies under the tread off the hub's plane. */
const HOOD_Z = 1.45;
const CREST_Z = 1.6;
/** How far (share of the spring stop) the tyres stand in their faces: inside their travel. */
const IN_STOP = 0.5;
/** The faces' plan pull, the car's and the carrier's reaction, may stand off the world's by this share. */
const PULL_SHARE = 0.02;
const FRONT = [0, 1] as const;
/** The tread's contact on the twin's world grid matches the hood's to this (m of rise, and of each normal component): the rig's control. */
const SAME_CONTACT = 1e-3;
/** Height (m) the upper car is first asked from, and the reads that bring its front tyres to `IN_STOP` (each read from nearer). */
const DROP_FROM = 3;
const SEAT_READS = 4;
/** A within (m) every tyre's read counts as down at. */
const REACH_ALL = 10;
/** Plan gap (m) between the front axle and the rear tyres' flat ground. */
const REAR_FROM = 1;

afterEach(() => {
  planPulled.probe = null;
  armTops(null);
  setGround(null);
});

/** Flat world ground at `y` from `z0` on: the upper car's rear tyres stand on it. */
function rearGround(y: number, z0: number): Ground {
  const g = new Ground();
  g.addPlane(y, -50, 50, z0, 50, Infinity);
  return g;
}

/** Per slice, the plan velocity change of `car` (and of the carrier, with its borne weight) between the slice's start and the faces' pull. */
function pulls(car: DeformableCar, carrier: DeformableCar | null, surf: CarSurfaces | null): { car: THREE.Vector3[]; carrier: THREE.Vector3[] } {
  const out = { car: [] as THREE.Vector3[], carrier: [] as THREE.Vector3[] };
  const before = new THREE.Vector3();
  const borne = new Float64Array(BORNE_STATE);
  planPulled.probe = () => {
    out.car.push(new THREE.Vector3(car.velocity.x - before.x, 0, car.velocity.z - before.z));
    if (carrier === null || surf === null) return;
    surf.borneState(carrier.slot, borne, 0, false);
    out.carrier.push(new THREE.Vector3(carrier.velocity.x + borne[0]!, 0, carrier.velocity.z + borne[2]!));
  };
  for (let s = 0; s < SLICES; s++) {
    if (carrier !== null && surf !== null) {
      carrier.velocity.set(0, 0, 0);
      carrier.angular.set(0, 0, 0);
      surf.dropBorne(carrier.slot);
    }
    before.copy(car.velocity);
    stepFree(car, SLICE);
  }
  planPulled.probe = null;
  return out;
}

/** The carrier tilted nose up by `deg` and the upper car facing it, level, its front axle over the hood with both front tyres `IN_STOP` of their stop into it. */
function onHood(deg: number, hoodZ = HOOD_Z) {
  const carrier = makeCar("sedan");
  carrier.spawnFacing(0, 0, 0, 0);
  carrier.group.rotation.set(-deg * RAD, 0, 0, "YXZ");
  carrier.group.updateMatrixWorld(true);
  carrier.slot = 0;
  const upper = makeCar("sedan");
  const axle = carrier.group.localToWorld(new THREE.Vector3(0, 1, hoodZ)).z;
  upper.spawnFacing(0, axle + upper.frame.wz[0]!, Math.PI, 0);
  upper.group.position.y = DROP_FROM;
  upper.parked = false;
  const surf = new CarSurfaces();
  surf.cars = [carrier, upper];
  surf.sync(0, carrier);
  upper.slot = 1;
  upper.surfaces = surf;
  armTops(surf);
  const pen = IN_STOP * droop("sedan");
  // From high above the tread reads a top beyond its reach: a few reads settle the rise.
  for (let k = 0; k < SEAT_READS; k++) {
    wheelsAt(upper, REACH_ALL);
    upper.group.position.y += upper.wheelHit[C_H]! - pen;
    upper.group.updateMatrixWorld(true);
  }
  wheelsAt(upper, REACH_ALL);
  const ground = rearGround(upper.group.position.y + pen, axle + REAR_FROM);
  setGround(ground);
  return { carrier, upper, surf, axle, pen };
}

/** The same upper pose over world ground: the rear tyres' flat, and the carrier's contact top (`CarSurfaces.sync`: its cage's top, lifted by its class) held as a static world grid. */
function overWorld(upper: DeformableCar, carrier: DeformableCar, axle: number, pen: number): { twin: DeformableCar; ground: Ground } {
  const twin = makeCar("sedan");
  twin.spawnFacing(0, upper.group.position.z, Math.PI, 0);
  twin.group.position.copy(upper.group.position);
  twin.parked = false;
  twin.group.updateMatrixWorld(true);
  const ground = rearGround(upper.group.position.y + pen, axle + REAR_FROM);
  const { nu, nv, step, u0, v0 } = carrier.cage.style;
  const e = carrier.group.matrixWorld.elements;
  const lift = cageLift(carrier);
  const axes = [e[0]!, e[1]!, e[2]!, e[4]!, e[5]!, e[6]!, e[8]!, e[9]!, e[10]!];
  ground.addGrid({ nu, nv, step, stepV: step, u0, v0, heights: carrier.cage.fields.top.slice(), ox: e[12]! + lift * e[4]!, oy: e[13]! + lift * e[5]!, oz: e[14]! + lift * e[6]!, axes, reach: SKIN });
  return { twin, ground };
}

describe("given a car with its front tyres in their springs on a held car's hood tilted along its heading", () => {
  for (const deg of TILTS_DEG) {
    it(`when the hood is tilted ${deg}°, then each slice's plan pull of its face, and the reaction the car under takes, are within 2 % of the same car's over a world face of the same normal and height`, () => {
      const { carrier, upper, surf, axle, pen } = onHood(deg);
      const onTop = upper.wheelHit.slice();
      const { twin, ground } = overWorld(upper, carrier, axle, pen);
      const top = pulls(upper, carrier, surf);
      armTops(null);
      setGround(ground);
      wheelsAt(twin, REACH_ALL);
      expectSameContact(twin.wheelHit, onTop, "the control: ");
      const world = pulls(twin, null, null).car;
      const ratio = carrier.deform.totalMass / upper.deform.totalMass;
      for (let s = 0; s < SLICES; s++) {
        const w = world[s]!;
        expect(w.length(), `slice ${s}: the world face pulls nothing`).toBeGreaterThan(0);
        expect(top.car[s]!.distanceTo(w) / w.length(), `slice ${s}: plan pull ${top.car[s]!.z.toFixed(5)} m/s on the hood, ${w.z.toFixed(5)} on the world face`).toBeLessThan(PULL_SHARE);
        const back = top.carrier[s]!.clone().multiplyScalar(ratio).add(w);
        expect(back.length() / w.length(), `slice ${s}: the car under took ${(top.carrier[s]!.z * ratio).toFixed(5)} m/s of the rider's, the world face pulls ${w.z.toFixed(5)}`).toBeLessThan(PULL_SHARE);
      }
    });
  }
});

/** Each front tyre's rise and normal on the world grid (`world`) within `SAME_CONTACT` of the car's top (`top`). */
function expectSameContact(world: Float64Array, top: Float64Array, lead: string): void {
  for (const i of FRONT) {
    for (const k of [C_H, C_NX, C_NY, C_NZ]) expect(Math.abs(world[i * HIT_SIZE + k]! - top[i * HIT_SIZE + k]!), `${lead}tyre ${i}'s contact (slot ${k}) on the world grid ${world[i * HIT_SIZE + k]!.toFixed(4)}, on the car's top ${top[i * HIT_SIZE + k]!.toFixed(4)}`).toBeLessThan(SAME_CONTACT);
  }
}

describe("given a tyre's tread over a car's top, where the fender's crest lies under it off the plane under its hub", () => {
  for (const deg of [0, ...TILTS_DEG]) {
    it(`when the top is tilted ${deg}° and the same top is held as a world grid, then the tread reads the same rise and normal on both, within 1 mm and 0.001`, () => {
      const { carrier, upper, axle, pen } = onHood(deg, CREST_Z);
      const onTop = upper.wheelHit.slice();
      const { twin, ground } = overWorld(upper, carrier, axle, pen);
      armTops(null);
      setGround(ground);
      wheelsAt(twin, REACH_ALL);
      expectSameContact(twin.wheelHit, onTop, "");
    });
  }
});

