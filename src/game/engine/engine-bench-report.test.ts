import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { browserName, describeBench, perSecond, stat, type Block, type BenchResult, type PhaseCard, type RagdollCost, type ReplayResult, type ReplayTier } from "./engine-bench-report.ts";
import { HITCH } from "./bench-hitch.ts";
import { roundCard } from "./bench-card.ts";
import { MAX_JSON_BYTES } from "../../lib/submissions/kinds.ts";
import { benchPlan } from "./engine-bench-plan.ts";
import { QUIET_HZ } from "../kernel/constants.ts";

const COARSE_LABEL = `1/${QUIET_HZ} s`;

const S = (p50: number) => ({ mean: p50, p50, p95: p50 * 2, p99: p50 * 3, max: p50 * 4 });
const B = (fps: number, gpuMs: number | null, fineCutsPerSimS = 0): Block => ({ frames: 270, wallS: 9, fps, simSpeedPct: 99, simMsPerSimS: 212, simSpreadPct: 6.2, unsettled: 0, msPerStep: 0.9, stepsPerFrame: 2.7, cpuMs: 7.5, drawMs: 2.1, gpuMs, fineCutsPerSimS, calls: 640, triangles: 410000 });

/** The phases of a 212 ms per sim-second window: ten phases and the rest sum to the headline. */
const PHASES: PhaseCard = {
  msPerSimS: { drive: 30, plan: 5, integrate: 25, wreck: 80, pairs: 20, structure: 18, course: 8, bake: 1, rules: 3, settle: 17 },
  unattributedMsPerSimS: 5,
  workPerSimS: { steps: 240, slices: 330, liveCarSlices: 3000, wreckCarSlices: 1900, asleepCarSlices: 40, pairTests: 1500, pairContacts: 210, partContacts: 3, prismQueries: 5200, prismsVisited: 21000, prismTouches: 160, skins: 480, skinVerts: 2_400_000, ragdollMessages: 0, ragdollBytes: 0 },
  unitUs: { "integrate us/live slice": 9.5, "wreck us/wreck slice": 42.1 },
  perSecond: { wallS: [1, 1], clockS: [1, 1], msPerSimS: { wreck: [70, 90] }, workPerSimS: { steps: [240, 240] } },
};

