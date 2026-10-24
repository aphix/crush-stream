/**
 * The landing views: per car, which reference each view is traced on and how its iso views are framed, in
 * `scripts/landing-views/<style>.json` (one file per car, owned by its lane):
 *
 *   { "side": { "ref": "<file under the references>" }, "top": { "ref": ... },
 *     "iso": { "ref": ..., "crop": [x, y, w, h], "wheels": { "fl": { "hub": [u, v], "contact": [u, v] }, ... },
 *              "landmarks": [{ "name": "front badge", "at": [x, y, z], "pixel": [u, v] }], "fov": 15?, "camera": {...} | null },
 *     "rear-iso": { ... } }
 *
 * Wheels are picked once on the crop (pixels, x right y down; `trace-car --grid` draws the crop with a pixel grid to read them off):
 * `f`/`r` front/rear, `l`/`r` the car's left/right (the left is +x, the side the front iso shows), `hub` the wheel's centre on its
 * outer face, `contact` the tyre's lowest point. One side's wheels lie near one plane and leave the view's tilt about the wheel line
 * loose: `landmarks` add points off that plane (a badge on the centre line, a far-side lamp or mirror), each at a car-space place
 * `at` as the style file writes it (metres, before the class lift; the solve adds the lift) and its `pixel` on the crop.
 * `trace-car --solve` fits the camera to all the picks and stores it: it tries a range of fields of view and keeps the one whose
 * silhouette fits best, or only `fov` (degrees) where the entry pins one by hand. Every shot after uses the stored camera, so a
 * wheel the car moves later shows as wheel error instead of being hidden by a new camera.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { ViewPort, alphaMask, composeShot, writePlate } from "./trace-core.mjs";
import { iou, labelRegions, maskBox, round } from "./trace-metrics.mjs";
import { refLayers, refPlate } from "./trace-ref.mjs";
import { makeCamera, perspectiveSpec, project, solveCamera } from "./trace-camera.mjs";

/** The references (git-ignored `.tmp/ModernCarDesign` at the repo root, survives a reboot). */
export const REFS_DIR = fileURLToPath(new URL("../.tmp/ModernCarDesign", import.meta.url));
/** Output pixels per reference pixel in the iso views (the lineup crops are ~400 px), and the blank border (share of the larger side). */
const ISO_ZOOM = 2;
const PAD_SHARE = 0.12;
/** Without a stored camera: the cars brief's iso framing (radius m, pitch rad, angle rad), the game's lens, filling this share of the frame. */
const ISO_CAMERA = [6, 0.55, 0.8];
const ISO_FOV = 50;
const ISO_FILL = 0.8;
/** Wheel names: [x sign (+x the car's left), z sign (+z forward)]. */
const WHEELS = { fl: [1, 1], fr: [-1, 1], rl: [1, -1], rr: [-1, -1] };
const PICK_RGB = [255, 220, 0];
const DRAWN_RGB = [255, 0, 255];
/** The iso canvas without a reference: the headless shots' size. */
const ISO_SIZE = [1280, 800];
/** Grid images are drawn at this many output pixels per crop pixel. */
const GRID_ZOOM = 2;

export function landingFile(style) {
  return join(import.meta.dirname, "landing-views", `${style}.json`);
}

export function loadLanding(style) {
  return JSON.parse(readFileSync(landingFile(style), "utf8"));
}

function saveLanding(style, data) {
  writeFileSync(landingFile(style), `${JSON.stringify(data, null, 2)}\n`);
}

/** The picked wheel points and their car-space places on the built car (`dims`: trace-core's measure). */
function wheelPoints(dims, wheels) {
  const out = [];
  for (const [name, pick] of Object.entries(wheels ?? {})) {
    const [sx, sz] = WHEELS[name] ?? [];
    if (sx === undefined) throw new Error(`wheel ${name}: one of ${Object.keys(WHEELS).join(", ")}`);
    const hub = dims.hubs.find((h) => Math.sign(h.x) === sx && Math.sign(h.z) === sz);
    const x = sx > 0 ? dims.wheels.outerX[1] : dims.wheels.outerX[0];
    if (pick.hub) out.push({ name: `${name}.hub`, point: [x, hub.y, hub.z], pixel: pick.hub });
    if (pick.contact) out.push({ name: `${name}.contact`, point: [x, dims.wheels.ground, hub.z], pixel: pick.contact });
  }
  return out;
}

/** The iso canvas over a crop: its size, and where crop pixel (u, v) lands on it. */
function isoCanvas(ref) {
  const pad = Math.ceil(PAD_SHARE * Math.max(ref.width, ref.height));
  return { W: (ref.width + 2 * pad) * ISO_ZOOM, H: (ref.height + 2 * pad) * ISO_ZOOM, pad, at: ([u, v]) => [(u + pad) * ISO_ZOOM, (v + pad) * ISO_ZOOM] };
}

