import { ACTIVITY_OPEN_ENDED } from "./civilian-activity.ts";

/** The drawn crowd, one entry per civilian, owned by the crowd and read by its drawing; `stride` is the walk phase (rad), `shown` 0 hides one. */
export type CrowdPoses = {
  count: number;
  x: Float32Array;
  z: Float32Array;
  yaw: Float32Array;
  stride: Float32Array;
  speed: Float32Array;
  look: Uint32Array;
  shown: Uint8Array;
  /** `ACTIVITY` code, seconds since it began, seconds until it ends, and the other civilian in it (-1: none). */
  activity: Uint8Array;
  activityClock: Float32Array;
  activityLeft: Float32Array;
  partner: Int32Array;
  /** Height of the feet, and of the seat or counter top the activity uses (m). */
  feetY: Float32Array;
  surfaceY: Float32Array;
};

export function createCrowdPoses(capacity: number): CrowdPoses {
  return {
    count: capacity,
    x: new Float32Array(capacity),
    z: new Float32Array(capacity),
    yaw: new Float32Array(capacity),
    stride: new Float32Array(capacity),
    speed: new Float32Array(capacity),
    look: new Uint32Array(capacity),
    shown: new Uint8Array(capacity),
    activity: new Uint8Array(capacity),
    activityClock: new Float32Array(capacity),
    activityLeft: new Float32Array(capacity).fill(ACTIVITY_OPEN_ENDED),
    partner: new Int32Array(capacity).fill(-1),
    feetY: new Float32Array(capacity),
    surfaceY: new Float32Array(capacity),
  };
}
