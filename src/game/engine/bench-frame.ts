import * as THREE from "three";
import { epicenterOn } from "../deform/epicenter.ts";
import { SKY_DRAWN, type SkyMode } from "../present/sky-dome.ts";
import type { LabPresetId } from "../scenes/lab.ts";
import { BENCH, emptyAcc, wrecks, type Acc, type BenchParts, type SkyPin, type Tap } from "./bench-measure.ts";
import { CAUSE, FRAME, HitchLog } from "./bench-hitch.ts";
import { SettleWatch, type SettleResult, type SwitchHitch } from "./bench-settle.ts";
import type { BenchPlan } from "./engine-bench-plan.ts";
import type { PageWatch } from "./engine-bench-page.ts";

/** What one frame of the bench drives: the engine's own frame (`advance`), the pacer it reads steps from, and the Lab's sets and throws. */
export interface FrameEngine {
  readonly pace: { readonly steps: number };
  advance(seconds: number, opts?: { frameDt?: number; render?: boolean }): void;
  /** The HUD's Reset: the scene's set put back. */
  reset(): void;
  setLabPreset(id: LabPresetId): void;
  /** Lab item `thing` let go at `velocity` (m/s). */
  flickLab(thing: number, velocity: THREE.Vector3): void;
}

// ponytail: executor form, the project's TS lib predates Promise.withResolvers.
export const nextFrame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve));

/** Seconds after a focus or visibility change in which a hitch counts it as a cause. */
const FOCUS_WINDOW_MS = 1500;
/** The first sim seconds of a page run cold code (the JIT has not optimised the sim yet): a hitch there is marked `cold`. */
const COLD_SIM_S = 2;
/** Messages posted to the ragdoll worker in one frame that mean a throw or a cage went with it (a plain frame posts one). */
const RAGDOLL_BURST = 3;
/** The longest wall time one frame hands the engine (s): a hang is one frame of the card's numbers at most, whatever it took. */
const FRAME_DT_CAP_S = 0.1;

/** One frame the bench ran, as the slots of `Beat.frame` (`FRAME`, owned by the hitch log that reads them). */
export const FRAME_DT = FRAME.dt;
export const FRAME_CPU = FRAME.cpu;
export const FRAME_SIM = FRAME.sim;
export const FRAME_DRAW = FRAME.draw;
const FRAME_INTERVAL = FRAME.interval;

/**
 * Where the Lab bench's sequence is: the sim second it (re)started at and the throw it started with, the segment under way (-1:
 * none yet), the set up, whether the segment's throw has left, and the throws so far.
 */
interface LabRun {
  plan: NonNullable<BenchPlan["lab"]>;
  origin: number;
  first: number;
  segment: number;
  preset: LabPresetId | null;
  thrown: boolean;
  throws: number;
}

/**
 * The loop's state between rAFs: the last stamp, so a frame's dt is the real interval wherever the caller picks the loop up, the
 * last frame's readings (`FRAME`), the Lab bench's throws (null: a race), and the hitch recorder with what it reads each frame: the
 * stretch of the run (`PAGE_PHASES` index) and when it began, whether a switch's settle is being watched, and the counters whose change
 * in a frame names a cause (`readCauses`). `page` is set once the run's page watch exists.
 */
export interface Beat {
  prev: number;
  frame: Float64Array;
  lab: LabRun | null;
  parts: BenchParts;
  hitches: HitchLog;
  page: PageWatch | null;
  phase: number;
  phaseStart: number;
  switching: boolean;
  /** The loop's screen wake lock (null: none held), read once a frame for the per-second series. */
  wake: { readonly held: boolean } | null;
  /** The card's live arm label, brought up to date every frame (`ArmBadge.sync`); null: none. */
  arm: { sync(): void } | null;
  seen: { wrecks: number; programs: number; textures: number; geometries: number; ragdollMessages: number };
}

/** A beat for a run of `parts` (the Lab's sequence when `plan.lab` is set), the first stretch being `phase`. */
export function newBeat(parts: BenchParts, prev: number, lab: BenchPlan["lab"], phase: number): Beat {
  return {
    prev,
    frame: new Float64Array(FRAME.fields),
    lab: lab ? { plan: lab, origin: 0, first: 0, segment: -1, preset: null, thrown: false, throws: 0 } : null,
    parts,
    hitches: new HitchLog(),
    page: null,
    phase,
    phaseStart: performance.now(),
    switching: false,
    wake: null,
    arm: null,
    seen: { wrecks: 0, programs: 0, textures: 0, geometries: 0, ragdollMessages: 0 },
  };
}

const _launch = new THREE.Vector3();

/**
 * The Lab's sequence on the sim seconds stepped (`Tap.simS`): each `segmentS` the next throw's set loads (the player's set picker,
 * or Reset for the set already up), and `settleS` into the segment its thrower leaves at the throw's stored velocity (the player's
 * flick), so a device steps the same throws per sim-second however fast it runs.
 */
