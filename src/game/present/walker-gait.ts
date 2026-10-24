import { detCos, detSin } from "../kernel/physics-core.js";

/** Index of each joint target `writeGait` fills (rad): thigh swing (negative is forward), thigh roll (positive swings the foot toward +x), knee bend, arm swing, elbow bend. */
export const GAIT = { HIP_L: 0, HIP_R: 1, ROLL_L: 2, ROLL_R: 3, KNEE_L: 4, KNEE_R: 5, ARM_L: 6, ARM_R: 7, ELBOW_L: 8, ELBOW_R: 9, COUNT: 10 } as const;

const TWO_PI = 2 * Math.PI;
/** The knee flexes this much more (rad) as the foot swings through, to clear the ground. */
const KNEE_SWING = 0.9;
/** A stride this wide (rad of thigh swing) swings the knee and leans the legs in full; narrower ones in proportion. */
const FULL_STRIDE = 0.3;
/** The stance leg leans this far (rad) toward the body's middle so the weight sits over the foot, and the swing leg this share of it the other way. */
const STANCE_LEAN = 0.07;
const SWING_LEAN_SHARE = 0.3;
/** An arm swings against the leg on its own side, this share of the thigh's swing; elbows hang slightly bent. */
const ARM_SHARE = 0.6;
const ELBOW_HANG = -0.2;

/**
 * The limb targets of one gait cycle into `out` (`GAIT` order). `phase` is the cycle (0 to 1; the left foot lands at 0, the right
 * at a half), `stride` the thigh swing either side of upright (rad; 0 stands still) and `kneeBase` how far the knees stay bent. No allocation.
 */
export function writeGait(out: Float64Array, phase: number, stride: number, kneeBase: number): void {
  const angleL = TWO_PI * phase;
  const angleR = angleL + Math.PI;
  const swingL = detSin(angleL);
  const swingR = detSin(angleR);
  const hipL = -stride * detCos(angleL);
  const hipR = -stride * detCos(angleR);
  const moving = Math.min(1, stride / FULL_STRIDE);
  const lean = STANCE_LEAN * moving;
  out[GAIT.HIP_L] = hipL;
  out[GAIT.HIP_R] = hipR;
  out[GAIT.ROLL_L] = lean * (swingL > 0 ? 1 : -SWING_LEAN_SHARE);
  out[GAIT.ROLL_R] = -lean * (swingR > 0 ? 1 : -SWING_LEAN_SHARE);
  out[GAIT.KNEE_L] = kneeBase + KNEE_SWING * moving * Math.max(0, -swingL);
  out[GAIT.KNEE_R] = kneeBase + KNEE_SWING * moving * Math.max(0, -swingR);
  out[GAIT.ARM_L] = ARM_SHARE * hipR;
  out[GAIT.ARM_R] = ARM_SHARE * hipL;
  out[GAIT.ELBOW_L] = ELBOW_HANG;
  out[GAIT.ELBOW_R] = ELBOW_HANG;
}

/** The commands (m/s) the gait is tuned for: a walk and a run. Slower ones shorten the cadence, in between the stride widens. */
export const WALK_SPEED = 1.3;
export const RUN_SPEED = 2.5;
const WALK_STRIDE = 0.36;
const RUN_STRIDE = 0.56;
const WALK_CADENCE = 1.1;
const RUN_CADENCE = 1.5;
/** The cadence reaches its ceiling this far (m/s) above a walk: past it the legs lose the ground. */
const CADENCE_RAMP = 0.5;
/** Under this command (m/s) the walker stands. */
const STAND_COMMAND = 0.05;

/**
 * The stride and cadence that walk at `command` m/s into `plan` (stride, cadence), 0 and 0 for a standstill. The thigh swing grows
 * with speed and the cadence rises to a ceiling: open-loop, the speed lands within about 20 % of the command.
 */
export function planGait(command: number, plan: Float64Array): void {
  if (command < STAND_COMMAND) {
    plan[0] = 0;
    plan[1] = 0;
    return;
  }
  const along = Math.max(0, Math.min(1, (command - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)));
  plan[0] = WALK_STRIDE + (RUN_STRIDE - WALK_STRIDE) * along;
  const slow = Math.max(0.5, Math.min(1, command / WALK_SPEED));
  const quick = Math.max(0, Math.min(1, (command - WALK_SPEED) / CADENCE_RAMP));
  plan[1] = WALK_CADENCE * slow + (RUN_CADENCE - WALK_CADENCE) * quick;
}
