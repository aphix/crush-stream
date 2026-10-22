#!/usr/bin/env node
/**
 * The game's real `CrashEngine` drawing in node, for shots, counts and link checks: WebGL2 through headless GL (`@kmamal/gl`,
 * ANGLE on the host's GL), the game's own canvases through Skia (`@napi-rs/canvas`), the page's files read from `public/`. A derby
 * field past its green light (or the scene a share `--hash` names), drawn by the engine's own frame at one FX tier, is written as a
 * PNG, with one JSON line on stdout: the GPU, a yardstick shader's ms (a CPU rasterizer shows here), the frame's counts, and every
 * program that failed to link. Exit 1 on a link failure or a GL error. Not a frame-time judge: the browser bench is.
 *
 *   node --disable-warning=ExperimentalWarning scripts/headless-frame.mjs [--tier high] [--out screenshots/headless-frame-high.png]
 *     [--frames 60] [--size 1280x800] [--root <checkout>] [--hash scene=garage&car=sedan] [--camera 2.4,0.12,2.1] [--view hood] [--at 8] [--tear hood,bumperF]
 *     [--view side|top|iso|rear-iso --view-camera <json>] [--backdrop '#ffffff'] [--detail 2] [--paint '#8b8a8d' | --paint coupe=#2a313e,...]
 *
 * `--root` draws another checkout's game on its own node_modules (same seed, same clock): two trees give a before/after pair.
 * `--hash` boots the page on a share link's `#` (the scene, the car, the settings) instead of the derby; `--camera radius,pitch,angle`
 * frames the orbit camera by hand (metres, radians), as readme-shots' `frame()` does; `--view hood|chase|far` follows the hash's car
 * (`car=<id>`) in that drive view instead, e.g. `--hash 'scene=race&car=coupe'`; `--at` is the sim seconds before the drawn frames.
 * `--tear` tears the named parts (`DetachPart.name`: hood, bumperF, archFL, ...) off every car before the framing and hides them, to
 * show what is under them (the engine bay, the crash bars, the bare metal).
 * `--view side|top|iso|rear-iso` draws the hash's car through the camera spec trace-car writes for that view (`--camera-out`,
 * `trace-camera.mjs`: car space, orthographic for side and top), at the spec's size, so the shot lines up with trace-car's overlay;
 * `scripts/landing-shots.mjs` runs the pair. `--backdrop <colour>` draws the car alone over that colour (no garage room, no fog).
 * With a view camera the JSON's `wheelsPx` is where the shot drew each wheel (`wheelMarks`), for landing-shots' registration.
 * `--detail <rung>` pins the distance-detail ladder's rung (`DETAIL_LEVELS`: 0 desktop, 2 the phone's start; `off`: no cuts, the bench's
 * detail A/B arms) with its governor off; the JSON counts the cars cut to their body (`farCars`).
 * `--paint <colour>` paints the hash's car that colour, `--paint <style>=<colour>,...` every car of those styles (a livery, the
 * police's, stays): the landing shots and lineup sheets in each reference's colour.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/** Any fixed seed: the same derby field in both trees of a diff. */
const SEED = 12641919;
/** Sim seconds before the drawn frames, by default: the derby tests' wait, past the green light with the field engaged. */
const START_S = 8;
/** Sim seconds a hand `--camera` framing gets to settle before the drawn frames (readme-shots' `at: 0.3`). */
const FRAMING_S = 0.3;
/** Sim seconds a `--view` gets to settle before the drawn frames: the chase springs' convergence. */
const VIEW_S = 2;
/** `--view`'s names for the seat's views. */
const SEAT_VIEWS = { hood: "first", chase: "third", far: "far" };
/** `--view`'s landing views: the car through a trace-car camera spec. */
const LANDING_VIEWS = ["side", "top", "iso", "rear-iso"];
/** What the sim's pacer reads as its clock advances by on every read, so its time budget never depends on the host's speed. */
const PACE_STEP_S = 0.001;
/** The yardstick shader's timed frames. */
const YARDSTICK_FRAMES = 60;
/** Its untimed first frames: they pay for compiling and paging in. */
const YARDSTICK_WARM = 5;
/** A fixed full-screen fragment load: under a millisecond on a GPU at 1280x800, tens of milliseconds on a CPU rasterizer (llvmpipe). */
const YARDSTICK_FS = `#version 300 es
precision highp float; uniform float t; out vec4 o;
void main() { vec2 u = gl_FragCoord.xy / 800.; float v = 0.; for (int i = 0; i < 64; i++) v += sin(u.x * float(i) + t) * cos(u.y * float(i) - t); o = vec4(v, v * .5, 1. - v, 1.); }`;
const YARDSTICK_VS = "#version 300 es\nlayout(location = 0) in vec2 a; void main() { gl_Position = vec4(a, 0., 1.); }";
/** The vertex built-ins headless GL's ANGLE (2.1.24078) counts as attributes; Chrome's newer ANGLE does not. */
const BUILTIN_IDS = /\bgl_(VertexID|InstanceID)\b/g;
/** How often `settle` looks again: three checks an async compile every 10 ms where `KHR_parallel_shader_compile` is missing (here). */
const SETTLE_POLL_MS = 5;
/** A wheel-batch instance centred this near (m) one of the shot car's wheels is that wheel (another car's stands metres off). */
const WHEEL_MATCH_M = 0.5;

