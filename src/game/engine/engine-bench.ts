import { FX_TIERS, type FxTier } from "../present/engine-post.ts";
import { benchPlan, leaderAhead, type BenchPlan } from "./engine-bench-plan.ts";
import { watchPage, type PageWatch } from "./engine-bench-page.ts";
import { warmUp } from "./engine-bench-warm.ts";
import { describeBench, DETAIL_ARMS, PACE_ARM, PAGE_PHASES, PHASE_AB_DETAIL, PHASE_AB_FX, PHASE_AB_PACE, PHASE_AB_SKY, PHASE_REPLAY, PHASE_SWEEP, PHASE_WARM, PHASE_WINDOW, SKY_ARM, stat, type BenchResult, type LongTasks, type RunOptions } from "./engine-bench-report.ts";
import { CLIP_WAIT_S, CRASH_GAP, CRASH_SPEED, ragdollCost, REPLAY_SETTLE_S, REPLAY_TIER_S, START_WAIT_S, type ReplayFrames } from "./engine-bench-replay.ts";
import { BENCH, QUICK, blocksOf, CAP, deviceOf, readBattery, replayResult, RUNG_SLOTS, pageStateOf, rungSlot, settingsOf, skyModeOf, skyPinOf, summarize, tap, timerStep, topTier, watchLongTasks, watchWork, windowGpuMs, WINDOW_BLOCK, wrecks, type BenchParts, type ReplayArm, type SkyPin, type Samples, type Tap, type Window } from "./bench-measure.ts";
import type { HighlightClip } from "../match/highlights.ts";
import type { SimPacer } from "./sim-pace.ts";
import { BENCH_BUTTON_STYLE, BENCH_CARD_STYLE, SETTING_KEY } from "./constants.ts";
import type { SkyMode } from "../present/sky-dome.ts";
import { hudSettings, wireCard } from "./bench-card.ts";
import { analyzeFrames, FrameRecord, type FrameStats } from "./bench-frames.ts";
import { alternate, enterPhase, frame, FRAME_CPU, FRAME_DRAW, FRAME_DT, FRAME_SIM, newBeat, nextFrame, restartLab, pinSky, settleFrames, waitFor, type Beat } from "./bench-frame.ts";
import { INITIAL_HUD, type CrashHudState } from "../hud/hud-store.ts";
import { ArmBadge } from "./bench-badge.ts";
import { epicenterOn } from "../deform/epicenter.ts";
import { enterBenchScene, type SceneEngine } from "./bench-scene.ts";
import { HitchLog } from "./bench-hitch.ts";
import { SettleWatch, type SettleResult } from "./bench-settle.ts";
import { endSweep, setDetailArm, sweep, type SweepEngine } from "./bench-sweep.ts";

/** What `runBench` drives: the real engine, by its public face. */
interface BenchEngine extends SweepEngine, SceneEngine {
  readonly ready: Promise<void>;
  readonly pace: SimPacer;
  fadeScenes: boolean;
  start(): void;
  setFxTier(tier: FxTier): void;
  setFxAuto(): void;
  /** The Sky setting. */
  setSky(mode: SkyMode): void;
  /** Fetch the Ultra look (the `ultra=1` arm needs it in before its first block); false when it did not load. */
  loadUltra(): Promise<boolean>;
  benchParts(): BenchParts;
  /** The run's crash as the reel plays it from this frame on (the clip's size on the wire), and the end of that reel; the reel's sim step ms since the last read. */
  playBenchReel(clip: HighlightClip): Promise<number>;
  stopBenchReel(): void;
  takeReelStepMs(): number;
}


/** The clipboard, through the async API where the page is allowed it, else a hidden textarea. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.append(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

/** A bench card posted: the receipt id the server gave, or why it did not go. */
type BenchReceipt = { id: string } | { error: string };
/** What posts a bench card's JSON (the page owns the server's address and the loop's context). */
type SubmitBench = (payload: object) => Promise<BenchReceipt>;

/** The attribute that marks a bench card's element, so the next bench of a page can remove it. */
const CARD_ATTRIBUTE = "data-bench-card";

/**
 * A text card over the canvas; `set` rewrites it while the bench runs, `done` swaps in the results and the buttons that copy
 * the full details as JSON and submit them, `receipt` shows how a submit went.
 */
