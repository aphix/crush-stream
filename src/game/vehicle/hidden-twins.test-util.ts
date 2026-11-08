import { type CrashWorld, FREEWHEEL, launch, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { DeformableCar } from "./car.ts";
import type { DriveInput } from "./car-drive.ts";
import { buildCar } from "./drawn-body.test-util.ts";

/** At most this many frames are driven before the twins' state is given up on. */
const MAX_FRAMES = 150;
/** The slalom once crashed: the steer swept through a full lock each second, so the wheels move under the skin every frame. */
const SLALOM_HZ = 1;

export type Twin = { w: CrashWorld; car: DeformableCar };

/** Where the freewheeling sedan starts (x, z, yaw) and its velocity (m/s), against the struck sedan at the origin facing +z. */
type Strike = readonly [x: number, z: number, yaw: number, vx: number, vz: number];
const KPH_25 = 25 / 3.6;
/** Into the left flank at 25 km/h: the body over the wheels dents, the bonnet does not. */
export const FLANK_HIT: Strike = [-5, 0, Math.PI / 2, KPH_25, 0];
/** Head-on into the nose at 56 km/h (the crash calibration's speed): the bonnet crushes down over the front wheels (at 25 km/h it never reaches them: its hold lifts nothing). */
export const NOSE_HIT: Strike = [0, 6, Math.PI, 0, -56 / 3.6];

/**
 * Two identical sedans, each struck by a freewheeling sedan (`strike`) and then driven in a slalom. No camera sees `lazy`
 * (its tyre holds are deferred every frame); `every` is held every frame. They are driven a frame at a time until `until` holds, or
 * null if it never did.
 */
export function hiddenTwins(until: (lazy: DeformableCar, every: DeformableCar) => boolean, strike: Strike = FLANK_HIT): { every: Twin; lazy: Twin } | null {
  const drives: DriveInput[] = [];
  const twin = (): Twin => {
    const car = buildCar("sedan", "sedan");
    const hitter = buildCar("sedan", "sedan");
    const w = makeWorld([car, hitter], false, false);
    const drive: DriveInput = { throttle: 0.5, steer: 0, brake: 0, ebrake: false, boost: false };
    drives.push(drive);
    w.pedals.set(car, drive);
    w.pedals.set(hitter, FREEWHEEL);
    launch(car, 0, 0, 0, 0, 0);
    launch(hitter, ...strike);
    return { w, car };
  };
  const [every, lazy] = [twin(), twin()];
  for (let f = 0; f < MAX_FRAMES; f++) {
    for (const d of drives) {
      d.throttle = every.car.crashed ? 0.5 : 0;
      d.steer = every.car.crashed ? Math.sin((2 * Math.PI * SLALOM_HZ * f) / FRAME_HZ) : 0;
    }
    lazy.car.setHoldDeferred(true);
    tickWorld(every.w, 1 / FRAME_HZ);
    tickWorld(lazy.w, 1 / FRAME_HZ);
    if (until(lazy.car, every.car)) return { every, lazy };
  }
  return null;
}
