import * as THREE from "three";
import { DeformContact } from "./deform-contact.ts";
import { EPICENTER, epicenterOn } from "./epicenter.ts";
import { MIN_MASS_SUM } from "./constants.ts";
import { MASS_SPECS } from "../kernel/rig-spec.ts";

const _a = new THREE.Vector3();
/** How far (m) a frozen car's mass may sit from where it froze, and from where its frame puts it, before `checkFrozen` counts a write: the frame's re-derived places carry 1e-6 of rounding drift a second (measured), a writer moves a mass by millimetres. */
const FROZEN_SLACK = 1e-4;

/**
 * The structure step of a wreck that stays out of the solve: the epicenter activation's freeze (`EPICENTER`). A frozen wreck's masses ride its frame (`rideBody`: the
 * rigid velocity field, which is also what every mass is given once the contact window is over), its structure step is a clock, and any write to a mass or to
 * its contact clock thaws it first (`DeformRig.thaw`).
 */
export abstract class DeformFreeze extends DeformContact {
  /** `EPICENTER.frozenCheck`: slices a frozen car was found written to without a thaw, and what it was frozen as (every mass's car-frame place, the contact clock). */
  frozenBreaches = 0;
  private readonly frozenLocal = new Float64Array(MASS_SPECS.length * 3);
  private frozenContact = 0;
  /** The baseline (`frozenLocal`, `frozenContact`) is taken at a frozen car's first step, not at the freeze: a planted hub's `local` is its pin at the freeze and its stand once the rigid step has re-derived it from the world (same place in the world, the normal path does the same each slice). */
  private frozenBased = false;

  /**
   * End of a world slice, after the structure step (so the slice that crossed the quiet time still ran it: the window's one-shots, the plant): relocks the wreck
   * under `epicenter` activation (`EPICENTER`) once its quiet time has reached `relockHold` (and, when set, its body is slower than `settleMps` and `settleSpin`,
   * and `thawHold` s have passed since the last thaw), or thaws it when none of that holds any more. A contact thaws it at once (`thaw`), so a slice that meets one never skips its solve.
   *
   * INVARIANT the freeze rests on (measured: head-on, hubRL 15 cm off whole when it broke): after the whole-path `integrateWreck` that caches the frozen centre, no `clampLocal`
   * (`syncPose`) may run until a thaw. `integrateWreck` re-derives every `local` from `world` first, and a planted hub's `clampLocal` pins `local` and leaves `world` alone, so `integrateFrozen`'s
   * placement (`world = local x matrixWorld`) is only right while the last write to `local` was that re-derive. That is why the pre-pair and post-pair `syncPose` and the structure step all
   * skip on `frozen`, the one slice after the flag is set (still the whole integrate) included. The re-derive has one exception, in that freeze slice: a hub that stands more than `HUB_PIN_MAX`
   * from its pin keeps the pin (`integrateWreck`), since a planted hub of a spinning wreck stands up to 1.5 m off its frame place at that moment (derby seed 7, 13.2 s) and the re-derive froze it there.
   */
  settleFreeze(dt: number): void {
    this.sinceThaw += dt;
    const want =
      this.massActive &&
      epicenterOn() &&
      this.mode === "shape" &&
      !this.bidirectional &&
      this.quietTime() >= EPICENTER.relockHold &&
      this.sinceThaw >= EPICENTER.thawHold &&
      (EPICENTER.settleMps <= 0 || this.bodyV.length() < EPICENTER.settleMps) &&
      (EPICENTER.settleSpin <= 0 || this.bodyW.length() < EPICENTER.settleSpin);
    if (want === this.frozen) return;
    this.frozen = want;
    this.frozenReady = false;
    if (want) {
      this.freezes++;
      this.frozenBased = false;
    } else this.thaws++;
  }

