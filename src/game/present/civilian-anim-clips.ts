import { ARREST, type ActivityName } from "../ai/civilians/civilian-activity.ts";
import { CAR_DOOR } from "../ai/civilians/civilian-car-door.ts";
import { DRIVER_SIDE } from "../vehicle/constants.ts";
import { ARM, armChannel, CHANNEL, LEG, legChannel, MAIN, OTHER } from "./civilian-anim-channels.ts";

/** A key: seconds into the clip (or its period) and the channel's value then; values ease between keys. */
type Key = readonly [time: number, value: number];
/** One channel over time. A track with a `period` repeats it (first and last value equal); `aboveSurface` adds the seat or counter height to a hand's `handY`. */
export type TrackSpec = { channel: number; keys: readonly Key[]; period?: number; aboveSurface?: true };
/**
 * A clip blends in over `blendIn` and out over `blendOut` seconds from the walk or stand it runs on, tracks authored for a main
 * side: the side the partner is on (`side: "partner"`), her right (-x) always (`"right"`), else her dominant one. Channels no track names keep the walk.
 */
type ClipSpec = { blendIn: number; blendOut: number; side?: "partner" | "right"; tracks: readonly TrackSpec[] };

const keys = (...pairs: number[]): Key[] => {
  const out: Key[] = [];
  for (let at = 0; at < pairs.length; at += 2) out.push([pairs[at]!, pairs[at + 1]!]);
  return out;
};
const track = (channel: number, ...pairs: number[]): TrackSpec => ({ channel, keys: keys(...pairs) });
const hold = (channel: number, value: number): TrackSpec => track(channel, 0, value);
const loop = (channel: number, period: number, ...pairs: number[]): TrackSpec => ({ channel, period, keys: keys(...pairs) });
const arm = (group: number, field: keyof typeof ARM): number => armChannel(group, ARM[field]);
const leg = (group: number, field: keyof typeof LEG): number => legChannel(group, LEG[field]);
const bothArms = (field: keyof typeof ARM, make: (channel: number) => TrackSpec): TrackSpec[] => [make(arm(MAIN, field)), make(arm(OTHER, field))];

/** A seated civilian's feet (m ahead of the hips, main side then other), her back and her hands in her lap (rad: the guards' seated arms). */
const SEATED_FOOT_Z = [0.3, 0.26] as const;
const SEATED_PITCH = 0.05;
/** How much of the way her head turns toward a partner while she sits. */
const SEATED_LOOK = 0.7;
const LAP_SWING = -0.35;
const LAP_ELBOW = -0.9;
/** The elbow's bend a walking arm rests at (`walkStance`). */
const ARM_REST_ELBOW = -0.2;

/** The seated body every sit clip holds: the pelvis on the seat, the feet on the floor, the hands in the lap. */
const seated = (): TrackSpec[] => [
  hold(CHANNEL.seat, 1),
  hold(CHANNEL.plant, 1),
  hold(leg(MAIN, "footZ"), SEATED_FOOT_Z[0]),
  hold(leg(OTHER, "footZ"), SEATED_FOOT_Z[1]),
];

const lapArms = (): TrackSpec[] => [...bothArms("swing", (channel) => hold(channel, LAP_SWING)), ...bothArms("elbow", (channel) => hold(channel, LAP_ELBOW))];

const BUY: ClipSpec = {
  blendIn: 0.3,
  blendOut: 0.35,
  tracks: [
    track(arm(MAIN, "hand"), 0, 0, 0.35, 0, 0.85, 1, 1.4, 1, 1.85, 0),
    hold(arm(MAIN, "handZ"), 0.5),
    { ...hold(arm(MAIN, "handY"), 0.08), aboveSurface: true },
    track(arm(OTHER, "hand"), 0, 0, 2.05, 0, 2.5, 1, 2.85, 1, 3.2, 0),
    hold(arm(OTHER, "handZ"), 0.46),
    { ...hold(arm(OTHER, "handY"), 0.14), aboveSurface: true },
    hold(arm(MAIN, "swing"), -0.15),
    hold(arm(MAIN, "elbow"), -0.5),
    hold(arm(OTHER, "swing"), -0.1),
    hold(arm(OTHER, "elbow"), -0.4),
    track(CHANNEL.torsoPitch, 0, 0, 0.5, 0.1, 1, 0.14, 1.6, 0.06, 2.3, 0.12, 2.7, 0.1, 3.2, 0),
    track(CHANNEL.headPitch, 0, 0, 0.5, 0.25, 1.6, 0.1, 2.5, 0.3, 3, 0.12),
  ],
};

