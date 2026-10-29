import { afterAll, beforeAll, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import "../kernel/rapier-node.test-util.ts";
import type { ContactHit, PredictedHit } from "../scenes/engine-props.ts";
import { setGround } from "../world/ground.ts";
import { bodyGap, FUDGE_FULL, FUDGE_NONE, type PhaseClock } from "../match/phase.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import type * as THREE from "three";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const FRAME = 1 / FRAME_HZ;

/** The parts of the engine this file reaches: its crash clock, its pair-contact hook, its live cars and its predicted hit. */
type Reach = {
  clock: PhaseClock;
  pairHit(a: number, b: number, hit: ContactHit): void;
  live(): DeformableCar[];
  predicted: PredictedHit;
};

/** The real engine booted headless for one describe (`before`), disposed after it: the returned call reaches it. */
function booted(): () => { engine: CrashEngine; e: Reach } {
  let engine: CrashEngine | null = null;
  beforeAll(async () => {
    stubBrowser();
    engine = await bootEngine();
    engine["looping"] = false;
  });
  afterAll(() => {
    engine?.dispose();
    setGround(null);
  });
  return () => ({ engine: engine!, e: engine! as unknown as Reach });
}

/** Live car `k` at (x, z) facing `yaw`, at `speed` m/s along it. */
function place(e: Reach, k: number, x: number, z: number, yaw: number, speed: number): void {
  const car = e.live()[k]!;
  car.spawnFacing(x, z, yaw, 0);
  car.velocity.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
  car.speed = speed;
  car.spawnSpeed = speed;
}

/** Every live car parked in a row well clear of the origin, where the hit is staged. */
function parkAll(e: Reach): void {
  for (const [k] of e.live().entries()) place(e, k, 8 * k - 16, 60 + 8 * k, 0, 0);
}

type Watched = { widest: number; lopsided: boolean; early: number[] };

/**
 * Frames until `touched()`: the farthest gap (m, `gaps`: the hit's nearest and farthest drawn body) of every spark and debris burst thrown before it,
 * the widest farthest gap at the predicted point while the slow-mo eased in, and whether the nearest stood within `FUDGE_FULL` with the farthest `FUDGE_NONE` or more off.
 */
function watch(engine: CrashEngine, e: Reach, gaps: (x: number, z: number) => [number, number], touched: () => boolean): Watched {
  const seen: Watched = { widest: 0, lopsided: false, early: [] };
  const sparks = engine["sparks"];
  const debris = engine["debris"];
  const poof = sparks.poof.bind(sparks);
  const burst = debris.burst.bind(debris);
  vi.spyOn(sparks, "poof").mockImplementation((at: THREE.Vector3, n: THREE.Vector3, count: number) => {
    if (!touched()) seen.early.push(gaps(at.x, at.z)[1]);
    poof(at, n, count);
  });
  vi.spyOn(debris, "burst").mockImplementation((at: THREE.Vector3, n: THREE.Vector3, count: number) => {
    if (!touched()) seen.early.push(gaps(at.x, at.z)[1]);
    burst(at, n, count);
  });
  try {
    for (let f = 0; f < 600 && !touched(); f++) {
      engine.advance(FRAME, { frameDt: FRAME });
      if (touched() || e.clock.timeScale >= 1) continue;
      const [near, far] = gaps(e.predicted.x, e.predicted.z);
      seen.widest = Math.max(seen.widest, far);
      seen.lopsided ||= near <= FUDGE_FULL && far >= FUDGE_NONE;
    }
  } finally {
    vi.restoreAllMocks();
  }
  return seen;
}

/** The slow-mo began with the farthest body `FUDGE_NONE` or more off the point; no burst came before the touch with it that far, and one came as it reached the point. */
function assertGated(seen: Watched): void {
  assert.ok(seen.widest >= FUDGE_NONE, `the farther body was only ${seen.widest.toFixed(2)} m off the predicted point while the slow-mo eased in: nothing for the gate to hold back`);
  assert.ok(seen.early.length >= 1, "no burst as the cars reached the point");
  const far = seen.early.filter((g) => g >= FUDGE_NONE);
  assert.equal(far.length, 0, `${far.length} of ${seen.early.length} bursts before the touch with the farther drawn body ${far.map((g) => g.toFixed(2)).join(", ")} m off (none from ${FUDGE_NONE} m)`);
}

describe("given the real engine's fleet sandbox with auto slow-mo on, a car parked and another sent at it at 24 m/s from 16 m off", () => {
  const box = booted();

  it("when the pre-impact slow-mo eases in, then no spark or debris burst comes before the cars touch until both drawn bodies are within FUDGE_NONE of the point, though the parked car's stands on it, and one still comes as they reach it", () => {
    const { engine, e } = box();
    parkAll(e);
    place(e, 0, 6, 0, -Math.PI / 2, 0);
    place(e, 1, -10, 0, Math.PI / 2, 24);
    const cars = e.live();
    const gaps = (x: number, z: number): [number, number] => {
      const a = bodyGap(cars[0]!, x, z);
      const b = bodyGap(cars[1]!, x, z);
      return [Math.min(a, b), Math.max(a, b)];
    };
    let touched = false;
    const pairHit = e.pairHit;
    e.pairHit = (a, b, hit) => {
      if (Math.min(a, b) === 0 && Math.max(a, b) === 1) touched = true;
      pairHit(a, b, hit);
    };
    let seen: Watched;
    try {
      seen = watch(engine, e, gaps, () => touched);
    } finally {
      e.pairHit = pairHit;
    }
    assert.ok(touched, "the pair never touched");
    assert.ok(seen.lopsided, `no moment with the parked car on the predicted point and the other ${FUDGE_NONE} m or more off: the case is not staged`);
    assertGated(seen);
  });
});
