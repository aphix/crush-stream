import { hypot2 } from "../../kernel/physics-core.js";
import { BODY_GAP, COINCIDENT_DISTANCE, MAX_OFFSET, MOVING_SPEED, PAIR_RANGE, PAIRS_PER_BODY, SEPARATION_CELLS, SEPARATION_PASSES, WALKER_CAPACITY } from "./civilian-crowd-constants.ts";

/** The end of a chain of bodies in one grid cell. */
const NO_BODY = -1;
const PAIR_RANGE_SQUARED = PAIR_RANGE * PAIR_RANGE;
const GAP_SQUARED = BODY_GAP * BODY_GAP;
const MAX_OFFSET_SQUARED = MAX_OFFSET * MAX_OFFSET;
const CELL_MASK = SEPARATION_CELLS - 1;
/** Large primes that spread grid cells over the hash table. */
const CELL_PRIME_X = 73856093;
const CELL_PRIME_Z = 19349663;
/** The stamp that restarts the count, before an Int32 stamp could wrap. */
const STAMP_LIMIT = 0x7fffffff;

function cellSlot(cellX: number, cellZ: number): number {
  return (Math.imul(cellX, CELL_PRIME_X) ^ Math.imul(cellZ, CELL_PRIME_Z)) & CELL_MASK;
}

/**
 * Keeps the drawn crowd's bodies a body's width apart without touching the brain: `brainX`, `brainZ` and the velocities are written
 * by the crowd, `resolve` leaves every present body's drawn spot in `drawX`, `drawZ` (never more than `MAX_OFFSET` from the brain's).
 * Civilians are bodies 0..capacity-1, the players on foot `capacity`..; a `fixed` body (a walker, a civilian seated or fighting) is never moved. A pure function of what is written: no history.
 */
export class CrowdSeparation {
  readonly capacity: number;
  readonly present: Uint8Array;
  readonly fixed: Uint8Array;
  readonly brainX: Float32Array;
  readonly brainZ: Float32Array;
  readonly velocityX: Float32Array;
  readonly velocityZ: Float32Array;
  readonly drawX: Float32Array;
  readonly drawZ: Float32Array;
  pairCount = 0;
  readonly pairFirst: Int32Array;
  readonly pairSecond: Int32Array;
  /** Per pair, from the brain's positions: the distance (m) and how fast the two close on each other (m/s, negative when parting). */
  readonly pairDistance: Float32Array;
  readonly pairClosing: Float32Array;
  /** Per pair, from the brain's spots: the unit direction the two move relative to each other, how head-on that is (0 to 1), and which side the first steps to (+1 or -1). */
  private readonly pairAlongX: Float32Array;
  private readonly pairAlongZ: Float32Array;
  private readonly pairHeadOn: Float32Array;
  private readonly pairSide: Float32Array;
  private readonly listed: Int32Array;
  private readonly cellHead = new Int32Array(SEPARATION_CELLS);
  private readonly cellNext: Int32Array;
  /** Per grid slot, the stamp of the last body that scanned it, and the stamp now: a slot is scanned once for a body. */
  private readonly slotStamp = new Int32Array(SEPARATION_CELLS);
  private stamp = 0;
  private readonly cellOfX: Int32Array;
  private readonly cellOfZ: Int32Array;
  /** The shift (x, z) `move` applies, handed over here: a double passed to a call V8 does not inline is boxed, one object a call, every pair, every pass, every frame. */
  private readonly shift = new Float64Array(2);