const DOOR: ClipSpec = {
  blendIn: 0.25,
  blendOut: 0.4,
  tracks: [
    track(arm(MAIN, "hand"), 0, 0, 0.3, 0, 0.65, 1, 1.2, 1, 1.55, 0),
    track(arm(MAIN, "handZ"), 0, 0.5, 0.65, 0.5, 0.9, 0.62),
    hold(arm(MAIN, "handY"), 1),
    track(CHANNEL.torsoPitch, 0, 0, 0.65, 0.08, 0.9, 0.16, 1.3, 0.06, 1.8, 0),
    track(CHANNEL.torsoTwist, 0, 0, 0.9, -0.12, 1.8, 0),
  ],
};

const SIT_DOWN: ClipSpec = {
  blendIn: 0.2,
  blendOut: 0,
  tracks: [
    track(CHANNEL.seat, 0, 0, 0.2, 0, 1, 1),
    track(CHANNEL.plant, 0, 0, 0.2, 1),
    track(leg(MAIN, "footZ"), 0, 0, 0.2, 0, 1, SEATED_FOOT_Z[0]),
    track(leg(OTHER, "footZ"), 0, 0, 0.2, 0, 1, SEATED_FOOT_Z[1]),
    track(CHANNEL.torsoPitch, 0, 0, 0.3, 0.06, 0.55, 0.32, 1, SEATED_PITCH),
    track(CHANNEL.headPitch, 0, 0, 0.55, 0.15, 1, 0),
    track(CHANNEL.lookAtPartner, 0, 0, 1, SEATED_LOOK),
    ...bothArms("swing", (channel) => track(channel, 0, 0, 0.5, -0.2, 1, LAP_SWING)),
    ...bothArms("elbow", (channel) => track(channel, 0, ARM_REST_ELBOW, 1, LAP_ELBOW)),
  ],
};

const SIT: ClipSpec = {
  blendIn: 0,
  blendOut: 0,
  tracks: [
    ...seated(),
    ...lapArms(),
    loop(CHANNEL.torsoPitch, 9, 0, SEATED_PITCH, 4, SEATED_PITCH, 5, 0.1, 7, 0.1, 8, SEATED_PITCH, 9, SEATED_PITCH),
    loop(CHANNEL.headYaw, 7, 0, 0, 1.5, 0, 2.2, 0.3, 3.4, 0.3, 4.2, -0.2, 5.4, -0.2, 6.2, 0, 7, 0),
    loop(CHANNEL.headPitch, 5, 0, 0, 2, 0.08, 3, 0.08, 5, 0),
    hold(CHANNEL.lookAtPartner, SEATED_LOOK),
  ],
};

const STAND_UP: ClipSpec = {
  blendIn: 0,
  blendOut: 0.25,
  tracks: [
    track(CHANNEL.seat, 0, 1, 0.25, 1, 0.85, 0),
    hold(CHANNEL.plant, 1),
    track(leg(MAIN, "footZ"), 0, SEATED_FOOT_Z[0], 0.25, SEATED_FOOT_Z[0], 0.85, 0),
    track(leg(OTHER, "footZ"), 0, SEATED_FOOT_Z[1], 0.25, SEATED_FOOT_Z[1], 0.85, 0),
    track(CHANNEL.torsoPitch, 0, SEATED_PITCH, 0.25, 0.3, 0.7, 0.18, 1.1, 0),
    track(CHANNEL.headPitch, 0, 0, 0.3, 0.1, 0.8, 0),
    track(CHANNEL.lookAtPartner, 0, SEATED_LOOK, 0.4, 0),
    ...bothArms("swing", (channel) => track(channel, 0, LAP_SWING, 0.4, -0.1, 1.1, 0)),
    ...bothArms("elbow", (channel) => track(channel, 0, LAP_ELBOW, 0.4, -0.4, 1.1, ARM_REST_ELBOW)),
  ],
};