function driveLab(engine: FrameEngine, t: Tap, run: LabRun): void {
  const k = Math.floor((t.simS - run.origin) / run.plan.segmentS);
  const next = run.plan.throws[(run.first + k) % run.plan.throws.length]!;
  if (k !== run.segment) {
    run.segment = k;
    run.thrown = false;
    if (run.preset === next.preset) engine.reset();
    else engine.setLabPreset(next.preset);
    run.preset = next.preset;
  }
  if (run.thrown || t.simS - run.origin - k * run.plan.segmentS < run.plan.settleS) return;
  run.thrown = true;
  run.throws++;
  engine.flickLab(0, _launch.set(next.along, next.up, 0));
}

/** The Lab's sequence starts over now at throw `first` (an A/B block: every arm of a round replays the same throw from its set's load). */
export function restartLab(run: LabRun, simS: number, first: number): void {
  run.origin = simS;
  run.first = first;
  run.segment = -1;
}

/**
 * The `CAUSE` bits of the frame that just ran: what changed since the one before. Reads counters only, each a property read (nothing
 * allocates). The page's focus and visibility count for `FOCUS_WINDOW_MS` after a change, the first `COLD_SIM_S` sim seconds of the run are cold.
 */
function readCauses(beat: Beat, t: Tap): number {
  const { parts, seen } = beat;
  const info = parts.renderer.info;
  let causes = beat.switching ? CAUSE.settingSwitch : 0;
  if (beat.page?.changedWithin(FOCUS_WINDOW_MS)) causes |= CAUSE.focus;
  const crashed = wrecks(parts);
  if (crashed > seen.wrecks) causes |= CAUSE.crash;
  seen.wrecks = crashed;
  const messages = parts.ragdoll.traffic.messages;
  if (messages - seen.ragdollMessages >= RAGDOLL_BURST) causes |= CAUSE.ragdoll;
  seen.ragdollMessages = messages;
  const programs = info.programs?.length ?? 0;
  if (programs !== seen.programs) causes |= CAUSE.shader;
  seen.programs = programs;
  if (info.memory.textures !== seen.textures || info.memory.geometries !== seen.geometries) causes |= CAUSE.gpuResources;
  seen.textures = info.memory.textures;
  seen.geometries = info.memory.geometries;
  if (t.simS < COLD_SIM_S) causes |= CAUSE.cold;
  return causes;
}

/** A new stretch of the run (`PAGE_PHASES` index): the page watch and the hitch log's clock follow. */
export function enterPhase(beat: Beat, page: PageWatch, phase: number): void {
  page.phase(phase);
  beat.phase = phase;
  beat.phaseStart = performance.now();
}

/** One rAF: the Lab's throw when one is due, then the engine handed its measured wall time through `advance` (the loop's own `tickInner`), timed together. Writes the frame to `beat.frame` and the hitch log. */
export async function frame(engine: FrameEngine, renderer: THREE.WebGLRenderer, t: Tap, beat: Beat): Promise<void> {
  const now = await nextFrame();
  const intervalMs = now - beat.prev;
  const dt = Math.min(FRAME_DT_CAP_S, intervalMs / 1000);
  beat.prev = now;
  t.collect();
  renderer.info.reset();
  t.simMs = t.drawMs = 0;
  const f0 = performance.now();
  if (beat.lab) driveLab(engine, t, beat.lab);
  engine.advance(dt, { frameDt: dt, render: true });
  const f1 = performance.now();
  beat.frame[FRAME.now] = now;
  beat.frame[FRAME_DT] = dt;
  beat.frame[FRAME_INTERVAL] = intervalMs;
  beat.frame[FRAME_CPU] = f1 - f0;
  beat.frame[FRAME_SIM] = t.simMs;
  beat.frame[FRAME_DRAW] = t.drawMs;
  beat.frame[FRAME.atS] = (f1 - beat.phaseStart) / 1000;
  beat.hitches.frame(beat.frame, beat.phase, readCauses(beat, t));
  beat.arm?.sync();
  beat.page?.tick(beat.frame, beat.phase, beat.wake?.held === true, beat.parts.sky.drawn, epicenterOn() ? 1 : 0);
}

/** One setting of an A/B: `set` flips it before its block. */
interface Arm {
  key: string;
  set(): unknown;
}

/**
 * Frames (unscored) until the setting just switched has settled (`SettleWatch`), or its cap: the caller has set `beat.switching` and made the switch. Returns how the frames
 * after the switch went; `beat.switching` is cleared.
 */
export async function settleFrames(engine: FrameEngine, renderer: THREE.WebGLRenderer, t: Tap, beat: Beat, settle: SettleWatch): Promise<SettleResult> {
  settle.reset();
  t.timing = false;
  do await frame(engine, renderer, t, beat);
  while (!settle.push(beat.frame[FRAME_INTERVAL]!, beat.frame[FRAME_CPU]!));
  beat.switching = false;
  return settle.result();
}

/** A scored second is counted in an arm's spread when the block covered at least this much of it (the last second of a block is a part). */
const MIN_BIN_WALL_S = 0.5;
/** Seconds a block's bins hold: `blockS` and the second a hang may carry it into. */
const BIN_CAP = Math.ceil(BENCH.blockS) + 2;

