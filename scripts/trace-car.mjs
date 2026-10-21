#!/usr/bin/env node
/**
 * One car style's drawn meshes (no engine) through headless GL, over a reference picture calibrated to metres, for matching a
 * silhouette fast: writes an overlay PNG and prints one JSON line with the silhouette and glass fit, the per-corner checklist,
 * the gap regions and the car's dimensions.
 *
 *   R=/home/aphix/github/crash-deformer-test/.tmp/ModernCarDesign/ModernCarDesigns_SideAndTop
 *   node --disable-warning=ExperimentalWarning scripts/trace-car.mjs --style sedan --view side \
 *     --ref $R/silver-sedan/silver-sedan-1.png --ref-span 3,299=4.221 [--anchor ends|wheels] [--ref-ground 95] [--ref-crop x,y,w,h] \
 *     [--omit doors,glass,bumpers,mirrors,hood,trunk,lightbar,wheels,lamps,parts] [--points '[[2.0,0.65],[1.2,0.9]]'] \
 *     [--class monster] [--zoom 4] [--stations 16] [--camera 6,0.55,0.8] [--out <png>]
 *
 * Views: `side` (camera on +x, front at the left; points are (z, y)), `top` (front at the left; (z, x)), `front` and `rear`
 * ((x, y)): orthographic, exactly axis-aligned. `iso` / `iso-rear`: the game's 50° lens at `--camera r,pitch,angle` (default
 * 6,0.55,0.8 from the front-left; `iso-rear` turns it half way round), zoomed to fill the frame, with the reference's foreground
 * scaled to the car's (same box area) and centred on it: its IoU is a rough guide only, and it takes no `--points`.
 * `--ref-span x0,x1[=m]`: two pixel columns of the reference (bumper tips with `--anchor ends`, the default, or wheel centres with
 * `--anchor wheels`) are `m` metres apart (default: the style's spec `dims` length, or wheelbase; width or track in the front and
 * rear views). A side view then stands the reference's two tyres (found from its bottom edge) either side of z = 0, as car
 * space does; other views centre the span on the spec's. `--ref-ground y`: the reference row of the ground (side/front/rear) or
 * of the centreline (top); default its foreground's bottom (middle for `top`). `--ref-crop` cuts one car out of a lineup.
 * The PNG: the reference, the car orange over it, outlines magenta (car), cyan (reference), lime (car glass), blue (reference
 * glass), a 0.5 m grid in the view's axes and `--points` (a JSON list of [h, v] pairs, or of such lists; inline or a file) yellow.
 * JSON: `iou`; `offsetCm` per edge (`top`, `bottom`, `front`, `rear`; `left`/`right` in the front and rear views): the mean
 * and the largest signed offset, positive where the car sticks out past the reference; `edges` the stations behind them as
 * [station m, car edge m, reference edge m, offset cm]; `glass` the same for the glass (side: `roofRail`, `sill`, `aPillar`,
 * `cPillar`, with `rakeDeg` [car, reference]; `refThreshold` the reference's glass score cut); `corners` (side) each named
 * corner's offset along its outward probe; `gaps` the largest `uncovered` (reference left bare) and `overhang` regions in cm²
 * with their extents; `checklist` one FAIL/ok line per corner (over 2 cm) and region (over 25 cm²); `refHubs` the reference's
 * tyres; `shadowPx` ground-shadow pixels left out; `car` the drawn car's dimensions (m, ground at the tyres' bottom; `width` and
 * `height` the body's, mirrors, wheels and light bar off). `--omit` hides parts from the drawing and the fit, not from `car`.
 * The class (`--class`, default the style's) lifts the body and scales the wheels as the game does.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import * as THREE from "three";
import { CarStage, OMIT_PARTS, VIEWS, ViewPort, alphaMask, bareFrame, beltOf, centreOnHubs, composeShot, openGame, refFrame, traceView } from "./trace-core.mjs";
import { iou, maskBox } from "./trace-metrics.mjs";
import { loadRef, refLayers, refPlate } from "./trace-ref.mjs";

/** Blank border around the reference, as a share of its larger side, so a car longer or taller than the reference is not clipped. */
const PAD_SHARE = 0.12;
/** Output pixels per reference pixel: the side/top crops are ~300 px wide, the iso pictures ~400 px. */
const ORTHO_ZOOM = 4;
const ISO_ZOOM = 2;
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
    omit: { type: "string", default: "" },
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
const omit = values.omit === "" ? [] : values.omit.split(",");
const stations = Number(values.stations);
if (!(zoom > 0)) throw new Error(`--zoom ${values.zoom}: a positive scale`);
if (crop !== undefined && (crop.length !== 4 || !crop.every((n) => n >= 0))) throw new Error(`--ref-crop ${values["ref-crop"]}: x,y,width,height in reference pixels`);
if (!omit.every((p) => OMIT_PARTS.includes(p))) throw new Error(`--omit ${values.omit}: some of ${OMIT_PARTS.join(", ")}`);
if (!Number.isInteger(stations) || stations < 2) throw new Error(`--stations ${values.stations}: a whole number, at least 2`);
if (iso && values.points !== undefined) throw new Error("--points: orthographic views only");
const out = resolve(values.out ?? join(import.meta.dirname, "../.tmp/trace-car", `${values.style}-${view}.png`));

