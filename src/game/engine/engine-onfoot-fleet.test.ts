import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { DRIVER_SIDE } from "../vehicle/constants.ts";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";

/** The fleet's far cars wait this far out on the disc (m), out of the walker's way; the near one stands where he can walk to its door. */
const PARKED_AT = 30;
const NEIGHBOUR_AT = { x: 10, z: 8 };
/** How far he must have walked from the door by the time he is hit (m). */
const WALK_AWAY_M = 4;
/** The most a held car creeps on its brakes while he is out (m). */
const HELD_CREEP_M = 0.5;
const FALL_WITHIN_S = 1.5;
/** Gas on the touch strip short of its Boost cap, held this long (s): he walks at least this far (m) and does not run. */
const TOUCH_WALK_GAS = 0.95;
const TOUCH_WALK_S = 2;
const TOUCH_WALK_MIN_M = 1;
/** A car this fast (m/s) is too fast to leave; the refusal is gone this long (s) after it (`REFUSAL_SECONDS` and a slack). */
const ROLLING_MPS = 8;
const REFUSAL_GONE_S = 2.5;

/** The fleet's crash loop rolls the same crash from a seed: this one stops car 0 with its driver in and room at its door, this one throws him out (windshield) before it stops. */
const LOOP_DRIVER_IN_SEED = 4;
const LOOP_DRIVER_THROWN_SEED = 1;

