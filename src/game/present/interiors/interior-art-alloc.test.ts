import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createCrowdPoses } from "../../ai/civilians/crowd-poses.ts";
import { allocatedBytes, COMPILE_WAIT_S, untilQuiet, type Within } from "../../kernel/alloc-sample.test-util.ts";
import { FRAME_HZ } from "../../kernel/constants.ts";
import { layOutLots } from "../../world/openworld/openworld-lots.ts";
import { buildOpenWorldMap } from "../../world/openworld/openworld-map.ts";
import type { InteriorKind, Place } from "../../world/openworld/walk-graph.ts";
import { SIGHT_ID_CAPACITY, SightField } from "../openworld-sight.ts";
import { InteriorSet } from "./interior-art.ts";

const map = buildOpenWorldMap(layOutLots());
/** The kinds of place along the street, in turn: four businesses and a house, so shopfronts and doors both build. */
const KINDS: readonly InteriorKind[] = ["coffee", "bar", "store", "office", "rowhome"];
/** Places along the street, a lot's width or so apart (m): about two blocks' frontage, so the eye passes tens of builds and drops. */
const PLACES = 40;
const PITCH_M = 8;
/** The eye drives along the street this fast (m a frame) and this far (m) off its doors. */
const SPEED = 0.25;
const OFFSET_M = 12;
const FRAME = 1 / FRAME_HZ;
/** Passes along the street before the first read, so every packed mesh has grown to what the busiest stretch needs. */
const WARM_PASSES = 2;
/** What one build of a room (an envelope or its furnishing) may allocate on the heap (bytes): the pieces it is made of and the packing of them, none of it kept; a drop allocates next to nothing. */
const BOUND_BYTES_PER_BUILD = 1.25e6;
/** Frames before the quiet read: past most of V8's tier-up (cold code runs in the interpreter, where every double is boxed). */
const WARM_FRAMES = 6000;
const WINDOW_FRAMES = 2000;
/** A frame in which nothing builds, drops or swings may allocate this much (bytes): the six doubles a sight query of a shop's front or an open door takes are boxed anew at each call (about 100 B a query, a handful a frame), and nothing else is. */
const BOUND_BYTES_QUIET_FRAME = 1024;
/** Where the eye stands for the quiet read (m along the street): no place's door is anywhere near the near or far radius of it, so nothing flips between built and dropped. */
const QUIET_AT = 20;
/** What the reads count: what is allocated under the set's own update, not the drive's sight field or its counting. */
const WITHIN_SET: Within = { fn: "update", file: "interior-art.ts" };

const base = (kind: InteriorKind): Place => map.places.find((place) => place.interior === kind && place.doorNode >= 0)!;
/** The kinds in turn, laid along the x axis at z 0 with their own turn and door, their doors a lot's width apart. */
const row: Place[] = Array.from({ length: PLACES }, (_, at) => {
  const place = base(KINDS[at % KINDS.length]!);
  return { ...place, x: at * PITCH_M, z: 0, doorX: place.doorX - place.x + at * PITCH_M, doorZ: place.doorZ - place.z };
});
const set = new InteriorSet({ ...map, places: row });
const sight = new SightField([], SIGHT_ID_CAPACITY);
const crowd = createCrowdPoses(PLACES);
for (let at = 0; at < PLACES; at++) {
  const place = row[at]!;
  crowd.x[at] = place.doorX + Math.cos(place.yaw) * 0.5;
  crowd.z[at] = place.doorZ - Math.sin(place.yaw) * 0.5;
  crowd.shown[at] = place.interior === "rowhome" ? 1 : 0;
}
const openers = { poses: crowd, walker: null, others: [], closed: null };
const length = PLACES * PITCH_M;
let now = 0;

/** One frame with the eye at `x` on the street. */
function frame(x: number): void {
  now += FRAME;
  sight.update([], now, []);
  set.update(x, OFFSET_M, FRAME, sight, openers);
}

