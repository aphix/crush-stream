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
 *     [--class monster] [--zoom 4] [--stations 16] [--root <checkout>] [--camera-out <json>] [--out <png>]
 *   node ... scripts/trace-car.mjs --style sedan --view iso --landing [--solve] [--grid <png>]
 *
 * Views: `side` (camera on +x, front at the left; points are (z, y)), `top` (front at the left; (z, x)), `front` and `rear`
 * ((x, y)): orthographic, exactly axis-aligned. `iso` / `rear-iso`: perspective, framed by the car's stored landing camera
 * (`trace-landing.mjs`: solved from wheel points picked on the reference crop, so the wheels line up and their error is printed),
 * or without one the brief's framing with the reference scaled to the car (a rough guide). `--landing` takes the view's reference
 * (and crop) from `scripts/landing-views/<style>.json`, and for side and top the span from the reference's own ends (the spec
 * length). `--solve` fits that iso camera to the picked wheels and stores it; `--grid <png>` writes the crop with a pixel grid
 * to pick them on. `--camera-out` writes the view's camera spec (`trace-camera.mjs`), which headless-frame's landing shots take.
 * `--ref-span x0,x1[=m]`: two pixel columns of the reference (bumper tips with `--anchor ends`, the default, or wheel centres with
 * `--anchor wheels`) are `m` metres apart (default: the style's spec `dims` length, or wheelbase; width or track in the front and
 * rear views). A side view then stands the reference's two tyres (found from its bottom edge) either side of z = 0, as car
 * space does; other views centre the span on the spec's. `--ref-ground y`: the reference row of the ground (side/front/rear) or
 * of the centreline (top); default its foreground's bottom (middle for `top`). `--ref-crop` cuts one car out of a lineup.
 * The PNG: the reference, the car orange over it, outlines magenta (car), cyan (reference), lime (car glass), blue (reference
 * glass), a 0.5 m grid in the view's axes and `--points` (a JSON list of [h, v] pairs, or of such lists; inline or a file) yellow;
 * in the isos the picked wheel points yellow and the car's magenta.
 * JSON: `iou`; `offsetCm` per edge (`top`, `bottom`, `front`, `rear`; `left`/`right` in the front and rear views): the mean
 * signed offset, the mean |offset| (`abs`) and the largest, positive where the car sticks out past the reference; `edges` the
 * stations behind them as [station m, car edge m, reference edge m, offset cm]; `glass` the same for the glass (side:
 * `roofRail`, `sill`, `aPillar`, `cPillar`, with `rakeDeg` [car, reference]); `corners` (side) each named corner's offset along
 * its outward probe; `gaps` the largest `uncovered` and `overhang` regions in cm²; `checklist` one FAIL/ok line per corner (over
 * 2 cm) and region (over 25 cm²); isos: `wheels` (each picked point's error in crop pixels, RMS and largest); `car` the drawn car's
 * dimensions (m, ground at the tyres' bottom; `width` and `height` the body's). `--omit` hides parts from the drawing and the fit.
 * The class (`--class`, default the style's) lifts the body and scales the wheels as the game does.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CarStage, OMIT_PARTS, VIEWS, ViewPort, bareFrame, beltOf, centreOnHubs, openGame, refFrame, traceView } from "./trace-core.mjs";
import { orthoSpec } from "./trace-camera.mjs";
import { REFS_DIR, isoTrace, loadLanding, writeGrid } from "./trace-landing.mjs";
import { loadRef, refLayers } from "./trace-ref.mjs";

/** Blank border around the reference, as a share of its larger side, so a car longer or taller than the reference is not clipped. */
const PAD_SHARE = 0.12;
/** Output pixels per reference pixel: the side/top crops are ~300 px wide. */
const ORTHO_ZOOM = 4;
/** Edge stations up the height (front and rear edges). */
const V_STATIONS = 8;
const ISO_VIEWS = ["iso", "rear-iso"];

const t0 = performance.now();
const { values } = parseArgs({
  options: {
    style: { type: "string", default: "sedan" },
    class: { type: "string" },
    view: { type: "string", default: "side" },
    root: { type: "string" },
    landing: { type: "boolean", default: false },
    solve: { type: "boolean", default: false },
    grid: { type: "string" },
    ref: { type: "string" },
    "ref-crop": { type: "string" },
    "ref-span": { type: "string" },
    "ref-ground": { type: "string" },
    anchor: { type: "string", default: "ends" },
    omit: { type: "string", default: "" },
    points: { type: "string" },
    zoom: { type: "string" },
    stations: { type: "string", default: "16" },
    "camera-out": { type: "string" },
    out: { type: "string" },
  },
});
const view = values.view;
const iso = ISO_VIEWS.includes(view);
if (!iso && !(view in VIEWS)) throw new Error(`--view ${view}: one of ${[...Object.keys(VIEWS), ...ISO_VIEWS].join(", ")}`);
if (values.anchor !== "ends" && values.anchor !== "wheels") throw new Error(`--anchor ${values.anchor}: ends or wheels`);
const zoom = Number(values.zoom ?? ORTHO_ZOOM);
const omit = values.omit === "" ? [] : values.omit.split(",");
const stations = Number(values.stations);
if (!(zoom > 0)) throw new Error(`--zoom ${values.zoom}: a positive scale`);
if (!omit.every((p) => OMIT_PARTS.includes(p))) throw new Error(`--omit ${values.omit}: some of ${OMIT_PARTS.join(", ")}`);
if (!Number.isInteger(stations) || stations < 2) throw new Error(`--stations ${values.stations}: a whole number, at least 2`);
if (iso && values.points !== undefined) throw new Error("--points: orthographic views only");
if ((values.solve || values.grid !== undefined) && !(iso && values.landing)) throw new Error("--solve and --grid: an iso view with --landing");
const out = resolve(values.out ?? join(import.meta.dirname, "../.tmp/trace-car", `${values.style}-${view}.png`));

const game = await openGame(values.root === undefined ? undefined : resolve(values.root));
if (!game.CAR_STYLE_IDS.includes(values.style)) throw new Error(`--style ${values.style}: one of ${game.CAR_STYLE_IDS.join(", ")}`);
const carClass = values.class ?? game.STYLE_CLASS[values.style];
if (!game.VEHICLE_CLASS_IDS.includes(carClass)) throw new Error(`--class ${carClass}: one of ${game.VEHICLE_CLASS_IDS.join(", ")}`);
const entry = values.landing ? landingEntry() : null;
const refFile = entry?.ref === undefined ? values.ref : join(REFS_DIR, entry.ref);
const crop = entry?.crop ?? values["ref-crop"]?.split(",").map(Number);
if (crop !== undefined && (crop.length !== 4 || !crop.every((n) => n >= 0))) throw new Error(`--ref-crop ${crop}: x,y,width,height in reference pixels`);
const ref = refFile === undefined ? null : await loadRef(game, refFile, crop);
if (values.grid !== undefined) await writeGrid(game, ref, resolve(values.grid));
const stage = new CarStage(game);
const dims = stage.build(values.style, carClass, omit);
const fit = iso ? await isoTrace(game, stage, dims, ref, view, { style: values.style, entry, solve: values.solve, out }) : await orthoView();
if (values["camera-out"] !== undefined) {
  mkdirSync(dirname(resolve(values["camera-out"])), { recursive: true });
  writeFileSync(resolve(values["camera-out"]), `${JSON.stringify(fit.camera)}\n`);
}
const result = { style: values.style, class: carClass, view, omit, ref: refFile ?? null, ...fit, car: dims.car, ms: Math.round(performance.now() - t0) };
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = result.glError === 0 ? 0 : 1;

function landingEntry() {
  const found = loadLanding(values.style)[view];
  if (found === undefined) throw new Error(`--landing: scripts/landing-views/${values.style}.json has no "${view}" entry`);
  return found;
}

async function orthoView() {
  if (ref === null) {
    const frame = bareFrame(view, dims.box);
    const fit = await traceView(game, stage, new ViewPort(game, frame.W, frame.H), frame, null, null, { out, points: values.points });
    return { size: `${frame.W}x${frame.H}`, ...fit, camera: orthoSpec(frame, VIEWS[view]) };
  }
  const pad = Math.ceil(PAD_SHARE * Math.max(ref.width, ref.height));
  const spec = game.CAR_STYLES[values.style].dims;
  const span = values.landing ? [String(ref.box.u0), String(ref.box.u1 + 1)] : /^(-?[\d.]+),(-?[\d.]+)(?:=([\d.]+))?$/.exec(values["ref-span"] ?? "")?.slice(1);
  if (span === undefined) throw new Error(`--ref-span x0,x1[=metres] is required with --ref: the reference's foreground spans columns ${ref.box.u0}..${ref.box.u1 + 1}, rows ${ref.box.v0}..${ref.box.v1 + 1}`);
  const metres = span[2] === undefined ? specSpan(spec) : Number(span[2]);
  const groundRow = values["ref-ground"] === undefined ? (view === "top" ? (ref.box.v0 + ref.box.v1 + 1) / 2 : ref.box.v1 + 1) : Number(values["ref-ground"]);
  let frame = refFrame(view, ref, zoom, pad, [Number(span[0]), Number(span[1])], metres, specMid(spec), groundRow);
  const layers = refLayers(game, ref, frame, zoom, pad);
  let hubs = null;
  if (view === "side") ({ frame, hubs } = centreOnHubs(frame, layers.sil));
  const marks = { hubs, belt: beltOf(frame, layers.glass) };
  const opts = { out, points: values.points, stations, rows: V_STATIONS };
  const fit = await traceView(game, stage, new ViewPort(game, frame.W, frame.H), frame, layers, marks, opts);
  return { size: `${frame.W}x${frame.H}`, pxPerM: Number(frame.ppm.toFixed(2)), refHubs: hubs, shadowPx: layers.shadowPx, ...fit, camera: orthoSpec(frame, VIEWS[view]) };
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