const { values } = parseArgs({
  options: {
    tier: { type: "string", default: "high" },
    out: { type: "string" },
    frames: { type: "string", default: "60" },
    size: { type: "string", default: "1280x800" },
    root: { type: "string", default: join(import.meta.dirname, "..") },
    hash: { type: "string" },
    camera: { type: "string" },
    view: { type: "string" },
    "view-camera": { type: "string" },
    backdrop: { type: "string" },
    detail: { type: "string" },
    paint: { type: "string" },
    at: { type: "string", default: String(START_S) },
    tear: { type: "string" },
  },
});
const root = resolve(values.root);
const tier = values.tier;
const frames = Number(values.frames);
const size = /^(\d+)x(\d+)$/.exec(values.size);
const atS = Number(values.at);
const camera = values.camera?.split(",").map(Number);
if (!Number.isInteger(frames) || frames < 1) throw new Error(`--frames ${values.frames}: a whole number of frames, at least 1`);
if (size === null) throw new Error(`--size ${values.size}: width x height, e.g. 1280x800`);
if (!(atS >= 0)) throw new Error(`--at ${values.at}: sim seconds, 0 or more`);
if (camera !== undefined && (camera.length !== 3 || !camera.every(Number.isFinite))) throw new Error(`--camera ${values.camera}: radius,pitch,angle, e.g. 2.4,0.12,2.1`);
const seatView = values.view === undefined ? undefined : SEAT_VIEWS[values.view];
const landingView = LANDING_VIEWS.includes(values.view) ? JSON.parse(readFileSync(resolve(values["view-camera"] ?? ""), "utf8")) : null;
if (values.view !== undefined && seatView === undefined && landingView === null) throw new Error(`--view ${values.view}: hood, chase, far, ${LANDING_VIEWS.join(", ")}`);
if (landingView !== null && landingView.view !== values.view) throw new Error(`--view-camera ${values["view-camera"]}: a ${landingView.view} camera, not ${values.view}`);
const W = landingView?.W ?? Number(size[1]);
const H = landingView?.H ?? Number(size[2]);
const out = resolve(values.out ?? `screenshots/headless-frame-${tier}.png`);
const detail = values.detail === undefined ? null : values.detail === "off" ? "off" : Number(values.detail);
if (typeof detail === "number" && !(Number.isInteger(detail) && detail >= 0)) throw new Error(`--detail ${values.detail}: a rung of the distance-detail ladder (0 or more) or off`);

// WSL: Mesa's d3d12 driver reaches the host GPU through /dev/dxg; without it Mesa draws on the CPU. Elsewhere Mesa has no d3d12 driver.
if (existsSync("/dev/dxg")) process.env.GALLIUM_DRIVER ??= "d3d12";
const glDir = dirname(fileURLToPath(import.meta.resolve("@kmamal/gl")));
if (!existsSync(join(glDir, "dist/webgl.node"))) {
  console.error(`headless-frame: @kmamal/gl has no native binary (installs never run its GitHub download). Fetch it once:\n  node ${join(glDir, "scripts/install.mjs")}`);
  process.exit(2);
}
const { default: createGL } = await import("@kmamal/gl");
const { createCanvas, ImageData, loadImage } = await import("@napi-rs/canvas");

