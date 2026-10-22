import { FX_TIER_ULTRA } from "../present/constants.ts";
import { FX_TIERS } from "../present/engine-post.ts";
import { TRACK_ID } from "../world/constants.ts";
import { BENCH_KIND, BENCH_QUERY, COURSE_QUERY, EPI_QUERY, EPI_STEP_SUFFIX, EXTENDED_QUERY, QUALITY_QUERY, STRIP_QUERY, ULTRA_QUERY } from "./constants.ts";
import type { RunOptions } from "./engine-bench-report.ts";

/**
 * The benchmark loop: one cycle of benches (`?bench=…&loop=<session>&cycle=<n>&step=<i>`), all run in the one page (`driveLoop`: no
 * navigation between steps, so the page keeps its fullscreen and its screen wake lock), each posting its card before the next begins. The address says
 * which step the page is on, and is the loop's whole state: a reload resumes there. This file is the loop's rules; `components/bench-run.ts`
 * holds the page's side.
 */

/** One bench of a cycle: the page query that runs it (`benchPlan`). */
interface BenchStep {
  id: string;
  query: string;
}

/**
 * The biggest of the nine race courses: `bench-loop.test.ts` measures every course's road (dam-spine 4531 m, then four-count
 * 4079 m; the city is 683 m), so a longer course added later fails there until this follows.
 */
export const BIGGEST_COURSE = TRACK_ID.damSpine;

/** The most complex course to draw (the National Mall: 2753 props, about 500k triangles a frame), the cycle's last step. */
const MOST_PROPS_COURSE = TRACK_ID.nationalMall;

const benchQuery = (kind: string): string => `${BENCH_QUERY}=${kind}`;

/** The four maps of a cycle. */
const MAPS: readonly BenchStep[] = [
  { id: BENCH_KIND.strip, query: benchQuery(BENCH_KIND.strip) },
  { id: BENCH_KIND.city, query: benchQuery(BENCH_KIND.city) },
  { id: BIGGEST_COURSE, query: `${benchQuery(BENCH_KIND.city)}&${COURSE_QUERY}=${BIGGEST_COURSE}` },
  { id: MOST_PROPS_COURSE, query: `${benchQuery(BENCH_KIND.city)}&${COURSE_QUERY}=${MOST_PROPS_COURSE}` },
];

/** The extended cycle: every map twice, the epicenter activation off and then on (`&epi=1`; same seed, same cars): the cards of a pair differ in nothing else, so a cycle is its own A/B. */
const CYCLE: readonly BenchStep[] = MAPS.flatMap((s) => [s, { id: `${s.id}${EPI_STEP_SUFFIX}`, query: `${s.query}&${EPI_QUERY}=1` }]);

/** The Ultra tier exists in this build (`FX_TIERS`): the loop's Ultra arm (`loopultra=1`) exists only then. */
const FX_TIER_IDS: readonly string[] = FX_TIERS;
export const ULTRA_AVAILABLE: boolean = FX_TIER_IDS.includes(FX_TIER_ULTRA);

/** The query names that carry a loop through the bench pages' addresses (`?bench=…` is the step's own query, `ultra=1` the Ultra arm's, `epi=1` the epicenter arm's). */
const LOOP_QUERY = { session: "loop", cycle: "cycle", step: "step", keep: "keep", auto: "auto", ultraNext: "loopultra", ultraCycle: "cycleultra", extended: EXTENDED_QUERY, epi: "loopepi", choose: "choose" } as const;

/**
 * The loop's whole state, read from the address of the bench page it is on: its session (every submission of the loop carries
 * it), the cycle count from 1, the step in the cycle, and the options. The options are read at the end of every step, so an edit
 * to the address takes effect from the next step.
 */
export interface BenchRun {
  session: string;
  loop: number;
  step: number;
  /** This cycle's benches each run their Ultra arm (`&ultra=1`, a fourth FX tier in the same run): fixed when the cycle starts, so a `loopultra` edited mid-cycle neither adds nor drops an arm. */
  ultra: boolean;
  /** Run the cycle again when it ends. */
  keep: boolean;
  /** Reload onto a newly deployed build between benches. */
  auto: boolean;
  /** The next cycle's benches each run their Ultra arm (this cycle's own choice is `ultra`). */
  ultraNext: boolean;
  /** The extended bench (A/B blocks and the replay on each page, every map under both arms): false is the quick bench, one arm of each map, the window alone. */
  extended: boolean;
  /** Every map runs its epicenter arm: the quick cycle under it alone, the extended one under both arms (off, then on); off, every map runs once without it. */
  epi: boolean;
}

