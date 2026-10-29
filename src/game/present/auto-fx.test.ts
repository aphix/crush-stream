import { describe, expect, it } from "vitest";
import { expectMoves } from "./auto-fx-moves.test-util.ts";
import type { FxTier } from "./engine-post.ts";
import { AutoFx, deviceClass, gpuRenderer } from "./auto-fx.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

// Deterministic 60 Hz jitter spanning 16.8–17.5 ms (57–59.5 fps per frame, about 58 fps on average).
const jitter60 = (i: number): number => 16.8 + ((i * 7) % 8) * 0.1;
const steady = (fps: number) => (): number => 1000 / fps;

/** A main thread that is nearly idle (ms per frame) and a browser with no GPU timer (Firefox): these tests vary the wall rate alone. */
const LIGHT_WORK_MS = 3;
const NO_GPU = -1;

/** A match clock in seconds, negative before green; `run` advances it by each frame. */
const race = (): { t: number } => ({ t: -4.5 });

/** Feeds `seconds` of frames; every switch the policy asked for as [second it happened, tier]. */
function run(fx: AutoFx, seconds: number, frame: (i: number) => number, match?: { t: number }): [number, FxTier][] {
  const out: [number, FxTier][] = [];
  let t = 0;
  for (let i = 0; t < seconds * 1000; i++) {
    const ms = frame(i);
    t += ms;
    if (match) match.t += ms / 1000;
    const to = fx.frame(ms, LIGHT_WORK_MS, LIGHT_WORK_MS, NO_GPU, match ? match.t : null);
    if (to !== null) out.push([Math.round(t / 100) / 10, to]);
  }
  return out;
}

/** A capable client fed 60 Hz frames until the load check lifts it to "high" (stops on that frame, at 2.5 s). */
function onHigh(): AutoFx {
  const fx = new AutoFx(true, true);
  let t = 0;
  for (let i = 0; fx.frame(jitter60(i), LIGHT_WORK_MS, LIGHT_WORK_MS, NO_GPU, null) === null; i++) t += jitter60(i);
  expect(Math.round(t / 100) / 10).toBe(2.5);
  return fx;
}

