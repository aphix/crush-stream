/**
 * Where the ground queries' time goes: the call counters of `surfaces.ts`'s exported queries, and a section clock on the coarse ones (the point
 * queries, a wheel's contact, the edge and ridge crossings, the ground's own reads), read by the scenario bench (`scripts/bench`) the way it reads
 * the phase clock (`engine/sim-phases.ts`). The cheap gates (`staticTop`, `solidTop`, `topsTop`, `topsTopNear`, `clearOf`) are called hundreds of
 * times per car-slice and cost less than the clock read that would time them (measured: a timed call costs 230 ns of clock), so they are counted,
 * not timed; their time is in the sampled profile (`bench.mjs --prof`). A timed section is inclusive of the queries it calls inside (a wheel's
 * contact holds its tread's reads), so its time counts only for the outermost timed query on the stack (`depth`) and the sections never add up past
 * the whole. Counts and clock are both off (`on` false: one branch per query) in every run but a bench's `--ground` window; there each outermost
 * timed call costs two `performance.now()` reads (the bench measures that and subtracts it).
 */
export const GQ_NAMES = ["pointContact", "pointContactNear", "pointContactHeld", "wheelContact", "edgeCross", "ridgeCross", "staticTop", "solidTop", "topsTop", "topsTopNear", "clearOf", "heightIn", "contactIn", "seek", "seekTops", "findPlain", "findAll", "offerGrid", "offerDeck", "offerPrism", "offerTop", "cellFlat", "cellCreased", "cellSloped", "ptClear", "ptFar", "ptFarSkipped", "ptRow"] as const;
export const G = { pointContact: 0, pointContactNear: 1, pointContactHeld: 2, wheelContact: 3, edgeCross: 4, ridgeCross: 5, staticTop: 6, solidTop: 7, topsTop: 8, topsTopNear: 9, clearOf: 10, heightIn: 11, contactIn: 12, seek: 13, seekTops: 14, findPlain: 15, findAll: 16, offerGrid: 17, offerDeck: 18, offerPrism: 19, offerTop: 20, cellFlat: 21, cellCreased: 22, cellSloped: 23, ptClear: 24, ptFar: 25, ptFarSkipped: 26, ptRow: 27 } as const;

export const GQ = {
  on: false,
  /** `--verify`: every point query and wheel contact is answered twice, baked and live, and compared (`surfaces.ts` `pointOn`, `wheelContact`); needs `on`. */
  check: false,
  /** Queries on the stack now: only the outermost reads the clock. */
  depth: 0,
  /** Per section: inclusive ms of its outermost calls, every call, and the outermost calls (the ones that read the clock). */
  ms: new Float64Array(GQ_NAMES.length),
  calls: new Float64Array(GQ_NAMES.length),
  outer: new Float64Array(GQ_NAMES.length),
  /** What `check` found: per kind (the three point queries, the wheel's contact) the answers compared and the mismatches, the far answers among them, and the first mismatch's text. */
  verify: { compared: new Float64Array(4), mismatches: new Float64Array(4), far: 0, first: "" },
};

/** A timed query starts (clock on): counts the call and returns the time when it is the outermost, else 0. */
export function gqEnter(slot: number): number {
  GQ.calls[slot] = GQ.calls[slot]! + 1;
  return ++GQ.depth === 1 ? performance.now() : 0;
}

/** A query ends (clock on): `t` is what `gqEnter` returned. */
export function gqLeave(slot: number, t: number): void {
  GQ.depth--;
  if (t === 0) return;
  GQ.ms[slot] = GQ.ms[slot]! + (performance.now() - t);
  GQ.outer[slot] = GQ.outer[slot]! + 1;
}