/** The brief's iso framing as a spec: the game's lens narrowed until the car's box fills ISO_FILL of the frame. */
function defaultSpec(view, W, H, box) {
  const [radius, pitch, turn] = ISO_CAMERA;
  const angle = view === "rear-iso" ? turn + Math.PI : turn;
  const lookY = (box.min.y + box.max.y) / 2;
  const target = [0, lookY, 0];
  const position = [Math.sin(angle) * radius * Math.cos(pitch), lookY + radius * Math.sin(pitch), Math.cos(angle) * radius * Math.cos(pitch)];
  const camera = makeCamera(THREE, perspectiveSpec(view, W, H, { position, target, up: [0, 1, 0], fov: ISO_FOV }));
  let reach = 0;
  for (let k = 0; k < 8; k++) {
    const p = new THREE.Vector3(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).project(camera);
    reach = Math.max(reach, Math.abs(p.x), Math.abs(p.y));
  }
  const fov = (2 * Math.atan((Math.tan((ISO_FOV * Math.PI) / 360) * reach) / ISO_FILL) * 180) / Math.PI;
  return perspectiveSpec(view, W, H, { position, target, up: [0, 1, 0], fov });
}

/** The reference's car alone: its largest silhouette (a lineup crop holds pieces of the neighbours). */
function largestOnly(layers, W, H) {
  const regions = labelRegions(layers.sil, W, H).sort((a, b) => b.n - a.n);
  const sil = new Uint8Array(W * H);
  for (const i of regions[0]?.pixels ?? []) sil[i] = 1;
  return { ...layers, sil };
}

/**
 * An iso view of the stage's car over `ref` (a crop, or null): with the entry's stored camera the reference stands at its own scale
 * and the wheels' error is measured; without one, the brief's framing and the reference scaled to the car (a rough guide).
 * `solve`: fit the camera to the picked wheels first and store it. Writes the overlay to `out` (and the reference alone on the same
 * canvas to `plateOut`, when given); returns the fit, the camera spec and the canvas pixels per crop pixel (`zoom`).
 */
export async function isoTrace(game, stage, dims, ref, view, { style, entry, solve, lift, out, plateOut }) {
  const canvas = ref === null ? { W: ISO_SIZE[0], H: ISO_SIZE[1], pad: 0, at: (p) => p } : isoCanvas(ref);
  const { W, H } = canvas;
  const port = new ViewPort(game, W, H);
  const picks = ref === null ? [] : [...wheelPoints(dims, entry?.wheels), ...landmarkPoints(entry?.landmarks, lift)];
  if (solve) saveCamera(style, view, solveFor(game, stage, port, ref, canvas, picks, view, entry.fov));
  const stored = solve ? loadLanding(style)[view].camera : entry?.camera;
  const spec = stored ? perspectiveSpec(view, W, H, stored) : defaultSpec(view, W, H, dims.box);
  const carRgba = port.draw(stage.scene, makeCamera(THREE, spec));
  const glError = port.gl.getError();
  const carSil = alphaMask(carRgba, W, H);
  const layers = ref === null ? null : stored ? nativeLayers(game, ref, canvas) : scaledLayers(game, ref, carSil, W, H);
  const wheels = stored ? pickError(spec, picks.filter((p) => !p.landmark), canvas) : null;
  const landmarks = stored ? pickError(spec, picks.filter((p) => p.landmark), canvas) : null;
  const shot = composeShot(game, W, H, layers?.plate ?? null, carRgba, { ref: layers?.sil ?? null, car: carSil });
  for (const set of [wheels, landmarks]) if (set) drawPicks(shot.ctx, set.points);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await shot.canvas.encode("png"));
  if (plateOut !== undefined && layers !== null) await writePlate(game, W, H, layers.plate, plateOut);
  const aligned = stored ? "stored camera" : ref === null ? "no reference" : "rough: no stored camera (pick wheels, then --solve)";
  return { png: out, size: `${W}x${H}`, zoom: ISO_ZOOM, aligned, iou: layers && iou(carSil, layers.sil), wheels, landmarks, shadowPx: layers?.shadowPx ?? 0, camera: spec, glError };
}

function nativeLayers(game, ref, canvas) {
  const frame = { W: canvas.W, H: canvas.H, view: "iso" };
  return largestOnly(refLayers(game, ref, frame, ISO_ZOOM, canvas.pad), canvas.W, canvas.H);
}

/** The reference's foreground box scaled to the car's drawn box (same area) and centred on it. */
function scaledLayers(game, ref, carSil, W, H) {
  const cb = maskBox(carSil, W, H);
  if (cb.u1 < 0) throw new Error("trace-car: the car is off the iso frame");
  const rb = ref.box;
  const k = Math.sqrt(((cb.u1 + 1 - cb.u0) * (cb.v1 + 1 - cb.v0)) / ((rb.u1 + 1 - rb.u0) * (rb.v1 + 1 - rb.v0)));
  const dx = (cb.u0 + cb.u1 + 1) / 2 - (k * (rb.u0 + rb.u1 + 1)) / 2;
  const dy = (cb.v0 + cb.v1 + 1) / 2 - (k * (rb.v0 + rb.v1 + 1)) / 2;
  return largestOnly(refLayers(game, ref, { W, H, view: "iso" }, 1, 0, refPlate(game, ref, W, H, dx, dy, k)), W, H);
}

