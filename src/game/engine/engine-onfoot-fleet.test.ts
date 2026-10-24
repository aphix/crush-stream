import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";

/** The fleet's far cars wait this far out on the disc (m), out of the walker's way; the near one stands where he can walk to its door. */
const PARKED_AT = 30;
const NEIGHBOUR_AT = { x: 10, z: 8 };
/** How far he must have walked from the door by the time he is hit (m). */
const WALK_AWAY_M = 4;
/** The most a held car creeps on its brakes while he is out (m). */
const HELD_CREEP_M = 0.5;
const FALL_WITHIN_S = 1.5;

/** The fleet's crash loop rolls the same crash from a seed: this one stops car 0 with its driver in and room at its door, this one throws him out (windshield) before it stops. */
const LOOP_DRIVER_IN_SEED = 4;
const LOOP_DRIVER_THROWN_SEED = 1;

describe("given the real engine in the fleet, its player at the wheel of car 0 with a neighbour car and the rest parked far out", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let rig: OnFootRig;

  before(async () => {
    rig = await OnFootRig.boot();
    rig.engine["looping"] = false;
    rig.run(FRAME);
  });
  beforeEach(() => {
    rig.normalTime();
    rig.engine["onFoot"].reset();
    rig.engine["ragdolls"].reset();
    rig.place(0, 0, 0);
    rig.place(1, NEIGHBOUR_AT.x, NEIGHBOUR_AT.z);
    for (let i = 2; i < rig.cars().length; i++) rig.place(i, PARKED_AT * (i % 2 === 0 ? 1 : -1), -PARKED_AT + 4 * i);
    rig.sit(0);
    rig.run(0.2);
  });
  after(() => rig.dispose());

  it("when he gets out, walks off, is run down by another car, gets up and walks back to his door and in, then he drives his own car again", () => {
    const own = rig.cars()[0]!;
    const start = own.group.position.clone();
    rig.getOut();
    assert.equal(rig.away(), 0, "his car is the one he left");
    rig.walkTo(new THREE.Vector3(start.x + 4, 0, start.z + WALK_AWAY_M), 1.5, 15);
    rig.runDownBy(rig.cars()[1]!, own);
    for (let t = 0; t < FALL_WITHIN_S && rig.walker().state === "stand"; t += FRAME) rig.run(FRAME);
    assert.notEqual(rig.walker().state, "stand", "the car knocked him down");
    assert.ok(own.group.position.distanceTo(start) < HELD_CREEP_M, `his car held where it stood: ${own.group.position.distanceTo(start).toFixed(2)} m`);
    rig.getUp();
    rig.getIn();
    assert.equal(rig.away(), -1, "his car is his to drive again");
    const before = own.group.position.z;
    rig.hold("KeyW", 2);
    assert.ok(own.group.position.z - before > 3, `he drove off: ${(own.group.position.z - before).toFixed(1)} m`);
  });

  it("when he walks to another car's driver door and presses the control, then he is told it is not his and stays out, and his own car's door lets him in", () => {
    const cars = rig.cars();
    rig.getOut();
    rig.walkToDoor(cars[1]!);
    rig.press("Enter");
    rig.run(1);
    assert.equal(rig.phase(), "onFoot", "he is still out");
    assert.equal(rig.engine["seat"].mode, "follow", "the neighbour's wheel is not his");
    assert.equal(rig.engine["onFoot"].prompt(), "Walk up to your car's driver door");
    rig.getIn();
    assert.equal(rig.engine["seat"].carIndex, 0, "he is in his own car");
  });

  it("when his driver has been thrown out in a crash and the seat is still on the car, then the control offers nothing and does nothing, and with the driver back in it offers to get out", () => {
    const own = rig.cars()[0]!;
    assert.equal(rig.engine["onFoot"].prompt(), "Enter or B: get out", "the driver is in: it is offered");
    own.driverOut = "windshield";
    assert.equal(rig.engine["onFoot"].prompt(), null, "a thrown driver has nobody to get out: nothing is offered");
    assert.equal(rig.engine["onFoot"].hud()?.prompt, null, "nor on the HUD's line");
    rig.press("Enter");
    rig.run(1);
    assert.equal(rig.phase(), "inCar", "and the press does nothing");
    own.driverOut = null;
    assert.equal(rig.engine["onFoot"].prompt(), "Enter or B: get out", "the driver back in: offered again");
  });

  it("when the fleet's own crash loop (seed 4) leaves car 0 stopped with its driver in and another wreck at his door, then Enter tells him there is no room and he stays in", () => {
    const own = rig.stoppedInFleetLoop(LOOP_DRIVER_IN_SEED);
    assert.equal(own.driverOut, null, "the crash left his driver in");
    assert.equal(rig.engine["onFoot"].prompt(), "Enter or B: get out", "the control is offered");
    rig.press("Enter");
    assert.equal(rig.phase(), "inCar", "a wreck lies at his door");
    assert.equal(rig.engine["onFoot"].prompt(), "No room to open the door", "and he is told");
  });

  it("when the fleet's own crash loop (seed 4) leaves car 0 stopped with its driver in and the wrecks cleared from his door, then Enter gets him out, the car stays where the crash left it, and Enter gets him back in", () => {
    const own = rig.stoppedInFleetLoop(LOOP_DRIVER_IN_SEED);
    rig.normalTime();
    for (let i = 1; i < rig.cars().length; i++) rig.place(i, PARKED_AT * (i % 2 === 0 ? 1 : -1), -PARKED_AT + 4 * i);
    const at = own.group.position.clone();
    rig.getOut();
    assert.equal(rig.away(), 0, "he got out of the car the crash left");
    rig.run(2);
    assert.ok(own.group.position.distanceTo(at) < HELD_CREEP_M, `the car stood where it was: ${own.group.position.distanceTo(at).toFixed(2)} m`);
    rig.getIn();
    assert.equal(rig.away(), -1, "and he is in it again");
  });

  it("when the fleet's own crash loop (seed 1) throws car 0's driver out and stops it with the seat still on the car, then the control offers nothing and Enter does nothing", () => {
    const own = rig.stoppedInFleetLoop(LOOP_DRIVER_THROWN_SEED);
    assert.notEqual(own.driverOut, null, "the crash threw his driver out");
    assert.equal(rig.engine["seat"].mode, "drive", "the seat is still on the car");
    assert.equal(rig.engine["onFoot"].prompt(), null, "a thrown driver has nobody to get out: nothing is offered");
    rig.press("Enter");
    rig.run(1);
    assert.equal(rig.phase(), "inCar", "and the press does nothing");
  });
});
