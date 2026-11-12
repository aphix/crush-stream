import * as THREE from "three";
import { activeGround } from "../world/ground.ts";
import type { DriverLook } from "../present/driver-look.ts";
import type { RagdollSystem } from "../present/engine-ragdoll.ts";
import { BASE_SLOTS } from "../present/ragdoll-config.ts";
import type { FigureStrike } from "../scenes/figure-strike.ts";

const _at = new THREE.Vector3();
const _v = new THREE.Vector3();

/** The open world's bodies on the ragdoll pool: the walkers a player on foot and the showcase's figures are (`RagdollSystem.startWalker`), one to a slot past the pool's base slots. */
export class RagdollBodyHost {
  private readonly ragdolls: () => RagdollSystem;

  constructor(ragdolls: () => RagdollSystem) {
    this.ragdolls = ragdolls;
  }

  setCapacity(slots: number): void {
    this.ragdolls().setCapacity(Math.max(BASE_SLOTS, slots));
  }

  freeSlot(from: number): number {
    return this.ragdolls().freeSlot(from);
  }

  start(x: number, y: number, z: number, yaw: number, look: DriverLook, slot: number, vx: number, vz: number): number {
    return this.ragdolls().startWalker(_at.set(x, y, z), yaw, { cop: false, look }, slot, _v.set(vx, 0, vz));
  }

  stop(slot: number): void {
    this.ragdolls().stopWalker(slot);
  }

  torso(slot: number, out: { x: number; z: number }): boolean {
    if (!this.ragdolls().torso(slot, _at, null)) return false;
    out.x = _at.x;
    out.z = _at.z;
    return true;
  }

  path(slot: number, out: { x: number; z: number }): void {
    const gait = this.ragdolls().walkers[slot]!.gait;
    out.x = gait.pathX;
    out.z = gait.pathZ;
  }

  steer(slot: number, heading: number, speed: number): void {
    const walker = this.ragdolls().walkers[slot]!;
    walker.heading = heading;
    walker.command = speed;
  }

  standing(slot: number): boolean {
    return this.ragdolls().walkers[slot]!.state === "stand";
  }

  steady(slot: number): boolean {
    const walker = this.ragdolls().walkers[slot]!;
    return walker.state === "stand" && walker.strength >= 1;
  }

  holds(slot: number): boolean {
    return this.ragdolls().walkers[slot]?.active === true;
  }

  getUp(slot: number): void {
    this.ragdolls().walkers[slot]!.ask();
  }

  knock(slot: number, strike: FigureStrike): void {
    this.ragdolls().knockWalker(strike, slot);
  }

  groundAt(x: number, z: number): number {
    return activeGround().heightAt(x, z, 0.5);
  }
}
