import { describe, expect, test } from "vitest";
import type { FrameStats } from "./bench-frames.ts";
import { browserName, describeBench, perSecond, stat, type Block, type BenchResult, type PhaseCard, type RagdollCost, type ReplayResult, type ReplayTier } from "./engine-bench-report.ts";
import { HITCH } from "./bench-hitch.ts";
import { roundCard } from "./bench-card.ts";
import { MAX_JSON_BYTES } from "../../lib/submissions/kinds.ts";
import { benchPlan } from "./engine-bench-plan.ts";
import { QUIET_HZ } from "../kernel/constants.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { must } from "../kernel/must.test-util.ts";

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

/** The window's frames as the device summarised them: 2700 frames, 12 over 3x the 11.1 ms median, the spikes in the wreck phase with more wrecks and contacts than the rest. */
const FRAME_STATS: FrameStats = {
  n: 2700,
  medianMs: 11.1,
  p95Ms: 14.2,
  p99Ms: 31.4,
  p999Ms: 88.8,
  maxMs: 120.5,
  fpsLow1: 28.6,
  fpsLow01: 11.3,
  series: { cols: ["atS", "frames", "maxMs"], dp: [1, 0, 2], n: 2, data: [[0, 0.2], [18, 17], [14.1, 31.2]] },
  spikes: {
    count: 12,
    factor: 3,
    minMs: 25,
    thresholdMs: 33.3,
    rows: { cols: ["atS", "intervalMs"], dp: [3, 2], n: 1, data: [[3.2], [88.8]] },
    activity: { cols: ["crashed", "ragdollMessages", "wreckCarSlices", "asleepCarSlices", "frozenCarSlices", "pairContacts", "partContacts", "freezes", "thaws", "steps"], inSpikes: [6, 4, 31, 2, 8, 44, 12, 1.5, 0.5, 3], otherwise: [3, 0.5, 11, 1, 3, 9, 2, 0.1, 0.1, 2.7], correlation: [0.41, 0.2, 0.55, 0.1, 0.3, 0.72, 0.4, 0.2, 0.1, 0.3] },
    dominantPhase: [0, 0, 1, 9, 1, 1, 0, 0, 0, 0],
  },
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
  pageSeconds: { flags: "ffffd5", phases: "001111", sky: "003333", epi: "000000" },
  run: { extended: true, staged: false, options: null },
  frameStats: FRAME_STATS,
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
    halftone: null,
    hatching: null,
    rimLight: null,
    shadows: { enabled: true, type: "PCF", map: "2048x2048", casters: 223 },
    pixelRatio: 1.5,
    deviceRatio: 2.625,
    canvas: "1373x618",
    antialias: false,
    toneMapping: 4,
    night: false,
    wet: false,
    sky: "full",
    skyPlayer: "auto",
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
    expect(s.mean, "mean").toBe(5);
    expect(s.p50, "p50").toBe(5);
    expect(s.p95, "p95").toBe(9);
    expect(s.p99, "p99").toBe(9);
    expect(s.max, "max").toBe(9);
    const none = stat([]);
    expect(none.mean, "empty: mean").toBe(0);
    expect(none.p50, "empty: p50").toBe(0);
    expect(none.p95, "empty: p95").toBe(0);
    expect(none.p99, "empty: p99").toBe(0);
    expect(none.max, "empty: max").toBe(0);
  });
});

