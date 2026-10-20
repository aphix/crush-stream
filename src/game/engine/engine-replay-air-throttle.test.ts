import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { applyDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { assignClass, HANDLING } from "../vehicle/vehicle-classes.ts";
import { assertSameNumbers } from "../vehicle/test-support.ts";
import { fleetClass, fleetStyle } from "../scenes/fleet.ts";
import { Reader, Writer } from "../net/codec.ts";
import { carLayout } from "../net/car-pose.ts";
import { clipBytes, readClip, writeClip } from "../net/reel-codec.ts";
import { makeWorld } from "../world/race-world.test-util.ts";
import { newWorld, settleStep, stepWorld } from "./world-step.ts";
import { CrashRecorder } from "./engine-record.ts";
import { ClipSim } from "./engine-replay.ts";
import { PoseBlend } from "../present/pose-blend.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import type { HighlightClip } from "../match/highlights.ts";

const H = Math.fround(1 / FINE_HZ);
const STEPS = 4 * FINE_HZ;
const A = 0;
const B = 1;
const FLIER = 2;
const IMPACT_X = 30;
const FLIER_Z = 20;
/** Metres the flier starts above the road: a fall of about 5 s, longer than the recording, so it flies all of it. */
const LIFT_M = 130;

/** A head-on in a flat field with a car beside it falling from high up, its driver's foot flat down: the clip as a peer decodes it, the cars, and the flier's wheels after every step. */
function record(): { clip: HighlightClip; cars: DeformableCar[]; trace: Float64Array[]; dress: (car: DeformableCar) => void; flierAirborne: boolean } {
  const { dress } = makeWorld();
  const scene = new THREE.Scene();
  const cars = [A, B, FLIER].map((i) => {
    const car = new DeformableCar({ body: 0x808080, accent: 0, name: `c${i}` }, scene, null, fleetStyle(i));
    assignClass(car, fleetClass(i));
    dress(car);
    return car;
  });
  cars[A]!.spawnFacing(0, 0, Math.PI / 2, 15);
  cars[B]!.spawnFacing(2 * IMPACT_X, 0, -Math.PI / 2, 15);
  const flier = cars[FLIER]!;
  flier.spawnFacing(IMPACT_X, FLIER_Z, 0, 0);
  flier.group.position.y += LIFT_M;
  const rec = new CrashRecorder({ recall: (_i, out) => out.set([-1]), knocks: () => new Uint8Array(16) });
  rec.begin("flat", HANDLING.realism, false, cars.length, (i) => `c${i}`, 1);
  const world = newWorld(cars);
  world.pairHit = (a, b, hit) => rec.pairHit(a, b, hit);
  world.partTouch = (a, b) => rec.touch(a, b);
  world.partMet = (own, top) => rec.partMet(own, top);
  const trace: Float64Array[] = [];
  const input: DriveInput = { throttle: 1, steer: 0, brake: 0, ebrake: false, boost: false };
  for (let s = 0; s < STEPS; s++) {
    rec.startStep(cars);
    for (const car of cars) applyDrive(car, input, H);
    stepWorld(world, H);
    rec.endStep(cars, H, world.shape, world.loners);
    settleStep(cars, H, false);
    trace.push(Float64Array.of(...flier.wheelRate, ...flier["wheelSpin"]));
  }
  const flierAirborne = flier.airborne;
  rec.end();
  assert.ok(rec.ledger.kept.length >= 1, "the head-on crash did not rank as a highlight");
  const kept = rec.ledger.kept[0]!;
  const w = new Writer(clipBytes(kept));
  writeClip(w, kept);
  return { clip: readClip(new Reader().reset(w.done()), carLayout(cars[0]!)), cars, trace, dress, flierAirborne };
}

const { clip, cars, trace, dress, flierAirborne } = record();
const keyStep = Math.round(clip.t0 / H);
const flierSlot = clip.cars.findIndex((c) => c.slot === FLIER);

describe("given a head-on's clip with a car beside it in the air the whole clip, its driver holding the throttle down", () => {
  it("when the clip is filed, then the flier rides in it, still in the air at the end, its gas having wound its wheels", () => {
    assert.ok(flierSlot >= 0, `the flier is a bystander of the clip (its cars: ${clip.cars.map((c) => c.slot).join(",")})`);
    assert.ok(flierAirborne, "the flier landed during the recording");
    assert.ok(trace[STEPS - 1]![0] !== 0, "the held gas left the flier's front-left wheel still");
  });

  it("when the clip is replayed, then at every step the flier's drawn wheels' rate and turn are the live ones, to the bit", () => {
    const sim = new ClipSim(clip, clip.cars.map((c) => cars[c.slot]!), { dress, collide: () => {}, blend: new PoseBlend() });
    sim.restart();
    while (!sim.done) {
      sim.advanceTo(sim.time + 1e-6);
      const flier = cars[FLIER]!;
      assertSameNumbers(Float64Array.of(...flier.wheelRate, ...flier["wheelSpin"]), trace[keyStep + sim.step - 1]!, `the flier's wheels' rate and turn after the clip's step ${sim.step - 1}`);
    }
  });
});
