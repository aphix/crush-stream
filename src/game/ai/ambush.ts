import { hypot2, detAtan2 } from "../kernel/physics-core.js";
import type { AiCar } from "./derby-ai.ts";
import { KNOCK } from "./cop-brain.ts";
import type { Obstacles } from "./obstacles.ts";

/** A player over this speed (m/s) has an escape line; under it it is creeping or boxed in, and the bust's pack holds it. */
export const MOVING = 5;
/** The ambusher wakes once the player is this near (m). */
const NEAR = 30;
/** The line is the player's velocity carried this many seconds, at least and at most: where it will be when a cop that saw it go could be there. */
const AHEAD_MIN = 4;
const AHEAD_MAX = 6;
/** The ambusher parks this far (m) off the line, at least (a lane stays clear: never the only exit) and at most (still a hit on the way past). */
const SIDE_MIN = 5;
const SIDE_MAX = 20;
/** A choke on the line (a solid inside its reach) is not parked on: the ambusher parks this far (m) either side of the mouth along the line. */
const MOUTH = 12;
/** An ambusher nobody comes to wakes after this long (s): a held cop is a cop the pack lacks. */
const HOLD = 25;

/** The player's predicted escape line, as a window of metres along it and a band of metres off it where an ambusher may park. Scratch: no allocation per read. */
export class EscapeLine {
  private fx = 0;
  private fz = 0;
  private lo = 0;
  private hi = 0;

  /**
   * Read `tg`'s line (it must be moving over `MOVING`): carried `AHEAD_MIN … AHEAD_MAX` s, or, where a solid stands on it, round that choke's mouth.
   * False when the window lies out of reach of a drop-in judged `near … far` m from the player (a spot `SIDE_MAX` m off the line is at least sqrt(near² − SIDE_MAX²) m along it): a line
   * on a clear road that is too slow (under about 11 m/s) or too fast (over about 30 m/s) has no spot, and the search is not run.
   */
  read(tg: AiCar, obstacles: Obstacles, near: number, far: number): boolean {
    const v = hypot2(tg.vx, tg.vz);
    this.fx = tg.vx / v;
    this.fz = tg.vz / v;
    const reach = v * AHEAD_MAX;
    const clear = obstacles.run(tg.x, tg.z, detAtan2(tg.vx, tg.vz), reach);
    this.lo = clear < reach ? clear - MOUTH : v * AHEAD_MIN;
    this.hi = clear < reach ? clear + MOUTH : reach;
    return this.hi >= Math.sqrt(near * near - SIDE_MAX * SIDE_MAX) && this.lo <= far;
  }

  /** Whether (x, z) is beside the line from `tg`: inside the window along it, `SIDE_MIN … SIDE_MAX` m off it. */
  beside(tg: AiCar, x: number, z: number): boolean {
    const dx = x - tg.x;
    const dz = z - tg.z;
    const along = dx * this.fx + dz * this.fz;
    const off = Math.abs(dx * this.fz - dz * this.fx);
    return along >= this.lo && along <= this.hi && off >= SIDE_MIN && off <= SIDE_MAX;
  }
}

/** The ambusher `self`, parked `held` s, wakes when its target is within `NEAR` m, has gone past it (it lies behind the target's travel), a knock moves it, or `HOLD` s are up. */
export function ambushWakes(self: AiCar, tg: AiCar, held: number): boolean {
  const dx = self.x - tg.x;
  const dz = self.z - tg.z;
  const passed = hypot2(tg.vx, tg.vz) > MOVING && dx * tg.vx + dz * tg.vz < 0;
  return hypot2(dx, dz) < NEAR || passed || hypot2(self.vx, self.vz) > KNOCK || held > HOLD;
}
