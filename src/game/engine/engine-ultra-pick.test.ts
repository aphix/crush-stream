import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { HudStore } from "../hud/hud-store.ts";
import { tagSurface } from "../present/ultra/surface-tag.ts";
import { setGround } from "../world/ground.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";
import { PageWorker } from "./page-worker.test-util.ts";

/** The page's files: every URL the loads ask for is root-relative (`BASE_URL` is "/" in node). */
const PUBLIC = new URL("../../../public/", import.meta.url);
/** The extension that links programs off the main thread, and its query (three's `WebGLProgram.isReady`). */
const PARALLEL_LINK = "KHR_parallel_shader_compile";
const COMPLETION_STATUS_KHR = 0x91b1;
/** Frames drawn while the pick's programs are held linking: more than one, so a switch a frame late is caught too. */
const HELD_FRAMES = 3;
/** Ms between polls of the engine's state, and the most a row waits for it. */
const POLL_MS = 5;
const WAIT_LIMIT_MS = 10_000;

/**
 * The headless context with parallel linking: a program made while `hold(true)` is on reads as still linking (`COMPLETION_STATUS_KHR`
 * false) until `hold(false)`, the way a GPU process answers while it links.
 */
function linkingCanvas(): { canvas: HTMLCanvasElement & HTMLElement; hold(on: boolean): void } {
  const stub = element().getContext("webgl2")!;
  const made = new Set<unknown>();
  let linked: ReadonlySet<unknown> | null = null;
  const gl = new Proxy(stub, {
    get: (target, key) => {
      if (key === "getExtension") return (name: string) => (name === PARALLEL_LINK ? {} : target.getExtension(name));
      if (key === "createProgram")
        return () => {
          const program = target.createProgram();
          made.add(program);
          return program;
        };
      if (key === "getProgramParameter")
        return (program: WebGLProgram, name: number) => (name === COMPLETION_STATUS_KHR ? linked === null || linked.has(program) : target.getProgramParameter(program, name));
      if (key === "isContextLost") return () => false;
      return Reflect.get(target, key);
    },
  });
  const canvas = element();
  const ctx2d = canvas.getContext("2d");
  Object.assign(canvas, { getContext: (kind: string) => (kind === "2d" ? ctx2d : gl) });
  return { canvas, hold: (on) => void (linked = on ? new Set(made) : null) };
}

/** three's `WebGLProgram.isReady`, which its types leave out. */
const isLinked = (program: unknown): boolean =>
  typeof program === "object" && program !== null && "isReady" in program && typeof program.isReady === "function" && program.isReady() === true;
/** Whether the program a material's renderer state (`renderer.properties`) last picked has linked. */
const drawsLinked = (built: unknown): boolean => typeof built === "object" && built !== null && "currentProgram" in built && isLinked(built.currentProgram);

/** A course surface Ultra dresses (an asphalt tile 4 m to a UV unit), with a program key of its own. */
function surface(key: string): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> {
  const material = new THREE.MeshStandardMaterial({ map: tagSurface(new THREE.CanvasTexture(element()), "asphalt", 4) });
  material.customProgramCacheKey = () => key;
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
}

stubBrowser();
Object.assign(globalThis, {
  Worker: PageWorker,
  fetch: async (url: string) => new Response(await readFile(new URL(url.slice(1), PUBLIC))),
  createImageBitmap: async () => ({ width: 1, height: 1, close() {} }),
});

