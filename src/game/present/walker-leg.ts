import { detAcos, detAsin, detAtan2, detCos, detSin } from "../kernel/physics-core.js";

/** The dummy's leg (`PARTS`): thigh and shin each 0.42 m, the hip joint 0.09 m either side of the torso's middle and 0.27 m under its centre. */
const THIGH = 0.42;
export const HIP_HALF = 0.09;
export const HIP_DROP = 0.27;
/** The leg may stretch this far (m): a hair under straight, so the knee never locks. */
const LEG_MAX = 2 * THIGH * 0.998;
const LEG_MIN = 0.15;

/** `JOINTS` hip limits the walker widens to (`attach`): the thigh swings this far (rad) forward (-) and back (+), and rolls this far outward (-/+ by side) and inward. */
const HIP_SWING_FORWARD = -1.7;
const HIP_SWING_BACK = 0.75;
const ROLL_OUT_LIMIT = 0.48;
const ROLL_IN_LIMIT = 0.18;

/** Hip swing, hip roll and knee bend (rad) of one leg: where each lands in a `solveLeg` output. */
export const LEG = { SWING: 0, ROLL: 1, KNEE: 2 } as const;

const _thigh = new Float64Array(3);

/** The unit direction of the thigh into `_thigh` for a foot `reach` m from the hip along unit `(ux, uy, uz)`: the knee is in front, on the plane the foot direction and forward (+z) span. */
function thighToward(reach: number, ux: number, uy: number, uz: number): void {
  let kx = -uz * ux;
  let ky = -uz * uy;
  let kz = 1 - uz * uz;
  const kLength = Math.sqrt(kx * kx + ky * ky + kz * kz);
  if (kLength < 1e-6) {
    kx = 0;
    ky = 1;
    kz = 0;
  } else {
    kx /= kLength;
    ky /= kLength;
    kz /= kLength;
  }
  const offset = detAcos(reach / (2 * THIGH));
  const c = detCos(offset);
  const s = detSin(offset);
  _thigh[0] = c * ux + s * kx;
  _thigh[1] = c * uy + s * ky;
  _thigh[2] = c * uz + s * kz;
}

/**
 * Solve a leg whose foot is at (`dx`, `dy`, `dz`) from its hip joint, in the torso's own frame (x to the side, y up, z forward), into `out` at `o`:
 * a hip swing (negative: the foot forward), a hip roll (positive swings the foot toward +x) and a knee bend (positive: the shin goes back), the knee
 * always in front. A foot out of reach is brought in to the nearest one the leg has. `side` is -1 for the hip at -x and 1 for the one at +x.
 */
export function solveLeg(out: Float64Array, o: number, dx: number, dy: number, dz: number, side: number): void {
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const reach = Math.max(LEG_MIN, Math.min(LEG_MAX, dist));
  const along = dist > 1e-9 ? 1 / dist : 0;
  thighToward(reach, dx * along, dist > 1e-9 ? dy * along : -1, dz * along);
  const rollLow = side < 0 ? -ROLL_OUT_LIMIT : -ROLL_IN_LIMIT;
  const rollHigh = side < 0 ? ROLL_IN_LIMIT : ROLL_OUT_LIMIT;
  out[o + LEG.ROLL] = Math.max(rollLow, Math.min(rollHigh, detAsin(Math.max(-1, Math.min(1, _thigh[0]!)))));
  out[o + LEG.SWING] = Math.max(HIP_SWING_FORWARD, Math.min(HIP_SWING_BACK, detAtan2(-_thigh[2]!, -_thigh[1]!)));
  out[o + LEG.KNEE] = Math.PI - detAcos(1 - (reach * reach) / (2 * THIGH * THIGH));
}
