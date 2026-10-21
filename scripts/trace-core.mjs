/**
 * The tracing harness's core, shared by `trace-car.mjs` and `fit-car.mjs`: one car style's drawn meshes in a bare three scene
 * through headless GL (no engine boot), orthographic frames calibrated to a reference picture in metres, the reference's
 * silhouette and glass masks, and one view's overlay PNG with its fit metrics.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { checklist, compare, fillHoles, gapRegions, glassCompare, maskBox, outline, sideCorners, sideHubs } from "./trace-metrics.mjs";

/** Pixels per metre, and the margin (m) around the car, without a reference. */
const BARE_PX_PER_M = 120;
const BARE_MARGIN_M = 0.4;
/** Bright orange paint: stands apart from every reference's paint under the outlines. */
const PAINT = { name: "Trace", body: 0xff8c1a, accent: 0x3a3a3a };
/** Lamp instances the stage's batch holds: one car's, with room to spare. */
const LAMP_CAPACITY = 16;
/** The car fill's opacity over the reference. */
const CAR_ALPHA = 0.55;
/** Grid spacing (m); labels at whole metres. */
const GRID_M = 0.5;
const LINES = { car: [255, 0, 255], ref: [0, 200, 255], carGlass: [120, 230, 0], refGlass: [0, 70, 255] };
const SHADOWLESS = { shadowMap: { render() {} } };
const FLAT = { glass: new THREE.MeshBasicMaterial({ color: 0xffffff }), body: new THREE.MeshBasicMaterial({ color: 0x000000 }) };

/** Screen right (R) and up (U) per orthographic view, and the world axes they read; the camera sits on R × U. */
export const VIEWS = {
  side: { R: [0, 0, -1], U: [0, 1, 0], axes: ["z", "y"] },
  top: { R: [0, 0, -1], U: [-1, 0, 0], axes: ["z", "x"] },
  front: { R: [1, 0, 0], U: [0, 1, 0], axes: ["x", "y"] },
  rear: { R: [-1, 0, 0], U: [0, 1, 0], axes: ["x", "y"] },
};
/** The parts `--omit` hides. */
export const OMIT_PARTS = ["doors", "glass", "bumpers", "mirrors", "hood", "trunk", "lightbar", "wheels", "lamps", "parts"];

/** The game's car modules, headless GL and Skia, with the WASM skin kernel loaded. */
export async function openGame() {
  // WSL: Mesa's d3d12 driver reaches the host GPU through /dev/dxg; without it Mesa draws on the CPU.
  if (existsSync("/dev/dxg")) process.env.GALLIUM_DRIVER ??= "d3d12";
  const glDir = dirname(fileURLToPath(import.meta.resolve("@kmamal/gl")));
  if (!existsSync(join(glDir, "dist/webgl.node"))) throw new Error(`@kmamal/gl has no native binary. Fetch it once: node ${join(glDir, "scripts/install.mjs")}`);
  const game = (path) => import(new URL(`../src/game/${path}`, import.meta.url).href);
  await (await game("deform/skin-kernel.test-util.ts")).loadSkinKernelForTest();
  const [gl, canvas, car, variants, classes, wheels, lamps, parts] = await Promise.all([
    import("@kmamal/gl"),
    import("@napi-rs/canvas"),
    game("vehicle/car.ts"),
    game("vehicle/car-variants.ts"),
    game("vehicle/vehicle-classes.ts"),
    game("vehicle/wheel-batch.ts"),
    game("vehicle/lamp-lights.ts"),
    game("vehicle/part-batch.ts"),
  ]);
  return {
    createGL: gl.default,
    createCanvas: canvas.createCanvas,
    ImageData: canvas.ImageData,
    loadImage: canvas.loadImage,
    DeformableCar: car.DeformableCar,
    CAR_STYLES: variants.CAR_STYLES,
    CAR_STYLE_IDS: variants.CAR_STYLE_IDS,
    CLASSES: classes.CLASSES,
    STYLE_CLASS: classes.STYLE_CLASS,
    VEHICLE_CLASS_IDS: classes.VEHICLE_CLASS_IDS,
    assignClass: classes.assignClass,
    WheelBatch: wheels.WheelBatch,
    LampBatch: lamps.LampBatch,
    PartBatch: parts.PartBatch,
  };
}

