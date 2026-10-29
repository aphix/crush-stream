import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { applyDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { assignClass, HANDLING } from "../vehicle/vehicle-classes.ts";
import { fleetClass, fleetStyle } from "../scenes/fleet.ts";
import { Reader, Writer } from "../net/codec.ts";
import { carLayout } from "../net/car-pose.ts";
import { clipBytes, encodeSaved, readClip, writeClip } from "../net/reel-codec.ts";
import { makeWorld } from "../world/race-world.test-util.ts";
import type { HighlightClip } from "../match/highlights.ts";
import { newWorld, settleStep, stepWorld } from "./world-step.ts";
import { CrashRecorder } from "./engine-record.ts";
import { ClipSim } from "./engine-replay.ts";
import { PoseBlend } from "../present/pose-blend.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import { LOOSE_BODIES, PART_SLOTS } from "../vehicle/part-state.ts";

/** The engine's step is a float32 (`Math.fround`), which the recorder stores whole: the replay runs the very step the live sim ran. */
const H = Math.fround(1 / FINE_HZ);
const STEPS = 8 * FINE_HZ;
/** A head-on pair (the clip's cars) and a car the clip leaves out that drives by the debris they leave. */
const A = 0;
const B = 1;
const PASSER = 2;
/** The step the passer joins the field: after the first keyframe of the clip is taken, so the clip leaves it out. */
const JOIN_STEP = 300;
const IMPACT_X = 60;
/**
 * Each car's speed (m/s) into the head-on, tried in turn: the first whose crash tears off a part (a hood, a wheel) that comes to rest clear of both wrecks within
 * the clip is staged. Where a part lands follows every change to the crush, so the setup searches rather than pins one speed.
 */
const HEAD_ON_SPEEDS = [20, 21, 19, 22, 18, 23, 17, 24, 16, 25, 15, 26] as const;
/** How far (m) up the road from the crash the passer is first put, and its speed (m/s). */
const PASSER_AHEAD = 65;
const PASSER_SPEED = 20;
/** A lane (m off the crash line) far from anything the crash throws: a passer there stirs nothing, so its run shows where the parts lie and when it passes them. */
const FAR_LANE = 40;
/** How far (m) the passer's flank passes outside both wrecks' outlines. */
const WRECK_CLEAR = 0.4;
/** Steps a part lies asleep before the passer is nearest it: the passer's roof reaches it about its half length + the part's reach (under 3.5 m, 0.15 s) before. */
const WAKE_LEAD = FINE_HZ / 4;

/** A clip car's torn part or popped wheel lying asleep with nothing stirring it from step `from` through `to`: where (x, z) and its reach (m). */
interface Rest {
  from: number;
  to: number;
  x: number;
  z: number;
  reach: number;
}

/** The clip as a peer decodes it, the cars of the world it was recorded in, the world's trace of every clip car's loose bodies, and where the passer was nearest the crash. */
interface Recorded {
  clip: HighlightClip;
  cars: DeformableCar[];
  /** Per step, per clip car (`A`, `B`): the position (x, y, z) of every torn part and popped wheel it has put in the world (`freeObjects`). */
  trace: Float64Array[][];
  dress: (car: DeformableCar) => void;
  closest: { step: number; gap: number };
  /** Every stretch a clip car's torn part or popped wheel lay still, and the passer's x per step (NaN before it joins). */
  rests: Rest[];
  passerX: number[];
  /** The sleeping torn part or popped wheel the passer came nearest (its car, its `stirredBodies` index, the step and plan gap (m) between the passer's middle and the body's, and the body's reach). */
  reached: { car: number; body: number; step: number; gap: number; reach: number };
}

const looseBodyPositions = (car: DeformableCar): Float64Array => {
  const bodies: THREE.Object3D[] = [];
  const count = car.freeObjects(bodies, 0);
  const positions = new Float64Array(3 * count);
  for (let k = 0; k < count; k++) bodies[k]!.position.toArray(positions, 3 * k);
  return positions;
};

/** A head-on at `speed` m/s each in a flat field recorded as a highlight, its torn parts lying on the road, and (with `passer`, where it starts) a car the clip leaves out driving by them. */
function record(speed: number, passer: { x: number; z: number } | null): Recorded {
  const { dress } = makeWorld();
  const scene = new THREE.Scene();
  const make = (i: number): DeformableCar => {
    const car = new DeformableCar({ body: 0x808080, accent: 0, name: `c${i}` }, scene, null, fleetStyle(i));
    assignClass(car, fleetClass(i));
    dress(car);
    return car;
  };
  const cars = [A, B].map(make);
  cars[A]!.spawnFacing(0, 0, Math.PI / 2, speed);
  cars[B]!.spawnFacing(2 * IMPACT_X, 0, -Math.PI / 2, speed);
  const rec = new CrashRecorder({ recall: (_i, out) => out.set([-1]), knocks: () => new Uint8Array(16) });
  rec.begin("flat", HANDLING.realism, false, 4, (i) => `c${i}`, 1);
  const world = newWorld(cars);
  world.pairHit = (a, b, hit) => rec.pairHit(a, b, hit);
  world.partTouch = (a, b) => rec.touch(a, b);
  const trace: Float64Array[][] = [];
  const input: DriveInput = { throttle: 0, steer: 0, brake: 0, ebrake: false, boost: false };
  const closest = { step: -1, gap: Infinity };
  const reached = { car: -1, body: -1, step: -1, gap: Infinity, reach: 0 };
  const rests: Rest[] = [];
  const lying: (Rest | null)[] = new Array(2 * LOOSE_BODIES).fill(null);
  const passerX: number[] = [];
  for (let s = 0; s < STEPS; s++) {
    if (passer && s === JOIN_STEP) {
      const car = make(PASSER);
      car.spawnFacing(passer.x, passer.z, -Math.PI / 2, PASSER_SPEED);
      cars.push(car);
    }
    rec.startStep(cars);
    for (const [i, car] of cars.entries()) {
      input.throttle = i === PASSER ? 0.4 : 1;
      applyDrive(car, input, H);
    }
    stepWorld(world, H);
    rec.endStep(cars, H, world.shape, world.loners);
    settleStep(cars, H, false);
    const p = cars.length > PASSER ? cars[PASSER]!.group.position : null;
    passerX.push(p ? p.x : NaN);
    if (p) {
      const gap = Math.hypot(p.x - IMPACT_X, p.z);
      if (gap < closest.gap) {
        closest.gap = gap;
        closest.step = s;
      }
    }
    for (const c of [A, B]) {
      const car = cars[c]!;
      const bodies = [...car["parts"].map((part, k) => ({ shape: part.detached ? part.shape : null, body: k })), ...car["looseWheels"].map((wheel, k) => ({ shape: wheel.loose ? wheel.shape : null, body: PART_SLOTS + k }))];
      for (const { shape, body } of bodies) {
        const k = c * LOOSE_BODIES + body;
        const open = lying[k];
        if (shape?.asleep && car.stirredBodies[body] === 0) {
          if (open) open.to = s;
          else lying[k] = { from: s, to: s, x: shape.sleepX, z: shape.sleepZ, reach: shape.reach };
        } else if (open) {
          rests.push(open);
          lying[k] = null;
        }
        if (!p || !shape?.asleep) continue;
        const near = Math.hypot(p.x - shape.sleepX, p.z - shape.sleepZ);
        if (near < reached.gap) Object.assign(reached, { car: c, body, step: s, gap: near, reach: shape.reach });
      }
    }
    trace.push([looseBodyPositions(cars[A]!), looseBodyPositions(cars[B]!)]);
  }
  rec.end();
  for (const open of lying) if (open) rests.push(open);
  assert.ok(rec.ledger.kept.length >= 1, "the head-on crash did not rank as a highlight");
  const kept = rec.ledger.kept[0]!;
  const w = new Writer(clipBytes(kept));
  writeClip(w, kept);
  return { clip: readClip(new Reader().reset(w.done()), carLayout(cars[0]!)), cars, trace, dress, closest, rests, passerX, reached };
}

/**
 * Where the passer starts (x) and drives (its lane, z) to pass a part the crash leaves asleep clear of both wrecks, read off `dry` (the same run with the passer in `FAR_LANE`):
 * the part lying still longest within the clip, the passer's flank halfway into its reach on its far side from the crash line, nearest it halfway through that stillness,
 * and no other part lying nearer its path on the way (`nearerOnTheWay`). Null when no part lies so.
 */
function passerBy(dry: Recorded): { x: number; z: number } | null {
  const end = Math.round(dry.clip.t0 / H) + dry.clip.h.length - 1;
  const corner = new THREE.Vector3();
  let wreckSide = 0;
  for (const c of [A, B]) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const { half } = dry.cars[c]!.frame;
        corner.set(sx * half.x, 0, sz * half.z).applyQuaternion(dry.cars[c]!.group.quaternion).add(dry.cars[c]!.group.position);
        wreckSide = Math.max(wreckSide, Math.abs(corner.z));
      }
    }
  }
  const passerHalfW = dry.cars[PASSER]!.frame.half.x;
  let best: { x: number; z: number } | null = null;
  let span = 0;
  for (const r of dry.rests) {
    const from = r.from + WAKE_LEAD;
    const to = Math.min(r.to, end);
    const lane = r.z + (r.z < 0 ? -1 : 1) * (passerHalfW + r.reach / 2);
    if (Math.abs(lane) - passerHalfW < wreckSide + WRECK_CLEAR || to - from <= span) continue;
    const shift = r.x - dry.passerX[Math.round((from + to) / 2)]!;
    if (nearerOnTheWay(dry, shift, lane, Math.abs(lane - r.z))) continue;
    span = to - from;
    best = { x: IMPACT_X + PASSER_AHEAD + shift, z: lane };
  }
  return best;
}

