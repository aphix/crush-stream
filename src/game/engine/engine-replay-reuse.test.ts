import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { applyDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { assignClass, HANDLING, STYLE_CLASS } from "../vehicle/vehicle-classes.ts";
import { LOOSE_STATE_MAX, PART_STATE } from "../vehicle/part-state.ts";
import { assertSameNumbers } from "../vehicle/test-support.ts";
import { Reader, Writer } from "../net/codec.ts";
import { carLayout } from "../net/car-pose.ts";
import { clipBytes, readClip, writeClip } from "../net/reel-codec.ts";
import { makeWorld } from "../world/race-world.test-util.ts";
import { newWorld, settleStep, stepWorld } from "./world-step.ts";
import { CrashRecorder } from "./engine-record.ts";
import { ClipSim } from "./engine-replay.ts";
import { PoseBlend } from "../present/pose-blend.ts";
import { FINE_HZ } from "../kernel/constants.ts";

/**
 * A head-on that pops a wheel and tears the front bumper off both sedans after the clip's keyframe, replayed on the cars that recorded it, as
 * every reel replays on the field's own cars: where those bodies slept, their dents and their box in the recording run must not carry into the replay.
 */
const H = Math.fround(1 / FINE_HZ);
const STEPS = 6 * FINE_HZ;
const SPEED = 60 / 3.6;
/** The second car starts this far down the road (m) and this far off the first's line, so the two do not meet square. */
const GAP = 40;
const OFFSET = 0.4;
/** Per car: its pose (position, quaternion), then its parts' keyframe state, then its loose bodies'. */
const POSE = 7;
const EACH = POSE + PART_STATE + LOOSE_STATE_MAX;

function stateOf(cars: readonly DeformableCar[]): Float64Array {
  const out = new Float64Array(cars.length * EACH);
  for (const [i, car] of cars.entries()) {
    const o = i * EACH;
    car.group.position.toArray(out, o);
    car.group.quaternion.toArray(out, o + 3);
    car.partState(out.subarray(o + POSE, o + POSE + PART_STATE), false);
    car.looseState(out.subarray(o + POSE + PART_STATE, o + EACH), false);
  }
  return out;
}

function sedans(dress: (car: DeformableCar) => void): DeformableCar[] {
  const scene = new THREE.Scene();
  return [0, 1].map((i) => {
    const car = new DeformableCar({ body: 0x808080, accent: 0, name: `c${i}` }, scene, null, "sedan");
    assignClass(car, STYLE_CLASS.sedan);
    dress(car);
    return car;
  });
}

/** A loose body (a part by name, a wheel by index), the step it first lay off its car, and whether it lies asleep and its dents at the end of the run. */
type Torn = { name: string; step: number; asleep: boolean; dents: number };

/** The loose bodies of `car` that left it after step `key`. */
function tornAfter(car: DeformableCar, firstOff: Map<string, number>, key: number): Torn[] {
  const out: Torn[] = [];
  for (const p of car["parts"]) if (p.detached && firstOff.get(p.name)! > key) out.push({ name: p.name, step: firstOff.get(p.name)!, asleep: p.shape.asleep, dents: p.dent.count });
  for (const [k, w] of car["looseWheels"].entries()) if (w.loose && firstOff.get(`wheel${k}`)! > key) out.push({ name: `wheel${k}`, step: firstOff.get(`wheel${k}`)!, asleep: w.shape.asleep, dents: 0 });
  return out;
}

function noteOff(car: DeformableCar, firstOff: Map<string, number>, s: number): void {
  for (const p of car["parts"]) if (p.detached && !firstOff.has(p.name)) firstOff.set(p.name, s);
  for (const [k, w] of car["looseWheels"].entries()) if (w.loose && !firstOff.has(`wheel${k}`)) firstOff.set(`wheel${k}`, s);
}

function record() {
  const { dress } = makeWorld();
  const cars = sedans(dress);
  cars[0]!.spawnFacing(0, 0, Math.PI / 2, SPEED);
  cars[1]!.spawnFacing(GAP, OFFSET, -Math.PI / 2, SPEED);
  const rec = new CrashRecorder({ recall: (_i, out) => out.set([-1]), knocks: () => new Uint8Array(16) });
  rec.begin("flat", HANDLING.realism, false, cars.length, (i) => `c${i}`, 1);
  const world = newWorld(cars);
  world.pairHit = (a, b, hit) => rec.pairHit(a, b, hit);
  world.partTouch = (a, b) => rec.touch(a, b);
  world.partMet = (own, top) => rec.partMet(own, top);
  const trace: Float64Array[] = [];
  const firstOff = cars.map(() => new Map<string, number>());
  const input: DriveInput = { throttle: 1, steer: 0, brake: 0, ebrake: false, boost: false };
  for (let s = 0; s < STEPS; s++) {
    rec.startStep(cars);
    for (const car of cars) applyDrive(car, input, H);
    stepWorld(world, H);
    rec.endStep(cars, H, world.shape, world.loners);
    settleStep(cars, H, false);
    trace.push(stateOf(cars));
    for (const [i, car] of cars.entries()) noteOff(car, firstOff[i]!, s);
  }
  rec.end();
  assert.ok(rec.ledger.kept.length >= 1, "the head-on did not rank as a highlight");
  const kept = rec.ledger.kept[0]!;
  const w = new Writer(clipBytes(kept));
  writeClip(w, kept);
  const clip = readClip(new Reader().reset(w.done()), carLayout(cars[0]!));
  const keyStep = Math.round(clip.t0 / H);
  return { clip, cars, trace, dress, keyStep, torn: cars.flatMap((car, i) => tornAfter(car, firstOff[i]!, keyStep)) };
}

describe("given a head-on that pops a wheel and tears the front bumper off both sedans after its clip's keyframe, where they then fell asleep and were dented", () => {
  const r = record();

  function replayOn(on: DeformableCar[], label: string): void {
    const sim = new ClipSim(r.clip, r.clip.cars.map((c) => on[c.slot]!), { dress: r.dress, collide: () => {}, blend: new PoseBlend() });
    sim.restart();
    while (!sim.done) {
      sim.advanceTo(sim.time + 1e-6);
      assertSameNumbers(stateOf(on), r.trace[r.keyStep + sim.step - 1]!, `${label}: poses, parts and loose bodies after the clip's step ${sim.step - 1}`);
    }
  }

  it("when the clip is filed, then bodies leave the cars after its keyframe, and by the run's end one lies asleep and one is dented", () => {
    const list = r.torn.map((t) => `${t.name}@${t.step}${t.asleep ? " asleep" : ""} dents ${t.dents}`).join(", ");
    assert.ok(r.clip.cars.length === 2, `the clip's cars: ${r.clip.cars.length}`);
    assert.ok(r.torn.some((t) => t.asleep) && r.torn.some((t) => t.dents > 0), `torn after the keyframe at step ${r.keyStep}: ${list}`);
  });

  it("when the clip is replayed on freshly built cars, then at every step their poses, parts and loose bodies are the recording's to the bit", () => {
    replayOn(sedans(r.dress), "fresh cars");
  });

  it("when the clip is replayed on the cars that recorded it, then at every step their poses, parts and loose bodies (asleep, where they sleep, dents, box, rest timer) are the recording's to the bit", () => {
    replayOn(r.cars, "the recording's cars");
  });
});
