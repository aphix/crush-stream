import { detCos, detSin } from "../kernel/physics-core.js";
import type { DriverLook } from "../present/driver-look.ts";
import type { FigureStrike } from "../scenes/figure-strike.ts";

/** One body of the fake world: where it stands, its steering, whether it is out, on its feet and held up. */
type FakeBody = { slot: number; x: number; z: number; heading: number; speed: number; out: boolean; standing: boolean; steady: boolean; held: boolean; look: DriverLook };

/** The dummies' world as the bodies see it, with no physics: a walker moves at the pace it is steered at, and a test sets what it needs of one (knocked down, lagging). */
export class FakeBodyHost {
  capacity = 0;
  readonly bodies = new Map<number, FakeBody>();
  readonly started: { slot: number; x: number; y: number; z: number; yaw: number; vx: number; vz: number }[] = [];
  readonly stopped: number[] = [];
  readonly knocks: { slot: number; strike: FigureStrike }[] = [];
  readonly gotUp: number[] = [];
  /** Slots held by something else (a lying figure), so `freeSlot` skips them. */
  readonly occupied = new Set<number>();
  /** A body that is asked to get up stays down (something holds it). */
  stubborn = false;
  /** The ground's height (m) everywhere. */
  ground = 0;

  setCapacity(slots: number): void {
    this.capacity = slots;
  }

  freeSlot(from: number): number {
    for (let slot = from; slot < this.capacity; slot++) if (!this.occupied.has(slot) && !this.bodies.get(slot)?.out) return slot;
    return -1;
  }

  start(x: number, y: number, z: number, yaw: number, look: DriverLook, slot: number, vx: number, vz: number): number {
    this.started.push({ slot, x, y, z, yaw, vx, vz });
    this.bodies.set(slot, { slot, x, z, heading: yaw, speed: 0, out: true, standing: true, steady: true, held: true, look: { ...look } });
    return slot;
  }

  stop(slot: number): void {
    this.stopped.push(slot);
    const body = this.bodies.get(slot);
    if (body) body.out = false;
  }

  torso(slot: number, out: { x: number; z: number }): boolean {
    const body = this.bodies.get(slot);
    if (!body?.out) return false;
    out.x = body.x;
    out.z = body.z;
    return true;
  }

  path(slot: number, out: { x: number; z: number }): void {
    this.torso(slot, out);
  }

  steer(slot: number, heading: number, speed: number): void {
    const body = this.bodies.get(slot)!;
    body.heading = heading;
    body.speed = speed;
  }

  standing(slot: number): boolean {
    return this.bodies.get(slot)!.standing;
  }

  steady(slot: number): boolean {
    const body = this.bodies.get(slot)!;
    return body.standing && body.steady;
  }

  holds(slot: number): boolean {
    const body = this.bodies.get(slot);
    return body?.out === true && body.held;
  }

  getUp(slot: number): void {
    this.gotUp.push(slot);
    if (!this.stubborn) this.bodies.get(slot)!.standing = true;
  }

  knock(slot: number, strike: FigureStrike): void {
    this.knocks.push({ slot, strike });
    this.bodies.get(slot)!.standing = false;
  }

  groundAt(): number {
    return this.ground;
  }

  /** Every standing body walks `dt` s at the pace it was steered at. */
  advance(dt: number): void {
    for (const body of this.bodies.values()) {
      if (!body.out || !body.standing) continue;
      body.x += detSin(body.heading) * body.speed * dt;
      body.z += detCos(body.heading) * body.speed * dt;
    }
  }
}