describe("given a page with Ultra loaded (a second pick, or the bench's Ultra arm, finds it so) on a GPU that links programs in parallel", () => {
  let engine: CrashEngine;
  let hold: (on: boolean) => void;
  let framing = false;
  /** What the frames drawn while `framing` drew: the materials whose program had not linked yet, and the programs they made. */
  const drawn = { unlinked: new Set<string>(), made: 0 };
  const programCount = (): number => (engine["renderer"].info.programs ?? []).length;
  const until = async (done: () => boolean, what: string): Promise<void> => {
    for (let waited = 0; !done(); waited += POLL_MS) {
      if (waited > WAIT_LIMIT_MS) assert.fail(`${what} after ${WAIT_LIMIT_MS} ms`);
      await sleep(POLL_MS);
    }
  };
  const warmsDone = (): Promise<void> => until(() => engine["warmsInFlight"] === 0, "warms still in flight");
  /** Draw `frames` engine frames; the materials they drew unlinked (names, joined) and the programs they made. */
  const drawFrames = (frames: number): { unlinked: string; made: number } => {
    drawn.unlinked.clear();
    drawn.made = 0;
    framing = true;
    engine.advance(frames / FRAME_HZ, { frameDt: 1 / FRAME_HZ, render: true });
    framing = false;
    return { unlinked: [...drawn.unlinked].sort().join(), made: drawn.made };
  };
  /** Pick Ultra with its programs held linking, and give the pick the turns it would take in a browser. */
  const pickHeld = async (): Promise<void> => {
    hold(true);
    engine.setFxTier("ultra");
    await until(() => engine["warmsInFlight"] > 0 || engine["cine"].tier === "ultra", "the pick neither warmed nor switched");
    await sleep(POLL_MS * 4);
  };

  before(async () => {
    const linking = linkingCanvas();
    hold = linking.hold;
    engine = new CrashEngine(linking.canvas, new HudStore(), element());
    const compile = engine["renderer"].compile.bind(engine["renderer"]);
    // A frame's draw links what it draws: the main scene's programs as three picks them for this frame's state.
    const render = (scene: THREE.Scene, camera: THREE.Camera): void => {
      if (!framing || scene !== engine["scene"]) return;
      const before = programCount();
      for (const m of compile(scene, camera)) if (!drawsLinked(engine["renderer"].properties.get(m))) drawn.unlinked.add(m.name || m.type);
      drawn.made += programCount() - before;
    };
    Object.assign(engine["renderer"], { render });
    await engine.ready;
    await engine["ragdolls"].preload();
    engine["scene"].add(surface("ultra-pick-course"));
    engine.setFxTier("high");
    assert.equal(await engine.loadUltra(), true, "Ultra loaded");
    await warmsDone();
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  it("when Ultra is picked while its programs link, then the frames meanwhile draw High's look, and the first Ultra frame after links nothing and draws only linked programs", async () => {
    await pickHeld();
    const heldFirst = drawFrames(HELD_FRAMES);
    // Turns for the warm's own polls between the batches: an early resolve would switch in before the second.
    await sleep(POLL_MS * 4);
    const heldLater = drawFrames(HELD_FRAMES);
    const heldTier = engine["cine"].tier;
    hold(false);
    await until(() => engine["cine"].tier === "ultra", "Ultra never switched in");
    await warmsDone();
    const first = drawFrames(1);
    assert.equal(`${heldFirst.unlinked}|${heldLater.unlinked}`, "|", "materials drawn while their program was linking");
    assert.equal(heldTier, "high", "tier while the programs linked");
    assert.equal(first.unlinked, "", "materials the first Ultra frame drew unlinked");
    assert.equal(first.made, 0, "programs the first Ultra frame linked");
  });

  it("when another tier is picked while Ultra's programs link, then Ultra never switches in and the scene is left as that tier wears it", async () => {
    engine.setFxTier("high");
    await warmsDone();
    const env = engine["scene"].environment;
    const late = surface("ultra-pick-late");
    const ownMap = late.material.map;
    engine["scene"].add(late);
    await pickHeld();
    engine.setFxTier("low");
    hold(false);
    await warmsDone();
    assert.equal(engine["cine"].tier, "low");
    assert.ok(engine["scene"].environment === env, "the scene's environment is the tier's own");
    assert.ok(late.material.map === ownMap, "the late surface wears its own map");
  });
});
