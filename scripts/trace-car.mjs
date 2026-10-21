#!/usr/bin/env node
/**
 * One car style's drawn meshes (no engine) through headless GL, over a reference picture calibrated to metres, for matching a
 * silhouette fast: writes an overlay PNG and prints one JSON line with the silhouette IoU, the edge offsets and the car's dimensions.
 *
 *   node --disable-warning=ExperimentalWarning scripts/trace-car.mjs --style sedan --view side \
 *     --ref silver-sedan-1.png --ref-span 3,299=4.221 [--anchor ends|wheels] [--ref-ground 95] [--ref-crop x,y,w,h] \
 *     [--points '[[2.0,0.65],[1.2,0.9]]'] [--class monster] [--zoom 4] [--stations 16] [--camera 6,0.55,0.8] [--out <png>]
 *
 * Views: `side` (camera on +x, front at the left; points are (z, y)), `top` (front at the left; (z, x)), `front` and `rear`
 * ((x, y)): orthographic, exactly axis-aligned. `iso` / `iso-rear`: the game's 50° lens at `--camera r,pitch,angle` (default
 * 6,0.55,0.8 from the front-left; `iso-rear` turns it half way round), zoomed to fill the frame, with the reference's foreground
 * scaled to the car's (same box area) and centred on it: its IoU is a rough guide only, and it takes no `--points`.
 * `--ref-span x0,x1=m`: two pixel columns of the reference (front then rear: bumper tips with `--anchor ends`, the default, or wheel
 * centres with `--anchor wheels`) are `m` metres apart (default: the style's spec `dims` length, or wheelbase; width or track in the
 * front and rear views), and their midpoint sits on the car's matching midpoint. `--ref-ground y`:
 * the reference row of the ground (side/front/rear) or of the centreline (top); default the foreground's bottom row (its middle row
 * for `top`). `--ref-crop` cuts one car out of a lineup first. Foreground: any pixel that differs from the reference's top-left
 * pixel by more than REF_FG_DIFF, holes filled (both silhouettes).
 * The PNG: the reference, the car semi-transparent (orange) over it, the car's outline magenta, the reference's cyan, a 0.5 m grid
 * (labelled at whole metres, in the view's axes) and `--points` (a JSON list of [h, v] pairs, or of such lists; inline or a file) in yellow.
 * JSON: `iou`; `offsetCm` per edge (`top`, `bottom`, `front`, `rear`; `left`/`right` image edges in the front and rear views) as the
 * mean and the largest signed offset, positive where the car sticks out past the reference; `edges` the stations behind them as
 * [station m, car edge m, reference edge m, offset cm], in the view's axes; `refSize` and `carSize` the two silhouettes' extents (m);
 * `car` the drawn car's dimensions (m, ground at the tyres' bottom; `width` and `height` the body's, mirrors, wheels and light bar
 * off); `ms` the whole run. The class (`--class`, default the style's) lifts the body and scales the wheels as the game does.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as THREE from "three";

/** A reference pixel this far (sum of |ΔR|+|ΔG|+|ΔB|+|ΔA|) from the background is the car: clears anti-aliased fringes and JPEG noise. */
const REF_FG_DIFF = 96;
/** Blank border around the reference, as a share of its larger side, so a car longer or taller than the reference is not clipped. */
const PAD_SHARE = 0.12;
/** Pixels per metre without a reference. */
const BARE_PX_PER_M = 120;
/** Margin around the car without a reference (m). */
const BARE_MARGIN_M = 0.4;
/** The car fill's opacity over the reference. */
const CAR_ALPHA = 0.55;
/** Grid spacing (m); labels at whole metres. */
const GRID_M = 0.5;
/** Edge stations up the height (front and rear edges). */
const V_STATIONS = 8;
/** The game's camera lens (engine.ts). */
const ISO_FOV = 50;
/** The cars brief's iso framing (radius m, pitch rad, angle rad): front-left; `iso-rear` turns the angle half way round. */
const ISO_CAMERA = [6, 0.55, 0.8];
/** The iso canvas without a reference: the headless shots' size. */
const ISO_SIZE = [1280, 800];
/** The iso lens zooms until the car's box spans this share of the frame's half-width or half-height (whichever binds first). */
const ISO_FILL = 0.8;
/** Output pixels per reference pixel: the side/top crops are ~300 px wide, the iso pictures ~400 px. */
const ORTHO_ZOOM = 4;
const ISO_ZOOM = 2;
/** Bright orange paint: stands apart from every reference's paint under the magenta and cyan outlines. */
const PAINT = { name: "Trace", body: 0xff8c1a, accent: 0x3a3a3a };
const CAR_LINE = [255, 0, 255];
const REF_LINE = [0, 200, 255];
/** Screen right (R) and up (U) per orthographic view; the camera sits on R × U. */
const VIEWS = {
  side: { R: [0, 0, -1], U: [0, 1, 0] },
  top: { R: [0, 0, -1], U: [-1, 0, 0] },
  front: { R: [1, 0, 0], U: [0, 1, 0] },
  rear: { R: [-1, 0, 0], U: [0, 1, 0] },
};

