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

describe("given the real engine in the fleet, its player at the wheel of car 0 with a neighbour car and the rest parked far out", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let rig: OnFootRig;

  before(async () => {
    rig = await OnFootRig.boot();
    rig.engine["looping"] = false;
    rig.run(FRAME);
  });
  beforeEach(() => {
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
});