  /**
   * The body is rigid now: every mass takes the rigid body's velocity and spin (`followGroup`'s `bodyV`, `bodyW`) about its centre (their centroid
   * off by `liftOffset`). `rigid`: the drivetrain runs, so the turn is applyDrive's and the body keeps none of its own. A frozen wreck (`stepFrozen`) runs only this.
   */
  protected rideBody(rigid: boolean): void {
    let cx = 0,
      cy = 0,
      cz = 0,
      msum = 0;
    for (let mi = 0; mi < this.masses.length; mi++) {
      const m = this.masses[mi]!;
      if (!m.dynamic) continue;
      cx += m.world.x * m.mass;
      cy += m.world.y * m.mass;
      cz += m.world.z * m.mass;
      msum += m.mass;
    }
    if (msum > MIN_MASS_SUM) {
      cx = cx / msum + this.liftOffset.x;
      cy = cy / msum + this.liftOffset.y;
      cz = cz / msum + this.liftOffset.z;
      // A driven wreck's turn is applyDrive's (its tyres, not this rule, stop a wreck's spin): the body keeps none of its own.
      if (rigid) this.bodyW.y = 0;
      const wx = this.bodyW.x;
      const wy = this.bodyW.y;
      const wz = this.bodyW.z;
      for (let mi = 0; mi < this.masses.length; mi++) {
        const m = this.masses[mi]!;
        if (!m.dynamic) continue;
        const rx = m.world.x - cx;
        const ry = m.world.y - cy;
        const rz = m.world.z - cz;
        m.vel.x = this.bodyV.x + wy * rz - wz * ry;
        m.vel.y = this.bodyV.y + wz * rx - wx * rz;
        m.vel.z = this.bodyV.z + wx * ry - wy * rx;
      }
    }
  }

  /** `EPICENTER.frozenCheck`: the invariant of `settleFreeze` as a check: a `followGroup` (so a `clampLocal`) on a frozen car whose centre is cached re-pins its planted hubs' `local` away from where they stand, and `integrateFrozen` then places them there (measured: hubRL 15 cm off whole). A breach is counted; the call goes on. */
  override followGroup(group: THREE.Object3D, velocityOut: THREE.Vector3, angularOut: THREE.Vector3, dt: number): void {
    if (EPICENTER.frozenCheck === 1 && this.frozenReady) this.frozenBreaches++;
    super.followGroup(group, velocityOut, angularOut, dt);
  }

  /**
   * A relocked wreck's structure step (`EPICENTER`): the clock goes on (the quiet time and the re-arm rules read it) and the masses ride the body as they do
   * after the contact window; the solver, the suspension, the ground reads and the frame's re-measure (`followGroup`) are skipped: the cage is frozen.
   */
  stepFrozen(dt: number, group: THREE.Object3D, asleep = false): void {
    // A sleeper flagged frozen but not cached was never re-derived (`integrateWreck` returns for it): its masses stand where the whole path left them.
    if (EPICENTER.frozenCheck === 1 && (this.frozenReady || !asleep)) this.checkFrozen(group);
    this.elapsed += dt;
    this.rideBody(this.drivetrainAlive);
    this.nodesLoose = 0;
    this.nodesLocked = this.matchedNodes;
  }

  /** Why the breaches (`frozenCheck`) were counted: the contact clock restarted, a mass's car-frame place moved, a mass stood off where its frame puts it (a step can count in several). */
  breachClock = 0;
  breachMoved = 0;
  breachOff = 0;
  /** The largest distance (m) a mass stood off its frame at a breach, and which mass. */
  breachOffMax = 0;
  breachOffName = "";

  /** `EPICENTER.frozenCheck`: a frozen car's masses are where its frame puts them, as they stood when it froze, and its contact clock has not restarted; else a writer skipped `thaw`. */
  private checkFrozen(group: THREE.Object3D): void {
    group.updateWorldMatrix(false, false);
    if (!this.frozenBased) {
      this.frozenBased = true;
      for (let i = 0; i < this.masses.length; i++) {
        const l = this.masses[i]!.local;
        this.frozenLocal[i * 3] = l.x;
        this.frozenLocal[i * 3 + 1] = l.y;
        this.frozenLocal[i * 3 + 2] = l.z;
      }
      this.frozenContact = this.lastContact;
      return;
    }
    const clock = this.lastContact !== this.frozenContact;
    let moved = false;
    let off = false;
    for (let i = 0; i < this.masses.length; i++) {
      const m = this.masses[i]!;
      if (Math.abs(m.local.x - this.frozenLocal[i * 3]!) + Math.abs(m.local.y - this.frozenLocal[i * 3 + 1]!) + Math.abs(m.local.z - this.frozenLocal[i * 3 + 2]!) > FROZEN_SLACK) moved = true;
      const stand = _a.copy(m.local).applyMatrix4(group.matrixWorld).distanceTo(m.world);
      if (stand > FROZEN_SLACK) {
        off = true;
        if (stand > this.breachOffMax) {
          this.breachOffMax = stand;
          this.breachOffName = m.name;
        }
      }
    }
    if (clock || moved || off) this.frozenBreaches++;
    if (clock) this.breachClock++;
    if (moved) this.breachMoved++;
    if (off) this.breachOff++;
  }

}