const t0 = performance.now();
const { values } = parseArgs({
  options: {
    style: { type: "string", default: "sedan" },
    class: { type: "string" },
    view: { type: "string", default: "side" },
    ref: { type: "string" },
    "ref-crop": { type: "string" },
    "ref-span": { type: "string" },
    "ref-ground": { type: "string" },
    anchor: { type: "string", default: "ends" },
    points: { type: "string" },
    zoom: { type: "string" },
    stations: { type: "string", default: "16" },
    camera: { type: "string" },
    out: { type: "string" },
  },
});
const view = values.view;
const iso = view === "iso" || view === "iso-rear";
if (!iso && !(view in VIEWS)) throw new Error(`--view ${view}: one of ${[...Object.keys(VIEWS), "iso", "iso-rear"].join(", ")}`);
if (values.anchor !== "ends" && values.anchor !== "wheels") throw new Error(`--anchor ${values.anchor}: ends or wheels`);
const zoom = Number(values.zoom ?? (iso ? ISO_ZOOM : ORTHO_ZOOM));
const crop = values["ref-crop"]?.split(",").map(Number);
if (crop !== undefined && (crop.length !== 4 || !crop.every((n) => n >= 0))) throw new Error(`--ref-crop ${values["ref-crop"]}: x,y,width,height in reference pixels`);
const hStations = Number(values.stations);
if (!(zoom > 0)) throw new Error(`--zoom ${values.zoom}: a positive scale`);
if (!Number.isInteger(hStations) || hStations < 2) throw new Error(`--stations ${values.stations}: a whole number, at least 2`);
if (iso && values.points !== undefined) throw new Error("--points: orthographic views only");
const out = resolve(values.out ?? join(tmpdir(), "trace-car", `${values.style}-${view}.png`));

if (existsSync("/dev/dxg")) process.env.GALLIUM_DRIVER ??= "d3d12";
const glDir = dirname(fileURLToPath(import.meta.resolve("@kmamal/gl")));
if (!existsSync(join(glDir, "dist/webgl.node"))) {
  console.error(`trace-car: @kmamal/gl has no native binary. Fetch it once:\n  node ${join(glDir, "scripts/install.mjs")}`);
  process.exit(2);
}
const { default: createGL } = await import("@kmamal/gl");
const { createCanvas, ImageData, loadImage } = await import("@napi-rs/canvas");
const game = (path) => import(new URL(`../src/game/${path}`, import.meta.url).href);
await (await game("deform/skin-kernel.test-util.ts")).loadSkinKernelForTest();
const { DeformableCar } = await game("vehicle/car.ts");
const { CAR_STYLES, CAR_STYLE_IDS } = await game("vehicle/car-variants.ts");
const { STYLE_CLASS, VEHICLE_CLASS_IDS, assignClass } = await game("vehicle/vehicle-classes.ts");
const { WheelBatch } = await game("vehicle/wheel-batch.ts");
const { LampBatch } = await game("vehicle/lamp-lights.ts");
const { PartBatch } = await game("vehicle/part-batch.ts");
if (!CAR_STYLE_IDS.includes(values.style)) throw new Error(`--style ${values.style}: one of ${CAR_STYLE_IDS.join(", ")}`);
const carClass = values.class ?? STYLE_CLASS[values.style];
if (!VEHICLE_CLASS_IDS.includes(carClass)) throw new Error(`--class ${carClass}: one of ${VEHICLE_CLASS_IDS.join(", ")}`);

