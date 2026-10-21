import type { CrashHudState } from "../hud/hud-store.ts";

/**
 * How a bench card is written for the wire (`engine-bench.ts` `payload`): the numbers at the precision they mean, the HUD as what
 * differs from its defaults. A card is read by `describeBench` on the live result (full precision, never through here), and from the
 * saved JSON by `scripts/fetch-submissions.mjs`. No imports but a type: the scripts load this file as it is.
 */

/**
 * Decimals each card key is kept to: a ms to 0.01 (the clock under it resolves 0.1 ms at best, `timerStepMs`), a rate to 0.1, a
 * share (%) to 0.1, seconds to the ms, a count a whole number. A key that is not here keeps every digit. The decimals apply to the
 * value under the key, and to an array's or object's numbers under it (`fpsPerSecond`, `tierPct`) unless they name their own.
 */
export const DECIMALS: Readonly<Record<string, number>> = {
  mean: 2,
  p50: 2,
  p95: 2,
  p99: 2,
  max: 2,
  cpuMs: 2,
  drawMs: 2,
  ms: 2,
  simMs: 2,
  excessMs: 0,
  longestMs: 1,
  longestCpuMs: 1,
  settleS: 2,
  gpuMs: 2,
  msPerSimS: 1,
  unattributedMsPerSimS: 1,
  workPerSimS: 0,
  unitUs: 1,
  clockS: 3,
  simSpreadPct: 1,
  msPerStep: 2,
  simMsPerSimS: 1,
  simMsPerSecond: 1,
  fps: 1,
  fpsLow1: 1,
  fpsLow01: 1,
  medianMs: 2,
  p95Ms: 2,
  p99Ms: 2,
  p999Ms: 2,
  maxMs: 2,
  thresholdMs: 1,
  fpsThirds: 1,
  fpsPerSecond: 1,
  stepsPerFrame: 2,
  fineCutsPerSimS: 1,
  simSpeedPct: 1,
  coarsePct: 1,
  tierPct: 1,
  detailPct: 1,
  wallS: 3,
  atS: 3,
  tierS: 3,
  lostSimS: 3,
  calls: 0,
  triangles: 0,
};

/** `value` with every number rounded to its key's decimals (`DECIMALS`); arrays and objects are copied, not changed. */
export function roundCard(value: unknown, decimals?: number): unknown {
  if (typeof value === "number") {
    if (decimals === undefined || !Number.isFinite(value)) return value;
    const scale = 10 ** decimals;
    return Math.round(value * scale) / scale;
  }
  if (Array.isArray(value)) return value.map((v) => roundCard(v, decimals));
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundCard(v, DECIMALS[k] ?? decimals)]));
  return value;
}

/** The HUD state that is not a setting: what the game reads out (the race standings, the derby board, the speeds, the clock) and the piston and door scenes' readouts. A card keeps none of it. */
const HUD_READOUT = [
  "race", "derbyBoard", "derbyView", "fleetView", "derbyWinner", "derbyDecided", "derbyTime", "elapsed", "speedA", "speedB", "closingKph",
  "impactKph", "eta", "fps", "phase", "trackSerial", "nowPlaying", "drift", "boost", "pistons", "doors", "viewFar", "pixelRatio", "shadowMap",
] as const satisfies readonly (keyof CrashHudState)[];

/** The HUD as a card carries it: only the keys that are settings and differ from `defaults` (`INITIAL_HUD`); a key that is absent is at its default. */
export function hudSettings(hud: CrashHudState, defaults: CrashHudState): Partial<CrashHudState> {
  const readout: readonly string[] = HUD_READOUT;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(hud)) {
    if (!readout.includes(key) && JSON.stringify(value) !== JSON.stringify(defaults[key as keyof CrashHudState])) kept[key] = value;
  }
  return kept as Partial<CrashHudState>;
}

/** A list of flat records as the wire carries it: the keys once, then one array of values a record, in the keys' order (no key is repeated per record). */
interface Table {
  keys: string[];
  rows: unknown[][];
}

/** `records` as a `Table` (the keys of the first record, which every record of a list shares); a value that is a list of strings is written joined with `+`. */
export function tabulate(records: readonly Record<string, unknown>[]): Table {
  const keys = records.length ? Object.keys(records[0]!) : [];
  return { keys, rows: records.map((r) => keys.map((k) => (Array.isArray(r[k]) && (r[k] as unknown[]).every((v) => typeof v === "string") ? (r[k] as string[]).join("+") : r[k]))) };
}

/**
 * The card as it goes on the wire: rounded (`roundCard`), and the lists of records that a card carries (the A/B switches, the hitch rows, the page's entries) as `Table`s so no
 * key repeats per record; the `Columns` the frame series is already in are left as they are.
 */
export function wireCard(result: Record<string, unknown>): unknown {
  const rounded = roundCard(result) as Record<string, unknown>;
  const asTable = (list: unknown): unknown => (Array.isArray(list) ? tabulate(list as Record<string, unknown>[]) : list);
  const hitches = (h: unknown): unknown => (h && typeof h === "object" ? { ...(h as Record<string, unknown>), rows: asTable((h as { rows: unknown }).rows) } : h);
  return { ...rounded, switches: asTable(rounded["switches"]), pageEvents: asTable(rounded["pageEvents"]), hitches: hitches(rounded["hitches"]), sweepHitches: hitches(rounded["sweepHitches"]) };
}