const game = (path) => import(pathToFileURL(join(root, "src/game", path)).href);
const { mulberry32 } = await game("world/placements.ts");
// Seeded before the engine's modules load: boot's own draws (procedural textures) are then the same in every run.
Math.random = mulberry32(SEED);
await (await game("deform/skin-kernel.test-util.ts")).loadSkinKernelForTest();
await game("kernel/rapier-node.test-util.ts");
const { element, stubBrowser } = await game("engine/engine-headless.test-util.ts");
const { CrashEngine } = await game("engine/engine.ts");
const { HudStore } = await game("hud/hud-store.ts");
const { FX_TIERS } = await game("present/engine-post.ts");
const { FRAME_HZ } = await game("kernel/constants.ts");
const { DRIVER_CARS } = await game("match/types.ts");
/** The body style the hash's `car=` boots (a car-menu id: a class, e.g. `muscle` for the coupe body), or null; any other id would boot the default sedan unnoticed. */
const hashStyle = (() => {
  const id = new URLSearchParams(values.hash ?? "").get("car");
  if (id === null) return null;
  const style = DRIVER_CARS.find((d) => d.id === id)?.style;
  if (style === undefined) throw new Error(`--hash car=${id}: not a car-menu id (${DRIVER_CARS.map((d) => `${d.id} = ${d.style}`).join(", ")})`);
  return style;
})();
if (!FX_TIERS.includes(tier)) throw new Error(`--tier ${tier}: one of ${FX_TIERS.join(", ")}`);

// Referenced for the process's life: @kmamal/gl aborts the process when the garbage collector frees a context.
const yardstickContext = webgl2({});
const yardstickMs = yardstick(yardstickContext);
const gl = webgl2({ antialias: false, alpha: false });
const renderer = nativeRenderer(gl);

stubBrowser();
const page = new URL(location.href);
location.search = `?fx=${tier}`;
if (values.hash !== undefined) location.hash = `#${values.hash.replace(/^#/, "")}`;
const stubElement = document.createElement;
document.createElement = (tag) => (tag === "canvas" ? Object.assign(createCanvas(1, 1), { style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {} }) : stubElement(tag));
Object.assign(globalThis, {
  innerWidth: W,
  innerHeight: H,
  // A desktop browser's pointer, so the engine takes the device class a desktop does.
  matchMedia: (query) => ({ matches: query === "(pointer: fine)", addEventListener() {} }),
  // three's file loader builds a `Request` from the page-relative URL, and reports its download with `ProgressEvent`s.
  Request: class extends Request {
    constructor(input, init) {
      super(typeof input === "string" ? new URL(input, page) : input, init);
    }
  },
  ProgressEvent: class extends Event {
    constructor(type, init) {
      super(type);
      Object.assign(this, init);
    }
  },
  fetch: (input) => track(servePublic(input)),
  createImageBitmap: (blob, options) => track(decodeBitmap(blob, options)),
});
const canvas = element();
// The engine fits its lens to the canvas's box (`coverLens` reads all four edges).
const box = { left: 0, top: 0, right: W, bottom: H, width: W, height: H };
Object.assign(canvas, { clientWidth: W, clientHeight: H, getBoundingClientRect: () => box, getContext: () => gl });

/** The page's file loads in flight (fetches, decodes), waited out by `settle`. */
const loads = new Set();
function track(load) {
  loads.add(load);
  return load.finally(() => loads.delete(load));
}

/** The page's own files, read from the checkout's `public/`; a missing one answers 404 as the server would. */
async function servePublic(input) {
  const url = new URL(input instanceof Request ? input.url : String(input), page);
  if (url.origin !== page.origin) throw new Error(`headless-frame: no network, asked for ${url}`);
  try {
    return new Response(await readFile(join(root, "public", decodeURIComponent(url.pathname))));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    return new Response(null, { status: 404 });
  }
}

/**
 * A decoded picture as a canvas (headless GL uploads a canvas), turned upside down when asked as `createImageBitmap` would. Its
 * `close` has nothing to free early: the garbage collector takes the canvas.
 */
async function decodeBitmap(blob, options) {
  const image = await loadImage(Buffer.from(await blob.arrayBuffer()));
  const bitmap = createCanvas(image.width, image.height);
  const ctx = bitmap.getContext("2d");
  if (options?.imageOrientation === "flipY") ctx.setTransform(1, 0, 0, -1, 0, image.height);
  ctx.drawImage(image, 0, 0);
  return Object.assign(bitmap, { close() {} });
}