const scene = new THREE.Scene();
const car = new DeformableCar(PAINT, scene, null, values.style);
assignClass(car, carClass);
scene.add(car.group);
const wheels = new WheelBatch(4, () => false);
const lamps = new LampBatch(car.lamps.length);
const parts = new PartBatch(1);
scene.add(...wheels.meshes, ...lamps.meshes, ...parts.meshes);
scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(3, 6, 4);
scene.add(sun);
const shadowless = { shadowMap: { render() {} } };
scene.updateMatrixWorld(true);
wheels.sync([car], shadowless);
lamps.sync([car]);
parts.sync([car]);
const dims = measureCar();

const ref = values.ref === undefined ? null : cropped(await loadImage(readFileSync(values.ref)));
const refBox = ref === null ? null : refForeground(ref);
const pad = ref === null ? 0 : Math.ceil(PAD_SHARE * Math.max(ref.width, ref.height));
let W = ISO_SIZE[0];
let H = ISO_SIZE[1];
let ppm = 0;
let sxc = 0;
let syc = 0;
if (ref !== null) {
  W = Math.round((ref.width + 2 * pad) * zoom);
  H = Math.round((ref.height + 2 * pad) * zoom);
}
if (!iso && ref !== null) {
  const span = /^(-?[\d.]+),(-?[\d.]+)(?:=([\d.]+))?$/.exec(values["ref-span"] ?? "");
  if (span === null) throw new Error(`--ref-span x0,x1[=metres] is required with --ref: the reference's foreground spans columns ${refBox.u0}..${refBox.u1 + 1}, rows ${refBox.v0}..${refBox.v1 + 1}`);
  const [u0, u1] = [Number(span[1]), Number(span[2])];
  const metres = span[3] === undefined ? specSpan(CAR_STYLES[values.style].dims) : Number(span[3]);
  ppm = (zoom * Math.abs(u1 - u0)) / metres;
  const vGround = values["ref-ground"] === undefined ? (view === "top" ? (refBox.v0 + refBox.v1 + 1) / 2 : refBox.v1 + 1) : Number(values["ref-ground"]);
  sxc = mid(featureAlong(VIEWS[view].R)) + (W / 2 - zoom * ((u0 + u1) / 2 + pad)) / ppm;
  syc = verticalAnchor() + (zoom * (vGround + pad) - H / 2) / ppm;
} else if (!iso) {
  const [r0, r1] = along(dims.box, VIEWS[view].R);
  const [v0, v1] = along(dims.box, VIEWS[view].U);
  ppm = BARE_PX_PER_M;
  W = Math.round((r1 - r0 + 2 * BARE_MARGIN_M) * ppm);
  H = Math.round((v1 - v0 + 2 * BARE_MARGIN_M) * ppm);
  sxc = (r0 + r1) / 2;
  syc = (v0 + v1) / 2;
}

const gl = createGL(W, H, { createWebGL2Context: true, alpha: true, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
if (gl === null) throw new Error("trace-car: headless GL made no WebGL2 context");
const renderer = new THREE.WebGLRenderer({ canvas: { width: W, height: H, style: {}, addEventListener() {}, removeEventListener() {} }, context: gl });
renderer.setSize(W, H, false);
renderer.setClearColor(0x000000, 0);
renderer.render(scene, makeCamera());
const pixels = new Uint8Array(W * H * 4);
gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
const glError = gl.getError();

const carMask = new Uint8Array(W * H);
for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) carMask[v * W + u] = pixels[((H - 1 - v) * W + u) * 4 + 3] === 0 ? 0 : 1;
const refRgba = ref === null ? null : iso ? isoPlate() : plate(pad * zoom, pad * zoom, zoom);
const refMask = new Uint8Array(W * H);
const shot = new Uint8ClampedArray(W * H * 4).fill(255);
for (let v = 0; v < H; v++) {
  for (let u = 0; u < W; u++) {
    const i = v * W + u;
    const o = i * 4;
    if (refRgba !== null) {
      const a = refRgba[o + 3] / 255;
      let diff = 0;
      for (let c = 0; c < 4; c++) diff += Math.abs(refRgba[o + c] - refBox.bg[c]);
      for (let c = 0; c < 3; c++) shot[o + c] = refRgba[o + c] * a + 255 * (1 - a);
      refMask[i] = diff > REF_FG_DIFF ? 1 : 0;
    }
    if (!carMask[i]) continue;
    const g = ((H - 1 - v) * W + u) * 4;
    for (let c = 0; c < 3; c++) shot[o + c] = shot[o + c] * (1 - CAR_ALPHA) + pixels[g + c] * CAR_ALPHA;
  }
}
fillHoles(carMask);
fillHoles(refMask);
const fit = ref === null ? null : iso ? { iou: iou() } : compare();
outline(refMask, REF_LINE);
outline(carMask, CAR_LINE);
const png = createCanvas(W, H);
const ctx = png.getContext("2d");
ctx.putImageData(new ImageData(shot, W, H), 0, 0);
if (!iso) drawGrid();
if (values.points !== undefined) drawPoints(values.points.trim().startsWith("[") ? values.points : readFileSync(values.points, "utf8"));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, await png.encode("png"));

