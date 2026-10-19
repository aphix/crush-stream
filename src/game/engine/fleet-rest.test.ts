import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { setGround } from "../world/ground.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";
import { loadEpicenter } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { CAGE_STEP } from "../vehicle/car-cage.ts";
import { satCars } from "../contact/sat.ts";
import type { DeformableCar } from "../vehicle/car.ts";

/**
 * The owner's fleet capture (sedan, hatchback, wagon, coupe, pickup from its seed) replayed on the real engine with a fixed pacer and 60 Hz frames jittered 40 %. The crash pops the hatchback's front
 * hubs and leaves its sill 44 mm in the road: it must rise out of it without the 21 Hz hop, sleep, and no two cars may rest inside each other.
 */
/** Slot of the hatchback in the fleet's style order. */
const HATCH = 1;
/** The sim window (s) the hatchback is read in, and the second from which the crash is over. */
const FROM = 1.4;
const TO = 3.5;
const SETTLED = 2;
/** Frame length varies by this share either way: the crash after the first contact depends on the frame schedule, so two seeds. */
const JITTER = 0.4;
const SEEDS = [1, 3];
/** A turn of the hatchback's height under this (mm) is rounding; the rise out of the road moves it 0.2 mm a slice. */
const TURN_MM = 0.3;
/** The rise out of the road is monotone: at most this many turns of its height. */
const MAX_TURNS = 2;
/** The hatchback sleeps by this sim second (the hop kept it awake past 2.9 s). */
const SLEEPS_BY = 2.7;
/** The most (m) two settled cars overlap: the resolution of the cage outlines. */
const MAX_OVERLAP = CAGE_STEP;

const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
let shared: any;

async function engineOnce(): Promise<any> {
  if (shared) return shared;
  stubBrowser();
  shared = new CrashEngine(element(), new HudStore(), element());
  Object.assign(shared["renderer"], { render() {}, compile() {}, compileAsync: () => Promise.resolve() });
  await shared.ready;
  const throwDriver = shared.throwDriver.bind(shared);
  // The live game's dummy world calls `onThrow` at once (the slow-mo lifts for the driver's exit); headless has none.
  shared.throwDriver = (e: { car: DeformableCar }, ...rest: unknown[]) => {
    throwDriver(e, ...rest);
    shared.onThrow(e.car);
  };
  return shared;
}

async function replay(seed: number): Promise<{ turns: number; asleepAt: number; overlap: number }> {
  const engine = await engineOnce();
  loadEpicenter(EPICENTER_AT_LOAD);
  engine.setCarCount(5);
  engine.setSpeedRange(10, 32);
  engine.setSquash(0.32);
  engine.setBuckle(0.45);
  engine.setRealism(0.25);
  engine.pinnedSeed = 12641919;
  engine.reset();
  engine.pace.now = () => 0;
  engine.pace.pin = false;
  const cars: DeformableCar[] = engine.live();
  const hatch = cars[HATCH]!;
  let turns = 0;
  let lastDy = 0;
  let lastY = NaN;
  let asleepAt = -1;
  let overlap = 0;
  const original = engine.slice;
  const slice = original.bind(engine);
  engine.slice = (h: number) => {
    slice(h);
    const t = engine.elapsedSim as number;
    if (t < FROM || t > TO) return;
    if (t >= SETTLED) {
      for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) overlap = Math.max(overlap, satCars(cars[i]!, cars[j]!, _n, _p, 0) ?? 0);
    }
    const y = hatch.group.position.y * 1000;
    const dy = y - lastY;
    if (Math.abs(dy) > TURN_MM) {
      if (lastDy * dy < 0) turns++;
      lastDy = dy;
    }
    lastY = y;
    if (hatch.asleep && asleepAt < 0) asleepAt = t;
    else if (!hatch.asleep) asleepAt = -1;
  };
  let state = seed >>> 0;
  const random = (): number => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  try {
    while ((engine.elapsedSim as number) < TO + 0.01) {
      const dt = (1 / FRAME_HZ) * (1 + JITTER * (random() * 2 - 1));
      engine.advance(dt, { frameDt: dt });
    }
  } finally {
    engine.slice = original;
  }
  return { turns, asleepAt, overlap };
}

describe("given the owner's fleet capture replayed on the engine", () => {
  after(() => {
    setGround(null);
    shared?.dispose();
  });
  for (const seed of SEEDS) {
    it(`when the frames' jitter is seed ${seed}, then the hatchback rises out of the road without a hop, sleeps by ${SLEEPS_BY} s, and no two cars rest more than ${MAX_OVERLAP * 100} cm into each other`, async () => {
      const { turns, asleepAt, overlap } = await replay(seed);
      assert.ok(turns <= MAX_TURNS, `the hatchback's height turned ${turns} times in ${FROM}-${TO} s`);
      assert.ok(asleepAt >= 0 && asleepAt <= SLEEPS_BY, `the hatchback fell asleep at ${asleepAt.toFixed(2)} s (-1: never)`);
      assert.ok(overlap <= MAX_OVERLAP, `two cars stood ${(overlap * 100).toFixed(1)} cm into each other after ${SETTLED} s`);
    });
  }
});
