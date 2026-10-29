import { describe, expect, it, vi } from "vitest";
import { CALM_MS, watchCalm } from "./hud-collapse.ts";

/** A page stand-in: `closest` answers like an element (null: not inside the driving controls). */
const makePage = (onControls = false) => Object.assign(new EventTarget(), { closest: () => (onControls ? {} : null) });
const tap = (target: EventTarget) => target.dispatchEvent(new Event("pointerdown"));

/** Counts the watcher's two callbacks. */
const counters = () => {
  const counts = { calm: 0, wake: 0 };
  return { counts, onCalm: () => counts.calm++, onWake: () => counts.wake++ };
};
const expectCounts = (counts: { calm: number; wake: number }, calm: number, wake: number) => {
  expect(counts.calm, "calm callbacks").toBe(calm);
  expect(counts.wake, "wake callbacks").toBe(wake);
};

describe("given the driving HUD's calm watcher (read-outs fade once nothing has changed for a few seconds)", () => {
  it("when the page stays untouched for the calm time, then the HUD calms exactly when the time is up, not before", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const page = makePage();
    const { counts, onCalm, onWake } = counters();
    const watch = watchCalm(page, onCalm, onWake);
    vi.advanceTimersByTime(CALM_MS - 1);
    expect(counts.calm).toBe(0);
    vi.advanceTimersByTime(1);
    expect(counts.calm).toBe(1);
    expect(counts.wake).toBe(0);
    watch.stop();
    vi.useRealTimers();
  });

  it("when a tap lands on the page before the calm time is up, then the countdown restarts and the HUD never calms under a finger in use", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const page = makePage();
    const { counts, onCalm, onWake } = counters();
    const watch = watchCalm(page, onCalm, onWake);
    vi.advanceTimersByTime(CALM_MS - 1);
    tap(page);
    vi.advanceTimersByTime(CALM_MS - 1);
    expect(counts.calm).toBe(0);
    expect(counts.wake, "a tap while lit has nothing to wake").toBe(0);
    vi.advanceTimersByTime(1);
    expect(counts.calm).toBe(1);
    watch.stop();
    vi.useRealTimers();
  });

  it("when the HUD is calm and a tap lands on the page, then it wakes once and calms again a full calm time later", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const page = makePage();
    const { counts, onCalm, onWake } = counters();
    const watch = watchCalm(page, onCalm, onWake);
    vi.advanceTimersByTime(CALM_MS);
    tap(page);
    expectCounts(counts, 1, 1);
    vi.advanceTimersByTime(CALM_MS - 1);
    expectCounts(counts, 1, 1);
    vi.advanceTimersByTime(1);
    expectCounts(counts, 2, 1);
    watch.stop();
    vi.useRealTimers();
  });

  it("when the tap lands on the driving controls, then the countdown is not restarted and a calm HUD stays calm, so holding the pedals does not keep it lit", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const page = makePage(true);
    const { counts, onCalm, onWake } = counters();
    const watch = watchCalm(page, onCalm, onWake);
    vi.advanceTimersByTime(CALM_MS - 1);
    tap(page);
    vi.advanceTimersByTime(1);
    expect(counts.calm).toBe(1);
    tap(page);
    expect(counts.wake).toBe(0);
    watch.stop();
    vi.useRealTimers();
  });

  it("when the HUD asks to wake (a pass, a lap, a crash), then a calm HUD wakes and the countdown restarts, with no tap involved", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const page = makePage();
    const { counts, onCalm, onWake } = counters();
    const watch = watchCalm(page, onCalm, onWake);
    vi.advanceTimersByTime(CALM_MS);
    watch.wake();
    expectCounts(counts, 1, 1);
    vi.advanceTimersByTime(CALM_MS - 1);
    expect(counts.calm).toBe(1);
    vi.advanceTimersByTime(1);
    expect(counts.calm).toBe(2);
    watch.stop();
    vi.useRealTimers();
  });

  it("when the HUD asks to wake before it has calmed, then the countdown restarts and nothing is woken", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const page = makePage();
    const { counts, onCalm, onWake } = counters();
    const watch = watchCalm(page, onCalm, onWake);
    vi.advanceTimersByTime(CALM_MS - 1);
    watch.wake();
    vi.advanceTimersByTime(CALM_MS - 1);
    expectCounts(counts, 0, 0);
    watch.stop();
    vi.useRealTimers();
  });

  it("when the watcher is stopped, then its countdown and its listener are cancelled and the HUD never calms or wakes", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const page = makePage();
    const { counts, onCalm, onWake } = counters();
    const watch = watchCalm(page, onCalm, onWake);
    watch.stop();
    tap(page);
    vi.advanceTimersByTime(CALM_MS * 2);
    expectCounts(counts, 0, 0);
    vi.useRealTimers();
  });
});
