import { afterEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Scene, Vector3 } from "three";
import { BENCH, blocksOf, tap } from "./bench-measure.ts";
import { alternate } from "./bench-frame.ts";
import { display, restoreFrame, rig, STEADY_MS, STEADY_SIM_MS, STRETCH } from "./bench-frame.test-util.ts";
import { CAUSE_NAMES } from "./bench-hitch.ts";
import { ArmBadge } from "./bench-badge.ts";
import { frame, FRAME_CPU, FRAME_DRAW } from "./bench-frame.ts";
import { COUNT, countPart, frameParts, lapPart, PART } from "../kernel/frame-parts.ts";
import { epicenterOn } from "../deform/epicenter.ts";
import { KNOBS } from "../hud/knobs.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { SETTLE } from "./bench-settle.ts";

/** The clock's float rounding in a mean of 500 frames' sim ms. */
const SIM_TOLERANCE_MS = 1e-3;
/** A block ends on the frame that carries its wall time past `blockS`: the float sum of the frames' times puts that frame within one of the exact count. */
const FRAME_COUNT_SLACK = 1;

afterEach(restoreFrame);

/** A device that returned no timer queries: the blocks carry the arms' sums alone. */
const NO_GPU_QUERIES = { n: 0, block: new Uint32Array(0), ms: new Float64Array(0) } as unknown as Parameters<typeof blocksOf>[1];

const ui = { set() {} };

/** A hang of 400 ms that falls 20 % a frame back to a steady frame within 80 frames. */
const decaying = (since: number): number => (since < 80 ? STEADY_MS + 400 * 0.8 ** since : STEADY_MS);

describe("given an A/B whose second arm opens with a decaying hang (400 ms, falling 20 % a frame)", () => {
  it("when the arms are scored, then the hang arm's scored frames cost what the steady arm's do, and its hang is the switch's, not the arm's", async () => {
    const { engine, parts, t, beat } = rig();
    const result = await alternate(engine, parts, t, beat, ui, "fx", [
      { key: "steady", set: () => display.use(() => STEADY_MS) },
      { key: "hang", set: () => display.use(decaying) },
    ], 1);
    const steady = result.accs.get("steady")!;
    const hang = result.accs.get("hang")!;
    expect(Math.abs(steady.sim / steady.frames - STEADY_SIM_MS), "the steady arm's sim ms a frame").toBeLessThan(SIM_TOLERANCE_MS);
    expect(Math.abs(hang.sim / hang.frames - STEADY_SIM_MS), "the hang arm's sim ms a frame: no frame of the hang was scored").toBeLessThan(SIM_TOLERANCE_MS);
    expect(Math.abs(hang.frames - steady.frames), `frames scored in the block: ${hang.frames} against ${steady.frames}`).toBeLessThanOrEqual(FRAME_COUNT_SLACK);
    const [first, second] = result.switches;
    expect(first!.longestMs, "the steady switch's longest frame is an ordinary one").toBeLessThan(2 * STEADY_MS);
    expect(second!.arm, "the second switch").toBe("hang");
    expect(second!.longestMs, `the hang is the switch's longest frame (${second!.longestMs} ms)`).toBeGreaterThanOrEqual(400);
    expect(second!.longestAt, "at the first frame after the switch").toBe(0);
    expect(second!.frames, `${second!.frames} frames watched: the hang took more than ten frames to fall`).toBeGreaterThan(15);
    expect(second!.settled, "settled").toBe(true);
  });

  it("when the arms are steady throughout, then every switch settles in two windows of frames and each arm scores the same frames", async () => {
    const { engine, parts, t, beat } = rig();
    const result = await alternate(engine, parts, t, beat, ui, "fx", [{ key: "a", set() {} }, { key: "b", set() {} }], 2);
    expect(result.switches.length, "two arms, two rounds").toBe(4);
    for (const s of result.switches) {
      expect(s.settled, `${s.arm} round ${s.round} settled`).toBe(true);
      expect(s.frames, `${s.arm} round ${s.round} frames watched`).toBe(2 * SETTLE.frames);
    }
    const a = result.accs.get("a")!;
    const b = result.accs.get("b")!;
    expect(Math.abs(a.frames - b.frames), `frames scored by each arm: ${a.frames} against ${b.frames}`).toBeLessThanOrEqual(2 * FRAME_COUNT_SLACK);
    expect(Math.abs(a.frames - 2 * (BENCH.blockS / (STEADY_MS / 1000))), `two blocks of the block length at 6 ms: ${a.frames} frames`).toBeLessThanOrEqual(2 * FRAME_COUNT_SLACK);
  });

  it("when a frame time never levels (it grows 10 % a frame), then the arm is scored after the cap and its switch says it never settled", async () => {
    const { engine, parts, t, beat } = rig();
    const result = await alternate(engine, parts, t, beat, ui, "fx", [{ key: "never", set: () => display.use((since) => STEADY_MS * 1.1 ** since) }], 1);
    const [only] = result.switches;
    expect(only!.settled, "settled").toBe(false);
    expect(only!.settleS, `${only!.settleS} s watched`).toBeGreaterThanOrEqual(SETTLE.capS);
  });

  it("when a hang falls inside the settle watch, then the hitch log holds it with the tier-switch cause and the stretch the arm ran in, and the scored block adds none", async () => {
    const { engine, parts, t, beat } = rig();
    await alternate(engine, parts, t, beat, ui, "fx", [{ key: "a", set: () => display.use((since) => (since === 45 ? 450 : STEADY_MS)) }], 1);
    const table = beat.hitches.table();
    expect(table.count, "hitches").toBe(1);
    expect(table.rows[0]!.ms, "the hang's ms").toBe(450);
    expect(table.rows[0]!.phase, "its stretch").toBe(STRETCH);
    expect(table.rows[0]!.causes.includes(CAUSE_NAMES[0]), "the setting-switch cause").toBeTruthy();
  });
});

