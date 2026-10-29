import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { decodeShare, encodeShare } from "../hud/share-url.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

/** Frames the rows run: enough that a panel fed once per frame has been fed more than once. */
const FRAMES = 5;
/** Three's `Stats` panels in its own order: frames per second, ms per frame, heap. */
const FPS = 0;
const MS = 1;
const PANELS = 3;

/** Stands in for three's `Stats` (a canvas panel the node stubs cannot draw): counts the frames it is fed and shows one of three panels, as the real one's children do. */
function fakeStats(shown = FPS) {
  const fed = { begins: 0, ends: 0, removed: false };
  const children = Array.from({ length: PANELS }, (_, i) => ({ style: { display: i === shown ? "block" : "none" } }));
  const panel = {
    begin: () => void fed.begins++,
    end: () => void fed.ends++,
    showPanel: (id: number) => {
      for (const [i, c] of children.entries()) c.style.display = i === id ? "block" : "none";
    },
    dom: { remove: () => void (fed.removed = true), children },
  };
  return { fed, panel };
}

describe("given the frame-time panel (the Backslash key) up on the real engine", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  const shareKeys = (): string[] =>
    encodeShare(engine["shareState"]())
      .split("&")
      .filter((kv) => kv.startsWith("stats="));
  beforeAll(async () => {
    stubBrowser();
    engine = await bootEngine();
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when frames run through advance (the way a bench page, which has no animation loop, draws), then the panel is begun and ended once for each", () => {
    const { fed, panel } = fakeStats();
    Object.assign(engine, { stats: panel });
    engine.advance(FRAMES / FRAME_HZ, { frameDt: 1 / FRAME_HZ, render: true });
    expect(fed.begins, "begun").toBe(FRAMES);
    expect(fed.ends, "ended").toBe(FRAMES);
  });

  it("when a frame runs through the page's own loop (tick), then the panel is fed once for it too", () => {
    const { fed, panel } = fakeStats();
    Object.assign(engine, { stats: panel });
    engine["tick"](performance.now());
    expect(fed.begins, "begun").toBe(1);
    expect(fed.ends, "ended").toBe(1);
  });

  it("when the panel is up on FPS, then the share state carries stats=0; a click that moves it to ms moves the key; down, there is no key", () => {
    const { panel } = fakeStats(FPS);
    Object.assign(engine, { stats: panel });
    expect(firstMismatch(shareKeys(), ["stats=0"]), "FPS").toBeUndefined();
    panel.showPanel(MS);
    expect(firstMismatch(shareKeys(), ["stats=1"]), "the panel's own click moved it to ms").toBeUndefined();
    Object.assign(engine, { stats: null });
    expect(shareKeys(), "down").toHaveLength(0);
  });

  it("when a link carrying stats= is applied, then the panel comes up on the panel it names, a link without the key puts it down, and one past the last panel clamps to it", () => {
    const { fed, panel } = fakeStats(FPS);
    Object.assign(engine, { stats: panel });
    engine["applyShare"](decodeShare("#stats=1"), false);
    expect(engine.statsPanel(), "ms").toBe(MS);
    expect(panel.dom.children[MS]!.style.display).toBe("block");
    expect(panel.dom.children[FPS]!.style.display).toBe("none");
    engine["applyShare"](decodeShare("#stats=9"), false);
    expect(engine.statsPanel(), "clamped to the heap panel").toBe(PANELS - 1);
    engine["applyShare"](decodeShare("#"), false);
    expect(engine.statsPanel(), "down").toBe(null);
    expect(fed.removed, "the panel left the page").toBe(true);
  });
});
