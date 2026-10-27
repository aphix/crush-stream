import { after, before, describe, it, type TestContext } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { DERBY_RADIUS } from "../scenes/derby-arena.ts";
import { setGround } from "../world/ground.ts";
import { placeProps } from "../world/placements.ts";
import { parseTrack } from "../world/track-schema.ts";
import { blankPoint, Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { DERBY_OCCLUDERS } from "../present/chase-solids.ts";
import { crashEye, CUTS, heldCut, hitAim } from "../present/engine-cine.ts";
import { crashAxis } from "../present/engine-cine-courses.test-util.ts";
import { raceSight, solid, type Occluder, type Sight } from "../present/spectate-cam.ts";
import { sampleAt } from "../present/track-mesh.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { coverLens } from "./engine-highlights.ts";
import { DESKTOP, judge, VIEW } from "./reel-view.test-util.ts";

/**
 * The crash camera's eye over subject points laid on a grid over each course and the derby arena, densest by the walls and the
 * props, judged by the reel's own claim (`judge`: the subject in the frame, no solid on the line to it, not tiny). The
 * eye picker needs only a point and an axis, so this stands in for the whole-race clips of `reel-view-city.ai-long-run.ts`
 * where the claim is about sight; what needs the clip's motion over time (slow-mo holds, a thrown driver's ride, later hits) stays there.
 */

/** Rows of subject points along a course's road, evenly spread over its arc (a long course's picks cost most: every solid on the line is gathered each call). */
const ROAD_ROWS = 16;
/** Distances (m) in from the wall line, across the road, at which a subject is laid: against the wall first. */
const FROM_WALL = [1, 3];
/** Shares of the road's half-width, each side of the middle, laid after the wall's. */
const ACROSS = [0.5];
/** Distance (m) off a prop's face at which a subject is laid on each of its four sides. */
const OFF_PROP = 1.5;
/** At most this many props of a course get a ring of subjects (an even stride over them). */
const MAX_PROPS = 8;
/** Spacing (m) of the arena's floor grid. */
const ARENA_STEP = 5;
/** Distances (m) in from the arena's wall and the angle step (rad) round it at which a subject is laid. */
const ARENA_FROM_WALL = [1, 2.5, 5, 9];
const ARENA_ANGLE = Math.PI / 24;
/** Turns (rad) from a spot's own frame (the road's line, a prop's face) of the hit axes laid at each subject: along it and a diagonal into it. */
const AXIS_TURNS = [0, Math.PI / 4];
/** A subject (the car's middle) never stands closer (m) to a solid than half a car's width. */
const SUBJECT_PAD = 0.5;
/** The share of subjects whose pick leaves every cut with no usable eye (the reel's own camera keeps the shot): stunt's tight walls, and every other place. */
const BLIND_MOST = { stunt: 0.22, other: 0.08 };
/** Fewest picks a row must try, so a fixture that lost its spots fails instead of passing empty. */
const MIN_PICKS = 100;

type Spot = { x: number; y: number; z: number; yaw: number };

const aim = new THREE.Vector3();

/** The subject point of a car hit at (x, z) over a surface asked from `y`, as the crash cam aims at it. */
function spot(sight: Sight, x: number, y: number, z: number, yaw: number): Spot {
  hitAim(aim, x, y, z, sight);
  return { x, y: aim.y, z, yaw };
}

/** Subjects on each of a prop's four sides, `OFF_PROP` m off its face, in its face's frame. */
function propRing(o: Occluder, out: Spot[], sight: Sight): void {
  const yaw = Math.atan2(o.sin, o.cos);
  const hz = o.circle ? o.hx : o.hz;
  for (const [a, b] of [[o.hx + OFF_PROP, 0], [-o.hx - OFF_PROP, 0], [0, hz + OFF_PROP], [0, -hz - OFF_PROP]] as const) {
    out.push(spot(sight, o.x + a * o.cos + b * o.sin, o.y0, o.z - a * o.sin + b * o.cos, yaw));
  }
}

/** Subjects along a course's road in `ROAD_ROWS` rows: on both sides by the wall line, and in the middle. */
function roadSpots(track: Track, sight: Sight): Spot[] {
  const path = track.path;
  const pt = blankPoint();
  const out: Spot[] = [];
  for (let row = 0; row < ROAD_ROWS; row++) {
    const s = ((row + 0.5) * track.length) / ROAD_ROWS;
    track.pointAt(s, pt);
    const k = sampleAt(path, s);
    const yaw = Math.atan2(pt.tx, pt.tz);
    for (const side of [1, -1]) {
      const edge = path.half[k]! + (side > 0 ? path.runL[k]! : path.runR[k]!);
      const lats = [...FROM_WALL.map((d) => edge - d), ...ACROSS.map((share) => path.half[k]! * share)];
      for (const lat of lats) out.push(spot(sight, pt.x + pt.tz * side * lat, pt.y, pt.z - pt.tx * side * lat, yaw));
    }
  }
  return out;
}

/** The arena's subjects: a floor grid, rings in from its wall and a ring round each of its prisms. */
function arenaSpots(sight: Sight, props: readonly Occluder[]): Spot[] {
  const out: Spot[] = [];
  for (let x = -DERBY_RADIUS; x <= DERBY_RADIUS; x += ARENA_STEP) {
    for (let z = -DERBY_RADIUS; z <= DERBY_RADIUS; z += ARENA_STEP) if (Math.hypot(x, z) < DERBY_RADIUS) out.push(spot(sight, x, 0, z, 0));
  }
  for (const d of ARENA_FROM_WALL) {
    const r = DERBY_RADIUS - d;
    for (let a = 0; a < 2 * Math.PI - 1e-9; a += ARENA_ANGLE) out.push(spot(sight, r * Math.sin(a), 0, r * Math.cos(a), a + Math.PI / 2));
  }
  for (const o of props) propRing(o, out, sight);
  return out;
}

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 900);
coverLens(camera, DESKTOP.view, DESKTOP.covers);
const at = new THREE.Vector3();
const n = new THREE.Vector3();
const eye = new THREE.Vector3();
const reach = new Float32Array(3);
const base = new THREE.Vector3();