function overlay(loopProgress: string | null): {
  set(text: string): void;
  /** The label of the arm the page is running (epicenter on or off): kept up to date by the bench's frames and by every `set`. */
  badge: ArmBadge;
  done(lines: string[], details: () => string, submit: () => void): void;
  receipt(state: "sending" | BenchReceipt): void;
} {
  // A loop that runs its next bench in this page puts the last card away.
  for (const old of document.querySelectorAll(`[${CARD_ATTRIBUTE}]`)) old.remove();
  const root = document.createElement("div");
  root.setAttribute(CARD_ATTRIBUTE, "");
  root.style.cssText = BENCH_CARD_STYLE;
  const pre = document.createElement("pre");
  pre.style.cssText = "margin:0;white-space:pre-wrap";
  const status = document.createElement("div");
  status.style.cssText = "margin-top:6px";
  const armLine = document.createElement("div");
  const badge = new ArmBadge(armLine, epicenterOn);
  badge.sync();
  root.append(armLine, pre, status);
  document.body.append(root);
  const submitButton = document.createElement("button");
  return {
    badge,
    set: (text) => {
      pre.textContent = loopProgress === null ? text : `${text} · ${loopProgress}`;
      badge.sync();
    },
    done: (lines, details, submit) => {
      pre.textContent = lines.join("\n");
      root.style.pointerEvents = "auto";
      root.style.borderLeft = "4px solid #7ee787";
      const copy = document.createElement("button");
      copy.textContent = "Copy details (JSON)";
      copy.style.cssText = BENCH_BUTTON_STYLE;
      copy.onclick = () => {
        void copyText(details()).then((ok) => void (copy.textContent = ok ? "Copied" : "Copy failed: select the card text instead"));
      };
      submitButton.textContent = "Submit \u2191";
      submitButton.style.cssText = BENCH_BUTTON_STYLE;
      submitButton.onclick = submit;
      // The card covers most of the screen: Hide, at its top so a short screen never has to scroll to it, folds it to its receipt
      // line and buttons; Show brings the text back.
      const hide = document.createElement("button");
      hide.textContent = "Hide";
      hide.style.cssText = `${BENCH_BUTTON_STYLE};margin:0 0 6px`;
      hide.onclick = () => {
        const shown = pre.style.display !== "none";
        pre.style.display = shown ? "none" : "";
        copy.style.display = shown ? "none" : "";
        hide.textContent = shown ? "Show card" : "Hide";
      };
      root.prepend(hide);
      root.append(copy, submitButton);
    },
    receipt: (state) => {
      status.replaceChildren();
      submitButton.disabled = state === "sending";
      if (state === "sending") status.textContent = "Sending\u2026";
      else if ("error" in state) status.textContent = `Not sent: ${state.error}`;
      else {
        const id = document.createElement("code");
        id.textContent = state.id;
        id.style.cssText = "user-select:all;font-size:13px;letter-spacing:.06em;padding:0 4px;background:#1c2530;border-radius:4px";
        const copyId = document.createElement("button");
        copyId.textContent = "Copy";
        copyId.style.cssText = `${BENCH_BUTTON_STYLE};margin:0 0 0 6px;padding:2px 8px`;
        copyId.onclick = () => void copyText(state.id).then((ok) => void (copyId.textContent = ok ? "Copied" : "Select the id"));
        status.append("Receipt ", id, copyId);
      }
    },
  };
}

/** Counts one frame in `slot`; a slot joins `order` the first time it is counted, so the shares come out in the order first seen. Returns the slots seen so far. */
function countSlot(counts: Float64Array, order: Uint8Array, seen: number, slot: number): number {
  if (counts[slot] === 0) order[seen++] = slot;
  counts[slot] = counts[slot]! + 1;
  return seen;
}

