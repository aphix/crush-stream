import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { setGround } from "../world/ground.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";

/** Frames the rows run: enough that a panel fed once per frame has been fed more than once. */
const FRAMES = 5;

/** Stands in for three's `Stats` (a canvas panel the node stubs cannot draw): counts the frames it is fed. */
function fakeStats() {
  const fed = { begins: 0, ends: 0 };
  return { fed, panel: { begin: () => void fed.begins++, end: () => void fed.ends++, dom: { remove() {} } } };
}

describe("given the frame-time panel (the Backslash key) up on the real engine", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  before(async () => {
    stubBrowser();
    engine = new CrashEngine(element(), new HudStore(), element());
    Object.assign(engine["renderer"], { render() {}, compile() {}, compileAsync: () => Promise.resolve() });
    await engine.ready;
    engine.fadeScenes = false;
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  it("when frames run through advance (the way a bench page, which has no animation loop, draws), then the panel is begun and ended once for each", () => {
    const { fed, panel } = fakeStats();
    Object.assign(engine, { stats: panel });
    engine.advance(FRAMES / FRAME_HZ, { frameDt: 1 / FRAME_HZ, render: true });
    assert.equal(fed.begins, FRAMES, "begun");
    assert.equal(fed.ends, FRAMES, "ended");
  });

  it("when a frame runs through the page's own loop (tick), then the panel is fed once for it too", () => {
    const { fed, panel } = fakeStats();
    Object.assign(engine, { stats: panel });
    engine["tick"](performance.now());
    assert.equal(fed.begins, 1, "begun");
    assert.equal(fed.ends, 1, "ended");
  });
});
