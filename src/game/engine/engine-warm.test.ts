import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { setGround } from "../world/ground.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { must } from "../kernel/must.test-util.ts";

/** What a finish program's key carries (`applyFinish`). */
const FINISH_KEY_MARK = "|finish-";
/** Every output the car finish must be linked and drawn for: plain paint on both, the finish into the HDR target only (it draws only at the post tiers). */
const FINISH_PASSES = "canvas plain,hdr finish,hdr plain";
/** The purse pool's program key (`Purses`) and the material class suffix every lit world material's key ends with: one program per output, the canvas and the HDR target. */
const PURSE_KEY = "purse-shapes|surf";
const OUTPUTS = 2;
/** One frame longer than any load window's settle: the window under way is past it. */
const PAST_SETTLE_MS = 60_000;

const isDrawn = (object: THREE.Object3D): boolean => {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
};

/** A stand-in canvas that keeps its listeners (three's and the engine's), so a row can play the browser's context events to them. */
function listeningCanvas(): { canvas: HTMLCanvasElement & HTMLElement; fire: (type: string) => void } {
  const canvas = element();
  const heard: { type: string; listener: (event: Event) => void }[] = [];
  Object.assign(canvas, { addEventListener: (type: string, listener: (event: Event) => void) => heard.push({ type, listener }) });
  const fire = (type: string): void => {
    for (const h of heard) if (h.type === type) h.listener(new Event(type, { cancelable: true }));
  };
  return { canvas, fire };
}

describe("given the engine warming its programs before the loop starts", () => {
  let engine: CrashEngine;
  let fire: (type: string) => void;
  const drawnDebugViews = new Set<string>();
  const compiledPasses = new Set<string>();
  const drawnPasses = new Set<string>();
  const drawnMaterials = new Set<THREE.Material>();
  const paintKey = (): string => engine["live"]()[0]!.lookMeshes().bodyPaint.customProgramCacheKey();
  /** The output the renderer is on and whether car 0's paint wears the finish now, e.g. "hdr finish". */
  const pass = (): string => `${engine["renderer"].getRenderTarget() === null ? "canvas" : "hdr"} ${paintKey().includes(FINISH_KEY_MARK) ? "finish" : "plain"}`;
  const render = (scene: THREE.Scene): void => {
    const main = scene === engine["scene"];
    if (main) drawnPasses.add(pass());
    scene.traverse((object) => {
      if (!isDrawn(object)) return;
      if (object.parent?.name === "ragdoll-debug") drawnDebugViews.add(object.type);
      if (main) for (const m of [(object as THREE.Mesh).material ?? []].flat()) if (m.visible) drawnMaterials.add(m);
    });
  };
  beforeAll(async () => {
    stubBrowser();
    const listening = listeningCanvas();
    fire = listening.fire;
    engine = new CrashEngine(listening.canvas, new HudStore(), element());
    // Links for real (three's compile); its async poll is skipped, as the stand-in context has no KHR_parallel_shader_compile and three warns.
    const compile = engine["renderer"].compile.bind(engine["renderer"]);
    const compileAsync = async (scene: THREE.Object3D, camera: THREE.Camera, target?: THREE.Scene | null): Promise<THREE.Object3D> => {
      if (scene === engine["scene"]) compiledPasses.add(pass());
      compile(scene, camera, target);
      return scene;
    };
    Object.assign(engine["renderer"], { render, compileAsync });
    await engine.ready;
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when the boot warm-up draws the scene, then the thrown dummies' rig lines and particle spheres are drawn too, and both views are off again after", () => {
    expect(firstMismatch([...drawnDebugViews].sort(), ["LineSegments", "Mesh"])).toBeUndefined();
    expect(engine["ragdolls"].debug.on).toBe(false);
  });

  it("when the boot warm-up runs on a tier without the finish, then car paint is linked and drawn plain for both outputs and finished for the HDR target only, and is plain again after", () => {
    expect([...compiledPasses].sort().join(), "linked").toBe(FINISH_PASSES);
    expect([...drawnPasses].sort().join(), "drawn").toBe(FINISH_PASSES);
    expect(paintKey().includes(FINISH_KEY_MARK), `key ${paintKey()}`).toBe(false);
  });

  it("when Rapier is in after boot, then the purse pool its world adds is linked for both outputs and drawn before any throw", async () => {
    await engine["ragdolls"].preload();
    await engine.warmsIdle();
    const purses = engine["ragdolls"]["purses"];
    must(purses, "the purse pool was never built");
    const keys = (engine["renderer"].info.programs ?? []).map((p) => String(p.cacheKey)).filter((k) => k.endsWith(PURSE_KEY));
    expect(keys.length, "purse programs").toBe(OUTPUTS);
    expect(drawnMaterials.has([purses.mesh.material].flat()[0]!), "the purse pool was not drawn").toBe(true);
  });

  it("when content with a new program joins the scene after boot, then the warm-up draws only the meshes wearing it", async () => {
    const material = new THREE.MeshBasicMaterial();
    material.customProgramCacheKey = () => "warm-test-late";
    const late = new THREE.Mesh(new THREE.BoxGeometry(), material);
    engine["scene"].add(late);
    drawnMaterials.clear();
    engine["queueWarm"]();
    await engine.warmsIdle();
    engine["scene"].remove(late);
    expect([...drawnMaterials].map((m) => (m === material ? "late" : m.name || m.type)).join()).toBe("late");
  });

  it("when the FX tier rises to High after boot, then the switch queues the warm-up, which links plain paint for both outputs and the finish for the HDR target only, and the paint keeps the finish after", async () => {
    compiledPasses.clear();
    engine.setFxTier("high");
    await engine.warmsIdle();
    expect([...compiledPasses].sort().join()).toBe(FINISH_PASSES);
    expect(paintKey().includes(FINISH_KEY_MARK), `key ${paintKey()}`).toBeTruthy();
  });

  it("when the context is lost and restored, then the warm-up links and draws the whole scene again, every load window starts over (FX tier, distance detail, Auto render scale) and the player's quality knobs stay in force", async () => {
    const windows = [engine["autoFx"]["win"], engine["detailGov"]["win"], engine["quality"].scaleGov["win"]];
    for (const win of windows) win.add(PAST_SETTLE_MS, 0, 0, -1);
    engine.setDrawDistance("far");
    engine.setRenderScale("2");
    engine.setShadows("high");
    const knobs = (): string => `${engine["camera"].far} ${engine["renderer"].getPixelRatio()} ${engine["sun"].shadow.mapSize.x}`;
    const knobsBefore = knobs();
    await engine.warmsIdle();
    drawnMaterials.clear();
    fire("webglcontextlost");
    fire("webglcontextrestored");
    await engine.warmsIdle();
    expect(drawnMaterials.has(engine["live"]()[0]!.lookMeshes().bodyPaint), "car paint was not drawn again").toBe(true);
    expect(windows.map((win) => win.settling).join()).toBe("true,true,true");
    expect(knobsBefore, "the knobs were put in force").toBe("270 2 2048");
    expect(knobs(), "the knobs after the restore").toBe(knobsBefore);
  });
});
