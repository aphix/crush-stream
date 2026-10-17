import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { CALM_MS, watchCalm } from "./hud-collapse.ts";

/** A page stand-in: `closest` answers like an element (null: not inside the driving controls). */
const makePage = (onControls = false) => Object.assign(new EventTarget(), { closest: () => (onControls ? {} : null) });
const tap = (target: EventTarget) => target.dispatchEvent(new Event("pointerdown"));

/** Counts the watcher's two callbacks. */
const counters = () => {
  const counts = { calm: 0, wake: 0 };
  return { counts, onCalm: () => counts.calm++, onWake: () => counts.wake++ };
};

describe("given the driving HUD's calm watcher (read-outs fade once nothing has changed for a few seconds)", () => {
  it("when the page stays untouched for the calm time, then the HUD calms exactly when the time is up, not before", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const page = makePage();
    const { counts, onCalm, onWake } = counters();
    const watch = watchCalm(page, onCalm, onWake);
    mock.timers.tick(CALM_MS - 1);
    assert.equal(counts.calm, 0);
    mock.timers.tick(1);
    assert.equal(counts.calm, 1);
    assert.equal(counts.wake, 0);
    watch.stop();
    mock.timers.reset();
  });

  it("when a tap lands on the page before the calm time is up, then the countdown restarts and the HUD never calms under a finger in use", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const page = makePage();
    const { counts, onCalm, onWake } = counters();
    const watch = watchCalm(page, onCalm, onWake);
    mock.timers.tick(CALM_MS - 1);
    tap(page);
    mock.timers.tick(CALM_MS - 1);
    assert.equal(counts.calm, 0);
    assert.equal(counts.wake, 0, "a tap while lit has nothing to wake");
    mock.timers.tick(1);
    assert.equal(counts.calm, 1);
    watch.stop();
    mock.timers.reset();
  });

  it("when the HUD is calm and a tap lands on the page, then it wakes once and calms again a full calm time later", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const page = makePage();
    const { counts, onCalm, onWake } = counters();
    const watch = watchCalm(page, onCalm, onWake);
    mock.timers.tick(CALM_MS);
    tap(page);
    assert.deepEqual(counts, { calm: 1, wake: 1 });
    mock.timers.tick(CALM_MS - 1);
    assert.deepEqual(counts, { calm: 1, wake: 1 });
    mock.timers.tick(1);
    assert.deepEqual(counts, { calm: 2, wake: 1 });
    watch.stop();
    mock.timers.reset();
  });

  it("when the tap lands on the driving controls, then the countdown is not restarted and a calm HUD stays calm, so holding the pedals does not keep it lit", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const page = makePage(true);
    const { counts, onCalm, onWake } = counters();
    const watch = watchCalm(page, onCalm, onWake);
    mock.timers.tick(CALM_MS - 1);
    tap(page);
    mock.timers.tick(1);
    assert.equal(counts.calm, 1);
    tap(page);
    assert.equal(counts.wake, 0);
    watch.stop();
    mock.timers.reset();
  });

  it("when the HUD asks to wake (a pass, a lap, a crash), then a calm HUD wakes and the countdown restarts, with no tap involved", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const page = makePage();
    const { counts, onCalm, onWake } = counters();
    const watch = watchCalm(page, onCalm, onWake);
    mock.timers.tick(CALM_MS);
    watch.wake();
    assert.deepEqual(counts, { calm: 1, wake: 1 });
    mock.timers.tick(CALM_MS - 1);
    assert.equal(counts.calm, 1);
    mock.timers.tick(1);
    assert.equal(counts.calm, 2);
    watch.stop();
    mock.timers.reset();
  });

  it("when the HUD asks to wake before it has calmed, then the countdown restarts and nothing is woken", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const page = makePage();
    const { counts, onCalm, onWake } = counters();
    const watch = watchCalm(page, onCalm, onWake);
    mock.timers.tick(CALM_MS - 1);
    watch.wake();
    mock.timers.tick(CALM_MS - 1);
    assert.deepEqual(counts, { calm: 0, wake: 0 });
    watch.stop();
    mock.timers.reset();
  });

  it("when the watcher is stopped, then its countdown and its listener are cancelled and the HUD never calms or wakes", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const page = makePage();
    const { counts, onCalm, onWake } = counters();
    const watch = watchCalm(page, onCalm, onWake);
    watch.stop();
    tap(page);
    mock.timers.tick(CALM_MS * 2);
    assert.deepEqual(counts, { calm: 0, wake: 0 });
    mock.timers.reset();
  });
});