const game = await openGame();
if (!game.CAR_STYLE_IDS.includes(values.style)) throw new Error(`--style ${values.style}: one of ${game.CAR_STYLE_IDS.join(", ")}`);
const carClass = values.class ?? game.STYLE_CLASS[values.style];
if (!game.VEHICLE_CLASS_IDS.includes(carClass)) throw new Error(`--class ${carClass}: one of ${game.VEHICLE_CLASS_IDS.join(", ")}`);
const stage = new CarStage(game);
const dims = stage.build(values.style, carClass, omit);
const ref = values.ref === undefined ? null : await loadRef(game, values.ref, crop);
const fit = iso ? await isoView() : await orthoView();
const result = { style: values.style, class: carClass, view, omit, ...fit, car: dims.car, ms: Math.round(performance.now() - t0) };
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = result.glError === 0 ? 0 : 1;

async function orthoView() {
  if (ref === null) {
    const frame = bareFrame(view, dims.box);
    return { size: `${frame.W}x${frame.H}`, ...(await traceView(game, stage, new ViewPort(game, frame.W, frame.H), frame, null, null, { out, points: values.points })) };
  }
  const pad = Math.ceil(PAD_SHARE * Math.max(ref.width, ref.height));
  const span = /^(-?[\d.]+),(-?[\d.]+)(?:=([\d.]+))?$/.exec(values["ref-span"] ?? "");
  if (span === null) throw new Error(`--ref-span x0,x1[=metres] is required with --ref: the reference's foreground spans columns ${ref.box.u0}..${ref.box.u1 + 1}, rows ${ref.box.v0}..${ref.box.v1 + 1}`);
  const spec = game.CAR_STYLES[values.style].dims;
  const metres = span[3] === undefined ? specSpan(spec) : Number(span[3]);
  const groundRow = values["ref-ground"] === undefined ? (view === "top" ? (ref.box.v0 + ref.box.v1 + 1) / 2 : ref.box.v1 + 1) : Number(values["ref-ground"]);
  let frame = refFrame(view, ref, zoom, pad, [Number(span[1]), Number(span[2])], metres, specMid(spec), groundRow);
  const layers = refLayers(game, ref, frame, zoom, pad);
  let hubs = null;
  if (view === "side") ({ frame, hubs } = centreOnHubs(frame, layers.sil));
  const marks = { hubs, belt: beltOf(frame, layers.glass) };
  const opts = { out, points: values.points, stations, rows: V_STATIONS };
  const fit = await traceView(game, stage, new ViewPort(game, frame.W, frame.H), frame, layers, marks, opts);
  return { size: `${frame.W}x${frame.H}`, pxPerM: Number(frame.ppm.toFixed(2)), refHubs: hubs, shadowPx: layers.shadowPx, ...fit };
}