const RESULT: BenchResult = {
  course: "city",
  build: "36b137f",
  cars: 22,
  cops: { stakeouts: 6, pursuits: 3, maxPack: 2 },
  crashed: { mean: 3.4, end: 5 },
  frames: 2700,
  wallS: 30,
  fps: 90,
  fpsLow1: 41.7,
  fpsThirds: [90, 90, 89],
  fpsPerSecond: [90, 91, 89, 90],
  simMsPerSecond: [212, 230, 640, 205],
  frameMs: S(11.1),
  cpuMs: S(7.5),
  simMs: S(4.2),
  renderMs: S(2),
  gpuMs: null,
  skinKernel: true,
  stepsPerFrame: 2.7,
  msPerStep: 1.56,
  simMsPerSimS: 212,
  simSpreadPct: 38.4,
  fineCutsPerSimS: 3.4,
  cutFrames: 40,
  lostSimS: 0.5,
  coarsePct: 62.4,
  simSpeedPct: 98.3,
  strip: null,
  labThrown: null,
  calls: 420,
  triangles: 380_000,
  tierPct: { high: 97, minimal: 3 },
  detailPct: { "50 m": 80, "40 m": 20 },
  setupMs: { options: 800, start: 140 },
  ragdoll: { steps: 1800, stepMs: { mean: 0.21, p95: 0.5 }, colliders: 340, bodies: 52 },
  replay: null,
  replayWhy: "no clip yet",
  pageEvents: [{ phase: "warm", atS: 0, visible: true, focused: true, fullscreen: false }],
  pageSeconds: { flags: "ffffd5", phases: "001111" },
  pageState: { stepOfPage: 2, keep: true, heapUsedMB: 118, heapLimitMB: 4096, ragdollHost: "remote" },
  phases: PHASES,
  longTasks: { count: 4, totalMs: 312.5, maxMs: 120.25 },
  hitches: { factor: 3, minMs: 25, frames: 7200, count: 3, excessMs: 612, rows: [{ atS: 3.2, phase: 1, ms: 412, cpuMs: 380, simMs: 20, drawMs: 350, causes: ["focus"] }, { atS: 0.4, phase: 4, ms: 180, cpuMs: 150, simMs: 10, drawMs: 140, causes: ["setting-switch", "gpu-resources"] }, { atS: 7.7, phase: 4, ms: 60, cpuMs: 8, simMs: 4, drawMs: 3, causes: [] }] },
  sweepHitches: { factor: 3, minMs: 25, frames: 2400, count: 9, excessMs: 2100, rows: [] },
  switches: [{ stretch: "fx", arm: "minimal", round: 1, settled: true, frames: 62, settleS: 0.4, longestMs: 412, longestAt: 0, longestCpuMs: 380 }, { stretch: "fx", arm: "high", round: 1, settled: false, frames: 600, settleS: 6, longestMs: 90, longestAt: 3, longestCpuMs: 20 }],
  settings: {
    fxTier: "high",
    fxAuto: true,
    post: "HDR half-float scene target, bloom (5 mips from 1/2 res, threshold 1.6, 0.45 strength), one composite pass: tone map, grade, vignette, radial blur, grain 0.03",
    fxDensity: 0.7,
    celLook: null,
    shadows: { enabled: true, type: "PCF", map: "2048x2048", casters: 223 },
    pixelRatio: 1.5,
    deviceRatio: 2.625,
    canvas: "1373x618",
    antialias: false,
    toneMapping: 4,
    night: false,
    wet: false,
    sky: "auto",
    skyDetail: "full",
    realism: 0.35,
    squash: 1,
    buckle: 1,
    deformMode: "shape",
    epicenter: false,
    depth: {
      bits: 24,
      subpixelBits: 8,
      contextDepth: true,
      fragmentHighFloat: { precision: 23, rangeMin: 127, rangeMax: 127 },
      near: 0.1,
      far: 180,
      logarithmicDepthBuffer: false,
      probe: { subpixelBits: 8, bands: [{ from: 5, to: 10, slope: { u50: 0.01, u95: 0.0625 }, steps: { u50: 20, u95: 61.6 } }] },
    },
  },
  abPace: { fine: B(41, 3, 12.5), coarse: B(58, 3, 0) },
  abFx: { minimal: B(60, 1.1), low: B(55, 2.4), high: B(48, null) },
  abDetail: { off: B(44, null), "75 m": B(49, null), "50 m": B(56, null), "30 m": B(59, null) },
  abSky: null,
  device: { browser: "Chrome 150", userAgent: "UA", gpu: "Mali-G715", gpuMasked: false, cores: 9, memoryGB: 8, screen: "412x915", dpr: 2.625, canvas: "1373x618", timerStepMs: 0.1, battery: { start: { charging: false, level: 0.83 }, end: { charging: false, level: 0.81 } } },
};