const LEANING_ARM_SWING = -0.6;
const LEANING_ARM_ELBOW = -1.55;
const SIT_STEPS: ClipSpec = {
  blendIn: 0,
  blendOut: 0,
  tracks: [
    ...seated(),
    loop(CHANNEL.torsoPitch, 12, 0, SEATED_PITCH, 2, SEATED_PITCH, 3.5, 0.38, 10, 0.38, 11, SEATED_PITCH, 12, SEATED_PITCH),
    ...bothArms("swing", (channel) => loop(channel, 12, 0, LAP_SWING, 2, LAP_SWING, 3.5, LEANING_ARM_SWING, 10, LEANING_ARM_SWING, 11, LAP_SWING, 12, LAP_SWING)),
    ...bothArms("elbow", (channel) => loop(channel, 12, 0, LAP_ELBOW, 2, LAP_ELBOW, 3.5, LEANING_ARM_ELBOW, 10, LEANING_ARM_ELBOW, 11, LAP_ELBOW, 12, LAP_ELBOW)),
    loop(CHANNEL.headPitch, 12, 0, 0, 3.5, -0.2, 10, -0.2, 11, 0, 12, 0),
    loop(CHANNEL.headYaw, 9, 0, 0, 2, 0, 3, 0.3, 5, 0.3, 6, -0.2, 7.5, -0.2, 8.5, 0, 9, 0),
    hold(CHANNEL.lookAtPartner, SEATED_LOOK),
  ],
};

const BUMP: ClipSpec = {
  blendIn: 0.06,
  blendOut: 0.3,
  side: "partner",
  tracks: [
    track(CHANNEL.torsoPitch, 0, 0, 0.12, -0.18, 0.4, 0.08, 0.7, 0),
    track(CHANNEL.torsoTwist, 0, 0, 0.12, -0.55, 0.45, -0.2, 0.7, 0),
    track(CHANNEL.torsoRoll, 0, 0, 0.12, -0.2, 0.45, -0.05, 0.7, 0),
    track(CHANNEL.pelvisSide, 0, 0, 0.12, -0.1, 0.45, -0.04, 0.7, 0),
    track(CHANNEL.pelvisForward, 0, 0, 0.12, -0.06, 0.7, 0),
    track(CHANNEL.headYaw, 0, 0, 0.12, 0.45, 0.45, 0.3, 0.7, 0),
    track(arm(MAIN, "swing"), 0, 0, 0.12, -1, 0.45, -0.4, 0.7, -0.1),
    track(arm(MAIN, "out"), 0, 0.05, 0.12, 0.6, 0.45, 0.3, 0.7, 0.05),
    track(arm(MAIN, "elbow"), 0, ARM_REST_ELBOW, 0.12, -0.5, 0.45, -0.6, 0.7, ARM_REST_ELBOW),
    track(arm(OTHER, "swing"), 0, 0, 0.12, -0.4, 0.45, -0.2, 0.7, 0),
    track(arm(OTHER, "out"), 0, 0.05, 0.12, 0.9, 0.45, 0.3, 0.7, 0.05),
    track(arm(OTHER, "elbow"), 0, ARM_REST_ELBOW, 0.12, -0.3, 0.7, ARM_REST_ELBOW),
    track(leg(MAIN, "swing"), 0, 0, 0.12, -0.45, 0.4, -0.1, 0.7, 0),
    track(leg(MAIN, "knee"), 0, 0, 0.12, 0.5, 0.4, 0.1, 0.7, 0),
    track(leg(OTHER, "swing"), 0, 0, 0.12, 0.3, 0.7, 0),
  ],
};