describe("given an A/B's arm whose sim cost swings from one second to the next, and one whose cost holds", () => {
  /** The sim's cost a frame in the swinging arm: 1x in its even seconds, 4x in its odd (6 ms frames, 166 a second), counted from where the arm's scored block begins (after its settle watch). */
  const swinging = (since: number): number => (Math.floor(Math.max(0, since - 2 * SETTLE.frames) / 166) % 2 === 0 ? 1 : 4);

  it("when the arms are scored, then the swinging arm's spread reads high, the steady arm's reads zero, and neither counts a switch that never settled", async () => {
    const { engine, parts, t, beat } = rig();
    const result = await alternate(engine, parts, t, beat, ui, "fx", [
      { key: "steady", set: () => display.use(() => STEADY_MS) },
      { key: "swing", set: () => display.use(() => STEADY_MS, swinging) },
    ], 1);
    const steady = result.accs.get("steady")!;
    const swing = result.accs.get("swing")!;
    expect(steady.binN, `${steady.binN} whole seconds binned for a ${BENCH.blockS} s block`).toBeGreaterThanOrEqual(BENCH.blockS - 1);
    const blocks = blocksOf(result, NO_GPU_QUERIES);
    expect(blocks["steady"]!.simSpreadPct, "the steady arm's spread").toBeLessThan(1);
    expect(blocks["swing"]!.simSpreadPct, `the swinging arm's spread: ${blocks["swing"]!.simSpreadPct} %`).toBeGreaterThan(40);
    expect(steady.unsettled + swing.unsettled, "every switch settled").toBe(0);
  });

  it("when a switch never settles, then its arm counts it", async () => {
    const { engine, parts, t, beat } = rig();
    const result = await alternate(engine, parts, t, beat, ui, "fx", [{ key: "never", set: () => display.use((since) => STEADY_MS * 1.1 ** since) }], 2);
    expect(result.accs.get("never")!.unsettled, "two rounds, two switches").toBe(2);
  });
});

