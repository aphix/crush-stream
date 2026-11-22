import { sinCosAt } from "../../kernel/physics-core.js";
import { ACTIVITY, ACTIVITY_OPEN_ENDED } from "./civilian-activity.ts";
import { DECISION_HZ, FLAG, NO_PLACE, RESIDENT_FLOAT, RESIDENT_FLOAT_STRIDE, RESIDENT_INT, RESIDENT_INT_STRIDE } from "./civilian-constants.ts";
import { STRIDE_RADIANS_PER_METRE } from "./civilian-crowd-constants.ts";
import { legPositionAt, type LegPose } from "./civilian-leg.ts";
import { lookOf } from "./civilian-look-word.ts";
import type { CrowdSeparation } from "./civilian-separation.ts";
import type { CityState } from "./civilian-state.ts";
import type { CrowdPoses } from "./crowd-poses.ts";

/** An animal resting at a place lies this far (m) out from its door on the pavement, its place's animals `REST_SPREAD` m apart along the face in `REST_SLOTS` spots by number: tuned by feel. */
const REST_OUT = 0.6;
const REST_SPREAD = 0.7;
const REST_SLOTS = 3;
/** A resting animal faces the street turned by a whole step of this (rad) either way by its number, so a litter does not stare one way: tuned by feel. */
const REST_TURN_STEP = 0.3;
const REST_TURNS = 5;
/** The door's yaw in, its [sin, cos] out (`sinCosAt`: no boxed argument or result; `detSin`/`detCos` calls here boxed 34 KB over 300 frames of six resting animals). */
const doorTrig = new Float64Array(2);

/**
 * Animal `resident` at crowd time `seconds`, written into `poses` and the separation's brain spot: walking its leg, or resting out at its place's door (`activityClock`: the seconds it has rested, which the drawing
 * sits or lies it by). Nothing is written, so it stays unshown, while it is hurt, held, hidden or at a place beyond the walls. A pure function of the rows and the time.
 */
export function placeAnimal(state: CityState, resident: number, seconds: number, leg: LegPose, poses: CrowdPoses, separation: CrowdSeparation): void {
  const { ints } = state;
  const base = resident * RESIDENT_INT_STRIDE;
  const tick = seconds * DECISION_HZ;
  if (ints[base + RESIDENT_INT.alive] === 0 || (ints[base + RESIDENT_INT.flags]! & (FLAG.hurt | FLAG.custody)) !== 0) return;
  if (tick >= state.hiddenFromTick[resident]! && tick < state.hiddenUntilTick[resident]!) return;
  const departTick = ints[base + RESIDENT_INT.departTick]!;
  const arriveTick = ints[base + RESIDENT_INT.arriveTick]!;
  const leaving = ints[base + RESIDENT_INT.pathCount]! > 0;
  if (leaving && tick >= departTick && tick < arriveTick) {
    if (!legPositionAt(state, resident, seconds, leg)) return;
    poses.yaw[resident] = leg.yaw;
    poses.speed[resident] = Math.abs(leg.speed);
    poses.stride[resident] = state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed]! * (seconds - departTick / DECISION_HZ) * STRIDE_RADIANS_PER_METRE;
    poses.activityClock[resident] = 0;
    separation.fixed[resident] = 0;
    separation.brainX[resident] = leg.x;
    separation.brainZ[resident] = leg.z;
    separation.velocityX[resident] = leg.dirX * leg.speed;
    separation.velocityZ[resident] = leg.dirZ * leg.speed;
  } else {
    const at = leaving && tick < departTick ? ints[base + RESIDENT_INT.fromPlace]! : ints[base + RESIDENT_INT.place]!;
    const place = at === NO_PLACE ? undefined : state.map.places[at];
    if (place === undefined || place.doorNode < 0) return;
    doorTrig[0] = place.yaw;
    sinCosAt(doorTrig, 0);
    const normalX = doorTrig[1]!;
    const normalZ = -doorTrig[0]!;
    const lateral = ((resident % REST_SLOTS) - (REST_SLOTS - 1) / 2) * REST_SPREAD;
    // Facing out along the door's normal (cos yaw, -sin yaw) is the place's yaw turned a quarter.
    poses.yaw[resident] = place.yaw + Math.PI / 2 + ((resident % REST_TURNS) - (REST_TURNS - 1) / 2) * REST_TURN_STEP;
    poses.speed[resident] = 0;
    poses.stride[resident] = 0;
    poses.activityClock[resident] = tick >= arriveTick ? seconds - arriveTick / DECISION_HZ : 0;
    separation.fixed[resident] = 1;
    separation.brainX[resident] = place.doorX + normalX * REST_OUT + normalZ * lateral;
    separation.brainZ[resident] = place.doorZ + normalZ * REST_OUT - normalX * lateral;
    separation.velocityX[resident] = 0;
    separation.velocityZ[resident] = 0;
  }
  poses.shown[resident] = 1;
  separation.present[resident] = 1;
  poses.look[resident] = lookOf(state.seed, ints, base);
  poses.activity[resident] = ACTIVITY.none;
  poses.activityLeft[resident] = ACTIVITY_OPEN_ENDED;
  poses.partner[resident] = -1;
  poses.feetY[resident] = 0;
  poses.surfaceY[resident] = 0;
}