/** `measureS` wall seconds of one sample per frame, the engine's own auto FX tier and pacer as they are. */
async function sample(engine: BenchEngine, parts: BenchParts, t: Tap, beat: Beat, ui: { set(text: string): void }, windowS: number): Promise<{ s: Samples; w: Window; longTasks: LongTasks | null; frameStats: FrameStats }> {
  const { renderer, cine } = parts;
  const arr = (): Float64Array => new Float64Array(CAP);
  const s: Samples = {
    n: 0,
    iv: arr(),
    cpu: arr(),
    sim: arr(),
    draw: arr(),
    steps: arr(),
    coarse: arr(),
    wrecks: arr(),
    calls: arr(),
    tris: arr(),
    tierCounts: new Float64Array(FX_TIERS.length),
    tierOrder: new Uint8Array(FX_TIERS.length),
    tiersSeen: 0,
    levelCounts: new Float64Array(RUNG_SLOTS),
    levelOrder: new Uint8Array(RUNG_SLOTS),
    levelsSeen: 0,
  };
  const pace = engine.pace;
  const lost0 = pace.lost;
  const cut0 = pace.cut;
  const fine0 = parts.world.fineCuts;
  const clock0 = t.simS;
  const thrown0 = beat.lab?.throws ?? 0;
  const ragdoll0 = parts.ragdoll.stats.steps;
  const work = watchWork(parts, pace);
  // Every frame of the window, for the stats (percentiles, lows, spikes, the series): rows of one flat array, read where each frame ends.
  const rec = new FrameRecord(CAP, { row: beat.frame, pace, phases: parts.world.phases, traffic: parts.ragdoll.traffic, crashed: () => s.wrecks[s.n - 1]! });
  rec.begin();
  const longTasks = watchLongTasks();
  let wall = 0;
  let shownSecond = NaN;
  t.timing = true;
  t.block = WINDOW_BLOCK;
  while (wall < windowS && s.n < CAP) {
    await frame(engine, renderer, t, beat);
    const f = beat.frame;
    const i = s.n++;
    wall += f[FRAME_DT]!;
    s.iv[i] = f[FRAME_DT]! * 1000;
    s.cpu[i] = f[FRAME_CPU]!;
    s.sim[i] = f[FRAME_SIM]!;
    s.draw[i] = f[FRAME_DRAW]!;
    s.steps[i] = pace.steps;
    s.coarse[i] = pace.coarse ? 1 : 0;
    s.wrecks[i] = wrecks(parts);
    s.calls[i] = renderer.info.render.calls;
    s.tris[i] = renderer.info.render.triangles;
    s.tiersSeen = countSlot(s.tierCounts, s.tierOrder, s.tiersSeen, FX_TIERS.indexOf(cine.tier));
    s.levelsSeen = countSlot(s.levelCounts, s.levelOrder, s.levelsSeen, rungSlot(parts.detail.level));
    rec.push();
    work.tick(wall, t.simS - clock0);
    const second = Math.round(wall);
    if (second === shownSecond) continue;
    shownSecond = second;
    ui.set(`CRUSH BENCH: measuring ${second} / ${windowS} s`);
  }
  t.timing = false;
  const { phaseMs, counts, series } = work.end();
  return {
    s,
    w: { wallS: wall, lostSimS: pace.lost - lost0, cutFrames: pace.cut - cut0, fineCuts: parts.world.fineCuts - fine0, clockS: t.simS - clock0, thrown: (beat.lab?.throws ?? 0) - thrown0, ragdoll: ragdollCost(parts.ragdoll.stats, ragdoll0), phaseMs, counts, series },
    longTasks: longTasks.stop(),
    frameStats: analyzeFrames(rec),
  };
}

/** The run's own crash: the race restarts, then the first two grid cars go head-on (`RaceField.crashAtStart`) and the recorder files it. The clip, or why there is none. */
async function recordCrash(engine: BenchEngine, parts: BenchParts, t: Tap, beat: Beat, ui: { set(text: string): void }): Promise<HighlightClip | string> {
  const { race } = parts;
  ui.set("CRUSH BENCH: crash at the start line");
  race.reseed(BENCH.seed);
  engine.raceCommand({ type: "retry" });
  if (!(await waitFor(engine, parts, t, beat, START_WAIT_S, () => race.phase === "racing"))) return "the restarted race did not go green";
  if (!race.crashAtStart(CRASH_GAP, CRASH_SPEED)) return "fewer than two cars on the grid";
  const kept = race.recorder.ledger.kept;
  if (!(await waitFor(engine, parts, t, beat, CLIP_WAIT_S, () => kept.length > 0))) return "the crash was not filed as a highlight";
  return kept[0]!;
}

/**
 * `clip` played back as the highlight reel at each of `tiers` in turn (a restart at each: the same flight and crash every time):
 * `REPLAY_SETTLE_S` unscored (the replay's world is built on its first frames), then `REPLAY_TIER_S` scored. The reel's own sim steps are its
 * `sim` (the engine's pacer does not run while a reel plays).
 */
