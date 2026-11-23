import * as THREE from "three";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hypot2 } from "../kernel/physics-core.js";
import type { DeformableCar } from "../vehicle/car.ts";
import { DRIVER_SIDE } from "../vehicle/constants.ts";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";
import { doorSpot } from "./onfoot-doors.ts";

const LINK = "#scene=openworld&seed=beef";
/** Seconds the traffic needs to stand its first kerb cars. */
const SETTLE_S = 3;
const PASSENGER_DOOR = -DRIVER_SIDE;
/** The frames of a climb in (0.6 s), and the door's widest and shut readings (rad). */
const CLIMB_IN_FRAMES = 42;
const WIDE_RAD = 0.5;
const SHUT_RAD = 0.02;
/** How far (m) a held car may creep, how far a car driven for two seconds must go, and how near his door's spot he stands after getting out. */
const HELD_CREEP_M = 0.5;
const DROVE_OFF_M = 3;
const BESIDE_DOOR_M = 1.5;
/** How far (m) out from his own car's door a parked car is set. */
const SIDE_M = 5;
/** The player's own actor, and another player's. */
const HOST = 0;
const OTHER = 1;

describe("given the real engine in the open world, its player on foot with an empty car parked near", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let rig: OnFootRig;
  let home: THREE.Vector3;
  const world = () => rig.engine["openWorld"];
  const table = () => rig.engine["desk"].table;

  /** An empty car the traffic has let go of for good, set at rest beside his own car: each row gets a fresh one, whatever earlier rows did to the cars. */
  function parkedCar(): number {
    const own = rig.cars()[0]!;
    for (let index = 1; index < rig.cars().length; index++) {
      if (!world().canEnter(index) || table().takenMask(index) !== 0) continue;
      world().adopt(index);
      const spot = rig.beside(own, SIDE_M, 0);
      rig.place(index, spot.x, spot.z);
      return index;
    }
    return expect.fail("no empty car to set beside his own");
  }

  /** The widest the two doors of `car` open over `frames` frames: [driver's, passenger's] (rad). */
  function widest(car: DeformableCar, frames: number): [number, number] {
    const most: [number, number] = [0, 0];
    for (let f = 0; f < frames; f++) {
      rig.run(FRAME);
      most[0] = Math.max(most[0], Math.abs(car.doorAngle(DRIVER_SIDE)));
      most[1] = Math.max(most[1], Math.abs(car.doorAngle(PASSENGER_DOOR)));
    }
    return most;
  }

  /** Another player (actor 1) is at the wheel of car `target`, which the traffic has let go for good. */
  function otherDrives(target: number): void {
    world().adopt(target);
    table().sit(OTHER, target, 0);
  }

  /** He is out of his car and has walked to `car`'s passenger door and pressed the control: the climb in is over. */
  function rideAlongside(car: DeformableCar): void {
    rig.getOut();
    rig.walkToDoor(car, PASSENGER_DOOR);
    rig.press("Enter");
    rig.run(1);
  }

  beforeAll(async () => {
    rig = await OnFootRig.boot(LINK);
    rig.run(SETTLE_S);
    home = rig.cars()[0]!.group.position.clone();
  });
  beforeEach(() => {
    // His own car is set at rest where it began, repaired: an earlier row's crash must not jam its door.
    rig.place(0, home.x, home.z);
    rig.engine["onFoot"].reset();
    rig.engine["ragdolls"].reset();
    rig.engine["race"].adoptCar(0);
    table().leave(OTHER);
    rig.engine["desk"]["lastDriven"][HOST] = HOST;
    rig.sit(0);
    rig.run(0.2);
  });
  afterAll(() => rig.dispose());

  it("when he walks to the passenger door of an empty parked car and presses Enter, then that door (not the driver's) swings, he ends in the driver's seat and drives", () => {
    const target = parkedCar();
    const car = rig.cars()[target]!;
    rig.getOut();
    rig.walkToDoor(car, PASSENGER_DOOR);
    expect(rig.engine["onFoot"].prompt(), "the passenger door offers it too").toBe("Enter or Y: get in");
    rig.press("Enter");
    const [driversDoor, passengersDoor] = widest(car, CLIMB_IN_FRAMES);
    expect(passengersDoor, "the passenger door swung (rad)").toBeGreaterThan(WIDE_RAD);
    expect(driversDoor, "the driver's door stayed shut (rad)").toBeLessThan(SHUT_RAD);
    rig.run(1);
    expect(rig.phase(), "he is in").toBe("inCar");
    expect(Math.abs(car.doorAngle(PASSENGER_DOOR)), "the door shut behind him").toBeLessThan(SHUT_RAD);
    expect(table().carOf(HOST), "the table seats him in it").toBe(target);
    expect(table().seatOf(HOST), "at its wheel").toBe(0);
    expect(rig.engine["seat"].carIndex, "the seat has it").toBe(target);
    expect(rig.engine["seat"].mode, "he drives").toBe("drive");
    const from = car.group.position.clone();
    rig.hold("KeyW", 2);
    expect(hypot2(car.group.position.x - from.x, car.group.position.z - from.z), "he drove it off (m)").toBeGreaterThan(DROVE_OFF_M);
  });

  it("when another player drives a parked car and he gets in at its passenger door, then he sits beside the driver in that car's chase view, and his driving keys do not drive it", () => {
    const target = parkedCar();
    const car = rig.cars()[target]!;
    otherDrives(target);
    rideAlongside(car);
    expect(rig.phase(), "he is in").toBe("inCar");
    expect(table().carOf(HOST), "in that car").toBe(target);
    expect(table().seatOf(HOST), "in the other front seat").toBe(1);
    expect(table().driverOf(target), "beside the driver").toBe(OTHER);
    expect(rig.engine["seat"].carIndex, "the car's chase view").toBe(target);
    expect(rig.engine["seat"].mode, "not its controls").toBe("follow");
    expect(rig.engine["race"].self, "his own car is still the one he drives").not.toBe(target);
    expect(rig.engine["riders"].count, "he is drawn seated").toBeGreaterThan(0);
    const from = car.group.position.clone();
    rig.hold("KeyW", 1.5);
    expect(car.group.position.distanceTo(from), "the car stood still (m)").toBeLessThan(HELD_CREEP_M);
  });

  it("when a passenger presses the control, then he stands on foot beside the door on his seat's side, the seat is free again and the car is not left as his", () => {
    const target = parkedCar();
    const car = rig.cars()[target]!;
    otherDrives(target);
    rideAlongside(car);
    rig.press("Enter");
    rig.run(1);
    expect(rig.phase(), "he is out").toBe("onFoot");
    expect(table().holderOf(target, 1), "the seat is free").toBe(-1);
    expect(table().driverOf(target), "the driver stays").toBe(OTHER);
    const door = doorSpot(car, new THREE.Vector3(), PASSENGER_DOOR);
    expect(hypot2(rig.torso().x - door.x, rig.torso().z - door.z), "beside his door (m)").toBeLessThan(BESIDE_DOOR_M);
    expect(rig.away(), "the car is another's: not his to hold on its brakes").toBe(-1);
  });

  it("when the driver of the car he rides in gets out and he presses the throttle, then he slides into the driver's seat and his keys drive it", () => {
    const target = parkedCar();
    const car = rig.cars()[target]!;
    otherDrives(target);
    rideAlongside(car);
    table().leave(OTHER);
    rig.run(0.5);
    expect(table().seatOf(HOST), "no throttle: he stays in the passenger seat").toBe(1);
    const from = car.group.position.clone();
    rig.hold("KeyW", 2);
    expect(table().driverOf(target), "the wheel is his").toBe(HOST);
    expect(rig.engine["seat"].mode, "he drives").toBe("drive");
    expect(rig.engine["race"].self, "it is the car this browser drives").toBe(target);
    expect(hypot2(car.group.position.x - from.x, car.group.position.z - from.z), "he drove it off (m)").toBeGreaterThan(DROVE_OFF_M);
  });

  it("when a reset ends his climb out half way and shuts the door itself, as a respawn does, then the door stays shut: the swing does not open it again from where it last left it", () => {
    const car = rig.cars()[0]!;
    rig.press("Enter");
    rig.run(10 * FRAME);
    expect(Math.abs(car.doorAngle(DRIVER_SIDE)), "control: the door was open at the reset (rad)").toBeGreaterThan(0.3);
    rig.engine["onFoot"].reset();
    car.setDoorOpen(DRIVER_SIDE, 0);
    rig.run(0.5);
    expect(car.doorAngle(DRIVER_SIDE), "the door's angle 0.5 s later (rad)").toBe(0);
  });

  it("when the driver of the car he rides in is thrown out in a crash and he presses the throttle, then he is at the wheel, the car is driven again and his input moves it", () => {
    const target = parkedCar();
    const car = rig.cars()[target]!;
    otherDrives(target);
    rideAlongside(car);
    car.driverOut = "windshield";
    rig.engine["desk"].driverEjected(target);
    const from = car.group.position.clone();
    rig.hold("KeyW", 3);
    expect(table().driverOf(target), "the wheel is his").toBe(HOST);
    expect(car.driverOut, "nobody is out of it now").toBeNull();
    expect(hypot2(car.group.position.x - from.x, car.group.position.z - from.z), "he drove it off (m)").toBeGreaterThan(DROVE_OFF_M);
  });

  it("when he climbs into a car whose own driver was thrown out, then he drives it", () => {
    const target = parkedCar();
    const car = rig.cars()[target]!;
    car.driverOut = "windshield";
    rig.getOut();
    rig.walkToDoor(car, PASSENGER_DOOR);
    rig.press("Enter");
    rig.run(1);
    expect(table().driverOf(target), "he is at its wheel").toBe(HOST);
    expect(rig.engine["onFoot"].prompt(), "and may get out of it").toBe("Enter or Y: get out");
    const from = car.group.position.clone();
    rig.hold("KeyW", 2);
    expect(hypot2(car.group.position.x - from.x, car.group.position.z - from.z), "he drove it off (m)").toBeGreaterThan(DROVE_OFF_M);
  });

  it("when a peer's car stands empty because its player stepped out, then the traffic does not offer it to anyone", () => {
    const target = parkedCar();
    expect(world().canEnter(target), "control: with no peer in it, it is an empty car").toBe(true);
    const seated = rig.engine["netSeats"];
    rig.engine["netSeats"] = new Map([[target, "Zed"]]);
    try {
      expect(world().canEnter(target), "a peer's car").toBe(false);
    } finally {
      rig.engine["netSeats"] = seated;
    }
  });

  it("when a passenger's climb out is cut short by a scene reset, then he stands on foot at his door with his walker started, and the car is not left as his", () => {
    const target = parkedCar();
    const car = rig.cars()[target]!;
    otherDrives(target);
    rideAlongside(car);
    rig.press("Enter");
    rig.run(0.2);
    rig.engine["onFoot"].reset();
    rig.run(0.5);
    expect(rig.phase(), "he is on foot").toBe("onFoot");
    const door = doorSpot(car, new THREE.Vector3(), PASSENGER_DOOR);
    expect(hypot2(rig.torso().x - door.x, rig.torso().z - door.z), "at his door (m)").toBeLessThan(BESIDE_DOOR_M);
    expect(table().carOf(HOST), "he sits nowhere").toBe(-1);
    expect(rig.away(), "the car is another's").toBe(-1);
  });

  it("when no walker can be started as a passenger gets out, then he is back at the wheel of the car he last drove", () => {
    const target = parkedCar();
    const car = rig.cars()[target]!;
    otherDrives(target);
    rideAlongside(car);
    const ragdolls = rig.engine["ragdolls"];
    const start = ragdolls.startWalker;
    ragdolls.startWalker = () => -1;
    try {
      rig.press("Enter");
      rig.run(0.5);
    } finally {
      ragdolls.startWalker = start;
    }
    expect(rig.phase(), "the trip is over").toBe("inCar");
    const wheel = rig.engine["seat"].carIndex;
    expect(wheel, "not the car he was riding in").not.toBe(target);
    expect(table().driverOf(wheel), "he is at the wheel of the car the view and the keys are on").toBe(HOST);
    expect(rig.engine["seat"].mode, "he drives").toBe("drive");
  });

  it("when a reset ends a passenger's climb out half way and shuts his door itself, then the door stays shut", () => {
    const target = parkedCar();
    const car = rig.cars()[target]!;
    otherDrives(target);
    rideAlongside(car);
    rig.press("Enter");
    rig.run(10 * FRAME);
    expect(Math.abs(car.doorAngle(PASSENGER_DOOR)), "control: the door was open at the reset (rad)").toBeGreaterThan(0.3);
    rig.engine["onFoot"].reset();
    car.setDoorOpen(PASSENGER_DOOR, 0);
    rig.run(0.5);
    expect(car.doorAngle(PASSENGER_DOOR), "the door's angle 0.5 s later (rad)").toBe(0);
  });
});