const FIST_GUARD_SWING = -1;
const FIST_GUARD_ELBOW = -2;
const SWING: ClipSpec = {
  blendIn: 0.1,
  blendOut: 0.2,
  side: "partner",
  tracks: [
    track(arm(MAIN, "hand"), 0, 0, 0.2, 0, 0.3, 1, 0.42, 1, 0.55, 0),
    hold(arm(MAIN, "handZ"), 0.95),
    hold(arm(MAIN, "handY"), 1.47),
    track(arm(MAIN, "swing"), 0, FIST_GUARD_SWING, 0.18, 0.35, 0.6, FIST_GUARD_SWING),
    track(arm(MAIN, "elbow"), 0, FIST_GUARD_ELBOW, 0.18, -1.9, 0.6, FIST_GUARD_ELBOW),
    track(arm(OTHER, "swing"), 0, -1.1, 0.3, -1.2, 0.6, -1.1),
    hold(arm(OTHER, "elbow"), -2.1),
    track(CHANNEL.torsoTwist, 0, 0, 0.18, 0.5, 0.3, -0.55, 0.6, 0.1),
    track(CHANNEL.pelvisForward, 0, 0, 0.18, -0.04, 0.3, 0.14, 0.6, 0),
    track(CHANNEL.torsoPitch, 0, 0.06, 0.3, 0.16, 0.6, 0.06),
    hold(CHANNEL.headPitch, 0.1),
    track(CHANNEL.plant, 0, 0, 0.1, 1),
    hold(CHANNEL.pelvisDrop, 0.05),
    hold(leg(MAIN, "footZ"), -0.18),
    hold(leg(OTHER, "footZ"), 0.22),
  ],
};

const BLOCK: ClipSpec = {
  blendIn: 0.15,
  blendOut: 0.25,
  side: "partner",
  tracks: [
    ...bothArms("swing", (channel) => hold(channel, -1.15)),
    ...bothArms("elbow", (channel) => hold(channel, -2.2)),
    loop(CHANNEL.torsoPitch, 1.6, 0, 0.18, 0.3, 0.26, 0.8, 0.18, 1.6, 0.18),
    loop(CHANNEL.torsoRoll, 2.2, 0, 0, 1.1, 0.06, 2.2, 0),
    hold(CHANNEL.headPitch, 0.25),
    hold(CHANNEL.pelvisDrop, 0.06),
    hold(CHANNEL.plant, 1),
    hold(leg(MAIN, "footZ"), -0.16),
    hold(leg(OTHER, "footZ"), 0.2),
  ],
};

const HIT: ClipSpec = {
  blendIn: 0.04,
  blendOut: 0.4,
  side: "partner",
  tracks: [
    track(CHANNEL.headYaw, 0, 0, 0.1, -0.95, 0.45, -0.7, 0.9, 0),
    track(CHANNEL.headPitch, 0, 0, 0.1, -0.25, 0.5, 0.2, 0.9, 0),
    track(CHANNEL.torsoPitch, 0, 0, 0.12, -0.3, 0.45, 0.28, 0.9, 0),
    track(CHANNEL.torsoTwist, 0, 0, 0.12, -0.45, 0.5, -0.2, 0.9, 0),
    track(CHANNEL.torsoRoll, 0, 0, 0.12, -0.2, 0.6, -0.1, 0.9, 0),
    track(CHANNEL.pelvisForward, 0, 0, 0.12, -0.1, 0.5, -0.03, 0.9, 0),
    track(CHANNEL.pelvisDrop, 0, 0, 0.12, 0.04, 0.5, 0.09, 0.9, 0),
    track(CHANNEL.plant, 0, 0, 0.1, 1, 0.75, 1, 0.9, 0),
    track(leg(MAIN, "footZ"), 0, 0, 0.12, -0.15, 0.9, 0),
    track(leg(OTHER, "footZ"), 0, 0, 0.12, 0.12, 0.9, 0),
    track(arm(MAIN, "hand"), 0, 0, 0.15, 0, 0.4, 1, 0.75, 1, 0.9, 0),
    hold(arm(MAIN, "handZ"), 0.4),
    hold(arm(MAIN, "handY"), 1.52),
    track(arm(MAIN, "swing"), 0, 0, 0.1, -0.4, 0.35, -1),
    track(arm(MAIN, "out"), 0, 0.05, 0.1, 0.8, 0.35, 0.2),
    track(arm(MAIN, "elbow"), 0, ARM_REST_ELBOW, 0.35, -1.2),
    track(arm(OTHER, "swing"), 0, 0, 0.1, 0.5, 0.5, 0.1, 0.9, 0),
    track(arm(OTHER, "out"), 0, 0.05, 0.1, 0.9, 0.5, 0.2, 0.9, 0.05),
  ],
};