/**
 * The arms in turn, `cycles` times round. Each arm is scored for `blockS` wall seconds, after its switch has settled (`settleFrames`: frames
 * unscored until the newest ones are steady, `SETTLE.capS` at most), so a hang at the switch is never in an arm's numbers; it is the arm's
 * `SwitchHitch` instead, and a switch that never settled is counted in the arm's `unsettled`. The block's seconds are binned (arrays sized once) for the arm's
 * spread: the sim ms per sim-second of each whole second, so a card says whether an arm ran steady. The race drifts under every arm alike, so the arms are compared on the
 * same stretch. Returns each arm's sums, which arm each timer query block (numbered from 1) belonged to, and the switches' hitches in the order they were made.
 */
export async function alternate(
  engine: FrameEngine,
  parts: BenchParts,
  t: Tap,
  beat: Beat,
  ui: { set(text: string): void },
  title: string,
  arms: Arm[],
  cycles: number,
): Promise<{ accs: Map<string, Acc>; blockKeys: Map<number, string>; switches: SwitchHitch[] }> {
  const { renderer } = parts;
  const accs = new Map(arms.map((a) => [a.key, emptyAcc()]));
  const blockKeys = new Map<number, string>();
  const switches: SwitchHitch[] = [];
  const settle = new SettleWatch();
  const binSim = new Float64Array(BIN_CAP);
  const binClock = new Float64Array(BIN_CAP);
  const binWall = new Float64Array(BIN_CAP);
  for (let c = 0; c < cycles; c++) {
    for (const a of arms) {
      beat.switching = true;
      await a.set();
      ui.set(`CRUSH BENCH: ${title} ${a.key}, round ${c + 1} / ${cycles}`);
      if (beat.lab) restartLab(beat.lab, t.simS, c);
      const settled = await settleFrames(engine, renderer, t, beat, settle);
      switches.push({ stretch: title, arm: a.key, round: c + 1, ...settled });
      t.block = ++t.blocks;
      blockKeys.set(t.block, a.key);
      t.timing = true;
      const acc = accs.get(a.key)!;
      if (!settled.settled) acc.unsettled++;
      const clock0 = t.simS;
      const fine0 = parts.world.fineCuts;
      binSim.fill(0);
      binClock.fill(0);
      binWall.fill(0);
      let wall = 0;
      while (wall < BENCH.blockS) {
        const clockBefore = t.simS;
        await frame(engine, renderer, t, beat);
        const f = beat.frame;
        const bin = Math.min(BIN_CAP - 1, Math.floor(wall));
        wall += f[FRAME_DT]!;
        binSim[bin] = binSim[bin]! + f[FRAME_SIM]!;
        binClock[bin] = binClock[bin]! + (t.simS - clockBefore);
        binWall[bin] = binWall[bin]! + f[FRAME_DT]!;
        acc.frames++;
        acc.sim += f[FRAME_SIM]!;
        acc.cpu += f[FRAME_CPU]!;
        acc.draw += f[FRAME_DRAW]!;
        acc.steps += engine.pace.steps;
        acc.calls += renderer.info.render.calls;
        acc.tris += renderer.info.render.triangles;
      }
      for (let b = 0; b < BIN_CAP; b++) {
        if (binWall[b]! < MIN_BIN_WALL_S || binClock[b]! <= 0) continue;
        const perSimS = binSim[b]! / binClock[b]!;
        acc.binN++;
        acc.binSum += perSimS;
        acc.binSumSq += perSimS * perSimS;
      }
      acc.wallS += wall;
      acc.clockS += t.simS - clock0;
      acc.fineCuts += parts.world.fineCuts - fine0;
    }
  }
  t.timing = false;
  return { accs, blockKeys, switches };
}

/** Frames of a wait: one `frame` each, with no samples, until `done` or `limitS` wall seconds. True when `done` came first. */
export async function waitFor(engine: FrameEngine, parts: BenchParts, t: Tap, beat: Beat, limitS: number, done: () => boolean): Promise<boolean> {
  t.timing = false;
  for (let wall = 0; !done(); wall += beat.frame[FRAME_DT]!) {
    if (wall >= limitS) return false;
    await frame(engine, parts.renderer, t, beat);
  }
  return true;
}

/**
 * The Sky setting put in force explicitly (`pin`: `full` or `off`, never `auto`: an auto sky follows the FX tier, which the engine's own policy changes mid-run) with the player's procedural sky down
 * (it draws in place of the strip, so a pin of `full` would never be drawn), then frames until the dome draws it (`BENCH.skyWaitS` at most): a strip's decode is the page's first ask, not the arm's cost.
 * True when it is drawn.
 */
export async function pinSky(engine: FrameEngine & { setSky(mode: SkyMode): void; setProceduralSky(cover: number | null): void }, parts: BenchParts, t: Tap, beat: Beat, pin: SkyPin): Promise<boolean> {
  engine.setProceduralSky(null);
  engine.setSky(pin);
  return waitFor(engine, parts, t, beat, BENCH.skyWaitS, () => parts.sky.drawn === (pin === "off" ? SKY_DRAWN.off : SKY_DRAWN.full));
}
