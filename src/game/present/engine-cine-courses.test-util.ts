import { describe, it, type TestContext } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { placeProps } from "../world/placements.ts";
import { parseTrack } from "../world/track-schema.ts";
import { blankPoint, Track } from "../world/track.ts";
import type { TRACKS } from "../world/tracks/index.ts";
import { sampleAt } from "./track-mesh.ts";
import { camUsable, CLEAR, raceSight, solid, type Sight } from "./spectate-cam.ts";
import { CrashPick, crashEye, CUTS } from "./engine-cine.ts";
import { assertSameNumbers } from "../vehicle/test-support.ts";

/**
 * The crash camera's eyes over every wall spot of a course (`engine-cine.test.ts`: the stunt course, whose tight walls and
 * self-crossing road are what each bar below was set on; `engine-cine-courses.ai-long-run.ts`: every course on the menu). Not a test file itself.
 */

/** An eye's times through its cut, tried here: twice as many as the pick's, so half of them fall between its. */
const CUT_TIMES = 17;
const STILL = { x: 0, y: 0, z: 0 };

/** The crash cam's pick, whole: `n` turned to the best axis and each cut's reach into `reach`. */
export function crashAxis(s: Sight, at: THREE.Vector3, n: THREE.Vector3, reach: Float32Array): void {
  const pick = new CrashPick();
  pick.begin(s, at, n, reach);
  pick.run(Infinity);
}
/** The cuts of axis `n` alone (no turning) that have an eye, their reach into `reach`. */
export function crashSeen(s: Sight, at: THREE.Vector3, n: THREE.Vector3, reach: Float32Array): number {
  const pick = new CrashPick();
  pick.begin(s, at, n.clone(), reach, 1);
  pick.run(Infinity);
  return reach.reduce((k, r) => k + (r > 0 ? 1 : 0), 0);
}

/** A pick's answer: the axis turned to the best one and each cut's reach. */
interface Chosen {
  n: THREE.Vector3;
  reach: Float32Array;
}

/** A car against a wall, travelling along it (the director's axis for a wall hit: the car's velocity). */
interface Spot {
  s: number;
  side: number;
  tunnel: boolean;
  at: THREE.Vector3;
  n: THREE.Vector3;
  /** The whole pick at this spot, run once for every row that reads it. */
  chosen: Chosen | null;
}

/** Every wall spot of a course (the road's walled sides, every 8 m along it) and the course's sight. */
function wallSpots(track: Track): { sight: Sight; spots: Spot[] } {
  const path = track.path;
  const ground = track.ground();
  const pt = blankPoint();
  const spots: Spot[] = [];
  for (let s = 0; s < track.length; s += 8) {
    track.pointAt(s, pt);
    const k = sampleAt(path, s);
    for (const side of [1, -1]) {
      if (!(side > 0 ? path.wallL[k] : path.wallR[k])) continue;
      const lat = side * (path.half[k]! + (side > 0 ? path.runL[k]! : path.runR[k]!) - 1);
      const x = pt.x + pt.tz * lat;
      const z = pt.z - pt.tx * lat;
      const at = new THREE.Vector3(x, ground.heightAt(x, z, pt.y + 1) + 0.55, z);
      spots.push({ s, side, tunnel: !!path.tunnel[k], at, n: new THREE.Vector3(pt.tx, 0, pt.tz).normalize(), chosen: null });
    }
  }
  return { sight: raceSight(track, placeProps(track)), spots };
}

/** The whole pick at `spot`, run on first ask. */
function chosenAt(sight: Sight, spot: Spot): Chosen {
  if (!spot.chosen) {
    const n = spot.n.clone();
    const reach = new Float32Array(3);
    crashAxis(sight, spot.at, n, reach);
    spot.chosen = { n, reach };
  }
  return spot.chosen;
}

