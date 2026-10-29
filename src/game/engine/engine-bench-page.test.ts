import { afterEach, beforeEach, describe, test, vi } from "vitest";
import assert from "node:assert/strict";
import { PAGE_PHASES, PHASE_AB_DETAIL, PHASE_AB_FX, PHASE_AB_PACE, PHASE_AB_SKY, PHASE_REPLAY, PHASE_WARM, PHASE_WINDOW } from "./engine-bench-report.ts";
import { watchPage } from "./engine-bench-page.ts";
import { FRAME } from "./bench-hitch.ts";
import { SKY_DRAWN } from "../present/sky-dome.ts";

type Listener = () => void;

/** What the stub page shows and the clock it keeps (ms); the test moves both. */
interface PageState {
  hidden: boolean;
  focused: boolean;
  fullscreen: boolean;
  /** The page runs as an installed app launched with `display: fullscreen`: no `fullscreenElement`, but the display-mode media query matches. */
  installedFullscreen: boolean;
  clockMs: number;
}

interface StubPage {
  page: PageState;
  /** Delivers `type` to the listeners the bench added. */
  fire(type: string): void;
  /** How many listeners are on the document and window now. */
  listening(): number;
}

/** A page with no browser: the document and window the bench listens on, and a clock the test moves. */
function stubPage(): StubPage {
  const listeners = new Map<string, Set<Listener>>();
  const target = {
    addEventListener: (type: string, listener: Listener) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener),
    removeEventListener: (type: string, listener: Listener) => void listeners.get(type)?.delete(listener),
  };
  const page: PageState = { hidden: false, focused: true, fullscreen: false, installedFullscreen: false, clockMs: 1000 };
  Object.defineProperty(globalThis, "document", { value: { ...target, get hidden() { return page.hidden; }, hasFocus: () => page.focused, get fullscreenElement() { return page.fullscreen ? {} : null; } }, configurable: true });
  Object.defineProperty(globalThis, "window", { value: { ...target, matchMedia: (query: string) => ({ matches: query === "(display-mode: fullscreen)" && page.installedFullscreen }) }, configurable: true });
  vi.spyOn(performance, "now").mockImplementation(() => page.clockMs);
  return {
    page,
    fire: (type) => {
      for (const listener of listeners.get(type) ?? []) listener();
    },
    listening: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

describe("given the bench page with a stub document and window (watchPage records the page's state over a run)", () => {
  let stub: StubPage;
  beforeEach(() => {
    stub = stubPage();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "window");
  });

  test("when each phase begins, then it gets an entry named for the phase, at 0 s into it, with the page's state then", () => {
    const watch = watchPage();
    watch.phase(PHASE_WARM);
    stub.page.clockMs += 5000;
    stub.page.focused = false;
    watch.phase(PHASE_WINDOW);
    assert.deepEqual(watch.stop(), [
      { phase: "warm", atS: 0, visible: true, focused: true, fullscreen: false },
      { phase: "window", atS: 0, visible: true, focused: false, fullscreen: false },
    ]);
  });

  test("when the page runs as an installed fullscreen app, then its entries say fullscreen though the document has no fullscreen element", () => {
    stub.page.installedFullscreen = true;
    const watch = watchPage();
    watch.phase(PHASE_WARM);
    assert.deepEqual(watch.stop(), [{ phase: "warm", atS: 0, visible: true, focused: true, fullscreen: true }]);
  });

  test("when the page is hidden and fullscreened during a phase, then each change is an entry in that phase, at the seconds into it", () => {
    const watch = watchPage();
    watch.phase(PHASE_WARM);
    stub.page.clockMs += 2000;
    watch.phase(PHASE_AB_PACE);
    stub.page.clockMs += 1500;
    stub.page.hidden = true;
    stub.fire("visibilitychange");
    stub.page.clockMs += 250;
    stub.page.hidden = false;
    stub.page.fullscreen = true;
    stub.fire("fullscreenchange");
    stub.page.focused = false;
    stub.fire("blur");
    assert.deepEqual(watch.stop(), [
      { phase: "warm", atS: 0, visible: true, focused: true, fullscreen: false },
      { phase: "ab-pace", atS: 0, visible: true, focused: true, fullscreen: false },
      { phase: "ab-pace", atS: 1.5, visible: false, focused: true, fullscreen: false },
      { phase: "ab-pace", atS: 1.75, visible: true, focused: true, fullscreen: true },
      { phase: "ab-pace", atS: 1.75, visible: true, focused: false, fullscreen: true },
    ]);
  });

  test("when the run is over, then the listeners are gone and later changes add nothing", () => {
    const watch = watchPage();
    watch.phase(PHASE_WARM);
    assert.equal(stub.listening(), 4);
    const events = watch.stop();
    assert.equal(stub.listening(), 0);
    stub.fire("blur");
    assert.equal(events.length, 1);
  });

  test("when a tab flickers more often than the log holds, then the changes are dropped but every phase still gets its entry", () => {
    const watch = watchPage();
    watch.phase(PHASE_WARM);
    stub.page.clockMs += 1000;
    for (let i = 0; i < 500; i++) stub.fire("focus");
    watch.phase(PHASE_WINDOW);
    stub.page.clockMs += 1000;
    for (let i = 0; i < 500; i++) stub.fire("focus");
    watch.phase(PHASE_AB_FX);
    const events = watch.stop();
    assert.deepEqual(events.filter((e) => e.atS === 0).map((e) => e.phase), ["warm", "window", "ab-fx"]);
    assert.ok(events.length < 500);
  });

  test("when the phases are named by their index constants, then the names run in the order of a run, the replay of the run's crash last", () => {
    assert.deepEqual([PHASE_WARM, PHASE_WINDOW, PHASE_AB_PACE, PHASE_AB_DETAIL, PHASE_AB_FX, PHASE_AB_SKY, PHASE_REPLAY].map((i) => PAGE_PHASES[i]), ["warm", "window", "ab-pace", "ab-detail", "ab-fx", "ab-sky", "replay"]);
  });

  test("when the replay's phase begins after the A/Bs, then it gets its own entry at 0 s into it", () => {
    const watch = watchPage();
    watch.phase(PHASE_AB_FX);
    stub.page.clockMs += 20_000;
    watch.phase(PHASE_REPLAY);
    const events = watch.stop();
    assert.deepEqual(events.filter((e) => e.atS === 0).map((e) => e.phase), ["ab-fx", "replay"]);
  });

  /** One frame at `stamp` ms into the series (a frame row as the bench loop writes it) and the state `watch` keeps for that second. */
  const tick = (watch: ReturnType<typeof watchPage>, stamp: number, phase: number, awake: boolean, sky = 0, epi = 0): void => {
    const row = new Float64Array(FRAME.fields);
    row[FRAME.now] = stamp;
    watch.tick(row, phase, awake, sky, epi);
  };

  test("when frames tick the series with the page's state, then each second holds one hex digit of shown 1, focused 2, fullscreen 4 and the wake lock held 8, and the stretch's index", () => {
    stub.page.fullscreen = true;
    const watch = watchPage();
    watch.phase(PHASE_WINDOW);
    tick(watch, 5000, PHASE_WINDOW, true);
    tick(watch, 5400, PHASE_WINDOW, true);
    stub.page.focused = false;
    stub.fire("blur");
    tick(watch, 6100, PHASE_WINDOW, true);
    tick(watch, 7200, PHASE_AB_PACE, false);
    const series = watch.seconds();
    assert.equal(series.flags, "fd5", "flags");
    assert.equal(series.phases, "112", "stretches");
  });

  test("when the epicenter knob is on through the last warm second and the first window second, then the series holds the same digit across the stretch change", () => {
    const watch = watchPage();
    watch.phase(PHASE_WARM);
    tick(watch, 1000, PHASE_WARM, true, 0, 1);
    tick(watch, 2000, PHASE_WARM, true, 0, 1);
    tick(watch, 3100, PHASE_WINDOW, true, 0, 1);
    tick(watch, 4200, PHASE_WINDOW, true, 0, 1);
    const { epi, phases } = watch.seconds();
    assert.equal(epi, "1111");
    assert.equal(epi[phases.indexOf("0") + phases.split("0").length - 2], epi[phases.indexOf("1")], "the last warm second against the first window second");
  });

  test("when the sky as drawn changes during the series, then each second holds the digit of the frame that closed it, the loading digit included", () => {
    const watch = watchPage();
    watch.phase(PHASE_WINDOW);
    tick(watch, 5000, PHASE_WINDOW, true, SKY_DRAWN.off);
    tick(watch, 6100, PHASE_WINDOW, true, SKY_DRAWN.loading);
    tick(watch, 7200, PHASE_WINDOW, true, SKY_DRAWN.full);
    tick(watch, 8300, PHASE_WINDOW, true, SKY_DRAWN.half);
    assert.equal(watch.seconds().sky, "0432", "off, loading, full, half");
  });

  test("when the page draws no frame for 3 s (hidden), then the seconds between its frames each hold the state of the last event, so the gap is in the series", () => {
    const watch = watchPage();
    watch.phase(PHASE_WINDOW);
    tick(watch, 1000, PHASE_WINDOW, true);
    stub.page.hidden = true;
    stub.fire("visibilitychange");
    tick(watch, 4100, PHASE_WINDOW, false);
    assert.equal(watch.seconds().flags, "b" + "2".repeat(3), "second 0 shown, focused, wake held: b (1+2+8); the next three: focused only (the wake lock was released with the page)");
    assert.equal(watch.seconds().phases, "1111", "the stretch of each second");
  });

  test("when a run is longer than the series holds, then the series stops at its capacity and writes nothing past it", () => {
    const watch = watchPage();
    watch.phase(PHASE_WINDOW);
    tick(watch, 0, PHASE_WINDOW, true);
    tick(watch, 5_000_000, PHASE_WINDOW, true);
    assert.equal(watch.seconds().flags.length, 1800, "seconds kept");
  });
});
