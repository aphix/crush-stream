import { afterEach, describe, expect, it } from "vitest";
import { BENCH, blocksOf } from "./bench-measure.ts";
import { alternate } from "./bench-frame.ts";
import { display, restoreFrame, rig, STEADY_MS, STEADY_SIM_MS, STRETCH } from "./bench-frame.test-util.ts";
import { CAUSE_NAMES } from "./bench-hitch.ts";
import { ArmBadge } from "./bench-badge.ts";
import { frame } from "./bench-frame.ts";
import { epicenterOn } from "../deform/epicenter.ts";
import { KNOBS } from "../hud/knobs.ts";
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
