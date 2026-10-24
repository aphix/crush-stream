import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setGround } from "../world/ground.ts";
import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import city from "../world/tracks/city.json" with { type: "json" };
import stunt from "../world/tracks/stunt.json" with { type: "json" };
import { clipTitle, type HighlightClip } from "../match/highlights.ts";
import { CrashCam, crashCamEnd, hitAim, laterHits } from "../present/engine-cine.ts";
import { raceOn, recordRace, reelViews, type Crash, type RigSample } from "./reel-view.test-util.ts";
import { clipTimeline } from "./engine-highlights.ts";
import { TIMELINE_HZ } from "./constants.ts";
import * as THREE from "three";
import { blankPoint } from "../world/track.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

/** A replayed frame is one 1/60 s step of the reel's wall clock. */
const FRAME = 1 / FRAME_HZ;
/** The city's straightest 60 m (arc length, m): a staged chain's three cars stand in line on it. */
const STRAIGHT = 592;
const LAP = new Track(parseTrack(city)).length;

/**
 * Owner, 2026-10-10: "the slomo highlights crashes used to stick on the crashes a bit longer before going to a flying ragdoll,
 * where it only goes to following the ragdolls after the 2nd/3rd crash gets its camera focus highlight showing the live
 * deformation". A clip's crash shots are the crash cam's window (its first cut to `crashCamEnd` of the clip's slow-mo hold)
 * and a hit beat for each impact of the clip's scope.
 */
type Played = { clip: HighlightClip; frames: RigSample[] };

/** The clips of a race with `staged` crashes on the city, each with the rig that held every frame of it. */
async function play(name: string, staged: Crash[]): Promise<Played[]> {
  const track = new Track(parseTrack(city));
  const w = raceOn("city", 7, 3);
  const rec = recordRace(w, track, staged, 16);
  const trace: RigSample[] = [];
  await reelViews(w, rec.clips, name, undefined, trace);
  w.race.exit();
  setGround(null);
  return rec.clips.map((clip, i) => ({ clip, frames: trace.filter((s) => s.clip === i) }));
}

/** Wall s into the clip's timeline at which the replay shows clip time `t` (the first frame that reaches it). */
function wallOf(frames: readonly RigSample[], t: number): number {
  return frames.find((f) => f.at >= t - 1e-9)!.wall;
}

/** The crash cam's window on the clip's timeline: from its first cut to the frame it hands back (the first frame its own clock reaches `crashCamEnd` of the hold the frame carried; the replay's frames and the hold's grid differ by half a frame). */
function crashWindow(frames: readonly RigSample[]): { from: number; until: number } | null {
  const first = frames.find((f) => f.rig === "crash");
  if (!first) return null;
  const handBack = frames.find((f) => f.wall > first.wall && f.camT >= crashCamEnd(first.hold));
  return { from: first.wall, until: handBack?.wall ?? Infinity };
}

describe("given highlight clips of a head-on that throws both drivers, and of a car at 40 and at 70 m/s into a chain of two stopped cars, replayed through the reel's cameras", () => {
  const played = Promise.all([
    play("headOn", [{ kind: "headOn", at: 0.22 * LAP, speed: 20 }]),
    play("chain6", [{ kind: "chain", at: STRAIGHT, speed: 40, gap: 6, cars: [1, 2, 3] }]),
    play("chain5", [{ kind: "chain", at: STRAIGHT, speed: 70, gap: 5, cars: [1, 2, 3] }]),
  ]).then((all) => all.flat());

  it("when a driver is thrown inside the crash shots, then the ride-along follows him only from the crash cam's hand-back, and never before the clip's last impact", async () => {
    const rides = (await played).filter((p) => p.frames.some((f) => f.rig === "ride"));
    assert.ok(rides.length >= 1, "a clip with a thrown driver to follow");
    for (const { clip, frames } of rides) {
      const win = crashWindow(frames)!;
      const start = frames.find((f) => f.rig === "ride")!.wall;
      assert.ok(start >= win.until - FRAME, `${clipTitle(clip)}: the ride began at ${start.toFixed(2)} s, the crash cam holds until ${win.until.toFixed(2)} s`);
      const last = wallOf(frames, clip.hits[clip.hits.length - 1]!.t);
      assert.ok(start >= last, `${clipTitle(clip)}: the ride began at ${start.toFixed(2)} s, before the last impact at ${last.toFixed(2)} s`);
      assert.ok(
        frames.every((f) => f.rig !== "crash" || f.wall < start),
        `${clipTitle(clip)}: a crash shot after the ride began`,
      );
    }
  });

  it("when a later impact of the clip's scope lands inside the crash cam's window, then the crash cam, not the chase shot or the ride, is on the camera at that impact", async () => {
    let inside = 0;
    for (const { clip, frames } of await played) {
      const win = crashWindow(frames);
      if (!win) continue;
      for (const h of clip.hits.slice(1)) {
        const at = wallOf(frames, h.t);
        if (at < win.from || at >= win.until) continue;
        inside++;
        const f = frames.find((x) => x.wall >= at)!;
        assert.equal(f.rig, "crash", `${clipTitle(clip)}: the impact at ${at.toFixed(2)} s (crash window ${win.from.toFixed(2)} to ${win.until.toFixed(2)} s) was on ${f.rig}`);
      }
    }
    assert.ok(inside >= 1, "a clip with a later impact inside the crash cam's window");
  });

  it("when the crash cam's window is open, then no frame of it falls to the chase shot while a cut has an eye on the hit", async () => {
    for (const { clip, frames } of await played) {
      const win = crashWindow(frames);
      if (!win) continue;
      const gaps = frames.filter((f) => f.wall >= win.from && f.wall < win.until && f.rig !== "crash");
      assert.deepEqual(
        gaps.map((f) => f.wall.toFixed(2)),
        [],
        `${clipTitle(clip)}: frames of the crash cam's window ${win.from.toFixed(2)} to ${win.until.toFixed(2)} s on another camera`,
      );
    }
  });
});