/** One car at a time in a lit scene, with the engine's wheel, lamp and part batches drawing it. */
export class CarStage {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.wheels = new game.WheelBatch(4, () => false);
    this.lamps = new game.LampBatch(LAMP_CAPACITY);
    this.parts = new game.PartBatch(1);
    // The wheel batch's third mesh is its shadow prisms, hidden from every pass but the shadow map's.
    this.batch = { wheels: this.wheels.meshes.slice(0, 2), lamps: this.lamps.meshes, parts: this.parts.meshes };
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 6, 4);
    this.scene.add(...this.wheels.meshes, ...this.lamps.meshes, ...this.parts.meshes, new THREE.HemisphereLight(0xffffff, 0x404040, 2.2), sun);
    this.car = null;
  }

  /** Builds style `id` as class `cls` (`table`, when given, stands in for its BodyStyle), measures it whole, then hides `omit`. */
  build(id, cls, omit = [], table = null) {
    const { CAR_STYLES, DeformableCar, assignClass } = this.game;
    this.dispose();
    const saved = CAR_STYLES[id];
    if (table !== null) CAR_STYLES[id] = table;
    try {
      this.car = new DeformableCar(PAINT, this.scene, null, id);
      assignClass(this.car, cls);
      this.scene.add(this.car.group);
      this.show([]);
    } finally {
      CAR_STYLES[id] = saved;
    }
    const dims = measureCar(this);
    this.show(omit);
    return dims;
  }

  /** Shows every part but `omit`'s (names from OMIT_PARTS). */
  show(omit) {
    for (const name of OMIT_PARTS) for (const o of this.named(name)) o.visible = !omit.includes(name);
    this.scene.updateMatrixWorld(true);
    this.wheels.sync([this.car], SHADOWLESS);
    this.lamps.sync([this.car]);
    this.parts.sync([this.car]);
  }

  named(name) {
    const c = this.car;
    const parts = {
      doors: [c.doorL, c.doorR],
      glass: c.lookMeshes().glass,
      bumpers: [c.bumperF, c.bumperR],
      mirrors: [c.mirrorL, c.mirrorR],
      hood: [c.hood],
      trunk: [c.trunk],
      lightbar: c.lightBar ? [c.lightBar] : [],
      ...this.batch,
    };
    return parts[name];
  }

  dispose() {
    if (this.car === null) return;
    this.scene.remove(this.car.group);
    this.car.dispose();
    this.car = null;
  }
}