describe("given the automatic graphics-effects tier policy (it steps the effects tier up or down from the measured frame rate)", () => {
  it("when a hardware desktop holds 60 fps, then it goes to high 2.5 s after ready (1.5 s settle, 1 s sample) and stays there", () => {
    expectMoves(run(new AutoFx(true, true), 3, jitter60), [[2.5, "high"]], "60 fps hardware desktop");
    expect(run(onHigh(), 120, jitter60)).toHaveLength(0);
  });

  it("when the GPU is software or the frame rate stays under 57 fps, then the tier stays minimal", () => {
    expect(run(new AutoFx(false, true), 10, steady(144))).toHaveLength(0);
    expect(run(new AutoFx(true, true), 10, steady(55))).toHaveLength(0);
  });

  it("when the frame rate sustains 49 fps from high, then it steps high to low to minimal, 4.5 s each (settle plus three slow windows), never below", () => {
    const fx = onHigh();
    expectMoves(run(fx, 60, steady(49)), [[4.5, "low"], [9.0, "minimal"]], "49 fps from high");
  });

  it("when frames come in a 45 fps vsync cadence (two on-time frames, one double), then it drops although most frames are 16.7 ms", () => {
    const fx = onHigh();
    const cadence = (i: number): number => (i % 3 === 2 ? 2000 / 60 : 1000 / 60);
    expectMoves(run(fx, 5, cadence), [[4.6, "low"]], "45 fps vsync cadence");
  });

  it("when a 2 s load spike at 30 fps (two slow windows) interrupts 60 fps frames, then it holds; a 3 s spell steps down", () => {
    const spike = (seconds: number) => (i: number): number => (i >= 90 && i < 90 + 30 * seconds ? 1000 / 30 : jitter60(i));
    expect(run(onHigh(), 30, spike(2))).toHaveLength(0);
    expectMoves(run(onHigh(), 10, spike(3)), [[4.5, "low"]], "3 s spike");
  });

  it("when a single hitch of 100, 400 or 2000 ms interrupts 60 fps frames, then it ends only one slow window and never drops", () => {
    for (const hitch of [100, 400, 2000]) {
      const fx = onHigh();
      expect(run(fx, 30, (i) => (i === 300 ? hitch : jitter60(i))), `${hitch} ms hitch`).toHaveLength(0);
    }
  });

  it("when the frame rate is 52 fps and then 48 fps, then it is judged against 60 fps, not the screen's refresh rate: 52 fps holds and 48 fps drops", () => {
    expect(run(onHigh(), 30, steady(52))).toHaveLength(0);
    expectMoves(run(onHigh(), 30, steady(48)), [[4.5, "low"], [9.0, "minimal"]], "48 fps");
  });

  it("when a race starts after the setup measured high, then it keeps high through grid, countdown and green, and is monitored again from green + 3 s", () => {
    const fx = onHigh();
    const m = race();
    // Grid and countdown 4.5 s, green + 3 s = 7.5 s.
    expect(run(fx, 9, jitter60, m)).toHaveLength(0);
    // From 9 s: the window under way since 8.5 s is slow, then two more.
    expectMoves(run(fx, 4, steady(40), m), [[2.5, "low"]], "40 fps after green + 3 s");
  });

  it("when a race runs at 45 fps from its start, then it holds the tier to green + 3 s and steps down on a sustained miss after it, and the race's end keeps the tier it fell to", () => {
    const fx = onHigh();
    const m = race();
    expectMoves(run(fx, 30, steady(45), m), [[10.6, "low"], [15.1, "minimal"]], "45 fps race");
    expect(run(fx, 1, jitter60)).toHaveLength(0);
  });

  it("when a race starts on a machine whose tier is low, then it keeps low", () => {
    const fx = onHigh();
    expectMoves(run(fx, 5, steady(49)), [[4.5, "low"]], "49 fps from high");
    expect(run(fx, 12, jitter60, race())).toHaveLength(0);
  });

  it("when a derby starts with its clock closer to green, then it keeps the tier the same way", () => {
    const fx = onHigh();
    const m = { t: -1.5 };
    expect(run(fx, 10, jitter60, m)).toHaveLength(0);
  });

  it("when a match starts during the load check, then it keeps minimal and the check lifts it 3 s after green", () => {
    const fx = new AutoFx(true, true);
    expect(run(fx, 1, jitter60)).toHaveLength(0);
    expectMoves(run(fx, 12, jitter60, race()), [[8.5, "high"]], "race started during the load check");
  });

  it("when a software-GPU machine runs a race, then it stays minimal through the race", () => {
    expect(run(new AutoFx(false, true), 12, steady(144), race())).toHaveLength(0);
  });

  it("when the player picks a tier by hand, then auto turns off: no match drop or lift and no slowdown drop until it is resumed", () => {
    const fx = onHigh();
    fx.auto = false;
    expect(run(fx, 12, jitter60, race())).toHaveLength(0);
    expect(run(fx, 10, steady(30))).toHaveLength(0);
    fx.resume("off");
    expectMoves(run(fx, 1, jitter60), [[0, "high"]], "after resume");
  });
});

describe("given the check for being fit to host a public match", () => {
  it("when the machine is a hardware desktop before its load check, after it holds high, or after it falls to low, then it is fit", () => {
    expect(new AutoFx(true, true).canHost()).toBe(true);
    const fx = onHigh();
    expect(fx.canHost()).toBe(true);
    run(fx, 5, steady(49));
    expect(fx.canHost(), "low is still fit (4.5 s in)").toBe(true);
  });

  it("when the machine is a phone or software GPU, a desktop under 57 fps at its load check, or one that fell to minimal, then it is not fit", () => {
    expect(new AutoFx(false, true).canHost()).toBe(false);
    const slow = new AutoFx(true, true);
    run(slow, 10, steady(55));
    expect(slow.canHost()).toBe(false);
    const fell = onHigh();
    run(fell, 60, steady(49));
    expect(fell.canHost()).toBe(false);
  });
});

