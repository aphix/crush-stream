/** Shared spawn layout so 1–N cars never start overlapping. */

import * as THREE from "three";
import { hypot2, detSin, detCos, detAtan2, detAsin } from "../kernel/physics-core.js";
import { CAR_STYLES, FLEET_STYLE_IDS, type CarStyleId } from "../vehicle/car-variants.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { fellOffRim } from "../world/ground.ts";
import { FLEET_HALF, carFrame } from "../vehicle/car-rig.ts";
import { DERBY_ARENA } from "./constants.ts";
import { CLASSES, STYLE_CLASS, type VehicleClassId } from "../vehicle/vehicle-classes.ts";
import { RAMP } from "./fleet-ramps.ts";

/** Car pool size: the per-car typed arrays (derby/race AI, race, traffic), wheel batch and lamp pool are sized for it,
 *  `setCarCount` clamps to it and the HUD Cars slider stops at it. Set in the initial export (7a09b34), not measured. */
export const MAX_CARS = 32;
/** Closest two fleet spawns sit, centre to centre (m): the longest car (2 × FLEET_HALF.z, 4.44 m) plus ~1 m.
 *  fleet.test.ts holds every layout to it and `respawnSlot` keeps it from every other car. */
export const FLEET_MIN_SEP = 5.4;
/** The six lamp posts stand on a ring this far (m) from the pad's centre, at bearings `k / LAMP_POSTS` of a turn from +z (`resetLampPoles`). */
export const LAMP_RING_R = 16;
export const LAMP_POSTS = 6;
/** A spawn keeps this far (m) from every lamp post and from the straight path its car drives (a car's half width 1 + the post 0.12 + a margin). */
const LAMP_CLEAR = 2;
/** A spawn's straight path passes a jump-ramp wedge at least this far (m) outside its car's half width: the mirrors and a margin. */
const RAMP_CLEAR = 0.15;

/**
 * How close (m) a car at (x, z), driving straight at the centre and on through it out to the far side of the post ring, passes to a
 * lamp post (0 if it starts on one). A car that crosses the pad is never stopped by the pack before the far posts.
 */
function lampClearance(x: number, z: number): number {
  const len = hypot2(x, z);
  if (len < 1e-6) return Infinity;
  const reach = len + LAMP_RING_R + LAMP_CLEAR;
  let least = Infinity;
  for (let k = 0; k < LAMP_POSTS; k++) {
    const a = (k / LAMP_POSTS) * Math.PI * 2;
    const px = detSin(a) * LAMP_RING_R;
    const pz = detCos(a) * LAMP_RING_R;
    // The post's distance along the spawn-to-centre line, clamped to the path, and its distance from that line.
    const t = Math.max(0, Math.min(reach, (px * -x + pz * -z) / len + len));
    least = Math.min(least, hypot2(px - x * (1 - t / len), pz - z * (1 - t / len)));
  }
  return least;
}

/**
 * Whether a car `w` m half-wide at (x, z), driving straight through the centre, meets a jump-ramp wedge (`FleetRamps`: on the axis
 * through the centre toward (ax, az)) other than by running up the toe of the one before it, its whole box starting clear of it.
 */
function rampInPath(x: number, z: number, ax: number, az: number, w: number): boolean {
  const axis = hypot2(ax, az);
  const u = Math.abs(x * ax + z * az) / axis;
  const c = Math.abs(x * az - z * ax) / axis;
  const r = hypot2(u, c);
  const cos = u / r;
  const sin = c / r;
  const toe = RAMP.start + RAMP.len;
  // Within the wedge's width where the path reaches its toe, so it runs up the face: the jump.
  if (cos > 0 && toe * sin + w <= RAMP.halfW * cos && u - FLEET_HALF.footHalfL * cos - w * sin >= toe) return false;
  // The path's band passes the near wedge's inner corner (the far one mirrors it through the centre): it meets a flank or the high end.
  return RAMP.start * sin - RAMP.halfW * cos < w;
}

/** Plan half width (m) of slot `i`'s car (`fleetStyle`), its tyres included: a monster's stand 0.7 m out past its body. */
function slotHalfWidth(i: number): number {
  const f = carFrame(CAR_STYLES[fleetStyle(i)]);
  return Math.max(f.half.x, f.halfTrack + f.rig.tyre.halfW * CLASSES[fleetClass(i)].wheelScale);
}

/** Whether car slot `i` at (x, z) meets a wedge. They lie on slot 0's bearing (`JerseyBarrier.orient` end-on): slot 0 (no `lead`) runs up a toe whatever its width, so it only stands clear of it. */
function rampBlocked(i: number, x: number, z: number, lead: { x: number; z: number } | undefined): boolean {
  return lead ? rampInPath(x, z, lead.x, lead.z, slotHalfWidth(i) + RAMP_CLEAR) : rampInPath(x, z, x, z, 0);
}