/** The drawn car's box and dimensions (m): every shown mesh, wheels, lamps and parts from their batches; ground under the tyres. */
function measureCar({ scene, car, batch }) {
  const box = new THREE.Box3();
  const body = new THREE.Box3();
  const piece = new THREE.Box3();
  const notBody = new Set([...batch.wheels, ...batch.parts, car.lightBar]);
  scene.traverseVisible((o) => {
    if (!o.isMesh || (o.isInstancedMesh && o.count === 0)) return;
    if (o.isInstancedMesh) o.computeBoundingBox();
    else o.geometry.computeBoundingBox();
    piece.copy(o.isInstancedMesh ? o.boundingBox : o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    box.union(piece);
    if (!notBody.has(o)) body.union(piece);
  });
  const wheelBox = new THREE.Box3();
  for (const mesh of batch.wheels) {
    if (mesh.count === 0) continue;
    mesh.computeBoundingBox();
    wheelBox.union(mesh.boundingBox);
  }
  const hubs = car.wheels.map((w) => w.getWorldPosition(new THREE.Vector3()));
  const zs = hubs.map((p) => p.z);
  const xs = hubs.map((p) => p.x);
  const [front, rear] = [Math.max(...zs), Math.min(...zs)];
  const ground = wheelBox.isEmpty() ? 0 : wheelBox.min.y;
  const r = (x) => Number(x.toFixed(3));
  return {
    box,
    hubs,
    car: {
      length: r(box.max.z - box.min.z),
      width: r(body.max.x - body.min.x),
      widthMirrors: r(box.max.x - box.min.x),
      height: r(body.max.y - ground),
      wheelbase: r(front - rear),
      track: r(Math.max(...xs) - Math.min(...xs)),
      overhangFront: r(box.max.z - front),
      overhangRear: r(rear - box.min.z),
      wheelDiameter: r(wheelBox.max.y - wheelBox.min.y),
      groundClearance: r(body.min.y - ground),
      front: r(box.max.z),
      rear: r(box.min.z),
    },
  };
}

/** A W x H headless GL canvas with a three renderer on it; `draw` returns the frame's RGBA, rows top-down. */
export class ViewPort {
  constructor(game, W, H) {
    this.W = W;
    this.H = H;
    this.gl = game.createGL(W, H, { createWebGL2Context: true, alpha: true, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (this.gl === null) throw new Error("trace: headless GL made no WebGL2 context");
    this.renderer = new THREE.WebGLRenderer({ canvas: { width: W, height: H, style: {}, addEventListener() {}, removeEventListener() {} }, context: this.gl });
    this.renderer.setSize(W, H, false);
    this.renderer.setClearColor(0x000000, 0);
    this.pixels = new Uint8Array(W * H * 4);
  }

  draw(scene, camera) {
    const { W, H, gl, pixels } = this;
    this.renderer.render(scene, camera);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const rows = new Uint8ClampedArray(W * H * 4);
    for (let v = 0; v < H; v++) rows.set(pixels.subarray((H - 1 - v) * W * 4, (H - v) * W * 4), v * W * 4);
    return rows;
  }
}

/** The drawn pixels of an RGBA frame, holes filled. */
export function alphaMask(rgba, W, H) {
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4 + 3] === 0 ? 0 : 1;
  return fillHoles(mask, W, H);
}

/** The car's glass as the camera sees it, the body in front of it hiding it: one flat pass, glass white, the rest black. */
export function glassMask(port, stage, camera) {
  const glass = new Set(stage.car.lookMeshes().glass);
  const saved = new Map();
  stage.scene.traverse((o) => {
    if (!o.isMesh) return;
    saved.set(o, o.material);
    o.material = glass.has(o) ? FLAT.glass : FLAT.body;
  });
  const rgba = port.draw(stage.scene, camera);
  for (const [o, m] of saved) o.material = m;
  const mask = new Uint8Array(port.W * port.H);
  for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4 + 3] > 0 && rgba[i * 4] > 127 ? 1 : 0;
  return mask;
}

/** An orthographic frame: pixel (u, v) to metres along the view's screen right (`h`) and up (`g`) world axes, and back. */
export function makeFrame(view, W, H, ppm, sxc, syc) {
  const { R, U, axes } = VIEWS[view];
  const sr = R.find((c) => c !== 0);
  const su = U.find((c) => c !== 0);
  return {
    view,
    W,
    H,
    ppm,
    sxc,
    syc,
    axes,
    h: (u) => sr * (sxc + (u - W / 2) / ppm),
    g: (v) => su * (syc + (H / 2 - v) / ppm),
    u: (h) => W / 2 + (sr * h - sxc) * ppm,
    v: (g) => H / 2 - (su * g - syc) * ppm,
  };
}

/** `frame` moved so world `dh` along its right axis lands on 0. */
function shiftFrame(frame, dh) {
  const sr = VIEWS[frame.view].R.find((c) => c !== 0);
  return makeFrame(frame.view, frame.W, frame.H, frame.ppm, frame.sxc - sr * dh, frame.syc);
}

/** A side frame moved so the reference's two tyres stand either side of z = 0 (car space), with those tyres; unmoved without two. */
export function centreOnHubs(frame, sil) {
  const hubs = sideHubs(frame, sil);
  if (hubs === null) return { frame, hubs };
  const moved = shiftFrame(frame, (hubs.front.z + hubs.rear.z) / 2);
  return { frame: moved, hubs: sideHubs(moved, sil) };
}

export function frameCamera(frame) {
  const { R, U } = VIEWS[frame.view];
  const r = new THREE.Vector3(...R);
  const up = new THREE.Vector3(...U);
  const centre = r.clone().multiplyScalar(frame.sxc).addScaledVector(up, frame.syc);
  const { W, H, ppm } = frame;
  const camera = new THREE.OrthographicCamera(-W / 2 / ppm, W / 2 / ppm, H / 2 / ppm, -H / 2 / ppm, 0.1, 40);
  camera.up.copy(up);
  camera.position.copy(centre).addScaledVector(r.clone().cross(up), 20);
  camera.lookAt(centre);
  camera.updateMatrixWorld();
  return camera;
}

/** The frame round the car's box, without a reference. */
export function bareFrame(view, box) {
  const { R, U } = VIEWS[view];
  const [r0, r1] = along(box, R);
  const [v0, v1] = along(box, U);
  const W = Math.round((r1 - r0 + 2 * BARE_MARGIN_M) * BARE_PX_PER_M);
  const H = Math.round((v1 - v0 + 2 * BARE_MARGIN_M) * BARE_PX_PER_M);
  return makeFrame(view, W, H, BARE_PX_PER_M, (r0 + r1) / 2, (v0 + v1) / 2);
}

/** [min, max] of `box` along the unit axis `axis` (one ±1 component), in screen coordinates. */
function along(box, axis) {
  const k = axis.findIndex((c) => c !== 0);
  const a = box.min.getComponent(k) * axis[k];
  const b = box.max.getComponent(k) * axis[k];
  return [Math.min(a, b), Math.max(a, b)];
}

/**
 * The frame of `view` over the reference drawn at `zoom` with `pad` blank reference pixels round it: reference columns `cols` are
 * `metres` apart with their midpoint at world `mid` along the view's right axis, and reference row `groundRow` is world 0 up.
 */
export function refFrame(view, ref, zoom, pad, cols, metres, mid, groundRow) {
  const W = Math.round((ref.width + 2 * pad) * zoom);
  const H = Math.round((ref.height + 2 * pad) * zoom);
  const ppm = (zoom * Math.abs(cols[1] - cols[0])) / metres;
  const sr = VIEWS[view].R.find((c) => c !== 0);
  const uMid = zoom * ((cols[0] + cols[1]) / 2 + pad);
  const vGround = zoom * (groundRow + pad);
  return makeFrame(view, W, H, ppm, sr * mid - (uMid - W / 2) / ppm, -(H / 2 - vGround) / ppm);
}

/** The reference over white, the car at CAR_ALPHA over it, then the outlines named in `masks` (null ones skipped). */
export function composeShot(game, W, H, plate, carRgba, masks) {
  const shot = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    if (plate !== null) {
      const a = plate[o + 3] / 255;
      for (let c = 0; c < 3; c++) shot[o + c] = plate[o + c] * a + 255 * (1 - a);
    }
    if (carRgba[o + 3] === 0) continue;
    for (let c = 0; c < 3; c++) shot[o + c] = shot[o + c] * (1 - CAR_ALPHA) + carRgba[o + c] * CAR_ALPHA;
  }
  for (const [name, mask] of Object.entries(masks)) if (mask !== null) outline(shot, mask, W, LINES[name]);
  const canvas = game.createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(new game.ImageData(shot, W, H), 0, 0);
  return { canvas, ctx };
}