const bootAt = performance.now();
const engine = new CrashEngine(canvas, new HudStore(), element());
const three = engine.renderer;
const linkFailures = [];
const builtinQuirk = [];
const quirkPrograms = new Set();
three.debug.onShaderError = (context, program, vertex, fragment) => {
  const made = three.info.programs.find((p) => p.program === program);
  const log = [context.getProgramInfoLog(program), context.getShaderInfoLog(vertex), context.getShaderInfoLog(fragment)];
  const failure = { material: made.type, name: made.name, log: log.join("\n").trim() };
  if (linksWithoutBuiltins(vertex, fragment)) {
    quirkPrograms.add(made);
    builtinQuirk.push(failure);
  } else {
    linkFailures.push(failure);
  }
};
await engine.ready;
const readyMs = Math.round(performance.now() - bootAt);
if (tier === "ultra" && !(await engine.loadUltra())) throw new Error("headless-frame: the Ultra look did not load (see the console)");
engine.setFxTier(tier);
if (detail !== null) {
  if (detail === "off") engine.detail.setDistances(Infinity, Infinity);
  else engine.detail.setLevel(detail);
  engine.detailGov.frame = () => null;
}

const FRAME = 1 / FRAME_HZ;
engine.fadeScenes = false;
engine.pinnedSeed = SEED;
let paceClock = 0;
engine.pace.now = () => (paceClock += PACE_STEP_S);
if (values.hash === undefined) engine.toggleDerby();
engine.advance(atS, { frameDt: FRAME });
await settle();
for (const name of values.tear?.split(",") ?? []) {
  for (const car of engine["live"]()) {
    const part = car["parts"].find((p) => p.name === name);
    if (!part) throw new Error(`--tear ${name}: no such part on the ${car.style.id}`);
    car["detachPart"](part, 0);
    part.object.visible = false;
  }
}
if (camera !== undefined) {
  const [radius, pitch, angle] = camera;
  Object.assign(engine.view, { userFramed: true, radius, pitch, angle });
  engine.advance(FRAMING_S, { frameDt: FRAME });
  await settle();
}
if (seatView !== undefined) {
  // The hash's car, followed in that drive view (a spectator's spec view: any scene, driven or not).
  const want = hashStyle;
  const cars = engine.live();
  const index = want === null ? engine.seat.carIndex : cars.findIndex((car) => car.style.id === want);
  if (index < 0) throw new Error(`--view ${values.view}: no ${want} car in the scene (field: ${cars.map((car) => car.style.id)})`);
  Object.assign(engine.seat, { mode: "follow", carIndex: index });
  engine.view.spec = seatView;
  engine.advance(VIEW_S, { frameDt: FRAME });
  await settle();
}
if (values.paint !== undefined) paintCars(values.paint);
const shooting = landingView !== null || values.backdrop !== undefined ? await shootAs(landingView, values.backdrop) : null;
const notDrawn = new Set();
// three draws on with a program that failed to link, a GL error per draw: the quirk's meshes leave the camera's layer for the drawn
// frames, and the errors their draws left so far are dropped, so `glError` speaks for the drawn frames.
if (quirkPrograms.size > 0) {
  hideQuirkMeshes();
  while (gl.getError() !== gl.NO_ERROR);
}
// The counts are the last frame whole (the mark map and every post pass): the reader brackets renderer.info, as the bench does.
three.info.autoReset = false;
for (let f = 0; f < frames; f++) {
  hideQuirkMeshes();
  three.info.reset();
  engine.advance(FRAME, { frameDt: FRAME });
  await settle();
}
const glError = gl.getError();
const { render, memory, programs } = three.info;
const counts = { calls: render.calls, triangles: render.triangles, programs: programs.length, textures: memory.textures, geometries: memory.geometries };
const farCars = engine["cars"].filter((car) => engine["detail"].isFar(car)).length;

const w = canvas.width;
const h = canvas.height;
const rgba = new Uint8ClampedArray(w * h * 4);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
const shot = createCanvas(w, h);
const rows = new Uint8ClampedArray(rgba.length);
for (let y = 0; y < h; y++) rows.set(rgba.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
shot.getContext("2d").putImageData(new ImageData(rows, w, h), 0, 0);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, await shot.encode("png"));
const wheelsPx = shooting?.camera ? wheelMarks(shooting, w, h) : null;
engine.dispose();
const result = { root, tier, hash: values.hash ?? null, camera: camera ?? null, view: values.view ?? null, viewCamera: values["view-camera"] ?? null, backdrop: values.backdrop ?? null, detail: detail === null ? null : engine.detail.level, farCars, paint: values.paint ?? null, size: `${w}x${h}`, frame: "engine", renderer, yardstickMs, readyMs, ...counts, linkFailures, builtinQuirk, notDrawn: [...notDrawn], glError, wheelsPx, png: out };
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = linkFailures.length > 0 || glError !== gl.NO_ERROR ? 1 : 0;

