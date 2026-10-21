#!/usr/bin/env node
/**
 * Fits a car style to its side and top reference pictures, close enough for a hand finish: reads the references into the style's
 * own fields (`fit-extract.mjs`), builds the car from them, then nudges the profile stations toward the reference's roof line and
 * plan for a few rounds, all in one process. Writes the table as TS to paste (`fit.ts`), before/after overlays, and one JSON line:
 * both fits (IoU, edge offsets, glass), the per-corner and gap checklist, and what it leaves to the builders and to the hand.
 *
 *   R=/home/aphix/github/crash-deformer-test/.tmp/ModernCarDesign/ModernCarDesigns_SideAndTop/silver-sedan
 *   CAP=2G /home/aphix/crash-wt/slot-run /home/aphix/crash-wt/capped node --disable-warning=ExperimentalWarning scripts/fit-car.mjs \
 *     --style sedan --side $R/silver-sedan-1.png --side-span 3,299=4.221 --top $R/silver-sedan-2.png --top-span 3,292 \
 *     [--class sedan] [--side-ground 95] [--rounds 6] [--out-dir .tmp/fit/sedan]
 *
 * `--side-span x0,x1[=m]` scales the side picture (bumper tips, or wheel centres with the metres between them; default the spec
 * length), and its two tyres set z = 0. `--top-span x0,x1[=m]` marks the top picture's nose and tail columns, which land on the
 * side picture's nose and tail. Read once: dims, the glass hardpoints, belt, underside, the door's hinge x and the bumpers' seat z
 * and plan wrap; the mirror's reach is set from one build so its tip meets the reference's. Fitted: `profile` (yBelt or yRoof from
 * the side's top edge, hw from the plan; the end stations take widths only). The style file is never written.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CABIN_MIN, archZones, at, beltUnderShoulder, extractSide, extractTop, formatTable, glassZone, holdArches, inZones, outlineOf, planOf, tableFrom } from "./fit-extract.mjs";
import { CarStage, ViewPort, alphaMask, beltOf, centreOnHubs, frameCamera, glassMask, openGame, refFrame, traceView } from "./trace-core.mjs";
import { columnEdges, compare, iou } from "./trace-metrics.mjs";
import { loadRef, refLayers } from "./trace-ref.mjs";

/** Output pixels per reference pixel, and the blank border round the reference (share of its larger side). */
const ZOOM = 4;
const PAD_SHARE = 0.12;
/** Edge stations along the length and up the height in the reports and the guard: 7 cm apart on a 4.3 m car. */
const STATIONS = 64;
const ROWS = 8;
/** Each round moves a station this share of its residual, and never more than MAX_STEP (m). */
const GAIN = 0.8;
const MAX_STEP = 0.03;
/** An end station's hat reaches this far (m) past it; a station with less sample weight (columns) than HAT_MIN_WEIGHT stays put. */
const HAT_END = 0.15;
const HAT_MIN_WEIGHT = 3;
/** Edge samples off by more than this (m) are another part (a bumper lip, a tyre), not the profile's. */
const SAMPLE_CAP = 0.15;
/** Rounds stop when two rounds gain less than this (side + top IoU). */
const MIN_GAIN = 0.002;
/** Profile limits: the narrowest station half-width (m), the least roof over the belt (m) on a greenhouse station, and how far (m) the
 * loop may move a station's hw off the reference's read: past it the drawn plan is held by another part (a liner), not the loft. */
const MIN_HW = 0.2;
const ROOF_OVER_BELT = 0.02;
const HW_RANGE = 0.05;
/** The owner's bar for a fitted view. */
const BAR = { iou: 0.95, meanCm: 2, maxCm: 5 };
/** The fit's renders: the side without the parts that stick out of the roof line; the plan as the loft alone. */
const SIDE_OMIT = ["mirrors", "lightbar"];
const PLAN_OMIT = ["doors", "glass", "bumpers", "mirrors", "lightbar", "wheels", "lamps", "parts"];
const NOT_FIT = "hood, arch, rocker, boot, rideHeight, cabinHw, bPillar, quarter, mirrors, bumper fascia and span, door hinge y/z, length and aperture";
/** A tyre's outer face stands this far (m) inside the reference's plan: a tyre seen past the body from above is a gap on the side. */
const TYRE_TUCK = 0.01;
/** The guard's tolerances: what a kept group may cost a view's IoU, the side glass IoU, and a top-view side's mean and largest |offset| (cm). */
const GUARD_TOL = { iou: 0.001, glass: 0.005, absCm: 0.2, maxCm: 1 };
/** The top view's sides are judged this far (m) inside the reference's nose and tail: the ends' curves are the front and rear edges'. */
const SIDE_TRIM = 0.3;