describe("given the real engine in the fleet, its player at the wheel of car 0 with a neighbour car and the rest parked far out", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let rig: OnFootRig;

  beforeAll(async () => {
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
  afterAll(() => rig.dispose());

  it("when he gets out, walks off, is run down by another car, gets up and walks back to his door and in, then he drives his own car again", () => {
    const own = rig.cars()[0]!;
    const start = own.group.position.clone();
    rig.getOut();
    expect(rig.away(), "his car is the one he left").toBe(0);
    rig.walkTo(new THREE.Vector3(start.x + 4, 0, start.z + WALK_AWAY_M), 1.5, 15);
    rig.runDownBy(rig.cars()[1]!, own);
    for (let t = 0; t < FALL_WITHIN_S && rig.walker().state === "stand"; t += FRAME) rig.run(FRAME);
    expect(rig.walker().state, "the car knocked him down").not.toBe("stand");
    expect(own.group.position.distanceTo(start), `his car held where it stood: ${own.group.position.distanceTo(start).toFixed(2)} m`).toBeLessThan(HELD_CREEP_M);
    rig.getUp();
    rig.getIn();
    expect(rig.away(), "his car is his to drive again").toBe(-1);
    const before = own.group.position.z;
    rig.hold("KeyW", 2);
    expect(own.group.position.z - before, `he drove off: ${(own.group.position.z - before).toFixed(1)} m`).toBeGreaterThan(3);
  });

  it("when he walks to another car's driver door and presses the control, then he is told it is not his and stays out, and his own car's door lets him in", () => {
    const cars = rig.cars();
    rig.getOut();
    rig.walkToDoor(cars[1]!);
    rig.press("Enter");
    rig.run(1);
    expect(rig.phase(), "he is still out").toBe("onFoot");
    expect(rig.engine["seat"].mode, "the neighbour's wheel is not his").toBe("follow");
    expect(rig.engine["onFoot"].prompt()).toBe("Walk up to your car's driver door");
    rig.getIn();
    expect(rig.engine["seat"].carIndex, "he is in his own car").toBe(0);
  });

  /** The driver's door's widest angle (rad) over the 54 frames of getting out of car 0; he is out once they are run. */
  function widestOverGettingOut(): number {
    const car = rig.cars()[0]!;
    let widest = 0;
    rig.press("Enter");
    for (let f = 0; f < 54; f++) {
      rig.run(FRAME);
      widest = Math.max(widest, Math.abs(car.doorAngle(DRIVER_SIDE)));
    }
    expect(rig.phase(), "he is out").toBe("onFoot");
    return widest;
  }

  // mutation: sed -i -e 's/^    if (!this.host.openWorld() || !this.host.runsCars()) return;/    if (!this.host.runsCars()) return;/' -e 's/^    if (!this.host.openWorld() || !this.host.runsCars()) {/    if (!this.host.runsCars()) {/' src/game/engine/engine-onfoot.ts
  it("when he gets out in the fleet, then his car's door is never written: the walker writes nothing to a car outside the open world (guard)", () => {
    const car = rig.cars()[0]!;
    let widest = 0;
    rig.press("Enter");
    for (let f = 0; f < 54; f++) {
      rig.run(FRAME);
      widest = Math.max(widest, Math.abs(car.doorAngle(DRIVER_SIDE)));
    }
    expect(rig.phase(), "he is out").toBe("onFoot");
    expect(widest, "the door's widest angle (rad)").toBe(0);
  });

  // mutation: sed -i 's/^    if (!this.host.openWorld() || !this.host.runsCars()) return;/    if (!this.host.runsCars() || this.host.openWorld()) return;/' src/game/engine/engine-onfoot.ts
  it("when the same trip is made with the host saying it is the open world, then his driver's door swings past 0.5 rad", () => {
    const host = rig.engine["onFoot"]["host"];
    const asked = host.openWorld;
    host.openWorld = () => true;
    try {
      expect(widestOverGettingOut(), "the door's widest angle (rad)").toBeGreaterThan(0.5);
    } finally {
      host.openWorld = asked;
      rig.engine["onFoot"].reset();
      rig.cars()[0]!.setDoorOpen(DRIVER_SIDE, 0);
    }
  });

  /** He starts out of car 0 with the host saying it is the open world; 10 frames in (the door part open) a reset ends the trip. `openAfter`: whether the host still says open world after it; `shutByReset`: the reset also shuts the door, as a respawn does. The door's angle (rad) before the reset, just after it, and 0.5 s later. */
  function doorAcrossReset(openAfter: boolean, shutByReset: boolean): { opened: number; left: number; later: number } {
    const host = rig.engine["onFoot"]["host"];
    const asked = host.openWorld;
    const car = rig.cars()[0]!;
    host.openWorld = () => true;
    try {
      rig.press("Enter");
      rig.run(10 * FRAME);
      const opened = Math.abs(car.doorAngle(DRIVER_SIDE));
      host.openWorld = openAfter ? () => true : asked;
      rig.engine["onFoot"].reset();
      if (shutByReset) car.setDoorOpen(DRIVER_SIDE, 0);
      const left = Math.abs(car.doorAngle(DRIVER_SIDE));
      rig.run(FRAME);
      const first = Math.abs(car.doorAngle(DRIVER_SIDE));
      rig.run(0.5);
      return { opened, left: shutByReset ? first : left, later: Math.abs(car.doorAngle(DRIVER_SIDE)) };
    } finally {
      host.openWorld = asked;
      rig.engine["onFoot"].reset();
      car.setDoorOpen(DRIVER_SIDE, 0);
    }
  }

  // mutation: sed -i 's/^    if (!this.host.openWorld() || !this.host.runsCars()) {/    if (false) {/' src/game/engine/engine-onfoot.ts
  it("when a trip that opened his door is ended by a reset in a scene that is not the open world, then the door is not written again", () => {
    const { opened, left, later } = doorAcrossReset(false, false);
    expect(opened, "control: the door was open at the reset (rad)").toBeGreaterThan(0.3);
    expect(later, "the door's angle 0.5 s later (rad)").toBeCloseTo(left, 2);
  });

  // mutation: sed -i 's/^    if (this.doorTarget === 0) this.door = Math.min(this.door, Math.abs(car.doorAngle(DRIVER_SIDE)));/    void car;/' src/game/engine/engine-onfoot.ts
  it("when a reset ends the trip in the open world and shuts the door itself, then the swing does not open it again from where it last left it", () => {
    const { opened, left, later } = doorAcrossReset(true, true);
    expect(opened, "control: the door was open at the reset (rad)").toBeGreaterThan(0.3);
    expect(left, "the door's angle a frame after the reset (rad)").toBe(0);
    expect(later, "the door's angle 0.5 s later (rad)").toBe(0);
  });

  it("when his driver has been thrown out in a crash and the seat is still on the car, then the control offers nothing and does nothing, and with the driver back in it offers to get out", () => {
    const own = rig.cars()[0]!;
    expect(rig.engine["onFoot"].prompt(), "the driver is in: it is offered").toBe("Enter or Y: get out");
    own.driverOut = "windshield";
    expect(rig.engine["onFoot"].prompt(), "a thrown driver has nobody to get out: nothing is offered").toBe(null);
    expect(rig.engine["onFoot"].hud(), "nor on the HUD: no Out button").toBe(null);
    rig.press("Enter");
    rig.run(1);
    expect(rig.phase(), "and the press does nothing").toBe("inCar");
    own.driverOut = null;
    expect(rig.engine["onFoot"].prompt(), "the driver back in: offered again").toBe("Enter or Y: get out");
  });

  it("when the touch Out button is tapped at the wheel, then he gets out once, the tap is spent, the pedal strip's gas walks him, and the same button tapped at his door gets him back in", () => {
    const hud = rig.engine["onFoot"].hud();
    if (!hud) throw new Error("at the wheel the button is Out: no HUD read");
    expect(hud.out, "at the wheel the button is Out: out").toBe(false);
    expect(hud.prompt, "at the wheel the button is Out: prompt").toBe("Enter or Y: get out");
    expect(hud.refusal, "at the wheel the button is Out: refusal").toBeNull();
    rig.tapOnFoot(1);
    expect(rig.phase(), `he is out (he was told: ${rig.engine["onFoot"].flow.refusal})`).toBe("onFoot");
    expect(rig.engine.touch.tapped, "the tap fired on one poll").toBe(0);
    expect(rig.engine.touch.held, "and holds nothing").toBe(0);
    expect(rig.engine["onFoot"].hud()?.out, "on foot the button is In").toBe(true);
    const from = rig.torso();
    rig.engine.touch.gas = TOUCH_WALK_GAS;
    rig.run(TOUCH_WALK_S);
    rig.engine.touch.gas = 0;
    expect(rig.torso().distanceTo(from), `the strip's gas walked him ${rig.torso().distanceTo(from).toFixed(2)} m`).toBeGreaterThan(TOUCH_WALK_MIN_M);
    rig.walkToDoor(rig.cars()[0]!);
    rig.tapOnFoot(1);
    expect(rig.phase(), "the tap got him in").toBe("inCar");
    expect(rig.engine["seat"].mode, "with the wheel").toBe("drive");
  });

  it("when the touch Out button is tapped while the car still rolls, then he stays in and the touch HUD reads the desktop prompt's reason, which clears", () => {
    const own = rig.cars()[0]!;
    own.spawnFacing(0, 0, 0, ROLLING_MPS);
    rig.tapOnFoot(2 * FRAME);
    expect(rig.phase(), "a rolling car is not left").toBe("inCar");
    const foot = rig.engine["onFoot"].hud();
    expect(foot?.refusal, "the touch HUD is told why").toBe("Stop the car first");
    expect(foot?.refusal, "in the desktop prompt's words").toBe(rig.engine["onFoot"].prompt());
    rig.run(REFUSAL_GONE_S);
    expect(rig.engine["onFoot"].hud()?.refusal, "and the reason clears").toBe(null);
  });

  it("when the seat only follows his car, not at its wheel, then nothing offers getting out: no Out button, and a tap does nothing", () => {
    rig.engine["seat"].mode = "follow";
    expect(rig.engine["onFoot"].hud(), "no Out button").toBe(null);
    rig.tapOnFoot(1);
    expect(rig.phase(), "the tap does nothing").toBe("inCar");
  });

  it("when the fleet's own crash loop (seed 4) leaves car 0 stopped with its driver in and another wreck at his door, then Enter tells him there is no room and he stays in", () => {
    const own = rig.stoppedInFleetLoop(LOOP_DRIVER_IN_SEED);
    expect(own.driverOut, "the crash left his driver in").toBe(null);
    expect(rig.engine["onFoot"].prompt(), "the control is offered").toBe("Enter or Y: get out");
    rig.press("Enter");
    expect(rig.phase(), "a wreck lies at his door").toBe("inCar");
    expect(rig.engine["onFoot"].prompt(), "and he is told").toBe("No room to open the door");
  });

  it("when the fleet's own crash loop (seed 4) leaves car 0 stopped with its driver in and the wrecks cleared from his door, then Enter gets him out, the car stays where the crash left it, and Enter gets him back in", () => {
    const own = rig.stoppedInFleetLoop(LOOP_DRIVER_IN_SEED);
    rig.normalTime();
    for (let i = 1; i < rig.cars().length; i++) rig.place(i, PARKED_AT * (i % 2 === 0 ? 1 : -1), -PARKED_AT + 4 * i);
    const at = own.group.position.clone();
    rig.getOut();
    expect(rig.away(), "he got out of the car the crash left").toBe(0);
    rig.run(2);
    expect(own.group.position.distanceTo(at), `the car stood where it was: ${own.group.position.distanceTo(at).toFixed(2)} m`).toBeLessThan(HELD_CREEP_M);
    rig.getIn();
    expect(rig.away(), "and he is in it again").toBe(-1);
  });

  it("when the fleet's own crash loop (seed 1) throws car 0's driver out and stops it with the seat still on the car, then the control offers nothing and Enter does nothing", () => {
    const own = rig.stoppedInFleetLoop(LOOP_DRIVER_THROWN_SEED);
    expect(own.driverOut, "the crash threw his driver out").not.toBe(null);
    expect(rig.engine["seat"].mode, "the seat is still on the car").toBe("drive");
    expect(rig.engine["onFoot"].prompt(), "a thrown driver has nobody to get out: nothing is offered").toBe(null);
    rig.press("Enter");
    rig.run(1);
    expect(rig.phase(), "and the press does nothing").toBe("inCar");
  });

  // mutation: sed -i 's/    return this.host.openWorld() \&\& this.flow.phase === "onFoot" \&\& !this.host.guest();/    return this.flow.phase === "onFoot" \&\& !this.host.guest();/' src/game/engine/engine-onfoot.ts
  it("when fire is pressed on foot in the fleet, then nothing is thrown: the arms are the open world's", () => {
    rig.getOut();
    rig.engine["onFoot"].arms.press();
    rig.engine["onFoot"].arms.release();
    rig.run(0.5);
    expect(rig.engine["onFoot"].armed(), "armed").toBe(false);
    expect(rig.walker()["punchFor"], "no punch began").toBeGreaterThanOrEqual(0.45);
  });
});