/** The landmarks' car-space places on the drawn car (the body rides `lift` above the style file's frame). */
function landmarkPoints(landmarks, lift) {
  return (landmarks ?? []).map(({ name, at, pixel }) => ({ name, point: [at[0], at[1] + lift, at[2]], pixel, landmark: true }));
}

/** Each picked point against where the stored camera draws it (crop pixels), with the RMS and the largest. */
function pickError(spec, picks, canvas) {
  if (picks.length === 0) return null;
  const points = picks.map(({ name, point, pixel }) => {
    const drawn = project(spec, point);
    const picked = canvas.at(pixel);
    const drawnCrop = [round(drawn[0] / ISO_ZOOM - canvas.pad, 1), round(drawn[1] / ISO_ZOOM - canvas.pad, 1)];
    return { name, picked: pixel, drawn: drawnCrop, errPx: round(Math.hypot(drawn[0] - picked[0], drawn[1] - picked[1]) / ISO_ZOOM, 1), canvas: [round(picked[0], 1), round(picked[1], 1)], at: [picked, drawn] };
  });
  const e = points.map((p) => p.errPx);
  return { rmsPx: round(Math.sqrt(e.reduce((s, x) => s + x * x, 0) / e.length), 1), maxPx: Math.max(...e), points };
}

/** Picked points as yellow crosses, the car's as magenta rings, joined. */
function drawPicks(ctx, points) {
  ctx.lineWidth = 2;
  for (const { at: [[pu, pv], [du, dv]] } of points) {
    ctx.strokeStyle = `rgb(${PICK_RGB})`;
    ctx.beginPath();
    ctx.moveTo(pu - 6, pv);
    ctx.lineTo(pu + 6, pv);
    ctx.moveTo(pu, pv - 6);
    ctx.lineTo(pu, pv + 6);
    ctx.stroke();
    ctx.strokeStyle = `rgb(${DRAWN_RGB})`;
    ctx.beginPath();
    ctx.arc(du, dv, 5, 0, 2 * Math.PI);
    ctx.moveTo(pu, pv);
    ctx.lineTo(du, dv);
    ctx.stroke();
  }
  for (const p of points) delete p.at;
}

/** The solved camera: the fields of view whose fits tie on the wheels, settled by the silhouette. */
function solveFor(game, stage, port, ref, canvas, picks, view, fov) {
  if (picks.length < 4) throw new Error(`--solve: pick at least 4 points (2 wheels' hub and contact, or landmarks) in the ${view} entry first`);
  const layers = nativeLayers(game, ref, canvas);
  const tied = solveCamera(view, canvas.W, canvas.H, picks.map((p) => p.point), picks.map((p) => canvas.at(p.pixel)), view === "rear-iso", fov === undefined ? undefined : [fov]);
  const scored = tied.map((c) => ({ ...c, iou: iou(alphaMask(port.draw(stage.scene, makeCamera(THREE, c.spec)), canvas.W, canvas.H), layers.sil) }));
  scored.sort((a, b) => b.iou - a.iou);
  return scored[0].spec;
}

function saveCamera(style, view, spec) {
  const data = loadLanding(style);
  const r4 = (a) => a.map((x) => Number(x.toFixed(4)));
  data[view].camera = { position: r4(spec.position), target: r4(spec.target), up: r4(spec.up), fov: Number(spec.fov.toFixed(3)) };
  saveLanding(style, data);
}

/** The crop enlarged GRID_ZOOM times with a grid every 10 crop pixels (labelled every 50), for reading wheel points off. */
export async function writeGrid(game, ref, out) {
  const k = GRID_ZOOM;
  const c = game.createCanvas(ref.width * k, ref.height * k);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(ref.image, 0, 0, ref.width * k, ref.height * k);
  ctx.font = "12px sans-serif";
  const line = (p, horizontal) => {
    const major = p % 50 === 0;
    ctx.strokeStyle = horizontal ? `rgba(0,0,255,${major ? 0.8 : 0.25})` : `rgba(255,0,0,${major ? 0.8 : 0.25})`;
    ctx.beginPath();
    ctx.moveTo(horizontal ? 0 : p * k + 0.5, horizontal ? p * k + 0.5 : 0);
    ctx.lineTo(horizontal ? ref.width * k : p * k + 0.5, horizontal ? p * k + 0.5 : ref.height * k);
    ctx.stroke();
    if (!major) return;
    ctx.fillStyle = horizontal ? "blue" : "red";
    ctx.fillText(String(p), horizontal ? 2 : p * k + 2, horizontal ? p * k - 2 : 12);
  };
  for (let x = 0; x <= ref.width; x += 10) line(x, false);
  for (let y = 0; y <= ref.height; y += 10) line(y, true);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await c.encode("png"));
}
