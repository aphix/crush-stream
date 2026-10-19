import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { applyDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { assignClass, HANDLING } from "../vehicle/vehicle-classes.ts";
import { PART_STATE } from "../vehicle/part-state.ts";
import { assertSameNumbers } from "../vehicle/test-support.ts";
import { fleetClass, fleetStyle } from "../scenes/fleet.ts";
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

/**
 * An intact car put on a spot while a clip runs (a respawn, a police wake or put-away): the live respawn (`spawnFacing`) puts
 * everything a crash or a brush left on it back to new, its mirrors folded flat by a passing car included.
 */
const H = Math.fround(1 / FINE_HZ);
const STEPS = 10 * FINE_HZ;
const A = 0;
const B = 1;
const PARKED = 2;
const IMPACT_X = 130;
const PARKED_Z = 25;
/** Rad, both mirrors: as folded by a car brushing past (`hitMirror`), which stays until a respawn unfolds it. */
const MIRROR_FOLD = 0.6;
/** Half a second into the clip the parked car is put on a spot 4 m on. */
const PLACE_AFTER_KEY = FINE_HZ / 2;
const PLACE_DZ = 4;

/** The clip as a peer decodes it, the world's cars, and the parked car's parts state (`partState`) after every step. */
interface Recorded {
  clip: HighlightClip;
  cars: DeformableCar[];
  trace: Float64Array[];
  dress: (car: DeformableCar) => void;
}

function partsOf(car: DeformableCar): Float64Array {
  const out = new Float64Array(PART_STATE);
  car.partState(out, false);
  return out;
}

/** A head-on in a flat field with an intact parked car beside it, mirrors folded; `keyStep` (-1 while a first pass finds it) is the clip's keyframe, `PLACE_AFTER_KEY` steps after which the parked car is put on a spot. */
function record(keyStep: number): Recorded {
  const { dress } = makeWorld();
  const scene = new THREE.Scene();
  const cars = [A, B, PARKED].map((i) => {
    const car = new DeformableCar({ body: 0x808080, accent: 0, name: `c${i}` }, scene, null, fleetStyle(i));
    assignClass(car, fleetClass(i));
    dress(car);
    return car;
  });
  cars[A]!.spawnFacing(0, 0, Math.PI / 2, 15);
  cars[B]!.spawnFacing(2 * IMPACT_X, 0, -Math.PI / 2, 15);
  const parked = cars[PARKED]!;
  parked.spawnFacing(IMPACT_X, PARKED_Z, 0, 0);
  parked.setMirrorFold(-1, MIRROR_FOLD);
  parked.setMirrorFold(1, -MIRROR_FOLD);
  const rec = new CrashRecorder({ recall: (_i, out) => out.set([-1]), knocks: () => new Uint8Array(16) });
  rec.begin("flat", HANDLING.realism, false, cars.length, (i) => `c${i}`, 1);
  const world = newWorld(cars);
  world.pairHit = (a, b, hit) => rec.pairHit(a, b, hit);
  world.partTouch = (a, b) => rec.touch(a, b);
  world.partMet = (own, top) => rec.partMet(own, top);
  const trace: Float64Array[] = [];
  const input: DriveInput = { throttle: 0, steer: 0, brake: 0, ebrake: false, boost: false };
  for (let s = 0; s < STEPS; s++) {
    // As the race's `place`: put on the spot, then dressed.
    if (keyStep > 0 && s === keyStep + PLACE_AFTER_KEY) {
      parked.spawnFacing(IMPACT_X, PARKED_Z + PLACE_DZ, 0, 0);
      dress(parked);
    }
    rec.startStep(cars);
    for (const [i, car] of cars.entries()) {
      input.throttle = i === PARKED ? 0 : 1;
      applyDrive(car, input, H);
    }
    stepWorld(world, H);
    rec.endStep(cars, H, world.shape, world.loners);
    settleStep(cars, H, false);
    trace.push(partsOf(parked));
  }
  rec.end();
  assert.ok(rec.ledger.kept.length >= 1, "the head-on crash did not rank as a highlight");
  const kept = rec.ledger.kept[0]!;
  const w = new Writer(clipBytes(kept));
  writeClip(w, kept);
  return { clip: readClip(new Reader().reset(w.done()), carLayout(cars[0]!)), cars, trace, dress };
}

const keyStep = Math.round(record(-1).clip.t0 / H);
const { clip, cars, trace, dress } = record(keyStep);
const parkedSlot = clip.cars.findIndex((c) => c.slot === PARKED);
const placeKey = clip.keyStep.indexOf(PLACE_AFTER_KEY);

describe("given a head-on's clip in which an intact parked car beside it, its mirrors folded by a brush, is put on a spot half a second in", () => {
  it("when the clip is filed, then the parked car rides in it with a keyframe of its own at the respawn, its mirrors folded before it and out after", () => {
    assert.ok(parkedSlot >= 0, `the parked car is a bystander of the clip (its cars: ${clip.cars.map((c) => c.slot).join(",")})`);
    assert.ok(placeKey > 0 && clip.keyCars[placeKey] === 1 << parkedSlot, `the respawn has a keyframe with the parked car alone (keyframes at ${clip.keyStep.join(",")})`);
    const at = keyStep + PLACE_AFTER_KEY;
    assert.notEqual(trace[at - 1]!.join(), trace[at]!.join(), "the respawn put the parked car's parts back to new");
    const parked = cars[PARKED]!;
    assert.ok(!parked.crashed && !parked.deform.massActive, "the parked car is no wreck");
  });

  it("when the clip is replayed, then at every step the parked car's parts state is the live one's, to the bit, the respawn's unfolded mirrors included", () => {
    const sim = new ClipSim(clip, clip.cars.map((c) => cars[c.slot]!), { dress, collide: () => {}, blend: new PoseBlend() });
    sim.restart();
    while (!sim.done) {
      sim.advanceTo(sim.time + 1e-6);
      assertSameNumbers(partsOf(cars[PARKED]!), trace[keyStep + sim.step - 1]!, `the parked car's parts state after the clip's step ${sim.step - 1}`);
    }
  });
});
