import type { RigidBody, World } from "@dimforge/rapier3d-simd";
import { readTranslation } from "../kernel/rapier.ts";

/** What `PropReach` asks of the props: prop `i` in the world or out of it. */
type PropOwner = { inWorld(i: number, on: boolean): void };

/**
 * A standing prop's fixed body is in the dummies' world only while a body that moves is near it: Rapier's broad phase costs a step in
 * proportion to every collider it holds (the open world's 168 standing props with their 1,149 colliders are 0.04 ms of each of the 8 steps a frame, with one dummy out).
 * A prop comes in when a moving body (a dummy's part, a car's proxy, a loose part, a knocked prop) is within `REACH_ON` m of it on the ground plane, and goes
 * when the nearest is past `REACH_OFF`. A frame's steps (`MAX_ACC` 0.05 s) move a body at most 1.5 m at 30 m/s and 3.5 m at 70 m/s, so a body is never met before its prop is in. The on-foot camera's sweep
 * (`watch`) is a mover too: a prop between the walker and a zoomed-out eye still stops it.
 */
const REACH_ON = 6;
const REACH_OFF = 9;
/** Moving bodies read a frame; more than this and every prop stays in, until fewer than `RELEASE_MOVERS` (a count that wobbles round the bound would make and take out every prop each frame). */
const MAX_MOVERS = 128;
const RELEASE_MOVERS = 96;

export class PropReach {
  private readonly at = new Float64Array(MAX_MOVERS * 2);
  private readonly pos = new Float64Array(3);
  private movers = 0;
  /** Every prop is in whatever its distance, since more than `MAX_MOVERS` bodies move. */
  private allIn = false;
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
    this.allIn = false;
  }

  /** Every standing prop back in the world as at the build, and no sweep watched: a new run, or the gate turned off. */
  restore(owner: PropOwner): void {
    for (let i = 0; i < this.on.length; i++) if (this.on[i] === 0) owner.inWorld(i, true);
    this.on.fill(1);
    this.watching = false;
    this.allIn = false;
  }

  /** Prop `i` is in the world: it is about to fly. */
  wake(i: number): void {
    this.on[i] = 1;
  }

  /** Before a frame's steps: every prop whose `state` is `standing` in the world or out of it by the nearest moving body, `placed` giving where it stands. */
  tend(world: World, owner: PropOwner, knockable: Uint8Array, state: Uint8Array, standing: number, placed: readonly { x: number; z: number }[]): void {
    this.movers = 0;
    // Rapier's `RigidBodySet.forEach`, not an array's: the one walk of the set that makes nothing.
    // oxlint-disable-next-line unicorn/no-array-for-each
    world.bodies.forEach(this.visit);
    if (this.movers > MAX_MOVERS) this.allIn = true;
    else if (this.movers < RELEASE_MOVERS) this.allIn = false;
    const all = this.allIn;
    for (let i = 0; i < placed.length; i++) {
      if (knockable[i] !== 1 || state[i] !== standing) continue;
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
      owner.inWorld(i, near);
      this.on[i] = want;
    }
  }
}