/**
 * The extended cycle with the epicenter on: always the same eight steps (four maps, each off and on); with `ultra` set and Ultra in the build, each page also runs its Ultra arm (no second pass for it).
 * The pair's order alternates with the cycle (off then on in cycle 1, on then off in cycle 2, ...): the second page of a pair loads onto a warm device and a collected heap,
 * so a fixed order would charge that to one arm.
 */
export function cycleOf(ultra: boolean, loop = 1): BenchStep[] {
  const arm = ultra && ULTRA_AVAILABLE;
  const steps = CYCLE.map((s) => (arm ? { id: s.id, query: `${s.query}&${ULTRA_QUERY}=1` } : s));
  if (loop % 2 === 1) return steps;
  return steps.map((_, i) => steps[i ^ 1]!);
}

/** Each map once, under the epicenter arm `on` (`&epi=1`) or without; Ultra's look on every page when `ultra` is set and the build has it. */
function oneArmCycleOf(ultra: boolean, on: boolean): BenchStep[] {
  return MAPS.map((s) => {
    const ultraArm = ultra && ULTRA_AVAILABLE ? `&${ULTRA_QUERY}=1` : "";
    return on ? { id: `${s.id}${EPI_STEP_SUFFIX}`, query: `${s.query}&${EPI_QUERY}=1${ultraArm}` } : { id: s.id, query: `${s.query}${ultraArm}` };
  });
}

/** The benches `run` is on the cycle of: both arms of each map, or each map once under the epicenter arm when it is on. */
function stepsOf(run: BenchRun): BenchStep[] {
  return run.extended && run.epi ? cycleOf(run.ultra, run.loop) : oneArmCycleOf(run.ultra, run.epi);
}

/**
 * A new loop with every option on, as the Benchmark entry offers it: the quick bench (default) is the four maps once each under the epicenter arm, the
 * extended one both arms with the A/B blocks; each runs again when it ends and reloads onto new builds.
 */
export function startRun(session: string, extended = false): BenchRun {
  return { session, loop: 1, step: 0, ultra: ULTRA_AVAILABLE, keep: true, auto: true, ultraNext: ULTRA_AVAILABLE, extended, epi: true };
}

/** The options the Benchmark's chooser offers before a loop starts: they hold for every page of it. */
export type BenchOptions = Pick<BenchRun, "keep" | "epi" | "ultra" | "extended">;

/** `search` with `options` written over the loop options it carries, for `runFromPage` to start the loop under them. */
export function withOptions(search: string, options: BenchOptions): string {
  const q = new URLSearchParams(search);
  const flags = [
    [LOOP_QUERY.keep, options.keep],
    [LOOP_QUERY.epi, options.epi],
    [LOOP_QUERY.ultraNext, options.ultra],
    [LOOP_QUERY.ultraCycle, options.ultra],
    [LOOP_QUERY.extended, options.extended],
  ] as const;
  for (const [name, on] of flags) q.set(name, on ? "1" : "0");
  return `?${q.toString()}`;
}

/** The Benchmark entry's page: the cycle's first map with no loop yet, marked to open on the chooser. */
export function entryHref(href: string, extended: boolean): string {
  const url = new URL(href);
  url.search = `?${MAPS[0]!.query}${extended ? `&${LOOP_QUERY.extended}=1` : ""}&${LOOP_QUERY.choose}=1`;
  url.hash = "";
  return url.toString();
}

/** Only an entry (a button, or a bare `/bench`) opens the chooser; any other address starts its loop at once under the options it sets. */
export function asksOptions(search: string): boolean {
  return new URLSearchParams(search).get(LOOP_QUERY.choose) === "1";
}

/** Where `/bench` points: with no params, the entry (chooser first); with params, the strip unless they name a bench, running at once. */
export function benchRouteSearch(params: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.keys(params).length === 0 ? { [BENCH_QUERY]: BENCH_KIND.strip, [LOOP_QUERY.choose]: 1 } : { [BENCH_QUERY]: BENCH_KIND.strip, ...params };
}

