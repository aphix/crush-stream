import { beforeAll, describe, expect, it } from "vitest";
import { launch, makeCar, makeWorld } from "../contact/crash-scenarios.test-util.ts";
import { blankStrike, type FigureStrike } from "../scenes/figure-strike.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import type { HighlightClip } from "../match/highlights.ts";
import { PoseBlend } from "../present/pose-blend.ts";
import { CrashRecorder } from "./engine-record.ts";
import { ClipSim } from "./engine-replay.ts";
import { settleStep, stepWorld } from "./world-step.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import { must } from "../kernel/must.test-util.ts";

/**
 * Figures run down, through the recorder and a clip's replay: slot 0 stands 400 m off (a car the clip leaves out), slots 1 and 2
 * crash head-on 0.5 s in. The recorder is told of each strike at its step; the clip carries those of its own cars.
 */
const H = 1 / FINE_HZ;
const FAR = 0;
const PAIR = [1, 2];
const FIGURE_KEYS = ["guard", "car", "x", "y", "z", "faceX", "faceZ", "vx", "vy", "vz", "wx", "wy", "wz"] as const;

/** Strikes in the order the loop reports them, `car` the race slot; `step` the race step the recorder is told in. */
const STRIKES: { step: number; guard: number; car: number; x: number }[] = [
  { step: 100, guard: 3, car: 2, x: 11.5 },
  { step: 150, guard: 8, car: FAR, x: -2.25 },
  { step: 200, guard: -1, car: 1, x: 7.75 },
];

function figure(guard: number, car: number, x: number): FigureStrike {
  return { ...blankStrike(), guard, car, x, y: 0.25, z: -6.5, faceX: 0.5, faceZ: -0.875, vx: 9.5, vy: 1.5, vz: -4.25, wx: 0.75, wy: 0, wz: 2.125 };
}

/** A race run: the first clip it kept (if any), the cars, how many clips, the recorder. */
type Recorded = { clip: HighlightClip | undefined; cars: DeformableCar[]; clips: number; rec: CrashRecorder };

/** The recorder (a new one unless given) over three cars for 4 s, told of `strikes` at their steps from one reused scratch record (as the engine's lawn does). */
function record(strikes: typeof STRIKES, crash: boolean, rec = new CrashRecorder()): Recorded {
  const cars = [makeCar(), makeCar(), makeCar()];
  launch(cars[FAR]!, 0, 400, Math.PI / 2, 0, 0);
  if (crash) {
    launch(cars[1]!, -5, 0, Math.PI / 2, 10, 0);
    launch(cars[2]!, 5, 0, -Math.PI / 2, -10, 0);
  } else {
    launch(cars[1]!, -5, 0, Math.PI / 2, 0, 0);
    launch(cars[2]!, 5, 0, -Math.PI / 2, 0, 0);
  }
  const w = makeWorld(cars, false, false, null);
  rec.begin("flat", 0.35, false, cars.length, (i) => `c${i}`, 1);
  w.world.pairHit = (a, b, hit) => rec.pairHit(a, b, hit);
  const scratch = blankStrike();
  for (let s = 0; s < 4 / H; s++) {
    rec.startStep(cars);
    for (const x of strikes) if (x.step === s) rec.strike(Object.assign(scratch, figure(x.guard, x.car, x.x)));
    stepWorld(w.world, H);
    rec.endStep(cars, H, w.world.shape, w.world.loners);
    settleStep(cars, H, false);
    for (const car of cars) car.updateSkin();
  }
  rec.end();
  return { clip: rec.ledger.kept[0], cars, clips: rec.ledger.kept.length, rec };
}

describe("given a head-on crash of two cars with a third car 400 m off, and the recorder told of three figures run down", () => {
  let run: Recorded;
  let clip: HighlightClip;
  let firstStep: number;
  beforeAll(() => {
    run = record(STRIKES, true);
    must(run.clip, "the head-on made no clip");
    clip = run.clip;
    firstStep = Math.round(clip.t0 / H);
  });

  it("when the clip is filed, then it carries the carried cars' two strikes in step order and leaves out the third car's", () => {
    expect(clip.strikes.length, "strikes in the clip").toBe(2);
    expect(clip.cars.length, "the clip's car count").toBe(PAIR.length);
    for (const [i, slot] of PAIR.entries()) expect(clip.cars[i]!.slot, `clip car ${i}`).toBe(slot);
  });

  const kept = [
    { it: "when the first listed strike is read, then it is slot 2's at its step with the car remapped to the clip's index 1", at: 0, source: 0, expectedCar: 1 },
    { it: "when the second listed strike is read, then it is slot 1's (the VIP's guard index -1) at its step with the car remapped to the clip's index 0", at: 1, source: 2, expectedCar: 0 },
  ] as const;
  for (const testCase of kept) {
    it(testCase.it, () => {
      const got = clip.strikes[testCase.at]!;
      const want = figure(STRIKES[testCase.source]!.guard, testCase.expectedCar, STRIKES[testCase.source]!.x);
      expect(got.step, "step").toBe(STRIKES[testCase.source]!.step - firstStep);
      for (const key of FIGURE_KEYS) expect(got.s[key], key).toBe(want[key]);
    });
  }

  it("when the clip's strikes are replayed as a peer does, then each is handed once at the step it ran in with the car as the engine slot, and again after a restart", () => {
    const sim = new ClipSim(clip, clip.cars.map((c) => run.cars[c.slot]!), { dress: () => {}, collide: () => {}, blend: new PoseBlend() });
    const handed: { step: number; guard: number; car: number }[][] = [];
    for (let pass = 0; pass < 2; pass++) {
      sim.restart();
      const inPass: { step: number; guard: number; car: number }[] = [];
      while (!sim.done) {
        sim.advanceTo(sim.time + 1e-6);
        for (const s of sim.takeStrikes()) inPass.push({ step: sim.step - 1, guard: s.guard, car: s.car });
        expect(sim.takeStrikes().length, "a second take in the same step is empty").toBe(0);
      }
      handed.push(inPass);
    }
    for (const pass of handed) {
      expect(pass.length, "strikes handed in a pass").toBe(2);
      for (const [k, x] of clip.strikes.entries()) {
        expect(pass[k]!.step, `strike ${k} step`).toBe(x.step);
        expect(pass[k]!.guard, `strike ${k} guard`).toBe(x.s.guard);
        expect(pass[k]!.car, `strike ${k} car`).toBe(clip.cars[x.s.car]!.slot);
      }
    }
  });

  it("when the recorder is told of strikes and a race resets, then the next race's clip carries none of them", () => {
    const again = record([], true, run.rec);
    must(again.clip, "the head-on made no clip");
    expect(again.clip.strikes.length, "strikes in a clip of a race told of none").toBe(0);
  });
});

describe("given three cars that never meet, and the recorder told of a figure run down", () => {
  it("when the race ends, then the strike made no clip, while the same strikes beside a crash ride in one", () => {
    const quiet = record(STRIKES, false);
    expect(quiet.clips, "clips of a strike alone").toBe(0);
    const crash = record(STRIKES, true);
    expect(crash.clips, "clips of the crash").toBe(1);
    expect(crash.clip!.strikes.length, "strikes riding in it").toBe(2);
  });
});