/** Radial step (m) of `rampClearSpot`'s search outward: a fraction of a car's length, so a moved car keeps near its ring. */
const SPOT_STEP = 0.5;

/**
 * The spot nearest (x, z) where car slot `i` starts clear of the jump ramps, the posts and every one of `slots` (`FLEET_MIN_SEP`):
 * round its ring a degree at a time either side, then on rings further out to `RESPAWN_R`; (x, z) itself if none is.
 */
function rampClearSpot(i: number, x: number, z: number, slots: readonly FleetSlot[]): { x: number; z: number } {
  const ang = detAtan2(x, z);
  for (let r = hypot2(x, z); r <= RESPAWN_R; r += SPOT_STEP) {
    for (let step = 0; step <= 180; step++) {
      for (const sign of [1, -1]) {
        const b = ang + (sign * step * Math.PI) / 180;
        const sx = detSin(b) * r;
        const sz = detCos(b) * r;
        if (lampClearance(sx, sz) < LAMP_CLEAR || rampBlocked(i, sx, sz, slots[0])) continue;
        if (slots.every((o) => hypot2(sx - o.x, sz - o.z) >= FLEET_MIN_SEP)) return { x: sx, z: sz };
      }
    }
  }
  return { x, z };
}

/**
 * The bearing nearest `ang` (rad) from which a car `r` m out clears every post, stepping off the post lines a degree at a time
 * either side; if none within a post spacing does, the clearest one.
 */
function clearBearing(ang: number, r: number): number {
  let best = ang;
  let bestClear = -1;
  for (let step = 0; step <= 60; step++) {
    for (const sign of [1, -1]) {
      const b = ang + (sign * step * Math.PI) / 180;
      const c = lampClearance(detSin(b) * r, detCos(b) * r);
      if (c >= LAMP_CLEAR) return b;
      if (c > bestClear) {
        bestClear = c;
        best = b;
      }
    }
  }
  return best;
}

/** Slot cycle (fleet and derby share the pool): every fleet body style in its own class, then a monster truck. */
const SLOT_STYLES: readonly CarStyleId[] = [...FLEET_STYLE_IDS, CLASSES.monster.style];
const SLOT_CLASSES: readonly VehicleClassId[] = [...FLEET_STYLE_IDS.map((s) => STYLE_CLASS[s]), "monster"];

/** Vehicle class of car slot `i`: any 6+ car field has every class; slot 0 stays a sedan. */
export function fleetClass(i: number): VehicleClassId {
  return SLOT_CLASSES[i % SLOT_CLASSES.length]!;
}

/** Body style of car slot `i`: any 5+ car field shows every style; slot 0 stays the sedan. */
export function fleetStyle(i: number): CarStyleId {
  return SLOT_STYLES[i % SLOT_STYLES.length]!;
}

/** A car's body and how it drives. */
export type CarType = { cls: VehicleClassId; style: CarStyleId };

/**
 * What car slot `i` is built as: slot 0 is the player's pick, and in the Stack scene every car is, so the tower is one
 * type; otherwise the fleet's cycle (`fleetClass`, `fleetStyle`).
 */
export function slotType(i: number, player: CarType, stack: boolean): CarType {
  return i === 0 || stack ? player : { cls: fleetClass(i), style: fleetStyle(i) };
}

type FleetSlot = { x: number; z: number; speed: number };
export type DerbySlot = { x: number; z: number; yaw: number };

function speedInRange(min: number, max: number, rng: () => number): number {
  const lo = Math.max(0, Math.min(min, max));
  const hi = Math.max(0, Math.max(min, max));
  const span = hi - lo;
  return lo + (span <= 0 ? 0 : rng() * span);
}

/**
 * Place `count` cars on the pad, non-intersecting, aimed at the origin
 * (DeformableCar.spawn lookAt(0,0,0)). 1–2 cars sit opposite for a
 * reliable crash; 3+ scatter on a ring, with `ramps` on each clear of
 * the jump ramps' wedges (`rampClearSpot`).
 */