/** Grid lines every GRID_M in the view's world axes, labelled at whole metres. */
function drawGrid(ctx, frame) {
  const { W, H, axes } = frame;
  ctx.font = "11px sans-serif";
  ctx.lineWidth = 1;
  const line = (at, horizontal, label) => {
    const whole = Math.abs(at - Math.round(at)) < 1e-6;
    const p = Math.round(horizontal ? frame.v(at) : frame.u(at)) + 0.5;
    ctx.strokeStyle = whole ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.15)";
    ctx.beginPath();
    ctx.moveTo(horizontal ? 0 : p, horizontal ? p : 0);
    ctx.lineTo(horizontal ? W : p, horizontal ? p : H);
    ctx.stroke();
    if (!whole) return;
    if (horizontal) ctx.fillText(`${label}=${Math.round(at)}`, 2, p - 2);
    else ctx.fillText(`${label}=${Math.round(at)}`, p + 2, H - 4);
  };
  const [h0, h1] = [frame.h(0), frame.h(W)].sort((a, b) => a - b);
  const [g0, g1] = [frame.g(H), frame.g(0)].sort((a, b) => a - b);
  for (let h = Math.ceil(h0 / GRID_M) * GRID_M; h <= h1; h += GRID_M) line(h, false, axes[0]);
  for (let g = Math.ceil(g0 / GRID_M) * GRID_M; g <= g1; g += GRID_M) line(g, true, axes[1]);
}

