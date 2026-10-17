import * as THREE from "three";
import { detAtan2, detCos, detSin } from "../kernel/physics-core.js";

/** The wide screens' lens (deg). */
export const LAB_FOV = 60;

/**
 * The Lab's opening orbit: always from the side of the throw, low over the bench at toy height, so the thrown car and what it
 * hits cross the screen in a line, the thrower on the left and the targets on the right with the pegboard behind. It looks
 * `turn` rad off straight behind the thrower (a quarter turn: perpendicular to the throw's axis) at the look point `toFocus`
 * of the way from the thrower to the set's middle, `lift` m over the set so it sits low on the screen with the tools on the
 * board above it, but never so high that the thrower sits more than `low` of the half height below the middle (a dummy lying
 * on the bench dropped under the dock and the set panel). It stands just far enough back, through a lens `fov` deg tall, that
 * every item of the set and `fit` m to spare fits the width (`planLabShot`).
 *
 * `upright`: a phone held upright has a narrow screen, so the same side shot is fitted to its width through a taller lens (the
 * set is as long as the bench's throw, whatever the screen's width): the car stays a thumb wide, the set is a band across the
 * screen's middle, and the room above and below it is the camera's (a press off an item turns the view). `wide`: a screen
 * `shortPx` CSS px tall or less (a phone on its side) has its dock and set panel along the bottom: there the look point is the
 * set's own height, so the thrower and the set sit mid-screen, clear of both.
 */
export const LAB_SHOT = {
  upright: { toFocus: 1, turn: Math.PI / 2, fit: 2.6, pitch: 0.2, lift: 3.5, low: 0.35, fov: 90 },
  wide: { toFocus: 1, turn: Math.PI / 2, fit: 3.2, pitch: 0.12, lift: 3.5, low: 0.35, fov: LAB_FOV, shortPx: 500 },
};

/** The shot's lens and fit: what `LAB_SHOT.upright` and `.wide` both hold. */
type LabShotSpec = { toFocus: number; turn: number; fit: number; pitch: number; lift: number; low: number; fov: number };

/**
 * Plans the orbit for `shot` on a screen `aspect` (width over height): into `look` the point its camera looks at (`shot.toFocus`
 * of the way from the thrower to the set's middle, `shot.lift` over it, 0 when `flat`), and the camera's `bearing` (rad, the
 * orbit's angle: straight behind the thrower looking at the set's middle, turned `shot.turn`) and `radius` (m): the distance at
 * which every one of `items` (plan points) is within the width with `shot.fit` m to spare, through the lens. An item nearer the
 * camera than the look point is drawn larger, so it is fitted by its own depth, not the look point's. The look point is held
 * down to where the thrower sits no more than `shot.low` of the half height below the middle.
 */
export function planLabShot(thrower: THREE.Vector3, setMiddle: THREE.Vector3, items: readonly { x: number; z: number }[], shot: LabShotSpec, aspect: number, flat: boolean, look: THREE.Vector3): { bearing: number; radius: number } {
  look.lerpVectors(thrower, setMiddle, shot.toFocus).setY(setMiddle.y + (flat ? 0 : shot.lift));
  const bearing = detAtan2(thrower.x - setMiddle.x, thrower.z - setMiddle.z) + shot.turn;
  const halfHeightPerMetre = Math.tan(THREE.MathUtils.degToRad(shot.fov) / 2);
  const halfWidthPerMetre = halfHeightPerMetre * aspect;
  let radius = 0;
  for (const item of items) {
    const offX = item.x - look.x;
    const offZ = item.z - look.z;
    // Across the screen along the camera's right (cos, -sin of the bearing); beyond the look point along its view, in plan (the view's pitch shortens it).
    const across = Math.abs(offX * detCos(bearing) - offZ * detSin(bearing));
    const beyond = -(offX * detSin(bearing) + offZ * detCos(bearing)) * Math.cos(shot.pitch);
    radius = Math.max(radius, (across + shot.fit) / halfWidthPerMetre - beyond);
  }
  look.y = Math.min(look.y, thrower.y + shot.low * radius * halfHeightPerMetre);
  return { bearing, radius };
}