const t0 = performance.now();
const { values } = parseArgs({
  options: {
    style: { type: "string" },
    class: { type: "string" },
    side: { type: "string" },
    "side-span": { type: "string" },
    "side-ground": { type: "string" },
    top: { type: "string" },
    "top-span": { type: "string" },
    rounds: { type: "string", default: "6" },
    "out-dir": { type: "string" },
  },
});
const id = values.style;
const maxRounds = Number(values.rounds);
if (!Number.isInteger(maxRounds) || maxRounds < 0) throw new Error(`--rounds ${values.rounds}: a whole number`);
for (const need of ["style", "side", "side-span", "top", "top-span"]) if (values[need] === undefined) throw new Error(`--${need} is required (usage in the file header)`);
const outDir = resolve(values["out-dir"] ?? join(import.meta.dirname, "../.tmp/fit", id));

const game = await openGame();
if (!game.CAR_STYLE_IDS.includes(id)) throw new Error(`--style ${id}: one of ${game.CAR_STYLE_IDS.join(", ")}`);
const cls = values.class ?? game.STYLE_CLASS[id];
if (!game.VEHICLE_CLASS_IDS.includes(cls)) throw new Error(`--class ${cls}: one of ${game.VEHICLE_CLASS_IDS.join(", ")}`);
const base = game.CAR_STYLES[id];
const stage = new CarStage(game);
const side = await sideView();
const arches = archZones(side.hubs);
const top = await topView();
side.read = extractSide(side.frame, side.layers.sil, side.layers.glass, side.hubs, game.CLASSES[cls].lift, glassZone(top.read, base));
const start = { ...base, ...tableFrom(side.read, top.read, base, game.CLASSES[cls].wheelScale) };
const before = await evaluate(null, "before");
const fitted = fit(start);
const guarded = guardReads(fitted.table);
const table = builtDims(guarded.table);
const rounds = fitted.rounds;
const after = await evaluate(table, "after");
stage.dispose();
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "fit.ts"), `${formatTable(table)}\n`);
const summary = (v) => ({ iou: v.iou, offsetCm: v.offsetCm, glass: v.glass && { iou: v.glass.iou, offsetCm: v.glass.offsetCm, rakeDeg: v.glass.rakeDeg }, png: v.png });
const result = {
  style: id,
  class: cls,
  rounds,
  before: { side: summary(before.side), top: summary(before.top) },
  after: { side: summary(after.side), top: summary(after.top) },
  bar: { side: meetsBar(after.side), top: meetsBar(after.top) },
  checklist: { side: after.side.checklist, top: after.top.checklist },
  read: { hubs: side.hubs, glassThreshold: [side.layers.glassThreshold, top.layers.glassThreshold], sideGlass: side.read.dlo !== null, windshield: top.read.windshield !== null, rearGlass: top.read.rear !== null },
  guard: guarded.lines,
  notFit: NOT_FIT,
  table: join(outDir, "fit.ts"),
  glError: Math.max(before.side.glError, before.top.glError, after.side.glError, after.top.glError),
  ms: Math.round(performance.now() - t0),
};
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = result.glError === 0 ? 0 : 1;

function parseSpan(name, ref) {
  const m = /^(-?[\d.]+),(-?[\d.]+)(?:=([\d.]+))?$/.exec(values[name]);
  if (m === null) throw new Error(`--${name} x0,x1[=metres]: the picture's foreground spans columns ${ref.box.u0}..${ref.box.u1 + 1}`);
  return { cols: [Number(m[1]), Number(m[2])], metres: m[3] === undefined ? null : Number(m[3]) };
}

