import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { AI_EVERY_SLICE } from "../ai/constants.ts";
import { HudStore } from "../hud/hud-store.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { TRACK_ID } from "../world/constants.ts";
import { setGround } from "../world/ground.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";

const FRAME = 1 / FRAME_HZ;
/** The race's rules: one lap, three rivals, no police. */
const RULES = { trackId: TRACK_ID.city, laps: 1, aiCount: 3, police: false, aggression: 0.5, aiDifficulty: AI_EVERY_SLICE, spectate: false, noReset: false };
/** Sim seconds the race runs before it is ended, and the frames drawn after the podium opens (its first, and a few more). */
const RACE_S = 3;
const FRAMES_AFTER_CLICK = 5;

/** The real engine on the stand-in context with three's own `compile`: the boot warm-up and every drawn frame link what they reach, and `info.programs` counts them. */
async function bootLinking(): Promise<CrashEngine> {
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

/** A race run to its end: the first racer's row finished, the results sheet up. */
function endRace(engine: CrashEngine): void {
  engine.toggleRace();
  engine.raceCommand({ type: "program", options: RULES });
  engine.raceCommand({ type: "start" });
  engine.advance(RACE_S, { frameDt: FRAME });
  const session = engine["race"]["session"]!;
  const winner = session.cars[0]!;
  winner.status = "finished";
  winner.finishTime = session.time;
  engine.raceCommand({ type: "end" });
  engine.advance(FRAME, { frameDt: FRAME });
}

/** The materials of every mesh under `root`. */
function materialsUnder(root: THREE.Object3D): THREE.Material[] {
  const found: THREE.Material[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) found.push(...[o.material].flat());
  });
  return found;
}

describe("given a race ended on an engine that finished its boot warm-up", () => {
  let engine: CrashEngine;
  const programs = (): readonly unknown[] => engine["renderer"].info.programs ?? [];
  /** Whether three holds a program for `material` (its renderer state keeps them by key). */
  const hasProgram = (material: THREE.Material): boolean => {
    const built: unknown = engine["renderer"].properties.get(material);
    return typeof built === "object" && built !== null && "programs" in built && built.programs instanceof Map && built.programs.size > 0;
  };

  beforeAll(async () => {
    stubBrowser();
    engine = await bootLinking();
    endRace(engine);
    await engine.warmsIdle();
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when the podium is opened, then the click and its first frames link no program", async () => {
    const before = new Set(programs());
    engine.raceCommand({ type: "podium", on: true });
    expect(engine["podium"].open, "the control: the podium is up").toBe(true);
    engine.advance(FRAMES_AFTER_CLICK * FRAME, { frameDt: FRAME, render: true });
    await engine.warmsIdle();
    const linked = programs().filter((p) => !before.has(p));
    expect(linked.length, "programs linked by the click").toBe(0);
    const unlinked = materialsUnder(engine["podium"]["stage"].group).filter((m) => !hasProgram(m));
    expect(unlinked.length, "the control: every stage material has a program").toBe(0);
  });
});
