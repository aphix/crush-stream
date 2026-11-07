import { hypot2 } from "../kernel/physics-core.js";
import { BEAT, rig, type Rig, type RigOpts } from "./hunter-rig.test-util.ts";
import type { AiCar } from "./derby-ai.ts";

/** `HunterBrain`'s private state number for a unit lying in ambush. */
export const AMBUSHING = 3;
export const HUNTING = 1;
export const PLAYER_SPEED = 20;

/** The player at (x, z) driving `v` m/s on heading `yaw` (0 is +z): where the line it holds starts. */
export type Line = { x: number; z: number; v: number; yaw: number };

/** `n` lines across Havana's box (a golden-angle sweep of heading, a fixed lattice of positions): the same set in every run. */
export function sweep(n: number, v = PLAYER_SPEED): Line[] {
  return Array.from({ length: n }, (_, s) => ({ x: (((s * 7919) % 1000) / 1000) * 340 - 170, z: (((s * 104729) % 1000) / 1000) * 340 - 170, v, yaw: (s * 2.399963) % (2 * Math.PI) }));
}

/** Where the line runs: its unit vector (x, z). */
export const dir = (l: Line): { x: number; z: number } => ({ x: Math.sin(l.yaw), z: Math.cos(l.yaw) });

/** The unit state numbers, by unit. */
export const states = (r: Rig): Uint8Array => r.brain["state"];

/** The first unit lying in ambush (−1 none). */
export const ambusher = (r: Rig): number => states(r).findIndex((s) => s === AMBUSHING);

/** Puts the player on `l`, as it is for one beat. */
export function place(r: Rig, l: Line): void {
  const d = dir(l);
  Object.assign(r.cars[0]!, { x: l.x, z: l.z, yaw: l.yaw, vx: d.x * l.v, vz: d.z * l.v });
}

/** A run with the player on `l` and `wrecks` units wrecked (the first ones): after one beat the first replacement is the next drop-in. */
export function lost(l: Line, seed: number, wrecks = 1, opts: RigOpts = {}): Rig {
  const r = rig({ ...opts, seed });
  place(r, l);
  for (let k = 0; k < wrecks; k++) r.down.add(2 + k);
  r.run(r.now() + BEAT);
  return r;
}

/** The first of `lines` whose wrecked unit's replacement lies in ambush: its seed, line and run. */
export function firstAmbush(lines: readonly Line[]): { seed: number; line: Line; r: Rig; u: number } {
  for (const [s, line] of lines.entries()) {
    const r = lost(line, s + 1);
    const u = ambusher(r);
    if (u >= 0) return { seed: s + 1, line, r, u };
  }
  throw new Error("no line found an ambush spot");
}

/** Metres of `at` along the line from the player (negative: behind it) and off it. */
export function frame(l: Line, at: { x: number; z: number }): { along: number; off: number } {
  const d = dir(l);
  const dx = at.x - l.x;
  const dz = at.z - l.z;
  return { along: dx * d.x + dz * d.z, off: Math.abs(dx * d.z - dz * d.x) };
}

/** The cars of the units lying in ambush now. */
export function ambushers(r: Rig): AiCar[] {
  const out: AiCar[] = [];
  const st = states(r);
  for (let u = 0; u < st.length; u++) if (st[u] === AMBUSHING) out.push(r.cars[r.brain.first + u]!);
  return out;
}

/** Drives the player along its line `seconds` s, a beat at a time, and calls `each` after every beat's patrol. */
export function drivePast(r: Rig, l: Line, seconds: number, each: (p: AiCar, t: number) => void): void {
  const d = dir(l);
  const p = r.cars[0]!;
  r.run(r.now() + seconds, (t) => {
    each(p, t);
    p.x += d.x * l.v * BEAT;
    p.z += d.z * l.v * BEAT;
  });
}

/** Carries the first `units` cops along 30 m behind the player, spread across its line (a pack that keeps up, so none is lost). */
export function convoy(r: Rig, l: Line, units: number): void {
  const d = dir(l);
  const p = r.cars[0]!;
  for (let k = 1; k <= units; k++) {
    const side = (k - 3) * 4;
    Object.assign(r.cars[k]!, { x: p.x - d.x * 30 + d.z * side, z: p.z - d.z * 30 - d.x * side });
  }
}

export const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number => hypot2(a.x - b.x, a.z - b.z);