  constructor(capacity: number) {
    this.capacity = capacity;
    const bodies = capacity + WALKER_CAPACITY;
    const pairs = bodies * PAIRS_PER_BODY;
    this.present = new Uint8Array(bodies);
    this.fixed = new Uint8Array(bodies);
    this.brainX = new Float32Array(bodies);
    this.brainZ = new Float32Array(bodies);
    this.velocityX = new Float32Array(bodies);
    this.velocityZ = new Float32Array(bodies);
    this.drawX = new Float32Array(bodies);
    this.drawZ = new Float32Array(bodies);
    this.pairFirst = new Int32Array(pairs);
    this.pairSecond = new Int32Array(pairs);
    this.pairDistance = new Float32Array(pairs);
    this.pairClosing = new Float32Array(pairs);
    this.pairAlongX = new Float32Array(pairs);
    this.pairAlongZ = new Float32Array(pairs);
    this.pairHeadOn = new Float32Array(pairs);
    this.pairSide = new Float32Array(pairs);
    this.listed = new Int32Array(bodies);
    this.cellNext = new Int32Array(bodies);
    this.cellOfX = new Int32Array(bodies);
    this.cellOfZ = new Int32Array(bodies);
  }

  /** Places every present body: the pair list is made from the brain's spots, then relaxed. */
  resolve(): void {
    const listedCount = this.list();
    this.buildPairs(listedCount);
    this.relax();
  }

  private list(): number {
    const bodies = this.capacity + WALKER_CAPACITY;
    let count = 0;
    for (let body = 0; body < bodies; body++) {
      if (this.present[body] === 0) continue;
      this.listed[count++] = body;
      this.drawX[body] = this.brainX[body]!;
      this.drawZ[body] = this.brainZ[body]!;
    }
    return count;
  }