describe("given a browser's user-agent string", () => {
  test("when the bench names the browser, then it gives the browser and its major version, and an unknown agent reads as unknown browser", () => {
    expect(browserName("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0")).toBe("Firefox 128");
    expect(browserName("Mozilla/5.0 (Linux; Android 14; Pixel 8a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36")).toBe("Chrome 150");
    expect(browserName("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0")).toBe("Edge 150");
    expect(browserName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")).toBe("Safari 17");
    expect(browserName("curl/8")).toBe("unknown browser");
  });
});

describe("given the frame times and the sim's time per frame of a bench run", () => {
  test("when they are summed per wall second, then each full second gives its frame count and the sim's ms in it, scaled to 1000 ms, and a partial last second is dropped", () => {
    const frames = [...Array<number>(100).fill(10), ...Array<number>(50).fill(20), ...Array<number>(25).fill(40), 5];
    const simMs = [...Array<number>(100).fill(2), ...Array<number>(50).fill(8), ...Array<number>(25).fill(0), 3];
    const full = perSecond(frames, simMs);
    expect(firstMismatch(full.fps, [100, 50, 25]), "fps per second").toBeUndefined();
    expect(firstMismatch(full.workMs, [200, 400, 0]), "work ms per second").toBeUndefined();
    const two = perSecond([500, 750], [100, 150]);
    expect(firstMismatch(two.fps, [2]), "two long frames: fps").toBeUndefined();
    expect(firstMismatch(two.workMs, [200]), "two long frames: work ms").toBeUndefined();
    const partial = perSecond([300, 300], [1, 1]);
    expect(partial.fps, "a partial second drops: fps").toHaveLength(0);
    expect(partial.workMs, "a partial second drops: work ms").toHaveLength(0);
  });
});

describe("given the bench result of a phone running the city course (the results card is written from it)", () => {
  test("when the card is written, then it leads with the build, fps, the sim's ms each second and sim speed, lists the settings (the depth buffer with the offset a ground layer needs to show over a coplanar one), both A/Bs and the steps cut short for a coming hit, marks a browser-masked GPU, shows the GPU timing when it can, and fits a 412 px tall phone screen", () => {
    const lines = describeBench(RESULT);
    expect(lines[0]!).toMatch(/^CRUSH BENCH {2}city {2}22 cars.*\(Chrome 150\) {2}build 36b137f$/);
    expect(lines[1]!).toMatch(/^90\.0 FPS {3}1% low 28\.6 {3}0\.1% low 11\.3 {3}by thirds 90\.0 \/ 90\.0 \/ 89\.0$/);
    expect(lines[2]).toBe("fps each second: 90 91 89 90");
    expect(lines[3]).toBe("sim ms each second: 212 230 640 205");
    expect(lines[4]!).toMatch(/^SIM SPEED 98 % /);
    expect(lines[4]!.endsWith(`${COARSE_LABEL} steps in 62 % of frames   wrecks: mean 3.4, end 5`)).toBeTruthy();
    expect(lines.some((l) => /^GPU {7}no timer query/.test(l))).toBeTruthy();
    expect(lines.some((l) => l.endsWith("2.7 steps/frame, 1.56 ms/step, 212 ms per sim-second, 3.4 fine-slice cuts/sim-s"))).toBeTruthy();
    expect(lines.some((l) => l.startsWith("fx tier: high 97 %, minimal 3 % (auto)") && l.includes("radial blur, grain 0.03"))).toBeTruthy();
    expect(lines.some((l) => l.includes("PCF 2048x2048, 223 casters") && l.includes("pixel ratio 1.5 of device 2.625, canvas 1373x618, no MSAA"))).toBeTruthy();
    expect(lines.some((l) => l === "depth: 24 bits (drawing buffer), subpixel 8 bits, fragment highp 23 bits, range 2^127..2^127, camera near 0.1 far 180, log depth off, coplanar layer shows at 0.063 px of slope or 62 steps")).toBeTruthy();
    const noDepth = describeBench({ ...RESULT, settings: { ...RESULT.settings, depth: { ...RESULT.settings.depth, bits: 16, contextDepth: false, fragmentHighFloat: null, logarithmicDepthBuffer: true } } });
    expect(noDepth.some((l) => l === "depth: 16 bits (drawing buffer, none requested), subpixel 8 bits, fragment highp not supported, camera near 0.1 far 180, log depth on, coplanar layer shows at 0.063 px of slope or 62 steps")).toBeTruthy();
    expect(lines.some((l) => l.startsWith("A/B pacer pinned: 1/240 s 41.0 fps") && l.endsWith(", 12.5 fine-slice cuts/sim-s")) && lines.some((l) => l.includes(`${COARSE_LABEL} 58.0 fps`) && l.endsWith(", 0.0 fine-slice cuts/sim-s"))).toBeTruthy();
    expect(lines.some((l) => l.includes("minimal 60.0 fps") && l.includes("gpu 1.1")) && lines.some((l) => l.includes("high 48.0 fps") && l.includes("gpu n/a"))).toBeTruthy();
    expect(lines.some((l) => l === "detail: only the body drawn beyond 50 m for 80 %, 40 m for 20 % of the window")).toBeTruthy();
    expect(lines.some((l) => l.startsWith("A/B detail pinned: no cuts 44.0 fps")) && lines.some((l) => l.includes("body beyond 30 m 59.0 fps"))).toBeTruthy();
    expect(!lines.some((l) => l.includes("masked"))).toBe(true);
    const masked = describeBench({ ...RESULT, device: { ...RESULT.device, gpu: "ANGLE (NVIDIA GeForce GTX 980), or similar", gpuMasked: true } });
    expect(masked.some((l) => l.includes("GTX 980") && l.includes("[masked by the browser: not the real GPU]"))).toBeTruthy();
    const timed = describeBench({ ...RESULT, gpuMs: S(3) });
    expect(timed.some((l) => /^GPU {7}p50 3\.0 {2}p95 6\.0/.test(l) && !l.includes("wait on the display")), "frames of 11 ms: a 6 ms p95 is work").toBeTruthy();
    // The owner's 165 Hz desktop card: frame p50 6.1 ms, GPU p50 1.5 ms and p95 5.96 ms: one refresh long, so a wait.
    const waiting = describeBench({ ...RESULT, frameMs: S(6.1), gpuMs: { mean: 2.9, p50: 1.5, p95: 5.96, p99: 6.2, max: 10.6 } });
    expect(waiting.some((l) => /^GPU {7}p50 1\.5 {2}p95 6\.0 {2}p99 6\.2 {2}max 10\.6 ms {3}p95 is one frame long: a wait on the display, p50 is the work$/.test(l))).toBeTruthy();
    expect(lines.length, `${lines.length} lines: the card scrolls on a 412 px tall phone screen at 11 px type`).toBeLessThanOrEqual(30);
  });
});

describe("given the bench result of a run with the print looks and the rim light held on", () => {
  const settingsLine = (settings: BenchResult["settings"]): string => describeBench({ ...RESULT, settings }).find((l) => l.includes("fx density"))!;

  test("when none is held on, then the settings line says off for dots, hatch and rim, and when they are held, it gives each strength after the cel's", () => {
    expect(settingsLine(RESULT.settings)).toMatch(/cel auto, dots off, hatch off, rim off {3}night/);
    expect(settingsLine({ ...RESULT.settings, celLook: 0.5, halftone: 0.5, hatching: 0.4, rimLight: 0.6 })).toMatch(/cel 0\.5, dots 0\.5, hatch 0\.4, rim 0\.6 {3}night/);
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
    expect(left.includes("PAGE LEFT during the window: unfocused 18.5 s, hidden 19.0 s, back 45.0 s. Read max and p99 with that in mind: a phone holds a page it is leaving")).toBeTruthy();
    expect(!describeBench(RESULT).some((l) => l.startsWith("PAGE LEFT"))).toBe(true);
  });
});

describe("given a card from a bench loop whose options the chooser set (Loop, Epicenter, Ultra)", () => {
  test("when the card is written, then the line under its header names each option, so an epicenter-on quick run reads apart from an older whole-mode one, and a card from no loop has no such line", () => {
    const lines = describeBench({ ...RESULT, run: { ...RESULT.run, options: { loop: true, epi: true, ultra: false } } });
    expect(lines[1]).toBe("run options: Loop on, Epicenter on, Ultra off");
    expect(!describeBench(RESULT).some((l) => l.startsWith("run options"))).toBe(true);
  });
});

describe("given the bench result of the Lab's throws (?bench=lab)", () => {
  test("when the card is written, then its second line names the throws in turn, how often and when they leave, that time was held at 1x, and how many the window saw; a race's card has no such line", () => {
    const lines = describeBench({ ...RESULT, course: "lab", cars: 4, cops: null, labThrown: 4 });
    expect(lines[0]!).toMatch(/^CRUSH BENCH {2}lab {2}4 cars/);
    const line = lines[1]!;
    const lab = benchPlan("?bench=lab")!.lab!;
    expect(line.startsWith("lab: "), line).toBeTruthy();
    let from = 0;
    for (const t of lab.throws) {
      const at = line.indexOf(t.preset, from);
      expect(at, `${t.preset} is not named after the throw before it: ${line}`).toBeGreaterThanOrEqual(from);
      expect(line.slice(at).includes(`${t.along} m/s`) && line.slice(at).includes(`${t.up} m/s up`), `${t.preset}'s launch is not named: ${line}`).toBeTruthy();
      from = at + t.preset.length;
    }
    expect(line.includes("held at 1x") && line.includes("4 thrown in the window"), line).toBeTruthy();
    expect(!describeBench(RESULT).some((l) => l.startsWith("lab:"))).toBe(true);
  });
});

describe("given the bench result of a page that asked for the Ultra arm (?ultra=1)", () => {
  test("when the card is written, then the fx A/B has an ultra row after high with its fps, gpu ms and draw calls; a card without the arm has no ultra row", () => {
    const lines = describeBench({ ...RESULT, abFx: { ...RESULT.abFx!, ultra: { ...B(41, 3.2), calls: 655 } } });
    const at = lines.findIndex((l) => l.includes("high 48.0 fps"));
    expect(lines[at + 1]!).toMatch(/^ +ultra 41\.0 fps, .*gpu 3\.2, 655 calls$/);
    expect(!describeBench(RESULT).some((l) => l.includes("ultra "))).toBe(true);
  });
});

describe("given the bench result with the sky as drawn each second", () => {
  const skyLine = (series: { flags: string; phases: string; sky: string }): string => describeBench({ ...RESULT, pageSeconds: { ...series, epi: "0".repeat(series.flags.length) } }).find((l) => l.includes("pinned by the bench"))!;

  test("when every window second drew the strip, then the settings line says the strip was drawn for all of them, counting the window's seconds only", () => {
    // Two warm-up seconds (stretch 0) with the strip still loading, then four window seconds (stretch 1) all drawing it.
    expect(skyLine({ flags: "ffffff", phases: "001111", sky: "443333" }).endsWith("drawn full 4 of 4 window s")).toBeTruthy();
  });

  test("when the window drew the strip for three seconds and nothing for one, then the line gives both, the larger first", () => {
    expect(skyLine({ flags: "ffffff", phases: "001111", sky: "003303" }).endsWith("drawn full 3 of 4 window s, none 1 of 4 window s")).toBeTruthy();
  });

  test("when the series has no window second, then the line says so", () => {
    expect(skyLine({ flags: "ff", phases: "00", sky: "33" }).endsWith("drawn no window seconds")).toBeTruthy();
  });
});

describe("given the bench result of a race that ran the sky A/B", () => {
  test("when a card from before the procedural default is written, then it names the Sky setting and what it drew at the top tier, and the sky arms give their fps and draw calls with the full strip first; the Lab's card has no sky arms", () => {
    const lines = describeBench({ ...RESULT, abSky: { full: { ...B(52, null), calls: 160 }, off: { ...B(57, null), calls: 159 } } });
    expect(lines.some((l) => l.includes("deform shape, sky full pinned by the bench (your setting auto, put back after; full on every tier), drawn ")), "the setting in effect").toBeTruthy();
    const at = lines.findIndex((l) => l.startsWith("A/B sky pinned: full 52.0 fps"));
    expect(at >= 0 && lines[at]!.endsWith("160 calls"), "the full arm").toBeTruthy();
    expect(lines[at + 1]!).toMatch(/^ +off 57\.0 fps, .*159 calls$/);
    expect(!describeBench({ ...RESULT, abSky: null }).some((l) => l.startsWith("A/B sky")), "no arms without a sky").toBe(true);
  });

  test("when a card that pinned the procedural sky is written, then its settings line names that pin, and the sky arms run procedural, the strip, then none", () => {
    const settings = { ...RESULT.settings, skyPin: "procedural", skyDetail: "procedural" } as const;
    const lines = describeBench({ ...RESULT, settings, abSky: { procedural: { ...B(55, null), calls: 160 }, full: { ...B(52, null), calls: 160 }, off: { ...B(57, null), calls: 159 } } });
    expect(lines.some((l) => l.includes("sky procedural pinned by the bench (your setting auto, put back after; procedural on every tier), drawn ")), "the pin in effect").toBeTruthy();
    const at = lines.findIndex((l) => l.startsWith("A/B sky pinned: procedural 55.0 fps"));
    expect(at, "the procedural arm first").toBeGreaterThanOrEqual(0);
    expect(lines[at + 1]!).toMatch(/^ +full 52\.0 fps, .*160 calls$/);
    expect(lines[at + 2]!).toMatch(/^ +off 57\.0 fps, .*159 calls$/);
  });
});

describe("given a card whose run held draw max and scale 2 pinned by the URL", () => {
  test("when it is described, then its quality line says so", () => {
    const settings = { ...RESULT.settings, quality: { draw: "max", scale: "2", shadow: "auto", pinned: "draw scale" } };
    const lines = describeBench({ ...RESULT, settings });
    expect(lines.includes("quality: draw max, scale 2, shadows auto (the URL pinned draw scale)"), lines.join("\n")).toBeTruthy();
    expect(!describeBench(RESULT).some((l) => l.startsWith("quality:")), "a card from before the knobs has no quality line").toBe(true);
  });
});

describe("given an extended card with quality A/B blocks", () => {
  test("when it is described, then each knob prints its Auto and Max arms", () => {
    const lines = describeBench({
      ...RESULT,
      abDraw: { auto: B(50, null), max: B(44, null) },
      abScale: { auto: B(52, null), max: B(38, null) },
      abShadow: { auto: B(53, null), max: B(49, null) },
    });
    const knobs = [
      { title: "A/B draw distance pinned: ", auto: "auto 50.0 fps", top: "max 44.0 fps" },
      { title: "A/B render scale pinned: ", auto: "auto 52.0 fps", top: "2 38.0 fps" },
      { title: "A/B shadows pinned: ", auto: "auto 53.0 fps", top: "max 49.0 fps" },
    ];
    for (const knob of knobs) {
      const at = lines.findIndex((l) => l.startsWith(knob.title));
      expect(at, `${knob.title} is printed`).toBeGreaterThanOrEqual(0);
      expect(lines[at]!.startsWith(`${knob.title}${knob.auto}`), `${knob.title} Auto arm: ${lines[at]}`).toBeTruthy();
      expect(lines[at + 1]!.startsWith(`${" ".repeat(knob.title.length)}${knob.top}`), `${knob.title} top arm: ${lines[at + 1]}`).toBeTruthy();
    }
    expect(!describeBench(RESULT).some((l) => l.startsWith("A/B draw distance") || l.startsWith("A/B render scale") || l.startsWith("A/B shadows")), "a card without the blocks prints none").toBe(true);
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
    expect(at, card.join("\n")).toBeGreaterThanOrEqual(0);
    for (const [i, tier] of ["minimal", "low", "high", "ultra"].entries()) {
      const line = card[at + 1 + i]!;
      expect(line.startsWith(`  ${tier.padEnd(8)}`) && /fps, 1% low .*frame .*cpu .*sim .*draw .*gpu 2\.1, ragdoll step 0\.32\/0\.62 \(1400 steps\)$/.test(line), line).toBeTruthy();
    }
  });

  test("when the card is written, then the window's ragdoll world line gives its steps, its step ms and the colliders and bodies it holds", () => {
    expect(card.includes("ragdoll world: 1800 steps, step 0.32 ms mean / 0.62 p95, 340 colliders, 52 bodies"), card.join("\n")).toBeTruthy();
  });

  test("when the result is sent with the replay and ragdoll fields, then the card stays under the submission cap with the room the old card left", () => {
    // The old card measured 19 kB, HUD state included (`lib/submissions/kinds.ts`): what the two new fields add must fit the cap with it.
    const added = JSON.stringify({ ragdoll: ragdollOf(1800), replay: REPLAY, replayWhy: null }).length;
    expect(19 * 1024 + added, `${added} bytes added to 19 kB`).toBeLessThan(MAX_JSON_BYTES.bench);
    expect(added, `${added} bytes`).toBeLessThan(4096);
  });
});

describe("given the bench result of a run that had no clip to replay", () => {
  test("when the card is written, then it says why and has no tier rows, and the ragdoll line is still there", () => {
    const card = describeBench({ ...RESULT, replay: null, replayWhy: "the crash was not filed as a highlight" });
    expect(card.includes("replay: none (the crash was not filed as a highlight)"), card.join("\n")).toBeTruthy();
    expect(!card.some((l) => l.startsWith("replay of"))).toBe(true);
    expect(card.some((l) => l.startsWith("ragdoll world: 1800 steps")), "ragdoll line").toBeTruthy();
  });
});

describe("given the bench result whose frames the device summarised", () => {
  test("when the card is written, then one line counts the frame spikes and says what the sim was doing in them against the other frames, with the correlation and the phase that was largest", () => {
    const line = describeBench(RESULT).find((l) => l.startsWith("frame spikes"));
    expect(line).toBe("frame spikes (over 3x the window median 11.1 ms, at least 25 ms): 12 of 2700 frames, p99 31.4 p99.9 88.8 max 120.5 ms; in a spike against elsewhere: crashed 6.0 vs 3.0 (r 0.41), wreckCarSlices 31.0 vs 11.0 (r 0.55), pairContacts 44.0 vs 9.0 (r 0.72), freezes 1.5 vs 0.1 (r 0.20), ragdollMessages 4.0 vs 0.5 (r 0.20); the wreck phase is the largest in 9 of them");
  });

  test("when no frame was a spike, then the line says none", () => {
    const quiet = { ...FRAME_STATS, spikes: { ...FRAME_STATS.spikes, count: 0 } };
    expect(describeBench({ ...RESULT, frameStats: quiet }).some((l) => l.startsWith("frame spikes") && l.endsWith(", none"))).toBeTruthy();
  });
});

describe("given the bench result with the sim's phase table, its work counts, long tasks and battery", () => {
  test("when the card is written, then one line names every phase with its ms per sim-second, the unattributed rest (summing to the headline) and the work counts, and the device line carries the long tasks and battery", () => {
    const lines = describeBench(RESULT);
    const phaseLine = lines.find((l) => l.startsWith("  sim phases"));
    must(phaseLine !== undefined, "no phase line");
    expect(phaseLine.startsWith("  sim phases, ms per sim-second: drive 30.0, plan 5.0, integrate 25.0, wreck 80.0, pairs 20.0, structure 18.0, course 8.0, bake 1.0, rules 3.0, settle 17.0, unattributed 5.0  (sum 212.0 of 212.0, 38.4 % spread over its seconds);  work per sim-second: steps 240, slices 330, liveCarSlices 3000, wreckCarSlices 1900")).toBeTruthy();
    expect(phaseLine.endsWith("ragdollMessages 0, ragdollBytes 0")).toBeTruthy();
    expect(lines.some((l) => l.startsWith("9 cores, 8 GB") && l.includes("long tasks in the window: 4, 312.5 ms in all, longest 120.3 ms   battery: 83 % on battery at the start, 81 % on battery at the end"))).toBeTruthy();
  });

  test("when the browser reports no long tasks and no battery, then the line says so instead of showing zeros", () => {
    const lines = describeBench({ ...RESULT, longTasks: null, device: { ...RESULT.device, battery: null } });
    expect(lines.some((l) => l.endsWith("long tasks: not reported   battery: not reported"))).toBeTruthy();
  });

  test("when the new fields are added to a card, then they come to under 1.5 kB of JSON", () => {
    const added = JSON.stringify({ phases: RESULT.phases, longTasks: RESULT.longTasks, battery: RESULT.device.battery }).length;
    expect(added, `${added} bytes added to a card`).toBeLessThan(1536);
  });
});

describe("given the bench result with the hitch log and the A/B switches' hitches", () => {
  test("when the card is written, then one line counts the hitches and names the worst with their stretch, time, cpu and draw ms and causes, and one line gives each switch's longest frame and time to settle, marking an arm that never settled", () => {
    const lines = describeBench(RESULT);
    const line = lines.find((l) => l.startsWith("hitches:"));
    expect(line).toBe("hitches: 3 of 7200 frames over 3x the median (and 25 ms), 612 ms over in all; worst: window 3.2 s 412 ms (cpu 380, draw 350; focus), ab-fx 0.4 s 180 ms (cpu 150, draw 140; setting-switch+gpu-resources), ab-fx 7.7 s 60 ms (cpu 8, draw 3; no visible cause)   switch hitches (longest frame ms / s to settle, scored after it, ! never settled): fx: minimal 412/0.4, high 90/6.0!   warm-up sweep: 9 hitched of 2400 frames, 2100 ms over");
  });

  test("when no frame hitched, then the line says none and names no rows", () => {
    const lines = describeBench({ ...RESULT, hitches: { ...RESULT.hitches, count: 0, excessMs: 0, rows: [] } });
    expect(lines.some((l) => l.startsWith("hitches: 0 of 7200 frames over 3x the median (and 25 ms), 0 ms over in all   switch hitches"))).toBeTruthy();
  });
});

describe("given a run that hitched as often as the table holds, over every A/B switch of the longest cycle", () => {
  test("when the card is rounded for the wire, then its JSON stays 12 kB under the submission cap (room for the HUD's settings and the envelope)", () => {
    const digits = 0.123456789012345;
    const rows = Array.from({ length: HITCH.cap }, (_, i) => ({ atS: i + digits, phase: i % 7, ms: 300 + digits, cpuMs: 120 + digits, simMs: 40 + digits, drawMs: 90 + digits, causes: ["setting-switch", "gpu-resources", "focus"] }));
    const switches = Array.from({ length: 30 }, (_, i) => ({ stretch: "fx", arm: i % 2 ? "high" : "minimal", round: 1 + (i >> 1), settled: i % 3 !== 0, frames: 60 + i, settleS: 3 + digits, longestMs: 400 + digits, longestAt: i, longestCpuMs: 200 + digits }));
    const full = { ...RESULT, hitches: { ...RESULT.hitches, count: 4000, excessMs: 123456 + digits, rows }, switches };
    const bytes = JSON.stringify(roundCard(full)).length;
    expect(bytes, `${bytes} bytes against the cap of ${MAX_JSON_BYTES.bench}`).toBeLessThan(MAX_JSON_BYTES.bench - 12 * 1024);
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
    const full = { ...RESULT, phases: { ...PHASES, perSecond }, pageSeconds: { flags: hex, phases: hex, sky: hex, epi: hex } };
    const bytes = JSON.stringify(roundCard(full)).length;
    expect(bytes, `${bytes} bytes against the cap of ${MAX_JSON_BYTES.bench}`).toBeLessThan(MAX_JSON_BYTES.bench - 12 * 1024);
  });
});
