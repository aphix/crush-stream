import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { compileHooks } from "../vehicle/car-detail-map.test-util.ts";
import { CAR_SPRAY, SPRAY_FACE, sprayFace } from "../vehicle/spray-box.ts";

/** A hard shove along a car's left flank at each rest point (-0.85, y, z) of `at`, each episode committed and closed: one stroke each. */
export function scraped(car: DeformableCar, at: readonly (readonly [number, number])[]): void {
  car.group.updateMatrixWorld(true);
  const q = car.group.quaternion;
  const inward = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const slide = new THREE.Vector3(0, 0, 8).applyQuaternion(q);
  for (const [y, z] of at) {
    car.scrape(car.group.localToWorld(new THREE.Vector3(-0.85, y, z)), inward, slide, 0.3, 3, 1);
    car.scratches.slice(0.25);
    car.scratches.slice(0.25);
  }
}

/** The wear mask `material` hands its program, read through its compile hooks as three builds it: R scratch, G dents, B spatter cover, A its surface (RGBA8). */
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
  return data[(Math.min(height - 1, Math.floor((rect.y + v * rect.w) * height)) * width + Math.min(width - 1, Math.floor((rect.x + u * rect.z) * width))) * 4]!;
}

/** Car `car`'s wear mask channel `channel` (0 R scratches, 1 G dents, 2 B spatter cover, 3 A spatter surface), texel by texel. */
export function channelTexels(car: DeformableCar, channel: 0 | 1 | 2 | 3): number[] {
  return Array.from(wearTexels(car)).filter((_, i) => i % 4 === channel);
}

/** Car `car`'s scratches (R), texel by texel. */
export function scratchTexels(car: DeformableCar): number[] {
  return channelTexels(car, 0);
}

/** Whether `own`, a car's own bumper trim copy, was cloned from a trim that wears the car finish (a chrome one does not). */
export function cloneOfFinished(own: THREE.Material): boolean {
  const trim = own.userData.sharedTrim as THREE.Material | undefined;
  return trim !== undefined && trim.userData.carFinish !== undefined;
}

/** A renderer double whose `texSubImage2D` applies each upload, by the unpack rows it set, to `bytes`: the mask as the GPU holds it after the whole upload three makes at the first draw (made here). */
export function stubGpu(texture: THREE.DataTexture): { renderer: THREE.WebGLRenderer; bytes: Uint8Array; calls: number[][] } {
  const { width, data } = texture.image as { width: number; data: Uint8Array };
  const bytes = Uint8Array.from(data);
  const calls: number[][] = [];
  const unpack = new Map<number, number>();
  const gl = {
    TEXTURE_2D: 1,
    RGBA: 2,
    UNSIGNED_BYTE: 3,
    UNPACK_FLIP_Y_WEBGL: 4,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 5,
    UNPACK_ALIGNMENT: 6,
    UNPACK_ROW_LENGTH: 7,
    texSubImage2D: (_target: number, _level: number, x: number, y: number, w: number, h: number, _format: number, _type: number, src: Uint8Array, offset: number): void => {
      calls.push([x, y, w, h]);
      const stride = (unpack.get(7) || w) * 4;
      for (let r = 0; r < h; r++) bytes.set(src.subarray(offset + r * stride, offset + r * stride + w * 4), ((y + r) * width + x) * 4);
    },
  };
  const renderer = {
    getContext: () => gl,
    properties: { get: () => ({ __webglTexture: {} }) },
    state: { bindTexture: () => undefined, pixelStorei: (name: number, value: number) => void unpack.set(name, value) },
  };
  texture.onUpdate?.(texture);
  return { renderer: renderer as unknown as THREE.WebGLRenderer, bytes, calls };
}
