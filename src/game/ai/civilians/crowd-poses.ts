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
};
