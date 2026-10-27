import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { AI_EVERY_SLICE } from "../ai/constants.ts";
import { TRACK_ID } from "../world/constants.ts";
import { setGround } from "../world/ground.ts";
import { applyMarkMap } from "../present/engine-marks.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const FRAME = 1 / FRAME_HZ;
/** How far (m) the free eye stands off the car it films: past half the mark window (102.4 m at the minimal tier's 1024² map). */
const EYE_OFF = 150;

/** The mark window the ground samples (`applyMarkMap`'s `uMarkRect`, read off a patched material's compile): (minX, minZ, 1/sizeX, 1/sizeZ). */
function markWindow(): THREE.Vector4 {
  const material = new THREE.MeshStandardMaterial();
  applyMarkMap(material);
  const uniforms: Record<string, THREE.IUniform> = {};
  // The patch reads and writes only these three fields of the compile's parameters, and never the renderer.
  const shader = { uniforms, vertexShader: "", fragmentShader: "" } as THREE.WebGLProgramParametersWithUniforms;
  const renderer = {} as THREE.WebGLRenderer;
  material.onBeforeCompile(shader, renderer);
  return uniforms.uMarkRect!.value;
}

const inWindow = (w: THREE.Vector4, x: number, z: number): boolean => {
  const u = (x - w.x) * w.z;
  const v = (z - w.y) * w.w;
  return u >= 0 && u < 1 && v >= 0 && v < 1;
};

describe("given the real engine in a race on the National Mall (wider than the mark window)", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  const run = (frames: number): void => {
    for (let i = 0; i < frames; i++) engine.advance(FRAME, { frameDt: FRAME, render: true });
  };

  before(async () => {
    stubBrowser();
    engine = await bootEngine();
    engine.toggleRace();
    engine.raceCommand({ type: "program", options: { trackId: TRACK_ID.nationalMall, laps: 1, aiCount: 1, police: false, aggression: 0.5, aiDifficulty: AI_EVERY_SLICE, spectate: false, noReset: false } });
    engine.raceCommand({ type: "start" });
    run(5 * FRAME_HZ);
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  it(`when the free eye stands ${EYE_OFF} m off the followed car looking at it, then the mark window holds the car (its marks are stamped), not the eye`, () => {
    const seat = engine["seat"];
    seat.mode = "follow";
    const view = engine["view"];
    view.enterFree();
    run(1);
    const car = engine["cars"][seat.carIndex]!.group.position;
    const free = view.free;
    free.eye.set(car.x + EYE_OFF, car.y + 20, car.z);
    free.yaw = Math.atan2(EYE_OFF, 0);
    free.pitch = -Math.atan2(20, EYE_OFF);
    run(1);
    const eye = engine["camera"].position;
    assert.ok(Math.hypot(eye.x - car.x, eye.z - car.z) > EYE_OFF - 1, "the eye stands off the car");
    const w = markWindow();
    assert.ok(inWindow(w, car.x, car.z), `the car (${car.x.toFixed(1)}, ${car.z.toFixed(1)}) is in the window from (${w.x.toFixed(1)}, ${w.y.toFixed(1)}), ${(1 / w.z).toFixed(1)} m wide`);
    assert.ok(!inWindow(w, eye.x, eye.z), "the eye's own spot is not what the window follows");
  });
});
