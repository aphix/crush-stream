import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import type { PadState } from "../vehicle/gamepad.ts";
import type { ChaseCamera } from "../present/engine-camera.ts";
import type { RagdollSystem } from "../present/engine-ragdoll.ts";
import type { Sight } from "../present/spectate-cam.ts";
import {
  acrossAt,
  BLEND_SECONDS,
  boomAt,
  CAMERA_RADIUS,
  Damped,
  FIRST_PERSON_RADIUS,
  FIRST_PITCH,
  FOLLOW_BOOM,
  FOLLOW_PITCH,
  FOLLOW_RADIUS,
  FollowFocus,
  followFov,
  LOOK_AHEAD,
  type OnFootView,
  REST_PITCH,
  SHOULDER_ACROSS,
  sprintBoom,
  type Sweep,
  THIRD_PITCH,
  VIEW_BOOM,
  viewAt,
  WalkerView,
} from "../present/walker-camera.ts";
import { smoothstep } from "../present/walker-math.ts";

/** What the on-foot camera works with. */
interface OnFootCameraHost {
  ragdolls: RagdollSystem;
  view: ChaseCamera;
  camera: THREE.PerspectiveCamera;
  pad: PadState;
  /** The scene's solids the camera keeps its line of sight clear of while he climbs in, or null where there are none. */
  sight(): Sight | null;
}

/** Aiming: the boom (m), and how far the pivot moves to the camera's right past the shoulder framing's and up (m). Tuned by feel. */
const AIM_BOOM = 1.6;
const AIM_SIDE = 0.45;
const AIM_UP = 0.15;
/** While he climbs into his car the camera draws back by this share of its distance. */
const ENTER_PULL_BACK = 1.35;
/** The shown zoom follows the wheel's and a pinch's over this long (s), so a notch glides. Tuned by feel. */
const ZOOM_TIME = 0.1;
/** The near plane comes in to the eye's distance to his head less this (m), not under the floor: GTA's `Max(PedColDist - 0.3, 0.05)` (.extraResearch/third-person-camera-and-controls.md). */
const NEAR_SLACK = 0.3;
const NEAR_FLOOR = 0.05;
/** View (V) steps out to in, then back out. */
const NEXT_VIEW: Record<OnFootView, OnFootView> = { follow: "shoulder", shoulder: "first", first: "follow" };

const _aim = new THREE.Vector3();
const _forward = new THREE.Vector3();
/** The camera's view while it blends in from the car's (`BLEND_SECONDS`). */
const _blendEye = new THREE.Vector3();
const _blendAim = new THREE.Vector3();

/**
 * The camera on foot, with the same drag, stick, mouse look and wheel as everywhere: GTA's follow behind him, his whole body in view; the wheel and
 * a pinch glide in through an over-the-shoulder framing to his own eyes, and View steps through the three. The boom's ball is swept out from his head
 * and stops short of every solid of the dummies' world (walls, a building's streamed boxes, the facades, cars), in at once, out eased. A pad's view comes
 * back behind him after a pause in the look; a mouse's never does. Taking it over from the car blends over `BLEND_SECONDS`; while he climbs back in it
 * draws back round the car on the orbit. Nothing allocates.
 */
export class OnFootCamera {
  private readonly host: OnFootCameraHost;
  private readonly follow = new FollowFocus();
  private readonly walkerView = new WalkerView();
  private readonly sweep: Sweep;
  private readonly shown = new Damped();
  private framed = false;
  /** The view he has chosen: View and the wheel's (or a pinch's) last notch change it, and nothing else does (`keepZoom`). */
  private mode: OnFootView = "follow";
  /** The zoom count (`ChaseCamera.zoomedTimes`) and the orbit's distance as the last frame left them: a distance that moved without a zoom is not his. */
  private zoomsSeen = 0;
  private zoomKept = 0;
  private blendLeft = 0;
  private baseNear = 0;
  /** The orbit as the car left it, given back when he sits down again: its zoom range and distance, its pitch range and pitch. */
  private carMinRadius = 0;
  private carRadius = 0;
  private carPitch = 0;
  private carPitchLow = 0;
  private carPitchHigh = 0;

