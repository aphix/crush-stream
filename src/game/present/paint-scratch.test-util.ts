import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { compileHooks } from "../vehicle/car-detail-map.test-util.ts";
import { CAR_SPRAY, SPRAY_FACE, sprayFace } from "../vehicle/spray-box.ts";

/** The wear mask `material` hands its program, read through its compile hooks as three builds it: R scratch, G dents (RG8). */
export function wearOf(material: THREE.Material): THREE.DataTexture {
  return compileHooks(material).uniforms.wearMap!.value as THREE.DataTexture;
}

/** Car `car`'s wear mask texels as its body paint samples them. */
export function wearTexels(car: DeformableCar): Uint8Array {
  return wearOf(car.lookMeshes().bodyPaint).image.data as Uint8Array;
}

/** The scratch byte (mask R) `material`'s program samples at rest point `p`, normal `n`: `sprayFaceAt` over the uniforms its hooks bind, an unbound one zero as in GL. */
export function sampledScratch(material: THREE.Material, p: THREE.Vector3, n: THREE.Vector3): number {
  const { uniforms } = compileHooks(material);
  const min = (uniforms.sprayMin?.value as THREE.Vector3 | undefined) ?? new THREE.Vector3();
  const span = (uniforms.spraySpan?.value as THREE.Vector3 | undefined) ?? new THREE.Vector3();
  const face = sprayFace(CAR_SPRAY, p, n, new Float64Array(2));
  const rect = (uniforms.sprayFaces?.value as THREE.Vector4[] | undefined)?.[face] ?? new THREE.Vector4(0, 0, 0, 0);
  // GLSL's clamp of an unbound span's 0/0 is undefined; 0 stands for it.
  const [tx, ty, tz] = [0, 1, 2].map((i) => Math.min(1, Math.max(0, (p.getComponent(i) - min.getComponent(i)) / span.getComponent(i))) || 0) as [number, number, number];
  const [u, v] = face === SPRAY_FACE.left || face === SPRAY_FACE.right ? [tz, ty] : face === SPRAY_FACE.top ? [tz, tx] : [tx, ty];
  const mask = uniforms.wearMap!.value as THREE.DataTexture;
  const { width, height, data } = mask.image as { width: number; height: number; data: Uint8Array };
  // Clamped to the edge texel, as the mask wraps.
  return data[(Math.min(height - 1, Math.floor((rect.y + v * rect.w) * height)) * width + Math.min(width - 1, Math.floor((rect.x + u * rect.z) * width))) * 2]!;
}
