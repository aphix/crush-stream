import type * as THREE from "three";
import { HudStore } from "../hud/hud-store.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { CrashEngine } from "./engine.ts";

/**
 * What the real `CrashEngine` needs to run headless in node: its canvas, WebGL context, 2d contexts, `window` and `document` are
 * inert stand-ins (every call answers, nothing draws); the sim, the scene and the loop rules are the engine's own. `getParameter`
 * answers a string that also reads as the number 16, so three's version check and its numeric limits both take it; the one
 * exception is `RENDERER`, which names a software rasterizer, so every test engine is the `software` device class (`deviceClass`):
 * Auto stays on `minimal` and never loads what a lifted tier would (the sky, in node), whatever the stand-in pointer says.
 */
const ctx2d: object = new Proxy(function () {}, { get: () => () => ctx2d, apply: () => ctx2d });
/** The extensions the context has: three warns when it asks for one a render target or a `BatchedMesh` draw needs and finds it missing. The engine's own optional ones (timer queries, renderer info) stay absent. */
const GL_EXTENSIONS = ["EXT_color_buffer_float", "WEBGL_multi_draw"];
const GL_CONSTANTS = new Map<string, number>();
const GL_ANSWERS: Record<string, (...args: unknown[]) => unknown> = {
  getParameter: (name) => (name === GL_CONSTANTS.get("RENDERER") ? "SwiftShader (headless test stand-in)" : Object.assign(new String("WebGL 2.0"), { valueOf: () => 16 })),
  getShaderPrecisionFormat: () => ({ rangeMin: 127, rangeMax: 127, precision: 23 }),
  getContextAttributes: () => ({ alpha: false, antialias: false }),
  getSupportedExtensions: () => GL_EXTENSIONS,
  // An extension's calls answer as the context's own do.
  getExtension: (name) => (GL_EXTENSIONS.includes(name as string) ? gl : null),
  getShaderInfoLog: () => "",
  getProgramInfoLog: () => "",
  getProgramParameter: () => 0,
};
const gl: object = new Proxy(function () {}, {
  get: (_t, k) => {
    if (typeof k !== "string") return undefined;
    // Upper-case names are GL constants: each its own number (three compares them to pick a draw mode, a format).
    if (k === k.toUpperCase()) return GL_CONSTANTS.get(k) ?? (GL_CONSTANTS.set(k, GL_CONSTANTS.size + 1), GL_CONSTANTS.size);
    return GL_ANSWERS[k] ?? (k.startsWith("create") ? () => ({}) : () => 1);
  },
  apply: () => 1,
});
export const element = (): HTMLCanvasElement & HTMLElement =>
  ({
    style: {},
    width: 0,
    height: 0,
    clientWidth: 800,
    clientHeight: 600,
    getContext: (kind: string) => (kind === "2d" ? ctx2d : gl),
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    appendChild() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    parentElement: null,
  }) as unknown as HTMLCanvasElement & HTMLElement;

export function stubBrowser(): void {
  Object.assign(globalThis, {
    devicePixelRatio: 1,
    innerWidth: 800,
    innerHeight: 600,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    location: { search: "", hash: "", href: "http://x/", origin: "http://x" },
    history: { state: null, replaceState() {}, pushState() {} },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { createElement: element, addEventListener() {}, removeEventListener() {}, body: element(), documentElement: element() },
  });
  (globalThis as { window?: unknown }).window = globalThis;
}

export interface BootOptions {
  hud?: HudStore;
  canvas?: HTMLCanvasElement & HTMLElement;
  /** Keep the engine's scene fades on (off by default, so a scene switch lands at once). */
  fades?: boolean;
  /** Advance the pacer's clock 1 µs per read: no frame is cut at the wall deadline, whatever the box's load. */
  pacer?: boolean;
  /** Keep three's own `render` once `ready`, so `renderer.info.memory` counts what a frame uploads (the stub swallows every draw by default). */
  draw?: boolean;
}

/** The real engine on the stand-ins (call `stubBrowser` first), nothing drawn unless `draw`, `ready` awaited. One per process: a second `CrashEngine` never resolves `ready`. */
export async function bootEngine({ hud = new HudStore(), canvas = element(), fades = false, pacer = false, draw = false }: BootOptions = {}): Promise<CrashEngine> {
  const engine = new CrashEngine(canvas, hud, element());
  const { render } = engine["renderer"];
  Object.assign(engine["renderer"], { render() {}, compile() {}, compileAsync: () => Promise.resolve() });
  await engine.ready;
  if (draw) engine["renderer"].render = render;
  if (!fades) engine.fadeScenes = false;
  if (pacer) {
    let tick = 0;
    Object.assign(engine.pace, { now: () => (tick += 0.001) });
  }
  return engine;
}

const FRAME = 1 / FRAME_HZ;

/** `seconds` of frames at the frame rate, one `advance` each. */
export function runSeconds(engine: CrashEngine, seconds: number): void {
  for (let i = 0; i < seconds * FRAME_HZ; i++) engine.advance(FRAME, { frameDt: FRAME });
}

export function pressKey(engine: CrashEngine, code: string): void {
  engine["onKey"](Object.assign(new Event("keydown"), { code, repeat: false, ctrlKey: false, metaKey: false, altKey: false }) as KeyboardEvent);
}

/**
 * The derby's opening shot (`ChaseCamera.frameReset`), pulled back (at most 4x) until every live car shows, matrices current: the picture a
 * test aims its presses at. The stand-in canvas has no size, so the view offset is cleared and the aspect set to `w` : `h` by hand.
 */
export function frameField(engine: CrashEngine, w: number, h: number): void {
  const camera = engine["camera"];
  const look = engine["view"].look;
  engine["view"].frameReset(false, engine["live"]());
  camera.clearViewOffset();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const home = camera.position.clone();
  const shows = (p: THREE.Vector3): boolean => {
    const s = p.clone();
    s.y += 0.5;
    s.project(camera);
    return s.z <= 1 && Math.abs(s.x) <= 0.95 && Math.abs(s.y) <= 0.95;
  };
  for (const scale of [1, 1.4, 2, 2.8, 4]) {
    camera.position.copy(home).sub(look).multiplyScalar(scale).add(look);
    camera.lookAt(look);
    engine["scene"].updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    if (engine["live"]().every((c) => shows(c.group.position))) return;
  }
}