export function layoutFleet(
  count: number,
  speedMin: number,
  speedMax: number,
  rng: () => number = Math.random,
  ramps = false,
): FleetSlot[] {
  const n = Math.max(1, Math.min(MAX_CARS, Math.round(count) || 1));
  const spd = () => speedInRange(speedMin, speedMax, rng);

  if (n === 1) {
    // Midway between two posts, so the whole path through the centre passes between the posts either side of it.
    const a = Math.PI / LAMP_POSTS;
    return [{ x: detSin(a) * 10.5, z: detCos(a) * 10.5, speed: spd() }];
  }

  if (n === 2) {
    const a = rng() * Math.PI * 2;
    const r = 9.2;
    return [
      { x: detSin(a) * r, z: detCos(a) * r, speed: spd() },
      { x: detSin(a + Math.PI) * r, z: detCos(a + Math.PI) * r, speed: spd() },
    ];
  }

  const slots: FleetSlot[] = [];
  const padR = 7 + Math.min(16, n * 1.1);
  for (let i = 0; i < n; i++) {
    let x = 0;
    let z = 0;
    let placed = false;
    for (let attempt = 0; attempt < 48; attempt++) {
      const ang = rng() * Math.PI * 2;
      const r = 6.4 + rng() * padR;
      x = detSin(ang) * r;
      z = detCos(ang) * r;
      placed = lampClearance(x, z) >= LAMP_CLEAR;
      for (let j = 0; j < i && placed; j++) {
        const o = slots[j]!;
        if (hypot2(x - o.x, z - o.z) < FLEET_MIN_SEP) {
          placed = false;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) {
      // Last resort: the even ring, each bearing stepped off the post lines (the pack spacing is the ring's, not re-checked).
      const r = Math.max(8.2, (FLEET_MIN_SEP * n) / (Math.PI * 1.7));
      const ang = clearBearing((i / n) * Math.PI * 2, r);
      x = detSin(ang) * r;
      z = detCos(ang) * r;
    }
    // Only a car that would meet a ramp moves, and the seed's draws stay in step, so the rest of the field keeps its spots.
    if (ramps && rampBlocked(i, x, z, slots[0])) ({ x, z } = rampClearSpot(i, x, z, slots));
    slots.push({ x, z, speed: spd() });
  }
  return slots;
}

const TAU = Math.PI * 2;
/** A car driving at the arena's centre keeps this far (m) from a free-standing prop: half its length and a margin. */
const PROP_CLEAR = FLEET_HALF.z + 0.5;

/** A free-standing prop's plan box: centre, yaw (local z is (sin yaw, cos yaw)) and half extents. */
type SpawnProp = { x: number; z: number; yaw: number; hx: number; hz: number };
/** An arc of bearings (rad from +z toward +x), `to` past `from`; may run past 2π. */
type Arc = { from: number; to: number };

/**
 * The bearings whose straight line to the centre passes within `PROP_CLEAR` of a prop: each prop's arc is the widest the four
 * corners' discs of that radius subtend from the centre; overlapping arcs merge, ascending, the first possibly starting below 0.
 */
function blockedArcs(props: readonly SpawnProp[]): Arc[] {
  const raw: Arc[] = [];
  for (const p of props) {
    const centre = detAtan2(p.x, p.z);
    let lo = Infinity;
    let hi = -Infinity;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const lx = sx * p.hx;
        const lz = sz * p.hz;
        const cx = p.x + lx * detCos(p.yaw) + lz * detSin(p.yaw);
        const cz = p.z - lx * detSin(p.yaw) + lz * detCos(p.yaw);
        const off = detAtan2(cx, cz) - centre;
        const b = off - TAU * Math.round(off / TAU);
        const w = detAsin(Math.min(1, PROP_CLEAR / hypot2(cx, cz)));
        lo = Math.min(lo, b - w);
        hi = Math.max(hi, b + w);
      }
    }
    const from = centre + lo - TAU * Math.floor((centre + lo) / TAU);
    raw.push({ from, to: from + hi - lo });
  }
  raw.sort((a, b) => a.from - b.from);
  const out: Arc[] = [];
  for (const a of raw) {
    const last = out.at(-1);
    if (last && a.from <= last.to) last.to = Math.max(last.to, a.to);
    else out.push({ ...a });
  }
  const first = out[0];
  const last = out.at(-1);
  if (first && last && last !== first && last.to - TAU >= first.from) {
    first.from = last.from - TAU;
    first.to = Math.max(first.to, last.to - TAU);
    out.pop();
  }
  return out;
}

/** The `s`-th radian along the open bearings (those outside every blocked arc, in order from the first one's end), wrapping. */
function openBearing(s: number, blocked: readonly Arc[]): number {
  if (blocked.length === 0) return s;
  let open = TAU;
  for (const a of blocked) open -= a.to - a.from;
  let rest = s % open;
  for (let k = 0; k < blocked.length; k++) {
    const start = blocked[k]!.to;
    const end = k + 1 < blocked.length ? blocked[k + 1]!.from : blocked[0]!.from + TAU;
    if (rest < end - start) return start + rest;
    rest -= end - start;
  }
  return blocked[0]!.to;
}

