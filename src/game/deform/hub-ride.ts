import type * as THREE from "three";
import type { Beam, MassNode } from "./deform-rig.ts";

/**
 * A hub a deep crush frees rides the yielding cage: in plan its velocity off the body is the mass-weighted mean of the cage masses its live beams join (`v`, `w` about `centre`
 * are the body's), not a slide of its own. What the ride takes off the hub goes into `out[0]`, `out[1]` (x, z, momentum, added to), for `moveRelative` to give back
 * to the moving masses with its damping's: the body never moves.
 */
export function rideCage(masses: readonly MassNode[], beams: readonly Beam[], massBeams: readonly (readonly number[])[], v: THREE.Vector3, w: THREE.Vector3, centre: THREE.Vector3, out: Float64Array): void {
  for (let i = 0; i < masses.length; i++) {
    const m = masses[i]!;
    if (!m.hub || m.popped || !m.dynamic) continue;
    const own = massBeams[m.index]!;
    let sx = 0;
    let sz = 0;
    let sm = 0;
    for (let k = 0; k < own.length; k++) {
      const beam = beams[own[k]!]!;
      const o = beam.a === m.index ? masses[beam.b]! : masses[beam.a]!;
      if (!beam.alive || !o.dynamic || o.hub) continue;
      sx += (o.vel.x - v.x - w.y * (o.world.z - centre.z) + w.z * (o.world.y - centre.y)) * o.mass;
      sz += (o.vel.z - v.z - w.x * (o.world.y - centre.y) + w.y * (o.world.x - centre.x)) * o.mass;
      sm += o.mass;
    }
    if (sm <= 0) continue;
    const vx = v.x + w.y * (m.world.z - centre.z) - w.z * (m.world.y - centre.y) + sx / sm;
    const vz = v.z + w.x * (m.world.y - centre.y) - w.y * (m.world.x - centre.x) + sz / sm;
    out[0] = out[0]! + (vx - m.vel.x) * m.mass;
    out[1] = out[1]! + (vz - m.vel.z) * m.mass;
    m.vel.x = vx;
    m.vel.z = vz;
  }
}
