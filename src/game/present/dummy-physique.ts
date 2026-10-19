import { JOINTS, SHOULDER_Y } from "./ragdoll-body.ts";
import type { Fit } from "./dummy-rig.ts";

/** Scales (x, z) at heights (m, rising), linear between rows and held past the ends. */
type Profile = readonly (readonly [y: number, x: number, z: number])[];

/**
 * A build's physique over its fitted rest pose: the trunk, neck and head scaled about the body's middle, each leg about the
 * rig's hip axis, each arm about the rig's arm axis, moved `armIn` (m) toward the middle and swung `armOut` (rad) about its
 * shoulder. The weights stay, so the ragdoll pins the body as before.
 */
type Physique = { core: Profile; leg: Profile; arm: Profile; armIn: number; armOut: number };

const [ARM_X, ARM_Z] = [JOINTS[3][2], JOINTS[3][4]];
const [LEG_X, LEG_Z] = [JOINTS[7][2], JOINTS[7][4]];
/** The inner thighs may meet at the crotch but not cross: each stays this far (m) off the middle. */
const THIGH_GAP = 0.002;

function scaleAt(profile: Profile, y: number, axis: 1 | 2): number {
  if (y <= profile[0]![0]) return profile[0]![axis];
  for (let k = 1; k < profile.length; k++) {
    const [low, high] = [profile[k - 1]!, profile[k]!];
    if (y <= high[0]) return low[axis] + ((high[axis] - low[axis]) * (y - low[0])) / (high[0] - low[0]);
  }
  return profile[profile.length - 1]![axis];
}

/** `fit` given `physique`, in place: each vertex takes the trunk's, the arm's and the leg's moves blended by its shoulder and hip weights. */
export function shape(fit: Fit, physique: Physique): Fit {
  const rest = fit.rest;
  const [cos, sin] = [Math.cos(physique.armOut), Math.sin(physique.armOut)];
  let fingertipY = Infinity;
  for (let i = 0; i < fit.shoulderWeight.length; i++) {
    const [x, y, z] = [rest[i * 3]!, rest[i * 3 + 1]!, rest[i * 3 + 2]!];
    const side = x < 0 ? -1 : 1;
    const arm = fit.shoulderWeight[i]!;
    const leg = fit.hipWeight[i]! * (1 - arm);
    const core = 1 - arm - leg;
    const out = (side * x - ARM_X) * scaleAt(physique.arm, y, 1);
    const down = y - SHOULDER_Y;
    const armX = side * (ARM_X - physique.armIn + out * cos - down * sin);
    const armY = SHOULDER_Y + out * sin + down * cos;
    const legX = side * Math.max(THIGH_GAP, LEG_X + (side * x - LEG_X) * scaleAt(physique.leg, y, 1));
    const legZ = LEG_Z + (z - LEG_Z) * scaleAt(physique.leg, y, 2);
    rest[i * 3] = core * x * scaleAt(physique.core, y, 1) + arm * armX + leg * legX;
    rest[i * 3 + 1] = (1 - arm) * y + arm * armY;
    rest[i * 3 + 2] = core * z * scaleAt(physique.core, y, 2) + arm * (ARM_Z + (z - ARM_Z) * scaleAt(physique.arm, y, 2)) + leg * legZ;
    if (arm >= 1) fingertipY = Math.min(fingertipY, rest[i * 3 + 1]!);
  }
  fit.fingertipY = fingertipY;
  return fit;
}

/** The reference's men: fuller hips and waist than the baked body's, thicker forearms, a thicker neck and a broader head. */
export const MAN: Physique = {
  core: [
    [0.7, 1, 1],
    [0.85, 1.12, 1.05],
    [1.1, 1.05, 1.05],
    [1.25, 1.05, 1.03],
    [1.35, 1, 1],
    [1.47, 1, 1],
    [1.5, 1.14, 1.05],
    [1.54, 1.18, 1.06],
    [1.58, 1.12, 1.05],
    [1.63, 1.08, 1.05],
  ],
  leg: [
    [0.72, 1, 1],
    [0.85, 1.06, 1.06],
  ],
  arm: [
    [0.95, 1.22, 1.15],
    [1.07, 1.1, 1.08],
    [1.12, 0.95, 1],
  ],
  armIn: 0,
  armOut: 0.015,
};

/** The reference's woman: narrower shoulders, her arms set in from the man's and hanging out past her hips, a slightly broader head. */
export const WOMAN: Physique = {
  core: [
    [1.25, 1, 1],
    [1.32, 0.92, 1],
    [1.45, 0.92, 1],
    [1.52, 1, 1],
    [1.6, 1.04, 1.02],
  ],
  leg: [[0, 1, 1]],
  arm: [
    [0.9, 1.2, 1.15],
    [1.2, 1, 1],
    [1.35, 0.85, 0.95],
  ],
  armIn: 0.02,
  armOut: 0.09,
};

/** The reference's president: square shoulders, a thick neck and big head, heavy arms set out from his belly, thicker legs. */
export const PORTLY: Physique = {
  core: [
    [0.7, 1, 1],
    [0.9, 1.05, 1.03],
    [1.1, 1.08, 1.05],
    [1.3, 1.04, 1.03],
    [1.4, 1.06, 1],
    [1.47, 1.3, 1.15],
    [1.55, 1.3, 1.15],
    [1.64, 1.18, 1.08],
  ],
  leg: [
    [0.4, 1.2, 1.06],
    [0.8, 1.25, 1.06],
  ],
  arm: [
    [0.9, 1.25, 1.2],
    [1.38, 1.1, 1.05],
  ],
  armIn: 0,
  armOut: 0.03,
};
