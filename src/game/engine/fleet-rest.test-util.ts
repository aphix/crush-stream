import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { stream } from "../present/ragdoll-pose.test-util.ts";
import { loadEpicenter } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { armKill, assignClass, HANDLING, killClass } from "../vehicle/vehicle-classes.ts";
import { fleetClass, fleetStyle } from "../scenes/fleet.ts";
import { applyDrive, idleDrive } from "../vehicle/car-drive.ts";
import { INITIAL_HUD } from "../hud/hud-store.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { newWorld, stepWorld, type World } from "./world-step.ts";
import { satCars } from "../contact/sat.ts";

/**
 * The owner's fleet capture (sedan, hatchback, wagon, coupe, pickup), two ways: staged as its two cars that rest side by side (the
 * hatchback with its front hubs popped and the pickup, each a wreck from one nose hit) on flat ground in a sim-only world (`fleetPair`),
 * and replayed whole on the real engine with a fixed pacer and 60 Hz frames jittered 40 % (`replay`). Not a test file itself.
 */
export const DT = 1 / FRAME_HZ;
/** Fleet slots of the two cars. */
const HATCH = 1;
const PICKUP = 4;
/** The capture's squash and buckle sliders. */
const SQUASH = 0.32;
const BUCKLE = 0.45;
/** How far ahead of its centre (m) each car's nose is struck to make it a wreck: at its bumper. */
const HATCH_NOSE = 2.0;
const PICKUP_NOSE = 2.3;
const IDLE = idleDrive();
/** The replay's sim window (s) the hatchback is read in, and the second from which the crash is over. */
export const FROM = 1.4;
export const TO = 3.5;
export const SETTLED = 2;
/** Frame length varies by this share either way: the crash after the first contact depends on the frame schedule. */
const JITTER = 0.4;
/** A turn of the hatchback's height under this (mm) is rounding; the rise out of the road moves it 0.2 mm a slice. */
const TURN_MM = 0.3;
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();

function wreck(slot: number, x: number, nose: number): DeformableCar {
  const car = new DeformableCar({ name: `c${slot}`, body: 0x808080, accent: 0 }, new THREE.Scene(), null, fleetStyle(slot));
  car.deform.squash = SQUASH;
  car.deform.buckle = BUCKLE;
  car.deform.setMode(INITIAL_HUD.deformMode);
  assignClass(car, fleetClass(slot));
  armKill(car.deform, killClass(car), HANDLING.realism, "default");
  car.spawnFacing(x, 0, 0, 0);
  car.group.updateMatrixWorld(true);
  car.updateSkin();
  car.applyImpact(car.group.position.clone().addScaledVector(car.forward, nose), car.forward.clone().negate(), 0.5, 0.5);
  return car;
}

/** The hatchback wreck at x = 0, its front hubs popped as the capture's crash pops them; and the pickup wreck beside it, its centre `gap` m off along x. */
export function fleetPair(gap: number): { hatch: DeformableCar; pickup: DeformableCar; world: World } {
  const hatch = wreck(HATCH, 0, HATCH_NOSE);
  for (const m of hatch.deform.masses) if (m.name === "hubFL" || m.name === "hubFR") hatch.deform.popHub(m);
  const pickup = wreck(PICKUP, gap, PICKUP_NOSE);
  return { hatch, pickup, world: newWorld([hatch, pickup]) };
}

/** A headless engine for the replays; one per test process (a second one made after the first is disposed never resolves `ready`). */
export async function makeEngine(): Promise<CrashEngine> {
  stubBrowser();
  const engine = await bootEngine({ fades: true });
  // The sandbox restarts its crash once the slow-mo, held on by each later impact, has run 10.4 wall s (`updatePhase`): the replay reads the first run through.
  engine.looping = false;
  const throwDriver = engine["throwDriver"].bind(engine);
  // The live game's dummy world calls `onThrow` at once (the slow-mo lifts for the driver's exit); headless has none.
  engine["throwDriver"] = (...args: Parameters<typeof throwDriver>) => {
    throwDriver(...args);
    engine["onThrow"](args[0].car);
  };
  return engine;
}

/**
 * The capture replayed on `engine` with jitter seed `seed`: the hatchback's height turns, when it fell asleep for good (-1: never), the
 * deepest two settled cars stood in each other (m) and the last sim second any other car stood awake and faster than rest (`stirred`:
 * a neighbour whose `stirNear` reaches the hatchback). `onSlice` runs after each slice in the read window.
 */
export async function replay(engine: CrashEngine, seed: number, onSlice: (t: number) => void = () => {}): Promise<{ turns: number; asleepAt: number; overlap: number; stirred: number }> {
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
  let stirred = -1;
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
    for (let i = 0; i < cars.length; i++) if (i !== HATCH && !cars[i]!.asleep && cars[i]!.moving) stirred = t;
    onSlice(t);
  });
  const random = stream(seed);
  try {
    while (engine["elapsedSim"] < TO + 0.01) {
      const dt = (1 / FRAME_HZ) * (1 + JITTER * (random() * 2 - 1));
      engine.advance(dt, { frameDt: dt });
    }
  } finally {
    Reflect.set(engine, "slice", original);
  }
  return { turns, asleepAt, overlap, stirred };
}

/** One 60 Hz frame of `world`: the idle pedals a wreck nobody drives rolls on, the step, the breakage. */
export function tick(world: World): void {
  for (const car of world.cars) applyDrive(car, IDLE, DT);
  stepWorld(world, DT);
  for (const car of world.cars) car.stepBreakage(DT);
}

/** Frames of `world` until `until` holds (its frame count, 1-based) or `limit` frames pass (-1). */
export function frames(world: World, limit: number, until: () => boolean): number {
  for (let f = 1; f <= limit; f++) {
    tick(world);
    if (until()) return f;
  }
  return -1;
}
