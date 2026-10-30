import { describe, expect, it } from "vitest";
import { launch, makeCar, makeWorld } from "../contact/crash-scenarios.test-util.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import type { HighlightClip } from "../match/highlights.ts";
import { HIT_MIRROR } from "../vehicle/car-core.ts";
import { applyHit } from "../present/ragdoll-wire.ts";
import { PoseBlend } from "../present/pose-blend.ts";
import { CrashRecorder } from "./engine-record.ts";
import { ClipSim } from "./engine-replay.ts";
import { settleStep, stepWorld } from "./world-step.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import { must } from "../kernel/must.test-util.ts";

/**
 * A hit from the dummies' world on a car's part, through the recorder and a clip's replay: two cars crash head-on 0.5 s in, and after the
 * race's step `HIT_STEP - 1` ran, the sim applies a crate's blow on car 0's left mirror (`applyHit`, as `RagdollSystem` does between frames).
 */
const H = 1 / FINE_HZ;
const HIT_STEP = 300;
/** A crate's blow on the mirror (J) and its push (world m/s), past `MIRROR_BREAK_J`. */
const BLOW = { car: 0, part: HIT_MIRROR, energy: 135, x: -3, y: 0, z: 0 };

/** The race over two cars for 2 s, recorded, the blow applied (`hit`) after step `HIT_STEP - 1`: the first clip it kept, and the cars. */
function record(hit: boolean): { clip: HighlightClip | undefined; cars: DeformableCar[] } {
  const cars = [makeCar(), makeCar()];
  launch(cars[0]!, -5, 0, Math.PI / 2, 10, 0);
  launch(cars[1]!, 5, 0, -Math.PI / 2, -10, 0);
  const w = makeWorld(cars, false, false, null);
  const rec = new CrashRecorder();
  rec.begin("flat", 0.35, false, cars.length, (i) => `c${i}`, 1);
  w.world.pairHit = (a, b, h) => rec.pairHit(a, b, h);
  for (let s = 0; s < 2 / H; s++) {
    rec.startStep(cars);
    stepWorld(w.world, H);
    rec.endStep(cars, H, w.world.shape, w.world.loners);
    settleStep(cars, H, false);
    if (hit && s === HIT_STEP - 1) applyHit(BLOW, cars, (car, part, energy, push) => rec.partHit(car, part, energy, push.x, push.y, push.z));
  }
  rec.end();
  return { clip: rec.ledger.kept[0], cars };
}

/** Each step of a replay of `clip` over `cars`, whether car 0's left mirror is off after it. */
function replayed(clip: HighlightClip, cars: DeformableCar[]): boolean[] {
  const sim = new ClipSim(clip, clip.cars.map((c) => cars[c.slot]!), { dress: () => {}, collide: () => {}, blend: new PoseBlend() });
  sim.restart();
  const off: boolean[] = [];
  while (!sim.done) {
    sim.advanceTo(sim.time + 1e-6);
    off[sim.step - 1] = cars[0]!.partOff("mirrorL");
  }
  return off;
}

describe("given a head-on crash, and a crate's blow on a car's mirror that the sim applied from the dummies' world", () => {
  it("when the clip is replayed with no dummies' world, then the mirror leaves at the clip step it left at in the race, and not before", () => {
    const run = record(true);
    must(run.clip, "the head-on made no clip");
    expect(run.cars[0]!.partOff("mirrorL"), "the race's blow knocked the mirror off").toBe(true);
    const at = HIT_STEP - Math.round(run.clip.t0 / H);
    expect(run.clip.partHits.length, "the clip's part hits").toBe(1);
    expect(run.clip.partHits[0]!.step, "the part hit's clip step").toBe(at);
    expect(replayed(run.clip, run.cars).indexOf(true), "the first replayed step with the mirror off").toBe(at);
  });

  it("when the race had no blow, then its clip's replay keeps the mirror on", () => {
    const run = record(false);
    must(run.clip, "the head-on made no clip");
    expect(replayed(run.clip, run.cars).includes(true), "a mirror off in the replay").toBe(false);
  });
});
