import type { AiDifficulty } from "../ai/constants.ts";
import { DERBY_RULES } from "../ai/derby-ai.ts";
import { race } from "../ai/race-ai.test-util.ts";
import { DRIVE } from "../vehicle/car-drive.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { Track } from "./track.ts";

const FRAME = 1 / FRAME_HZ;

/**
 * Who started a racer-racer contact. One car's state per frame (`Sample`), the last frame before the
 * contact first registered, and the `KNOCK` s before it.
 *
 * With n the unit vector from car A's centre to car B's, car X "closes" on the other when its velocity
 * toward it (X·n, sign flipped for B) is at least `CLOSE_MIN` m/s and it was not knocked there: no car-car
 * contact on X in the `KNOCK` s before (a shove or a wreck's slide is the other car's doing, unless X is backing under its own reverse pedal). A car's
 * velocity is its own steer, throttle and brake integrated, so X closing means X turned into the other
 * or drove up to it without getting off its speed; a car that is the one rear-ended, passed or
 * pushed is moving away along n (or not at all), so it does not close. The contact must close at
 * `GRAZE` m/s or more (relative; the derby's `hitSpeed`: a push or a nudge is not a hit); less is a scrape.
 *   one car closes → `initiated` (that car) / `suffered` (the other);
 *   both close → `converging` (two lines meeting: a shared apex, a head-on, a reverse into a car behind);
 *   neither → `none` (a graze, or both were pushed together).
 */
const KNOCK = 0.5;
const CLOSE_MIN = 0.5;
/** Reverse pedal (throttle ≤ −this) that makes a car's backward motion its own driving, bump or no bump. */
const REVERSE_PEDAL = 0.5;
const GRAZE = DERBY_RULES.hitSpeed;

export type Sample = { x: number; z: number; vx: number; vz: number; yaw: number; throttle: number; steer: number; brake: number; bumped: boolean };
export type Role = "initiated" | "suffered" | "converging" | "none";
export type Verdict = { a: Role; b: Role; /** Relative closing speed (m/s) at the last frame. */ closing: number; towardA: number; towardB: number };

/** `a` and `b`: the two cars' samples, oldest to newest, equal length ≥ 1, the last the frame before the contact. */
export function classifyContact(a: readonly Sample[], b: readonly Sample[]): Verdict {
  const T = a.length - 1;
  const dx = b[T]!.x - a[T]!.x;
  const dz = b[T]!.z - a[T]!.z;
  const d = Math.hypot(dx, dz) || 1;
  const towardA = (a[T]!.vx * dx + a[T]!.vz * dz) / d;
  const towardB = -(b[T]!.vx * dx + b[T]!.vz * dz) / d;
  const knocked = (s: readonly Sample[]) => s.slice(Math.max(0, T - Math.round(KNOCK / FRAME)), T + 1).some((x) => x.bumped);
  const reversingOnItsOwnPedal = (s: Sample) => s.throttle <= -REVERSE_PEDAL && s.vx * Math.sin(s.yaw) + s.vz * Math.cos(s.yaw) <= -CLOSE_MIN;
  const closing = towardA + towardB;
  const ca = closing >= GRAZE && towardA >= CLOSE_MIN && (!knocked(a) || reversingOnItsOwnPedal(a[T]!));
  const cb = closing >= GRAZE && towardB >= CLOSE_MIN && (!knocked(b) || reversingOnItsOwnPedal(b[T]!));
  const role = (me: boolean, other: boolean): Role => (me && other ? "converging" : me ? "initiated" : other ? "suffered" : "none");
  return { a: role(ca, cb), b: role(cb, ca), closing, towardA, towardB };
}

const KEEP = Math.round(KNOCK / FRAME) + 1;
/** A pair in contact again within this many frames is the same contact (a scrape), not a new one. */
const SAME = 20;

/** The contact guard's car footprint (half length, half width, m): two of them overlapping is a contact in the kinematic race. */
const HALF_LONG = 2.3;
const HALF_WIDE = 0.95;

type Footprint = { x: number; z: number; yaw: number };

/** Whether two car footprints overlap, by the separating axes of the two rectangles. */
function overlaps(a: Footprint, b: Footprint): boolean {
  for (const f of [a, b]) {
    const axes = [
      [Math.sin(f.yaw), Math.cos(f.yaw)],
      [Math.cos(f.yaw), -Math.sin(f.yaw)],
    ] as const;
    for (const [ax, az] of axes) {
      const reach = (c: Footprint) => HALF_LONG * Math.abs(Math.sin(c.yaw) * ax + Math.cos(c.yaw) * az) + HALF_WIDE * Math.abs(Math.cos(c.yaw) * ax - Math.sin(c.yaw) * az);
      if (Math.abs((b.x - a.x) * ax + (b.z - a.z) * az) > reach(a) + reach(b)) return false;
    }
  }
  return true;
}

/**
 * `n` AI cars, every one at aggression `slider`, racing `laps` laps of `track` (or `limit` s of racing) in the kinematic race (`race`: the real drive
 * model and brains, cars passing through each other): every first frame two racing cars' footprints overlap (`touches`), and those `classifyContact`
 * says one car started (`hits`; no car is ever knocked). What the brains decide, without the crush.
 */
export function kinematicContacts(track: Track, n: number, slider: number, laps: number, difficulty: AiDifficulty, limit = (laps * track.length) / (DRIVE.maxFwd / 2) + 10): { touches: string[]; hits: string[]; finished: number } {
  const hist: Sample[][] = Array.from({ length: n }, () => []);
  const lastPair = new Map<number, number>();
  const hits: string[] = [];
  const touches: string[] = [];
  let step = 0;
  const run = race(track, n, slider, laps, limit, difficulty, undefined, (cars, session) => {
    step++;
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const ca = cars[a]!;
        const cb = cars[b]!;
        if (!overlaps({ x: ca.group.position.x, z: ca.group.position.z, yaw: ca.yaw }, { x: cb.group.position.x, z: cb.group.position.z, yaw: cb.yaw })) continue;
        const key = a * 64 + b;
        const prev = lastPair.get(key);
        lastPair.set(key, step);
        // A finished car is held on the brakes where it crossed the line (the kinematic race has no results screen to clear it): not racing.
        const racing = session.cars[a]!.status === "racing" && session.cars[b]!.status === "racing";
        if (session.phase !== "racing" || !racing || (prev !== undefined && step - prev <= SAME) || hist[a]!.length === 0) continue;
        const v = classifyContact(hist[a]!, hist[b]!);
        const initiator = v.a === "initiated" ? a : v.b === "initiated" ? b : -1;
        const at = `${session.time.toFixed(2)} s of racing`;
        touches.push(`${at}: cars ${a} and ${b} (${v.a} / ${v.b}, closing ${v.closing.toFixed(1)} m/s)`);
        if (initiator >= 0) hits.push(`${at}: car ${initiator} into car ${initiator === a ? b : a} (closing ${v.closing.toFixed(1)} m/s)`);
      }
    }
    for (const [i, c] of cars.entries()) {
      const h = hist[i]!;
      h.push({ x: c.group.position.x, z: c.group.position.z, vx: c.velocity.x, vz: c.velocity.z, yaw: c.yaw, throttle: c.drive.throttle, steer: c.drive.steer, brake: c.drive.brake, bumped: false });
      if (h.length > KEEP) h.shift();
    }
  });
  return { touches, hits, finished: run.session.cars.filter((c) => c.status === "finished").length };
}