async function replayTiers(engine: BenchEngine, parts: BenchParts, t: Tap, beat: Beat, ui: { set(text: string): void }, clip: HighlightClip, tiers: readonly FxTier[]): Promise<{ bytes: number; arms: ReplayArm[] }> {
  const arms: ReplayArm[] = [];
  let bytes = 0;
  for (const tier of tiers) {
    ui.set(`CRUSH BENCH: replaying the crash at ${tier}`);
    engine.setFxTier(tier);
    bytes = await engine.playBenchReel(clip);
    await waitFor(engine, parts, t, beat, REPLAY_SETTLE_S, () => false);
    engine.takeReelStepMs();
    const frames: ReplayFrames = { n: 0, iv: new Float64Array(CAP), cpu: new Float64Array(CAP), sim: new Float64Array(CAP), draw: new Float64Array(CAP) };
    const ragdoll0 = parts.ragdoll.stats.steps;
    t.timing = true;
    t.block = ++t.blocks;
    const block = t.block;
    for (let wall = 0; wall < REPLAY_TIER_S && frames.n < CAP; ) {
      await frame(engine, parts.renderer, t, beat);
      const i = frames.n++;
      wall += beat.frame[FRAME_DT]!;
      frames.iv[i] = beat.frame[FRAME_DT]! * 1000;
      frames.cpu[i] = beat.frame[FRAME_CPU]!;
      frames.sim[i] = engine.takeReelStepMs();
      frames.draw[i] = beat.frame[FRAME_DRAW]!;
    }
    t.timing = false;
    arms.push({ tier, frames, block, ragdoll: ragdollCost(parts.ragdoll.stats, ragdoll0) });
  }
  engine.stopBenchReel();
  return { bytes, arms };
}

/** What the bench writes its progress to (the card's status line). */
type Ui = { set(text: string): void };

/** What the extended bench runs after the window: the four A/Bs and the replay of the run's own crash. */
interface ExtendedTail {
  pace: Awaited<ReturnType<typeof alternate>>;
  detail: Awaited<ReturnType<typeof alternate>>;
  fx: Awaited<ReturnType<typeof alternate>>;
  sky: Awaited<ReturnType<typeof alternate>> | null;
  replayRun: { bytes: number; arms: ReplayArm[]; clip: HighlightClip } | null;
  replayWhy: string | null;
  leaderEndM: number;
}

/** The extended bench's A/Bs and replay, in order; `top` is the FX tier the window mostly ran (they hold it), `pin` the sky the bench pinned. */
async function extendedTail(engine: BenchEngine, parts: BenchParts, plan: BenchPlan, t: Tap, beat: Beat, page: PageWatch, ui: Ui, fxTiers: readonly FxTier[], top: FxTier, pin: SkyPin): Promise<ExtendedTail> {
  // The A/Bs hold the tier the window mostly ran, so the pacer arms differ in the pacer alone.
  engine.setFxTier(top);
  enterPhase(beat, page, PHASE_AB_PACE);
  const pace = await alternate(engine, parts, t, beat, ui, "pacer", [{ key: PACE_ARM.fine, set: () => void (engine.pace.pin = false) }, { key: PACE_ARM.coarse, set: () => void (engine.pace.pin = true) }], BENCH.paceCycles);
  engine.pace.pin = null;
  enterPhase(beat, page, PHASE_AB_DETAIL);
  // The detail arms run at the window's tier too (the governor is off with the tier pinned), then the governor's rung is put back.
  const detail = await alternate(engine, parts, t, beat, ui, "detail", DETAIL_ARMS.map((a) => ({ key: a.key, set: () => setDetailArm(parts, a.level) })), BENCH.detailCycles);
  parts.detail.setLevel(parts.governor.level);
  enterPhase(beat, page, PHASE_AB_FX);
  const fx = await alternate(engine, parts, t, beat, ui, SETTING_KEY.fx, fxTiers.map((tier) => ({ key: tier, set: () => engine.setFxTier(tier) })), BENCH.fxCycles);
  // The sky arms hold the window's tier too, with the Sky setting put in force explicitly both ways, `full` (the whole strip, waited for) against `off`; the bench's pin goes back after, drawn, and the player's own setting when the run ends.
  enterPhase(beat, page, PHASE_AB_SKY);
  engine.setFxTier(top);
  const sky = plan.lab ? null : await alternate(engine, parts, t, beat, ui, SETTING_KEY.sky, [{ key: SKY_ARM.full, set: () => pinSky(engine, parts, t, beat, "full") }, { key: SKY_ARM.off, set: () => pinSky(engine, parts, t, beat, "off") }], BENCH.skyCycles);
  await pinSky(engine, parts, t, beat, pin);
  // What the run was like at its end is read now: the replay starts the race over.
  const leaderEndM = leaderAhead(parts, plan);
  enterPhase(beat, page, PHASE_REPLAY);
  let replayRun: ExtendedTail["replayRun"] = null;
  let replayWhy: string | null = null;
  if (plan.lab) replayWhy = "the Lab has no race to crash";
  else {
    try {
      const clip = await recordCrash(engine, parts, t, beat, ui);
      if (typeof clip === "string") replayWhy = clip;
      else replayRun = { ...(await replayTiers(engine, parts, t, beat, ui, clip, fxTiers)), clip };
    } catch (err) {
      engine.stopBenchReel();
      replayWhy = err instanceof Error ? err.message : String(err);
    }
  }
  return { pace, detail, fx, sky, replayRun, replayWhy, leaderEndM };
}

