import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { setGround } from "../world/ground.ts";
import { CrashEngine } from "./engine.ts";
import { element, runSeconds, stubBrowser } from "./engine-headless.test-util.ts";

const FRAME = 1 / FRAME_HZ;
/** Frames drawn while the eye turns once round. */
const TURN_FRAMES = 120;

/** The real engine on the stand-in context with three's own `compile`, booted on the open world: the boot warm-up and every drawn frame link what they reach, and `info.programs` counts them. */
async function bootLinking(): Promise<CrashEngine> {
  globalThis.location.hash = "#scene=openworld&seed=1";
  const engine = new CrashEngine(element(), new HudStore(), element());
  const compile = engine["renderer"].compile.bind(engine["renderer"]);
  const drawn = (scene: THREE.Object3D, camera: THREE.Camera): void => void (scene === engine["scene"] && compile(scene, camera));
  const compileAsync = async (scene: THREE.Object3D, camera: THREE.Camera, target?: THREE.Scene | null): Promise<THREE.Object3D> => (compile(scene, camera, target), scene);
  Object.assign(engine["renderer"], { render: drawn, compileAsync });
  await engine.ready;
  engine.fadeScenes = false;
  let tick = 0;
  Object.assign(engine.pace, { now: () => (tick += 0.001) });
  return engine;
}

describe("given the open world warmed on a renderer that links what it draws", () => {
  let engine: CrashEngine;
  const programs = (): number => (engine["renderer"].info.programs ?? []).length;

  beforeAll(async () => {
    stubBrowser();
    engine = await bootLinking();
    // The city is built on the director's first frames; its art queues the warm that links it.
    runSeconds(engine, 1);
    await engine.warmsIdle();
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  // mutation: sed -i 's/^    this.stamp = (this.stamp + 1) | 0;$/    this.stamp = (this.stamp + 1) | 0; if (this.stamp === 120) this.group.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial({ sheen: 1, iridescence: 1 })));/' src/game/present/civilian-art.ts
  it("when the eye turns a full circle over the city, then no program links during play", async () => {
    expect(engine["sceneId"], "the control: the open world").toBe("openworld");
    const before = programs();
    const view = engine["view"];
    view.enterFree();
    for (let frame = 0; frame < TURN_FRAMES; frame++) {
      view.free.yaw = (2 * Math.PI * frame) / TURN_FRAMES;
      engine.advance(FRAME, { frameDt: FRAME, render: true });
    }
    view.leaveFree();
    await engine.warmsIdle();
    expect(before, "the control: the warm-up linked the city").toBeGreaterThan(0);
    expect(programs() - before, "programs linked while the eye turned").toBe(0);
    const fresh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.ShaderMaterial({ vertexShader: "void main() { gl_Position = vec4(position, 1.0); }", fragmentShader: "void main() { gl_FragColor = vec4(0.123, 0.456, 0.789, 1.0); }" }));
    engine["scene"].add(fresh);
    const linked = programs();
    engine.advance(FRAME, { frameDt: FRAME, render: true });
    engine["scene"].remove(fresh);
    expect(programs() - linked, "the control: a new material drawn in play links its program").toBeGreaterThanOrEqual(1);
  });
});
