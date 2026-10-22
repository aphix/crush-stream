import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { AI_EVERY_SLICE } from "../ai/constants.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { HudStore } from "../hud/hud-store.ts";
import { TRACK_ID } from "../world/constants.ts";
import { setGround } from "../world/ground.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";

const FRAME = 1 / FRAME_HZ;
const RACE_SECONDS = 3;

describe("given the real engine drawing a city race and then the derby", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  /** The direct children of the engine's scene that the renderer found hidden in its last draw of it. */
  let hiddenWhenDrawn: string[] = [];
  let arenaDrawn = false;
  /** Per wheel-batch draw (`WheelBatch.meshes`, the shadow prisms last): whether the graph the renderer last drew held it. */
  let wheelDrawsInGraph = "";
  const scene = (): CrashEngine["scene"] => engine["scene"];
  /** Frames with the event loop turning between them, as the browser's loop does: the warm-ups `queueWarm` starts finish. */
  const run = async (seconds: number): Promise<void> => {
    for (let i = 0; i < seconds * FRAME_HZ; i++) {
      engine.advance(FRAME, { frameDt: FRAME });
      await nextTurn();
    }
  };

  before(async () => {
    stubBrowser();
    engine = new CrashEngine(element(), new HudStore(), element());
    const render = (drawn: THREE.Object3D): void => {
      if (drawn !== scene()) return;
      hiddenWhenDrawn = drawn.children.filter((child) => !child.visible && !(child as THREE.Light).isLight).map((child) => child.name || child.type);
      arenaDrawn = drawn.children.includes(engine["arena"]) && engine["arena"].visible;
      wheelDrawsInGraph = engine["wheels"].meshes
        .map((mesh) => {
          let p: THREE.Object3D | null = mesh;
          while (p && p !== drawn) p = p.parent;
          return p === drawn;
        })
        .join();
    };
    Object.assign(engine["renderer"], { render, compile() {}, compileAsync: () => Promise.resolve() });
    await engine.ready;
    engine.fadeScenes = false;
    engine.toggleRace();
    engine.raceCommand({ type: "program", options: { trackId: TRACK_ID.city, laps: 1, aiCount: 3, police: false, aggression: 0.5, aiDifficulty: AI_EVERY_SLICE, spectate: false, noReset: false } });
    engine.raceCommand({ type: "start" });
    await run(RACE_SECONDS);
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  it("when the race has run, then the scene the renderer draws holds no hidden child", () => {
    assert.deepEqual(hiddenWhenDrawn, []);
  });

  it("when the scene is walked, then the arena the race hides is still the scene's own", () => {
    let found = false;
    scene().traverse((object) => void (found ||= object === engine["arena"]));
    assert.equal(found, true);
  });

  it("when the race has run, then every wheel draw is in the graph the renderer draws, the shadow prisms hidden outside the shadow pass included", () => {
    assert.equal(wheelDrawsInGraph, engine["wheels"].meshes.map(() => true).join());
  });

  it("when the derby is picked, then the arena is drawn in the scene again", async () => {
    assert.equal(arenaDrawn, false, "the control: the race did not draw it");
    engine["setScene"]("derby");
    await run(1);
    assert.equal(arenaDrawn, true);
  });

  it("when no car is cut at the scene's parking pass, then the cover draws stay in the graph for the frame a cut car shows them", () => {
    const covers = engine["coverBatch"];
    covers.sync([]);
    assert.equal(covers.meshes.map((mesh) => mesh.visible).join(), "false,false", "the control: hidden at the pass");
    scene().sync(true);
    const inGraph = (mesh: THREE.Object3D): boolean => {
      let p: THREE.Object3D | null = mesh;
      while (p && p !== scene()) p = p.parent;
      return p === scene();
    };
    assert.equal(covers.meshes.map(inGraph).join(), "true,true");
  });
});
