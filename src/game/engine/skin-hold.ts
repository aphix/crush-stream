import type { CarCover } from "../present/car-cover.ts";
import { hidingSight, type Sight } from "../present/spectate-cam.ts";
import type { DeformableCar } from "../vehicle/car.ts";

/** The race's side of the question: whether one is on, and the solids its course holds. */
type CourseSights = { readonly active: boolean; courseSight(): Sight | null };

/** Metres above a car's origin its cover sphere stands. */
const COVER_LIFT = 0.6;

/** Whether no camera sees `car` (list index `i`) this frame, so its tyre hold may wait: off every camera, or a wreck wholly behind a solid (`CarCover`). Needs the frame's `aim` of the witness and the cover. */
export function holdHidden(cover: CarCover, race: CourseSights, car: DeformableCar, stride: number, i: number, radius: number): boolean {
  if (stride === 0) return true;
  const sight = car.panelsFollow && race.active ? race.courseSight() : null;
  if (sight === null) return false;
  const p = car.group.position;
  return cover.hidden(i, hidingSight(sight), p.x, p.y + COVER_LIFT, p.z, radius);
}

/** Whether a car drawn small (skinned every 2nd or 4th frame) has its skin unwritten this frame, so its tyre hold may wait too: a wheel's move is laid with the next skin. */
export function holdWaits(stride: number, skinDeferred: boolean): boolean {
  return stride > 1 && skinDeferred;
}
