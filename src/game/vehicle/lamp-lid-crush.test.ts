import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { CAR_STYLE_IDS, type CarStyleId } from "./car-variants.ts";
import { brakeLampUnit, drawnLamp } from "./part-variants.ts";
import { DT, paint } from "./test-support.ts";

/** How much farther (m) a lid's lamp fitting may stand off its lid's skin after a crush than it did at rest: the lid's skin dents under it, the fitting goes with it. */
const DRIFT_OFF_LID_M = 0.01;
/** A lid skin that moved less than this (m) in the crush proves nothing about its fittings. */
const LID_MOVED_MIN_M = 0.05;
/** The crush's impact: its reach along the car from the group origin, and its height (m): inside the hood or the boot, in the lid's first third. */
const IMPACT_REACH_M = 2.0;
const IMPACT_HEIGHT_M = 0.5;
const CRUSH_STEPS = 20;

const triangle = new THREE.Triangle();
const nearest = new THREE.Vector3();
const vertex = new THREE.Vector3();

function spawnedCar(style: CarStyleId): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, style);
  car.spawn(8, 12, 14);
  return car;
}

/** A centred push into the car's `end`, as a barrier would feed it for a fraction of a second. */
function crushEnd(car: DeformableCar, end: "front" | "rear"): void {
  car.group.updateMatrixWorld();
  const sign = end === "front" ? 1 : -1;
  const hit = car.group.position.clone().addScaledVector(car.forward, sign * IMPACT_REACH_M);
  hit.y = IMPACT_HEIGHT_M;
  const inward = car.forward.clone().multiplyScalar(-sign);
  car.applyImpact(hit, inward, 22, 22);
  for (let i = 0; i < CRUSH_STEPS; i++) {
    car.deform.notifyContact();
    car.deform.feedOverlap(hit, inward, 0.08, 10, DT);
    car.deform.stepStructure(DT);
    car.syncPose(DT);
    car.stepBreakage(DT);
    car.updateSkin();
  }
}

type LidFitting = DeformableCar["lampFittings"][number] & { lid: THREE.Mesh };

const lidFittings = (car: DeformableCar): LidFitting[] => car.lampFittings.filter((f): f is LidFitting => f.lid !== null);

function drawnGeometry(car: DeformableCar, fitting: LidFitting): THREE.BufferGeometry {
  if (fitting.kind === "brake") return brakeLampUnit();
  if (fitting.kind === "marker") throw new Error("a side marker rides the body, not a lid");
  return drawnLamp(car.style, fitting.kind, fitting.share!.lamp!.side).geometry;
}

/** The farthest (m) any drawn vertex of `fitting`, at its seat's pose, stands from its lid's current skin. */
function farthestOffLidSkin(car: DeformableCar, fitting: LidFitting): number {
  fitting.seat.updateMatrix();
  const drawn = drawnGeometry(car, fitting).getAttribute("position");
  const skin = fitting.lid.geometry.getAttribute("position");
  const index = fitting.lid.geometry.getIndex()!;
  let farthest = 0;
  for (let i = 0; i < drawn.count; i++) {
    vertex.fromBufferAttribute(drawn, i).applyMatrix4(fitting.seat.matrix);
    let closest = Infinity;
    for (let t = 0; t < index.count; t += 3) {
      triangle.a.fromBufferAttribute(skin, index.getX(t));
      triangle.b.fromBufferAttribute(skin, index.getX(t + 1));
      triangle.c.fromBufferAttribute(skin, index.getX(t + 2));
      closest = Math.min(closest, triangle.closestPointToPoint(vertex, nearest).distanceToSquared(vertex));
    }
    farthest = Math.max(farthest, closest);
  }
  return Math.sqrt(farthest);
}

function skinTravel(skin: THREE.BufferGeometry, rest: Float32Array): number {
  const now = skin.getAttribute("position").array;
  let travel = 0;
  for (let i = 0; i < now.length; i++) travel = Math.max(travel, Math.abs(now[i]! - rest[i]!));
  return travel;
}

const styles = CAR_STYLE_IDS.filter((id) => lidFittings(spawnedCar(id)).length > 0);

describe("given the styles whose hood or boot lid carries a lamp fitting", () => {
  it("when the table is read, then the hood's share (pickup) and the boot's (sedan, hatchback, wagon) with the gate's high brake lamp (hatchback) are all in it", () => {
    assert.deepEqual([...styles].sort(), ["hatchback", "pickup", "sedan", "wagon"]);
  });

  for (const id of styles) {
    for (const lidName of ["hood", "trunk"] as const) {
      const rest = spawnedCar(id);
      if (!lidFittings(rest).some((f) => f.lid === rest[lidName])) continue;
      const end = lidName === "hood" ? "front" : "rear";
      it(`when a ${id}'s ${end} is crushed, then each fitting on its ${lidName} stands as far off the dented lid as it did at rest`, () => {
        const restOff = lidFittings(rest).map((f) => farthestOffLidSkin(rest, f));
        const car = spawnedCar(id);
        crushEnd(car, end);
        const restSkin = rest[lidName === "hood" ? "hoodRest" : "trunkRest"];
        const travel = skinTravel(car[lidName].geometry, restSkin);
        assert.ok(travel > LID_MOVED_MIN_M, `the ${lidName} skin moved ${travel.toFixed(3)} m: the crush must dent it`);
        const offenders: string[] = [];
        for (const [k, fitting] of lidFittings(car).entries()) {
          if (fitting.lid !== car[lidName]) continue;
          const off = farthestOffLidSkin(car, fitting);
          if (off - restOff[k]! > DRIFT_OFF_LID_M) offenders.push(`${fitting.kind} ${k}: ${off.toFixed(3)} m off the ${lidName}'s skin, ${restOff[k]!.toFixed(3)} m at rest`);
        }
        assert.deepEqual(offenders, [], "every fitting of the lid follows its dent");
      });
    }
  }
});