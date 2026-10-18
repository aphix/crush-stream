/**
 * The freeze/thaw recorder (`BENCH_RECORD=1`, bench `--record`): what each crashed car's relock does step by step in the measured window, held in arrays sized when it is installed so that watching changes
 * nothing it watches. It adds no state to the sim: it wraps `DeformableCar.integrate` (the car's slice clock, its state afterwards, how long the call took), `DeformRig.thaw` (a thaw, and what the
 * car had been frozen for) and the entry points that thaw (their code is the thaw's cause); every record is a typed-array write or an integer add: no object, closure, array growth or string on the
 * step path. The sim's digest is equal with it on and off (`bench.mjs` prints both), and its cost is in the per-unit rows of the arm that carries it: read the arm against one without.
 */
import { DeformableCar } from "../../src/game/vehicle/car.ts";
import { DeformRig } from "../../src/game/deform/deform-rig.ts";
import { DeformFreeze } from "../../src/game/deform/deform-freeze.ts";
import { StreamedDeformation } from "../../src/game/deform/streamed-deform.ts";
import type { SimLike } from "./sim.ts";

/** Cars the recorder has a slot for before it takes the next one lazily (a police car that spawns mid-run). */
const SLOTS = 64;
/** Car-slices the log keeps (a ring: a longer window keeps its last `LOG` slices). */
const LOG = 1 << 20;

/** Entry points that thaw a car: a thaw is credited to the innermost of these on the stack (slot 0, 'none', is a thaw outside every one). */
const CAUSES = ["feedOverlap", "shiftBody", "separateAlong", "rearmHit", "notifyContact", "translateMasses", "pushMass", "applyImpact", "unstep", "armMasses", "shoveHub", "popHub"] as const;
/** What a car-slice was: not a wreck; a wreck on the whole path; a wreck frozen with its centre cached (the cheap path); a wreck frozen but not yet cached (the slice after a freeze: a whole `integrateWreck` that caches). */
const STATE_NAMES = ["intact", "wreck whole", "wreck frozen (cached)", "wreck frozen (re-cache slice)"] as const;
/** Hold-length bins in slices of 1/240 s (a slice at the fine floor): 1, 2, 3, 4, 5-8, 9-16, 17-32, 33-64, 65-128, 129+. */
const BIN_LABELS = ["1", "2", "3", "4", "5-8", "9-16", "17-32", "33-64", "65-128", "129+"] as const;
const BINS = BIN_LABELS.length;
const SLICE_S = 1 / 240;

function binOf(seconds: number): number {
  const n = seconds / SLICE_S + 0.5;
  if (n < 2) return 0;
  if (n < 3) return 1;
  if (n < 4) return 2;
  if (n < 5) return 3;
  if (n < 9) return 4;
  if (n < 17) return 5;
  if (n < 33) return 6;
  if (n < 65) return 7;
  if (n < 129) return 8;
  return 9;
}

/** What `result` hands back: plain numbers and short strings, encoded after the run. */
export interface FreezeRecord {
  slices: number;
  byState: Record<string, { slices: number; usPerSlice: number }>;
  thawsByCause: Record<string, number>;
  frozenHoldBySecondsBins: Record<string, Record<string, number>>;
  refreezeGapBins: Record<string, number>;
  contactsAtThaw: Record<string, number>;
  cars: { slot: number; thaws: number; freezes: number; frozenShare: number }[];
  timelines: { slot: number; runs: [string, number][] }[];
  binLabels: readonly string[];
}