describe("given the bench card's arm label, kept up to date by the bench's frames", () => {
  const knob = KNOBS.find((k) => k.id === "epi.on")!;
  const initial = knob.get();

  it("when the epicenter knob is turned on between two frames, then the label reads ON after the next frame, and off again after the knob goes back", async () => {
    const { engine, parts, t, beat } = rig();
    const element = { textContent: "" as string | null, style: { cssText: "" } };
    beat.arm = new ArmBadge(element, epicenterOn);
    knob.set(0);
    try {
      await frame(engine, parts.renderer, t, beat);
      expect(element.textContent, "the first frame").toBe("epicenter off");
      knob.set(1);
      await frame(engine, parts.renderer, t, beat);
      expect(element.textContent, "the frame after the knob went on").toBe("EPICENTER ON");
      knob.set(0);
      await frame(engine, parts.renderer, t, beat);
      expect(element.textContent, "the frame after it went back").toBe("epicenter off");
    } finally {
      knob.set(initial);
    }
  });
});

describe("given a frame whose engine laps the part clock on a scripted clock (2 ms skinning, 3 ms effects, 1 ms of nothing named)", () => {
  it("when the bench runs the frame, then each part holds the ms it was lapped for, the unnamed tail is `rest`, and the parts sum to the frame's cpu", async () => {
    const { engine, parts, t, beat } = rig();
    let clock = 5000;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    engine.advance = () => {
      clock += 2;
      lapPart(PART.skin);
      clock += 3;
      lapPart(PART.fx);
      clock += 1;
    };
    frameParts.ms.fill(0);
    try {
      await frame(engine, parts.renderer, t, beat);
    } finally {
      spy.mockRestore();
    }
    expect(frameParts.ms[PART.skin], "skin").toBe(2);
    expect(frameParts.ms[PART.fx], "fx").toBe(3);
    expect(frameParts.ms[PART.rest], "the tail after the last lap").toBe(1);
    expect(frameParts.ms.reduce((total, ms) => total + ms, 0), "the parts tile the frame's cpu").toBe(beat.frame[FRAME_CPU]);
  });

  it("when the frame drew 7 calls of which the shadow pass made 3, then the frame's counters say 3 shadow and 4 main", async () => {
    const { engine, parts, t, beat } = rig();
    parts.renderer.info.render.calls = 7;
    engine.advance = () => countPart(COUNT.callsShadow, 3);
    const shadow0 = frameParts.count[COUNT.callsShadow]!;
    const main0 = frameParts.count[COUNT.callsMain]!;
    await frame(engine, parts.renderer, t, beat);
    expect(frameParts.count[COUNT.callsShadow]! - shadow0, "shadow").toBe(3);
    expect(frameParts.count[COUNT.callsMain]! - main0, "main: the frame's calls less the shadow pass's").toBe(4);
  });
});

/**
 * A rig whose renderer draws on a scripted clock (every step a multiple of 0.25 ms, so sums are exact): `renderer.render` culls 1.5 ms, runs a shadow pass through `shadowMap.render` as three does
 * (4 ms and 3 calls for the main scene; 0.25 ms and 2 calls for the blit's own, lit scene), then draws 2 ms (5 calls for the main scene, 1 for the blit). `cine.render` draws the main scene, laps `main`, spends 1 ms on the blit's uniforms,
 * blits and laps `post`, as `PostFX.render` does. The engine's frame is 1 ms of `scenery`, then the draw. `tap` wraps all of it as the bench does.
 */