const TALK: ClipSpec = {
  blendIn: 0.3,
  blendOut: 0.4,
  tracks: [
    loop(arm(MAIN, "elbow"), 3.4, 0, ARM_REST_ELBOW, 0.7, ARM_REST_ELBOW, 1.2, -1.5, 1.6, -1.1, 2, -1.5, 2.5, -1.5, 3, ARM_REST_ELBOW, 3.4, ARM_REST_ELBOW),
    loop(arm(MAIN, "swing"), 3.4, 0, 0, 0.7, 0, 1.2, -0.75, 1.6, -0.9, 2, -0.75, 2.5, -0.7, 3, 0, 3.4, 0),
    loop(arm(MAIN, "out"), 3.4, 0, 0.05, 1.2, 0.4, 2, 0.4, 3, 0.05, 3.4, 0.05),
    loop(arm(OTHER, "elbow"), 4.7, 0, ARM_REST_ELBOW, 1.5, ARM_REST_ELBOW, 2, -1.3, 2.5, -1, 3.1, -1.3, 3.6, ARM_REST_ELBOW, 4.7, ARM_REST_ELBOW),
    loop(arm(OTHER, "swing"), 4.7, 0, 0, 1.5, 0, 2, -0.6, 2.5, -0.8, 3.1, -0.6, 3.6, 0, 4.7, 0),
    loop(CHANNEL.headPitch, 2.6, 0, 0, 0.5, 0.12, 1, -0.02, 1.5, 0.1, 2.6, 0),
    loop(CHANNEL.torsoPitch, 5.1, 0, 0, 2, 0.05, 5.1, 0),
    hold(CHANNEL.lookAtPartner, 0.9),
  ],
};

const IDLE: ClipSpec = {
  blendIn: 0.3,
  blendOut: 0.4,
  tracks: [
    loop(CHANNEL.pelvisSide, 7.3, 0, 0, 2, 0.02, 3.5, 0.02, 5.3, -0.015, 7.3, 0),
    loop(CHANNEL.torsoRoll, 7.3, 0, 0, 2, -0.04, 3.5, -0.04, 5.3, 0.03, 7.3, 0),
    loop(leg(OTHER, "knee"), 7.3, 0, 0, 2, 0.12, 3.5, 0.12, 5.3, 0, 7.3, 0),
    loop(CHANNEL.headYaw, 8.9, 0, 0, 2, 0, 2.8, 0.5, 4.2, 0.5, 5, -0.35, 6.2, -0.35, 7, 0, 8.9, 0),
    loop(CHANNEL.headPitch, 6.1, 0, 0, 3, 0.06, 6.1, 0),
    loop(arm(MAIN, "hand"), 14, 0, 0, 9, 0, 10, 1, 11.5, 1, 12.5, 0, 14, 0),
    hold(arm(MAIN, "handZ"), 0.1),
    hold(arm(MAIN, "handY"), 1.66),
  ],
};

/** Cuffed, hands behind her back: each upper arm swung back and out, turned in about its length so the bent forearm crosses behind her (rad). */
const CUFFED_SWING = 0.5;
const CUFFED_OUT = 0.15;
const CUFFED_TWIST = -Math.PI / 2;
const CUFFED_ELBOW = -0.9;
/** A cuffed head hangs this far forward (rad). */
const CUFFED_HEAD = 0.3;
/** Where the cuffed pose puts her +x wrist (m, her body frame; the -x one mirrored): the cop's hold reaches for it. */
const CUFFED_WRIST = { y: 0.93, z: -0.215 } as const;
/** Where the escorting cop's hand holds her cuffed +x upper arm, on its back just over the elbow (m, her body frame). */
const CUFFED_GRIP = { y: 1.15, z: -0.16 } as const;

const cuffedArms = (): TrackSpec[] => [
  ...bothArms("swing", (channel) => hold(channel, CUFFED_SWING)),
  ...bothArms("out", (channel) => hold(channel, CUFFED_OUT)),
  ...bothArms("twist", (channel) => hold(channel, CUFFED_TWIST)),
  ...bothArms("elbow", (channel) => hold(channel, CUFFED_ELBOW)),
];