/** `json`: [[h, v], ...] or a list of such polylines, in the view's world axes (m), drawn yellow. */
function drawPoints(ctx, frame, json) {
  const list = JSON.parse(json);
  const lines = Array.isArray(list[0]?.[0]) ? list : [list];
  ctx.strokeStyle = "rgb(255,220,0)";
  ctx.fillStyle = "rgb(255,220,0)";
  ctx.lineWidth = 2;
  for (const pts of lines) {
    const at = pts.map(([h, g]) => [frame.u(h), frame.v(g)]);
    ctx.beginPath();
    for (const [u, v] of at) ctx.lineTo(u, v);
    ctx.stroke();
    for (const [u, v] of at) ctx.fillRect(u - 3, v - 3, 6, 6);
  }
}

/**
 * Draws the stage's car in `frame` over `layers` (`refLayers`, or null), writes the overlay PNG to `opts.out`, and returns the fit:
 * silhouette IoU and edge offsets, the glass's, the side view's corners, the gap regions and their checklist.
 */
export async function traceView(game, stage, port, frame, layers, marks, opts) {
  const camera = frameCamera(frame);
  const carRgba = port.draw(stage.scene, camera);
  const carSil = alphaMask(carRgba, frame.W, frame.H);
  const carGlass = glassMask(port, stage, camera);
  const glError = port.gl.getError();
  const shot = composeShot(game, frame.W, frame.H, layers?.plate ?? null, carRgba, { ref: layers?.sil ?? null, car: carSil, refGlass: layers?.glass ?? null, carGlass });
  drawGrid(shot.ctx, frame);
  if (opts.points !== undefined) drawPoints(shot.ctx, frame, opts.points);
  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, await shot.canvas.encode("png"));
  if (layers === null) return { png: opts.out, glError };
  const fit = compare(frame, carSil, layers.sil, opts.stations, opts.rows);
  const glass = glassCompare(frame, carGlass, layers.glass, opts.stations, opts.rows);
  const corners = frame.view === "side" ? sideCorners(frame, carSil, layers.sil, marks) : [];
  const gaps = gapRegions(frame, carSil, layers.sil);
  return { png: opts.out, ...fit, glass: glass && { ...glass, refThreshold: layers.glassThreshold }, corners, gaps, checklist: checklist(frame, corners, gaps), glError };
}

/** The reference glass's lowest sill (m), the belt height the side corners split at; null without glass. */
export function beltOf(frame, glass) {
  const box = maskBox(glass, frame.W, frame.H);
  return box.v1 < 0 ? null : frame.g(box.v1 + 1);
}