/**
 * Every spot of `spots` under every axis: the crash cam picks as the reel does (`crashAxis`, then `heldCut` on the subject itself),
 * and the eye it holds is judged by `VIEW`'s claim against `judged`'s solids (the pick's own, or more).
 */
function crashPicksSee(picked: Sight, judged: Sight, spots: readonly Spot[], blindMost: number, label: string, t: TestContext): void {
  const started = performance.now();
  let picks = 0;
  let bitten = 0;
  const blind: string[] = [];
  const unseen: string[] = [];
  for (const sp of spots) {
    if (solid(picked, sp.x, sp.y, sp.z, SUBJECT_PAD, picked.occ, false) || !Number.isFinite(sp.y)) continue;
    for (const turn of AXIS_TURNS) {
      picks++;
      at.set(sp.x, sp.y, sp.z);
      n.set(Math.sin(sp.yaw + turn), 0, Math.cos(sp.yaw + turn));
      base.copy(n);
      crashAxis(picked, at, n, reach);
      if (reach.some((r) => r < 1) || n.dot(base) < 0.999) bitten++;
      const tag = `${label} (${sp.x.toFixed(1)}, ${sp.z.toFixed(1)}) axis ${((sp.yaw + turn) * (180 / Math.PI)).toFixed(0)} deg`;
      const cut = heldCut(picked, at, n, reach, at, -1);
      if (cut < 0) {
        blind.push(tag);
        continue;
      }
      camera.fov = crashEye(eye, CUTS[cut]!, at, n, 1, reach[cut]!);
      camera.updateProjectionMatrix();
      camera.position.copy(eye);
      camera.lookAt(at);
      const v = judge(camera, judged, at, DESKTOP);
      if (!v.seen) unseen.push(`${tag} cut ${cut}: ndc ${v.ndcX.toFixed(2)},${v.ndcY.toFixed(2)}${v.front ? "" : " behind"}, ${v.clear ? "clear" : "BLOCKED"}, share ${v.share.toFixed(3)}`);
    }
  }
  t.diagnostic(`${label}: ${picks} picks in ${Math.round(performance.now() - started)} ms, ${bitten} turned or pulled in by a solid, ${blind.length} left every cut with no eye, ${unseen.length} unseen`);
  assert.ok(picks >= MIN_PICKS && bitten > 0, `${label}: the fixture puts no eye behind a wall or a prop: it tests nothing`);
  assert.deepEqual(unseen.slice(0, 5), [], `${label}: ${unseen.length}/${picks} eyes the crash cam holds miss the subject (margin ${VIEW.margin}, share ${VIEW.share.toFixed(3)})`);
  assert.ok(blind.length <= picks * blindMost, `${label}: ${blind.length}/${picks} subjects leave the crash cam no eye on any cut: ${blind.slice(0, 5).join(", ")}`);
}

describe("given the crash camera choosing eyes for a car hit anywhere on a course (a grid of subject points by its walls and props, two axes each)", () => {
  for (const json of TRACKS) {
    const track = new Track(parseTrack(json));
    it(`when subjects lie on the ${track.id} course by every wall, across the road and round its props, then the eye the crash cam holds sees each: it is inside the frame, no wall or building stands on the line to it, and the subject is not tiny`, (t) => {
      const sight = raceSight(track, placeProps(track));
      const spots = roadSpots(track, sight);
      const stride = Math.max(1, Math.ceil(sight.occ.length / MAX_PROPS));
      for (let i = 0; i < sight.occ.length; i += stride) propRing(sight.occ[i]!, spots, sight);
      crashPicksSee(sight, sight, spots, track.id === "stunt" ? BLIND_MOST.stunt : BLIND_MOST.other, track.id, t);
    });
  }
});

describe("given the real engine's crash camera choosing eyes for a car hit anywhere in the derby arena (its floor, its glass wall, its prisms)", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  before(async () => {
    stubBrowser();
    engine = await bootEngine();
    engine.toggleDerby();
    engine.reset();
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  it("when subjects lie over the arena's floor, in rings from its wall and round every prism, then the eye the crash cam holds sees each past the arena's glass and its prisms", (t) => {
    assert.ok(engine.derbyMode, "the engine is not in the derby");
    const picked = engine["crashSight"]();
    const judged: Sight = { ...picked, rim: DERBY_RADIUS, occ: DERBY_OCCLUDERS };
    crashPicksSee(picked, judged, arenaSpots(picked, DERBY_OCCLUDERS), BLIND_MOST.other, "derby arena", t);
  });
});
