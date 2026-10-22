import { after, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { setGround } from "../world/ground.ts";
import { blankPoint, Track } from "../world/track.ts";
import stunt from "../world/tracks/stunt.json" with { type: "json" };
import city from "../world/tracks/city.json" with { type: "json" };
import { frame, makeWorld, type World } from "../world/race-world.test-util.ts";
import { bodyGap, FUDGE_FULL, FUDGE_GAP, FUDGE_NONE, phaseClock } from "../match/phase.ts";
import { carLayout } from "../net/car-pose.ts";
import { packReel, unpackReel } from "../net/reel-codec.ts";
import { FLIGHT_S, ReelDirector, simAt, type ReelHost } from "./engine-highlights.ts";
import { ClipSim } from "./engine-replay.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import type { HighlightClip, Reel } from "../match/highlights.ts";
import { assertSameNumbers } from "../vehicle/test-support.ts";
import { PoseBlend } from "../present/pose-blend.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { stage } from "./reel-view.test-util.ts";

/** The city course with the staged head-on's cars (2 and 3) and the player's and car 1: no field around them to crash into. */
const FIELD = { trackId: "city", laps: 1, aiCount: 3, noReset: false, aggression: 1 };
const SEED = 5;
/**
 * A deliberate first crash on intact cars, a second into the race: cars 2 and 3 put head-on 8 m apart on the city road at `aMps` and
 * `bMps` m/s. No seed's natural field guarantees one (any change to the car sim moves a seed's whole race, and slow bumps tear parts
 * that no longer make a clip), as the stunt test below does.
 */
function stageHeadOn(w: World, aMps: number, bMps: number): void {
  const track = new Track(city);
  const pt = blankPoint();
  const state = { acc: 0 };
  for (let n = 0; w.race.time < 1 && n < 900; n++) frame(w, state);
  track.pointAt(150, pt);
  w.cars[2]!.spawnFacing(pt.x, pt.z, Math.atan2(pt.tx, pt.tz), aMps);
  track.pointAt(158, pt);
  w.cars[3]!.spawnFacing(pt.x, pt.z, Math.atan2(pt.tx, pt.tz) + Math.PI, bMps);
}

/** Car 1 driven at the stunt course's wall at `mps` a second into the race (`stage`'s wall hit, as the reel's kicker-wall test stages it). */
function stageWall(w: World, mps: number): void {
  const track = new Track(stunt);
  const state = { acc: 0 };
  for (let n = 0; w.race.time < 1 && n < 900; n++) frame(w, state);
  stage(track, w.cars[1]!, w.cars[0]!, { kind: "wall", at: WALL_AT * track.length, speed: mps, side: -1 });
}
/** Where (share of the lap) the staged wall hit drives off the road: the stunt course's kicker, whose wall a staged car is known to hit. */
const WALL_AT = 0.38;
/** A wall hit's touch is the lone car's wall contact this near (m) the recorded point: its other scrapes on the way there are not it. */
const WALL_NEAR = 4;

/** A reel host on a harness world: its slot cars, its course, no FX. */
function hostOf(w: World): ReelHost {
  return {
    carsOf: (clip) => clip.cars.map((c) => w.cars[c.slot]!),
    live: () => w.live(),
    scene: { dress: w.dress, collide: (car, slot, h) => w.race.courseHit(car, slot, h), restore: (slot, mem, at) => w.race.remember(slot, mem, at), knocks: (bits) => w.race.knockTo(bits), blend: new PoseBlend() },
    resetProps: () => w.race.resetProps(),
    clear: () => {},
    sight: () => w.race.courseSight()!,
    still: () => w.race.courseSight()!,
    clock: phaseClock(),
    crash: () => {},
    impact: () => {},
    fudge: () => {},
    hit: () => {},
    eject: () => {},
    passenger: () => {},
    strike: () => {},
    ride: () => false,
  };
}

function race(w: World, field = FIELD, seed = SEED): void {
  w.race.enter();
  w.race.command({ type: "quit" });
  w.race.command({ type: "options", options: field });
  w.race.reseed(seed);
  w.race.command({ type: "start" });
  w.seat.mode = "follow";
}

/** The reel of the first `clips` clips a field records (the first by default): what a host sends and every peer (the host too) replays. */
async function recordedReel(w: World, clips = 1): Promise<Reel> {
  const state = { acc: 0 };
  for (let n = 0; n * (1 / FRAME_HZ) < 120 && w.race.recorder.ledger.kept.length < clips && w.race.phase !== "finished"; n++) frame(w, state);
  w.race.recorder.end();
  const kept = w.race.recorder.ledger.kept;
  assert.ok(kept.length >= 1, "no clip in 120 s");
  const msg = await packReel({ seed: 77, clips: kept.slice(0, clips) }, 0);
  return (await unpackReel(msg, carLayout(w.cars[0]!))).reel;
}

/** A scenario's world and the reel its crash recorded (`record`, run in `before`), the world exited in `after`: the tests of one describe replay the one reel, on the cars that recorded it. */
function recorded(record: (w: World) => Promise<Reel>): { w: World; reel: Reel } {
  const rec = { w: makeWorld() } as { w: World; reel: Reel };
  before(async () => {
    rec.reel = await record(rec.w);
  });
  after(() => {
    rec.w.race.exit();
    setGround(null);
  });
  return rec;
}

describe("given a city race whose first crash is two cars put head-on a second in, and torn parts left on every car", () => {
  it("when a highlight reel plays and ends, then each clip's setup empties the scene (torn parts on hidden cars included), the reel ending empties what the clips left, and stopping with no reel up clears nothing", async () => {
    const a = makeWorld();
    try {
      // A deliberate first crash on intact cars (no seed's natural field guarantees one: slow bumps tear parts that no longer make a clip).
      race(a, FIELD, SEED);
      stageHeadOn(a, 20, 20);
      const reel = await recordedReel(a);
      const torn = (): number => a.cars.reduce((n, c) => n + c["parts"].filter((p) => p.detached).length, 0);
      // Precondition of the seed, not the rule: the first clip itself restores no torn part, so what a setup leaves is the race's.
      const opening = new ReelDirector({
        ...hostOf(a),
        clear: () => {
          for (const c of a.cars) c.resetVisual();
        },
      });
      opening.stepBudgetMs = Infinity;
      opening.play(reel, 0);
      opening.frame(FLIGHT_S / 2);
      assert.equal(torn(), 0, `the scripted head-on lost its precondition: its first clip opens on ${torn()} torn parts of an earlier pile-up`);
      opening.stop();
      for (const c of a.cars) c["detachPart"](c["parts"].find((p) => p.region)!, 12);
      assert.ok(torn() >= a.cars.length, `${torn()} torn parts over ${a.cars.length} cars`);
      let clears = 0;
      const d = new ReelDirector({
        ...hostOf(a),
        clear: () => {
          clears++;
          for (const c of a.cars) c.resetVisual();
        },
      });
      d.stepBudgetMs = Infinity;
      d.stop();
      assert.equal(clears, 0, "stop with no reel up");
      d.play(reel, 0);
      d.frame(FLIGHT_S / 2);
      assert.equal(clears, 1, "the first clip sets up as the flight to it begins");
      assert.equal(torn(), 0, "no torn part of the race is left, in view or hidden");
      d.frame(FLIGHT_S + 0.1);
      assert.equal(clears, 1, "the clip's own frames clear nothing more");
      d.stop();
      assert.equal(clears, 2, "the reel ends");
    } finally {
      a.race.exit();
      setGround(null);
    }
  });
});

/**
 * Every clip car's pose and motion, flat: what the replay's state is. The Euler angles are what the sim reads of a
 * grounded car and the quaternion of an airborne or falling one, so both count.
 */
function stateOf(cars: readonly DeformableCar[]): number[] {
  return cars.flatMap((c) => {
    const { position: p, quaternion: q, rotation: r } = c.group;
    return [p.x, p.y, p.z, q.x, q.y, q.z, q.w, r.x, r.y, r.z, c.velocity.x, c.velocity.y, c.velocity.z];
  });
}

/** The replay itself runs on whole steps only: stepping it with a drawn frame inside every step ends where stepping it alone does. */
function assertDrawingKeepsReplay(w: World, clip: Reel["clips"][number], hz: number): void {
  const cars = clip.cars.map((c) => w.cars[c.slot]!);
  const sim = new ClipSim(clip, cars, hostOf(w).scene);
  w.race.resetProps();
  sim.restart();
  for (let t = 1 / hz; t < sim.length; t += 1 / hz) {
    sim.advanceTo(t);
    sim.present(t - 0.5 / hz);
  }
  sim.advanceTo(Infinity);
  const drawn = stateOf(cars);
  w.race.resetProps();
  sim.restart();
  sim.advanceTo(Infinity);
  assertSameNumbers(stateOf(cars), drawn, `${hz} Hz: the replay's final state with a drawn frame inside every step`);
}

/** A spark or debris call the reel threw: which, on which play, after how many of the replay's steps, at what strength, and its point's gap (m) to the first impact's farther drawn body (`hitGap`). */
type Thrown = { pass: number; done: number; path: string; strength: number; gap: number };

/** Plan gap (m) from `clip`'s recorded impact point to the drawn bodies of its first impact's cars, as replay `d` draws them: `pick` of the pair's two (the lone car of a wall hit alone). */
function hitGap(d: ReelDirector, clip: HighlightClip, pick: (a: number, b: number) => number): number {
  const cars = d["cur"]!.sim.cars;
  const a = bodyGap(cars[clip.firstA]!, clip.x, clip.z);
  return clip.firstB >= 0 ? pick(a, bodyGap(cars[clip.firstB]!, clip.x, clip.z)) : a;
}

/**
 * Two plays of `reel`'s first clip (the first and its restart): every spark and debris call the reel throws (`impact`, `fudge`, `hit`) with the steps the
 * replay had run; per play, the step its first impact's cars first touch (the pair's SAT hit, or the lone car's wall hit by the point), the widest
 * gap from the point to their farther drawn body while the slow-mo eased in, and whether one body stood on the point (within `FUDGE_FULL`) while the other was `FUDGE_NONE` or more off.
 */
function playTwice(w: World, reel: Reel): { touch: number[]; widest: number[]; lopsided: boolean[]; thrown: Thrown[] } {
  const clip = reel.clips[0]!;
  const touch = [Infinity, Infinity];
  const widest = [0, 0];
  const lopsided = [false, false];
  const thrown: Thrown[] = [];
  const wallHit = w.race.onWallHit;
  const slot = clip.cars[clip.firstA]!.slot;
  let clockS = 0;
  mock.method(performance, "now", () => clockS * 1000);
  try {
    const note = (path: string, strength: number): void => void thrown.push({ pass: d["pass"], done: d["cur"]!.sim.step, path, strength, gap: hitGap(d, clip, Math.max) });
    const d: ReelDirector = new ReelDirector({
      ...hostOf(w),
      impact: () => note("flash and burst", 1),
      fudge: (_at, _n, strength) => note("fudge", strength),
      hit: () => note("hit sparks", 1),
    });
    const met = (step: number): void => void (touch[d["pass"]] = Math.min(touch[d["pass"]]!, step));
    w.race.onWallHit = (i, closing, x, z) => {
      if (clip.firstB < 0 && i === slot && Math.hypot(x - clip.x, z - clip.z) < WALL_NEAR) met(d["cur"]!.sim.step);
      wallHit(i, closing, x, z);
    };
    d.stepBudgetMs = Infinity;
    d.play(reel, 0);
    const { sim, tl } = d["clips"][0]!;
    const pairHit = sim.world.pairHit!;
    sim.world.pairHit = (a, b, hit) => {
      if (Math.min(a, b) === Math.min(clip.firstA, clip.firstB) && Math.max(a, b) === Math.max(clip.firstA, clip.firstB)) met(sim.step);
      pairHit(a, b, hit);
    };
    const loop: number = d["loopWall"];
    for (let n = 1; (clockS = n / 60) < 2 * loop - 1; n++) {
      d.frame(clockS);
      const wall: number = d["wall"];
      if (d["flying"] || wall < tl.onset || wall >= tl.contact) continue;
      const far = hitGap(d, clip, Math.max);
      widest[d["pass"]] = Math.max(widest[d["pass"]]!, far);
      if (far >= FUDGE_NONE && hitGap(d, clip, Math.min) <= FUDGE_FULL) lopsided[d["pass"]] = true;
    }
  } finally {
    mock.restoreAll();
    w.race.onWallHit = wallHit;
  }
  return { touch, widest, lopsided, thrown };
}

/**
 * On the first play and the restart alike: the fudge throws only with the hit's drawn bodies (both of a pair) within `FUDGE_NONE` of the point (whole
 * within `FUDGE_FULL`), though the slow-mo began with one farther off, and still throws once they reach it; nothing else comes before the step the
 * cars touch, and the flash and burst come. `parked`: the struck car stood on the point while the other was still coming (the case that needs both).
 */
function assertFudgeOnlyByBody(w: World, reel: Reel, parked = false): void {
  const { touch, widest, lopsided, thrown } = playTwice(w, reel);
  for (const pass of [0, 1]) {
    const label = pass === 0 ? "first play" : "restart";
    const at = touch[pass]!;
    assert.ok(Number.isFinite(at), `${label}: the first impact's cars never touched`);
    assert.ok(widest[pass]! >= FUDGE_NONE, `${label}: the farther body was only ${widest[pass]!.toFixed(2)} m off the point as the slow-mo eased in: nothing for the gate to hold back`);
    if (parked) assert.ok(lopsided[pass], `${label}: no moment with the struck car on the point and the other ${FUDGE_NONE} m or more off: the case is not staged`);
    const mine = thrown.filter((t) => t.pass === pass);
    const fudge = mine.filter((t) => t.path === "fudge");
    assert.ok(fudge.length >= 1, `${label}: no fudge burst, though the cars reached the point`);
    const far = fudge.filter((t) => !(t.gap < FUDGE_NONE && t.strength > 0));
    assert.equal(far.length, 0, `${label}: fudge thrown ${far.map((t) => `${t.gap.toFixed(2)} m off a body at strength ${t.strength.toFixed(2)}, ${at - t.done} steps before the touch`).join("; ")}`);
    const weak = fudge.filter((t) => t.gap <= FUDGE_FULL && t.strength !== 1);
    assert.equal(weak.length, 0, `${label}: fudge at ${weak.map((t) => `strength ${t.strength.toFixed(2)} ${t.gap.toFixed(2)} m off a body`).join("; ")} (whole within ${FUDGE_FULL} m)`);
    assert.ok(mine.some((t) => t.path === "flash and burst"), `${label}: no flash and burst`);
    const early = mine.filter((t) => t.path !== "fudge" && t.done < at);
    assert.equal(early.length, 0, `${label}: ${early.map((t) => `${t.path} ${at - t.done} steps before the touch (step ${at})`).join(", ")}`);
  }
}

describe("given a city race whose first crash is a 30 m/s car meeting a 10 m/s car head-on a second in, and its clip opens with its focus car driving, recorded as a highlight reel", () => {
  const fast = recorded(async (a) => {
    race(a, FIELD, SEED);
    stageHeadOn(a, 30, 10);
    return recordedReel(a);
  });

  it("when two peers play it, one drawing at 60 Hz and the other at 45 Hz, then at every shared moment both frame the same shot, the camera and focus car really move, and a solo view's first frame does not play the hit early", async () => {
    const { w: a, reel } = fast;
    const b = makeWorld();
    try {
      // The second peer has its own cars and its own history: a few frames of the same race.
      race(b);
      for (let n = 0; n < 30; n++) frame(b, { acc: 0 });
      let hits = 0;
      const da = new ReelDirector({ ...hostOf(a), impact: () => hits++ });
      const db = new ReelDirector(hostOf(b));
      // A loaded test box must not stop one peer's catch-up mid-frame (the browser's budget only defers it).
      da.stepBudgetMs = Infinity;
      db.stepBudgetMs = Infinity;
      da.play(reel, 0);
      db.play(reel, 0);
      const ca = new THREE.PerspectiveCamera(50, 1.6, 0.1, 900);
      const cb = new THREE.PerspectiveCamera(50, 1.6, 0.1, 900);
      // Peer a draws at 60 Hz, peer b at 45 Hz; both draw every 1/15 s, where they are compared.
      const end = FLIGHT_S + da["clips"][0]!.tl.wall;
      let worst = 0;
      let compared = 0;
      // How far the camera and the focus car travel: a reel that never moved would compare equal for nothing.
      let flown = 0;
      const prev = new THREE.Vector3();
      const kinds = new Set<string>();
      for (let k = 1; k / 15 < end; k++) {
        for (let i = 1; i <= 4; i++) da.frame(i === 4 ? k / 15 : (4 * (k - 1) + i) / 60);
        for (let j = 1; j <= 3; j++) db.frame(j === 3 ? k / 15 : (3 * (k - 1) + j) / 45);
        da.camera(ca);
        db.camera(cb);
        if (k > 1) flown += ca.position.distanceTo(prev);
        prev.copy(ca.position);
        kinds.add(da.focus() ? "clip" : "flight");
        worst = Math.max(worst, ca.position.distanceTo(cb.position), ca.quaternion.angleTo(cb.quaternion));
        compared++;
      }
      assert.ok(compared > 200, `${compared} moments compared`);
      assert.ok(flown > 50 && kinds.size === 2, `the camera moved ${flown.toFixed(0)} m over ${[...kinds].join(", ")}`);
      assert.ok(worst < 1e-6, `the peers' cameras differ by ${worst.toExponential(2)} (m or rad) at the same moment`);
      // Watch: the first frame's timestamp precedes the click (rAF time is the frame's start): the clip starts at 0,
      // it does not play its hit (crash cam, flash) before the car reaches it.
      hits = 0;
      da.view(0, 100);
      da.frame(100 - 0.004);
      da.frame(100 + 0.012);
      assert.equal(hits, 0, "a solo view's first frame played the clip's hit");
    } finally {
      b.race.exit();
    }
  });

  it("when its slow-mo eases in, then the crash cam begins before it, sparks and dust are asked for at the clip's recorded impact point at most every FUDGE_GAP, only once both cars' drawn bodies are within FUDGE_NONE of it, until the cars meet and never after, and the flash and burst go off once, as they meet", () => {
    const { w: a, reel } = fast;
    const clip = reel.clips[0]!;
    const seen = { crash: [] as number[], impact: [] as number[], fudge: [] as number[], off: 0, gap: 0, strength: 1 };
    let wall = 0;
    const d: ReelDirector = new ReelDirector({
      ...hostOf(a),
      crash: () => seen.crash.push(wall),
      impact: () => seen.impact.push(wall),
      fudge: (at, _n, strength) => {
        seen.fudge.push(wall);
        seen.off = Math.max(seen.off, Math.hypot(at.x - clip.x, at.z - clip.z));
        seen.gap = Math.max(seen.gap, hitGap(d, clip, Math.max));
        seen.strength = Math.min(seen.strength, strength);
      },
    });
    d.stepBudgetMs = Infinity;
    d.play(reel, 0);
    const tl = d["clips"][0]!.tl;
    for (let n = 1; (wall = n / 60) < FLIGHT_S + tl.wall; n++) d.frame(wall);
    const at = (s: number): number => s + FLIGHT_S;
    const frame = 1 / FRAME_HZ + 1e-9;
    assert.equal(seen.crash.length, 1, "the crash cam began once");
    assert.ok(seen.crash[0]! >= at(tl.impact) && seen.crash[0]! < at(tl.impact) + frame, `the crash cam began at ${seen.crash[0]!.toFixed(3)} s, not at ${at(tl.impact).toFixed(3)}`);
    assert.equal(seen.impact.length, 1, "the flash and burst went off once");
    assert.ok(seen.impact[0]! >= at(tl.contact) && seen.impact[0]! < at(tl.contact) + frame, `the flash and burst went off at ${seen.impact[0]!.toFixed(3)} s, not as the cars meet (${at(tl.contact).toFixed(3)})`);
    assert.ok(seen.fudge.length >= 1, "no sparks or dust before the hit");
    assert.ok(seen.fudge.at(-1)! < at(tl.contact), `sparks and dust still asked for at ${seen.fudge.at(-1)!.toFixed(3)} s, after the cars met (${at(tl.contact).toFixed(3)})`);
    for (let k = 1; k < seen.fudge.length; k++) assert.ok(seen.fudge[k]! - seen.fudge[k - 1]! >= FUDGE_GAP - 1e-9, `sparks ${k} came ${(seen.fudge[k]! - seen.fudge[k - 1]!).toFixed(3)} s after the last`);
    assert.ok(seen.off < 1e-6, `sparks were asked for ${seen.off} m off the recorded impact point`);
    assert.ok(seen.gap < FUDGE_NONE && seen.strength > 0, `sparks asked for with the farther drawn body ${seen.gap.toFixed(2)} m off the point (none from ${FUDGE_NONE} m), at strength ${seen.strength}`);
  });

  it("when its reel plays and restarts, then on each play the fudge throws only with both drawn bodies of the head-on's cars by the point and nothing else comes before the step they touch", () => {
    assertFudgeOnlyByBody(fast.w, fast.reel);
  });

  it("when it plays at 60 and at 240 Hz, then the car moving through the slow-motion is drawn moving on every frame, and drawing frames never changes the replay", () => {
    const { w: a, reel } = fast;
    const clip = reel.clips[0]!;
    for (const hz of [60, 240]) {
      const d = new ReelDirector(hostOf(a));
      d.stepBudgetMs = Infinity;
      d.play(reel, 0);
      const tl = d["clips"][0]!.tl;
      const prev = new THREE.Vector3();
      let frames = 0;
      let still = 0;
      for (let t = FLIGHT_S; t < FLIGHT_S + tl.wall; t += 1 / hz) {
        if (d.frame(t) === null) continue;
        const car = d.focus();
        if (!car) continue;
        // The slow-mo's first three wall seconds (a step is 4 ms of clip time there: 8 frames at 60 Hz).
        const into = t - FLIGHT_S - tl.onset;
        if (into > 0.3 && into < 3.3 && Math.hypot(car.velocity.x, car.velocity.z) > 1) {
          frames++;
          if (car.group.position.equals(prev)) still++;
        }
        prev.copy(car.group.position);
      }
      assert.ok(frames > 100, `${hz} Hz: ${frames} moving frames in the slow-mo`);
      assert.ok(still <= frames * 0.02, `${hz} Hz: ${still} of ${frames} frames drew the car where the last frame had it, though it moves`);
    }
    assertDrawingKeepsReplay(a, clip, 240);
  });

  it("when each frame asks the reel for its sim time on a recorded step longer than a frame's share of clip time, then it is the clip time the frame is drawn at less the last frame's, on every frame, so the dummies, debris and FX advance on most of them", () => {
    const { w: a, reel } = fast;
    const d = new ReelDirector(hostOf(a));
    d.stepBudgetMs = Infinity;
    d.play(reel, 0);
    const tl = d["clips"][0]!.tl;
    let last = 0;
    let slowFrames = 0;
    let advancing = 0;
    let wrong = 0;
    for (let w = 0; w < tl.wall; w += 1 / FRAME_HZ) {
      const dt = d.frame(FLIGHT_S + w);
      const drawnAt = simAt(tl, w);
      if (dt === null || Math.abs(dt - (drawnAt - last)) > 1e-9) wrong++;
      last = drawnAt;
      if (w > tl.onset + 0.3 && w < tl.onset + 3.3) {
        slowFrames++;
        if (dt !== null && dt > 0) advancing++;
      }
    }
    assert.equal(wrong, 0, `${wrong} frames returned a sim time other than the clip time they drew less the last frame's`);
    assert.ok(slowFrames > 100, `${slowFrames} frames in the slow-motion`);
    assert.ok(advancing >= slowFrames * 0.95, `${advancing} of ${slowFrames} slow-motion frames advanced the dummies and FX`);
  });

  /** The reel's host with its FX counted as the pools hold them: bursts thrown (fudge, hit, flash and burst) since the pools were last cleared (`clear`). */
  function countedHost(w: World, fx: { live: number; hits: number }): ReelHost {
    return {
      ...hostOf(w),
      clear: () => void (fx.live = 0),
      fudge: () => void fx.live++,
      impact: () => void fx.live++,
      hit: () => void (fx.live++, fx.hits++),
    };
  }

  it("when its reel loops and a clip is watched alone and put back, then no spark or debris of one play is alive on the next play's first frame, and a reel that rejoins a clip late hovers over its opening with none", () => {
    const { w: a, reel } = fast;
    let clockS = 0;
    mock.method(performance, "now", () => clockS * 1000);
    const fx = { live: 0, hits: 0 };
    const starts: { pass: number; before: number; after: number }[] = [];
    try {
      const d = new ReelDirector(countedHost(a, fx));
      d.stepBudgetMs = Infinity;
      d.play(reel, 0);
      const loop = d["loopWall"] as number;
      const run = (from: number, to: number): void => {
        let pass = d["pass"] as number;
        let before = fx.live;
        for (let n = 1; (clockS = from + n / 60) < to; n++) {
          d.frame(clockS);
          if (d["pass"] !== pass) starts.push({ pass: d["pass"], before, after: fx.live });
          pass = d["pass"];
          before = fx.live;
        }
      };
      // The reel's two plays; then the clip watched alone for two laps (a click on its Watch button).
      run(0, 2 * loop - 1);
      const watchAt = 2 * loop + FLIGHT_S + 6;
      d.view(0, watchAt);
      const lap = d["solo"]!.tl.wall + 1.5;
      run(watchAt, watchAt + 2 * lap - 1);
      const throwing = fx.live;
      assert.ok(throwing > 0, "the watched clip threw nothing: nothing to carry over");
      // Put back: the reel rejoins the clip a stall's worth late and hovers over it.
      d.back();
      const lateAt = 6 * loop + FLIGHT_S + 6;
      const hover: number[] = [];
      for (let k = 0; k < 30; k++) {
        clockS = lateAt + k / 60;
        d.frame(clockS);
        hover.push(fx.live);
      }
      assert.equal(d["hovering"], true, "the reel did not hover over the clip it rejoined late");
      assert.deepEqual(hover.filter((n) => n > 0), [], `${throwing} bursts of the watched clip were still alive in the hover (${hover.join(",")})`);
      assert.equal(d["cur"]!.sim.time, 0, "the hover shows the clip's opening, not where the watched clip ended");
    } finally {
      mock.restoreAll();
    }
    assert.ok(starts.length >= 3, `${starts.length} play starts seen`);
    for (const s of starts) {
      assert.ok(s.before > 0 || s.pass === 0, `play ${s.pass}: the play before threw nothing`);
      assert.equal(s.after, 0, `play ${s.pass} started with ${s.after} bursts of the last play alive (${s.before} before it)`);
    }
  });

  it("when a clip watched alone has run its last step and its view holds the last frame, then the hold throws no sparks of that step again", () => {
    const { w: a, reel } = fast;
    let clockS = 0;
    mock.method(performance, "now", () => clockS * 1000);
    const fx = { live: 0, hits: 0 };
    let held = 0;
    let heldFrames = 0;
    try {
      const d = new ReelDirector(countedHost(a, fx));
      d.stepBudgetMs = Infinity;
      d.play(reel, 0);
      d.view(0, 0);
      const wall = d["solo"]!.tl.wall as number;
      let n = 1;
      for (; (clockS = n / 60) <= wall; n++) d.frame(clockS);
      // The frame that draws the clip's last moment has looked at its last step: the contact that step left (a pile pressed together at the end) stays the world's last.
      d.frame((clockS = ++n / 60));
      d["cur"]!.sim.world.strongest.offer({ impulse: 10, contact: new THREE.Vector3(1, 0.4, 1), normal: new THREE.Vector3(1, 0, 0) });
      const before = fx.hits;
      for (n++; (clockS = n / 60) < wall + 1.4; n++) {
        d.frame(clockS);
        heldFrames++;
      }
      held = fx.hits - before;
    } finally {
      mock.restoreAll();
    }
    assert.ok(heldFrames > 60, `${heldFrames} frames of the hold`);
    assert.equal(held, 0, `${held} spark showers over the ${heldFrames}-frame hold after the last step, for a contact that step left`);
  });

  it("when a replay that made a contact is restarted, then the last step's contact is gone before its first step", () => {
    const { w: a, reel } = fast;
    const clip = reel.clips[0]!;
    const sim = new ClipSim(clip, clip.cars.map((c) => a.cars[c.slot]!), hostOf(a).scene);
    a.race.resetProps();
    sim.restart();
    while (sim.world.strongest.impulse <= 0 && sim.time < sim.length) sim.advanceTo(sim.time + 1e-6);
    assert.ok(sim.world.strongest.impulse > 0, "the clip made no contact: nothing to clear");
    sim.restart();
    assert.equal(sim.world.strongest.impulse, 0, "a restarted replay still holds the last play's contact");
    assert.equal(sim.world.strongest.contact, null);
  });

  it("when its reel plays twice, then every frame of the second play (its first frames after the flight included) has the camera, the focus car and the crash and impact calls where the first play had them", () => {
    const { w: a, reel } = fast;
    let clockS = 0;
    mock.method(performance, "now", () => clockS * 1000);
    type Frame = { eye: number[]; focus: boolean; crash: number; impact: number };
    const plays: Frame[][] = [[], []];
    try {
      const seen = { crash: 0, impact: 0 };
      const d = new ReelDirector({ ...hostOf(a), crash: () => void seen.crash++, impact: () => void seen.impact++ });
      d.stepBudgetMs = Infinity;
      d.play(reel, 0);
      const loop = d["loopWall"] as number;
      const cam = new THREE.PerspectiveCamera(50, 1.6, 0.1, 900);
      for (const [pass, frames] of plays.entries()) {
        seen.crash = 0;
        seen.impact = 0;
        for (let n = 1; n / 60 < loop; n++) {
          clockS = pass * loop + n / 60;
          d.frame(clockS);
          d.camera(cam);
          frames.push({ eye: [cam.position.x, cam.position.y, cam.position.z, cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w, cam.fov], focus: d.focus() !== null, crash: seen.crash, impact: seen.impact });
        }
      }
    } finally {
      mock.restoreAll();
    }
    const [first, second] = plays as [Frame[], Frame[]];
    assert.ok(first.length > 600, `${first.length} frames compared`);
    assert.equal(second.length, first.length);
    let worst = 0;
    let at = -1;
    for (const [n, f] of first.entries()) {
      const g = second[n]!;
      assert.equal(g.focus, f.focus, `frame ${n}: focus car ${g.focus} on the second play, ${f.focus} on the first`);
      assert.equal(g.crash, f.crash, `frame ${n}: ${g.crash} crash cam begins on the second play, ${f.crash} on the first`);
      assert.equal(g.impact, f.impact, `frame ${n}: ${g.impact} impacts on the second play, ${f.impact} on the first`);
      for (let k = 0; k < f.eye.length; k++) {
        const off = Math.abs(g.eye[k]! - f.eye[k]!);
        if (off > worst) {
          worst = off;
          at = n;
        }
      }
    }
    assert.ok(worst < 1e-6, `the second play's camera differs from the first's by ${worst.toExponential(2)} (m, quaternion or deg) at frame ${at} (${((at + 1) / 60).toFixed(2)} s into the loop)`);
  });
});

describe("given a stunt race whose first crash is a car driven into the kicker's wall at 32 m/s a second in, recorded as a highlight reel", () => {
  const walled = recorded(async (a) => {
    race(a, { ...FIELD, trackId: "stunt", aiCount: 1 }, 3);
    stageWall(a, 32);
    return recordedReel(a);
  });

  it("when its reel plays and restarts, then on each play the fudge throws only by the car's drawn body and nothing else comes before the step it touches the wall", () => {
    assert.ok(walled.reel.clips[0]!.firstB < 0, "the first clip is not a wall hit");
    assertFudgeOnlyByBody(walled.w, walled.reel);
  });
});

describe("given a city race whose first crash is a 30 m/s car driven into a parked car a second in, recorded as a highlight reel", () => {
  const parked = recorded(async (a) => {
    race(a, FIELD, SEED);
    stageHeadOn(a, 30, 0);
    return recordedReel(a);
  });

  it("when its reel plays and restarts, then on each play no fudge burst comes while the striking car is still FUDGE_NONE or more off the point, though the parked car's bumper is on it, and nothing else comes before the step they touch", () => {
    assert.ok(parked.reel.clips[0]!.firstB >= 0, "the first clip is not a car-car hit");
    assertFudgeOnlyByBody(parked.w, parked.reel, true);
  });
});

/**
 * A stunt-course race's results reel of three clips. Two laps: the field no longer wrecks itself at the start, so one lap records fewer
 * than 3 clips. And the race AI steers clear of what it closes on (`guardContact`), so the field's own crashes are too few for 3 clips in
 * two laps: three head-on pairs, far apart on flat road, are wrecked on purpose a second into the race (cars 2-3, 4-5 and 6-7 at 2 x 20 m/s).
 */
async function stuntReel(a: World): Promise<Reel> {
  race(a, { ...FIELD, trackId: "stunt", laps: 2, aiCount: 7 });
  const track = new Track(stunt);
  const pt = blankPoint();
  const state = { acc: 0 };
  for (let n = 0; a.race.time < 1 && n < 900; n++) frame(a, state);
  for (const [k, d] of [150, 530, 725].entries()) {
    track.pointAt(d, pt);
    a.cars[2 + 2 * k]!.spawnFacing(pt.x, pt.z, Math.atan2(pt.tx, pt.tz), 20);
    track.pointAt(d + 8, pt);
    a.cars[3 + 2 * k]!.spawnFacing(pt.x, pt.z, Math.atan2(pt.tx, pt.tz) + Math.PI, 20);
  }
  const reel = await recordedReel(a, 3);
  assert.ok(reel.clips.length >= 3, `${reel.clips.length} stunt clips`);
  return reel;
}

describe("given the stunt course with three head-on pairs wrecked on purpose a second into a two-lap race, recorded as a results reel of three clips", () => {
  const stunts = recorded(stuntReel);

  it("when each clip is replayed at 60 and 240 Hz, then drawing frames never changes the replay, even of airborne clips over the jumps", () => {
    const { w: a, reel } = stunts;
    const firsts = reel.clips.map((c) => [c.cars[c.firstA]?.slot, c.cars[c.firstB]?.slot].sort().join("-"));
    for (const pair of ["2-3", "4-5", "6-7"]) assert.ok(firsts.includes(pair), `no clip opens on the head-on of cars ${pair}: ${firsts.join(", ")}`);
    for (const clip of reel.clips) for (const hz of [60, 240]) assertDrawingKeepsReplay(a, clip, hz);
  });

  describe("given the reel playing on a loop, and a [!] button drawn for the clip on screen", () => {
    it("when the reel plays through a loop and into the next, then the clip on screen keeps one id, the flights between clips show none, and an id still reaches its own clip after the reel has moved on", () => {
      const { w: a, reel } = stunts;
      const d = new ReelDirector(hostOf(a));
      d.stepBudgetMs = Infinity;
      d.play(reel, 0);
      const idOf: (number | undefined)[] = [];
      const wrong: string[] = [];
      const loopWall: number = d["loopWall"];
      let finalShown: number | null = null;
      for (let t = 0.25; t < loopWall + FLIGHT_S + 1; t += 0.25) {
        d.frame(t);
        const { reel: r, shown } = d.hud();
        if (r === null) continue;
        if (r.playing < 0) {
          if (shown !== null) wrong.push(`t=${t}: id ${shown} shown in a flight`);
          continue;
        }
        idOf[r.playing] ??= shown ?? undefined;
        if (shown === null || shown !== idOf[r.playing]) wrong.push(`t=${t}: clip ${r.playing} showed id ${shown}, first seen as ${idOf[r.playing]}`);
        finalShown = shown;
      }
      assert.deepEqual(wrong, []);
      assert.equal(idOf.length, reel.clips.length, "every clip was on screen in the loop");
      assert.equal(new Set(idOf).size, reel.clips.length, "each clip has an id of its own");
      assert.notEqual(finalShown, null, "the second loop reached a clip");
      // The reel has moved on from the first clip: the id a button drawn for it carries still reaches it, and no other.
      for (const [i, id] of idOf.entries()) assert.equal(d.clipById(id!)?.clip, reel.clips[i], `id ${id} reaches clip ${i}`);
      assert.equal(d.clipById(-1), null);
    });

    it("when a new reel replaces it, then the old ids reach nothing, so a late tap flags no clip of the new reel", () => {
      const { w: a, reel } = stunts;
      const d = new ReelDirector(hostOf(a));
      d.stepBudgetMs = Infinity;
      d.play(reel, 0);
      d.frame(FLIGHT_S / 2);
      d.frame(FLIGHT_S + 0.2);
      const { shown } = d.hud();
      assert.notEqual(shown, null);
      d.play(reel, 0);
      assert.equal(d.clipById(shown!), null);
      d.frame(FLIGHT_S / 2);
      d.frame(FLIGHT_S + 0.2);
      assert.notEqual(d.hud().shown, shown, "the same clip in the new reel is a new id");
    });

    it("when a clip is watched alone from the reel and when a saved clip is watched alone, then the clip shown is the reel's own id or a saved one, and it ends with the view", () => {
      const { w: a, reel } = stunts;
      const d = new ReelDirector(hostOf(a));
      d.stepBudgetMs = Infinity;
      d.play(reel, 0);
      d.frame(FLIGHT_S / 2);
      d.frame(FLIGHT_S + 0.2);
      const inReel = d.hud().shown!;
      d.view(0, 100);
      d.frame(100.1);
      assert.equal(d.hud().shown, inReel, "watching the reel's first clip alone shows the id it had in the reel");
      assert.equal(d.clipById(inReel)?.from, "reel");
      d.back();
      d.stop();
      let back = 0;
      d.viewSaved(reel.clips[0]!, 200, () => back++);
      d.frame(200.1);
      const saved = d.hud().shown;
      assert.notEqual(saved, null);
      assert.equal(d.clipById(saved!)?.from, "saved");
      assert.equal(d.hud().reel, null, "a saved clip has no reel behind it");
      d.back();
      assert.equal(d.hud().shown, null, "no clip on screen once the view has ended");
      assert.equal(d.clipById(saved!), null);
      assert.equal(back, 1);
    });
  });
});