describe("given a list of frame-time samples", () => {
  test("when the percentiles of the first 5 of 7 values are asked, then they ignore the rest and the order of the values, and an empty list gives all zeros", () => {
    const s = stat([5, 1, 9, 3, 7, 100, 100], 5);
    assert.deepEqual(s, { mean: 5, p50: 5, p95: 9, p99: 9, max: 9 });
    assert.deepEqual(stat([]), { mean: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });
});

describe("given a browser's user-agent string", () => {
  test("when the bench names the browser, then it gives the browser and its major version, and an unknown agent reads as unknown browser", () => {
    assert.equal(browserName("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"), "Firefox 128");
    assert.equal(browserName("Mozilla/5.0 (Linux; Android 14; Pixel 8a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36"), "Chrome 150");
    assert.equal(browserName("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0"), "Edge 150");
    assert.equal(browserName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"), "Safari 17");
    assert.equal(browserName("curl/8"), "unknown browser");
  });
});

describe("given the frame times and the sim's time per frame of a bench run", () => {
  test("when they are summed per wall second, then each full second gives its frame count and the sim's ms in it, scaled to 1000 ms, and a partial last second is dropped", () => {
    const frames = [...Array<number>(100).fill(10), ...Array<number>(50).fill(20), ...Array<number>(25).fill(40), 5];
    const simMs = [...Array<number>(100).fill(2), ...Array<number>(50).fill(8), ...Array<number>(25).fill(0), 3];
    assert.deepEqual(perSecond(frames, simMs), { fps: [100, 50, 25], workMs: [200, 400, 0] });
    assert.deepEqual(perSecond([500, 750], [100, 150]), { fps: [2], workMs: [200] });
    assert.deepEqual(perSecond([300, 300], [1, 1]), { fps: [], workMs: [] });
  });
});

describe("given the bench result of a phone running the city course (describeBench writes it as the results card)", () => {
  test("when the card is written, then it leads with the build, fps, the sim's ms each second and sim speed, lists the settings (the depth buffer with the offset a ground layer needs to show over a coplanar one), both A/Bs and the steps cut short for a coming hit, marks a browser-masked GPU, shows the GPU timing when it can, and fits a 412 px tall phone screen", () => {
    const lines = describeBench(RESULT);
    assert.match(lines[0]!, /^CRUSH BENCH {2}city {2}22 cars.*\(Chrome 150\) {2}build 36b137f$/);
    assert.match(lines[1]!, /^90\.0 FPS {3}1% low 41\.7 {3}by thirds 90\.0 \/ 90\.0 \/ 89\.0$/);
    assert.equal(lines[2], "fps each second: 90 91 89 90");
    assert.equal(lines[3], "sim ms each second: 212 230 640 205");
    assert.match(lines[4]!, /^SIM SPEED 98 % /);
    assert.ok(lines[4]!.endsWith(`${COARSE_LABEL} steps in 62 % of frames   wrecks: mean 3.4, end 5`));
    assert.ok(lines.some((l) => /^GPU {7}no timer query/.test(l)));
    assert.ok(lines.some((l) => l.endsWith("2.7 steps/frame, 1.56 ms/step, 212 ms per sim-second, 3.4 fine-slice cuts/sim-s")));
    assert.ok(lines.some((l) => l.startsWith("fx tier: high 97 %, minimal 3 % (auto)") && l.includes("radial blur, grain 0.03")));
    assert.ok(lines.some((l) => l.includes("PCF 2048x2048, 223 casters") && l.includes("pixel ratio 1.5 of device 2.625, canvas 1373x618, no MSAA")));
    assert.ok(lines.some((l) => l === "depth: 24 bits (drawing buffer), subpixel 8 bits, fragment highp 23 bits, range 2^127..2^127, camera near 0.1 far 180, log depth off, coplanar layer shows at 0.063 px of slope or 62 steps"));
    const noDepth = describeBench({ ...RESULT, settings: { ...RESULT.settings, depth: { ...RESULT.settings.depth, bits: 16, contextDepth: false, fragmentHighFloat: null, logarithmicDepthBuffer: true } } });
    assert.ok(noDepth.some((l) => l === "depth: 16 bits (drawing buffer, none requested), subpixel 8 bits, fragment highp not supported, camera near 0.1 far 180, log depth on, coplanar layer shows at 0.063 px of slope or 62 steps"));
    assert.ok(lines.some((l) => l.startsWith("A/B pacer pinned: 1/240 s 41.0 fps") && l.endsWith(", 12.5 fine-slice cuts/sim-s")) && lines.some((l) => l.includes(`${COARSE_LABEL} 58.0 fps`) && l.endsWith(", 0.0 fine-slice cuts/sim-s")));
    assert.ok(lines.some((l) => l.includes("minimal 60.0 fps") && l.includes("gpu 1.1")) && lines.some((l) => l.includes("high 48.0 fps") && l.includes("gpu n/a")));
    assert.ok(lines.some((l) => l === "detail: only the body drawn beyond 50 m for 80 %, 40 m for 20 % of the window"));
    assert.ok(lines.some((l) => l.startsWith("A/B detail pinned: no cuts 44.0 fps")) && lines.some((l) => l.includes("body beyond 30 m 59.0 fps")));
    assert.ok(!lines.some((l) => l.includes("masked")));
    const masked = describeBench({ ...RESULT, device: { ...RESULT.device, gpu: "ANGLE (NVIDIA GeForce GTX 980), or similar", gpuMasked: true } });
    assert.ok(masked.some((l) => l.includes("GTX 980") && l.includes("[masked by the browser: not the real GPU]")));
    const timed = describeBench({ ...RESULT, gpuMs: S(3) });
    assert.ok(timed.some((l) => /^GPU {7}p50 3\.0 {2}p95 6\.0/.test(l) && !l.includes("wait on the display")), "frames of 11 ms: a 6 ms p95 is work");
    // The owner's 165 Hz desktop card: frame p50 6.1 ms, GPU p50 1.5 ms and p95 5.96 ms: one refresh long, so a wait.
    const waiting = describeBench({ ...RESULT, frameMs: S(6.1), gpuMs: { mean: 2.9, p50: 1.5, p95: 5.96, p99: 6.2, max: 10.6 } });
    assert.ok(waiting.some((l) => /^GPU {7}p50 1\.5 {2}p95 6\.0 {2}p99 6\.2 {2}max 10\.6 ms {3}p95 is one frame long: a wait on the display, p50 is the work$/.test(l)));
    assert.ok(lines.length <= 30, `${lines.length} lines: the card scrolls on a 412 px tall phone screen at 11 px type`);
  });
});

describe("given a bench window the owner left for another app (the 2278f1c phone card: blur at 18.5 s, hidden at 19.0 s, back at 45.0 s)", () => {
  test("when the card is written, then a line names each change of the page in the window, and a card whose page never left has none", () => {
    const left = describeBench({
      ...RESULT,
      pageEvents: [
        { phase: "warm", atS: 0, visible: true, focused: true, fullscreen: false },
        { phase: "window", atS: 0, visible: true, focused: true, fullscreen: false },
        { phase: "window", atS: 18.469, visible: true, focused: false, fullscreen: false },
        { phase: "window", atS: 19.016, visible: false, focused: false, fullscreen: false },
        { phase: "window", atS: 44.977, visible: true, focused: true, fullscreen: false },
        { phase: "ab-pace", atS: 0, visible: true, focused: false, fullscreen: false },
      ],
    });
    assert.ok(left.includes("PAGE LEFT during the window: unfocused 18.5 s, hidden 19.0 s, back 45.0 s. Read max and p99 with that in mind: a phone holds a page it is leaving"));
    assert.ok(!describeBench(RESULT).some((l) => l.startsWith("PAGE LEFT")));
  });
});

describe("given the bench result of the Lab's throws (?bench=lab)", () => {
  test("when the card is written, then its second line names the throws in turn, how often and when they leave, that time was held at 1x, and how many the window saw; a race's card has no such line", () => {
    const lines = describeBench({ ...RESULT, course: "lab", cars: 4, cops: null, labThrown: 4 });
    assert.match(lines[0]!, /^CRUSH BENCH {2}lab {2}4 cars/);
    const line = lines[1]!;
    const lab = benchPlan("?bench=lab")!.lab!;
    assert.ok(line.startsWith("lab: "), line);
    let from = 0;
    for (const t of lab.throws) {
      const at = line.indexOf(t.preset, from);
      assert.ok(at >= from, `${t.preset} is not named after the throw before it: ${line}`);
      assert.ok(line.slice(at).includes(`${t.along} m/s`) && line.slice(at).includes(`${t.up} m/s up`), `${t.preset}'s launch is not named: ${line}`);
      from = at + t.preset.length;
    }
    assert.ok(line.includes("held at 1x") && line.includes("4 thrown in the window"), line);
    assert.ok(!describeBench(RESULT).some((l) => l.startsWith("lab:")));
  });
});

describe("given the bench result of a page that asked for the Ultra arm (?ultra=1)", () => {
  test("when the card is written, then the fx A/B has an ultra row after high with its fps, gpu ms and draw calls; a card without the arm has no ultra row", () => {
    const lines = describeBench({ ...RESULT, abFx: { ...RESULT.abFx, ultra: { ...B(41, 3.2), calls: 655 } } });
    const at = lines.findIndex((l) => l.includes("high 48.0 fps"));
    assert.match(lines[at + 1]!, /^ +ultra 41\.0 fps, .*gpu 3\.2, 655 calls$/);
    assert.ok(!describeBench(RESULT).some((l) => l.includes("ultra ")));
  });
});

describe("given the bench result of a race that ran the sky A/B", () => {
  test("when the card is written, then it names the Sky setting and what it drew at the top tier, and the sky arms give their fps and draw calls with the full strip first; the Lab's card has no sky arms", () => {
    const lines = describeBench({ ...RESULT, abSky: { full: { ...B(52, null), calls: 160 }, off: { ...B(57, null), calls: 159 } } });
    assert.ok(lines.some((l) => l.endsWith("deform shape, sky auto (full at the top tier)")), "the setting in effect");
    const at = lines.findIndex((l) => l.startsWith("A/B sky pinned: full 52.0 fps"));
    assert.ok(at >= 0 && lines[at]!.endsWith("160 calls"), "the full arm");
    assert.match(lines[at + 1]!, /^ +off 57\.0 fps, .*159 calls$/);
    assert.ok(!describeBench({ ...RESULT, abSky: null }).some((l) => l.startsWith("A/B sky")), "no arms without a sky");
  });
});

/** A value with the digits a measured one has (a card's size must be judged with them, not with round numbers). */
const measured = (x: number): number => x + 0.123456789012345;
const ragdollOf = (steps: number): RagdollCost => ({ steps, stepMs: { mean: measured(0.2), p95: measured(0.5) }, colliders: 340, bodies: 52 });
const tierOf = (fps: number): ReplayTier => ({
  frames: 700,
  wallS: measured(12),
  fps: measured(fps),
  fpsLow1: measured(fps / 2),
  frameMs: { mean: measured(10), p95: measured(20) },
  cpuMs: { mean: measured(8), p95: measured(14) },
  simMs: { mean: measured(3), p95: measured(6) },
  renderMs: { mean: measured(4), p95: measured(7) },
  gpuMs: measured(2),
  ragdoll: ragdollOf(1400),
});
const REPLAY: ReplayResult = {
  tierS: 12,
  clip: { bytes: 41_000, cars: 8, ejections: 2, steps: 900 },
  tiers: { minimal: tierOf(120), low: tierOf(90), high: tierOf(60), ultra: tierOf(30) },
};

describe("given the bench result of a run that replayed its own crash at each FX tier", () => {
  const card = describeBench({ ...RESULT, ragdoll: ragdollOf(1800), replay: REPLAY, replayWhy: null });

  test("when the card is written, then the replay's clip is named and every tier has its own row with fps, frame, cpu, sim, draw and the ragdoll step ms", () => {
    const at = card.findIndex((l) => l.startsWith("replay of this run's crash: 8 cars, 2 thrown, 40 KB clip, 12 s per tier"));
    assert.ok(at >= 0, card.join("\n"));
    for (const [i, tier] of ["minimal", "low", "high", "ultra"].entries()) {
      const line = card[at + 1 + i]!;
      assert.ok(line.startsWith(`  ${tier.padEnd(8)}`) && /fps, 1% low .*frame .*cpu .*sim .*draw .*gpu 2\.1, ragdoll step 0\.32\/0\.62 \(1400 steps\)$/.test(line), line);
    }
  });

  test("when the card is written, then the window's ragdoll world line gives its steps, its step ms and the colliders and bodies it holds", () => {
    assert.ok(card.includes("ragdoll world: 1800 steps, step 0.32 ms mean / 0.62 p95, 340 colliders, 52 bodies"), card.join("\n"));
  });

  test("when the result is sent with the replay and ragdoll fields, then the card stays under the submission cap with the room the old card left", () => {
    // The old card measured 19 kB, HUD state included (`lib/submissions/kinds.ts`): what the two new fields add must fit the cap with it.
    const added = JSON.stringify({ ragdoll: ragdollOf(1800), replay: REPLAY, replayWhy: null }).length;
    assert.ok(19 * 1024 + added < MAX_JSON_BYTES.bench, `${added} bytes added to 19 kB`);
    assert.ok(added < 4096, `${added} bytes`);
  });
});

describe("given the bench result of a run that had no clip to replay", () => {
  test("when the card is written, then it says why and has no tier rows, and the ragdoll line is still there", () => {
    const card = describeBench({ ...RESULT, replay: null, replayWhy: "the crash was not filed as a highlight" });
    assert.ok(card.includes("replay: none (the crash was not filed as a highlight)"), card.join("\n"));
    assert.ok(!card.some((l) => l.startsWith("replay of")));
    assert.ok(card.some((l) => l.startsWith("ragdoll world: 1800 steps")), "ragdoll line");
  });
});

describe("given the bench result with the sim's phase table, its work counts, long tasks and battery", () => {
  test("when the card is written, then one line names every phase with its ms per sim-second, the unattributed rest (summing to the headline) and the work counts, and the device line carries the long tasks and battery", () => {
    const lines = describeBench(RESULT);
    const phaseLine = lines.find((l) => l.startsWith("  sim phases"));
    assert.ok(phaseLine !== undefined, "no phase line");
    assert.ok(phaseLine.startsWith("  sim phases, ms per sim-second: drive 30.0, plan 5.0, integrate 25.0, wreck 80.0, pairs 20.0, structure 18.0, course 8.0, bake 1.0, rules 3.0, settle 17.0, unattributed 5.0  (sum 212.0 of 212.0, 38.4 % spread over its seconds);  work per sim-second: steps 240, slices 330, liveCarSlices 3000, wreckCarSlices 1900"));
    assert.ok(phaseLine.endsWith("ragdollMessages 0, ragdollBytes 0"));
    assert.ok(lines.some((l) => l.startsWith("9 cores, 8 GB") && l.includes("long tasks in the window: 4, 312.5 ms in all, longest 120.3 ms   battery: 83 % on battery at the start, 81 % on battery at the end")));
  });

  test("when the browser reports no long tasks and no battery, then the line says so instead of showing zeros", () => {
    const lines = describeBench({ ...RESULT, longTasks: null, device: { ...RESULT.device, battery: null } });
    assert.ok(lines.some((l) => l.endsWith("long tasks: not reported   battery: not reported")));
  });

  test("when the new fields are added to a card, then they come to under 1.5 kB of JSON", () => {
    const added = JSON.stringify({ phases: RESULT.phases, longTasks: RESULT.longTasks, battery: RESULT.device.battery }).length;
    assert.ok(added < 1536, `${added} bytes added to a card`);
  });
});

describe("given the bench result with the hitch log and the A/B switches' hitches", () => {
  test("when the card is written, then one line counts the hitches and names the worst with their stretch, time, cpu and draw ms and causes, and one line gives each switch's longest frame and time to settle, marking an arm that never settled", () => {
    const lines = describeBench(RESULT);
    const line = lines.find((l) => l.startsWith("hitches:"));
    assert.equal(line, "hitches: 3 of 7200 frames over 3x the median (and 25 ms), 612 ms over in all; worst: window 3.2 s 412 ms (cpu 380, draw 350; focus), ab-fx 0.4 s 180 ms (cpu 150, draw 140; setting-switch+gpu-resources), ab-fx 7.7 s 60 ms (cpu 8, draw 3; no visible cause)   switch hitches (longest frame ms / s to settle, scored after it, ! never settled): fx: minimal 412/0.4, high 90/6.0!   warm-up sweep: 9 hitched of 2400 frames, 2100 ms over");
  });

  test("when no frame hitched, then the line says none and names no rows", () => {
    const lines = describeBench({ ...RESULT, hitches: { ...RESULT.hitches, count: 0, excessMs: 0, rows: [] } });
    assert.ok(lines.some((l) => l.startsWith("hitches: 0 of 7200 frames over 3x the median (and 25 ms), 0 ms over in all   switch hitches")));
  });
});

describe("given a run that hitched as often as the table holds, over every A/B switch of the longest cycle", () => {
  test("when the card is rounded for the wire, then its JSON stays 12 kB under the submission cap (room for the HUD's settings and the envelope)", () => {
    const digits = 0.123456789012345;
    const rows = Array.from({ length: HITCH.cap }, (_, i) => ({ atS: i + digits, phase: i % 7, ms: 300 + digits, cpuMs: 120 + digits, simMs: 40 + digits, drawMs: 90 + digits, causes: ["setting-switch", "gpu-resources", "focus"] }));
    const switches = Array.from({ length: 30 }, (_, i) => ({ stretch: "fx", arm: i % 2 ? "high" : "minimal", round: 1 + (i >> 1), settled: i % 3 !== 0, frames: 60 + i, settleS: 3 + digits, longestMs: 400 + digits, longestAt: i, longestCpuMs: 200 + digits }));
    const full = { ...RESULT, hitches: { ...RESULT.hitches, count: 4000, excessMs: 123456 + digits, rows }, switches };
    const bytes = JSON.stringify(roundCard(full)).length;
    assert.ok(bytes < MAX_JSON_BYTES.bench - 12 * 1024, `${bytes} bytes against the cap of ${MAX_JSON_BYTES.bench}`);
  });

  test("when the window carries its per-second phases and counters for every second it can hold, with the page's per-second state of the longest page, then the card's JSON still stays 12 kB under the cap", () => {
    const digits = 0.123456789012345;
    const seconds = 50;
    const column = (base: number): number[] => Array.from({ length: seconds }, (_, i) => base + i + digits);
    const perSecond = {
      wallS: column(1),
      clockS: column(1),
      msPerSimS: Object.fromEntries(Object.keys(PHASES.msPerSimS).map((name) => [name, column(30)])),
      workPerSimS: Object.fromEntries(Object.keys(PHASES.workPerSimS).map((name) => [name, column(2_400_000)])),
    };
    const hex = "fd".repeat(900);
    const full = { ...RESULT, phases: { ...PHASES, perSecond }, pageSeconds: { flags: hex, phases: hex } };
    const bytes = JSON.stringify(roundCard(full)).length;
    assert.ok(bytes < MAX_JSON_BYTES.bench - 12 * 1024, `${bytes} bytes against the cap of ${MAX_JSON_BYTES.bench}`);
  });
});