const result = { style: values.style, class: carClass, view, png: out, size: `${W}x${H}`, pxPerM: round(ppm, 2), ...fit, car: dims.car, glError, ms: Math.round(performance.now() - t0) };
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = glError === gl.NO_ERROR ? 0 : 1;

/** The drawn car's box and dimensions: every shown mesh (wheels, lamps and parts from their batches), ground under the tyres. */
function measureCar() {
  const box = new THREE.Box3();
  const body = new THREE.Box3();
  const piece = new THREE.Box3();
  scene.traverseVisible((o) => {
    if (!o.isMesh || (o.isInstancedMesh && o.count === 0)) return;
    if (o.isInstancedMesh) {
      o.computeBoundingBox();
      piece.copy(o.boundingBox);
    } else {
      o.geometry.computeBoundingBox();
      piece.copy(o.geometry.boundingBox);
    }
    piece.applyMatrix4(o.matrixWorld);
    box.union(piece);
    if (!wheels.meshes.includes(o) && !parts.meshes.includes(o) && o !== car.lightBar) body.union(piece);
  });
  const wheelBox = new THREE.Box3();
  for (const mesh of wheels.meshes) {
    if (!mesh.visible || mesh.count === 0) continue;
    mesh.computeBoundingBox();
    wheelBox.union(mesh.boundingBox);
  }
  const hubs = car.wheels.map((w) => w.getWorldPosition(new THREE.Vector3()));
  const zs = hubs.map((p) => p.z);
  const xs = hubs.map((p) => p.x);
  const frontZ = Math.max(...zs);
  const rearZ = Math.min(...zs);
  const ground = wheelBox.min.y;
  return {
    box,
    ground,
    hubs,
    car: {
      length: round(box.max.z - box.min.z),
      width: round(body.max.x - body.min.x),
      widthMirrors: round(box.max.x - box.min.x),
      height: round(body.max.y - ground),
      wheelbase: round(frontZ - rearZ),
      track: round(Math.max(...xs) - Math.min(...xs)),
      overhangFront: round(box.max.z - frontZ),
      overhangRear: round(rearZ - box.min.z),
      wheelDiameter: round(wheelBox.max.y - wheelBox.min.y),
      groundClearance: round(body.min.y - ground),
      front: round(box.max.z),
      rear: round(box.min.z),
    },
  };
}

/** `image`, or its `--ref-crop` rectangle (one car out of a lineup). */
function cropped(image) {
  if (crop === undefined) return image;
  const [x, y, w, h] = crop;
  const c = createCanvas(w, h);
  c.getContext("2d").drawImage(image, x, y, w, h, 0, 0, w, h);
  return c;
}

/** Sets every unset pixel the frame's border cannot reach through unset pixels: a silhouette has no holes (glass, highlights, gaps). */
function fillHoles(mask) {
  const outside = new Uint8Array(W * H);
  const stack = [];
  for (let u = 0; u < W; u++) stack.push(u, (H - 1) * W + u);
  for (let v = 0; v < H; v++) stack.push(v * W, v * W + W - 1);
  while (stack.length > 0) {
    const i = stack.pop();
    if (outside[i] || mask[i]) continue;
    outside[i] = 1;
    const u = i % W;
    if (u > 0) stack.push(i - 1);
    if (u < W - 1) stack.push(i + 1);
    if (i >= W) stack.push(i - W);
    if (i < W * (H - 1)) stack.push(i + W);
  }
  for (let i = 0; i < W * H; i++) mask[i] = outside[i] ? 0 : 1;
}

