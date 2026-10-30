import type * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { compileHooks } from "../vehicle/car-detail-map.test-util.ts";

/** The wear mask `material` hands its program, read through its compile hooks as three builds it: R scratch, G dents (RG8). */
export function wearOf(material: THREE.Material): THREE.DataTexture {
  return compileHooks(material).uniforms.wearMap!.value as THREE.DataTexture;
}

/** Car `car`'s wear mask texels as its body paint samples them. */
export function wearTexels(car: DeformableCar): Uint8Array {
  return wearOf(car.lookMeshes().bodyPaint).image.data as Uint8Array;
}