  /**
   * Every pair of present bodies within `PAIR_RANGE`, found through a hash grid. The cells' chains run from the highest body to the lowest (the bodies are chained in ascending order, each at its head), so a walk of one stops at
   * the first body at or below the one looking: every later one is lower still. A cell the hash maps to the same slot as one already scanned for this body is scanned once (its stamp); a body that has `PAIRS_PER_BODY` stops there.
   */
  private buildPairs(listedCount: number): void {
    this.cellHead.fill(NO_BODY);
    for (let at = 0; at < listedCount; at++) {
      const body = this.listed[at]!;
      const cellX = Math.floor(this.brainX[body]! / PAIR_RANGE);
      const cellZ = Math.floor(this.brainZ[body]! / PAIR_RANGE);
      this.cellOfX[body] = cellX;
      this.cellOfZ[body] = cellZ;
      const slot = cellSlot(cellX, cellZ);
      this.cellNext[body] = this.cellHead[slot]!;
      this.cellHead[slot] = body;
    }
    this.pairCount = 0;
    for (let at = 0; at < listedCount; at++) {
      const first = this.listed[at]!;
      const firstFixed = this.fixed[first] === 1;
      const cellX = this.cellOfX[first]!;
      const cellZ = this.cellOfZ[first]!;
      if (++this.stamp === STAMP_LIMIT) {
        this.slotStamp.fill(0);
        this.stamp = 1;
      }
      let own = 0;
      scan: for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          const slot = cellSlot(cellX + offsetX, cellZ + offsetZ);
          if (this.slotStamp[slot] === this.stamp) continue;
          this.slotStamp[slot] = this.stamp;
          for (let second = this.cellHead[slot]!; second > first; second = this.cellNext[second]!) {
            if (firstFixed && this.fixed[second] === 1) continue;
            if (this.addPair(first, second) && ++own === PAIRS_PER_BODY) break scan;
          }
        }
      }
    }
  }

  /** Whether the pair is within reach and was listed. */
  private addPair(first: number, second: number): boolean {
    const dx = this.brainX[first]! - this.brainX[second]!;
    const dz = this.brainZ[first]! - this.brainZ[second]!;
    const distanceSquared = dx * dx + dz * dz;
    if (distanceSquared >= PAIR_RANGE_SQUARED) return false;
    const distance = Math.sqrt(distanceSquared);
    const relativeX = this.velocityX[first]! - this.velocityX[second]!;
    const relativeZ = this.velocityZ[first]! - this.velocityZ[second]!;
    const relativeSpeed = hypot2(relativeX, relativeZ);
    const at = this.pairCount++;
    this.pairFirst[at] = first;
    this.pairSecond[at] = second;
    this.pairDistance[at] = distance;
    this.pairClosing[at] = distance > COINCIDENT_DISTANCE ? -(relativeX * dx + relativeZ * dz) / distance : relativeSpeed;
    this.pairHeadOn[at] = 0;
    this.pairSide[at] = 1;
    if (relativeSpeed < MOVING_SPEED) return true;
    const alongX = relativeX / relativeSpeed;
    const alongZ = relativeZ / relativeSpeed;
    const cosine = distance > COINCIDENT_DISTANCE ? Math.abs(dx * alongX + dz * alongZ) / distance : 1;
    this.pairAlongX[at] = alongX;
    this.pairAlongZ[at] = alongZ;
    this.pairHeadOn[at] = cosine * cosine;
    this.pairSide[at] = dz * alongX - dx * alongZ < 0 ? -1 : 1;
    return true;
  }

  private relax(): void {
    for (let pass = 0; pass < SEPARATION_PASSES; pass++) {
      for (let at = 0; at < this.pairCount; at++) this.pushApart(at);
    }
  }

  /**
   * Moves the pair to the nearest spots a body's width apart that it can pass on: straight apart when they stand or go side by side, and sideways (the
   * side they were already on, so it never flips as they cross) when they come at each other, so a head-on pair does not stand off along its line.
   */
  private pushApart(at: number): void {
    const first = this.pairFirst[at]!;
    const second = this.pairSecond[at]!;
    const dx = this.drawX[first]! - this.drawX[second]!;
    const dz = this.drawZ[first]! - this.drawZ[second]!;
    const distanceSquared = dx * dx + dz * dz;
    if (distanceSquared >= GAP_SQUARED) return;
    const distance = Math.sqrt(distanceSquared);
    const apartX = (distance > COINCIDENT_DISTANCE ? dx / distance : 1) * BODY_GAP;
    const apartZ = (distance > COINCIDENT_DISTANCE ? dz / distance : 0) * BODY_GAP;
    let targetX = apartX;
    let targetZ = apartZ;
    const headOn = this.pairHeadOn[at]!;
    if (headOn > 0) {
      const alongX = this.pairAlongX[at]!;
      const alongZ = this.pairAlongZ[at]!;
      const ahead = dx * alongX + dz * alongZ;
      const aside = this.pairSide[at]! * Math.sqrt(Math.max(0, GAP_SQUARED - ahead * ahead));
      const blendX = apartX + headOn * (ahead * alongX - aside * alongZ - apartX);
      const blendZ = apartZ + headOn * (ahead * alongZ + aside * alongX - apartZ);
      const blendSquared = blendX * blendX + blendZ * blendZ;
      // A mix of two spots a body's width apart can lie nearer than that: it is taken out to the gap.
      const widen = blendSquared < GAP_SQUARED && blendSquared > 0 ? BODY_GAP / Math.sqrt(blendSquared) : 1;
      if (blendSquared > 0) {
        targetX = blendX * widen;
        targetZ = blendZ * widen;
      }
    }
    const firstMoves = this.fixed[first] === 0;
    const secondMoves = this.fixed[second] === 0;
    const firstShare = firstMoves && secondMoves ? 0.5 : firstMoves ? 1 : 0;
    if (firstMoves) {
      this.shift[0] = (targetX - dx) * firstShare;
      this.shift[1] = (targetZ - dz) * firstShare;
      this.move(first);
    }
    if (secondMoves) {
      this.shift[0] = -(targetX - dx) * (1 - firstShare);
      this.shift[1] = -(targetZ - dz) * (1 - firstShare);
      this.move(second);
    }
  }

  private move(body: number): void {
    let x = this.drawX[body]! + this.shift[0]!;
    let z = this.drawZ[body]! + this.shift[1]!;
    const offsetX = x - this.brainX[body]!;
    const offsetZ = z - this.brainZ[body]!;
    const offsetSquared = offsetX * offsetX + offsetZ * offsetZ;
    if (offsetSquared > MAX_OFFSET_SQUARED) {
      const scale = MAX_OFFSET / Math.sqrt(offsetSquared);
      x = this.brainX[body]! + offsetX * scale;
      z = this.brainZ[body]! + offsetZ * scale;
    }
    this.drawX[body] = x;
    this.drawZ[body] = z;
  }
}
