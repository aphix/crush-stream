import type { RigidBody, World } from "@dimforge/rapier3d-simd";
import { readTranslation } from "../kernel/rapier.ts";

/**
 * A standing prop's fixed body is in the dummies' world only while a body that moves is near it: Rapier's broad phase costs a step in
 * proportion to every collider it holds (the open world's 168 standing props with their 1,149 colliders are 0.04 ms of each of the 8 steps a frame, with one dummy out).
 * A prop comes in when a moving body (a dummy's part, a car's proxy, a loose part, a knocked prop) is within `REACH_ON` m of it on the ground plane, and goes
 * when the nearest is past `REACH_OFF`. The bodies move at most 1.2 m a frame (70 m/s), so a body is never met before its prop is in.
 */
const REACH_ON = 6;
const REACH_OFF = 9;
/** Moving bodies read a frame; more than this and every prop stays in. */
const MAX_MOVERS = 128;

export class PropReach {
  private readonly at = new Float64Array(MAX_MOVERS * 2);
  private readonly pos = new Float64Array(3);
  private movers = 0;
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

  /** All of `count` placements' bodies are in the world (just built). */
  reset(count: number): void {
    this.on = new Uint8Array(count).fill(1);
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
      }
      const want = near ? 1 : 0;
      if (want === this.on[i]) continue;
      body.setEnabled(near);
      this.on[i] = want;
    }
  }
}