export class FreezeRecorder {
  armed = false;
  private readonly slot = new WeakMap<object, number>();
  private next = 0;
  private cause = 0;
  private readonly calls = new Int32Array(SLOTS);
  private readonly time = new Float64Array(SLOTS);
  private readonly frozenAt = new Float64Array(SLOTS);
  private readonly thawedAt = new Float64Array(SLOTS).fill(-1);
  private readonly stateSlices = new Float64Array(4);
  private readonly stateMs = new Float64Array(4);
  private readonly thawsBy = new Uint32Array(CAUSES.length + 1);
  private readonly contactsBy = new Float64Array(CAUSES.length + 1);
  private readonly holdBy = new Uint32Array((CAUSES.length + 1) * BINS);
  private readonly gap = new Uint32Array(BINS);
  private readonly carThaws = new Uint32Array(SLOTS);
  private readonly carFreezes = new Uint32Array(SLOTS);
  private readonly carFrozen = new Uint32Array(SLOTS);
  private readonly carSlices = new Uint32Array(SLOTS);
  private readonly logCar = new Uint8Array(LOG);
  private readonly logState = new Uint8Array(LOG);
  private readonly logRows = new Uint8Array(LOG);
  private readonly lastContacts = new Uint8Array(SLOTS);
  private logN = 0;

  constructor(sim: SimLike) {
    for (const car of sim.cars) this.slotOf(car.deform);
    for (const car of sim.cars) this.slot.set(car, this.slotOf(car.deform));
    FreezeRecorder.install(this);
  }

  private slotOf(key: object): number {
    let s = this.slot.get(key);
    if (s === undefined) {
      s = this.next++ % SLOTS;
      this.slot.set(key, s);
    }
    return s;
  }

  /** Window start: the counts of the warm-up are dropped, the clocks keep running. */
  start(): void {
    this.stateSlices.fill(0);
    this.stateMs.fill(0);
    this.thawsBy.fill(0);
    this.contactsBy.fill(0);
    this.holdBy.fill(0);
    this.gap.fill(0);
    this.carThaws.fill(0);
    this.carFreezes.fill(0);
    this.carFrozen.fill(0);
    this.carSlices.fill(0);
    this.logN = 0;
    this.armed = true;
  }