/** The side picture on a frame whose z = 0 sits midway between its tyres, its layers, and what it reads. */
async function sideView() {
  const ref = await loadRef(game, values.side);
  const pad = Math.ceil(PAD_SHARE * Math.max(ref.width, ref.height));
  const span = parseSpan("side-span", ref);
  const metres = span.metres ?? base.dims.overhang.front + base.dims.wheelbase + base.dims.overhang.rear;
  const groundRow = values["side-ground"] === undefined ? ref.box.v1 + 1 : Number(values["side-ground"]);
  const first = refFrame("side", ref, ZOOM, pad, span.cols, metres, 0, groundRow);
  const layers = refLayers(game, ref, first, ZOOM, pad);
  const { frame, hubs } = centreOnHubs(first, layers.sil);
  if (hubs === null) throw new Error(`${values.side}: no two tyres touch the picture's lowest row`);
  return { frame, layers, hubs, port: new ViewPort(game, frame.W, frame.H), read: null };
}

/** The top picture with its span's columns on the side picture's nose and tail. */
async function topView() {
  const ref = await loadRef(game, values.top);
  const pad = Math.ceil(PAD_SHARE * Math.max(ref.width, ref.height));
  const span = parseSpan("top-span", ref);
  const outline = outlineOf(side.frame, side.layers.sil);
  const [nose, tail] = [outline.at(-1)[0], outline[0][0]];
  const frame = refFrame("top", ref, ZOOM, pad, span.cols, span.metres ?? nose - tail, (nose + tail) / 2, (ref.box.v0 + ref.box.v1 + 1) / 2);
  const layers = refLayers(game, ref, frame, ZOOM, pad);
  return { frame, layers, port: new ViewPort(game, frame.W, frame.H), read: extractTop(frame, layers.sil, layers.glass, arches) };
}

/** Both views of `table` (null: the style as it stands) whole, with their overlays tagged `tag`. */
async function evaluate(tableOrNull, tag) {
  stage.build(id, cls, [], tableOrNull);
  const opts = (view) => ({ out: join(outDir, `${view}-${tag}.png`), stations: STATIONS, rows: ROWS });
  const marks = { hubs: side.hubs, belt: beltOf(side.frame, side.layers.glass) };
  return {
    side: await traceView(game, stage, side.port, side.frame, side.layers, marks, opts("side")),
    top: await traceView(game, stage, top.port, top.frame, top.layers, null, opts("top")),
  };
}

function meetsBar(v) {
  const edges = Object.values(v.offsetCm);
  return v.iou >= BAR.iou && edges.every((e) => e.mean !== null && Math.abs(e.mean) <= BAR.meanCm && Math.abs(e.max) <= BAR.maxCm);
}

/** Rounds of build, measure, step until MIN_GAIN stalls or `maxRounds`; the best round's table. */
function fit(first) {
  const rounds = [];
  let table = beltUnderShoulder({ ...first, profile: holdArches(first.profile, arches) });
  let best = { score: -Infinity, table };
  for (let r = 0; r < maxRounds; r++) {
    const m = measureRound(table);
    const score = m.side.iou + m.top.iou;
    rounds.push({ side: m.side.iou, top: m.top.iou, roofCm: m.side.offsetCm.top, planCm: [m.top.offsetCm.top, m.top.offsetCm.bottom] });
    if (score > best.score) best = { score, table };
    if (rounds.length >= 3 && score - (rounds.at(-3).side + rounds.at(-3).top) < MIN_GAIN) break;
    table = beltUnderShoulder({ ...table, profile: holdArches(step(table.profile, first.profile, m.roof, m.plan), arches) });
  }
  return { table: best.table, rounds };
}

/**
 * The fitted table laid onto the style as it stands, one group of fields at a time: a group is kept only where nothing gets worse
 * beyond GUARD_TOL (both views' IoU, each top-view side's mean and largest |offset|, and for a glass group the side view's glass
 * IoU; the body's own glass is the glass groups' to fix) and something gains (the IoUs, the sides' offsets, or the glass IoU).
 * The result is never worse than the style it started from.
 */
