import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import "../kernel/rapier-node.test-util.ts";
import { decodeShare } from "../hud/share-url.ts";
import { MINIGAME_MODES, type MinigameMode } from "../scenes/minigame-constants.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

/** A Ring Fling set length other than the default, so a link that drops it reads back wrong. */
const PICKED_SET_LENGTH = 7;

describe("given the real engine on the Range and a browser address bar that records every write", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  const entries: string[] = [""];
  const hashOf = (url: unknown): string => String(url).slice(String(url).indexOf("#"));
  beforeAll(async () => {
    stubBrowser();
    globalThis.history.replaceState = (_state, _unused, url) => {
      entries[entries.length - 1] = hashOf(url);
      globalThis.location.hash = hashOf(url);
    };
    globalThis.history.pushState = (_state, _unused, url) => {
      entries.push(hashOf(url));
      globalThis.location.hash = hashOf(url);
    };
    engine = await bootEngine();
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  /** The link the bar holds after `mode` is picked on the Range, and the mini game that link opens once pasted onto the fleet. */
  const roundTrip = (mode: MinigameMode): { link: string; reopened: MinigameMode | null; entriesAdded: number } => {
    engine["applyShare"](decodeShare("#scene=range"), false);
    const before = entries.length;
    engine.startMinigame(mode);
    const link = globalThis.location.hash;
    const entriesAdded = entries.length - before;
    engine["applyShare"](decodeShare("#"), false);
    engine["applyShare"](decodeShare(link), false);
    return { link, reopened: engine["minigameMode"], entriesAdded };
  };

  it("when each mini game is picked on the Range and its link is pasted, then the link opens the same mini game, and the pick rewrites the Range's entry", () => {
    const seen = MINIGAME_MODES.map((mode) => ({ mode, ...roundTrip(mode) }));
    const report = seen.map((s) => `${s.mode}: ${s.link} -> ${s.reopened}`).join("  |  ");
    for (const s of seen) {
      assert.equal(s.reopened, s.mode, report);
      assert.equal(s.entriesAdded, 0, `${s.mode}: a pick inside the Range adds no history entry`);
    }
  });

  it("when the mini game is exited back to the Range's attract loop, then the link is the plain Range, with no mini game or set length", () => {
    roundTrip("ringFling");
    engine.exitMinigame();
    const keys = [...new URLSearchParams(globalThis.location.hash.replace(/^#/, "")).keys()].filter((k) => k.startsWith("mg"));
    assert.equal(keys.join(","), "", globalThis.location.hash);
    assert.equal(engine["minigameMode"], null);
  });

  it("when Ring Fling's set length is changed and its link is pasted, then the link opens Ring Fling with that set length", () => {
    const { link } = roundTrip("ringFling");
    engine.setMinigameThrowsPerSet(PICKED_SET_LENGTH);
    const withSet = globalThis.location.hash;
    engine["applyShare"](decodeShare("#"), false);
    engine["applyShare"](decodeShare(withSet), false);
    assert.equal(engine["minigames"].hud().throwsPerSet, PICKED_SET_LENGTH, `${link} then ${withSet}`);
  });
});
