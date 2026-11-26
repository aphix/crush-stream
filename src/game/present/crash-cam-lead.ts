import * as THREE from "three";

/**
 * The furthest (m) the held crash cam aims ahead of a car it follows. The cap guards a target that jumps in one frame, a subject switch (the replay's next car) or a step catch-up,
 * which is no speed. At the aim's 4/s ease it fully leads a car up to 4 × 4 = 16 m/s on screen; above that the aim trails it by speed / 4 - 4 m.
 */
const LEAD_MAX = 4;

const _lead = new THREE.Vector3();

/**
 * Where a held crash cam aims to follow `target` over a frame of `dt` wall s: ahead of it by the distance it moved since `prev`
 * (the last frame's) per `rate` (the aim's own ease, 1/s), so an aim that eases at `rate` toward it holds on the car as it speeds away
 * instead of trailing it by speed / `rate`. `prev` is then set to `target`; `fresh` (the first frame): no lead. A scratch vector, valid until the next call.
 */
export function leadTarget(target: THREE.Vector3, prev: THREE.Vector3, fresh: boolean, dt: number, rate: number): THREE.Vector3 {
  _lead.copy(target);
  if (!fresh && dt > 0) {
    const scale = 1 / (dt * rate);
    const dx = (target.x - prev.x) * scale;
    const dy = (target.y - prev.y) * scale;
    const dz = (target.z - prev.z) * scale;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const keep = length > LEAD_MAX ? LEAD_MAX / length : 1;
    _lead.x += dx * keep;
    _lead.y += dy * keep;
    _lead.z += dz * keep;
  }
  prev.copy(target);
  return _lead;
}
