import type { DetachPart, LooseBody, LooseShape, LooseWheel } from "./car-core.ts";
import type { CarParts } from "./car-parts.ts";
import { DENT_MAX, type DentState } from "./loose-dent.ts";
import { fitWheelShape, keyedShape, SHAPE_POINTS } from "./loose-step.ts";

/** Netplay part slots: the most parts any style has (8, six body panels, plus the police light bar), so every car shares one layout. */
export const PART_SLOTS = 15;
/** Wheels a car can pop off its hubs (`looseWheels`). */
const WHEEL_SLOTS = 4;
/** The bodies a car can fly in the world: its `PART_SLOTS` parts, then its `WHEEL_SLOTS` wheels (a body's index in `CarParts.stirredBodies` and in a clip's part stirs). */
export const LOOSE_BODIES = PART_SLOTS + WHEEL_SLOTS;
/** Numbers in a `CarParts.partState` block: twelve for the car, then nine per part slot. */
const PART_STATE_HEAD = 12;
const PART_STATE_EACH = 9;
export const PART_STATE = PART_STATE_HEAD + PART_SLOTS * PART_STATE_EACH;

/**
 * Highlight keyframes (docs/HIGHLIGHTS.md): what the netplay part state (float32 on the wire, and no rates or clocks) leaves
 * out or rounds, `PART_STATE` numbers into `buf`, or with `write` restored from it: the door-swing drive (the last motion
 * sample and the pendulum's drive), the contact timing and the flutter, and per part slot whether it is folding, its
 * hinge value and cap, its wind wear and its door swing's angle, rate, load, mirror fold and latch. A door that a sideswipe
 * is still swinging, or a panel half bent, slows the next striker by what it holds: the replay is the sim that recorded
 * it only if it starts from the same doubles. Which parts are on the car and which are off stays the net state's.
 */
export function partState(car: CarParts, parts: readonly DetachPart[], buf: Float64Array, write: boolean): void {
  const m = car.motion;
  const d = car.swingDrive;
  if (write) {
    for (let i = 0; i < 4; i++) m[i] = buf[i]!;
    for (let i = 0; i < 5; i++) d[i] = buf[4 + i]!;
    car.quietPrev = buf[9]!;
    car.flapClock = buf[10]!;
    car.flapSpeed = buf[11]!;
  } else {
    for (let i = 0; i < 4; i++) buf[i] = m[i]!;
    for (let i = 0; i < 5; i++) buf[4 + i] = d[i]!;
    buf[9] = car.quietPrev;
    buf[10] = car.flapClock;
    buf[11] = car.flapSpeed;
  }
  for (let i = 0; i < PART_SLOTS; i++) {
    const o = PART_STATE_HEAD + i * PART_STATE_EACH;
    const p = parts[i];
    if (!p) {
      if (!write) buf.fill(0, o, o + PART_STATE_EACH);
      continue;
    }
    const s = p.swing;
    if (write) {
      p.folding = buf[o]! !== 0;
      p.hingeT = buf[o + 1]!;
      p.hingeMax = buf[o + 2]!;
      p.fatigue = buf[o + 3]!;
      if (s) {
        s.theta = buf[o + 4]!;
        s.omega = buf[o + 5]!;
        s.load = buf[o + 6]!;
        s.mirrorFold = buf[o + 7]!;
        s.latched = buf[o + 8]! !== 0;
      }
    } else {
      buf[o] = p.folding ? 1 : 0;
      buf[o + 1] = p.hingeT;
      buf[o + 2] = p.hingeMax;
      buf[o + 3] = p.fatigue;
      buf[o + 4] = s ? s.theta : 0;
      buf[o + 5] = s ? s.omega : 0;
      buf[o + 6] = s ? s.load : 0;
      buf[o + 7] = s ? s.mirrorFold : 0;
      buf[o + 8] = s?.latched ? 1 : 0;
    }
  }
}

/**
 * Numbers a loose body takes in a keyframe's loose block: pose (position, quaternion), velocity, spin, the flags, the sleep place (x, z), the
 * dents' count and their hits, a part's shape (its middle and box half extents, 0: not measured yet) and how long it has rested (`restFor`), then
 * its shape's points (a part that flies as its shell's own, `LOOSE_SHELL`).
 */
const LOOSE_BOX = 17 + DENT_MAX * 4;
const LOOSE_POINTS = LOOSE_BOX + 7;
const LOOSE_EACH = LOOSE_POINTS + SHAPE_POINTS * 3;
const LOOSE_ASLEEP = 1;
const LOOSE_AIRBORNE = 2;
const LOOSE_SHOWN = 4;
/** Its shape is its shell's own points, not its box's (`boxShape`). */
const LOOSE_SHELL = 8;
/** The axis its drawn surface faces (`LooseShape.plate`: 0, 1, 2) rides the flags above this bit. */
const LOOSE_PLATE = 16;
/** Most numbers a loose block takes: its mask, then every body's. */
export const LOOSE_STATE_MAX = 1 + LOOSE_BODIES * LOOSE_EACH;