/** [min, max] of `box` along the unit axis `axis` (one ±1 component). */
function along(box, axis) {
  const k = axis.findIndex((c) => c !== 0);
  const a = box.min.getComponent(k) * axis[k];
  const b = box.max.getComponent(k) * axis[k];
  return [Math.min(a, b), Math.max(a, b)];
}

/** The car feature the reference span marks, as [min, max] along screen axis `axis`: its ends, or its wheel centres. */
function featureAlong(axis) {
  if (values.anchor === "ends") return along(dims.box, axis);
  const at = dims.hubs.map((p) => p.x * axis[0] + p.y * axis[1] + p.z * axis[2]);
  return [Math.min(...at), Math.max(...at)];
}

/** The spec length the reference span marks when it names none (`BodyStyle.dims`). */
function specSpan({ wheelbase, overhang, track, width }) {
  const lengthwise = view === "side" || view === "top";
  if (values.anchor === "wheels") return lengthwise ? wheelbase : track;
  return lengthwise ? overhang.front + wheelbase + overhang.rear : width;
}

/** The car's screen-up coordinate the reference's ground row sits on: the tyres' bottom, or the centreline from above. */
function verticalAnchor() {
  if (view === "top") return mid(along(dims.box, VIEWS.top.U));
  return dims.ground;
}

function mid([a, b]) {
  return (a + b) / 2;
}

function round(x, digits = 3) {
  return Number.isFinite(x) ? Number(x.toFixed(digits)) : null;
}

/** The reference's foreground bounding box in its own pixels, and its background colour (the top-left pixel). */
function refForeground(image) {
  const c = createCanvas(image.width, image.height).getContext("2d");
  c.drawImage(image, 0, 0);
  const d = c.getImageData(0, 0, image.width, image.height).data;
  const box = { u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity, bg: d.slice(0, 4) };
  for (let v = 0; v < image.height; v++) {
    for (let u = 0; u < image.width; u++) {
      const o = (v * image.width + u) * 4;
      let diff = 0;
      for (let k = 0; k < 4; k++) diff += Math.abs(d[o + k] - d[k]);
      if (diff <= REF_FG_DIFF) continue;
      box.u0 = Math.min(box.u0, u);
      box.u1 = Math.max(box.u1, u);
      box.v0 = Math.min(box.v0, v);
      box.v1 = Math.max(box.v1, v);
    }
  }
  if (box.u0 === Infinity) throw new Error(`--ref ${values.ref}: no pixel differs from the top-left one`);
  return box;
}

/** The reference scaled by `k` with its top-left at (dx, dy) on a W x H plate of its own background colour, as RGBA. */
function plate(dx, dy, k) {
  const c = createCanvas(W, H).getContext("2d");
  const [r, g, b, a] = refBox.bg;
  c.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
  c.fillRect(0, 0, W, H);
  c.imageSmoothingQuality = "high";
  c.drawImage(ref, dx, dy, ref.width * k, ref.height * k);
  return c.getImageData(0, 0, W, H).data;
}

/** The iso reference is uncalibrated: its foreground box is scaled to the car's drawn box (same area) and centred on it. */
function isoPlate() {
  const cb = maskBox(carMask);
  if (cb.u1 < 0) throw new Error("trace-car: the car is off the iso frame; widen --camera's radius");
  const k = Math.sqrt(((cb.u1 + 1 - cb.u0) * (cb.v1 + 1 - cb.v0)) / ((refBox.u1 + 1 - refBox.u0) * (refBox.v1 + 1 - refBox.v0)));
  return plate((cb.u0 + cb.u1 + 1) / 2 - (k * (refBox.u0 + refBox.u1 + 1)) / 2, (cb.v0 + cb.v1 + 1) / 2 - (k * (refBox.v0 + refBox.v1 + 1)) / 2, k);
}

function iou() {
  let both = 0;
  let either = 0;
  for (let i = 0; i < W * H; i++) {
    both += carMask[i] & refMask[i];
    either += carMask[i] | refMask[i];
  }
  return round(both / either, 4);
}

