import type { DriveInput } from "../../vehicle/car-drive.ts";
import { blankAiCar, type AiCar } from "../derby-ai.ts";
import type { CarDriver } from "./patrol-cars.ts";

/** A bare car's pace (m/s2, m/s), and how fast its nose turns at full lock above `STEER_SPEED_REFERENCE` m/s (rad/s). */
const ACCELERATION = 6;
const BRAKE_DECELERATION = 9;
const TOP_SPEED = 30;
const STEER_RATE = 1.5;
const STEER_SPEED_REFERENCE = 5;
/** A traffic trip's pace (m/s: the urgent pace) along the fake's streets (x first, then z), and how far short (m, along z) of the point asked for its kerb space stands by default: across the sidewalk from a door. */
const TRIP_SPEED = 20;
const KERB_SPACE_OFFSET = 6;

/** The traffic and the engine's cars as the patrol cars see them, with a point-mass for physics: a car with a driver does what the driver writes, a leased one without drives its trip along the streets (x, then z) to its kerb space, any other keeps its velocity. */
export class FakeStreet {
  readonly snaps: AiCar[] = [];
  readonly drivers: (CarDriver | null)[] = [];
  readonly sirens: boolean[] = [];
  readonly residents: number[] = [];
  readonly traffic: boolean[] = [];
  readonly released: number[] = [];
  /** Per car: where its traffic trip ends (NaN: no trip) and whether it got there. */
  readonly tripX: number[] = [];
  readonly tripZ: number[] = [];
  readonly tripDone: boolean[] = [];
  /** How far short (m) of a point the next trip's kerb space stands. */
  kerbOffset = KERB_SPACE_OFFSET;
  readonly redirects: { handle: number; x: number; z: number }[] = [];
  /** Where the next leased car appears. */
  leaseAt = { x: 0, z: 0, yaw: 0 };
  leases = 0;

  /** Puts a car on the street cruising at `speed` along `yaw`: its index in the engine's list. `resident` -1 is the player's. */
  addCar(x: number, z: number, yaw: number, speed: number, resident: number, traffic: boolean): number {
    const car = blankAiCar(this.snaps.length);
    car.x = x;
    car.z = z;
    car.yaw = yaw;
    car.vx = Math.sin(yaw) * speed;
    car.vz = Math.cos(yaw) * speed;
    this.snaps.push(car);
    this.drivers.push(null);
    this.sirens.push(false);
    this.residents.push(resident);
    this.traffic.push(traffic);
    this.tripX.push(Number.NaN);
    this.tripZ.push(Number.NaN);
    this.tripDone.push(false);
    return car.id;
  }

  lease(toX: number, toZ: number): number {
    this.leases++;
    const handle = this.addCar(this.leaseAt.x, this.leaseAt.z, this.leaseAt.yaw, 0, -1, false);
    this.tripX[handle] = toX;
    this.tripZ[handle] = toZ - this.kerbOffset;
    return handle;
  }

  arrived(handle: number): boolean {
    return this.tripDone[handle]!;
  }

  /** Re-aims the leased car's trip, as the traffic does along its streets; every call is kept for a row to read. */
  redirect(handle: number, toX: number, toZ: number): boolean {
    this.redirects.push({ handle, x: toX, z: toZ });
    this.tripX[handle] = toX;
    this.tripZ[handle] = toZ - this.kerbOffset;
    this.tripDone[handle] = false;
    return true;
  }

  snap(handle: number): AiCar {
    return this.snaps[handle]!;
  }

  setSirens(handle: number, on: boolean): void {
    this.sirens[handle] = on;
  }

  setDriver(handle: number, driver: CarDriver | null): void {
    this.drivers[handle] = driver;
  }

  release(handle: number): void {
    this.released.push(handle);
    this.snaps[handle]!.alive = false;
    this.drivers[handle] = null;
  }

  carSnap(index: number): AiCar | null {
    return this.snaps[index] ?? null;
  }

  takeTraffic(index: number, driver: CarDriver | null): boolean {
    if (!this.traffic[index]) return false;
    this.drivers[index] = driver;
    return true;
  }

  driverOf(index: number): number {
    return this.residents[index] ?? -1;
  }

  step(dt: number): void {
    for (let index = 0; index < this.snaps.length; index++) {
      const car = this.snaps[index]!;
      const driver = this.drivers[index];
      if (!car.alive || driver === null) {
        if (car.alive && !Number.isNaN(this.tripX[index]!)) this.driveTrip(index, car, dt);
        else if (car.alive) this.move(car, dt);
        continue;
      }
      this.drive(car, driver(car, this.snaps, dt), dt);
    }
  }

  private drive(car: AiCar, input: DriveInput, dt: number): void {
    const speed = Math.hypot(car.vx, car.vz);
    const next = Math.min(TOP_SPEED, Math.max(0, speed + (Math.max(0, input.throttle) * ACCELERATION - input.brake * BRAKE_DECELERATION) * dt));
    car.yaw += input.steer * STEER_RATE * Math.min(1, speed / STEER_SPEED_REFERENCE) * dt;
    car.vx = Math.sin(car.yaw) * next;
    car.vz = Math.cos(car.yaw) * next;
    this.move(car, dt);
  }

  /** The traffic's trip: along x to the space's x, then along z to it, at `TRIP_SPEED`; there it stands. */
  private driveTrip(index: number, car: AiCar, dt: number): void {
    const dx = this.tripX[index]! - car.x;
    const dz = this.tripZ[index]! - car.z;
    const along = Math.abs(dx) > 0.01 ? dx : dz;
    const step = Math.min(Math.abs(along), TRIP_SPEED * dt);
    if (step < 0.01) {
      car.vx = 0;
      car.vz = 0;
      this.tripDone[index] = true;
      return;
    }
    car.yaw = Math.abs(dx) > 0.01 ? Math.atan2(Math.sign(dx), 0) : Math.atan2(0, Math.sign(dz));
    car.vx = Math.abs(dx) > 0.01 ? (Math.sign(dx) * step) / dt : 0;
    car.vz = Math.abs(dx) > 0.01 ? 0 : (Math.sign(dz) * step) / dt;
    this.move(car, dt);
  }

  private move(car: AiCar, dt: number): void {
    car.x += car.vx * dt;
    car.z += car.vz * dt;
  }
}
