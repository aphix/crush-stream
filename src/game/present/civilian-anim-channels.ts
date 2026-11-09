/**
 * Body channels: pelvis offsets (m), torso and head angles (rad), the weights `seat` (pelvis onto the seat), `plant` (feet held on the floor) and
 * `lookAtPartner`; `footRaise` (m) lifts the planted feet's floor; `bodyYaw` (rad, left positive) turns the whole body about where it stands and
 * `shiftSide` (left) and `shiftForward` (m, in the frame she began in) walk it off that spot; the three `reach` weights put a hand on a car door's
 * outer handle, inner handle or outer panel (the arm and the place follow the door's swing).
 */
export const CHANNEL = { pelvisDrop: 0, pelvisForward: 1, pelvisSide: 2, torsoPitch: 3, torsoRoll: 4, torsoTwist: 5, headPitch: 6, headYaw: 7, seat: 8, plant: 9, lookAtPartner: 10, footRaise: 11, bodyYaw: 12, shiftSide: 13, shiftForward: 14, reachOutsideHandle: 15, reachInsideHandle: 16, reachOutsidePanel: 17 } as const;
const BODY_CHANNELS = 18;

/** An arm's channels: angles (rad), the elbow's bend, `hand` (0..1) to reach `handZ` ahead, `handY` high and `handOut` away from the middle line instead. */
export const ARM = { swing: 0, out: 1, twist: 2, sweep: 3, elbow: 4, hand: 5, handZ: 6, handY: 7, handOut: 8 } as const;
const ARM_FIELDS = 9;
/** A leg's channels: angles (rad), the knee's bend, and where `plant` puts the ankle ahead of the hip (m). */
export const LEG = { swing: 0, out: 1, knee: 2, footZ: 3 } as const;
const LEG_FIELDS = 4;
export const CHANNELS = BODY_CHANNELS + 2 * ARM_FIELDS + 2 * LEG_FIELDS;

export const armChannel = (side: number, field: number): number => BODY_CHANNELS + side * ARM_FIELDS + field;
export const legChannel = (side: number, field: number): number => BODY_CHANNELS + 2 * ARM_FIELDS + side * LEG_FIELDS + field;

/** A clip's two limb groups: the main one (the punching arm, the arm nearest the partner) and the other. */
export const MAIN = 0;
export const OTHER = 1;

const SIDE_MINUS_X = 0;
const SIDE_PLUS_X = 1;
/** +1 for the +x side (side 1), -1 for the -x one. */
export const sideSign = (side: number): number => side * 2 - 1;

const MIRRORED_BODY = new Set<number>([CHANNEL.pelvisSide, CHANNEL.torsoRoll, CHANNEL.torsoTwist, CHANNEL.headYaw]);
const OUTWARD_ARM = new Set<number>([ARM.out, ARM.twist, ARM.sweep]);

/** Per mirror index (0: the main side is -x, 1: +x) and authored channel: the channel it drives, and the sign its value takes. Lateral angles are authored positive toward the main side, arm out, twist and sweep positive outward. */
export const MIRROR_CHANNEL = new Int32Array(2 * CHANNELS);
export const MIRROR_SIGN = new Float64Array(2 * CHANNELS);

for (const mirrorIndex of [SIDE_MINUS_X, SIDE_PLUS_X]) {
  const at = mirrorIndex * CHANNELS;
  for (let channel = 0; channel < BODY_CHANNELS; channel++) {
    MIRROR_CHANNEL[at + channel] = channel;
    MIRROR_SIGN[at + channel] = MIRRORED_BODY.has(channel) ? sideSign(mirrorIndex) : 1;
  }
  for (const group of [MAIN, OTHER]) {
    const side = group === MAIN ? mirrorIndex : SIDE_PLUS_X - mirrorIndex;
    for (let field = 0; field < ARM_FIELDS; field++) {
      MIRROR_CHANNEL[at + armChannel(group, field)] = armChannel(side, field);
      MIRROR_SIGN[at + armChannel(group, field)] = OUTWARD_ARM.has(field) ? sideSign(side) : 1;
    }
    for (let field = 0; field < LEG_FIELDS; field++) {
      MIRROR_CHANNEL[at + legChannel(group, field)] = legChannel(side, field);
      MIRROR_SIGN[at + legChannel(group, field)] = field === LEG.out ? sideSign(side) : 1;
    }
  }
}
