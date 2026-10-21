#!/usr/bin/env node
/**
 * The landing gate's eight shots of one car: for each of side, top, iso and rear-iso, the car alone ("ours": the real engine in the
 * garage at the high tier, over a white backdrop) and the car over its reference ("overlay": trace-car). Each pair goes through one
 * camera spec (trace-car `--camera-out` → headless-frame `--view-camera`), so the two line up pixel for pixel and every car is
 * framed the same way. The references, crops, picked wheels and solved iso cameras are the car's `scripts/landing-views/<car>.json`
 * (`trace-landing.mjs`).
 *
 *   CAP=4G /home/aphix/crash-wt/slot-run /home/aphix/crash-wt/capped node --disable-warning=ExperimentalWarning \
 *     scripts/landing-shots.mjs --root <tree> --car <style> [--out-dir <tree>/.tmp/shots/landing] [--views side,top,iso,rear-iso]
 *
 * Writes `<out-dir>/<car>-<view>-{ours,overlay}.png` (and each view's camera spec in `<out-dir>/camera/`) and prints one JSON line:
 * per view the overlay's IoU, the isos' wheel error (crop pixels) and how they are aligned, both PNGs and any GL error. The runs go
 * one after another inside this one process's memory cap.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const VIEWS = ["side", "top", "iso", "rear-iso"];
/** The garage settles this long (sim s) before its drawn frames: a parked car is still from the first step. */
const SETTLE_S = "1";
const FRAMES = "2";
const BACKDROP = "#ffffff";
const NODE = [process.execPath, "--disable-warning=ExperimentalWarning"];

const t0 = performance.now();
const { values } = parseArgs({
  options: {
    root: { type: "string" },
    car: { type: "string" },
    "out-dir": { type: "string" },
    views: { type: "string", default: VIEWS.join(",") },
  },
});
if (values.root === undefined || values.car === undefined) throw new Error("--root <tree> and --car <style> are required (usage in the file header)");
const root = resolve(values.root);
const car = values.car;
const views = values.views.split(",");
if (!views.every((v) => VIEWS.includes(v))) throw new Error(`--views ${values.views}: some of ${VIEWS.join(", ")}`);
const outDir = resolve(values["out-dir"] ?? join(root, ".tmp/shots/landing"));
mkdirSync(join(outDir, "camera"), { recursive: true });

const shots = {};
for (const view of views) {
  const camera = join(outDir, "camera", `${car}-${view}.json`);
  const overlay = join(outDir, `${car}-${view}-overlay.png`);
  const ours = join(outDir, `${car}-${view}-ours.png`);
  const trace = run("trace-car.mjs", ["--root", root, "--style", car, "--view", view, "--landing", "--camera-out", camera, "--out", overlay]);
  const frame = run("headless-frame.mjs", ["--root", root, "--hash", `scene=garage&car=${car}`, "--view", view, "--view-camera", camera, "--backdrop", BACKDROP, "--at", SETTLE_S, "--frames", FRAMES, "--out", ours]);
  shots[view] = { iou: trace.iou, wheels: trace.wheels ? { rmsPx: trace.wheels.rmsPx, maxPx: trace.wheels.maxPx } : null, aligned: trace.aligned ?? "orthographic", overlay, ours, glError: Math.max(trace.glError, frame.glError), linkFailures: frame.linkFailures.length };
}
process.stdout.write(`${JSON.stringify({ car, root, shots, ms: Math.round(performance.now() - t0) })}\n`);
process.exitCode = Object.values(shots).every((s) => s.glError === 0 && s.linkFailures === 0) ? 0 : 1;

/** One of this checkout's scripts on `root`'s game; its last stdout line is its JSON. */
function run(script, args) {
  const child = spawnSync(NODE[0], [...NODE.slice(1), join(import.meta.dirname, script), ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (child.status !== 0 && child.stdout.trim() === "") throw new Error(`${script} ${args.join(" ")}: exit ${child.status}\n${child.stderr}`);
  return JSON.parse(child.stdout.trim().split("\n").at(-1));
}