function scriptedDraw() {
  const { engine, parts, beat } = rig();
  const { renderer, cine } = parts;
  const blit = new Scene();
  const camera = new PerspectiveCamera();
  const clock = { ms: 5000 };
  const spy = vi.spyOn(performance, "now").mockImplementation(() => clock.ms);
  renderer.shadowMap.render = (_lights, scene) => {
    const main = scene === parts.scene;
    clock.ms += main ? 4 : 0.25;
    renderer.info.render.calls += main ? 3 : 2;
  };
  renderer.render = (scene) => {
    clock.ms += 1.5;
    if (scene instanceof Scene) renderer.shadowMap.render([], scene, camera);
    clock.ms += 2;
    renderer.info.render.calls += scene === parts.scene ? 5 : 1;
  };
  cine.render = () => {
    renderer.render(parts.scene, camera);
    lapPart(PART.main);
    clock.ms += 1;
    renderer.render(blit, camera);
    lapPart(PART.post);
  };
  engine.advance = () => {
    clock.ms += 1;
    lapPart(PART.scenery);
    cine.render(parts.scene, camera, 0.016, new Vector3());
  };
  const t = tap({ run() {}, lost: 0 }, parts);
  renderer.info.render.calls = 0;
  frameParts.ms.fill(0);
  frameParts.count.fill(0);
  return { engine, parts, beat, t, camera, clock, finish: async (): Promise<void> => { await t.finish(); spy.mockRestore(); } };
}

describe("given a tapped renderer that runs the shadow pass inside every render, the main scene once and then a post blit of its own scene", () => {
  it("when the frame runs, then the shadow pass is `shadow`, the blit's ms are `post` and not `main`, the parts sum to the draw's ms, and the shadow calls are the main scene's alone", async () => {
    const { engine, parts, beat, t, finish } = scriptedDraw();
    try {
      await frame(engine, parts.renderer, t, beat);
    } finally {
      await finish();
    }
    const ms = (name: keyof typeof PART): number => frameParts.ms[PART[name]]!;
    expect(ms("shadow"), "the main scene's shadow pass").toBe(4);
    expect(ms("main"), "1.5 ms of culling before the shadow pass and 2 ms of drawing after it: not the blit's").toBe(3.5);
    expect(ms("post"), "1 ms of uniforms, then the blit's culling, its own pass and its draw").toBe(4.75);
    expect(ms("scenery"), "the engine's own lap before the draw").toBe(1);
    expect(ms("rest")).toBe(0);
    expect(ms("main") + ms("shadow") + ms("post"), "the draw's parts are the draw's ms").toBe(beat.frame[FRAME_DRAW]);
    expect(frameParts.count[COUNT.callsShadow], "the blit's 2 shadow calls are not the main pass's").toBe(3);
    expect(frameParts.count[COUNT.callsMain], "11 calls in the frame less the main pass's 3 shadow calls").toBe(8);
  });

  it("when a render and a lap happen between two frames (a warm-up draw), then no part holds their ms and no shadow call is counted", async () => {
    const { engine, parts, beat, t, camera, clock, finish } = scriptedDraw();
    try {
      await frame(engine, parts.renderer, t, beat);
      const parted = frameParts.ms.slice();
      const shadowCalls = frameParts.count[COUNT.callsShadow]!;
      clock.ms += 50;
      parts.renderer.render(parts.scene, camera);
      lapPart(PART.fx);
      expect(firstMismatch(frameParts.ms, parted), "every part as the frame left it").toBeUndefined();
      expect(frameParts.count[COUNT.callsShadow], "the warm-up's shadow calls").toBe(shadowCalls);
    } finally {
      await finish();
    }
  });

  it("when the engine throws in the frame, then the laps are off after it: a later lap holds nothing", async () => {
    const { engine, parts, beat, t, clock, finish } = scriptedDraw();
    engine.advance = () => {
      clock.ms += 3;
      lapPart(PART.skin);
      throw new Error("boom");
    };
    try {
      await expect(frame(engine, parts.renderer, t, beat)).rejects.toThrow("boom");
      clock.ms += 9;
      lapPart(PART.fx);
    } finally {
      await finish();
    }
    expect(frameParts.ms[PART.skin], "the lap before the throw").toBe(3);
    expect(frameParts.ms[PART.fx], "the lap after the frame").toBe(0);
  });
});