describe("given the device class (a GPU that is hardware, and a pointer or user agent that says desktop or mobile)", () => {
  const nvidia = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)";
  const mali = "ANGLE (ARM, Mali-G715, OpenGL ES 3.2)";
  it("when the pointer is fine and the GPU is hardware, then it is a desktop", () => {
    expect(deviceClass(nvidia, true, false)).toBe("desktop");
  });
  it("when the renderer is a software rasterizer or unknown, then it is software whatever the pointer", () => {
    expect(deviceClass("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)", true, false)).toBe("software");
    expect(deviceClass("llvmpipe (LLVM 15.0.7, 256 bits)", true, false)).toBe("software");
    expect(deviceClass("ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)", true, false)).toBe("software");
    expect(deviceClass("Gallium 0.4 on softpipe", true, false)).toBe("software");
    expect(deviceClass(null, true, false)).toBe("software");
    expect(deviceClass(null, false, true)).toBe("software");
  });
  it("when the GPU is hardware but the pointer is coarse or the user agent says mobile, then it is mobile", () => {
    expect(deviceClass(mali, false, true)).toBe("mobile");
    expect(deviceClass(mali, false, false)).toBe("mobile");
    expect(deviceClass(nvidia, true, true)).toBe("mobile");
  });
});

describe("given the GPU name read from a WebGL context", () => {
  /** A context whose `RENDERER` says `plain`, with the debug extension (naming `real`) or none; `asked` counts extension lookups. */
  const context = (plain: string, real: string | null) => {
    const asked = { n: 0 };
    const gl = {
      RENDERER: 0x1f01,
      getParameter: (p: number) => (p === 0x1f01 ? plain : real),
      getExtension: (name: string) => {
        asked.n++;
        return name === "WEBGL_debug_renderer_info" && real !== null ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null;
      },
    } as unknown as WebGLRenderingContext;
    return { gl, asked };
  };
  it("when RENDERER names the GPU (Firefox), then that name is used and the deprecated extension is never asked", () => {
    const { gl, asked } = context("NVIDIA GeForce RTX 3070", "ANGLE (masked)");
    expect(gpuRenderer(gl)).toBe("NVIDIA GeForce RTX 3070");
    expect(asked.n).toBe(0);
  });
  it("when RENDERER is masked (Chrome), then the extension supplies the name, and null when there is none", () => {
    expect(gpuRenderer(context("WebKit WebGL", "ANGLE (NVIDIA, RTX 3070)").gl)).toBe("ANGLE (NVIDIA, RTX 3070)");
    expect(gpuRenderer(context("WebKit WebGL", null).gl)).toBe(null);
  });
});

/** A segment of identical frames: the wall interval, the main thread's ms, the draw submit's ms inside it (none given: all of it) and the GPU's ms (-1: no timer) of each, for `seconds`. */
interface Spell {
  seconds: number;
  wallMs: number;
  workMs: number;
  renderMs?: number;
  gpuMs: number;
}

const calm = (seconds: number, wallMs = 1000 / 60): Spell => ({ seconds, wallMs, workMs: 3, gpuMs: 2 });
/** Too full for 60 fps: 22 ms of main-thread work a frame, so the display shows every other vsync. */
const overloaded = (seconds: number): Spell => ({ seconds, wallMs: 2000 / 60, workMs: 22, gpuMs: 8 });

/** Feeds the spells in turn, outside a match; every switch as [second it happened, tier]. */
function runSpells(fx: AutoFx, spells: Spell[]): [number, FxTier][] {
  const out: [number, FxTier][] = [];
  let t = 0;
  for (const spell of spells) {
    for (let spent = 0; spent < spell.seconds * 1000; spent += spell.wallMs) {
      t += spell.wallMs;
      const to = fx.frame(spell.wallMs, spell.workMs, spell.renderMs ?? spell.workMs, spell.gpuMs, null);
      if (to !== null) out.push([Math.round(t / 100) / 10, to]);
    }
  }
  return out;
}