/**
 * `--paint`: one colour for the hash's car, or `<style>=<colour>` pairs; a car whose style fixes its paint (a livery) keeps it. The
 * hinged panels wear their own copies of the body paint, so every material still in the body's colour takes the new one.
 */
function paintCars(spec) {
  const pairs = spec.includes("=") ? spec.split(",").map((p) => p.split("=")) : [[hashStyle, spec]];
  const colours = new Map(pairs);
  if (colours.has(null)) throw new Error("--paint <colour> paints the hash's car: name one (--hash 'scene=garage&car=<id>'), or give <style>=<colour> pairs");
  for (const car of engine.live()) {
    const colour = colours.get(car.style.id);
    if (colour === undefined || car.style.livery) continue;
    const was = car.lookMeshes().bodyPaint.color.getHex();
    car.group.traverse((o) => {
      for (const m of [o.material ?? []].flat()) if (m.color?.getHex() === was) m.color.set(colour);
    });
  }
}

/**
 * Where the shot drew the car's wheels (px on its W x H frame), named as trace-car's picks are (`fl`, `fr`, `rl`, `rr`; +x is the
 * car's left): `centre` the hub, `hub` the hub on the wheels' outer face, `contact` that face at their bottom. The face and the
 * bottom are the drawn wheels' box in car space (each batch instance's geometry box through its instance matrix, as trace-car's
 * measure takes them), so both tools mark the same points; the loaded tyre's flat is a vertex shader's and neither sees it.
 */
function wheelMarks({ THREE, car, camera }, W, H) {
  const toCar = car.group.matrixWorld.clone().invert();
  const centres = car.wheels.map((w) => new THREE.Vector3().setFromMatrixPosition(w.matrixWorld).applyMatrix4(toCar));
  const box = new THREE.Box3();
  const piece = new THREE.Box3();
  const instance = new THREE.Matrix4();
  const mid = new THREE.Vector3();
  for (const mesh of engine.wheels.meshes) {
    if (!mesh.visible || mesh.count === 0) continue;
    mesh.geometry.computeBoundingBox();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, instance);
      piece.copy(mesh.geometry.boundingBox).applyMatrix4(instance.premultiply(mesh.matrixWorld).premultiply(toCar));
      if (centres.some((c) => c.distanceTo(piece.getCenter(mid)) < WHEEL_MATCH_M)) box.union(piece);
    }
  }
  if (box.isEmpty()) return null;
  const px = (x, y, z) => {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(car.group.matrixWorld).project(camera);
    return [Number((((p.x + 1) / 2) * W).toFixed(1)), Number((((1 - p.y) / 2) * H).toFixed(1))];
  };
  const marks = {};
  for (const c of centres) {
    const face = c.x > 0 ? box.max.x : box.min.x;
    marks[`${c.z > 0 ? "f" : "r"}${c.x > 0 ? "l" : "r"}`] = { centre: px(c.x, c.y, c.z), hub: px(face, c.y, c.z), contact: px(face, box.min.y, c.z) };
  }
  return marks;
}

/**
 * Every drawn frame from here goes through `spec`'s camera (trace-camera, car space, placed on the hash's car) and/or over a flat
 * `backdrop` colour with the garage room and fog gone. The engine's own camera keeps running unchanged: the detail, skin and lamp
 * pickers read it before the draw, so the car keeps the detail the garage's orbit eye gives it.
 */
async function shootAs(spec, backdrop) {
  const THREE = await import(pathToFileURL(join(root, "node_modules/three/build/three.module.js")).href);
  const { makeCamera } = await import(pathToFileURL(join(import.meta.dirname, "trace-camera.mjs")).href);
  const want = hashStyle;
  const car = engine.live().find((c) => want === null || c.style.id === want);
  if (car === undefined) throw new Error(`--view/--backdrop: no ${want} car in the scene; boot one: --hash 'scene=garage&car=<id>'`);
  car.group.updateMatrixWorld(true);
  const shotCamera = spec === null ? null : makeCamera(THREE, spec, car.group.matrixWorld);
  const flat = backdrop === undefined ? null : new THREE.Color(backdrop);
  // The car alone: its group, the batches that draw its wheels, lamps and parts, and the lights. The rest (room, sky dome, props) hides.
  const kept = new Set([car.group, engine.wheels.group, ...engine.lampBatch.meshes, ...engine.partBatch.meshes]);
  const cine = engine.cine;
  const draw = cine.render.bind(cine);
  cine.render = (scene, viewCamera, ...rest) => {
    const saved = { background: scene.background, fog: scene.fog?.density, hidden: [] };
    if (flat !== null) {
      scene.background = flat;
      if (scene.fog) scene.fog.density = 0;
      for (const o of scene.children) {
        if (kept.has(o) || o.isLight || !o.visible) continue;
        o.visible = false;
        saved.hidden.push(o);
      }
    }
    try {
      return draw(scene, shotCamera ?? viewCamera, ...rest);
    } finally {
      scene.background = saved.background;
      if (scene.fog) scene.fog.density = saved.fog;
      for (const o of saved.hidden) o.visible = true;
    }
  };
  return { THREE, car, camera: shotCamera };
}

