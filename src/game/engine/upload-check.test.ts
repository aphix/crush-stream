import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";
import { PageWorker } from "./page-worker.test-util.ts";
import { servePublic } from "./page-files.test-util.ts";
import { checkUploads } from "./upload-check.ts";

const REPORT = "Crush upload check:";

/** The headless context, with whatever is assigned onto it (a wrapper) kept and read back, so a wrap shows in `wrapped`. */
function wrappableContext(): { gl: WebGL2RenderingContext; wrapped: Map<string | symbol, unknown> } {
  const wrapped = new Map<string | symbol, unknown>();
  const gl = new Proxy(element().getContext("webgl2")!, {
    get: (target, key) => (wrapped.has(key) ? wrapped.get(key) : Reflect.get(target, key)),
    set: (_target, key, value) => (wrapped.set(key, value), true),
  });
  return { gl, wrapped };
}

/** The engine on `search`'s page, drawing into a wrappable context; nothing else of its frame runs. */
async function engineOn(search: string): Promise<{ engine: CrashEngine; wrapped: Map<string | symbol, unknown> }> {
  globalThis.location.search = search;
  const { gl, wrapped } = wrappableContext();
  const canvas = element();
  const ctx2d = canvas.getContext("2d");
  Object.assign(canvas, { getContext: (kind: string) => (kind === "2d" ? ctx2d : gl) });
  const engine = new CrashEngine(canvas, new HudStore(), element());
  Object.assign(engine["renderer"], { compileAsync: () => Promise.resolve() }); // the stand-in context lacks KHR_parallel_shader_compile, and three warns on stderr
  await engine.ready;
  engine["renderer"].debug.checkShaderErrors = false;
  return { engine, wrapped };
}

/** Every `console.error` an upload check wrote while `run` ran, as its joined text. */
function reportsDuring(run: () => void): string[] {
  const reports: string[] = [];
  const write = console.error;
  console.error = (...args: unknown[]) => {
    const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    if (text.startsWith(REPORT)) reports.push(text);
  };
  try {
    run();
  } finally {
    console.error = write;
  }
  return reports;
}

stubBrowser();
servePublic();
Object.assign(globalThis, { Worker: PageWorker });

describe("given a page opened without ?debug=uploads", () => {
  it("when the engine starts, then nothing on its WebGL context is wrapped", async () => {
    const { engine, wrapped } = await engineOn("");
    expect([...wrapped].filter(([, value]) => typeof value === "function").map(([key]) => String(key))).toHaveLength(0);
    engine.dispose();
  });
});

describe("given a page opened with ?debug=uploads", () => {
  let engine: CrashEngine;
  let wrapped: Map<string | symbol, unknown>;
  beforeAll(async () => ({ engine, wrapped } = await engineOn("?debug=uploads")));
  afterAll(() => engine.dispose());

  it("when a mesh's attribute is updated past its array's end, then the first refused upload is logged once, naming the attribute, geometry, mesh, sizes, range, FX tier and stack", () => {
    expect(wrapped.has("bufferSubData") && wrapped.has("texSubImage2D"), "wrapped upload calls").toBeTruthy();
    const geometry = new THREE.BufferGeometry();
    geometry.name = "probe-geometry";
    const position = new THREE.BufferAttribute(new Float32Array(30), 3);
    geometry.setAttribute("position", position);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    Object.assign(mesh, { name: "probe-mesh", frustumCulled: false, userData: { probe: 7 } });
    engine["scene"].add(mesh);
    const draw = (): void => engine["renderer"].render(mesh, engine["camera"]);
    const reports = reportsDuring(() => {
      draw();
      for (let i = 0; i < 2; i++) {
        position.addUpdateRange(25, 10);
        position.needsUpdate = true;
        draw();
      }
    });
    expect(reports.length, reports.join("\n")).toBe(1);
    const [report] = reports;
    for (const part of ["bufferSubData refused", "srcOffset 25 + length 10 past the view's 30 elements", 'attribute \\"position\\" (10 x 3)', 'geometry \\"probe-geometry\\"', 'Mesh \\"probe-mesh\\" {\\"probe\\":7}', '"bufferBytes":120', '"dstOffset":100', '"tier":"minimal"', "upload-check.ts"]) {
      expect(report!.includes(part), `${part} in ${report}`).toBeTruthy();
    }
  });
});

describe("given the upload check on a headless context", () => {
  it("when a data texture's update range reads past its pixels, then the refused upload is logged naming the texture, material and mesh", () => {
    const { gl } = wrappableContext();
    const renderer = new THREE.WebGLRenderer({ canvas: element(), context: gl });
    const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
    texture.name = "probe-texture";
    texture.needsUpdate = true;
    const scene = new THREE.Scene();
    scene.add(Object.assign(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map: texture })), { name: "probe-plane" }));
    checkUploads(gl, () => ({ scene, tier: "low" }));
    const reports = reportsDuring(() => {
      renderer.initTexture(texture);
      // The last 4 pixels from pixel 14 of a 4 x 4 image: two run past its end.
      texture.addUpdateRange(56, 16);
      texture.needsUpdate = true;
      renderer.initTexture(texture);
    });
    expect(reports.length, reports.join("\n")).toBe(1);
    for (const part of ["texSubImage2D refused", "needs 72 bytes of the view's 64", 'texture \\"probe-texture\\"', 'Mesh \\"probe-plane\\"', '"tier":"low"']) {
      expect(reports[0]!.includes(part), `${part} in ${reports[0]}`).toBeTruthy();
    }
  });
});