function wallCensus(t: TestContext, track: Track, sight: Sight, all: readonly Spot[]): void {
  const reach = new Float32Array(3);
  let spots = 0;
  let blindAsHit = 0;
  const blind: string[] = [];
  const eye = new THREE.Vector3();
  let eyes = 0;
  const lost: string[] = [];
  for (const spot of all) {
    const { s, side, tunnel, at, n } = spot;
    spots++;
    if (crashSeen(sight, at, n, reach) < 3 || reach.some((r) => r < 1)) blindAsHit++;
    const turned = chosenAt(sight, spot);
    if (turned.reach.some((r) => r === 0)) blind.push(`s ${s} side ${side}${tunnel ? " tunnel" : ""} reach ${[...turned.reach].join("/")}`);
    // Each eye the pick gave a cut, at `CUT_TIMES` times through it (the eye pans and turns over the cut).
    for (let cut = 0; cut < 3; cut++) {
      if (turned.reach[cut] === 0) continue;
      eyes++;
      for (let i = 0; i < CUT_TIMES; i++) {
        crashEye(eye, CUTS[cut]! + ((CUTS[cut + 1]! - CUTS[cut]!) * i) / (CUT_TIMES - 1), at, turned.n, 1, turned.reach[cut]!);
        if (camUsable(sight, eye, at, STILL, 0)) continue;
        lost.push(`s ${s} side ${side} cut ${cut} at ${i}/${CUT_TIMES - 1}`);
        break;
      }
    }
  }
  t.diagnostic(`${track.id}: ${spots} wall spots, ${blindAsHit} blind on the hit's own axis, ${blind.length} left a cut with no eye after the turn, ${lost.length} of ${eyes} eyes lose room or sight during their cut`);
  if (spots === 0) return;
  assert.ok(blindAsHit > 0, "the fixture puts no eye behind a wall: it tests nothing");
  // A cut with no usable eye (`CLEAR.radius` m of room and sight of the hit, at the cut's start, middle and end) is left to the chase / reel camera (`direct`),
  // never filmed from inside a wall's margin. Tight stunt walls leave the most: 55/272 (20%); rally 14/186 (8%); oval and city none.
  const most = track.id === "stunt" ? 0.22 : 0.08;
  assert.ok(blind.length <= spots * most, `${track.id}: ${blind.length}/${spots} wall hits leave a crash-cam cut with no usable eye: ${blind.slice(0, 5).join(", ")}`);
  // The eye pans (long lens), creeps (bumper) and turns (crane) through its cut: one the pick calls usable keeps its room and
  // sight all the way. A middle-only pick lost them for 36 of 549 eyes on rally, 75 of 432 on city and 61 of 761 on stunt (0 on oval);
  // a sliver of a post beside the car between two checked times (stunt: 1 of 730) is all that is left.
  assert.ok(lost.length <= eyes * 0.002, `${track.id}: ${lost.length}/${eyes} crash-cam eyes lose their room or sight during their cut: ${lost.slice(0, 5).join(", ")}`);
}

function queryIndependence(track: Track, sight: Sight, all: readonly Spot[]): void {
  // `solid` projects each point onto the road from the last one's segment: where a course crosses itself (stunt: 1 of 544 eyes
  // on main) a far-off previous query left the hint on the other road, and the wall beside the eye went unseen.
  const far = blankPoint();
  const eye = new THREE.Vector3();
  const differ: string[] = [];
  for (const { s, side, at, n } of all) {
    for (const time of [CUTS[1]!, CUTS[2]! + 0.8]) {
      crashEye(eye, time, at, n, 1, 1);
      const answers = [0, 1, 2, 3].map((q) => {
        track.pointAt((track.length * q) / 4, far);
        solid(sight, far.x, far.y + 1, far.z, CLEAR.pad);
        return camUsable(sight, eye, at, STILL, 0);
      });
      if (answers.some((a) => a !== answers[0])) differ.push(`s ${s} side ${side} t ${time}`);
    }
  }
  assert.deepEqual(differ, [], `${track.id}: eyes whose answer depends on the previous query`);
}

function slicedPick(track: Track, sight: Sight, all: readonly Spot[]): void {
  // The crash cam's pick runs a few calls a frame over its lead-in: at 240 Hz one frame must not take the whole of it.
  const slicedAxis = new THREE.Vector3();
  const slicedReach = new Float32Array(3);
  const pick = new CrashPick();
  let runs = 0;
  let longest = 0;
  for (const spot of all) {
    const whole = chosenAt(sight, spot);
    slicedAxis.copy(spot.n);
    pick.begin(sight, spot.at, slicedAxis, slicedReach);
    let mine = 0;
    while (!pick.run(5)) mine++;
    runs += mine;
    longest = Math.max(longest, mine);
    assertSameNumbers(slicedReach, whole.reach, `${track.id} s ${spot.s} side ${spot.side}: reach`);
    assert.ok(slicedAxis.distanceTo(whole.n) < 1e-9, `${track.id} s ${spot.s} side ${spot.side}: axis`);
  }
  // 1000 calls a second (`PICK_RATE`) must finish inside the lead-in before the first cut (`CUTS[0]` 1.3 s, less 0.05 s).
  assert.ok(longest * 5 <= 1000 * (CUTS[0] - 0.05), `${track.id}: the longest pick needs ${longest * 5}+ calls`);
  assert.ok(all.length === 0 || runs > 0, "no pick took more than one run: the slicing is untested");
}

export function courseCensus(tracks: typeof TRACKS): void {
  describe("given the crash camera choosing eyes for cars hit against the walls of each course", () => {
    for (const json of tracks) {
      const track = new Track(parseTrack(json));
      let course: { sight: Sight; spots: Spot[] } | null = null;
      const walls = () => (course ??= wallSpots(track));
      it(`when a car slides along the wall at every wall spot of the ${track.id} course, then at most 22% of spots on stunt (8% elsewhere) leave a cut with no usable eye, and at most 0.2% of eyes lose their room or sight of the hit during their cut`, (t) => {
        const { sight, spots } = walls();
        wallCensus(t, track, sight, spots);
      });
      it(`when the ${track.id} course's eyes are checked after four different earlier unrelated queries, then each eye's usability is the same whichever spot was asked before it`, () => {
        const { sight, spots } = walls();
        queryIndependence(track, sight, spots);
      });
      it(`when the ${track.id} course's pick is spread over frames at 5 usability checks a call, then it chooses the same cut reach and axis as the whole pick, and its longest run fits in the lead-in before the first cut at 1000 calls a second`, () => {
        const { sight, spots } = walls();
        slicedPick(track, sight, spots);
      });
    }
  });
}
