import { detAtan2 } from "../kernel/physics-core.js";

/**
 * Where a fallen walker's recovery goes. Any body funnels into one of three routes by how his torso lies: feet down (he is nearly
 * upright, the legs under him: he regrounds and walks on), face down, or face up (he rolls over onto his stomach first). Side lying
 * goes the nearer way round. Each route is a few stages; a stage is a pose the motors pull the limbs to, a pitch the torso's frame
 * leans to (0 upright, π/2 chest to the ground) and the height his torso lifts to, eased from the stage before.
 */
export type GetUpRoute = "reground" | "faceDown" | "faceUp";

/** One stage: seconds it takes, torso pitch (rad), torso height (m), shoulder swing, elbow bend, hip swing, knee bend (rad, as the gait's), and the arms' stiffness multiple (pushing off the ground needs more than carrying them). */
type GetUpStage = { seconds: number; pitch: number; height: number; arm: number; elbow: number; hip: number; knee: number; grip: number };

const PRONE = Math.PI / 2;
/** Torso height (m) standing, from the dummy's torso centre. */
const STANDING_HEIGHT = 1.11;

/** Chest to the ground, and the arms tucked while he is turned over. */
const ROLL: GetUpStage = { seconds: 0.7, pitch: PRONE, height: 0.28, arm: -0.4, elbow: -0.6, hip: 0, knee: 0.2, grip: 1 };
/** On hands and knees: arms straight down from the shoulders, thighs vertical, shins on the ground. */
const PUSH: GetUpStage = { seconds: 0.8, pitch: 1.5, height: 0.55, arm: -1.5, elbow: -0.1, hip: -1.45, knee: 1.5, grip: 6 };
/** Kneeling up, the torso leaning forward over the knees, a hand still on the ground. */
const KNEEL: GetUpStage = { seconds: 0.7, pitch: 0.55, height: 0.82, arm: -0.5, elbow: -0.4, hip: -0.55, knee: 1.45, grip: 3 };
const RISE: GetUpStage = { seconds: 0.8, pitch: 0, height: STANDING_HEIGHT, arm: 0, elbow: -0.2, hip: 0, knee: 0.1, grip: 1 };
/** Feet down: no ground work, he only straightens up and takes his weight again. */
const REGROUND: GetUpStage = { seconds: 0.5, pitch: 0, height: STANDING_HEIGHT, arm: 0, elbow: -0.2, hip: 0, knee: 0.1, grip: 1 };

export const GETUP_ROUTES: Record<GetUpRoute, readonly GetUpStage[]> = {
  reground: [REGROUND],
  faceDown: [PUSH, KNEEL, RISE],
  faceUp: [ROLL, PUSH, KNEEL, RISE],
};

/** A torso whose up axis is this vertical (cosine of 60°) or more has the legs under it: feet down. */
const FEET_DOWN_UPRIGHT = 0.5;
/** A head this level (the squared horizontal share of its axis, under) points straight up or down: the bearing is not his head's. */
const HEAD_VERTICAL = 0.04;

/** The route for a torso lying with rotation `(x, y, z, w)` at `o` in `pose` (`Doll.cur`'s torso rotation is at 3). */
export function chooseRoute(pose: ArrayLike<number>, o: number): GetUpRoute {
  const x = pose[o]!;
  const y = pose[o + 1]!;
  const z = pose[o + 2]!;
  const w = pose[o + 3]!;
  if (1 - 2 * (x * x + z * z) > FEET_DOWN_UPRIGHT) return "reground";
  const chestHeight = 2 * (y * z - w * x);
  return chestHeight < 0 ? "faceDown" : "faceUp";
}

/** The way he will stand facing (rad about the vertical, 0 along +z): where his head points along the ground, else where he faces, else `fallback`. */
export function standingBearing(pose: ArrayLike<number>, o: number, fallback: number): number {
  const x = pose[o]!;
  const y = pose[o + 1]!;
  const z = pose[o + 2]!;
  const w = pose[o + 3]!;
  const headX = 2 * (x * y - w * z);
  const headZ = 2 * (y * z + w * x);
  if (headX * headX + headZ * headZ > HEAD_VERTICAL) return detAtan2(headX, headZ);
  const faceX = 2 * (x * z + w * y);
  const faceZ = 1 - 2 * (x * x + y * y);
  return faceX * faceX + faceZ * faceZ > HEAD_VERTICAL ? detAtan2(faceX, faceZ) : fallback;
}

/** `a` eased toward `b` by `t` (0 to 1) with zero slope at both ends. */
export function smooth(a: number, b: number, t: number): number {
  const s = t * t * (3 - 2 * t);
  return a + (b - a) * s;
}

/** The stage `index` of `stages` at progress `t` as numbers, eased from the stage before (the first stage from itself): written into `out` in `GetUpStage` field order. */
export function stageAt(stages: readonly GetUpStage[], index: number, t: number, out: Float64Array): void {
  const to = stages[index]!;
  const from = stages[Math.max(0, index - 1)]!;
  out[0] = smooth(from.pitch, to.pitch, t);
  out[1] = smooth(from.height, to.height, t);
  out[2] = smooth(from.arm, to.arm, t);
  out[3] = smooth(from.elbow, to.elbow, t);
  out[4] = smooth(from.hip, to.hip, t);
  out[5] = smooth(from.knee, to.knee, t);
  out[6] = smooth(from.grip, to.grip, t);
}

/** Indices into `stageAt`'s output. */
export const STAGE = { PITCH: 0, HEIGHT: 1, ARM: 2, ELBOW: 3, HIP: 4, KNEE: 5, GRIP: 6, COUNT: 7 } as const;
