import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { setGround } from "../world/ground.ts";
import { loadEpicenter } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import { C_OWNER, HIT_SIZE } from "../world/surfaces.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";

const FRAME = 1 / FRAME_HZ;
/** The owner's head-on: both cars at 17 m/s. */
const SPEED = 17;
/** Sim s read: the noses pack at 0.42 s and a front tyre reads the other wreck's top from 0.45 s; the driver is thrown at 0.47 s. */
const UNTIL = 0.47;
/** A drawn front wheel seated more than this (m) over its hub stands on something: the fleet disc is flat. */
const RAISED = 0.05;
const FRONT_WHEELS = 2;

type Run = { onTop: number; raised: number; flips: number; maxSeat: number };

/** Whether a front tyre of wreck `car` answers another wreck's top (the slot `wheelHit` names). */
function frontOnWreckTop(car: DeformableCar, cars: readonly DeformableCar[]): boolean {
  if (!car.deform.massActive) return false;
  for (let i = 0; i < FRONT_WHEELS; i++) {
    const own = car.wheelHit[i * HIT_SIZE + C_OWNER]!;
    if (own >= 0 && cars[own]!.deform.massActive) return true;
  }
  return false;
}

/** One slice's reading of every car into `run`; `was` holds each car's raised state from the slice before. */
function read(cars: readonly DeformableCar[], run: Run, was: boolean[]): void {
  for (let k = 0; k < cars.length; k++) {
    const car = cars[k]!;
    if (frontOnWreckTop(car, cars)) run.onTop++;
    const seat = Math.max(car.suspension.seat[0]!, car.suspension.seat[1]!);
    run.maxSeat = Math.max(run.maxSeat, seat);
    const raised = seat > RAISED;
    if (raised) run.raised++;
    if (raised !== was[k]) run.flips++;
    was[k] = raised;
  }
}

function headOn(engine: CrashEngine): Run {
  loadEpicenter(EPICENTER_AT_LOAD);
  engine["looping"] = false;
  engine.setCarCount(2);
  engine.setSpeedRange(SPEED, SPEED);
  engine.setPlayerCar("muscle");
  engine.matchCar(1, "sedan", "sedan");
  engine["pinnedSeed"] = 4242;
  engine.reset();
  // A pacer clock that never moves cuts no frame at the wall deadline, and the floor held at 1/240 s: the same slices on any machine.
  Object.assign(engine.pace, { now: () => 0, pin: false });
  const cars = engine["live"]();
  const run: Run = { onTop: 0, raised: 0, flips: 0, maxSeat: 0 };
  const was = cars.map(() => false);
  const paced = engine.pace.run.bind(engine.pace);
  engine.pace.run = (simDt, scale, vmax, fine, deadline, step) =>
    paced(simDt, scale, vmax, fine, deadline, (h) => {
      step(h);
      read(cars, run, was);
    });
  try {
    while (engine["elapsedSim"] < UNTIL) engine.advance(FRAME, { frameDt: FRAME });
  } finally {
    engine.pace.run = paced;
  }
  return run;
}

describe("given the fleet sandbox's muscle car and sedan driven head-on at 17 m/s each into a packed nose-to-nose crush", () => {
  let engine: CrashEngine;
  before(async () => {
    stubBrowser();
    engine = new CrashEngine(element(), new HudStore(), element());
    Object.assign(engine["renderer"], { render() {}, compile() {}, compileAsync: () => Promise.resolve() });
    await engine.ready;
    engine.fadeScenes = false;
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  it("when a wreck's front tyres read the other wreck's top, which the rigid step takes no row from, then neither car's drawn nose is seated on it: no raise and no raise/flat flips", () => {
    const run = headOn(engine);
    assert.ok(run.onTop > 0, "no front tyre read the other wreck's top: the crush never packed the noses");
    assert.equal(run.flips, 0, `drawn front raise/flat flips (${run.raised} car-slices raised, seat up to ${(run.maxSeat * 1000).toFixed(0)} mm)`);
    assert.equal(run.raised, 0, `drawn front raised in ${run.raised} car-slices (seat up to ${(run.maxSeat * 1000).toFixed(0)} mm)`);
  });
});
