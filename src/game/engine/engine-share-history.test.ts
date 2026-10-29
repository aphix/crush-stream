import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { CAMERA_PRESETS, cameraPresetValues } from "../hud/camera-presets.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

/**
 * The address bar follows the settings without piling history up (docs/CONTROLS.md): a change inside a scene rewrites the
 * current entry, entering another scene adds exactly one, and Back returns to the scene before with the settings it was left with.
 */

/** Changes made inside one scene: sliders, a preset, a toggle and a switch. */
const CHANGES_PER_SCENE = 12;

describe("given the real engine writing the page's # into a browser history stack", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  let hud: HudStore;
  const entries: string[] = [""];
  let at = 0;
  const hashOf = (url: unknown): string => String(url).slice(String(url).indexOf("#") + 1);
  /** The browser's Back: the previous entry's `#` is the bar, and the page hears `hashchange`. */
  const back = (): void => {
    at--;
    globalThis.location.hash = entries[at]!;
    engine["onShareHash"]();
  };
  beforeAll(async () => {
    stubBrowser();
    Object.assign(globalThis, {
      location: { pathname: "/", search: "", hash: "", href: "http://x/", origin: "http://x" },
      history: {
        state: null,
        replaceState(_s: unknown, _u: string, url: string) {
          entries[at] = hashOf(url);
          globalThis.location.hash = entries[at]!;
        },
        pushState(_s: unknown, _u: string, url: string) {
          entries.length = at + 1;
          entries.push(hashOf(url));
          at++;
          globalThis.location.hash = entries[at]!;
        },
      },
    });
    hud = new HudStore();
    engine = await bootEngine({ hud });
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  const change = (n: number): void => {
    for (let i = 0; i < CHANGES_PER_SCENE / 3; i++) engine.setKnob("cam.pos.lon", 3.5 + n + i * 0.25);
    engine.setKnobs(cameraPresetValues(CAMERA_PRESETS[1]!));
    engine.setKnob("epi.on", n % 2);
    engine.setNight(n % 2 === 0);
    engine.setKnob("cam.shake", 0.1 * (n + 1));
    engine.setKnob("cam.shake", 0.2 * (n + 1));
    engine.setKnob("cam.zeta.lat", 0.5 + 0.05 * n);
    engine.setKnob("cam.driftTilt", 0.5 * n);
  };

  it("when a scene's settings change a dozen times, then the stack has no more entries; entering another scene adds one, its own changes add none, and Back returns to the first scene with its last settings", () => {
    change(1);
    assert.equal(entries.length, 1, "the fleet's changes rewrite the one entry");
    const left = hud.get();
    const fleetBar = entries[0]!;
    assert.match(fleetBar, /cam\.pos\.lon=/, "the fleet's settings are in its entry");

    engine["setScene"]("press");
    assert.equal(engine["sceneId"], "press");
    assert.equal(entries.length, 2, "one entry for the scene change");
    assert.match(entries[1]!, /scene=press/);
    assert.equal(entries[0], fleetBar, "the fleet's entry is as it was left");

    change(2);
    assert.equal(entries.length, 2, "the press's changes rewrite its entry");
    assert.match(entries[1]!, /scene=press/);

    back();
    assert.equal(engine["sceneId"], "fleet");
    assert.equal(hud.get()["cam.pos.lon"], left["cam.pos.lon"], "the camera slider as the fleet left it");
    assert.equal(hud.get()["cam.shake"], left["cam.shake"]);
    assert.equal(hud.get()["epi.on"], left["epi.on"], "the activation as the fleet left it");
    assert.equal(hud.get().night, left.night);
    assert.equal(entries.length, 2, "going Back writes nothing");
  });
});