/** One arm taken behind her back from hanging, starting at `from` s: swung back first so the hand clears the thigh, then turned in and bent. */
const armCuffedFrom = (group: number, from: number): TrackSpec[] => [
  track(arm(group, "swing"), 0, 0, from, 0, from + 0.3, CUFFED_SWING),
  track(arm(group, "out"), 0, 0.05, from, 0.05, from + 0.3, CUFFED_OUT),
  track(arm(group, "twist"), 0, 0, from + 0.2, 0, from + 0.55, CUFFED_TWIST),
  track(arm(group, "elbow"), 0, 0, from + 0.2, 0, from + 0.55, CUFFED_ELBOW),
];

const CUFFING: ClipSpec = {
  blendIn: 0.15,
  blendOut: 0,
  tracks: [...armCuffedFrom(MAIN, 0.15), ...armCuffedFrom(OTHER, 0.6), track(CHANNEL.torsoPitch, 0, 0, 0.3, 0.1, 1.1, 0), track(CHANNEL.headPitch, 0, 0, 0.4, 0.15, 1.1, CUFFED_HEAD)],
};

const CUFFED: ClipSpec = {
  blendIn: 0,
  blendOut: 0.3,
  tracks: [...cuffedArms(), hold(CHANNEL.headPitch, CUFFED_HEAD), loop(CHANNEL.headYaw, 6.4, 0, 0, 2, 0, 2.8, 0.25, 4, 0.25, 4.8, 0, 6.4, 0)],
};

/** The cop behind her works the cuffs: both hands on her wrists, his main one turning them. */
const ARRESTING: ClipSpec = {
  blendIn: 0.25,
  blendOut: 0.3,
  tracks: [
    ...bothArms("hand", (channel) => track(channel, 0, 0, 0.1, 0, 0.45, 1)),
    ...bothArms("handZ", (channel) => hold(channel, ARREST.cuffBehind + CUFFED_WRIST.z)),
    track(arm(MAIN, "handY"), 0, CUFFED_WRIST.y, 0.6, CUFFED_WRIST.y, 0.8, CUFFED_WRIST.y - 0.03, 1, CUFFED_WRIST.y + 0.02, 1.2, CUFFED_WRIST.y),
    hold(arm(OTHER, "handY"), CUFFED_WRIST.y),
    track(CHANNEL.torsoPitch, 0, 0, 0.45, 0.15),
    track(CHANNEL.headPitch, 0, 0, 0.45, 0.4),
  ],
};

/** The cop walks her off: his right hand on the back of her left upper arm, a glance at her now and then. */
const ESCORTING: ClipSpec = {
  blendIn: 0.4,
  blendOut: 0.3,
  side: "right",
  tracks: [
    hold(arm(MAIN, "hand"), 1),
    hold(arm(MAIN, "handZ"), ARREST.escortAhead + CUFFED_GRIP.z),
    hold(arm(MAIN, "handY"), CUFFED_GRIP.y),
    loop(CHANNEL.headYaw, 5.2, 0, 0.15, 2, 0.15, 2.6, 0.45, 3.6, 0.45, 4.2, 0.15, 5.2, 0.15),
  ],
};

/** Seated, she has stepped `SEAT_FORWARD` toward the car and `SEAT_ASIDE` to her left of the door spot, turned `TURN_TO_FRONT` to face the car's nose. */
const SEAT_FORWARD = CAR_DOOR.outFromSeat;
const SEAT_ASIDE = DRIVER_SIDE * CAR_DOOR.behindSeat;
const TURN_TO_FRONT = DRIVER_SIDE * (Math.PI / 2);
/** She steps back this far (m) from the door as it swings out past her. */
const STEP_BACK = -0.35;
/** She ducks under the door frame, head and back (rad). */
const DUCK_PITCH = 0.4;
const DUCK_HEAD = 0.2;
const bothFeet = (field: keyof typeof LEG, ...pairs: number[]): TrackSpec[] => [track(leg(MAIN, field), ...pairs), track(leg(OTHER, field), ...pairs)];

