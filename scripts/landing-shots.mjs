#!/usr/bin/env node
/**
 * The landing gate's shots of one car: for each of side, top, iso and rear-iso, the car alone ("ours": the real engine in the garage
 * at the high tier, over a white backdrop), the car over its reference ("overlay": trace-car) and the two side by side ("pair":
 * the reference alone left, ours right). All three go through one camera spec (trace-car `--camera-out` → headless-frame
 * `--view-camera`) on one canvas at one pixel scale, so they line up pixel for pixel and every car is framed the same way; a pair is
 * never cropped or scaled per half. The references, crops, picked wheels and solved iso cameras are the car's
 * `scripts/landing-views/<car>.json` (`trace-landing.mjs`).
 *
 *   CAP=4G /home/aphix/crash-wt/slot-run /home/aphix/crash-wt/capped node --disable-warning=ExperimentalWarning \
 *     scripts/landing-shots.mjs --root <tree> --car <style> [--paint] [--out-dir <tree>/.tmp/shots/landing] [--views side,top,iso,rear-iso]
 *
 * `--paint` paints the car its reference's colour (the landing file's `paint`; a livery stays) in both shots, so they compare like
 * for like; without it "ours" wears the garage paint and the overlay the trace orange.
 * Registration: each pair marks the reference's wheels (yellow crosses: the isos' picked hubs and contacts, the side picture's own
 * tyre contacts) and where the engine drew ours (magenta rings), on both halves. A wheel further apart than REGISTRATION_PX reference
 * pixels, or a pair with nothing to register by (an iso without picks, a side picture whose tyres were not found), fails: a red
 * label and a nonzero exit. The top view shows no wheels; it is framed by the side picture's ends and is not registered.
 * Writes `<out-dir>/<car>-<view>-{ours,overlay,pair}.png` (each view's camera spec and reference plate in `<out-dir>/camera/`) and
 * prints one JSON line: per view the overlay's IoU, the isos' wheel error, the registration and the PNGs. The runs go one after
 * another inside this one process's memory cap.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const VIEWS = ["side", "top", "iso", "rear-iso"];
/** The garage settles this long (sim s) before its drawn frames: a parked car is still from the first step. */
const SETTLE_S = "1";
const FRAMES = "2";
const BACKDROP = "#ffffff";
const NODE = [process.execPath, "--disable-warning=ExperimentalWarning"];
/** A pair whose wheels land further apart than this (reference pixels) shows different cameras or a different car: it fails. */
const REGISTRATION_PX = 5;
/** The pair's label bar (px) and the gap between its halves (px). */
const LABEL_H = 34;
const GAP = 8;

const t0 = performance.now();
const { values } = parseArgs({
  options: {
    root: { type: "string" },
    car: { type: "string" },
    "out-dir": { type: "string" },
    views: { type: "string", default: VIEWS.join(",") },
    paint: { type: "boolean", default: false },
  },
});
if (values.root === undefined || values.car === undefined) throw new Error("--root <tree> and --car <style> are required (usage in the file header)");
const root = resolve(values.root);
const car = values.car;
const views = values.views.split(",");
if (!views.every((v) => VIEWS.includes(v))) throw new Error(`--views ${values.views}: some of ${VIEWS.join(", ")}`);
const outDir = resolve(values["out-dir"] ?? join(root, ".tmp/shots/landing"));
mkdirSync(join(outDir, "camera"), { recursive: true });
// The garage boots a car-menu id: a class (`muscle` for the coupe body, `truck` for the pickup), or a style the classes don't name.
const { DRIVER_CARS } = await import(pathToFileURL(join(root, "src/game/match/types.ts")).href);
const menuId = DRIVER_CARS.find((d) => d.style === car)?.id;
if (menuId === undefined) throw new Error(`--car ${car}: no car-menu entry draws that style (styles: ${DRIVER_CARS.map((d) => d.style).join(", ")})`);
const paint = values.paint ? (JSON.parse(readFileSync(join(import.meta.dirname, "landing-views", `${car}.json`), "utf8")).paint ?? null) : null;

