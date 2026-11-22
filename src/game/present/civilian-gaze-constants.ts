import { FAR_DRAW } from "./civilian-art-constants.ts";

/** What a person can look at: a stimulus table row's kind, and what her current look is on. Codes are stable (the Mind lane reads them). */
export const STIMULUS = { none: 0, player: 1, car: 2, siren: 3, crash: 4, knock: 5, gunshot: 6, down: 7, attend: 8, partner: 9, person: 10, glance: 11 } as const;
export type StimulusKind = (typeof STIMULUS)[keyof typeof STIMULUS];
const KINDS = 12;

/** Rows in the stimulus table, and how many of them lingering pulses may hold. */
export const STIMULUS_CAPACITY = 64;
export const PULSE_CAPACITY = 16;

/** A person re-chooses what to look at every 8 frames, offset by her index (reVC `LookForInterestingNodes`: `(frame + seed) & 7`). */
export const POLL_MASK = 7;
/** No new look is taken for this long after one ends (reVC `ClearLookFlag`, 4000 ms for a ped). */
export const LOOK_COOLDOWN_S = 4;
/** A look this urgent ignores the cooldown (tuned by feel: a crash, a car coming at her). */
export const COOLDOWN_BYPASS = 0.6;
/** A new look must beat the current one's urgency by this to cut it short (tuned by feel: heads don't flick between equals). */
export const PREEMPT_MARGIN = 0.15;
/** Below this urgency a sensed thing is not looked at (tuned by feel). */
export const NOTICE_FLOOR = 0.2;

const DEG = Math.PI / 180;
/** reVC's ped runs its look IK once a frame at 30 fps (`PedIK.cpp`): its per-frame rates are per this many seconds. */
const REVC_FPS = 30;
/** Head yaw +-90 deg, pitch +-45 deg, torso yaw +-50 deg (reVC `PedIK.cpp:10-11`). */
export const HEAD_YAW_LIMIT = 90 * DEG;
export const PITCH_LIMIT = 45 * DEG;
export const TORSO_YAW_LIMIT = 50 * DEG;
/** The torso helps past this head turn (rad): the near rig's comfortable head turn (`LOOK_LIMIT` in civilian-anim.ts). */
export const TORSO_JOIN = 1.1;
/** Top angular speeds (rad/s): reVC's 15 deg a frame of head yaw and 8 of pitch and torso. */
export const HEAD_YAW_RATE = 15 * DEG * REVC_FPS;
export const PITCH_RATE = 8 * DEG * REVC_FPS;
export const TORSO_RATE = 8 * DEG * REVC_FPS;
/** Critically damped ease (1/s): eases in and out with a peak speed growing with the amplitude (Andrist 2012); a 60 deg turn settles in about 0.4 s (tuned by feel). */
export const HEAD_OMEGA = 10;
export const TORSO_OMEGA = 5;
/** The head starts this long after a look is chosen: the eyes lead the head by about 67 ms (`.extraResearch/crowd-senses-and-gaze.md`, LEAD). */
export const HEAD_LATENCY_S = 0.067;
/** Andrist's head alignment: from this share to all of the turn, by the look word's bits; narrow because the dummies' eyes are painted and cannot take the rest. */
export const HEAD_ALIGN_MIN = 0.75;
/** The look word bits that pick it: 26-28 of its hash, which no other trait reads (pace 12-18, amplitude 19-25). */
export const ALIGN_SHIFT = 26;
export const ALIGN_MASK = 7;

/** In sight: no further than 90 deg off straight ahead (tuned by feel). */
export const FOV_COS = 0;
/** Closer than this (m) she senses a thing whichever way she faces. */
export const TOUCH_M = 1.5;
/** Lines of sight tested a frame at most, and how near (m) a thing is seen without one: the port walks a building grid, so it is budgeted (tuned by feel). */
export const LOS_PER_FRAME = 6;
export const LOS_FREE_M = 3;
/** Nobody past the far figures' range is sensed or turned: they are not drawn (m). */
export const GAZE_RANGE_M = FAR_DRAW;

/** Her eyes over her feet (m), and where she looks on another person: the face (reVC looks at `PED_MID`; a face reads better up close). */
export const EYE_HEIGHT_M = 1.6;
export const FACE_HEIGHT_M = 1.55;
/** A car is looked at this high (m) over its origin: its cabin. */
export const CAR_LOOK_HEIGHT_M = 0.7;