/** Into the car by the driver's door: a hand on the handle as it opens, a step back, in and round and down, a hand on the inner handle to pull it shut. She stands still at the door spot until the step in. */
const CAR_IN: ClipSpec = {
  blendIn: 0.25,
  blendOut: 0,
  tracks: [
    track(CHANNEL.reachOutsideHandle, 0, 0, 0.25, 1, 0.85, 1, 1, 0),
    track(CHANNEL.reachInsideHandle, 0, 0, 2, 0, 2.2, 1, 2.6, 1),
    track(CHANNEL.shiftForward, 0, 0, 0.3, 0, 0.9, STEP_BACK, 1.05, STEP_BACK, 1.75, SEAT_FORWARD),
    track(CHANNEL.shiftSide, 0, 0, 1.05, 0, 1.75, SEAT_ASIDE),
    track(CHANNEL.bodyYaw, 0, 0, 1.05, 0, 1.6, TURN_TO_FRONT),
    track(CHANNEL.seat, 0, 0, 1.3, 0, 1.9, 1),
    track(CHANNEL.plant, 0, 0, 1.2, 0, 1.5, 1),
    ...bothFeet("footZ", 0, 0, 1.2, 0, 1.6, CAR_DOOR.footAhead),
    track(CHANNEL.footRaise, 0, 0, 1.4, 0, 1.9, CAR_DOOR.floorRise),
    track(CHANNEL.torsoPitch, 0, 0, 0.25, 0.08, 1.05, 0.1, 1.3, DUCK_PITCH, 1.7, DUCK_PITCH, 2, SEATED_PITCH, 2.6, SEATED_PITCH),
    track(CHANNEL.headPitch, 0, 0, 1.3, DUCK_HEAD, 1.7, DUCK_HEAD, 2, 0),
    ...bothArms("swing", (channel) => track(channel, 0, 0, 1.6, 0, 2, LAP_SWING)),
    ...bothArms("elbow", (channel) => track(channel, 0, 0, 1.6, 0, 2, LAP_ELBOW)),
  ],
};

/** Out of the car: a hand on the inner handle pushes the door open, up and round and out, a hand on the outer panel shoves it shut. She starts seated and ends standing at the door spot. */
const CAR_OUT: ClipSpec = {
  blendIn: 0,
  blendOut: 0.3,
  tracks: [
    track(CHANNEL.reachInsideHandle, 0, 0, 0.3, 1, 0.75, 1, 0.95, 0),
    track(CHANNEL.reachOutsidePanel, 0, 0, 1.5, 0, 1.7, 1, 2.1, 1, 2.3, 0),
    track(CHANNEL.shiftForward, 0, SEAT_FORWARD, 0.8, SEAT_FORWARD, 1.5, 0),
    track(CHANNEL.shiftSide, 0, SEAT_ASIDE, 0.8, SEAT_ASIDE, 1.5, 0),
    track(CHANNEL.bodyYaw, 0, TURN_TO_FRONT, 0.7, TURN_TO_FRONT, 1.3, 0),
    track(CHANNEL.seat, 0, 1, 0.85, 1, 1.4, 0),
    track(CHANNEL.plant, 0, 1, 1.2, 1, 1.5, 0),
    ...bothFeet("footZ", 0, CAR_DOOR.footAhead, 0.9, CAR_DOOR.footAhead, 1.4, 0),
    track(CHANNEL.footRaise, 0, CAR_DOOR.floorRise, 0.9, CAR_DOOR.floorRise, 1.4, 0),
    track(CHANNEL.torsoPitch, 0, SEATED_PITCH, 0.8, SEATED_PITCH, 1.1, DUCK_PITCH, 1.4, 0.3, 1.8, 0.05, 2.4, 0),
    track(CHANNEL.headPitch, 0, 0, 1.1, DUCK_HEAD, 1.5, 0, 2.4, 0),
    ...bothArms("swing", (channel) => track(channel, 0, LAP_SWING, 0.9, LAP_SWING, 1.5, 0)),
    ...bothArms("elbow", (channel) => track(channel, 0, LAP_ELBOW, 0.9, LAP_ELBOW, 1.5, 0)),
  ],
};

/** The phone held at her ear: the fingertip beside the temple (m, her frame: out from the middle line, up, ahead), the other forearm across her waist (rad). */
const EAR = { out: 0.14, up: 1.62, ahead: 0.02 } as const;
const WAIST_SWING = -0.45;
const WAIST_ELBOW = -1.5;