function guardReads(fitted) {
  let current = base;
  let score = judge(current);
  const lines = [`style: ${scoreLine(score)}`];
  for (const [name, { glass, apply }] of Object.entries(groups(fitted))) {
    const next = apply(current);
    const s = judge(next);
    const keep = notWorse(s, score, glass) && (gains(s, score) || (glass && s.glass > score.glass));
    lines.push(`${keep ? "kept" : "dropped"} ${name}: ${scoreLine(s)}`);
    if (!keep) continue;
    current = next;
    score = s;
  }
  return { table: current, lines };
}

/**
 * The fitted fields in groups, each applied onto a table: the body's side shape with its greenhouse frame (the windshield and rear
 * glass stand on the roof, so they move with it; on the style's plan), then its plan, then the rest.
 */
function groups(f) {
  const hwOf = (profile) => profile.map((s) => [s.z, s.hw]);
  const plan = (t, hw) => beltUnderShoulder({ ...t, profile: holdArches(t.profile.map((s) => ({ ...s, hw: at(hw, s.z) })), arches) });
  const take = (keys) => (t) => ({ ...t, ...Object.fromEntries(keys.map((k) => [k, f[k]])) });
  const frame = take(["windshield", "windshieldTop", "roofZ", "rearGlass"]);
  return {
    body: { glass: false, apply: (t) => plan(frame({ ...t, dims: f.dims, profile: f.profile }), hwOf(t.profile)) },
    plan: { glass: false, apply: (t) => plan(t, hwOf(f.profile)) },
    track: { glass: false, apply: tuckTyres },
    sill: { glass: true, apply: (t) => ({ ...t, belt: { ...t.belt, y: f.belt.y } }) },
    door: { glass: false, apply: take(["door"]) },
    bumpers: { glass: false, apply: take(["bumpers"]) },
    underside: { glass: false, apply: take(["underside"]) },
  };
}

/** `t` with its track set so each drawn tyre's outer face stands TYRE_TUCK inside the reference's plan over its wheel's length. */
function tuckTyres(t) {
  const { wheelbase, wheel } = t.dims;
  const half = top.read.half.filter(([z]) => Math.abs(Math.abs(z) - wheelbase / 2) <= wheel.radius);
  const tyreHalf = (wheel.width * game.CLASSES[cls].wheelScale) / 2;
  return { ...t, dims: { ...t.dims, track: 2 * (Math.min(...half.map((p) => p[1])) - tyreHalf - TYRE_TUCK) } };
}

/**
 * `t` built whole: both views' IoU, the side view's glass IoU, and the top view's two sides (mean and largest |offset|, cm) over the
 * reference's length less SIDE_TRIM at each end and the wheel-arch zones (the ends' curves are the front and rear edges', the flares
 * the arch lips').
 */
function judge(t) {
  stage.build(id, cls, [], t);
  const shot = (view) => {
    const camera = frameCamera(view.frame);
    const sil = alphaMask(view.port.draw(stage.scene, camera), view.frame.W, view.frame.H);
    return { sil, glass: glassMask(view.port, stage, camera), fit: compare(view.frame, sil, view.layers.sil, STATIONS, ROWS) };
  };
  const s = shot(side);
  const p = shot(top);
  const sideOf = (edge) => {
    const onSide = (e) => e[3] !== null && e[0] > top.read.tail + SIDE_TRIM && e[0] < top.read.nose - SIDE_TRIM && !inZones(e[0], arches);
    const d = edge.filter(onSide).map((e) => Math.abs(e[3]));
    return { abs: d.reduce((a, b) => a + b, 0) / d.length, max: Math.max(...d) };
  };
  return { side: s.fit.iou, top: p.fit.iou, sides: [sideOf(p.fit.edges.top), sideOf(p.fit.edges.bottom)], glass: iou(s.glass, side.layers.glass) };
}

function notWorse(a, b, glass) {
  const iouOk = a.side >= b.side - GUARD_TOL.iou && a.top >= b.top - GUARD_TOL.iou && (!glass || a.glass >= b.glass - GUARD_TOL.glass);
  return iouOk && a.sides.every((s, k) => s.abs <= b.sides[k].abs + GUARD_TOL.absCm && s.max <= b.sides[k].max + GUARD_TOL.maxCm);
}