/** Ordinary town speed (m/s) draws nothing and this fast or faster draws full interest: 'just driving on the street shouldn't make every person go whaat' (owner, tuned by feel). */
export const CAR_CALM_SPEED = 9;
export const CAR_FAST_SPEED = 20;
/** Slower cars (m/s) are not in the table unless their siren is on. */
export const CAR_NOTICE_MIN_SPEED = 4;
/** A car closing faster than this (m/s), due within `CAR_COMING_S`, on a path passing within the brain's `DANGER_MISS_METRES` of her, is coming at her. */
export const CAR_COMING_SPEED = 3;
export const CAR_COMING_S = 2;
export const CAR_MISS_M = 1.8;
export const CAR_COMING_URGENCY = 0.75;
/** Any car past this speed (m/s) brushing by within `CAR_BRUSH_M` draws a glance (reVC: a car bumping a ped is looked at for 500-1300 ms). */
export const CAR_BRUSH_M = 3;
export const CAR_BRUSH_SPEED = 5;
export const CAR_BRUSH_URGENCY = 0.4;
export const SIREN_URGENCY = 0.5;
/** The player on foot: how much he draws, and on what share of polls she notices him (most people don't stare: tuned by feel); within `PERSONAL_M` always. */
export const PLAYER_URGENCY = 0.45;
export const PLAYER_NOTICE_SHARE = 0.1;
export const PERSONAL_M = 2.5;
/** Someone down in sight (Hitman's crowd looks at a point of interest). */
export const DOWN_URGENCY = 0.55;
/** A passer-by within `PASSER_M` ahead, glanced at on `PASSER_SHARE` of polls (tuned by feel). */
export const PASSER_M = 4;
export const PASSER_AHEAD_COS = 0.5;
export const PASSER_URGENCY = 0.25;
export const PASSER_SHARE = 0.15;
/** An idle glance on this share of free polls: about one every 4 s at 7.5 polls a second (tuned by feel), half as often beside a partner. */
export const GLANCE_SHARE = 0.035;
export const PARTNER_GLANCE_FACTOR = 0.5;
export const GLANCE_URGENCY = 0.1;
/** A shop window or sign within this (m) is a glance's first choice (reVC: an attractor within 8 m). */
export const ATTRACT_M = 8;
/** A glance with no attractor lands this far off (m), up to this far (rad) from ahead, on the sky, the street or the ground (tuned by feel). */
export const GLANCE_DISTANCE_M = 10;
export const GLANCE_YAW = 1.2;
export const SKY_PITCH = -0.45;
export const GROUND_PITCH = 0.35;
export const SKY_SHARE = 0.3;
export const GROUND_SHARE = 0.2;
/** Walking, the head drops this much (rad, down positive) toward the path ahead (tuned by feel). */
export const WALK_LOOK_DOWN = 0.08;
/** A pulse turns a share of heads from this floor to all by neuroticism (the brain's `NEURO_REACT_FLOOR` 0.2 raised: a glance costs less than an alarm), less when it is behind them. */
export const REACT_FLOOR = 0.6;
export const HEARD_SHARE = 0.7;

function kindTable(values: Partial<Record<keyof typeof STIMULUS, number>>): Float32Array {
  const table = new Float32Array(KINDS);
  for (const [name, value] of Object.entries(values)) table[STIMULUS[name as keyof typeof STIMULUS]] = value;
  return table;
}

/** How far (m) each kind is sensed: the player 10 m (reVC's ped look), a car 25, sounds further. */
export const KIND_RANGE = kindTable({ player: 10, car: 25, siren: 60, crash: 40, knock: 30, gunshot: 60, down: 15 });
/** Looks last `KIND_HOLD_MIN` + up to `KIND_HOLD_SPAN` s (0.5-4 s: reVC's 500-4000 ms looks). */
export const KIND_HOLD_MIN = kindTable({ player: 1.2, car: 0.8, siren: 1.5, crash: 2, knock: 2, gunshot: 1, down: 2, person: 0.5, glance: 0.6 });
export const KIND_HOLD_SPAN = kindTable({ player: 1.8, car: 1.7, siren: 1.5, crash: 2, knock: 2, gunshot: 1.5, down: 2, person: 1, glance: 1.2 });
/** A pulse lingers in the table this long (s), still drawing looks as it fades (tuned by feel; someone down stays for the brain's ambulance wait). */
export const KIND_LIFE = kindTable({ crash: 8, knock: 6, gunshot: 3, down: 30 });
/** Kinds only seen, never heard: the line of sight is asked for them. */
export const SEEN_ONLY = Uint8Array.from({ length: KINDS }, (_, kind) => (kind === STIMULUS.player || kind === STIMULUS.car || kind === STIMULUS.down || kind === STIMULUS.person ? 1 : 0));

/** Words for the look panel, by kind. */
export const LOOK_WORDS: readonly string[] = ["ahead", "you", "a car", "a siren", "the crash", "the knock", "the shot", "someone down", "something", "the one she is with", "a passer-by", "around"];

/** 16 hashed bits of (a, b) as an int: the local draws of gaze, a pure function so every frame of a person agrees. */
export function hash16(a: number, b: number): number {
  let h = Math.imul(a ^ 0x2545f491, 0x85ebca6b) ^ Math.imul(b + 0x68e31da4, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 8) & 0xffff;
}
/** `hash16`'s range: a share `s` passes when the hash is under `s * HASH16`. */
export const HASH16 = 65536;

/** Slots of a gaze's `scratch` (doubles cross calls through it, never as arguments: a boxed double allocates). */
export const SCRATCH = { x: 0, y: 1, z: 2, urgency: 3, distance: 4, hold: 5, delay: 6, trial: 7, ownX: 8, ownZ: 9, eyeY: 10, aheadX: 11, aheadZ: 12, dx: 13, dz: 14, near: 15 } as const;
export const SCRATCH_SLOTS = 16;
