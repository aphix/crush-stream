import type { RigidBody, World } from "@dimforge/rapier3d-simd";
import { readTranslation } from "../kernel/rapier.ts";

/**
 * A standing prop's fixed body is in the dummies' world only while a body that moves is near it: Rapier's broad phase costs a step in
 * proportion to every collider it holds (the open world's 168 standing props with their 1,149 colliders are 0.04 ms of each of the 8 steps a frame, with one dummy out).
 * A prop comes in when a moving body (a dummy's part, a car's proxy, a loose part, a knocked prop) is within `REACH_ON` m of it on the ground plane, and goes
 * when the nearest is past `REACH_OFF`. A frame's steps (`MAX_ACC` 0.05 s) move a body at most 1.5 m at 30 m/s and 3.5 m at 70 m/s, so a body is never met before its prop is in. The on-foot camera's sweep
 * (`watch`) is a mover too: a prop between the walker and a zoomed-out eye still stops it.
 */
const REACH_ON = 6;
const REACH_OFF = 9;
/** Moving bodies read a frame; more than this and every prop stays in. */
const MAX_MOVERS = 128;

export class PropReach {
  private readonly at = new Float64Array(MAX_MOVERS * 2);
  private readonly pos = new Float64Array(3);
  private movers = 0;
  private readonly sight = new Float64Array(4);
  private watching = false;
  /** Per placement: its body is in the world. */
  private on = new Uint8Array(0);
  private readonly visit = (body: RigidBody): void => {
    if (body.isFixed() || !body.isEnabled()) return;
    if (this.movers === MAX_MOVERS) {
      this.movers++;
      return;
    }
    if (this.movers > MAX_MOVERS) return;
    readTranslation(body, this.pos, 0);
    this.at[this.movers * 2] = this.pos[0]!;
    this.at[this.movers * 2 + 1] = this.pos[2]!;
    this.movers++;
  };

  /** The camera's sweep from (`ax`, `az`) to (`bx`, `bz`): a prop near it is in from the next `tend`. */
  watch(ax: number, az: number, bx: number, bz: number): void {
    this.sight[0] = ax;
    this.sight[1] = az;
    this.sight[2] = bx;
    this.sight[3] = bz;
    this.watching = true;
  }

  /** All of `count` placements' bodies are in the world (just built). */
  reset(count: number): void {
    this.on = new Uint8Array(count).fill(1);
  }

  /** Every standing body back in the world as at the build, and no sweep watched: a new run, or the gate turned off. */
  restore(bodies: readonly (RigidBody | null)[]): void {
    for (let i = 0; i < bodies.length; i++) if (this.on[i] === 0) bodies[i]?.setEnabled(true);
    this.on.fill(1);
    this.watching = false;
  }

  /** Prop `i`'s `body` is in the world: it is about to fly. */
  wake(i: number, body: RigidBody): void {
    if (this.on[i] === 1) return;
    body.setEnabled(true);
    this.on[i] = 1;
  }

  /** Before a frame's steps: every prop whose `state` is `standing` in the world or out of it by the nearest moving body, `placed` giving where it stands. */
  tend(world: World, bodies: readonly (RigidBody | null)[], state: Uint8Array, standing: number, placed: readonly { x: number; z: number }[]): void {
    this.movers = 0;
    // Rapier's `RigidBodySet.forEach`, not an array's: the one walk of the set that makes nothing.
    // oxlint-disable-next-line unicorn/no-array-for-each
    world.bodies.forEach(this.visit);
    const all = this.movers > MAX_MOVERS;
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      if (!body || state[i] !== standing) continue;
      let near = all;
      if (!near) {
        const reach = this.on[i] === 1 ? REACH_OFF : REACH_ON;
        const px = placed[i]!.x;
        const pz = placed[i]!.z;
        for (let m = 0; m < this.movers && !near; m++) {
          const dx = this.at[m * 2]! - px;
          const dz = this.at[m * 2 + 1]! - pz;
          near = dx * dx + dz * dz < reach * reach;
        }
        if (!near && this.watching) {
          const ax = this.sight[0]!;
          const az = this.sight[1]!;
          const abx = this.sight[2]! - ax;
          const abz = this.sight[3]! - az;
          const length = abx * abx + abz * abz;
          const along = length > 0 ? Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / length)) : 0;
          const dx = ax + abx * along - px;
          const dz = az + abz * along - pz;
          near = dx * dx + dz * dz < reach * reach;
        }
      }
      const want = near ? 1 : 0;
      if (want === this.on[i]) continue;
      body.setEnabled(near);
      this.on[i] = want;
    }
  }
}
