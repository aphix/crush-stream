import type { DriveInput } from "../../vehicle/car-drive.ts";
import { blankAiCar, type AiCar } from "../derby-ai.ts";
import type { CarDriver } from "./patrol-cars.ts";

/** A bare car's pace (m/s2, m/s), and how fast its nose turns at full lock above `STEER_SPEED_REFERENCE` m/s (rad/s). */
const ACCELERATION = 6;
const BRAKE_DECELERATION = 9;
const TOP_SPEED = 30;
const STEER_RATE = 1.5;
const STEER_SPEED_REFERENCE = 5;

/** The traffic and the engine's cars as the patrol cars see them, with a point-mass for physics: a car with a driver does what the driver writes, one without keeps its velocity. */
export class FakeStreet {
  readonly snaps: AiCar[] = [];
  readonly drivers: (CarDriver | null)[] = [];
  readonly sirens: boolean[] = [];
  readonly residents: number[] = [];
  readonly traffic: boolean[] = [];
  readonly released: number[] = [];
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
    return car.id;
  }

  lease(): number {
    this.leases++;
    return this.addCar(this.leaseAt.x, this.leaseAt.z, this.leaseAt.yaw, 0, -1, false);
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
        if (car.alive) this.move(car, dt);
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

  private move(car: AiCar, dt: number): void {
    car.x += car.vx * dt;
    car.z += car.vz * dt;
  }
}