/**
 * A bench page opened by its address alone (typed, shared, bookmarked, or the chooser's): a new loop at the step that runs this page's own bench, with
 * the options its address sets (`keep`, `auto`, `loopepi`, `loopultra`, `cycleultra`; `=0` is off) and every option it leaves out on, as the
 * Benchmark entry starts one; null for a bench no step of the cycle runs (the lab, another course), which runs once as asked. The
 * page's own `ultra=1` is the page's alone: a page opened without it runs no Ultra arm, the steps after it do. Its own `epi=1` picks the arm of a pair only
 * where the cycle runs both.
 */
export function runFromPage(search: string, session: string): BenchRun | null {
  const q = new URLSearchParams(search);
  const fresh = startRun(session, q.get(LOOP_QUERY.extended) === "1");
  const option = (name: string, absent: boolean): boolean => (q.has(name) ? q.get(name) !== "0" : absent);
  const run: BenchRun = {
    ...fresh,
    ultra: option(LOOP_QUERY.ultraCycle, fresh.ultra) && ULTRA_AVAILABLE,
    keep: option(LOOP_QUERY.keep, fresh.keep),
    auto: option(LOOP_QUERY.auto, fresh.auto),
    ultraNext: option(LOOP_QUERY.ultraNext, fresh.ultraNext) && ULTRA_AVAILABLE,
    epi: option(LOOP_QUERY.epi, fresh.epi),
  };
  const steps = stepsOf(run);
  for (let i = 0; i < steps.length; i++) {
    const s = new URLSearchParams(steps[i]!.query);
    if (s.get(BENCH_QUERY) === q.get(BENCH_QUERY) && s.get(COURSE_QUERY) === q.get(COURSE_QUERY) && (!(run.extended && run.epi) || (s.get(EPI_QUERY) === "1") === (q.get(EPI_QUERY) === "1"))) return { ...run, step: i };
  }
  return null;
}

/** The step a run is at. */
export function stepOf(run: BenchRun): BenchStep {
  const cycle = stepsOf(run);
  return cycle[run.step % cycle.length]!;
}

/** The run after its current step is done: the next step, the next cycle (taking `ultraNext` as it is now) when `keep` is set, or null when the loop is over. */
export function advance(run: BenchRun): BenchRun | null {
  if (run.step + 1 < stepsOf(run).length) return { ...run, step: run.step + 1 };
  return run.keep ? { ...run, loop: run.loop + 1, step: 0, ultra: run.ultraNext } : null;
}

/** The address that runs `run`'s step: this page's path, the bench's query, the strip-shaping params and the quality arms this page carries (`len`, `cars`, `draw`, …: the cycle's strip step reads them, whichever step this is) and the loop's state; no fragment, no leftover `v`. */
export function stepHref(href: string, run: BenchRun): string {
  const url = new URL(href);
  const flags = [
    [LOOP_QUERY.keep, run.keep],
    [LOOP_QUERY.auto, run.auto],
    [LOOP_QUERY.ultraNext, run.ultraNext],
    [LOOP_QUERY.ultraCycle, run.ultra],
    [LOOP_QUERY.extended, run.extended],
    [LOOP_QUERY.epi, run.epi],
  ] as const;
  const query = [stepOf(run).query, `${LOOP_QUERY.session}=${run.session}`, `${LOOP_QUERY.cycle}=${run.loop}`, `${LOOP_QUERY.step}=${run.step}`];
  for (const name of [...Object.values(STRIP_QUERY), ...Object.values(QUALITY_QUERY)]) {
    const value = url.searchParams.get(name);
    if (value !== null) query.push(`${name}=${encodeURIComponent(value)}`);
  }
  for (const [name, on] of flags) query.push(`${name}=${on ? 1 : 0}`);
  url.search = `?${query.join("&")}`;
  url.hash = "";
  return url.toString();
}

/** This page asks for a bench (`?bench=…`), whether a loop sent it there or someone opened it by hand. */
export function isBenchPage(search: string): boolean {
  return new URLSearchParams(search).has(BENCH_QUERY);
}

/**
 * The share `#` (`hud/share-url.ts`) this page follows: none on a bench page, whose bench plan owns the scene and every setting, so a
 * `#` left in the address (a stale one, or one pasted with the bench's query) neither switches its scene at boot nor on an edit.
 */
export function shareHashOf(search: string, hash: string): string | null {
  return isBenchPage(search) ? null : hash;
}

/**
 * A new loop's session id: eight base-36 characters from `crypto.getRandomValues`, which every page has (`crypto.randomUUID` exists
 * only in a secure context, so a build opened over plain http on the LAN could start no loop).
 */
