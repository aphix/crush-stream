// The camera clearance's query scratch: a hot caller writes the point, box or line here and calls with no doubles, which would box them.

/** Where `solidAt` asks (spectate-cam.ts), written by its caller. */
export const PROBE = new Float64Array(4);
export const PROBE_X = 0;
export const PROBE_Y = 1;
export const PROBE_Z = 2;
export const PROBE_PAD = 3;

/** The flat box `gatherIn` reads (least x, least z, greatest x, greatest z) and its pad, written by its caller. */
export const NEAR_BOX = new Float64Array(5);
export const NEAR_X0 = 0;
export const NEAR_Z0 = 1;
export const NEAR_X1 = 2;
export const NEAR_Z1 = 3;
export const NEAR_PAD = 4;

/** The line `boxHit` asks about, written by its caller as `PROBE` is; `RAY_T` is its answer. */
export const RAY = new Float64Array(10);
export const RAY_X = 0;
export const RAY_Y = 1;
export const RAY_Z = 2;
export const RAY_VX = 3;
export const RAY_VY = 4;
export const RAY_VZ = 5;
export const RAY_FROM = 6;
export const RAY_TO = 7;
export const RAY_PAD = 8;
export const RAY_T = 9;