/** The numbers a loose block holds when its mask (its first number) is `mask`: the mask, then one body's for every bit set. -1 for a mask no car makes. */
export function looseStateLength(mask: number): number {
  if (!Number.isInteger(mask) || mask < 0 || mask >= 1 << LOOSE_BODIES) return -1;
  let bodies = 0;
  for (let i = 0; i < LOOSE_BODIES; i++) bodies += (mask >> i) & 1;
  return 1 + bodies * LOOSE_EACH;
}

/**
 * Highlight keyframes: where every torn part and popped wheel of the car lies and what it is doing. The netplay state says which are off (and
 * a wheel's pose) but not where a part lies, so a keyframe's replay threw each one off the car afresh at the clip's first step. `buf`
 * (`LOOSE_STATE_MAX` numbers) holds the mask of the loose bodies (bit i: the part in slot i, then the wheels from `PART_SLOTS`), then per
 * loose body its pose, velocity and spin, whether it sleeps, flies free and is drawn, where it sleeps, its dents' record, a part's box and how long it has rested. With `write`
 * the bodies the car has off already (its net state's) are put back as recorded. Returns the numbers used.
 */
export function looseState(parts: readonly DetachPart[], wheels: readonly LooseWheel[], buf: Float64Array, write: boolean): number {
  const recorded = write ? buf[0]! : 0;
  let mask = 0;
  let at = 1;
  for (let i = 0; i < LOOSE_BODIES; i++) {
    const part = i < PART_SLOTS ? parts[i] : undefined;
    const wheel = i < PART_SLOTS ? undefined : wheels[i - PART_SLOTS];
    const loose = part ? part.detached : (wheel?.loose ?? false);
    if (write) {
      if (((recorded >> i) & 1) === 0) continue;
      if (loose) putLooseBody((part ?? wheel)!, wheel, part?.dent, buf, at);
    } else {
      if (!loose) continue;
      readLooseBody((part ?? wheel)!, part?.dent, buf, at);
      mask |= 1 << i;
    }
    at += LOOSE_EACH;
  }
  if (!write) buf[0] = mask;
  return at;
}

function readLooseBody(body: LooseBody, dent: DentState | undefined, buf: Float64Array, at: number): void {
  const o = body.object;
  o.position.toArray(buf, at);
  o.quaternion.toArray(buf, at + 3);
  body.velocity.toArray(buf, at + 7);
  body.angular.toArray(buf, at + 10);
  const s = body.shape;
  buf[at + 13] = (s.asleep ? LOOSE_ASLEEP : 0) | (s.airborne ? LOOSE_AIRBORNE : 0) | (o.visible ? LOOSE_SHOWN : 0) | (s.count > 0 && !s.box ? LOOSE_SHELL : 0) | (s.count > 0 ? s.plate * LOOSE_PLATE : 0);
  buf[at + 14] = s.sleepX;
  buf[at + 15] = s.sleepZ;
  buf[at + 16] = dent?.count ?? 0;
  for (let k = 0; k < DENT_MAX * 4; k++) buf[at + 17 + k] = dent?.hits[k] ?? 0;
  s.centre.toArray(buf, at + LOOSE_BOX);
  for (let k = 0; k < 3; k++) buf[at + LOOSE_BOX + 3 + k] = s.count === 0 ? 0 : s.half.getComponent(k);
  buf[at + LOOSE_BOX + 6] = s.restFor;
  for (let k = 0; k < SHAPE_POINTS * 3; k++) buf[at + LOOSE_POINTS + k] = s.points[k]!;
}

function putLooseBody(body: LooseBody, wheel: LooseWheel | undefined, dent: DentState | undefined, buf: Float64Array, at: number): void {
  const o = body.object;
  o.position.fromArray(buf, at);
  o.quaternion.fromArray(buf, at + 3);
  body.velocity.fromArray(buf, at + 7);
  body.angular.fromArray(buf, at + 10);
  const flags = buf[at + 13]!;
  // Before the flags: shaping wakes it and says it flies. A part flies as the shape it was measured as when it first flew, not its shell drawn now.
  if (wheel) fitWheelShape(wheel);
  else if (buf[at + LOOSE_BOX + 3] === 0) body.shape.count = 0;
  else {
    body.shape.centre.fromArray(buf, at + LOOSE_BOX);
    const plate = Math.floor(flags / LOOSE_PLATE) as LooseShape["plate"];
    keyedShape(body.shape, buf[at + LOOSE_BOX + 3]!, buf[at + LOOSE_BOX + 4]!, buf[at + LOOSE_BOX + 5]!, plate, (flags & LOOSE_SHELL) === 0, buf, at + LOOSE_POINTS);
  }
  const s = body.shape;
  s.asleep = (flags & LOOSE_ASLEEP) !== 0;
  s.airborne = (flags & LOOSE_AIRBORNE) !== 0;
  s.sleepX = buf[at + 14]!;
  s.sleepZ = buf[at + 15]!;
  s.restFor = buf[at + LOOSE_BOX + 6]!;
  o.visible = (flags & LOOSE_SHOWN) !== 0;
  if (!dent) return;
  dent.count = buf[at + 16]!;
  for (let k = 0; k < DENT_MAX * 4; k++) dent.hits[k] = buf[at + 17 + k]!;
}