  constructor(host: OnFootCameraHost) {
    this.host = host;
    this.sweep = (x, y, z, dx, dy, dz, length) => host.ragdolls.sightClear(x, y, z, dx, dy, dz, length, CAMERA_RADIUS);
  }

  /** The view on foot. A drag, a click and every other camera's leavings never change it. */
  get view(): OnFootView {
    return this.framed ? this.mode : "follow";
  }

  /** The next frame takes the camera over afresh (he has just got out). */
  unframe(): void {
    this.framed = false;
  }

  /** View (V, T, C, the pad's B): follow, over his shoulder, his eyes, and round again. */
  cycle(): void {
    if (!this.framed) return;
    const { view } = this.host;
    const next = NEXT_VIEW[this.mode];
    const range = next === "first" ? FIRST_PITCH : THIRD_PITCH;
    this.mode = next;
    view.easeOrbit(VIEW_BOOM[next], Math.max(range.low, Math.min(range.high, view.orbitPitch)), 1);
    this.zoomKept = view.orbitRadius;
  }

  /** One frame of the camera on him, his torso at `torso`; `aiming`: the aim's tighter shoulder shot. */
  aim(wallDt: number, torso: THREE.Vector3, aiming: boolean): void {
    const { view, camera, ragdolls, pad } = this.host;
    const walker = ragdolls.walker;
    if (!this.framed) this.begin(torso);
    this.follow.follow(wallDt, torso.x, torso.y, torso.z, walker.loco.speed);
    this.keepZoom();
    const first = this.mode === "first" && walker.state === "stand";
    const range = first ? FIRST_PITCH : THIRD_PITCH;
    view.pitchLow = range.low;
    view.pitchHigh = range.high;
    const point = this.follow.point;
    view.look.set(point[0]!, point[1]!, point[2]!);
    const byPad = pad.connected && (pad.lx !== 0 || pad.ly !== 0);
    if (!first) view.turnOrbit(this.follow.recenter(wallDt, view.orbitAngle, walker.facing, walker.loco.speed, view.lookingAround, byPad));
    view.setLens(followFov(camera.aspect), false);
    // The orbit takes the stick, the drag and the mouse look; the eye it places is this one's to replace.
    view.orbit(wallDt, 0, false, null);
    const pitch = Math.max(range.low, Math.min(range.high, view.orbitPitch));
    const level = this.shown.step(view.orbitRadius, ZOOM_TIME, wallDt);
    const yaw = view.orbitAngle;
    const sight = this.walkerView;
    if (first) sight.first(torso.x, torso.y, torso.z, yaw, pitch, this.sweep, wallDt);
    else if (aiming) sight.shoulder(torso.x, torso.y, torso.z, point[0]!, point[1]! + AIM_UP, point[2]!, yaw, pitch, AIM_BOOM, SHOULDER_ACROSS + AIM_SIDE, this.sweep, wallDt);
    else sight.shoulder(torso.x, torso.y, torso.z, point[0]!, point[1]!, point[2]!, yaw, pitch, sprintBoom(boomAt(level, pitch), walker.loco.speed), acrossAt(level), this.sweep, wallDt);
    camera.position.set(sight.eye[0]!, sight.eye[1]!, sight.eye[2]!);
    _aim.set(sight.eye[0]! + sight.ahead[0]! * LOOK_AHEAD, sight.eye[1]! + sight.ahead[1]! * LOOK_AHEAD, sight.eye[2]! + sight.ahead[2]! * LOOK_AHEAD);
    view.look.copy(_aim);
    this.blendLeft = Math.max(0, this.blendLeft - wallDt);
    if (this.blendLeft > 0) {
      const share = smoothstep(1 - this.blendLeft / BLEND_SECONDS);
      camera.position.lerpVectors(_blendEye, camera.position, share);
      _aim.lerpVectors(_blendAim, _aim, share);
    }
    camera.lookAt(_aim);
    view.pos.copy(camera.position);
    this.setNear(Math.max(NEAR_FLOOR, Math.min(this.baseNear, sight.headGap - NEAR_SLACK)));
    ragdolls.showWalkerHead(!sight.inHead || this.blendLeft > 0);
  }