/**
 * Whether a passer in lane `lane`, `shift` m up the road from the dry run's, comes nearer than `gap` (m) to some part while it lies asleep: then the part it is
 * staged for is not the one it reaches (a wheel asleep in that lane further down the road took the passer's nearest after the clip had ended).
 */
function nearerOnTheWay(dry: Recorded, shift: number, lane: number, gap: number): boolean {
  for (const o of dry.rests) {
    for (let s = o.from; s <= o.to; s++) if (Math.hypot(dry.passerX[s]! + shift - o.x, lane - o.z) < gap) return true;
  }
  return false;
}

/** The staged head-on: the first of `HEAD_ON_SPEEDS` whose far-lane dry run leaves a part for the passer to pass (`passerBy`), and where the passer starts. */
function stage(): { speed: number; passer: { x: number; z: number } } {
  for (const speed of HEAD_ON_SPEEDS) {
    const passer = passerBy(record(speed, { x: IMPACT_X + PASSER_AHEAD, z: FAR_LANE }));
    if (passer) return { speed, passer };
  }
  assert.fail(`no torn part or popped wheel lies asleep clear of both wrecks within the clip, the passer's nearest on its way, at ${HEAD_ON_SPEEDS.join(", ")} m/s`);
}

const STAGED = stage();

/**
 * Every step of `clip` replayed as a peer does, against the live sim's trace: the first step (counted from the clip's first) at which a clip car's torn parts and popped wheels
 * are not where the live sim had them (their number or any coordinate), -1 for none, and the worst coordinate difference (m).
 */