/** One drive along the street and back; how many rooms (envelopes and furnished) were built on the way, and how many dropped. */
function pass(): { built: number; dropped: number } {
  const counts = { built: 0, dropped: 0 };
  let before = set.stats();
  for (const direction of [1, -1]) {
    for (let step = 0; step * SPEED < length; step++) {
      frame(direction === 1 ? step * SPEED : length - step * SPEED);
      const after = set.stats();
      const change = after.shells - before.shells + after.details - before.details;
      counts.built += Math.max(0, change);
      counts.dropped += Math.max(0, -change);
      before = after;
    }
  }
  return counts;
}

/** The geometries and arrays behind the four packed meshes: what a drive must not make again. */
function storage(): unknown[] {
  return ["interior-shells", "interior-furniture", "interior-lights", "interior-glass"].flatMap((name) => {
    const mesh = set.group.getObjectByName(name) as THREE.Mesh;
    return [mesh.geometry, mesh.geometry.getAttribute("position").array, mesh.geometry.getAttribute("normal").array, mesh.geometry.getAttribute("color").array];
  });
}

describe("given a street of forty interiors an eye drives along, back and forth, past the near and far radii", () => {
  // mutation: sed -i 's/    if (this.used + count > this.capacity) this.grow(this.used + count);/    this.grow(this.used + count);/' src/game/present/interiors/interior-pack.ts (every build makes the storage again); sed -i 's/    if (count === 0) return NO_SLOT;/    if (count === 0) return NO_SLOT;\n    void Array.from({ length: 1e5 });/' src/game/present/interiors/interior-pack.ts (a build makes a heap of throwaway)
  it("when the street is driven past again after a warm-up, then no packed mesh makes a geometry or an array, and a build or a drop allocates a bounded few bytes", () => {
    for (let warm = 0; warm < WARM_PASSES; warm++) pass();
    const kept = storage();
    let counts = { built: 0, dropped: 0 };
    const bytes = allocatedBytes(() => {
      counts = pass();
    }, WITHIN_SET);
    const now = storage();
    for (let at = 0; at < kept.length; at++) expect(now[at], `storage ${at} is the one the warm-up left`).toBe(kept[at]);
    expect(counts.built, "rooms built on the drive").toBeGreaterThan(PLACES);
    expect(counts.dropped, "rooms dropped on the drive").toBeGreaterThan(PLACES);
    const perBuild = bytes / counts.built;
    if (process.env.ALLOC_PRINT) console.log(`interior-art-alloc: ${counts.built} builds and ${counts.dropped} drops, ${(perBuild / 1e6).toFixed(2)} MB a build`);
    expect(perBuild, `${(perBuild / 1e6).toFixed(2)} MB a build`).toBeLessThanOrEqual(BOUND_BYTES_PER_BUILD);
  });

  // mutation: sed -i 's/^    this.showBuiltThrough();/    this.showBuiltThrough();\n    void Array.from({ length: 512 });/' src/game/present/interiors/interior-art.ts (a frame makes an array)
  it("when a frame builds and drops nothing, then the set allocates no more than its sight queries box", () => {
    for (let warm = 0; warm < WARM_FRAMES; warm++) frame(QUIET_AT);
    const built = JSON.stringify(set.stats());
    const window = (): number =>
      allocatedBytes(() => {
        for (let step = 0; step < WINDOW_FRAMES; step++) frame(QUIET_AT);
      }, WITHIN_SET) / WINDOW_FRAMES;
    const perFrame = untilQuiet(window, BOUND_BYTES_QUIET_FRAME);
    expect(JSON.stringify(set.stats()), "what is built, before and after the reads").toBe(built);
    if (process.env.ALLOC_PRINT) console.log(`interior-art-alloc: ${perFrame.toFixed(1)} B a quiet frame`);
    expect(perFrame, `${perFrame.toFixed(1)} B a quiet frame in every window for ${COMPILE_WAIT_S} s`).toBeLessThanOrEqual(BOUND_BYTES_QUIET_FRAME);
  });
});