const shots = {};
for (const view of views) {
  const camera = join(outDir, "camera", `${car}-${view}.json`);
  const plate = join(outDir, "camera", `${car}-${view}-plate.png`);
  const overlay = join(outDir, `${car}-${view}-overlay.png`);
  const ours = join(outDir, `${car}-${view}-ours.png`);
  const pair = join(outDir, `${car}-${view}-pair.png`);
  const painted = paint === null ? [] : ["--paint", paint];
  const trace = run("trace-car.mjs", ["--root", root, "--style", car, "--view", view, "--landing", "--camera-out", camera, "--plate-out", plate, "--out", overlay, ...painted]);
  const frame = run("headless-frame.mjs", ["--root", root, "--hash", `scene=garage&car=${menuId}`, "--view", view, "--view-camera", camera, "--backdrop", BACKDROP, "--at", SETTLE_S, "--frames", FRAMES, "--out", ours, ...painted]);
  const marks = registration(view, trace, frame.wheelsPx);
  await writePair(pair, plate, ours, marks, `${car} ${view}: one camera (${trace.aligned ?? "orthographic"}), one ${trace.size} canvas`);
  const error = (set) => (set ? { rmsPx: set.rmsPx, maxPx: set.maxPx } : null);
  shots[view] = {
    iou: trace.iou,
    wheels: error(trace.wheels),
    landmarks: error(trace.landmarks),
    aligned: trace.aligned ?? "orthographic",
    registration: { ok: marks.ok, maxRefPx: marks.maxRefPx, note: marks.note },
    overlay,
    ours,
    pair,
    glError: Math.max(trace.glError, frame.glError),
    linkFailures: frame.linkFailures.length,
  };
}
process.stdout.write(`${JSON.stringify({ car, root, shots, ms: Math.round(performance.now() - t0) })}\n`);
process.exitCode = Object.values(shots).every((s) => s.glError === 0 && s.linkFailures === 0 && s.registration.ok) ? 0 : 1;

/** One of this checkout's scripts on `root`'s game; its last stdout line is its JSON. */
function run(script, args) {
  const child = spawnSync(NODE[0], [...NODE.slice(1), join(import.meta.dirname, script), ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (child.status !== 0 && child.stdout.trim() === "") throw new Error(`${script} ${args.join(" ")}: exit ${child.status}\n${child.stderr}`);
  return JSON.parse(child.stdout.trim().split("\n").at(-1));
}

/**
 * The view's wheel marks on the shared canvas, the reference's (`ref`) beside where the engine drew ours (`ours`, headless-frame's
 * `wheelsPx`), and whether they register: the largest distance in reference pixels (canvas pixels over trace-car's `zoom`).
 */
function registration(view, trace, wheelsPx) {
  if (view === "top") return { ok: true, maxRefPx: null, note: "top: framed on the side picture's ends; no wheels to register", pairs: [] };
  const pairs = [];
  if (view === "side") {
    for (const [end, wheel] of [["front", "fl"], ["rear", "rl"]]) {
      const ref = trace.refContactsPx?.[end];
      const ours = wheelsPx?.[wheel]?.contact;
      if (ref && ours) pairs.push({ name: `${end} contact`, ref, ours });
    }
  } else {
    for (const point of trace.wheels?.points ?? []) {
      const [wheel, part] = point.name.split(".");
      const ours = wheelsPx?.[wheel]?.[part];
      if (ours) pairs.push({ name: point.name, ref: point.canvas, ours });
    }
  }
  if (pairs.length === 0) return { ok: false, maxRefPx: null, note: `${view}: nothing to register by (no picked wheels, or the reference's tyres were not found)`, pairs };
  const dist = (p) => Math.hypot(p.ref[0] - p.ours[0], p.ref[1] - p.ours[1]) / trace.zoom;
  const maxRefPx = Number(Math.max(...pairs.map(dist)).toFixed(1));
  const ok = maxRefPx <= REGISTRATION_PX;
  return { ok, maxRefPx, note: `wheels within ${maxRefPx} ref px (${(maxRefPx * trace.zoom).toFixed(1)} shot px) of the reference's: ${ok ? "registered" : `FAIL, over ${REGISTRATION_PX}`}`, pairs };
}

/** The reference plate left, ours right, both whole at their shared size, the wheel marks on both halves, under a label bar. */
async function writePair(out, platePng, oursPng, marks, title) {
  const [left, right] = await Promise.all([loadImage(readFileSync(platePng)), loadImage(readFileSync(oursPng))]);
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(`${out}: the reference plate is ${left.width}x${left.height} and ours ${right.width}x${right.height}; one camera spec gives one size`);
  }
  const { width: W, height: H } = left;
  const canvas = createCanvas(2 * W + GAP, H + LABEL_H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = marks.ok ? "#1f6f3a" : "#b01616";
  ctx.fillRect(0, 0, canvas.width, LABEL_H);
  ctx.fillStyle = "#ffffff";
  ctx.font = "15px sans-serif";
  ctx.fillText(`${title}. ${marks.note}`, 8, 22);
  ctx.drawImage(left, 0, LABEL_H);
  ctx.drawImage(right, W + GAP, LABEL_H);
  ctx.lineWidth = 2;
  for (const dx of [0, W + GAP]) {
    for (const { ref, ours } of marks.pairs) {
      const [ru, rv] = [ref[0] + dx, ref[1] + LABEL_H];
      ctx.strokeStyle = "rgb(255,200,0)";
      ctx.beginPath();
      ctx.moveTo(ru - 7, rv);
      ctx.lineTo(ru + 7, rv);
      ctx.moveTo(ru, rv - 7);
      ctx.lineTo(ru, rv + 7);
      ctx.stroke();
      ctx.strokeStyle = "rgb(255,0,255)";
      ctx.beginPath();
      ctx.arc(ours[0] + dx, ours[1] + LABEL_H, 6, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }
  writeFileSync(out, await canvas.encode("png"));
}
