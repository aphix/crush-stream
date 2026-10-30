import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { fleetClass, fleetStyle } from "../scenes/fleet.ts";
import { assignClass } from "../vehicle/vehicle-classes.ts";
import { FACE_MASK, FACE_WIDTH, SCRAPE_MAX, SEVERITY, STROKE_BYTES, U0, V0 } from "../vehicle/paint-scrapes.ts";
import { CAR_SPRAY, SPRAY_FACE } from "../vehicle/spray-box.ts";
import { compileHooks } from "../vehicle/car-detail-map.test-util.ts";
import { allocatedBytes, untilQuiet } from "../kernel/alloc-sample.test-util.ts";
import { scavengesDuring } from "../kernel/gc.test-util.ts";
import type { CrashEngine } from "../engine/engine.ts";
import { bootEngine, runSeconds, stubBrowser } from "../engine/engine-headless.test-util.ts";
import "../kernel/rapier-node.test-util.ts";
import { setGround } from "../world/ground.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { applyScratch, PaintScratches } from "./paint-scratch.ts";
import { sampledScratch, wearOf } from "./paint-scratch.test-util.ts";
import { must } from "../kernel/must.test-util.ts";

/** Bytes a frame may allocate: one boxed double, as the other allocation rows hold. */
const FRAME_BOUND_B = 16;
const FRAMES = 10_000;

/** A hard shove along a car's left flank at each rest point (-0.85, y, z) of `at`, each episode committed and closed: one stroke each. */
function scraped(car: DeformableCar, at: readonly (readonly [number, number])[]): void {
  car.group.updateMatrixWorld(true);
  const q = car.group.quaternion;
  const inward = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const slide = new THREE.Vector3(0, 0, 8).applyQuaternion(q);
  for (const [y, z] of at) {
    car.scrape(car.group.localToWorld(new THREE.Vector3(-0.85, y, z)), inward, slide, 0.3, 3, 1);
    car.scratches.slice(0.25);
    car.scratches.slice(0.25);
  }
}

describe("given a car with a full stroke list whose list changes before every frame", () => {
  const car = new DeformableCar({ body: 0x808080, accent: 0, name: "a" }, new THREE.Scene(), null, fleetStyle(0));
  assignClass(car, fleetClass(0));
  car.spawnFacing(0, 0, 0, 0);
  scraped(car, Array.from({ length: 200 }, (_, i) => [0.3 + 0.02 * (i % 37), -2 + 0.02 * i] as const));
  applyScratch(car);
  const view = new PaintScratches();
  const cars = [car];
  const frames = (count: number): void => {
    const list = car.scratches.list;
    for (let i = 0; i < count; i++) {
      list[(i % SCRAPE_MAX) * STROKE_BYTES + SEVERITY]! ^= 1;
      car.scratches.version++;
      view.frame(cars);
    }
  };

  it(`when the wear masks are drawn, then a frame allocates at most ${FRAME_BOUND_B} B`, () => {
    expect(car.scratches.count, "the control: the list is full").toBe(SCRAPE_MAX);
    const perFrame = untilQuiet(() => allocatedBytes(() => frames(FRAMES)) / FRAMES, FRAME_BOUND_B);
    expect(perFrame, `${perFrame.toFixed(1)} B a frame`).toBeLessThanOrEqual(FRAME_BOUND_B);
  });

  it("when the wear masks are drawn, then the garbage collector never runs", async () => {
    frames(FRAMES);
    const minor = await scavengesDuring(() => frames(FRAMES));
    expect(minor, `${minor} minor collections`).toBe(0);
  });
});

// Last in the file: the engine's browser stand-ins define `document`.
describe("given the real engine with its cars on the screen", () => {
  let engine: CrashEngine;
  beforeAll(async () => {
    stubBrowser();
    engine = await bootEngine();
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when a car's left flank is scraped and a frame runs, then every paint of it samples one mask marked where its stroke starts and bare on its right flank, and an unscraped car samples none", () => {
    const [, car, other] = engine["live"]();
    scraped(car!, [[0.5, -0.5]]);
    runSeconds(engine, 1 / FRAME_HZ);
    const list = car!.scratches.list;
    expect(car!.scratches.count, "the control: the scrape made a stroke").toBeGreaterThan(0);
    const m = car!.lookMeshes();
    const mask = wearOf(m.bodyPaint);
    for (const mesh of [m.hood, m.trunk, ...m.doors]) {
      const hooks = compileHooks(mesh.material as THREE.Material);
      expect(hooks.uniforms.wearMap!.value, "a lid or door samples the body's mask").toBe(mask);
      expect(hooks.fragmentShader.includes("#define PAINT_SCRATCH"), "and draws it").toBe(true);
    }
    const data = mask.image.data as Uint8Array;
    const texel = (face: number, u: number, v: number) => data[((CAR_SPRAY.faces[face]![1] + v) * CAR_SPRAY.w + CAR_SPRAY.faces[face]![0] + u) * 2]!;
    expect(list[FACE_WIDTH]! & FACE_MASK, "the control: the stroke is on the left flank").toBe(SPRAY_FACE.left);
    expect(texel(SPRAY_FACE.left, list[U0]!, list[V0]!), "the stroke's start").toBeGreaterThan(0);
    expect(texel(SPRAY_FACE.right, list[U0]!, list[V0]!), "the right flank opposite it").toBe(0);
    expect(wearOf(other!.lookMeshes().bodyPaint).image.width, "the unscraped car's mask").toBe(1);
  });

  it("when the FX tier goes off and back to minimal, then the scratches go off and come back on", () => {
    const paint = engine["live"]()[0]!.lookMeshes().bodyPaint;
    engine.setFxTier("off");
    expect(compileHooks(paint).uniforms.scratchTier!.value, "off").toBe(0);
    engine.setFxTier("minimal");
    expect(compileHooks(paint).uniforms.scratchTier!.value, "minimal").toBe(1);
  });

  it("when a fleet car that wears no spray has its left flank scraped and a frame runs, then its paint's program samples the stroke where it lies", () => {
    engine["setScene"]("fleet");
    runSeconds(engine, 1 / FRAME_HZ);
    const car = engine["live"]().find((c) => compileHooks(c.lookMeshes().bodyPaint).uniforms.sprayMap === undefined);
    must(car, "the control: a fleet car with no spray");
    car.group.updateMatrixWorld(true);
    const rest = car.restPointOf(car.group.localToWorld(new THREE.Vector3(-0.85, 0.5, -0.5)), new THREE.Vector3());
    scraped(car, [[0.5, -0.5]]);
    runSeconds(engine, 1 / FRAME_HZ);
    expect(car.scratches.count, "the control: the scrape made a stroke").toBeGreaterThan(0);
    expect(sampledScratch(car.lookMeshes().bodyPaint, rest, new THREE.Vector3(-1, 0, 0)), "the scratch the paint draws there").toBeGreaterThan(0);
  });
});