/**
 * Round the arena's spawn ring, each car stopped and facing its centre (the start lights hold them until green). Neighbours stand
 * `DERBY_ARENA.packPitch` m apart at most: a small field starts in one bunch on the ring, so it meets quickly across the arena; a full
 * one is spread round it. No car starts on a bearing whose line to the centre passes within `PROP_CLEAR` of one of `props`, so none
 * starts driving at a container, pad or rail: the field is laid along the open bearings, so a full one (32 cars) stands 4.4 m apart.
 */
export function layoutDerby(count: number, radius: number, rng: () => number = Math.random, props: readonly SpawnProp[] = []): DerbySlot[] {
  const n = Math.max(1, Math.min(MAX_CARS, Math.round(count) || 1));
  const slots: DerbySlot[] = [];
  const r = Math.max(5.5, radius - DERBY_ARENA.spawnInset);
  const blocked = blockedArcs(props);
  let open = TAU;
  for (const a of blocked) open -= a.to - a.from;
  const spin = rng() * TAU * (open / TAU);
  const step = Math.min(open / n, DERBY_ARENA.packPitch / r);
  for (let i = 0; i < n; i++) {
    const a = openBearing(spin + i * step, blocked);
    slots.push({ x: detSin(a) * r, z: detCos(a) * r, yaw: a + Math.PI });
  }
  return slots;
}

/** The depth (m) under the floor of its origin a sunk car is still met at: the derby arena's prisms start below it (`DERBY_PRISM_BASE`). */
export const SUNK_CAR_DEPTH = 2;

/** The driven car is back on the disc this long (s) after vaporizing; AI cars stay gone until reset. */
export const RESPAWN_S = 2;
/**
 * Fleet loop: wall seconds the disc stays empty (every car vaporized past the rim) before the run resets. The crash
 * clock's reset only fires after a hit, so a run where no car meets another would otherwise never end. Under
 * `RESPAWN_S`, so the driven car's respawn never keeps the disc from counting as empty.
 */
export const FLEET_EMPTY_S = 1;

/** Whether the fleet's disc has been empty for `FLEET_EMPTY_S`: every car vaporized, the last at `vaporAt` (wall s) per car, `now` wall s. */
export function fleetEmptied(cars: readonly { vaporized: boolean }[], vaporAt: readonly (number | undefined)[], now: number): boolean {
  let last = 0;
  for (let i = 0; i < cars.length; i++) {
    if (!cars[i]!.vaporized) return false;
    last = Math.max(last, vaporAt[i] ?? 0);
  }
  return cars.length > 0 && now - last >= FLEET_EMPTY_S;
}

/** Respawn this far (m) out from the disc's centre. */
const RESPAWN_R = 36;

const _lowestCorner = new THREE.Vector3();
const _localUp = new THREE.Vector3();
const _inverse = new THREE.Quaternion();

/** Whether `car`'s lowest point (its box's lowest corner) is 10 mm under the disc's top over no floor: it has gone off the rim. */
export function carFellOffRim(car: Pick<DeformableCar, "group" | "frame">): boolean {
  const { half } = car.frame;
  const q = car.group.quaternion;
  _localUp.set(0, 1, 0).applyQuaternion(_inverse.copy(q).invert());
  _lowestCorner.set(_localUp.x > 0 ? -half.x : half.x, _localUp.y > 0 ? 0 : 2 * half.y, _localUp.z > 0 ? -half.z : half.z).applyQuaternion(q).add(car.group.position);
  return fellOffRim(_lowestCorner.x, _lowestCorner.y, _lowestCorner.z);
}

/** The fleet disc's edge rule for one car this frame: it vaporizes once it has fallen off the rim (`carFellOffRim`); vaporized for `goneFor` s, only the `driven` car comes back. */
export function edgeAction(fellOff: boolean, vaporized: boolean, driven: boolean, goneFor: number): "vaporize" | "respawn" | null {
  if (vaporized) return driven && goneFor > RESPAWN_S ? "respawn" : null;
  return fellOff ? "vaporize" : null;
}

/**
 * Where a car that fell off at (x, z) comes back: `RESPAWN_R` out on the bearing it fell from, facing the
 * centre, stepped round the ring until `FLEET_MIN_SEP` clear of every car in `others`.
 */
export function respawnSlot(x: number, z: number, others: readonly { x: number; z: number }[]): DerbySlot {
  let a = detAtan2(x, z);
  for (let k = 0; k < 24; k++) {
    const sx = detSin(a) * RESPAWN_R;
    const sz = detCos(a) * RESPAWN_R;
    if (!others.some((o) => hypot2(o.x - sx, o.z - sz) < FLEET_MIN_SEP)) break;
    a += 0.27;
  }
  return { x: detSin(a) * RESPAWN_R, z: detCos(a) * RESPAWN_R, yaw: a + Math.PI };
}
