import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { applyDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { assignClass, HANDLING } from "../vehicle/vehicle-classes.ts";
import { fleetClass, fleetStyle } from "../scenes/fleet.ts";
import { makeWorld } from "../world/race-world.test-util.ts";
import { newWorld, settleStep, stepWorld } from "./world-step.ts";
import { CrashRecorder } from "./engine-record.ts";
import { FINE_HZ } from "../kernel/constants.ts";

const H = Math.fround(1 / FINE_HZ);
const IMPACT_X = 30;
/** The head-on meets about 1.6 s in: the clip's post-roll closes it well inside this. */
const STEPS = 7 * FINE_HZ;

/** A flat-field head-on, recorded; `tetherFrom` is the step from which a tether is out (-1: never). Clips filed. */
function clipsOf(tetherFrom: number): number {
  const { dress } = makeWorld();
  const scene = new THREE.Scene();
  const cars = [0, 1].map((i) => {
    const car = new DeformableCar({ body: 0x808080, accent: 0, name: `c${i}` }, scene, null, fleetStyle(i));
    assignClass(car, fleetClass(i));
    dress(car);
    return car;
  });
  cars[0]!.spawnFacing(0, 0, Math.PI / 2, 15);
  cars[1]!.spawnFacing(2 * IMPACT_X, 0, -Math.PI / 2, 15);
  const rec = new CrashRecorder({ recall: (_i, out) => out.set([-1]), knocks: () => new Uint8Array(16) });
  rec.begin("flat", HANDLING.realism, false, cars.length, (i) => `c${i}`, 1);
  const world = newWorld(cars);
  world.pairHit = (a, b, hit) => rec.pairHit(a, b, hit);
  const input: DriveInput = { throttle: 1, steer: 0, brake: 0, ebrake: false, boost: false };
  for (let s = 0; s < STEPS; s++) {
    rec.startStep(cars);
    if (tetherFrom >= 0 && s >= tetherFrom) rec.tethered();
    for (const car of cars) applyDrive(car, input, H);
    stepWorld(world, H);
    rec.endStep(cars, H, world.shape, world.loners);
    settleStep(cars, H, false);
  }
  rec.end();
  return rec.ledger.kept.length;
}

describe("given a head-on recorded in a flat field", () => {
  it("when no tether is out, then the crash is filed as a highlight", () => {
    assert.ok(clipsOf(-1) >= 1, "the head-on did not rank as a highlight");
  });

  it("when a tether is out from before the crash on, then no clip of it is filed", () => {
    assert.equal(clipsOf(0), 0, "clips filed");
  });

  it("when a tether first comes out after the crash's clip is already filed, then the clip stays filed", () => {
    assert.ok(clipsOf(STEPS - 1) >= 1, "a later tether took the clip");
  });
});