/**
 * The stunt course's road climbs and drops. The crash cam begins a second or more before the car reaches its hit (on the way
 * up the kicker), so it is aimed at the recorded point (`ClipHit.y`), not where the car is then; and a later crash below a
 * drop gets the crash cam's own shot round it, the cam's eyes standing on its ground.
 */
describe("given a car that hits the wall on the stunt course's kicker 9 m above where its clip starts, replayed through the reel's cameras", () => {
  /** The kicker's deck, where `Track.pointAt` has the road 6.8 m up (arc length, m). */
  const KICKER = 0.38;
  it("when its clip plays, then the crash cam's first cut and every other moment of the clip are in the frame", async () => {
    const track = new Track(parseTrack(stunt));
    const w = raceOn("stunt", 3, 1);
    try {
      const rec = recordRace(w, track, [{ kind: "wall", at: KICKER * track.length, speed: 32, side: -1, cars: [1] }], 12);
      assert.equal(rec.clips.length, 1, "the wall hit makes a clip");
      const hit = rec.clips[0]!.hits[0]!;
      assert.ok(hit.y > 8, `the hit is ${hit.y.toFixed(1)} m up, not on the kicker's deck`);
      const views = await reelViews(w, rec.clips, "stunt kicker wall");
      const out = views.filter((v) => !v.seen).map((v) => `${v.title} ${v.kind} at ${v.at.toFixed(2)} s by ${v.rig}: ndc ${v.ndcX.toFixed(2)},${v.ndcY.toFixed(2)}${v.clear ? "" : " blocked"}, share ${v.share.toFixed(3)}`);
      assert.ok(views.length >= 1, "no moment to see");
      assert.deepEqual(out, [], "moments out of the frame");
    } finally {
      w.race.exit();
      setGround(null);
    }
  });
});

describe("given two points 40 m apart on the stunt course, the first on the lip of its drop and the second at the foot of it", () => {
  /** Where the road leaves the deck (arc length, m): its height falls from 7.8 m to 5.0 m within 40 m, then to 2 m. */
  const LIP = 900;
  it("when the crash cam begun on the lip of a 3-hit pile-up reaches its later crash at the foot, then it holds the camera on a cut at that crash and keeps it until the last slow-mo's hand-back", () => {
    const track = new Track(parseTrack(stunt));
    const w = raceOn("stunt", 3, 1);
    try {
      const a = blankPoint();
      const b = blankPoint();
      track.pointAt(LIP, a);
      track.pointAt(LIP + 40, b);
      const s = w.race.courseSight()!;
      const foot = hitAim(new THREE.Vector3(), b.x, b.y, b.z, s);
      const hits = [3.313, 3.946, 4.133];
      const tl = clipTimeline(hits[0]!, 6, [], hits.slice(1));
      let k = 0;
      while (k < tl.sim.length - 1 && tl.sim[k]! < hits[1]!) k++;
      const at = k / TIMELINE_HZ - tl.impact;
      const later = laterHits(1);
      later.n = 1;
      later.from[0] = at - 0.75;
      later.until[0] = at + 0.3;
      later.at[0]!.copy(foot);
      const cam = new CrashCam(false);
      cam.begin(new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x - a.x, 0, b.z - a.z), s, tl.hold);
      const hold = { target: foot, sight: () => s, hit: tl.contact - tl.impact + 0.3, later };
      const camera = new THREE.PerspectiveCamera();
      let onAtFoot = false;
      let back = -1;
      for (let i = 1; back < 0 && i < 60 * FRAME_HZ; i++) {
        const on = cam.direct(camera, FRAME, true, hold);
        if (Math.abs(cam.camT - at) < FRAME / 2) onAtFoot = on;
        if (!cam.holding) back = cam.camT;
      }
      assert.equal(onAtFoot, true, `the crash cam not on the camera at the foot's crash (wall ${(tl.impact + at).toFixed(2)} s, handed back at ${(tl.impact + back).toFixed(2)} s)`);
      let last = k;
      while (last < tl.sim.length - 1 && tl.sim[last]! < hits[2]!) last++;
      const lastBack = tl.phase.indexOf("aftermath", last) / TIMELINE_HZ;
      const early = lastBack - (tl.impact + back);
      assert.ok(early >= 0 && early <= 0.5, `handed back at ${(tl.impact + back).toFixed(2)} wall s, the last slow-mo at ${lastBack.toFixed(2)} s`);
    } finally {
      w.race.exit();
      setGround(null);
    }
  });
});