/**
 * `?bench=city`, `?bench=strip&…` or `?bench=lab` (`benchPlan`): the real game on the real clock for a fixed run, then a card of what it
 * cost. The engine's loop is stopped and each rAF hands it the measured wall time through `advance` (the real pacer deadline included),
 * so a frame is timed, not simulated. Warm-up, then `measureS` sampled with the game's own settings, then alternating A/B blocks (pacer,
 * detail, FX tier), then the crash replay. Afterwards the settings go back to automatic and the scene plays on under the card.
 * `hud` reads the HUD's state (the card keeps the settings that differ from the defaults, `bench-card.ts`); `opts.submit` posts the card's JSON (Submit button, and the bench loop's `auto` post). Null: no such bench.
 */
export async function runBench(engine: BenchEngine, hud: () => CrashHudState, search: string, opts: { submit: SubmitBench; auto: boolean; loopProgress: string | null; wake: { readonly held: boolean } | null; stepOfPage: number; options: RunOptions | null }): Promise<BenchResult | null> {
  const plan = benchPlan(search);
  if (!plan) return null;
  const ui = overlay(opts.loopProgress);
  ui.set("CRUSH BENCH: loading…");
  const timerStepMs = timerStep();
  const batteryStart = await readBattery();
  await engine.ready;
  if (plan.ultra && !(await engine.loadUltra())) throw new Error("CRUSH BENCH: ultra=1, but the Ultra look did not load (see the console)");
  // The player's Sky setting and procedural sky, put back when the run ends; the run itself pins the sky explicitly (`skyPinOf`, `pinSky`).
  const sky0 = skyModeOf(hud() as unknown as Record<string, unknown>);
  const procedural0 = hud().proceduralSky;
  const pin = skyPinOf(plan);
  const fxTiers: FxTier[] = plan.ultra ? ["minimal", "low", "high", "ultra"] : ["minimal", "low", "high"];
  engine.resetAdaptiveQuality();
  let parts = engine.benchParts();
  parts.renderer.setAnimationLoop(null);
  engine.fadeScenes = false;
  // The step's own cold load (the card's `load:` line), then the sweep warms the page on that scene, then the step starts over from a fresh page's state.
  const setupMs = enterBenchScene(engine, parts, plan);
  ui.badge.sync();

  const t = tap(engine.pace, parts);
  const beat = newBeat(parts, await nextFrame(), plan.lab, PHASE_SWEEP);
  const page = watchPage();
  beat.page = page;
  beat.wake = opts.wake;
  beat.arm = ui.badge;
  // The extended bench sweeps on every page (the loop's first in full); the quick one sweeps once, on the loop's first page, and a later page's JIT, programs and heap are warm.
  const first = opts.stepOfPage === 0;
  const sweeps = plan.extended || first;
  let sweepHitches = beat.hitches.table();
  if (sweeps) {
    enterPhase(beat, page, PHASE_SWEEP);
    await sweep(engine, parts, plan, fxTiers, plan.extended ? (first ? "full" : "short") : "quick", t, beat, ui);
    // The sweep's hitches are its own table (every setting it visits is a switch); the run's log starts over for the warm-up, window and A/Bs.
    sweepHitches = beat.hitches.table();
    beat.hitches = new HitchLog();
    endSweep(engine, pin);
    parts = engine.benchParts();
    beat.parts = parts;
    enterBenchScene(engine, parts, plan);
    ui.badge.sync();
  }
  const sequenceStart = t.simS;
  if (beat.lab) restartLab(beat.lab, sequenceStart, 0);
  enterPhase(beat, page, PHASE_WARM);
  // The sky the window runs under is drawn before the race goes green (a step after the first brings its strip back as its scene is entered).
  await pinSky(engine, parts, t, beat, pin);
  // Quick: the grid only, and the window opens on the staged crash. Extended: `warmS` of race clock, then the page must settle (the warm-up's last frames are watched like an A/B switch's).
  await warmUp(() => frame(engine, parts.renderer, t, beat), { race: parts.race, simS: () => t.simS - sequenceStart, plan: { lab: plan.lab, warmS: plan.extended || plan.lab ? plan.warmS : 0 }, ui });
  let windowStart: SettleResult | null = null;
  let staged = false;
  if (plan.extended) {
    beat.switching = true;
    windowStart = await settleFrames(engine, parts.renderer, t, beat, new SettleWatch());
  } else if (!plan.lab) staged = parts.race.crashAtStart(CRASH_GAP, CRASH_SPEED);
  enterPhase(beat, page, PHASE_WINDOW);
  const pageState = pageStateOf(parts, opts.stepOfPage, opts.options?.loop ?? null);
  const { s, w, longTasks, frameStats } = await sample(engine, parts, t, beat, ui, plan.extended ? BENCH.measureS : QUICK.windowS);
  const leaderWindowM = leaderAhead(parts, plan);
  const top = topTier(s, parts.cine.tier);
  const settings = { ...settingsOf(parts, hud() as unknown as Record<string, unknown>, top), skyPlayer: sky0 };
  const summary = summarize(parts, plan, s, w, setupMs);
  const tail = plan.extended ? await extendedTail(engine, parts, plan, t, beat, page, ui, fxTiers, top, pin) : null;
  const leaderEndM = tail ? tail.leaderEndM : leaderWindowM;
  const pageEvents = page.stop();
  const pageSeconds = page.seconds();
  engine.setFxAuto();
  engine.setSky(sky0);
  engine.setProceduralSky(procedural0);
  if (plan.lab) engine.setTimeScale(null);

  const gpu = await t.finish();
  const abPace = tail && blocksOf(tail.pace, gpu);
  const abSky = tail?.sky ? blocksOf(tail.sky, gpu) : null;
  const abFx = tail && blocksOf(tail.fx, gpu);
  const device = await deviceOf(parts, timerStepMs, batteryStart);
  const windowGpu = windowGpuMs(gpu);
  const result: BenchResult = {
    ...summary,
    gpuMs: windowGpu.length ? stat(windowGpu) : null,
    replay: tail?.replayRun ? replayResult(tail.replayRun, gpu) : null,
    replayWhy: tail ? tail.replayWhy : "the quick bench has no replay",
    run: { extended: plan.extended, staged, options: opts.options },
    pageEvents,
    pageSeconds,
    pageState,
    longTasks,
    frameStats,
    hitches: beat.hitches.table(),
    sweepHitches,
    switches: tail && windowStart ? [{ stretch: PAGE_PHASES[PHASE_WINDOW], arm: "start", round: 1, ...windowStart }, ...tail.pace.switches, ...tail.detail.switches, ...tail.fx.switches, ...(tail.sky?.switches ?? [])] : [],
    strip: plan.strip ? { spec: plan.strip, body: plan.body, racers: plan.racers, leaderWindowM, leaderEndM } : null,
    labThrown: plan.lab ? w.thrown : null,
    settings,
    abPace: abPace && { fine: abPace[PACE_ARM.fine]!, coarse: abPace[PACE_ARM.coarse]! },
    abFx: abFx && { minimal: abFx["minimal"]!, low: abFx["low"]!, high: abFx["high"]!, ...(plan.ultra ? { ultra: abFx["ultra"]! } : {}) },
    abDetail: tail && blocksOf(tail.detail, gpu),
    abSky: abSky && { full: abSky[SKY_ARM.full]!, off: abSky[SKY_ARM.off]! },
    device,
  };
  const payload = (): object => ({ at: new Date().toISOString(), url: location.href, userAgent: navigator.userAgent, hud: hudSettings(hud(), INITIAL_HUD), result: wireCard(result as unknown as Record<string, unknown>) });
  const send = async (): Promise<BenchReceipt> => {
    ui.receipt("sending");
    const receipt = await opts.submit(payload());
    ui.receipt(receipt);
    return receipt;
  };
  ui.done(describeBench(result), () => JSON.stringify(payload(), null, 1), () => void send());
  (window as unknown as { __benchResult?: BenchResult }).__benchResult = result;
  console.log("CRUSH BENCH", JSON.stringify(result));
  engine.start();
  // The bench loop posts each card as it finishes, before the page moves on to the next bench.
  if (opts.auto) await send();
  return result;
}