  /**
   * The zoom is his: the wheel and a pinch set the view, View sets it, and nothing else may. A distance the orbit's pose moved to without a zoom (a hold
   * on the view another camera left, an eased pose) is put back, so no click or drag changes the view. A notch in while a wall holds the boom in zooms
   * from where the eye stands, not from the boom asked for.
   */
  private keepZoom(): void {
    const { view } = this.host;
    if (view.zoomedTimes !== this.zoomsSeen) {
      this.zoomsSeen = view.zoomedTimes;
      const reached = this.shown.x * this.walkerView.reachShare;
      if (this.mode !== "first" && view.orbitRadius < this.zoomKept && reached < this.zoomKept) {
        view.easeOrbit((reached * view.orbitRadius) / this.zoomKept, view.orbitPitch, 1);
        this.shown.snap(reached);
      }
      this.mode = viewAt(view.orbitRadius);
    } else if (view.orbitRadius !== this.zoomKept) {
      view.easeOrbit(this.zoomKept, view.orbitPitch, 1);
    }
    this.zoomKept = view.orbitRadius;
  }

  /** While he climbs in: the orbit's focus moves to the car and the camera draws back round it, his head in view again. */
  drawBack(wallDt: number, torso: THREE.Vector3, car: DeformableCar | undefined): void {
    const { view, ragdolls } = this.host;
    const walker = ragdolls.walker;
    if (!this.framed) this.begin(torso);
    if (car) torso.set(car.group.position.x, torso.y, car.group.position.z);
    this.follow.follow(wallDt, torso.x, torso.y, torso.z, walker.loco.speed);
    view.look.set(this.follow.point[0]!, this.follow.point[1]!, this.follow.point[2]!);
    view.turnOrbit(this.follow.recenter(wallDt, view.orbitAngle, walker.facing, walker.loco.speed, view.lookingAround, true));
    view.easeOrbit(FOLLOW_RADIUS * ENTER_PULL_BACK, FOLLOW_PITCH, 1 - Math.exp((-3 * wallDt) / BLEND_SECONDS));
    view.setLens(null, false);
    view.orbit(wallDt, 0, true, this.host.sight());
    this.setNear(this.baseNear);
    ragdolls.showWalkerHead(true);
  }

  /**
   * He has just got out: the follow starts on him, the camera's view as the car left it is where the blend starts, and the orbit (its pose adopted
   * from the car's camera) takes the follow's boom and pitch and the walker's zoom range; the car's are kept for when he sits down again.
   */
  private begin(torso: THREE.Vector3): void {
    const { view, camera } = this.host;
    this.framed = true;
    this.blendLeft = BLEND_SECONDS;
    this.baseNear = camera.near;
    this.follow.seed(torso.x, torso.y, torso.z);
    this.walkerView.reset();
    _blendEye.copy(camera.position);
    camera.getWorldDirection(_forward);
    _blendAim.copy(camera.position).addScaledVector(_forward, LOOK_AHEAD);
    this.carMinRadius = view.minRadius;
    this.carRadius = view.orbitRadius;
    this.carPitch = view.orbitPitch;
    this.carPitchLow = view.pitchLow;
    this.carPitchHigh = view.pitchHigh;
    view.look.set(this.follow.point[0]!, this.follow.point[1]!, this.follow.point[2]!);
    view.orbit(0, 0, false, null);
    view.minRadius = FIRST_PERSON_RADIUS;
    view.pitchLow = THIRD_PITCH.low;
    view.pitchHigh = THIRD_PITCH.high;
    view.easeOrbit(FOLLOW_BOOM, REST_PITCH, 1);
    this.shown.snap(view.orbitRadius);
    this.mode = "follow";
    this.zoomsSeen = view.zoomedTimes;
    this.zoomKept = view.orbitRadius;
  }

  /** The trip's camera is over: the car's zoom and pitch range, its orbit and its near plane back as they were, his head drawn again. */
  end(): void {
    if (!this.framed) return;
    const { view, ragdolls } = this.host;
    this.framed = false;
    view.minRadius = this.carMinRadius;
    view.pitchLow = this.carPitchLow;
    view.pitchHigh = this.carPitchHigh;
    view.easeOrbit(this.carRadius, this.carPitch, 1);
    this.setNear(this.baseNear);
    ragdolls.showWalkerHead(true);
  }

  private setNear(near: number): void {
    const camera = this.host.camera;
    if (camera.near === near) return;
    camera.near = near;
    camera.updateProjectionMatrix();
  }
}
