import { hypot2 } from "../../kernel/physics-core.js";
import { fleetStyle } from "../../scenes/fleet.ts";
import type { DriveInput } from "../../vehicle/car-drive.ts";
import type { CarStyleId } from "../../vehicle/car-variants.ts";
import { blankAiCar, type AiCar } from "../derby-ai.ts";
import { OpenWorldTraffic } from "./openworld-traffic.ts";
import { ALL_RED_SECONDS, LEFT_GREEN_SECONDS, STORE_AT, THROUGH_GREEN_SECONDS, YELLOW_SECONDS } from "./traffic-constants.ts";
import type { TrafficPorts } from "./traffic-ports.ts";
import type { CommuterFeed } from "./traffic-sight.ts";

/** A car with the figures of a sedan's drive, enough to run traffic against without the physics: forward thrust and drag that settle at a sedan's 55 m/s top, a brake, a turn that needs speed. */
const THRUST = 3.5;
const DRAG = THRUST / 55;
const BRAKE = 9;
const TURN = 1.55;
export const STEP_SECONDS = 1 / 30;

/** One whole signal cycle (s): the four phases' greens, each with its yellow and all red. */
export const CYCLE_SECONDS = 2 * THROUGH_GREEN_SECONDS + 2 * LEFT_GREEN_SECONDS + 4 * (YELLOW_SECONDS + ALL_RED_SECONDS);

const UPRIGHT = Array.from({ length: 16 }, (_, index) => (index % 5 === 0 ? 1 : 0));

export const HOLD: DriveInput = { throttle: 0, steer: 0, brake: 1, ebrake: false, boost: false };

/** Sight when no field of view is known: no eye sees anything, and a player's car is near what lies within the radius of it. */
export class ProximitySight {
  readonly hideGrace = 0;
  /** Every claim and every release, as (first, count), in order. */
  readonly claims: { first: number; count: number }[] = [];
  readonly releases: { first: number; count: number }[] = [];
  private claimed = 0;
  private readonly ports: TrafficPorts;

  constructor(ports: TrafficPorts) {
    this.ports = ports;
  }

  claim(count: number): number {
    const first = this.claimed;
    this.claimed += count;
    this.claims.push({ first, count });
    return first;
  }

  observe(): boolean {
    return false;
  }

  unseenFor(): number {
    return Infinity;
  }

  reset(): void {}

  release(first: number, count: number): void {
    this.releases.push({ first, count });
  }

  near(x: number, z: number, radius: number): boolean {
    const cars = this.ports.cars();
    for (let id = 0; id < cars.length; id++) {
      if (!this.ports.seated(id)) continue;
      const car = cars[id]!;
      if (hypot2(car.group.position.x - x, car.group.position.z - z) < radius) return true;
    }
    return false;
  }
}

export class KinematicCar {
  readonly group = { visible: true, position: { x: 0, z: 0 }, matrixWorld: { elements: UPRIGHT } };
  readonly velocity = { x: 0, z: 0 };
  readonly driverOut = null;
  readonly deform = { drivetrainAlive: true };
  style: { id: CarStyleId } = { id: "sedan" };
  crashed = false;
  stored = false;
  yaw = 0;
  speed = 0;

  stand(x: number, z: number, yaw: number): void {
    this.group.position.x = x;
    this.group.position.z = z;
    this.yaw = yaw;
    this.speed = 0;
    this.velocity.x = 0;
    this.velocity.z = 0;
  }

  /** One step of `dt` s under `input`. */
  run(input: DriveInput, dt: number): void {
    this.speed = Math.max(0, this.speed + (input.throttle * THRUST - this.speed * DRAG - input.brake * BRAKE) * dt);
    this.yaw += input.steer * TURN * (0.35 + 0.65 * Math.min(1, this.speed / 8)) * Math.min(1, this.speed / 2) * dt;
    this.velocity.x = Math.sin(this.yaw) * this.speed;
    this.velocity.z = Math.cos(this.yaw) * this.speed;
    this.group.position.x += this.velocity.x * dt;
    this.group.position.z += this.velocity.z * dt;
  }

  /** The car as a driver reads it. */
  snapshot(id: number, into: AiCar = blankAiCar(id)): AiCar {
    into.id = id;
    into.x = this.group.position.x;
    into.z = this.group.position.z;
    into.yaw = this.yaw;
    into.vx = this.velocity.x;
    into.vz = this.velocity.z;
    return into;
  }
}

/** The engine as traffic sees it: a list of kinematic cars (car 0 is the local player's), the seats, and placing and putting away. */
export class FakeField {
  readonly cars: KinematicCar[] = [new KinematicCar()];
  /** The ids traffic had rebuilt as another body, in order. */
  readonly rebuilt: number[] = [];
  readonly seats = new Set<number>([0]);
  readonly ports: TrafficPorts = {
    cars: () => this.cars,
    ensureCars: (count) => {
      while (this.cars.length < count) {
        const car = new KinematicCar();
        car.style = { id: fleetStyle(this.cars.length) };
        this.cars.push(car);
      }
    },
    setBody: (id, style) => {
      this.cars[id]!.style = { id: style };
      this.rebuilt.push(id);
    },
    seated: (id) => this.seats.has(id),
    place: (id, x, z, yaw) => {
      const car = this.cars[id]!;
      car.stored = false;
      car.group.visible = true;
      car.stand(x, z, yaw);
    },
    markPolice: () => {},
    release: (id) => {
      this.cars[id]!.stored = false;
    },
    putAway: (id) => {
      const car = this.cars[id]!;
      car.stored = true;
      car.group.visible = false;
      car.stand(STORE_AT.x + id * STORE_AT.step, STORE_AT.z, 0);
    },
  };
}

/** The sizes a test names: patrol cars default to none. */
type TestSize = { movers: number; kerb: number; patrol?: number };

export const SMALL_FLEET: TestSize = { movers: 6, kerb: 4 };

/** Traffic on a fake field with the sight field that knows only where the players are. */
export function makeTraffic(field: FakeField, size: TestSize = SMALL_FLEET, feed: CommuterFeed | null = null): OpenWorldTraffic {
  return new OpenWorldTraffic([], field.ports, new ProximitySight(field.ports), { ...size, patrol: size.patrol ?? 0 }, feed);
}

/** The crowd clock a test runs traffic on. */
export class Clock {
  seconds = 0;
}

/** One sim step as the engine runs it: the slice's start, every car's input and motion (a seated car takes `seatedInput`), then the step's bookkeeping. */
export function stepField(field: FakeField, traffic: OpenWorldTraffic, clock: Clock, seatedInput: DriveInput = HOLD): void {
  traffic.drive(field.cars);
  for (let id = 0; id < field.cars.length; id++) {
    const car = field.cars[id]!;
    if (car.stored) continue;
    car.run(field.seats.has(id) ? seatedInput : (traffic.inputOf(id, STEP_SECONDS) ?? HOLD), STEP_SECONDS);
  }
  clock.seconds += STEP_SECONDS;
  traffic.step(clock.seconds, STEP_SECONDS);
}

export function runSeconds(field: FakeField, traffic: OpenWorldTraffic, clock: Clock, seconds: number, each?: () => void): void {
  for (let step = 0; step < seconds / STEP_SECONDS; step++) {
    stepField(field, traffic, clock);
    each?.();
  }
}
