/*
 * Thrown-driver ragdolls: a cosmetic crash-test dummy flung out through the windshield or a front side window
 * when one hit disables a car (`EjectionWatch`). Its own Rapier world (@dimforge/rapier3d-simd, Apache-2.0):
 * ground and walls are fixed colliders around the throw, every car near a dummy (`near`; and the sandbox's
 * jersey barrier) a kinematic box that follows its pose, so cars push dummies and nothing pushes back; no dummy state reaches the sim or the
 * netplay snapshots. The camera may ride along with the latest dummy's head (`follow`, `frameCamera`).
 *
 * The jointed body (ten boxes on spherical joints: head, torso, upper and lower arms, thighs, shins) follows the
 * approach of Matthias von Bargen's rapierjs-ragdoll (https://github.com/mattvb91/rapierjs-ragdoll, MIT License,
 * Copyright (c) Matthias von Bargen), rewritten for this engine: one instanced mesh, pooled bodies, no model.
 * The MIT License: Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following
 * conditions: The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 * OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import type * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import type { BoxPlacement } from "./ragdoll-boxes.ts";
import type { RideFrame } from "./ride-cam.ts";
import type { Sight } from "./spectate-cam.ts";
import { applyHit, LAG, type PartHit } from "./ragdoll-wire.ts";
import { LIFE } from "./ragdoll-pool.ts";
import { NO_LOOSE, recordLoose } from "./ragdoll-loose.ts";
import { RagdollThrower } from "./ragdoll-throw.ts";

export type { RagdollStats, Throw } from "./ragdoll-pool.ts";

export class RagdollSystem extends RagdollThrower {
  /**
   * Start Rapier (`loadRapier`), build the pool and run one step so the first throw only places bodies. The
   * engine calls this once boot is `ready`; until it resolves `update` only judges hits (`pending`). The world's worker
   * (`RagdollRemote`) starts beside it, where the browser has Workers.
   */
  preload(): Promise<void> {
    return (this.loading ??= this.load());
  }

  /** A new run: no dummies out, every car's driver back in, every knocked prop back on its spot. */
  reset(): void {
    this.pending.length = 0;
    this.driverThrows.length = 0;
    this.struck.length = 0;
    this.frameNo = 0;
    this.proxies.clearStrikes();
    this.acc = this.tick = 0;
    this.ride.reset();
    this.mode = null;
    this.dressing.clear();
    this.remote?.reset();
    for (let s = 0; s < this.dolls.length; s++) this.despawn(s);
    this.props.clear();
    this.boxes.clear();
    this.loose.clear();
    this.thrownLife = LIFE;
    this.tumble?.reset();
    for (const c of this.statics) this.world?.removeCollider(c, false);
    this.statics.length = 0;
  }

  /**
   * One frame: step the dummies and the knocked props `dt` sim seconds against the cars' poses (`authority`: this peer
   * owns the glass, so it smashes the exit pane of a throw). `sandbox`: neither a race nor a derby (`onThrow`);
   * `barrier`: the sandbox's jersey barrier while it stands, else null. Who
   * is thrown is not decided here (`launch`); a throw launched before Rapier is in waits for it, up to `PENDING_MAX`; a
   * prop knocked before it is in flies once it is. In the worker's world (`mode` "remote") the frame is posted to it instead
   * and the last answer drawn.
   */
  update(dt: number, cars: readonly DeformableCar[], authority: boolean, sandbox: boolean, barrier: THREE.Object3D | null): void {
    if (dt <= 0) return;
    this.cars = cars;
    this.authority = authority;
    this.sandbox = sandbox;
    if (this.mode === "remote") {
      this.updateRemote(dt, cars);
      return;
    }
    this.followWalkerGround();
    this.applyStruck(cars);
    this.stepWorld(dt, cars, authority, sandbox, barrier, this.live > 0 || this.props.count > 0 || this.boxes.count > 0 ? recordLoose(cars, this.wanted) : NO_LOOSE);
    for (const hit of this.proxies.strikes.splice(0)) this.struck.push({ frame: this.frameNo, ...hit });
  }

  /**
   * The panes and parts the world struck, applied to the cars `LAG` frames after the frame they were struck in: the same frame whether
   * the dummies' world runs here or in the worker (`RagdollRemote.post`), so the sim hears of a strike at a fixed step in both.
   */
  private applyStruck(cars: readonly DeformableCar[]): void {
    const due = this.frameNo + 1 - LAG;
    while (this.struck.length > 0 && this.struck[0]!.frame <= due) applyHit(this.struck.shift()!, cars, this.onPartHit);
  }

  /** The panes and parts struck since the last call, emptied (the worker's answer carries them to the main thread). */
  takeStrikes(): PartHit[] {
    return this.proxies.strikes.splice(0);
  }

  /** The ride-along camera is on (`follow` until every dummy out lies still). */
  get rideAlong(): boolean {
    return this.ride.riding;
  }

  /** Ride along with the dummies thrown (`RideAlong.follow`). */
  follow(): void {
    this.ride.follow(this.dolls[this.lastSlot], this.lastSlot, this.cars);
  }

  /** The ride's aim, eased toward the dummies' heads (`frameCamera` "held": the orbit looks at it). */
  get rideLook(): THREE.Vector3 {
    return this.ride.cam.look;
  }

  /** Before the engine's own rigs place `camera`: back to the pose they left, under the eased one `fadeRide` drew (`RideCam.unfade`). */
  unfadeRide(camera: THREE.PerspectiveCamera): void {
    this.ride.cam.unfade(camera);
  }

  /** After the engine's own camera has placed `camera` this frame: ease it out of the ride's last pose (`RideCam.fade`). */
  fadeRide(camera: THREE.PerspectiveCamera, wallDt: number, on: boolean): void {
    this.ride.cam.fade(camera, wallDt, on);
  }

  /** The latest throw's torso (world) into `out`, and the sim seconds it has lain still; -1 while it is not out. */
  latest(out: THREE.Vector3): number {
    const d = this.dolls[this.lastSlot];
    if (!d?.live) return -1;
    out.set(d.cur[0]!, d.cur[1]!, d.cur[2]!);
    return d.still;
  }

  /** The latest throw lies settled on the ground (`calm`): he has landed. */
  get latestSettled(): boolean {
    const d = this.dolls[this.lastSlot];
    return d !== undefined && d.live && d.settled;
  }

  /** Place `camera` on the dummies being followed: "none" when none is (the engine's own camera runs), "held" when the user's orbit has it (`RideAlong.frame`; `lead`: s the aim runs ahead of their velocity, the minigames). */
  frameCamera(camera: THREE.PerspectiveCamera, wallDt: number, hold: boolean, watched: number, held: boolean, lens: number, sight: () => Sight, lead = 0): RideFrame {
    return this.ride.frame(this.dolls, this.alpha, camera, wallDt, hold, watched, held, lens, sight, lead);
  }

  dispose(): void {
    this.disposed = true;
    this.remote?.dispose();
    this.remote = null;
    this.debug.dispose();
    this.mesh.removeFromParent();
    this.purses?.dispose();
    this.props.dispose();
    this.boxes.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
    this.world?.free();
    this.world = null;
  }

  /** The range minigames' boxes: replace any with ones at `boxes`, asleep; remembered for `restackBoxes`. */
  setBoxes(boxes: readonly BoxPlacement[]): void {
    this.boxes.set(boxes);
  }

  /** Every box back at the placement `setBoxes` gave it, still and asleep (a Retry). */
  restackBoxes(): void {
    this.boxes.restack();
  }

  clearBoxes(): void {
    this.boxes.clear();
  }

  /** Every box's pose into `out` (7 floats each: position xyz, rotation xyzw); returns the box count. */
  copyBoxPoses(out: Float32Array): number {
    return this.boxes.copyPoses(out);
  }
}