/** Waits out the page's file loads and the engine's program warms, so every run draws its frames over the same state. */
async function settle() {
  while (loads.size > 0 || engine.warmsInFlight > 0) await sleep(SETTLE_POLL_MS);
}

/** True when the failed program links once its vertex shader reads gl_VertexID and gl_InstanceID as 0: the ANGLE quirk, not the game. */
function linksWithoutBuiltins(vertex, fragment) {
  const shader = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(shader, gl.getShaderSource(vertex).replaceAll(BUILTIN_IDS, "0"));
  gl.compileShader(shader);
  const probe = gl.createProgram();
  gl.attachShader(probe, shader);
  gl.attachShader(probe, fragment);
  gl.linkProgram(probe);
  const links = gl.getProgramParameter(probe, gl.LINK_STATUS);
  gl.deleteProgram(probe);
  gl.deleteShader(shader);
  return links;
}

/**
 * Takes every mesh drawn with a quirk program off the camera's layer, which the shadow pass and the engine's warm-up draws also obey (the
 * engine shows and hides its meshes itself), and names it in `notDrawn`.
 */
function hideQuirkMeshes() {
  if (quirkPrograms.size === 0) return;
  engine.scene.traverse((object) => {
    if (!object.layers.isEnabled(0)) return;
    for (const material of [object.material ?? []].flat()) {
      if (!quirkPrograms.has(three.properties.get(material).currentProgram)) continue;
      object.layers.disable(0);
      notDrawn.add(`${object.constructor.name} (${material.type})`);
    }
  });
}

/** A W x H WebGL2 context from headless GL. */
function webgl2(attributes) {
  const context = createGL(W, H, { createWebGL2Context: true, ...attributes });
  if (context === null) throw new Error("headless-frame: headless GL made no WebGL2 context");
  return context;
}

/** The GPU as ANGLE names it (a D3D12 adapter, or llvmpipe): headless GL's JS layer answers `RENDERER` with "ANGLE" alone, its native base asks ANGLE. */
function nativeRenderer(context) {
  let base = Object.getPrototypeOf(context);
  while (Object.getPrototypeOf(base) !== Object.prototype) base = Object.getPrototypeOf(base);
  return base.getParameter.call(context, context.RENDERER);
}

/** Mean ms per frame of `YARDSTICK_FS` on `context`, each frame synced by a 1 px read: tells a GPU from a CPU rasterizer. */
function yardstick(context) {
  const program = context.createProgram();
  for (const [type, source] of [[context.VERTEX_SHADER, YARDSTICK_VS], [context.FRAGMENT_SHADER, YARDSTICK_FS]]) {
    const shader = context.createShader(type);
    context.shaderSource(shader, source);
    context.compileShader(shader);
    context.attachShader(program, shader);
  }
  context.linkProgram(program);
  if (!context.getProgramParameter(program, context.LINK_STATUS)) throw new Error(`headless-frame: yardstick shader: ${context.getProgramInfoLog(program)}`);
  context.useProgram(program);
  context.bindBuffer(context.ARRAY_BUFFER, context.createBuffer());
  context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), context.STATIC_DRAW);
  context.enableVertexAttribArray(0);
  context.vertexAttribPointer(0, 2, context.FLOAT, false, 0, 0);
  const t = context.getUniformLocation(program, "t");
  const pixel = new Uint8Array(4);
  let start = 0;
  for (let f = 0; f < YARDSTICK_WARM + YARDSTICK_FRAMES; f++) {
    if (f === YARDSTICK_WARM) start = performance.now();
    context.uniform1f(t, f);
    context.drawArrays(context.TRIANGLES, 0, 3);
    context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
  }
  return +((performance.now() - start) / YARDSTICK_FRAMES).toFixed(2);
}
