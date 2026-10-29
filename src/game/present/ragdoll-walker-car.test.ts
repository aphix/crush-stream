import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { FREEWHEEL, launch, makeCar, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { blankStrike, fell, runsDown } from "../scenes/figure-strike.ts";
import { assertSameNumbers } from "../vehicle/test-support.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { driverLook } from "./driver-look.ts";
import type { RagdollSystem } from "./engine-ragdoll.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const FRAME = 1 / FRAME_HZ;
/** The car's speed (m/s) and how far down the road the walker stands (m): it reaches him in about 0.7 s. */
const CAR_MPS = 12;
const STANDS_AT_M = 9;
const FRAMES = 150;
/** The car's state is read every this many frames. */
const READ_EVERY = 10;
/** He is flung at least this far (m) by a car at that speed. */
const FLUNG_M = 3;

/** A car's whole sim state: pose, velocities, each mass, the drivetrain. */
function simState(car: DeformableCar): number[] {
  return [
    ...car.group.position.toArray(),
    ...car.group.quaternion.toArray(),
    ...car.velocity.toArray(),
    ...car.angular.toArray(),
    ...car.deform.masses.flatMap((m) => [...m.world.toArray(), ...m.vel.toArray()]),
    car.deform.drivetrainAlive ? 1 : 0,
    car.deform.engineTravel,
    car.crashed ? 1 : 0,
  ];
}

let system: RagdollSystem | null = null;

/** A sedan driven through the spot where the walker stands (`withWalker`) or where nobody does, the car's state read every `READ_EVERY` frames; how far he was flung. */
async function drive(withWalker: boolean): Promise<{ states: number[]; flung: number }> {
  const car = makeCar();
  launch(car, 0, 0, 0, 0, CAR_MPS);
  const w = makeWorld([car], false, false, FREEWHEEL);
  system = await flatSystem();
  const sys = system;
  if (withWalker) sys.startWalker(new THREE.Vector3(0, 0, STANDS_AT_M), Math.PI, { cop: false, look: driverLook(0, 0) });
  const strike = blankStrike();
  const torso = new THREE.Vector3();
  const states: number[] = [];
  let flung = 0;
  for (let f = 0; f < FRAMES; f++) {
    tickWorld(w);
    if (withWalker && sys.walkerTorso(torso)) {
      if (runsDown(car, torso.x, torso.z, 0) && sys.walker.sinceStruck > 0.6) sys.knockWalker(fell(car, 0, -1, torso.x, 0, torso.z, 0, 1, strike));
      flung = Math.max(flung, Math.hypot(torso.x, torso.z - STANDS_AT_M));
    }
    sys.update(FRAME, [car], true, true, null);
    if (f % READ_EVERY === 0) states.push(...simState(car));
  }
  return { states, flung };
}

afterEach(() => {
  system?.dispose();
  system = null;
});

describe("given a car driven through the spot where the player's walker stands, and again where nobody does", () => {
  it("when it hits him, then he is flung and every reading of the car's position, velocity and sim state is the same as without him, bit for bit", async () => {
    const without = await drive(false);
    const hit = await drive(true);
    assert.ok(hit.flung > FLUNG_M, `he was flung ${hit.flung.toFixed(1)} m: the car did meet him`);
    assertSameNumbers(hit.states, without.states, "the hitting car's sim state with the walker vs without him");
  });
});