function gains(a, b) {
  const sum = (x) => x.sides[0].abs + x.sides[1].abs;
  return a.side + a.top > b.side + b.top || sum(a) < sum(b);
}

function scoreLine(s) {
  const side = (x) => `${x.abs.toFixed(1)}/${x.max.toFixed(1)}`;
  return `side ${s.side} top ${s.top} plan sides |cm| mean/max ${side(s.sides[0])} ${side(s.sides[1])} glass ${s.glass}`;
}

/** `t` with the dims the built car measures (overhangs, width, height): the tables are held to their dims within 5 mm. */
function builtDims(t) {
  const { car } = stage.build(id, cls, [], t);
  const lift = game.CLASSES[cls].lift;
  return { ...t, dims: { ...t.dims, overhang: { front: car.overhangFront, rear: car.overhangRear }, width: car.width, height: car.height - lift } };
}

/** One round's fit renders and residuals: the side's top edge (m, car minus reference, per column) and the plan half-width. */
function measureRound(table) {
  stage.build(id, cls, SIDE_OMIT, table);
  const sideSil = alphaMask(side.port.draw(stage.scene, frameCamera(side.frame)), side.frame.W, side.frame.H);
  stage.show(PLAN_OMIT);
  const topSil = alphaMask(top.port.draw(stage.scene, frameCamera(top.frame)), top.frame.W, top.frame.H);
  const { W, H } = side.frame;
  const carTop = columnEdges(sideSil, W, H).top;
  const refTop = columnEdges(side.layers.sil, W, H).top;
  const roof = [];
  for (let u = 0; u < W; u++) {
    if (carTop[u] < 0 || refTop[u] < 0) continue;
    const d = side.frame.g(carTop[u]) - side.frame.g(refTop[u]);
    if (Math.abs(d) < SAMPLE_CAP) roof.push([side.frame.h(u + 0.5), d]);
  }
  const half = top.read.half;
  const plan = planOf(top.frame, topSil, arches)
    .filter(([z]) => z > half[0][0] && z < half.at(-1)[0] && !inZones(z, arches))
    .map(([z, hw]) => [z, hw - at(half, z)])
    .filter(([, d]) => Math.abs(d) < SAMPLE_CAP);
  return { side: compare(side.frame, sideSil, side.layers.sil, STATIONS, ROWS), top: compare(top.frame, topSil, top.layers.sil, STATIONS, ROWS), roof, plan };
}

/** Each station moved by its hat-weighted residuals: hw by the plan's (within HW_RANGE of `read`'s); yBelt or yRoof by the roof line's. */
function step(profile, read, roof, plan) {
  const move = (v) => Math.max(-MAX_STEP, Math.min(MAX_STEP, GAIN * v));
  return profile.map((s, i) => {
    const hw = Math.min(read[i].hw + HW_RANGE, Math.max(read[i].hw - HW_RANGE, s.hw - move(hat(profile, i, plan))));
    const out = { ...s, hw: Math.max(MIN_HW, hw) };
    if (i === 0 || i === profile.length - 1) return out;
    const dy = move(hat(profile, i, roof));
    if (s.cabin === 0) return { ...out, yBelt: s.yBelt - dy, yRoof: s.yBelt - dy };
    return { ...out, yRoof: Math.max(s.yRoof - dy / Math.max(s.cabin, CABIN_MIN), s.yBelt + ROOF_OVER_BELT) };
  });
}

/** Station i's residual: the samples between its neighbours, weighted by a hat peaking at the station. */
function hat(profile, i, samples) {
  const z = profile[i].z;
  const lo = i > 0 ? profile[i - 1].z : z - HAT_END;
  const hi = i < profile.length - 1 ? profile[i + 1].z : z + HAT_END;
  let w = 0;
  let r = 0;
  for (const [sz, d] of samples) {
    if (sz <= lo || sz >= hi) continue;
    const k = sz < z ? (sz - lo) / (z - lo) : (hi - sz) / (hi - z);
    w += k;
    r += k * d;
  }
  return w >= HAT_MIN_WEIGHT ? r / w : 0;
}