function makeCamera() {
  if (iso) {
    const [radius, pitch, turn] = values.camera === undefined ? ISO_CAMERA : values.camera.split(",").map(Number);
    const angle = view === "iso-rear" && values.camera === undefined ? turn + Math.PI : turn;
    const camera = new THREE.PerspectiveCamera(ISO_FOV, W / H, 0.1, 100);
    const lookY = (dims.box.min.y + dims.box.max.y) / 2;
    camera.position.set(Math.sin(angle) * radius * Math.cos(pitch), lookY + radius * Math.sin(pitch), Math.cos(angle) * radius * Math.cos(pitch));
    camera.lookAt(0, lookY, 0);
    camera.updateMatrixWorld();
    const { min, max } = dims.box;
    let reach = 0;
    for (let k = 0; k < 8; k++) {
      const p = new THREE.Vector3(k & 1 ? max.x : min.x, k & 2 ? max.y : min.y, k & 4 ? max.z : min.z).project(camera);
      reach = Math.max(reach, Math.abs(p.x), Math.abs(p.y));
    }
    camera.zoom = ISO_FILL / reach;
    camera.updateProjectionMatrix();
    return camera;
  }
  const { R, U } = VIEWS[view];
  const r = new THREE.Vector3(...R);
  const up = new THREE.Vector3(...U);
  const centre = r.clone().multiplyScalar(sxc).addScaledVector(up, syc);
  const camera = new THREE.OrthographicCamera(-W / 2 / ppm, W / 2 / ppm, H / 2 / ppm, -H / 2 / ppm, 0.1, 40);
  camera.up.copy(up);
  camera.position.copy(centre).addScaledVector(r.clone().cross(up), 20);
  camera.lookAt(centre);
  camera.updateMatrixWorld();
  return camera;
}

/** World coordinate along screen axis `axis` of screen coordinate `s` (axes are ±unit, so the sign is the mapping). */
function world(axis, s) {
  return s * axis[axis.findIndex((c) => c !== 0)];
}

function uToS(u) {
  return sxc + (u - W / 2) / ppm;
}
function vToS(v) {
  return syc + (H / 2 - v) / ppm;
}
function sToU(s) {
  return W / 2 + (s - sxc) * ppm;
}
function sToV(s) {
  return H / 2 - (s - syc) * ppm;
}

/** IoU, edge offsets at stations, and both silhouettes' extents. */
function compare() {
  const { R, U } = VIEWS[view];
  const cb = maskBox(carMask);
  const rb = maskBox(refMask);
  const u0 = Math.min(cb.u0, rb.u0);
  const u1 = Math.max(cb.u1, rb.u1);
  const v0 = Math.min(cb.v0, rb.v0);
  const v1 = Math.max(cb.v1, rb.v1);
  const columns = stations(u0, u1, hStations);
  const rows = stations(v0, v1, V_STATIONS);
  const [lo, hi] = view === "front" || view === "rear" ? ["left", "right"] : ["front", "rear"];
  const colStation = (u) => world(R, uToS(u + 0.5));
  const rowStation = (v) => world(U, vToS(v + 0.5));
  const edges = {
    top: edge(columns, colStation, (m, u) => firstIn(m, u, 0, 1, H, true), (v) => world(U, vToS(v)), -1),
    bottom: edge(columns, colStation, (m, u) => firstIn(m, u, H - 1, -1, H, true), (v) => world(U, vToS(v + 1)), 1),
    [lo]: edge(rows, rowStation, (m, v) => firstIn(m, v, 0, 1, W, false), (u) => world(R, uToS(u)), -1),
    [hi]: edge(rows, rowStation, (m, v) => firstIn(m, v, W - 1, -1, W, false), (u) => world(R, uToS(u + 1)), 1),
  };
  const offsetCm = {};
  for (const [name, list] of Object.entries(edges)) {
    const d = list.filter((s) => s[3] !== null).map((s) => s[3]);
    const largest = d.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
    offsetCm[name] = { mean: d.length === 0 ? null : round(d.reduce((a, b) => a + b, 0) / d.length, 1), max: round(largest, 1) };
  }
  const size = (b) => [round((b.u1 + 1 - b.u0) / ppm), round((b.v1 + 1 - b.v0) / ppm)];
  return { iou: iou(), offsetCm, refSize: size(rb), carSize: size(cb), edges };

  /**
   * Each station's car and reference edge (world m) and the car's outward offset (cm): `scan(mask, at)` finds the edge pixel,
   * `toWorld` turns it into metres, `out` is the screen direction that is outward (+1 right/down, -1 left/up).
   */
  function edge(at, station, scan, toWorld, out) {
    return at.map((p) => {
      const c = scan(carMask, p);
      const r = scan(refMask, p);
      const d = c === null || r === null ? null : ((c - r) * out * 100) / ppm;
      return [round(station(p)), c === null ? null : round(toWorld(c)), r === null ? null : round(toWorld(r)), d === null ? null : round(d, 1)];
    });
  }
}

