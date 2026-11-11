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
  /** What she is doing: an `ACTIVITY` code, 0 walking or standing. */
  activity: Uint8Array;
  /** Seconds since her activity began, the clip's own time. */
  activityClock: Float32Array;
  /** Seconds until her activity ends (`ACTIVITY_OPEN_ENDED` when unknown), so a looping clip can ease out. */
  activityLeft: Float32Array;
  /** World y of the seat top she sits on, or the counter top she buys at (m). */
  surfaceY: Float32Array;
  /** The civilian (an index into these rows) a bump, fight or talk is with, -1 for none. */
  partner: Int32Array;
  /** World y her feet stand on (m): the floor, a stoop step. */
  feetY: Float32Array;
  /** 1 for a resident whose walk now is the spur of a stoop's door: the only walkers a stoop lifts, and whose feet the drawing plants on the treads. */
  onSpur: Uint8Array;
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
    onSpur: new Uint8Array(capacity),
    surfaceY: new Float32Array(capacity),
  };
}