describe("given the tier decided by frame work (the main thread's and the GPU's ms against the 60 fps budget), whatever the display's refresh", () => {
  const refreshCases = [
    { it: "when a 48 Hz display shows 3 ms of work and 2 ms of GPU, then it lifts to high although the screen shows 48 fps", spells: [calm(10, 1000 / 48)], expected: [[2.5, "high"]] },
    { it: "when a 30 Hz display shows 3 ms of work and 2 ms of GPU, then it lifts to high although the screen shows 30 fps", spells: [calm(10, 1000 / 30)], expected: [[2.6, "high"]] },
    { it: "when a 144 Hz display shows 3 ms of work and no GPU timer, then it lifts to high", spells: [{ seconds: 10, wallMs: 1000 / 144, workMs: 3, gpuMs: -1 }], expected: [[2.5, "high"]] },
    { it: "when a 60 Hz display shows 15 ms of work (on time, but a frame 90 % full) and no GPU timer, then it stays minimal", spells: [{ seconds: 10, wallMs: 1000 / 60, workMs: 15, gpuMs: -1 }], expected: [] },
    { it: "when a 60 Hz display shows 3 ms of work but 15 ms of GPU, then it stays minimal", spells: [{ seconds: 10, wallMs: 1000 / 60, workMs: 3, gpuMs: 15 }], expected: [] },
  ] as const;
  for (const testCase of refreshCases) {
    it(testCase.it, () => {
      expectMoves(runSpells(new AutoFx(true, true), [...testCase.spells]), testCase.expected, testCase.it);
    });
  }

  it("when a spell of overload falls to minimal and the load then ends, then it climbs one tier at a time after a long calm, never straight to high", () => {
    const moves = runSpells(new AutoFx(true, true), [calm(4), overloaded(12), calm(120)]);
    expectMoves(moves, [[2.5, "high"], [7, "low"], [11.6, "minimal"], [33.4, "low"], [43, "high"]], "overload then calm");
  });

  it("when the load comes and goes every 10 s for 80 s, then it moves 5 times, not on every spell: a climb that fails is not repeated soon", () => {
    const spells = Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? calm(10) : overloaded(10)));
    expectMoves(runSpells(new AutoFx(true, true), spells), [[2.5, "high"], [13.2, "low"], [17.7, "minimal"], [47.5, "low"], [53, "minimal"]], "load every 10 s");
  });

  it("when frames stay calm for 2 minutes, then it stays on high and never asks for the ultra tier", () => {
    const asked = runSpells(new AutoFx(true, true), [calm(120)]).map((m) => m[1]);
    expect(firstMismatch(asked, ["high"])).toBeUndefined();
  });
});

describe("given the tier judged by the render alone (a phone's sim fills its frame, and no tier changes the sim)", () => {
  /** The owner's phone card: 40 ms of sim and 6 ms of draw submit a frame, a 20 fps wall rate, no GPU timer. */
  const phone = (seconds: number, renderMs = 6): Spell => ({ seconds, wallMs: 34 + renderMs + 10, workMs: 40 + renderMs, renderMs, gpuMs: -1 });
  /** The owner's desktop card: about 8 ms of sim, 2 ms of draw submit, 3 ms of GPU, 60 fps. */
  const desktop = (seconds: number): Spell => ({ seconds, wallMs: 1000 / 60, workMs: 10, renderMs: 2, gpuMs: 3 });

  it("when a phone's render has room (6 ms) though its sim takes 40 ms a frame, then it lifts, and never to ultra", () => {
    expectMoves(runSpells(new AutoFx(true, true, false), [phone(120)]), [[2.6, "high"]], "phone with room in its render");
  });

  it("when a desktop's sim is light (the owner's card), then it lifts to high 2.5 s after ready and stays, as before the split", () => {
    expectMoves(runSpells(new AutoFx(true, true), [desktop(120)]), [[2.5, "high"]], "desktop with a light sim");
  });

  it("when a phone's render takes 14 ms, then it steps down as a desktop's would, high to low to minimal", () => {
    expectMoves(runSpells(new AutoFx(true, true, false), [phone(4), phone(20, 14)]), [[2.6, "high"], [7.2, "low"], [11.8, "minimal"]], "phone with a 14 ms render");
  });

  it("when the sim alone fills the frame, then the device may not host: not a phone that lifts, and not a desktop either", () => {
    const fresh = new AutoFx(true, true, false);
    expect(fresh.canHost()).toBe(false);
    const mobile = new AutoFx(true, true, false);
    expectMoves(runSpells(mobile, [phone(20)]), [[2.6, "high"]], "phone");
    expect(mobile.canHost(), "a phone that holds high on its render is still not fit to host").toBe(false);
    const heavySim = new AutoFx(true, true);
    expectMoves(runSpells(heavySim, [phone(20)]), [[2.6, "high"]], "desktop with a 40 ms sim");
    expect(heavySim.canHost(), "judged on the main thread's total, sim included, the desktop with a 40 ms sim is not fit either").toBe(false);
    const card = new AutoFx(true, true);
    runSpells(card, [desktop(20)]);
    expect(card.canHost(), "the owner's desktop card is fit").toBe(true);
  });
});
