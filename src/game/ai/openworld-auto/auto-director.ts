import { HASH_RANGE, HOLD_MAX_SECONDS, HOLD_MIN_SECONDS, INTERRUPT_INTEREST, INTERRUPT_MARGIN, MIN_INTEREST, RECENT_FACTOR, RECENT_SUBJECTS, SAME_KIND_FACTOR, SCAN_SECONDS, TIE_JITTER } from "./auto-constants.ts";

/** What the camera can follow: a civilian (an index into the crowd), a foot cop (his slot), a car with a driver (the engine's car index), a wrecked building (its place) or the spot someone was run down at (the civilian). */
export const SUBJECT = { civilian: 0, cop: 1, driver: 2, wreck: 3, knock: 4 } as const;
export type SubjectKind = (typeof SUBJECT)[keyof typeof SUBJECT];

/** No subject yet, and no one in a recent slot. */
const NONE = -1;

/** The subjects worth a look this scan, as parallel arrays sized once: what each is, which one, how interesting (0-1). */
export class AutoCandidates {
  count = 0;
  readonly kind: Uint8Array;
  readonly id: Int32Array;
  readonly interest: Float32Array;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.kind = new Uint8Array(capacity);
    this.id = new Int32Array(capacity);
    this.interest = new Float32Array(capacity);
  }

  clear(): void {
    this.count = 0;
  }

  /** One subject; under `MIN_INTEREST`, or past the capacity, it is not worth a place. */
  add(kind: SubjectKind, id: number, interest: number): void {
    if (interest < MIN_INTEREST || this.count === this.capacity) return;
    this.kind[this.count] = kind;
    this.id[this.count] = id;
    this.interest[this.count] = interest;
    this.count++;
  }
}

/** What the director asks of the world. */
type AutoScan = {
  /** Writes every subject worth watching now into `table`, already cleared. */
  fill(table: AutoCandidates): void;
  /** Whether the subject can still be watched: shown, in the world, not the viewer's own car. */
  watchable(kind: SubjectKind, id: number): boolean;
};