export function newSession(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => (byte % 36).toString(36)).join("");
}

/** This page asks for reloading onto a newly deployed build (`?auto=1`), on a bench page between benches and on a plain page when idle. */
export function autoReloadAsked(search: string): boolean {
  return new URLSearchParams(search).get(LOOP_QUERY.auto) === "1";
}

/** The options `run` was started with (the chooser's Loop, Epicenter, Ultra): its card's `run.options`. */
export function optionsOf(run: BenchRun): RunOptions {
  return { loop: run.keep, epi: run.epi, ultra: run.ultra };
}

/**
 * What every submission of a loop carries, so data across builds lines up: the session, the cycle count, the step and the options the run was started with
 * (`options.loop`, …: a submission's settings are flat scalars, the server refuses an object).
 */
export function loopSettings(run: BenchRun, step: BenchStep) {
  const options = optionsOf(run);
  return { session: run.session, loop: run.loop, step: step.id, "options.loop": options.loop, "options.epi": options.epi, "options.ultra": options.ultra };
}

/** The loop's place on the bench card: its cycle count and the step in the cycle, e.g. `loop 2, step 1/3`. */
export function loopProgress(run: BenchRun): string {
  const stepCount = stepsOf(run).length;
  return `loop ${run.loop}, step ${(run.step % stepCount) + 1}/${stepCount}`;
}

/** A whole number from `q`, `fallback` when it is absent, null when it is present but not one. */
function countOf(q: URLSearchParams, name: string, fallback: number): number | null {
  const text = q.get(name);
  if (text === null) return fallback;
  return /^\d{1,6}$/.test(text) ? Number(text) : null;
}

/**
 * The loop a bench page's address names (`loop=<session>`, a bench page only), or null when it names none or a broken one. The
 * cycle count (from 1) and the step default to the first, so a bench opened by hand with just a session becomes a loop from there.
 * An option the address leaves out is on (`=0` turns it off), as for a loop the Benchmark entry starts; the cycle's own Ultra shape
 * (`cycleultra`) is the exception, off when absent, since the step count it numbers must stay what it was.
 */
export function parseRun(search: string): BenchRun | null {
  const q = new URLSearchParams(search);
  const session = q.get(LOOP_QUERY.session);
  if (!isBenchPage(search) || session === null || !/^[a-z0-9]{4,24}$/.test(session)) return null;
  const loop = countOf(q, LOOP_QUERY.cycle, 1);
  const step = countOf(q, LOOP_QUERY.step, 0);
  if (loop === null || loop < 1 || step === null) return null;
  const on = (name: string): boolean => q.get(name) !== "0";
  return { session, loop, step, ultra: q.get(LOOP_QUERY.ultraCycle) === "1", keep: on(LOOP_QUERY.keep), auto: on(LOOP_QUERY.auto), ultraNext: on(LOOP_QUERY.ultraNext) && ULTRA_AVAILABLE, extended: q.get(LOOP_QUERY.extended) === "1", epi: on(LOOP_QUERY.epi) };
}

/** What the loop's driver asks of the page it runs in. */
interface LoopPage {
  /** Points the page's address at `run`'s step (no navigation: a reload resumes there) and returns the address's query, which names the bench. */
  show(run: BenchRun): string;
  /** Runs the step's bench and posts its card; false when the address names no bench the game knows, which ends the loop. */
  runStep(run: BenchRun, search: string): Promise<boolean>;
  /** The pause between steps, the card and receipt on screen. */
  pause(): Promise<void>;
  /** With `run.auto` set and a newer build deployed, moves the page onto it at `run`'s step and answers true: the loop ends here, the new page continues it. The one navigation. */
  reload(run: BenchRun): Promise<boolean>;
}

/**
 * The whole loop in the page it started in: every step (each map, both arms of it, every cycle while `keep` is set) runs in turn with no navigation
 * between them, so the page stays fullscreen and keeps its wake lock, and the JIT and the heap carry from one step to the next (a step cleans the scene
 * it finds: `enterBenchScene`). Returns when the cycle is over, a step has no bench, or the page was sent onto a newer build.
 */
export async function driveLoop(first: BenchRun, page: LoopPage): Promise<void> {
  let run = first;
  for (;;) {
    if (!(await page.runStep(run, page.show(run)))) return;
    const next = advance(run);
    if (next === null || (await page.reload(next))) return;
    await page.pause();
    run = next;
  }
}
