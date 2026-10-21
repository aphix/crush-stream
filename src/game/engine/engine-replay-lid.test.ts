import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { applyDrive, type DriveInput } from "../vehicle/car-drive.ts";
import type { CarStyleId } from "../vehicle/car-variants.ts";
import { assignClass, HANDLING, STYLE_CLASS } from "../vehicle/vehicle-classes.ts";
import { LOOSE_STATE_MAX, PART_STATE } from "../vehicle/part-state.ts";
import { assertSameNumbers } from "../vehicle/test-support.ts";
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
 * A rear-end that springs the struck car's lid, and one that tears its tailgate off: the clip, replayed on a peer's own cars, carries
 * the lid's swing (angle, rate, latch, stop load) and, once torn, its flight, to the bit (docs/DOOR_RIG.md, "Lids").
 */
const H = Math.fround(1 / FINE_HZ);
const STEPS = 6 * FINE_HZ;
const STRIKER = 0;
const STRUCK = 1;
/** The struck car stands this far ahead of the striker (m), both facing +x. */
const GAP = 25;

interface Recorded {
  clip: HighlightClip;
  cars: DeformableCar[];
  /** Both cars' poses, then the struck car's parts and loose-body state, after every step. */
  trace: Float64Array[];
  /** Its lid after every step: sprung (off its latch, on the car) and torn off. */
  sprung: boolean[];
  torn: boolean[];
  dress: (car: DeformableCar) => void;
}

/** Numbers the two cars' poses take ahead of the parts state: position and quaternion each. */
const POSES = 14;

function stateOf(cars: readonly DeformableCar[]): Float64Array {
  const out = new Float64Array(POSES + PART_STATE + LOOSE_STATE_MAX);
  for (const [i, car] of cars.entries()) {
    car.group.position.toArray(out, i * 7);
    car.group.quaternion.toArray(out, i * 7 + 3);
  }
  cars[STRUCK]!.partState(out.subarray(POSES, POSES + PART_STATE), false);
  cars[STRUCK]!.looseState(out.subarray(POSES + PART_STATE), false);
  return out;
}

/** The striker (a sedan) and the struck `style`, dressed for the field. */
function carsFor(style: CarStyleId, dress: (car: DeformableCar) => void): DeformableCar[] {
  const scene = new THREE.Scene();
  return [STRIKER, STRUCK].map((i) => {
    const id: CarStyleId = i === STRUCK ? style : "sedan";
    const car = new DeformableCar({ body: 0x808080, accent: 0, name: `c${i}` }, scene, null, id);
    assignClass(car, STYLE_CLASS[id]);
    dress(car);
    return car;
  });
}

/** A sedan driven at `kph` into the back of a parked `style`. */
function record(style: CarStyleId, kph: number): Recorded {
  const { dress } = makeWorld();
  const cars = carsFor(style, dress);
  cars[STRIKER]!.spawnFacing(0, 0, Math.PI / 2, kph / 3.6);
  const struck = cars[STRUCK]!;
  struck.spawnFacing(GAP, 0, Math.PI / 2, 0);
  const rec = new CrashRecorder({ recall: (_i, out) => out.set([-1]), knocks: () => new Uint8Array(16) });
  rec.begin("flat", HANDLING.realism, false, cars.length, (i) => `c${i}`, 1);
  const world = newWorld(cars);
  world.pairHit = (a, b, hit) => rec.pairHit(a, b, hit);
  world.partTouch = (a, b) => rec.touch(a, b);
  world.partMet = (own, top) => rec.partMet(own, top);
  const trace: Float64Array[] = [];
  const sprung: boolean[] = [];
  const torn: boolean[] = [];
  const input: DriveInput = { throttle: 0, steer: 0, brake: 0, ebrake: false, boost: false };
  for (let s = 0; s < STEPS; s++) {
    rec.startStep(cars);
    for (const [i, car] of cars.entries()) {
      // The striker drives in and stands on its brakes once it has hit.
      const driving = i === STRIKER && !car.crashed;
      input.throttle = driving ? 1 : 0;
      input.brake = i === STRIKER && !driving ? 1 : 0;
      applyDrive(car, input, H);
    }
    stepWorld(world, H);
    rec.endStep(cars, H, world.shape, world.loners);
    settleStep(cars, H, false);
    trace.push(stateOf(cars));
    sprung.push(!struck.lidOff() && !struck.lidHinge().latched);
    torn.push(struck.lidOff());
  }
  rec.end();
  assert.ok(rec.ledger.kept.length >= 1, "the rear-end did not rank as a highlight");
  const kept = rec.ledger.kept[0]!;
  const w = new Writer(clipBytes(kept));
  writeClip(w, kept);
  return { clip: readClip(new Reader().reset(w.done()), carLayout(cars[0]!)), cars, trace, sprung, torn, dress };
}

function replays(r: Recorded, label: string): void {
  const keyStep = Math.round(r.clip.t0 / H);
  const peer = carsFor(r.cars[STRUCK]!.style.id, r.dress);
  const sim = new ClipSim(r.clip, r.clip.cars.map((c) => peer[c.slot]!), { dress: r.dress, collide: () => {}, blend: new PoseBlend() });
  sim.restart();
  while (!sim.done) {
    sim.advanceTo(sim.time + 1e-6);
    assertSameNumbers(stateOf(peer), r.trace[keyStep + sim.step - 1]!, `${label}: the cars' poses and the struck car's parts after the clip's step ${sim.step - 1}`);
  }
}

describe("given a rear-end that springs the struck sedan's trunk lid", () => {
  const r = record("sedan", 60);
  const keyStep = Math.round(r.clip.t0 / H);

  it("when the clip is filed, then the struck car rides in it and its lid swings open during it, still on the car", () => {
    assert.ok(r.clip.cars.some((c) => c.slot === STRUCK), "the struck car is in the clip");
    assert.ok(r.sprung.slice(keyStep).some((s) => s), "the lid never left its latch in the clip");
    assert.ok(!r.torn[r.torn.length - 1], "the lid tore off");
  });

  it("when the clip is replayed, then at every step the struck car's parts state, the lid's swing included, is the live one's to the bit", () => {
    replays(r, "sprung lid");
  });
});

describe("given a hard rear-end that tears the struck pickup's tailgate off", () => {
  const r = record("pickup", 110);
  const keyStep = Math.round(r.clip.t0 / H);

  it("when the clip is filed, then the tailgate leaves the car during it", () => {
    assert.ok(!r.torn[keyStep] && r.torn[r.torn.length - 1], `torn at the keyframe ${r.torn[keyStep]}, at the end ${r.torn[r.torn.length - 1]}`);
  });

  it("when the clip is replayed, then at every step the struck car's parts and loose bodies, the torn gate's flight included, are the live ones to the bit", () => {
    replays(r, "torn gate");
  });
});