/** Standing on the phone: the main hand to her ear, the other arm across her waist, a glance at what she is calling about now and then. */
const PHONE_CALL: ClipSpec = {
  blendIn: 0.5,
  blendOut: 0.4,
  tracks: [
    hold(arm(MAIN, "hand"), 1),
    hold(arm(MAIN, "handOut"), EAR.out),
    hold(arm(MAIN, "handY"), EAR.up),
    hold(arm(MAIN, "handZ"), EAR.ahead),
    hold(arm(OTHER, "swing"), WAIST_SWING),
    hold(arm(OTHER, "elbow"), WAIST_ELBOW),
    loop(CHANNEL.headPitch, 4.5, 0, 0.05, 2, 0.14, 3.5, 0.05, 4.5, 0.05),
    loop(CHANNEL.headYaw, 6.1, 0, 0, 2, 0.1, 4, -0.1, 6.1, 0),
    hold(CHANNEL.lookAtPartner, 0.6),
  ],
};

/** Down on one knee beside a person on the ground: the near foot ahead and flat, the far knee on the ground, leaning over them, the near hand on them (m, her frame), the other forearm on her knee. */
const KNEEL_DROP = 0.4;
const KNEEL_FEET = { near: 0.32, far: -0.5 } as const;
const KNEEL_LEAN = 0.35;
const KNEEL_HAND = { out: 0.1, up: 0.5, ahead: 0.4 } as const;
const KNEEL: ClipSpec = {
  blendIn: 0.7,
  blendOut: 0.7,
  side: "partner",
  tracks: [
    hold(CHANNEL.pelvisDrop, KNEEL_DROP),
    hold(CHANNEL.pelvisForward, 0.1),
    hold(CHANNEL.plant, 1),
    hold(leg(MAIN, "footZ"), KNEEL_FEET.near),
    hold(leg(OTHER, "footZ"), KNEEL_FEET.far),
    loop(CHANNEL.torsoPitch, 5, 0, KNEEL_LEAN, 2.5, KNEEL_LEAN + 0.06, 5, KNEEL_LEAN),
    hold(CHANNEL.headPitch, 0.25),
    hold(arm(MAIN, "hand"), 1),
    hold(arm(MAIN, "handOut"), KNEEL_HAND.out),
    hold(arm(MAIN, "handY"), KNEEL_HAND.up),
    hold(arm(MAIN, "handZ"), KNEEL_HAND.ahead),
    hold(arm(OTHER, "swing"), -0.5),
    hold(arm(OTHER, "elbow"), -0.9),
    hold(CHANNEL.lookAtPartner, 1),
  ],
};

/** A flinch from a danger: back and up on her heels, both hands up and open, the head round to it, the arm nearest it highest. */
const RECOIL: ClipSpec = {
  blendIn: 0.08,
  blendOut: 0.3,
  side: "partner",
  tracks: [
    ...bothArms("hand", (channel) => track(channel, 0, 0, 0.18, 1, 0.6, 1, 0.9, 0)),
    hold(arm(MAIN, "handY"), 1.4),
    hold(arm(OTHER, "handY"), 1.25),
    hold(arm(MAIN, "handZ"), 0.3),
    hold(arm(OTHER, "handZ"), 0.25),
    hold(arm(MAIN, "handOut"), 0.3),
    hold(arm(OTHER, "handOut"), 0.28),
    track(CHANNEL.torsoPitch, 0, 0, 0.2, -0.28, 0.6, -0.15, 0.9, 0),
    track(CHANNEL.headPitch, 0, 0, 0.2, 0.2, 0.9, 0),
    track(CHANNEL.pelvisForward, 0, 0, 0.2, -0.12, 0.9, 0),
    track(CHANNEL.lookAtPartner, 0, 0, 0.15, 1, 0.7, 1, 0.9, 0),
  ],
};

export const CLIPS: Readonly<Partial<Record<ActivityName, ClipSpec>>> = {
  idle: IDLE,
  talk: TALK,
  buy: BUY,
  door: DOOR,
  sitDown: SIT_DOWN,
  sit: SIT,
  standUp: STAND_UP,
  bump: BUMP,
  swing: SWING,
  block: BLOCK,
  hit: HIT,
  sitSteps: SIT_STEPS,
  cuffing: CUFFING,
  cuffed: CUFFED,
  arresting: ARRESTING,
  escorting: ESCORTING,
  carIn: CAR_IN,
  carOut: CAR_OUT,
  phoneCall: PHONE_CALL,
  kneel: KNEEL,
  recoil: RECOIL,
};
