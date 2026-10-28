import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import type { BodyStyle } from "./car-variants.ts";
import { FULL_POOL, LampLights } from "./lamp-lights.ts";
import { paint } from "./test-support.ts";

/** The distance (m) ahead of a lone car the glow's camera stands at, and its height. */
const VIEW_AHEAD = 8;
const VIEW_HEIGHT = 1.5;

/** The glow colours a lone car in `style` gets from the pool, head L and head R first, seen from ahead (a glow shows its lens's side only). */
export function headGlowOf(style: BodyStyle): { rgb: ArrayLike<number>; n: number } {
  const scene = new THREE.Scene();
  const car = new DeformableCar(paint(), scene, null, "hatchback");
  const restyled: { style: BodyStyle } = car; // `style` is readonly only to game code; the glow reads it per update
  restyled.style = style;
  car.spawnFacing(0, 10, 0, 0);
  car.group.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  camera.position.copy(car.group.position).addScaledVector(car.forward, VIEW_AHEAD).setY(VIEW_HEIGHT);
  camera.lookAt(car.group.position);
  const lights = new LampLights(scene, 12, FULL_POOL);
  lights.update([car], camera, car);
  return { rgb: lights.glow.geometry.getAttribute("color").array, n: lights.glow.geometry.drawRange.count };
}