function replayLooseBodies(run: Recorded, clip: HighlightClip): { firstOff: number; worst: number } {
  const { cars, trace, dress } = run;
  // The recorder's clock sums `H` as the record loop did, so the clip's first step is the trace step at `t0`.
  const s0 = Math.round(clip.t0 / H);
  const sim = new ClipSim(clip, clip.cars.map((c) => cars[c.slot]!), { dress, collide: () => {}, blend: new PoseBlend() });
  sim.restart();
  let firstOff = -1;
  let worst = 0;
  while (!sim.done) {
    sim.advanceTo(sim.time + 1e-6);
    const row = trace[s0 + sim.step - 1]!;
    for (const { slot } of clip.cars) {
      const live = row[slot]!;
      const replayed = looseBodyPositions(cars[slot]!);
      let gap = live.length === replayed.length ? 0 : Infinity;
      for (let k = 0; k < Math.min(live.length, replayed.length); k++) gap = Math.max(gap, Math.abs(live[k]! - replayed[k]!));
      if (gap > 0 && firstOff < 0) firstOff = sim.step - 1;
      worst = Math.max(worst, gap);
    }
  }
  return { firstOff, worst };
}

describe("given a head-on recorded as a highlight, its torn parts lying asleep on the road, and a car the clip leaves out that drives by them", () => {
  const run = record(STAGED.speed, STAGED.passer);
  const { clip } = run;
  const s0 = Math.round(clip.t0 / H);

  it("when the clip is filed, then it carries the pair but not the passing car, and lists the wake of a part the passer reaches as a run of slices that begins before the passer is nearest it", async (t) => {
    const bytes = clipBytes(clip) - clipBytes({ ...clip, partStirs: [] });
    const slices = clip.partStirs.reduce((n, x) => n + x.slices, 0);
    // A saved clip is the deflated bytes in base64 (3 bytes to 4 characters).
    const [withRuns, without] = await Promise.all([encodeSaved(clip), encodeSaved({ ...clip, partStirs: [] })]);
    t.annotate(`head-on at ${STAGED.speed} m/s; clip cars ${clip.cars.map((c) => c.slot).join(",")}, steps ${s0} to ${s0 + clip.h.length}; passer nearest at step ${run.closest.step} (${run.closest.gap.toFixed(2)} m); ${clip.partStirs.length} part stirs over ${slices} slices cost ${bytes} bytes raw of ${clipBytes(clip)}, ${Math.round(((withRuns.length - without.length) * 3) / 4)} deflated of ${Math.round((withRuns.length * 3) / 4)}`);
    assert.ok(clip.cars.some((c) => c.slot === A) && clip.cars.some((c) => c.slot === B), "the pair is in the clip");
    assert.ok(!clip.cars.some((c) => c.slot === PASSER), "the car that joined the field after the clip began is left out");
    assert.ok(s0 + clip.h.length > run.closest.step, "the passer comes by inside the clip");
    assert.ok(clip.partStirs.length >= 1, "no torn part was recorded woken");
    const { reached } = run;
    assert.ok(reached.gap < run.cars[PASSER]!.frame.half.x + reached.reach, `the passer came within ${reached.gap.toFixed(2)} m of a resting part, not within its reach`);
    const wakes = clip.partStirs.filter((x) => clip.cars[x.car]!.slot === reached.car && x.body === reached.body && s0 + x.step >= JOIN_STEP);
    assert.ok(wakes.length > 0 && s0 + wakes[0]!.step <= reached.step, `the part the passer reached was woken at ${wakes.map((x) => s0 + x.step).join(",") || "no step"}, the passer nearest it at ${reached.step}`);
  });

  it("when the clip is replayed with its part stirs, then every torn part of its cars is where the live sim had it at every step, to the bit", () => {
    assert.deepEqual(replayLooseBodies(run, clip), { firstOff: -1, worst: 0 });
  });

  it("when the same clip is replayed without its part stirs, then the parts the passer woke lie still while the live ones settled, so the replay strays (the case holds what it is for)", (t) => {
    const strayed = replayLooseBodies(run, { ...clip, partStirs: [] });
    t.annotate(`without the part stirs the replay is first off at clip step ${strayed.firstOff} (race step ${s0 + strayed.firstOff}), worst ${strayed.worst.toExponential(2)} m`);
    assert.ok(strayed.firstOff >= 0, `without the part stirs the replay stays exact: ${JSON.stringify(strayed)}`);
  });
});

describe("given the same head-on recorded with no car outside the clip", () => {
  it("when it is replayed without part stirs, then every torn part is where the live sim had it, to the bit (the passer is what the stirs are for)", (t) => {
    const run = record(STAGED.speed, null);
    t.annotate(`its own cars' wrecks alone stir ${run.clip.partStirs.length} part runs over ${run.clip.partStirs.reduce((n, x) => n + x.slices, 0)} slices`);
    assert.deepEqual(replayLooseBodies(run, { ...run.clip, partStirs: [] }), { firstOff: -1, worst: 0 });
  });
});
