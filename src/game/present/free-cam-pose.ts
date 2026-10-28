import type { FreeCam } from "./free-cam.ts";

/** The look point of a written `cam=` stands this far (m) ahead of the eye. */
const LOOK_AHEAD = 1;

/**
 * The free eye as `cam=` carries it: `radius,pitch,angle,x,y,z`, the eye `radius` m from the look point x,y,z, `pitch` rad above it
 * and `angle` rad round it from +z, which is what `headless-frame.mjs --camera` takes. Unrounded: the URL field rounds.
 */
export function camOf(free: FreeCam): number[] {
  const flat = Math.cos(free.pitch) * LOOK_AHEAD;
  return [LOOK_AHEAD, -free.pitch, Math.atan2(Math.sin(free.yaw), Math.cos(free.yaw)), free.eye.x - Math.sin(free.yaw) * flat, free.eye.y + Math.sin(free.pitch) * LOOK_AHEAD, free.eye.z - Math.cos(free.yaw) * flat];
}

/** The eye and its look point for a `cam=` pose (`camOf` read back; the URL field guarantees six numbers). */
export function eyeOf([radius = 1, pitch = 0, angle = 0, x = 0, y = 0, z = 0]: readonly number[]): { eye: [number, number, number]; look: [number, number, number] } {
  const flat = Math.cos(pitch) * radius;
  return { eye: [x + Math.sin(angle) * flat, y + Math.sin(pitch) * radius, z + Math.cos(angle) * flat], look: [x, y, z] };
}
