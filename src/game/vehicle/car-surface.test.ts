import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { CAR_STYLE_IDS, CAR_STYLES } from "./car-variants.ts";
import { assignClass, STYLE_CLASS } from "./vehicle-classes.ts";
import { ensureRestFrame, REST_POSITION } from "./car-detail-map.ts";
import { bumperMaterialId } from "./car-materials.ts";
import { BUMPER_F } from "./constants.ts";
import { CAR_SPRAY } from "./spray-box.ts";
import { paint } from "./test-support.ts";
import { MAT } from "../kernel/material-ids.ts";
import { must } from "../kernel/must.test-util.ts";
import { makeCar, runWall } from "../contact/crash-scenarios.test-util.ts";

/** An undented vertex's rest point lands this close (m) to its `sprayPos`: float rounding through two frames. */
const UNDENTED_MATCH = 0.005;
/** A crushed fender vertex's rest point lands this close (m) to its `sprayPos`: two texels along a flank. */
const CRUSHED_MATCH = 0.04;
/** A flank texel along the car (m), and how many of them the crush must move a fender for the row to mean anything. */
const FLANK_TEXEL = (CAR_SPRAY.max[2] - CAR_SPRAY.min[2]) / CAR_SPRAY.w;
const UNCORRECTED_TEXELS = 3;
/** The front crush: a full-width wall hit at this speed (km/h). */
const CRUSH_KPH = 50;
/** The fender asked: this far (m) back from the front hub. */
const FENDER_REACH = 0.4;

/** A car of `style` in its own class, its body's rest frame read at the origin as a look's first wear reads it. */
function restCar(style: (typeof CAR_STYLE_IDS)[number]): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, style);
  assignClass(car, STYLE_CLASS[style]);
  ensureRestFrame(car.body, car.group);
  return car;
}

/** Per body vertex: how far (m) its rest point (`restPointOf` of where it is drawn) lies from its `sprayPos`, and from it with the crush correction left out. */
function restErrors(car: DeformableCar, accept: (rest: THREE.Vector3) => boolean): { corrected: number[]; uncorrected: number[] } {
  car.group.updateMatrixWorld(true);
  const pos = car.body.geometry.getAttribute("position");
  const rest = car.body.geometry.getAttribute(REST_POSITION);
  const toGroup = new THREE.Matrix4().copy(car.group.matrixWorld).invert();
  const world = new THREE.Vector3();
  const at = new THREE.Vector3();
  const out = new THREE.Vector3();
  const corrected: number[] = [];
  const uncorrected: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    at.fromBufferAttribute(rest, i);
    if (!accept(at)) continue;
    world.fromBufferAttribute(pos, i).applyMatrix4(car.body.matrixWorld);
    corrected.push(car.restPointOf(world, out).distanceTo(at));
    uncorrected.push(world.applyMatrix4(toGroup).distanceTo(at));
  }
  return { corrected, uncorrected };
}

describe("given every body style standing undented somewhere off the origin, turned", () => {
  for (const style of CAR_STYLE_IDS) {
    it(`when each body vertex of a ${style} is taken back to its rest point, then it lands on its spray position`, () => {
      const car = restCar(style);
      car.spawnFacing(3, -2, 0.7, 0);
      const { corrected } = restErrors(car, () => true);
      const worst = Math.max(...corrected);
      expect(corrected.length, "vertices asked").toBeGreaterThan(100);
      expect(worst, `worst miss ${worst.toFixed(4)} m`).toBeLessThan(UNDENTED_MATCH);
    });
  }
});

describe("given a sedan whose front was crushed into a wall", () => {
  const car = makeCar();
  ensureRestFrame(car.body, car.group);
  runWall(CRUSH_KPH, 1, "front", { car });
  car.updateSkin();
  car.flushDeferredSkin();
  const frontAxle = car.frame.wz[0] ?? 0;
  /** The flank from the front wheel back to the door, wheel to belt: the crumple zone ahead of the hub folds its skin past what the masses carry. */
  const fender = (p: THREE.Vector3) => Math.abs(p.x) > 0.6 && p.z > frontAxle - FENDER_REACH && p.z < frontAxle && p.y > 0.3 && p.y < 1;

  it("when its fender vertices are taken back to their rest points, then each lands within two texels of its spray position, where the crush moved them three texels or more", () => {
    const { corrected, uncorrected } = restErrors(car, fender);
    const worst = Math.max(...corrected);
    const moved = Math.max(...uncorrected);
    expect(corrected.length, "fender vertices asked").toBeGreaterThan(20);
    expect(moved, `the control: the crush moved a fender vertex ${moved.toFixed(3)} m`).toBeGreaterThan(UNCORRECTED_TEXELS * FLANK_TEXEL);
    expect(worst, `worst corrected miss ${worst.toFixed(3)} m (uncorrected ${moved.toFixed(3)} m)`).toBeLessThan(CRUSHED_MATCH);
  });
});

describe("given every body style standing at rest", () => {
  for (const style of CAR_STYLE_IDS) {
    it(`when a ${style}'s front bumper face, the body behind it once the bumper is torn off, and a tyre's sidewall are asked their material, then they read the bumper's, the paint's and the tyre's`, () => {
      const car = restCar(style);
      car.spawnFacing(0, 0, 0, 0);
      const box = car["bumperBoxes"][0];
      must(box, "the front bumper's box");
      const face = new THREE.Vector3(0, (box.min.y + box.max.y) / 2, box.max.z - 0.01);
      expect(car.surfaceAt(face), "the bumper face").toBe(bumperMaterialId(CAR_STYLES[style].bumpers.front.trim));
      const hub = car.frame.wheels[0];
      const wheel = car.wheels[0];
      must(hub && wheel, "the front-left wheel");
      const hubs = wheel.parent;
      const lift = car.body.parent;
      must(hubs && lift, "the class's hub group and body lift");
      const { r, halfW } = car.frame.rig.tyre;
      const scale = wheel.scale.x;
      const rise = hubs.position.y - lift.position.y;
      const sidewall = new THREE.Vector3(hub[0] + Math.sign(hub[0]) * halfW * scale, hub[1] + rise + 0.5 * r * scale, hub[2]);
      expect(car.surfaceAt(sidewall), "the tyre's sidewall").toBe(MAT.TYRE);
      const bumper = car["parts"].find((p) => p.name === BUMPER_F);
      must(bumper, "the front bumper part");
      car["detachPart"](bumper, 0);
      expect(car.surfaceAt(face), "behind the torn bumper").toBe(MAT.CAR_PAINT);
    });
  }
});
