#!/usr/bin/env node
/**
 * Whole-course shots of every race course in `TRACKS`, from the engine's own frame in node (`headless-frame.mjs`): per course a north-up
 * overhead and an oblique, at day and night, written as `<course>-{top,oblique}-{day,night}.png` in `--out`. The eye is the free eye
 * about the middle of the course's `Track.bounds` (pitch 1.5, angle 3.14159: north up on every course; the oblique is pitch 0.9 from
 * the same side), as far back as the engine's 50 degree lens needs for the whole box to fit; `--no-fog` drops the haze, reaches the far
 * plane past the course's far corner (the Mall needs 2.4 km) and lifts the near plane with the eye's height. One headless-frame process
 * at a time (about a minute each); a link failure or GL error in any shot is listed and exits 1.
 *
 *   node --disable-warning=ExperimentalWarning scripts/course-shots.mjs [--out screenshots/course-shots] [--courses oval,city] [--size 1024x1024]
 *
 * On the shared box run it whole under the heavy-run wrappers (`flock -x ab.lock slot-run capped`, DISPLAY=:0 on WSLg).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { TRACKS } from "../src/game/world/tracks/index.ts";
import { Track } from "../src/game/world/track.ts";

/** The engine's vertical lens (deg): `CrashEngine`'s PerspectiveCamera. */
const FOV_DEG = 50;
/** Spare view round the course, as a multiple of what just fits. */
const FIT = 1.06;
/** North up: as steeply down as the free eye turns (its pitch limit, 1.5 rad; a steeper aim is clamped and slides the view off the middle), the eye on the south side. */
const NORTH_UP = { pitch: 1.5, angle: 3.14159 };
const SHOTS = { top: NORTH_UP.pitch, oblique: 0.9 };
const TIMES = { day: "daytime", night: "nighttime" };

const { values } = parseArgs({ options: { out: { type: "string", default: "screenshots/course-shots" }, courses: { type: "string" }, size: { type: "string", default: "1024x1024" } } });
const size = /^(\d+)x(\d+)$/.exec(values.size);
if (size === null) throw new Error(`--size ${values.size}: width x height, e.g. 1024x1024`);
const aspect = Number(size[1]) / Number(size[2]);
const out = resolve(values.out);
const wanted = values.courses?.split(",");
const tracks = TRACKS.map((json) => new Track(json));
for (const id of wanted ?? []) if (!tracks.some((t) => t.id === id)) throw new Error(`--courses ${id}: one of ${tracks.map((t) => t.id).join(", ")}`);
mkdirSync(out, { recursive: true });

/** What just fits the lens's half-view (tan) with `FIT` to spare. */
const FIT_TAN = Math.tan((FOV_DEG * Math.PI) / 360) / FIT;
/** The eye's distance (m) from the course's middle at `pitch`: the course's near edge (the side the eye is on) fits the view's height, and its near corners fit its width. */
function radiusFor(pitch, halfX, halfZ) {
  const nearEdge = halfZ * Math.cos(pitch);
  return Math.max(halfZ * Math.sin(pitch) / FIT_TAN + nearEdge, halfX / (FIT_TAN * aspect) + nearEdge);
}

const failures = [];
for (const track of tracks) {
  if (wanted !== undefined && !wanted.includes(track.id)) continue;
  const { minX, maxX, minZ, maxZ } = track.bounds;
  for (const [shot, pitch] of Object.entries(SHOTS)) {
    const radius = radiusFor(pitch, (maxX - minX) / 2, (maxZ - minZ) / 2);
    for (const [time, tod] of Object.entries(TIMES)) {
      const png = join(out, `${track.id}-${shot}-${time}.png`);
      const run = spawnSync(process.execPath, [
        "--disable-warning=ExperimentalWarning", join(import.meta.dirname, "headless-frame.mjs"),
        "--tier", "high", "--draw", "max", "--size", values.size, "--frames", "3", "--free", "--no-fog",
        "--hash", `scene=race&track=${track.id}&tod=${tod}`,
        "--camera", [radius.toFixed(1), pitch, NORTH_UP.angle, ((minX + maxX) / 2).toFixed(1), 0, ((minZ + maxZ) / 2).toFixed(1)].join(","),
        "--out", png,
      ], { encoding: "utf8", maxBuffer: 1 << 24 });
      const line = run.stdout.trim().split("\n").at(-1);
      if (!line?.startsWith("{")) throw new Error(`${png}: headless-frame exit ${run.status}, no result line: ${run.stderr.trim().split("\n").at(-1)}`);
      const r = JSON.parse(line);
      const bad = r.linkFailures.length > 0 || r.glError !== 0;
      if (bad) failures.push(png);
      console.log(`${png}  textures ${r.textures}, far ${r.far} m, link failures ${r.linkFailures.length}, GL error ${r.glError}`);
    }
  }
}
if (failures.length > 0) {
  console.error(`course-shots: ${failures.length} shot(s) with a link failure or GL error:\n${failures.join("\n")}`);
  process.exitCode = 1;
}
