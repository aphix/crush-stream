import { describe, expect, it } from "vitest";
import { fakeAudio } from "./ambient-fake-context.test-util.ts";
import { measure, peakOf, writeRender } from "./ambient-render.test-util.ts";
import { UI_RATE, uiBuffer, type UiName } from "./ui-render.ts";
import { UiSound } from "./ui-sound.ts";

const LANE = "AudioAmbient";

/** What each sound is meant to be: its slowest attack (ms), its length range (s), and where its energy sits: `mid` is 0.8-6 kHz, `bright` is over 6 kHz, `full` is under 800 Hz. */
const INTENT: Record<UiName, { attackMs: number; length: readonly [number, number]; band: "mid" | "bright" | "full"; sparkle?: number }> = {
  select: { attackMs: 10, length: [0.2, 0.5], band: "mid" },
  confirm: { attackMs: 120, length: [0.4, 1], band: "mid" },
  back: { attackMs: 50, length: [0.2, 0.5], band: "mid" },
  open: { attackMs: 100, length: [0.5, 1.2], band: "bright" },
  close: { attackMs: 100, length: [0.3, 0.8], band: "mid" },
  equip: { attackMs: 10, length: [0.15, 0.4], band: "mid" },
  pickup: { attackMs: 150, length: [0.5, 1.2], band: "mid", sparkle: 0.2 },
  alert: { attackMs: 150, length: [0.3, 0.8], band: "mid" },
  countdown: { attackMs: 10, length: [0.2, 0.5], band: "mid" },
  go: { attackMs: 100, length: [0.8, 1.6], band: "mid" },
  finish: { attackMs: 700, length: [1.5, 3], band: "full" },
  wrecked: { attackMs: 100, length: [1.5, 3], band: "full" },
};

const NAMES = Object.keys(INTENT) as UiName[];

describe("given each UI sound", () => {
  for (const name of NAMES) {
    it(`when ${name} is measured, then its attack, length and band are what it is meant to be, and it does not clip`, () => {
      const want = INTENT[name];
      const buffer = uiBuffer(name);
      const m = measure(buffer, UI_RATE);
      writeRender(LANE, `ui-${name}`, UI_RATE, buffer);
      expect(m.peak, `${name} peak`).toBeGreaterThan(0.3);
      expect(m.peak, `${name} peak`).toBeLessThan(0.7);
      expect(m.attackMs, `${name} attack (ms)`).toBeLessThanOrEqual(want.attackMs);
      expect(m.lengthS, `${name} length (s)`).toBeGreaterThanOrEqual(want.length[0]);
      expect(m.lengthS, `${name} length (s)`).toBeLessThanOrEqual(want.length[1]);
      const [low, lowMid, mid, upper, top] = m.bands as [number, number, number, number, number];
      if (want.band === "mid") expect(mid + upper + top, `${name} share 0.8-6k+`).toBeGreaterThan(0.9);
      if (want.band === "bright") expect(top, `${name} share over 6 kHz`).toBeGreaterThan(0.5);
      if (want.band === "full") expect(low + lowMid, `${name} share under 800 Hz`).toBeGreaterThan(0.4);
      if (want.sparkle !== undefined) expect(top, `${name} share over 6 kHz`).toBeGreaterThan(want.sparkle);
    });
  }

  it("when each sound is read to its last sample, then it is finite and ends in silence, not a click", () => {
    for (const name of NAMES) {
      const first = uiBuffer(name);
      expect(first[first.length - 1]!, `${name} last sample`).toBeLessThan(0.05 * peakOf(first));
      expect(Number.isFinite(peakOf(first)), `${name} finite`).toBe(true);
    }
  });
});

describe("given a UiSound on a recording context", () => {
  it("when a sound is played twice, then two sources start on one shared buffer of its length", () => {
    const { fake, ctx, out } = fakeAudio();
    const ui = new UiSound(ctx, out);
    ui.play("confirm");
    ui.play("confirm");
    ui.play("go");
    const sources = fake.nodes.filter((node) => node.buffer !== null);
    expect(sources.map((node) => node.started)).toEqual([1, 1, 1]);
    expect(sources[0]!.buffer, "the same buffer both times").toBe(sources[1]!.buffer);
    expect(sources[0]!.buffer!.length, "its length").toBe(uiBuffer("confirm").length);
    expect(sources[2]!.buffer!.length, "another sound's").toBe(uiBuffer("go").length);
  });
});
