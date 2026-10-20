import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";
import { loadEpicenter } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { satCars } from "../contact/sat.ts";

/**
 * The owner's fleet capture (sedan, hatchback, wagon, coupe, pickup from its seed) replayed on the real engine with a fixed pacer and 60 Hz frames jittered 40 %
 * (`fleet-rest.test.ts`, `fleet-rest-sleep.test.ts`). The crash pops the hatchback's front hubs and leaves its sill 44 mm in the road. Not a test file itself.
 */
/** Slot of the hatchback in the fleet's style order. */
const HATCH = 1;
/** The sim window (s) the hatchback is read in, and the second from which the crash is over. */
export const FROM = 1.4;
export const TO = 3.5;
export const SETTLED = 2;
/** Frame length varies by this share either way: the crash after the first contact depends on the frame schedule. */
const JITTER = 0.4;
/** A turn of the hatchback's height under this (mm) is rounding; the rise out of the road moves it 0.2 mm a slice. */
const TURN_MM = 0.3;

const _n = new THREE.Vector3();
const _p = new THREE.Vector3();

/** A headless engine for the replays; one per test process (a second one made after the first is disposed never resolves `ready`). */
export async function makeEngine(): Promise<CrashEngine> {
  stubBrowser();
  const engine = new CrashEngine(element(), new HudStore(), element());
  Object.assign(engine["renderer"], { render() {}, compile() {}, compileAsync: () => Promise.resolve() });
  await engine.ready;
  const throwDriver = engine["throwDriver"].bind(engine);
  // The live game's dummy world calls `onThrow` at once (the slow-mo lifts for the driver's exit); headless has none.
  engine["throwDriver"] = (...args: Parameters<typeof throwDriver>) => {
    throwDriver(...args);
    engine["onThrow"](args[0].car);
  };
  return engine;
}

/** The capture replayed on `engine` with jitter seed `seed`: the hatchback's height turns, when it fell asleep for good (-1: never) and the deepest two settled cars stood in each other (m). */
export async function replay(engine: CrashEngine, seed: number): Promise<{ turns: number; asleepAt: number; overlap: number }> {
  loadEpicenter(EPICENTER_AT_LOAD);
  engine.setCarCount(5);
  engine.setSpeedRange(10, 32);
  engine.setSquash(0.32);
  engine.setBuckle(0.45);
  engine.setRealism(0.25);
  engine["pinnedSeed"] = 12641919;
  engine.reset();
  Object.assign(engine.pace, { now: () => 0, pin: false });
  const cars = engine["live"]();
  const hatch = cars[HATCH]!;
  let turns = 0;
  let lastDy = 0;
  let lastY = NaN;
  let asleepAt = -1;
  let overlap = 0;
  const original = engine["slice"];
  // `slice` is a readonly field the engine's world calls each slice: the replay reads the cars after it.
  Reflect.set(engine, "slice", (h: number) => {
    original(h);
    const t = engine["elapsedSim"];
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
  });
  let state = seed >>> 0;
  const random = (): number => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  try {
    while (engine["elapsedSim"] < TO + 0.01) {
      const dt = (1 / FRAME_HZ) * (1 + JITTER * (random() * 2 - 1));
      engine.advance(dt, { frameDt: dt });
    }
  } finally {
    Reflect.set(engine, "slice", original);
  }
  return { turns, asleepAt, overlap };
}