/** `n` evenly spaced pixel lines across [a, b], each at the middle of its share. */
function stations(a, b, n) {
  return Array.from({ length: n }, (_, k) => Math.floor(a + ((k + 0.5) * (b + 1 - a)) / n));
}

/** The first set pixel walking from `start` by `step` along a column (`vertical`) or row `line`; null when none. */
function firstIn(mask, line, start, step, length, vertical) {
  for (let k = start; k >= 0 && k < length; k += step) if (mask[vertical ? k * W + line : line * W + k]) return k;
  return null;
}

function maskBox(mask) {
  const b = { u0: W, u1: -1, v0: H, v1: -1 };
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      if (!mask[v * W + u]) continue;
      b.u0 = Math.min(b.u0, u);
      b.u1 = Math.max(b.u1, u);
      b.v0 = Math.min(b.v0, v);
      b.v1 = Math.max(b.v1, v);
    }
  }
  return b;
}

/** Paints `mask`'s border pixels (a set pixel with an unset 4-neighbour) `rgb` in the shot. */
function outline(mask, rgb) {
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const i = v * W + u;
      if (!mask[i]) continue;
      const inside = u > 0 && u < W - 1 && v > 0 && v < H - 1 && mask[i - 1] && mask[i + 1] && mask[i - W] && mask[i + W];
      if (inside) continue;
      shot.set(rgb, i * 4);
    }
  }
}

/** Grid lines every GRID_M in the view's world axes, labelled at whole metres. */
function drawGrid() {
  const { R, U } = VIEWS[view];
  const names = "xyz";
  ctx.font = "11px sans-serif";
  ctx.lineWidth = 1;
  const [h0, h1] = [world(R, uToS(0)), world(R, uToS(W))].sort((a, b) => a - b);
  const [g0, g1] = [world(U, vToS(H)), world(U, vToS(0))].sort((a, b) => a - b);
  for (let h = Math.ceil(h0 / GRID_M) * GRID_M; h <= h1; h += GRID_M) {
    const u = Math.round(sToU(world(R, h))) + 0.5;
    const whole = Math.abs(h - Math.round(h)) < 1e-6;
    ctx.strokeStyle = whole ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.15)";
    ctx.beginPath();
    ctx.moveTo(u, 0);
    ctx.lineTo(u, H);
    ctx.stroke();
    if (whole) ctx.fillText(`${names[R.findIndex((c) => c !== 0)]}=${Math.round(h)}`, u + 2, H - 4);
  }
  for (let g = Math.ceil(g0 / GRID_M) * GRID_M; g <= g1; g += GRID_M) {
    const v = Math.round(sToV(world(U, g))) + 0.5;
    const whole = Math.abs(g - Math.round(g)) < 1e-6;
    ctx.strokeStyle = whole ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.15)";
    ctx.beginPath();
    ctx.moveTo(0, v);
    ctx.lineTo(W, v);
    ctx.stroke();
    if (whole) ctx.fillText(`${names[U.findIndex((c) => c !== 0)]}=${Math.round(g)}`, 2, v - 2);
  }
}

/** `json`: [[h, v], ...] or a list of such polylines, in the view's world axes (m). */
function drawPoints(json) {
  const { R, U } = VIEWS[view];
  const list = JSON.parse(json);
  const lines = Array.isArray(list[0]?.[0]) ? list : [list];
  ctx.strokeStyle = "rgb(255,220,0)";
  ctx.fillStyle = "rgb(255,220,0)";
  ctx.lineWidth = 2;
  for (const line of lines) {
    const at = line.map(([h, v]) => [sToU(world(R, h)), sToV(world(U, v))]);
    ctx.beginPath();
    for (const [u, v] of at) ctx.lineTo(u, v);
    ctx.stroke();
    for (const [u, v] of at) ctx.fillRect(u - 3, v - 3, 6, 6);
  }
}
