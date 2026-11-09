import { detCos, detSin } from "../kernel/physics-core.js";
import { activeGround, NO_FLOOR } from "../world/ground.ts";
import { STEP_MAX } from "../world/surfaces.ts";
import { PARTS } from "./ragdoll-body.ts";

/** A fixed world-axis box that is not in the ground (an interior's slab, stair tread or counter): `y0` its foot, `y1` its top. */
export type FloorBox = { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number };

/** The tallest step (m) a foot goes up onto, a stair riser or a curb (a person takes 0.30 m without a hand); anything taller is a wall. */
export const WALK_STEP = 0.3;
/** The ground counts a prism top as floor within `STEP_MAX` above the height asked from, so asking this much higher makes that reach `WALK_STEP`. */
const ASK_LIFT = WALK_STEP - STEP_MAX;
/** A rise or drop of this much (m) within `PACE_REACH` ahead is a step, not a ramp (an 8° ramp rises 0.09 m in 0.6 m, a curb or riser 0.12 or more). */
const STEP_RISE = 0.11;
/** The floor is read every `PACE_LOOK` m out to `PACE_REACH` m ahead of him. */
const PACE_LOOK = 0.2;
const PACE_REACH = 0.6;
/** The pace (m/s) he keeps over steps: the gait's two steps in 0.95 s then reach 0.24 m, a stair tread (0.26 to 0.28 m) or less, so each foot lands on its own tread. */
const STEP_PACE = 0.5;
/** The torso's centre stands this high (m) over the floor. */
const TORSO_HEIGHT = PARTS[0].c[1];

const NO_BOXES: readonly FloorBox[] = [];

/**
 * What the walker's feet stand on: the active ground plus the boxes a building streams in. A top at most `WALK_STEP` over his
 * planted feet is floor; a taller or overhead one is a wall, which the dummy's own colliders stop him at.
 */
export class WalkFloor {
  /** Boxes the ground does not hold, in force while he is near them. */
  boxes: readonly FloorBox[] = NO_BOXES;
  /** The floor (m) under his planted feet: every read is asked from here. */
  level = 0;

  /** He stands with his torso centre at (`x`, `y`, `z`). */
  reset(x: number, y: number, z: number): void {
    this.level = y - TORSO_HEIGHT;
    const floor = this.under(x, z);
    if (floor !== NO_FLOOR) this.level = floor;
  }

  /** The floor straight under (x, z) for feet at `level`; `NO_FLOOR` where there is none. */
  under(x: number, z: number): number {
    const ask = this.level + ASK_LIFT;
    let best = activeGround().heightAt(x, z, ask);
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]!;
      if (x < box.x0 || x > box.x1 || z < box.z0 || z > box.z1) continue;
      if (box.y0 > ask || box.y1 > ask + STEP_MAX || box.y1 <= best) continue;
      best = box.y1;
    }
    return best;
  }

  /** The pace (m/s) he may keep at (`x`, `z`) facing `yaw` when asked for `command`: `STEP_PACE` while a step lies ahead or under him. */
  pace(x: number, z: number, yaw: number, command: number): number {
    if (command <= STEP_PACE) return command;
    const sin = detSin(yaw);
    const cos = detCos(yaw);
    for (let ahead = PACE_LOOK; ahead <= PACE_REACH + PACE_LOOK / 2; ahead += PACE_LOOK) {
      const floor = this.under(x + sin * ahead, z + cos * ahead);
      if (floor !== NO_FLOOR && Math.abs(floor - this.level) >= STEP_RISE) return STEP_PACE;
    }
    return command;
  }

  /** The gait has stepped: the higher floor under a planted foot's pivot (`plant` x, y, z per foot) is `level`. */
  stand(planted: Uint8Array, plant: Float64Array): void {
    let level = NO_FLOOR;
    for (let f = 0; f < 2; f++) {
      if (planted[f] === 1) level = Math.max(level, this.under(plant[f * 3]!, plant[f * 3 + 2]!));
    }
    if (level !== NO_FLOOR) this.level = level;
  }
}
