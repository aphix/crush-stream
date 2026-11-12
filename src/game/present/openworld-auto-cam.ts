import * as THREE from "three";
import { hypot2 } from "../kernel/physics-core.js";
import type { AutoPose } from "../ai/openworld-auto/auto-scan.ts";
import { EyeClear } from "./eye-clear.ts";
import type { Occluder, Sight } from "./spectate-cam.ts";
import { Spring3 } from "./spring.ts";

/** The eye's spring rate (1/s) and the aim's: the eye trails its subject a little, the aim holds him in the middle of the frame. */
const EYE_OMEGA = 3.5;
const AIM_OMEGA = 7;
/** The time constant (s) the heading a shot stands behind follows the subject's own with: a turn of a walker does not whip the camera. */
const HEADING_TAU = 0.6;
/** A shot stands up to this far (rad) round the subject's heading, either side, picked per cut. */
const SHOT_SWING = 0.75;
const NO_BOXES: readonly Occluder[] = [];

const _target = new THREE.Vector3();
const _subject = new THREE.Vector3();
const _placed = new THREE.Vector3();

/**
 * The Auto camera's framing: the eye behind and over the subject (a person's shoulder shot, a car's chase shot from its own style), a little round to a side the cut picked,
 * following on springs and kept clear of the buildings and cars by `EyeClear` (the chase cams' wall clearance). A cut snaps it. Presentation only; no allocation.
 */
export class AutoFollowCam {
  private readonly eye = new Spring3();
  private readonly aim = new Spring3();
  private readonly clear = new EyeClear();
  private readonly heading = new THREE.Vector2();
  private swing = 0;
  private fresh = true;

  /** The next `update` is a cut: the eye and the aim stand where they are asked at once, round the heading by `swing` (-1 to 1 of `SHOT_SWING`). */
  cut(swing: number): void {
    this.fresh = true;
    this.swing = swing * SHOT_SWING;
    this.clear.reset();
  }

  /** The player's hold on the view ends: the eye and the aim carry on from where the camera and its aim stand, so the shot eases back to its framing and does not cut. */
  adopt(camera: THREE.Camera, aim: THREE.Vector3): void {
    this.eye.x.copy(camera.position);
    this.eye.v.set(0, 0, 0);
    this.aim.x.copy(aim);
    this.aim.v.set(0, 0, 0);
    this.fresh = false;
    this.clear.reset();
  }

  /** Frames `pose` in `camera`, `dt` s after the last call. */
  update(camera: THREE.PerspectiveCamera, pose: AutoPose, sight: Sight, dt: number): void {
    this.followHeading(pose.yaw, dt);
    const along = Math.cos(this.swing);
    const across = Math.sin(this.swing);
    const behindX = this.heading.x * along - this.heading.y * across;
    const behindZ = this.heading.y * along + this.heading.x * across;
    _target.set(pose.x - behindX * pose.back, pose.y + pose.height, pose.z - behindZ * pose.back);
    _subject.set(pose.x, pose.y + pose.aimUp, pose.z);
    if (this.fresh) {
      this.eye.x.copy(_target);
      this.eye.v.set(0, 0, 0);
      this.aim.x.copy(_subject);
      this.aim.v.set(0, 0, 0);
    } else {
      this.eye.step(_target, EYE_OMEGA, dt);
      this.aim.step(_subject, AIM_OMEGA, dt);
    }
    _placed.copy(this.eye.x);
    this.clear.apply(sight, sight.cars ?? NO_BOXES, this.aim.x, _placed, this.fresh ? Infinity : dt);
    this.fresh = false;
    camera.position.copy(_placed);
    camera.lookAt(this.aim.x);
  }

  /** The heading the shot stands behind: the subject's own, low-passed; exactly it on a cut. */
  private followHeading(yaw: number, dt: number): void {
    const x = Math.sin(yaw);
    const z = Math.cos(yaw);
    const k = this.fresh ? 1 : 1 - Math.exp(-dt / HEADING_TAU);
    const hx = this.heading.x + (x - this.heading.x) * k;
    const hz = this.heading.y + (z - this.heading.y) * k;
    const length = hypot2(hx, hz);
    if (length > 0) this.heading.set(hx / length, hz / length);
    else this.heading.set(x, z);
  }
}
