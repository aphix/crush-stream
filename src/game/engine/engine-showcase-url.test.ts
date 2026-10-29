import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { pickScene, sceneInPlay } from "../../components/scene-picks.ts";
import { decodeShare } from "../hud/share-url.ts";
import { HudStore } from "../hud/hud-store.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, runSeconds, stubBrowser } from "./engine-headless.test-util.ts";
import { camOf } from "../present/free-cam-pose.ts";

/**
 * The showcase's eye in the address bar (docs/CONTROLS.md): `cam=radius,pitch,angle,x,y,z` is written once as the free eye comes to
 * rest, read back on load, and dropped on leaving; and every scene button leaves the showcase, Fleet included.
 */

const LINK_CAM = "1,-0.2,2.5,10,3,20";
/** What the eye's reading and the URL's 3 decimals can differ by (m). */
const ROUND = 0.01;
/** Longer than the eye's rest time (s). */
const REST_S = 0.6;

describe("given the real engine booted on #scene=showcase with a cam= pose, writing into a browser history", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  let hud: HudStore;
  /** The cam= the bar carried each time it changed (null: none). */
  const camChanges: (string | null)[] = [];
  let lastCam: string | null = LINK_CAM;
  const bar = (): string => globalThis.location.hash.replace(/^#/, "");
  /** How many times a pose was written (a bar rewritten for another reason does not count). */
  const camWrites = (): number => camChanges.filter((c) => c !== null).length;
  const eye = (): THREE.Vector3 => engine["camera"].position;
  /** The eye turned by a drag of `px` pixels, as the pointer does. */
  const turn = (px: number): void => engine["view"].free.lookBy(px, 0);

  beforeAll(async () => {
    stubBrowser();
    const set = (url: unknown): void => {
      globalThis.location.hash = String(url).slice(String(url).indexOf("#"));
      const cam = decodeShare(bar()).cam?.join() ?? null;
      if (cam !== lastCam) camChanges.push((lastCam = cam));
    };
    Object.assign(globalThis, {
      history: {
        state: null,
        replaceState(_s: unknown, _u: string, url: string) {
          set(url);
        },
        pushState(_s: unknown, _u: string, url: string) {
          set(url);
        },
      },
    });
    globalThis.location.hash = `#scene=showcase&cam=${LINK_CAM}`;
    hud = new HudStore();
    engine = await bootEngine({ hud });
    await engine["ragdolls"].preload();
    runSeconds(engine, 0.5);
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when the page opens with a cam= pose, then the eye is there within rounding, looking along the pose's heading, and the bar keeps it", () => {
    const flat = Math.cos(-0.2);
    expect(eye().distanceTo(new THREE.Vector3(10 + Math.sin(2.5) * flat, 3 - Math.sin(0.2), 20 + Math.cos(2.5) * flat)), `the eye is at ${eye().toArray()}`).toBeLessThan(ROUND);
    const look = engine["camera"].getWorldDirection(new THREE.Vector3());
    expect(look.distanceTo(new THREE.Vector3(-Math.sin(2.5) * flat, Math.sin(0.2), -Math.cos(2.5) * flat)), `the view looks along ${look.toArray()}`).toBeLessThan(ROUND);
    expect(decodeShare(bar()).cam?.join(), "a loaded link's pose stays in the bar").toBe(LINK_CAM.split(",").join());
    expect(camWrites(), `loading writes no pose: ${camChanges}`).toBe(0);
  });

  it("when the eye turns for a second without resting, then nothing is written; once it rests it is written once, and never again while it stays, as a pose that reads back to the same eye", () => {
    for (let i = 0; i < FRAME_HZ; i++) {
      turn(4);
      runSeconds(engine, 1 / FRAME_HZ);
    }
    expect(camWrites(), "nothing is written while the eye moves").toBe(0);
    runSeconds(engine, REST_S);
    expect(camWrites(), "one write as it rests").toBe(1);
    runSeconds(engine, 2);
    expect(camWrites(), "none while it stays").toBe(1);
    const resting = camOf(engine["view"].free).map((n) => Math.round(n * 1e3) / 1e3);
    expect(decodeShare(bar()).cam?.join(), "the bar holds the eye as it rests").toBe(resting.join());
  });

  it("when the Fleet button is pressed in the showcase, then the scene is the fleet and the bar has no cam=", () => {
    expect(sceneInPlay(hud.get()), "the buttons know the showcase is in play").toBe("showcase");
    expect(bar().includes("cam=")).toBeTruthy();
    pickScene({ current: engine }, sceneInPlay(hud.get()), "fleet");
    expect(engine["sceneId"]).toBe("fleet");
    expect(!bar().includes("cam="), `the bar is ${bar()}`).toBe(true);
  });

  it("when the showcase is entered anew and another button is pressed after the eye rested, then that scene opens and the bar has no cam=", () => {
    engine["setScene"]("showcase");
    runSeconds(engine, 0.1);
    turn(200);
    runSeconds(engine, REST_S);
    expect(bar().includes("cam="), "the new visit's rest is written").toBeTruthy();
    pickScene({ current: engine }, sceneInPlay(hud.get()), "garage");
    expect(engine["sceneId"]).toBe("garage");
    expect(!bar().includes("cam="), `the bar is ${bar()}`).toBe(true);
  });
});
