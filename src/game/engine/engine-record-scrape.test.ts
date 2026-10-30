import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { applyDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { assignClass, HANDLING, STYLE_CLASS } from "../vehicle/vehicle-classes.ts";
import { fleetClass, fleetStyle } from "../scenes/fleet.ts";
import { SCRAPE_TRACK, STROKE_BYTES } from "../vehicle/paint-scrapes.ts";
import { CAR_SPRAY } from "../vehicle/spray-box.ts";
import { Reader, Writer } from "../net/codec.ts";
import { carLayout } from "../net/car-pose.ts";
import { clipBytes, readClip, writeClip } from "../net/reel-codec.ts";
import { makeWorld } from "../world/race-world.test-util.ts";
import type { HighlightClip } from "../match/highlights.ts";
import { newWorld, settleStep, stepWorld } from "./world-step.ts";
import { CrashRecorder } from "./engine-record.ts";
import { ClipSim } from "./engine-replay.ts";
import { PoseBlend } from "../present/pose-blend.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

/**
 * A head-on makes the clip; one of its cars carries scratches from before the run and nothing else until it crashes, after the clip's
 * keyframe. Beside the hit three sedans each grind along a parked one, nearest first: the clip takes bystanders nearest first. Each
 * grinder sets off so that the keyframe falls inside its pair's longest scratch episode, as a probe run of the same race found it.
 */
const H = Math.fround(1 / FINE_HZ);
const STEPS = 10 * FINE_HZ;
const A = 0;
const B = 1;
const IMPACT_X = 160;
/** Steps before the keyframe each pair's grinder sets off in the probe run, 4 m behind its parked car's centre and 1.95 m out, 11.5° in, at 10 m/s. */
const PROBE_LEADS = [0.2, 0.35, 0.5].map((s) => Math.round(s * FINE_HZ));
const GRIND_YAW = Math.asin(2 / 10);
const GRIND_SPEED = 10;
/** Pair `k`'s grinder and parked car. */
const grinderOf = (k: number) => 2 + 2 * k;
const groundOf = (k: number) => 3 + 2 * k;
const PAIRS = PROBE_LEADS.length;
/** The first pair stands this far (m) up the road's side of the hit and each next one 12 m on: bystanders of the clip. */
const SIDE_Z = 25;
const PAIR_GAP = 12;
/** Doubles of one face in the scratch tracker (`PaintScrapes.track`), the first of them whether its episode is open. */
const TRACK_FACE = SCRAPE_TRACK / CAR_SPRAY.faces.length;

/** A car's stroke list as numbers: its count, then its strokes' bytes. */
const strokesOf = (car: DeformableCar) => [car.scratches.count, ...car.scratches.list.subarray(0, car.scratches.count * STROKE_BYTES)];
/** Whether a tracker has a scratch episode open on any face. */
const sliding = (track: readonly number[]) => track.some((v, i) => i % TRACK_FACE === 0 && v !== 0);
/** A car's pose: position and orientation. */
const poseOf = (car: DeformableCar) => [...car.group.position.toArray(), ...car.group.quaternion.toArray()];

interface Recorded {
  clip: HighlightClip;
  cars: DeformableCar[];
  /** After each live step: every pair's grinder's and parked car's strokes, poses and trackers, and the head-on car's pose and strokes and whether it carries solver state. */
  trace: { strokes: number[][]; poses: number[][]; tracks: number[][]; marked: number[]; markedStrokes: number[]; markedSolver: boolean }[];
  dress: (car: DeformableCar) => void;
}

/** The race's cars on their marks, head-on car A with a scratch on its left door from before the run and nothing else. */
function cast(): { cars: DeformableCar[]; dress: (car: DeformableCar) => void } {
  const { dress } = makeWorld();
  const scene = new THREE.Scene();
  const make = (i: number): DeformableCar => {
    const car = new DeformableCar({ body: 0x808080, accent: 0, name: `c${i}` }, scene, null, i <= B ? fleetStyle(i) : "sedan");
    assignClass(car, i <= B ? fleetClass(i) : STYLE_CLASS.sedan);
    dress(car);
    return car;
  };
  const cars = Array.from({ length: 2 + 2 * PAIRS }, (_, i) => make(i));
  const a = cars[A]!;
  a.spawnFacing(0, 0, Math.PI / 2, 15);
  cars[B]!.spawnFacing(2 * IMPACT_X, 0, -Math.PI / 2, 15);
  for (let k = 0; k < PAIRS; k++) {
    cars[grinderOf(k)]!.spawnFacing(IMPACT_X - 1.95, SIDE_Z + PAIR_GAP * k - 4, GRIND_YAW, 0);
    cars[groundOf(k)]!.spawnFacing(IMPACT_X, SIDE_Z + PAIR_GAP * k, 0, 0);
  }
  a.group.updateMatrixWorld(true);
  const q = a.group.quaternion;
  a.scrape(a.group.localToWorld(new THREE.Vector3(-0.85, 0.5, -0.5)), new THREE.Vector3(1, 0, 0).applyQuaternion(q), new THREE.Vector3(0, 0, 8).applyQuaternion(q), 0.3, 3, 1);
  a.scratches.slice(0.25);
  a.scratches.slice(0.25);
  return { cars, dress };
}

/** The run, each grinder `k` set off `leads[k]` steps before `keyStep` (-1 while it is not known: a first pass finds it): its velocity set, not a spawn, which a recorder files as a placement. */
function record(keyStep: number, leads: readonly number[]): Recorded {
  const { cars, dress } = cast();
  const rec = new CrashRecorder({ recall: (_i, out) => out.set([-1]), knocks: () => new Uint8Array(16) });
  rec.begin("flat", HANDLING.realism, false, cars.length, (i) => `c${i}`, 1);
  const world = newWorld(cars);
  world.pairHit = (a, b, hit) => rec.pairHit(a, b, hit);
  world.partTouch = (a, b) => rec.touch(a, b);
  world.partMet = (own, top) => rec.partMet(own, top);
  const trace: Recorded["trace"] = [];
  const input: DriveInput = { throttle: 0, steer: 0, brake: 0, ebrake: false, boost: false };
  const pair = (of: (car: DeformableCar) => number[]) => Array.from({ length: PAIRS }, (_, k) => [of(cars[grinderOf(k)]!), of(cars[groundOf(k)]!)]).flat();
  const a = cars[A]!;
  for (let s = 0; s < STEPS; s++) {
    for (let k = 0; k < PAIRS; k++) {
      if (keyStep <= 0 || s !== keyStep - leads[k]!) continue;
      const g = cars[grinderOf(k)]!;
      g.velocity.set(GRIND_SPEED * Math.sin(GRIND_YAW), 0, GRIND_SPEED * Math.cos(GRIND_YAW));
      g.speed = GRIND_SPEED;
    }
    rec.startStep(cars);
    for (const [i, car] of cars.entries()) {
      input.throttle = i === A || i === B ? 1 : 0;
      applyDrive(car, input, H);
    }
    stepWorld(world, H);
    rec.endStep(cars, H, world.shape, world.loners);
    settleStep(cars, H, false);
    trace.push({
      strokes: pair(strokesOf),
      poses: pair(poseOf),
      tracks: pair((car) => Array.from(car.scratches.track)),
      marked: poseOf(a),
      markedStrokes: strokesOf(a),
      markedSolver: a.crashed || a.hasLoosePart() || a.deform.loadCrushed(),
    });
  }
  rec.end();
  const kept = rec.ledger.kept[0];
  expect(kept, "the head-on's clip").toBeDefined();
  const w = new Writer(clipBytes(kept!));
  writeClip(w, kept!);
  return { clip: readClip(new Reader().reset(w.done()), carLayout(cars[0]!)), cars, trace, dress };
}

/** Steps from pair `k`'s set-off (step `setOff` of `trace`) that put the keyframe in the middle of its sliders' longest open scratch episode. */
function episodeLead(trace: Recorded["trace"], k: number, setOff: number): number | undefined {
  let longest = 0;
  let middle: number | undefined;
  for (const i of [2 * k, 2 * k + 1]) {
    let from = -1;
    for (let s = setOff; s <= trace.length; s++) {
      const open = s < trace.length && sliding(trace[s]!.tracks[i]!);
      if (open && from < 0) from = s;
      if (open || from < 0) continue;
      if (s - from > longest) {
        longest = s - from;
        middle = (from + s - 1) >> 1;
      }
      from = -1;
    }
  }
  // A keyframe is taken before its step runs: it holds the trace's row of the step before.
  return middle === undefined ? undefined : middle - setOff + 1;
}

const first = record(-1, PROBE_LEADS);
const keyStep = Math.round(first.clip.t0 / H);
const probe = record(keyStep, PROBE_LEADS);
const leads = PROBE_LEADS.map((lead, k) => episodeLead(probe.trace, k, keyStep - lead) ?? lead);
const { clip, cars, trace, dress } = record(keyStep, leads);
/** The sideswiping cars, in `trace.strokes` order. */
const sliders = PROBE_LEADS.flatMap((_, k) => [grinderOf(k), groundOf(k)]);

describe("given a head-on's clip whose keyframe falls mid-sideswipe beside the hit, and a head-on car with scratches and no other damage at the keyframe", () => {
  it("when the clip is replayed, then every scratched car's strokes are the live ones at its first step and the sideswiping cars' at its last, byte for byte, and the head-on car's pose is the live one's at every step", () => {
    expect(clip.t0, "the control: the sideswipes left the head-on's clip where it was").toBe(first.clip.t0);
    const inClip = (slot: number) => clip.cars.some((c) => c.slot === slot);
    // Bystanders go in nearest first while the clip's size share lasts (`bystanders`), so the farthest pair may stay out; a pair goes in whole, with the car that touched it.
    const shown = sliders.flatMap((slot, i) => (inClip(slot) ? [[slot, i] as const] : []));
    expect(shown.length, `bystanders of the clip (its cars: ${clip.cars.map((c) => c.slot).join(",")}; leads ${leads.join(",")})`).toBeGreaterThan(0);
    const atKey = trace[keyStep - 1]!;
    expect(atKey.markedStrokes[0]! > 0 && !atKey.markedSolver, "the control: at the keyframe the head-on car carries scratches and nothing else").toBeTruthy();
    expect(shown.some(([, i]) => sliding(atKey.tracks[i]!)), `the control: a slider of the clip is mid-episode at the keyframe (leads ${leads.join(",")})`).toBeTruthy();
    const sim = new ClipSim(clip, clip.cars.map((c) => cars[c.slot]!), { dress, collide: () => {}, blend: new PoseBlend() });
    sim.restart();
    expect(firstMismatch(strokesOf(cars[A]!), atKey.markedStrokes), "the head-on car at the clip's start").toBeUndefined();
    for (const [slot, i] of shown) expect(firstMismatch(strokesOf(cars[slot]!), atKey.strokes[i]!), `car ${slot} at the clip's start`).toBeUndefined();
    while (!sim.done) {
      sim.advanceTo(sim.time + 1e-6);
      expect(firstMismatch(poseOf(cars[A]!), trace[keyStep + sim.step - 1]!.marked), `the head-on car's pose after the clip's step ${sim.step - 1}`).toBeUndefined();
    }
    const last = trace[keyStep + sim.step - 1]!;
    expect(last.markedSolver, "the control: the scratched car crashed in the clip").toBe(true);
    for (const [slot, i] of shown) expect(firstMismatch(strokesOf(cars[slot]!), last.strokes[i]!), `car ${slot} at the clip's end`).toBeUndefined();
  });
});