  private static install(me: FreezeRecorder): void {
    const integrate = DeformableCar.prototype.integrate;
    DeformableCar.prototype.integrate = function (this: DeformableCar, dt: number): void {
      if (!me.armed) {
        integrate.call(this, dt);
        return;
      }
      const s = me.slotOf(this.deform);
      const d = this.deform;
      const cached = d.frozenReady;
      const t0 = performance.now();
      integrate.call(this, dt);
      const ms = performance.now() - t0;
      me.calls[s]!++;
      me.time[s]! += dt;
      const state = !d.massActive ? 0 : d.frozen ? (cached ? 2 : 3) : 1;
      me.stateSlices[state]!++;
      me.stateMs[state] = me.stateMs[state]! + ms;
      me.carSlices[s]!++;
      if (state >= 2) me.carFrozen[s]!++;
      const rows = this.contacts > 255 ? 255 : this.contacts;
      me.lastContacts[s] = rows;
      const at = me.logN++ & (LOG - 1);
      me.logCar[at] = s;
      me.logState[at] = state;
      me.logRows[at] = rows;
    };

    const thaw = DeformRig.prototype.thaw;
    DeformRig.prototype.thaw = function (this: DeformRig): void {
      if (me.armed && this.frozen) {
        const s = me.slotOf(this);
        const c = me.cause;
        me.thawsBy[c]!++;
        me.contactsBy[c] = me.contactsBy[c]! + me.lastContacts[s]!;
        me.holdBy[c * BINS + binOf(me.time[s]! - me.frozenAt[s]!)]!++;
        me.carThaws[s]!++;
        me.thawedAt[s] = me.time[s]!;
      }
      thaw.call(this);
    };

    // A freeze is `settleFreeze` turning `frozen` on (a thaw and the refreeze of one slice are both invisible to a per-slice reader: the slice's structure step runs whole between them).
    const settle = DeformFreeze.prototype.settleFreeze;
    DeformFreeze.prototype.settleFreeze = function (this: DeformFreeze, dt: number): void {
      const was = this.frozen;
      settle.call(this, dt);
      if (me.armed && this.frozen && !was) {
        const s = me.slotOf(this);
        me.frozenAt[s] = me.time[s]!;
        me.carFreezes[s]!++;
        if (me.thawedAt[s]! >= 0) me.gap[binOf(me.time[s]! - me.thawedAt[s]!)]!++;
      }
    };

    // A cause is the innermost wrapped entry point on the stack: set on the way in, put back on the way out. A fixed arity of twelve (`shiftBody` takes ten: a shorter list handed it `undefined`s and NaN-ed
    // the sim): no rest array, no `arguments`.
    const proto = StreamedDeformation.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const [i, name] of CAUSES.entries()) {
      let owner: object | null = proto;
      while (owner !== null && !Object.hasOwn(owner, name)) owner = Object.getPrototypeOf(owner) as object | null;
      if (owner === null) continue;
      const real = (owner as Record<string, (...a: unknown[]) => unknown>)[name]!;
      (owner as Record<string, unknown>)[name] = function (this: unknown, a?: unknown, b?: unknown, c?: unknown, d?: unknown, e?: unknown, f?: unknown, g?: unknown, h?: unknown, j?: unknown, k?: unknown, l?: unknown, m?: unknown): unknown {
        const prev = me.cause;
        me.cause = i + 1;
        const r = real.call(this, a, b, c, d, e, f, g, h, j, k, l, m);
        me.cause = prev;
        return r;
      };
    }
  }

  result(): FreezeRecord {
    const byState: FreezeRecord["byState"] = {};
    for (let k = 0; k < 4; k++) byState[STATE_NAMES[k]!] = { slices: this.stateSlices[k]!, usPerSlice: this.stateSlices[k]! > 0 ? (1000 * this.stateMs[k]!) / this.stateSlices[k]! : 0 };
    const name = (c: number): string => (c === 0 ? "none" : CAUSES[c - 1]!);
    const thawsByCause: FreezeRecord["thawsByCause"] = {};
    const contactsAtThaw: FreezeRecord["contactsAtThaw"] = {};
    const frozenHold: FreezeRecord["frozenHoldBySecondsBins"] = {};
    for (let c = 0; c <= CAUSES.length; c++) {
      if (this.thawsBy[c] === 0) continue;
      thawsByCause[name(c)] = this.thawsBy[c]!;
      contactsAtThaw[name(c)] = this.contactsBy[c]! / this.thawsBy[c]!;
      frozenHold[name(c)] = Object.fromEntries(BIN_LABELS.map((l, b) => [l, this.holdBy[c * BINS + b]!]));
    }
    const refreezeGap = Object.fromEntries(BIN_LABELS.map((l, b) => [l, this.gap[b]!]));
    const cars: FreezeRecord["cars"] = [];
    for (let s = 0; s < this.next && s < SLOTS; s++) if (this.carSlices[s]! > 0) cars.push({ slot: s, thaws: this.carThaws[s]!, freezes: this.carFreezes[s]!, frozenShare: this.carFrozen[s]! / this.carSlices[s]! });
    const worst = [...cars].sort((a, b) => b.thaws - a.thaws).slice(0, 4);
    const timelines: FreezeRecord["timelines"] = [];
    const first = Math.max(0, this.logN - LOG);
    for (const w of worst) {
      const runs: [string, number][] = [];
      for (let i = first; i < this.logN && runs.length < 400; i++) {
        const at = i & (LOG - 1);
        if (this.logCar[at] !== w.slot) continue;
        const label = STATE_NAMES[this.logState[at]!]!;
        const last = runs[runs.length - 1];
        if (last && last[0] === label) last[1]++;
        else runs.push([label, 1]);
      }
      timelines.push({ slot: w.slot, runs });
    }
    return { slices: this.logN, byState, thawsByCause, frozenHoldBySecondsBins: frozenHold, refreezeGapBins: refreezeGap, contactsAtThaw, cars, timelines, binLabels: BIN_LABELS };
  }
}
