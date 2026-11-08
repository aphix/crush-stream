#!/usr/bin/env node
/**
 * Per course, what the scenery service adds: prop counts, draw groups, place ms and the road distance of the drawn plants and rocks.
 *   node --disable-warning=ExperimentalWarning scripts/scenery-census.mjs [--courses oval,rally] [--reps 3]
 */
import { parseArgs } from "node:util";
import { PREFAB } from "../src/game/world/constants.ts";
import { lastDressing, placeCourse } from "../src/game/world/placements.ts";
import { addedDrawGroups, drawGroupOf } from "../src/game/world/scenery.ts";
import { COURSE_JSON, centreDistance } from "../src/game/world/scenery.test-util.ts";
import { parseTrack } from "../src/game/world/track-schema.ts";
import { Track } from "../src/game/world/track.ts";

const { values } = parseArgs({ options: { courses: { type: "string" }, reps: { type: "string", default: "3" } } });
const wanted = values.courses?.split(",");
const BANDS = [20, 70, 150, 300, Infinity];
const PLANTS = new Set([PREFAB.tree, PREFAB.rock, PREFAB.palm, PREFAB.bush, PREFAB.flowers]);

const tally = (list) => {
  const out = {};
  for (const p of list) out[p.prefab] = (out[p.prefab] ?? 0) + 1;
  return out;
};

/** FNV-1a over every solid prop's kind, spot and size: equal before and after a change that must not move the sim. */
const digest = (list) => {
  let h = 0x811c9dc5;
  for (const p of list) for (const ch of `${p.prefab}@${p.x.toFixed(4)},${p.z.toFixed(4)},${p.yaw.toFixed(4)},${p.sx.toFixed(4)},${p.sy.toFixed(4)},${p.sz.toFixed(4)};`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return (h >>> 0).toString(16);
};

for (const json of COURSE_JSON) {
  const parsed = parseTrack(json);
  if (wanted !== undefined && !wanted.includes(parsed.id)) continue;
  const runs = [];
  let track;
  let course;
  for (let n = 0; n < Number(values.reps); n++) {
    track = new Track(json);
    course = placeCourse(track);
    runs.push(lastDressing.placeMs);
  }
  const authored = lastDressing.authored;
  const solid = course.placed.slice(authored);
  const bands = BANDS.map(() => 0);
  for (const p of course.drawn) {
    if (!PLANTS.has(p.prefab)) continue;
    const d = centreDistance(track, p.x, p.z);
    bands[BANDS.findIndex((edge) => d < edge)]++;
  }
  console.log(JSON.stringify({
    course: parsed.id,
    solid: solid.length,
    solidDigest: digest(solid),
    drawn: course.drawn.length,
    drawnByPrefab: tally(course.drawn),
    solidByPrefab: tally(solid),
    drawGroupsAdded: addedDrawGroups(course.placed.slice(0, authored), solid, course.drawn),
    drawGroupsDrawn: new Set(course.drawn.map(drawGroupOf)).size,
    placeMsFirst: Math.round(runs[0]),
    placeMsMin: Math.round(Math.min(...runs)),
    plantsByRoadDistance: Object.fromEntries(BANDS.map((edge, i) => [`<${edge}`, bands[i]])),
  }));
}
