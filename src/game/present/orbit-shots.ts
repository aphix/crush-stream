import * as THREE from "three";
import { hypot2 } from "../kernel/physics-core.js";
import type { DeformableCar } from "../vehicle/car.ts";

/** A lamp post the orbit keeps clear of: it stands from its base up `POST_TOP` m and is thin, so the eye's distance to its axis is what counts. */
export type Post = { intact: boolean; group: { visible: boolean; position: THREE.Vector3 } };
/** The orbit's target keeps this far (m) from a post's axis; the eye lags the target and cuts the bend short (0.1 m at the idle spin of 0.32 rad/s, measured), so 3.15 holds it 3 m clear. */
const POST_CLEAR = 3.15;
const POST_TOP = 5.3;
/** The orbit's eye keeps this far (m) inside `ChaseCamera.rim`, the derby bowl's wall. */
const RIM_EYE_IN = 2;
/** The derby's opening shot (`placeBowl`): the eye this far (m) from the pack toward the bowl's middle and up over the floor, about 48° down. */
const BOWL_EYE_BACK = 20;
const BOWL_EYE_UP = 22;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Mean position of the cars still on the disc (falling and vaporized ones skipped; zero for an empty fleet). */
export function centroid(out: THREE.Vector3, cars: readonly DeformableCar[]): THREE.Vector3 {
  out.set(0, 0, 0);
  let n = 0;
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i]!;
    if (car.falling || car.vaporized) continue;
    out.add(car.group.position);
    n++;
  }
  return n === 0 ? out : out.multiplyScalar(1 / n);
}

/**
 * The orbit's target `p` round `look` bends along its own radius round each lamp post so the eye keeps `POST_CLEAR` m from the post's
 * axis (less over its top). One smooth swell, easing out over 3 × `POST_CLEAR` m of orbit either side, so a pass has no kink.
 * It goes inward (the post behind the eye, out of the shot) unless the post's circle lies more than a quarter of the
 * clearance inside the orbit's: then outward. No allocation.
 */
export function pushFromPosts(p: THREE.Vector3, look: THREE.Vector3, posts: readonly Post[]): void {
  const ex = p.x - look.x;
  const ez = p.z - look.z;
  const R = hypot2(ex, ez);
  if (R < 1e-3) return;
  const ux = ex / R;
  const uz = ez / R;
  for (let k = 0; k < posts.length; k++) {
    const post = posts[k]!;
    if (!post.intact || !post.group.visible) continue;
    const q = post.group.position;
    const h = Math.max(0, p.y - q.y - POST_TOP);
    if (h >= POST_CLEAR) continue;
    const c = Math.sqrt(POST_CLEAR * POST_CLEAR - h * h);
    // The post from `look`: along the eye's radius (on the eye's side) and across it.
    const px = q.x - look.x;
    const pz = q.z - look.z;
    const s = px * uz - pz * ux;
    if (px * ux + pz * uz <= 0 || Math.abs(s) >= 3 * c) continue;
    const swell = 1 - (s * s) / (9 * c * c);
    // How far the post's circle lies beyond the orbit's (negative: inside it), and the shift that clears it on the chosen side.
    const gap = hypot2(px, pz) - R;
    const shift = gap >= -c / 4 ? -Math.max(0, c - gap) : Math.max(0, c + gap);
    p.x += ux * shift * swell * swell;
    p.z += uz * shift * swell * swell;
  }
}

/** An eye `p` past `rim` comes in to `RIM_EYE_IN` short of it toward the middle, at its height: inside the round wall, its line to anything inside clears it. */
export function keepInRim(p: THREE.Vector3, rim: number): void {
  const r = hypot2(p.x, p.z);
  const max = rim - RIM_EYE_IN;
  if (r <= max) return;
  p.x *= max / r;
  p.z *= max / r;
}

/** The fleet's opening shot: broadside to the cars' approach line from `side`, looking at their middle. */
export function placeApproach(pos: THREE.Vector3, look: THREE.Vector3, side: THREE.Vector3, cars: readonly DeformableCar[]): void {
  const mid = centroid(_v, cars);
  mid.y = 0.6;
  if (cars.length >= 2) {
    _w.copy(cars[1]!.group.position).sub(cars[0]!.group.position);
  } else {
    _w.copy(cars[0]?.forward ?? _w.set(0, 0, 1));
  }
  const dist = Math.max(_w.length(), 4);
  if (_w.lengthSq() > 1e-8) _w.normalize();
  else _w.set(0, 0, 1);
  const pull = THREE.MathUtils.lerp(16, 11, THREE.MathUtils.clamp(1 - dist / 28, 0, 1)) + Math.max(0, cars.length - 2) * 0.55;
  pos.copy(mid).addScaledVector(side, pull).addScaledVector(_up, 5.2).addScaledVector(_w, -1.4);
  look.copy(mid);
}

/** The derby's opening shot: high on the bowl's middle side of the pack, looking down and out at it, the bowl's floor around it. */
export function placeBowl(pos: THREE.Vector3, look: THREE.Vector3, side: THREE.Vector3, rim: number, cars: readonly DeformableCar[]): void {
  const mid = centroid(_v, cars);
  mid.y = 0.6;
  const r = hypot2(mid.x, mid.z);
  if (r > 1) _w.set(mid.x / r, 0, mid.z / r);
  else _w.copy(side);
  pos.copy(mid).addScaledVector(_w, -BOWL_EYE_BACK).addScaledVector(_up, BOWL_EYE_UP);
  look.copy(mid);
  keepInRim(pos, rim);
}