/** The spec length the reference span marks when it names none (`BodyStyle.dims`). */
function specSpan({ wheelbase, overhang, track, width }) {
  const lengthwise = view === "side" || view === "top";
  if (values.anchor === "wheels") return lengthwise ? wheelbase : track;
  return lengthwise ? overhang.front + wheelbase + overhang.rear : width;
}

/** The middle (m, car space) of what the span marks: the bumper faces' midpoint lengthwise; the axles' and the sides' are 0. */
function specMid({ overhang }) {
  return values.anchor === "ends" && (view === "side" || view === "top") ? (overhang.front - overhang.rear) / 2 : 0;
}

async function isoView() {
  const pad = ref === null ? 0 : Math.ceil(PAD_SHARE * Math.max(ref.width, ref.height));
  const W = ref === null ? ISO_SIZE[0] : Math.round((ref.width + 2 * pad) * zoom);
  const H = ref === null ? ISO_SIZE[1] : Math.round((ref.height + 2 * pad) * zoom);
  const port = new ViewPort(game, W, H);
  const carRgba = port.draw(stage.scene, isoCamera(W, H));
  const glError = port.gl.getError();
  const carSil = alphaMask(carRgba, W, H);
  const layers = ref === null ? null : isoLayers(carSil, W, H);
  const shot = composeShot(game, W, H, layers?.plate ?? null, carRgba, { ref: layers?.sil ?? null, car: carSil });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await shot.canvas.encode("png"));
  return { png: out, size: `${W}x${H}`, iou: layers && iou(carSil, layers.sil), shadowPx: layers?.shadowPx ?? 0, glError };
}

function isoCamera(W, H) {
  const [radius, pitch, turn] = values.camera === undefined ? ISO_CAMERA : values.camera.split(",").map(Number);
  const angle = view === "iso-rear" && values.camera === undefined ? turn + Math.PI : turn;
  const camera = new THREE.PerspectiveCamera(ISO_FOV, W / H, 0.1, 100);
  const { min, max } = dims.box;
  const lookY = (min.y + max.y) / 2;
  camera.position.set(Math.sin(angle) * radius * Math.cos(pitch), lookY + radius * Math.sin(pitch), Math.cos(angle) * radius * Math.cos(pitch));
  camera.lookAt(0, lookY, 0);
  camera.updateMatrixWorld();
  let reach = 0;
  for (let k = 0; k < 8; k++) {
    const p = new THREE.Vector3(k & 1 ? max.x : min.x, k & 2 ? max.y : min.y, k & 4 ? max.z : min.z).project(camera);
    reach = Math.max(reach, Math.abs(p.x), Math.abs(p.y));
  }
  camera.zoom = ISO_FILL / reach;
  camera.updateProjectionMatrix();
  return camera;
}

/** The iso reference is uncalibrated: its foreground box is scaled to the car's drawn box (same area) and centred on it. */
function isoLayers(carSil, W, H) {
  const cb = maskBox(carSil, W, H);
  if (cb.u1 < 0) throw new Error("trace-car: the car is off the iso frame; widen --camera's radius");
  const rb = ref.box;
  const k = Math.sqrt(((cb.u1 + 1 - cb.u0) * (cb.v1 + 1 - cb.v0)) / ((rb.u1 + 1 - rb.u0) * (rb.v1 + 1 - rb.v0)));
  const dx = (cb.u0 + cb.u1 + 1) / 2 - (k * (rb.u0 + rb.u1 + 1)) / 2;
  const dy = (cb.v0 + cb.v1 + 1) / 2 - (k * (rb.v0 + rb.v1 + 1)) / 2;
  const frame = { W, H, view: "iso" };
  return refLayers(game, ref, frame, 1, 0, refPlate(game, ref, W, H, dx, dy, k));
}
