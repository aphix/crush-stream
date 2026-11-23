import * as THREE from "three";
import { describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { SeatTable } from "../scenes/seat-table.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { CAR_STYLES } from "../vehicle/car-variants.ts";
import { SCOOT_SECONDS, seatHip } from "../vehicle/car-seats.ts";
import { paint } from "../vehicle/test-support.ts";
import { driverLook } from "./driver-look.ts";
import { JOINTS } from "./ragdoll-body.ts";
import { SeatRiders } from "./seat-riders.ts";
import { SeatedDrivers } from "./seated-drivers.ts";

const uniform = (_car: number, cop: boolean): boolean => cop;
/** How far (m) a drawn hip may stand from its seat's H-point. */
const HIP_MISS_M = 1e-3;
const PASSENGER = 1;
const REAR_DRIVER_SIDE = 2;
const SEATS = 4;

/** A sedan at rest, the table that seats players in it, and the draws that show them. */
interface Sedan {
  car: DeformableCar;
  table: SeatTable;
  riders: SeatRiders;
  drivers: SeatedDrivers;
  toCabin: THREE.Matrix4;
}

/** A sedan with every one of its four seats held by the actor of that number. */
function fullSedan(): Sedan {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
  car.spawn(0, 0, 0);
  car.group.updateMatrixWorld(true);
  const table = new SeatTable();
  for (let seat = 0; seat < SEATS; seat++) table.sit(seat, 0, seat);
  return { car, table, riders: new SeatRiders((actor) => driverLook(1, actor)), drivers: new SeatedDrivers(() => false), toCabin: car.interior.matrixWorld.clone().invert() };
}

/** The slot `actor` is drawn in. */
function slotOf(s: Sedan, actor: number): number {
  for (let slot = 0; slot < s.riders.count; slot++) if (s.riders.actor[slot] === actor) return slot;
  return -1;
}

/** Where actor `actor`'s hips are, in the car's frame. */
function hipsOf(s: Sedan, actor: number): THREE.Vector3 {
  const joint = (j: number) => new THREE.Vector3(JOINTS[j]![2], JOINTS[j]![3], JOINTS[j]![4]);
  const middle = joint(5).add(joint(7)).multiplyScalar(0.5);
  return s.drivers.mesh.partPoint(slotOf(s, actor), 0, middle, new THREE.Vector3()).applyMatrix4(s.toCabin);
}

/** The table `dt` s on, and the figures drawn from it. */
function draw(s: Sedan, dt: number, hidden = -1): void {
  s.riders.refresh(s.table, dt, hidden);
  s.drivers.sync([s.car], (c) => driverLook(1, c), uniform, -1, null, s.riders);
}

/** The H-point of seat `seat` of a sedan. */
function seatPoint(seat: number): THREE.Vector3 {
  const hip = seatHip(CAR_STYLES.sedan, seat, { x: 0, y: 0, z: 0 });
  return new THREE.Vector3(hip.x, hip.y, hip.z);
}

describe("given a sedan whose four seats are held by four players", () => {
  it("when they are drawn after their slides, then each sits at his own seat: his hips on that seat's H-point", () => {
    const s = fullSedan();
    draw(s, 1);
    expect(s.riders.count, "four figures").toBe(SEATS);
    for (let actor = 0; actor < SEATS; actor++) {
      expect(hipsOf(s, actor).distanceTo(seatPoint(s.table.seatOf(actor))), `the player in seat ${actor}`).toBeLessThan(HIP_MISS_M);
    }
  });

  it("when the driver is a player the table holds, then the car's own driver is not drawn as well; with nobody seated it is", () => {
    const s = fullSedan();
    draw(s, 1);
    expect(s.riders.drives(0), "a player drives it").toBe(true);
    s.table.clear();
    draw(s, 1);
    expect(s.riders.drives(0), "nobody drives it: the car's own driver is drawn by `SeatedDrivers`").toBe(false);
  });

  it("when a player is climbing in here, then he is not drawn seated until he has finished", () => {
    const s = fullSedan();
    draw(s, 1, 2);
    expect(s.riders.count, "the other three").toBe(SEATS - 1);
    expect(slotOf(s, 2), "not him").toBe(-1);
  });
});

describe("given a player who sat down in the front seat beside his door and has the rear seat behind the driver", () => {
  it("when he slides over, then his hips go from the front seat to his own over the slide's duration and stay", () => {
    const s = fullSedan();
    s.table.leave(2);
    draw(s, 1);
    s.table.sit(2, 0, REAR_DRIVER_SIDE);
    s.riders.sitDown(2, PASSENGER);
    draw(s, 0);
    const front = hipsOf(s, 2).clone();
    draw(s, SCOOT_SECONDS / 2);
    const halfway = hipsOf(s, 2).clone();
    draw(s, SCOOT_SECONDS);
    const seated = hipsOf(s, 2);
    expect(front.distanceTo(seatPoint(PASSENGER)), "he starts in the front seat").toBeLessThan(HIP_MISS_M);
    expect(halfway.z, "half way he is behind the front seat").toBeLessThan(front.z);
    expect(halfway.z, "and ahead of the rear one").toBeGreaterThan(seated.z);
    expect(seated.distanceTo(seatPoint(REAR_DRIVER_SIDE)), "he ends at the rear seat").toBeLessThan(HIP_MISS_M);
  });
});