/** A share of 1, a pure function of the seed and `n`. */
function hash01(seed: number, n: number): number {
  let h = Math.imul(seed ^ Math.imul(n + 1, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / HASH_RANGE;
}

/**
 * The open world's Auto camera director: one subject at a time, held for a seeded 5 to 10 seconds, then a cut to the most interesting other
 * subject (`AutoScan.fill`), never the one it is on nor the one it left, a repeat of its kind or of the last few counting less. Once the shot
 * has held 5 seconds an event in progress that beats it by a margin cuts at once. A subject that is gone is cut from straight away. Local to the
 * viewer: wall time, nothing on the wire. No allocation once built.
 */
export class AutoDirector {
  /** The subject on screen (-1: none yet). */
  kind = NONE;
  id = NONE;
  /** Cuts made since the seed was set: a camera cut when it changes. */
  cuts = 0;
  heldFor = 0;
  private holdFor = HOLD_MAX_SECONDS;
  private scanIn = 0;
  private seed: number;
  private readonly table: AutoCandidates;
  private readonly recentKind = new Int8Array(RECENT_SUBJECTS).fill(NONE);
  private readonly recentId = new Int32Array(RECENT_SUBJECTS).fill(NONE);

  constructor(capacity: number, seed: number) {
    this.table = new AutoCandidates(capacity);
    this.seed = seed;
  }

  /** A new run of the camera: its seed, no subject, no memory. */
  start(seed: number): void {
    this.seed = seed;
    this.kind = NONE;
    this.id = NONE;
    this.cuts = 0;
    this.heldFor = 0;
    this.scanIn = 0;
    this.recentKind.fill(NONE);
    this.recentId.fill(NONE);
  }

  /** One frame of `wallDt` s: true when the camera cuts (the subject changed). */
  step(wallDt: number, scan: AutoScan): boolean {
    this.heldFor += wallDt;
    this.scanIn -= wallDt;
    if (this.kind === NONE) return this.scanIn <= 0 && this.cut(scan);
    if (!scan.watchable(this.kind as SubjectKind, this.id)) return this.cut(scan);
    if (this.heldFor >= this.holdFor) return this.cut(scan);
    if (this.heldFor < HOLD_MIN_SECONDS || this.scanIn > 0) return false;
    this.scanIn = SCAN_SECONDS;
    return this.interrupt(scan);
  }

  /** Cut to the best subject there is; false (and a retry in a scan's time) when there is none. */
  private cut(scan: AutoScan): boolean {
    const table = this.table;
    table.clear();
    scan.fill(table);
    const best = this.pick(table);
    if (best < 0) {
      this.scanIn = SCAN_SECONDS;
      this.holdFor = this.heldFor + SCAN_SECONDS;
      return false;
    }
    this.go(table.kind[best]!, table.id[best]!);
    return true;
  }

  /** After the minimum hold: cut when something hot is in progress that beats what is on screen by a margin (its own interest: a brawl is worth a cut from another civilian). */
  private interrupt(scan: AutoScan): boolean {
    const table = this.table;
    table.clear();
    scan.fill(table);
    const hottest = this.hottest(table);
    if (hottest < 0) return false;
    const interest = table.interest[hottest]!;
    if (interest < INTERRUPT_INTEREST || interest < this.interestOf(table) + INTERRUPT_MARGIN) return false;
    this.go(table.kind[hottest]!, table.id[hottest]!);
    return true;
  }

  /** The table's index of the most interesting subject that is neither on screen nor the one before it; -1 when there is none. */
  private hottest(table: AutoCandidates): number {
    let hottest = NONE;
    let heat = 0;
    for (let at = 0; at < table.count; at++) {
      const kind = table.kind[at]!;
      const id = table.id[at]!;
      if ((kind === this.kind && id === this.id) || (kind === this.recentKind[0] && id === this.recentId[0])) continue;
      if (table.interest[at]! > heat) {
        heat = table.interest[at]!;
        hottest = at;
      }
    }
    return hottest;
  }

  /** The interest the table gives the subject on screen (0 when it is not in it). */
  private interestOf(table: AutoCandidates): number {
    for (let at = 0; at < table.count; at++) if (table.kind[at] === this.kind && table.id[at] === this.id) return table.interest[at]!;
    return 0;
  }

  /** The table's index with the highest score that is neither the subject on screen nor the one before it (that one only when nothing else is there); -1 when there is none. */
  private pick(table: AutoCandidates): number {
    const best = this.best(table, true);
    return best >= 0 ? best : this.best(table, false);
  }

  private best(table: AutoCandidates, skipPrevious: boolean): number {
    let best = NONE;
    let bestScore = 0;
    for (let at = 0; at < table.count; at++) {
      const kind = table.kind[at]!;
      const id = table.id[at]!;
      if (kind === this.kind && id === this.id) continue;
      if (skipPrevious && kind === this.recentKind[0] && id === this.recentId[0]) continue;
      const score = this.adjusted(table, at);
      if (score > bestScore) {
        bestScore = score;
        best = at;
      }
    }
    return best;
  }

  /** A candidate's score: its interest, less for a repeat of the kind on screen or of a recent subject, nudged by the seed. */
  private adjusted(table: AutoCandidates, at: number): number {
    const kind = table.kind[at]!;
    const id = table.id[at]!;
    let score = table.interest[at]!;
    if (kind === this.kind) score *= SAME_KIND_FACTOR;
    for (let back = 0; back < RECENT_SUBJECTS; back++) {
      if (this.recentKind[back] === kind && this.recentId[back] === id) {
        score *= RECENT_FACTOR;
        break;
      }
    }
    return score + hash01(this.seed, this.cuts * 0x10001 + at) * TIE_JITTER;
  }

  /** The camera moves to a subject: the one it leaves becomes the previous, and its hold is rolled from the seed. */
  private go(kind: number, id: number): void {
    for (let back = RECENT_SUBJECTS - 1; back > 0; back--) {
      this.recentKind[back] = this.recentKind[back - 1]!;
      this.recentId[back] = this.recentId[back - 1]!;
    }
    this.recentKind[0] = this.kind;
    this.recentId[0] = this.id;
    this.kind = kind;
    this.id = id;
    this.cuts++;
    this.heldFor = 0;
    this.scanIn = SCAN_SECONDS;
    this.holdFor = HOLD_MIN_SECONDS + (HOLD_MAX_SECONDS - HOLD_MIN_SECONDS) * hash01(this.seed, this.cuts);
  }
}
