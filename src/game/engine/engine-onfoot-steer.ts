import * as THREE from "three";
import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import type { PadState, TouchPad } from "../vehicle/gamepad.ts";
import type { ChaseCamera } from "../present/engine-camera.ts";
import type { RagdollSystem } from "../present/engine-ragdoll.ts";
import { RUN_SPEED, SPRINT_SPEED, WALK_SPEED } from "../present/walker-locomotion.ts";
import type { OnFootArms } from "./engine-onfoot-arms.ts";
import { blankWalkIntent, readWalkIntent, type WalkIntent } from "./engine-walk-input.ts";

/** What the steering needs of the engine: the walker, the view his heading is relative to, and the controls. */
type SteerHost = {
  ragdolls: RagdollSystem;
  view: ChaseCamera;
  keys: ReadonlySet<string>;
  pad: PadState;
  touch: TouchPad;
};

/** The slowest speed (m/s) a push that clears the pad's own dead zone asks for; the pad reader (`gamepad.ts`) owns the one dead zone and curve. */
const CREEP_SPEED = 0.8;
/** A push below this (the reader's output, 0 inside its dead zone) does not move him. */
const WALK_STOP = 0.01;
/** The keys' direction eases to a new one over about this long (s), so a corner is turned, not snapped. */
const INTENT_SECONDS = 0.08;
/** Firing at a target off his facing turns him to it, and holds him turning (not walking) this long (s): his facing turns at most 8 rad/s, so a half turn is done well inside it. */
const FIRE_TURN_S = 0.6;
/** Led by the law he walks at `WALK_SPEED` (a hair over the cop's escort pace) to where his cop leads him, and stands once within this far (m) of it. */
const LED_REACH = 0.5;

const _torso = new THREE.Vector3();

/** The controls and the law's lead turned into the walker's heading and pace. */
export class OnFootSteer {
  private readonly host: SteerHost;
  private readonly arms: OnFootArms;
  private readonly intent = blankWalkIntent();
  /** The walk direction the keys ask for, eased (`INTENT_SECONDS`); not seeded while he stands still. */
  private smoothAhead = 0;
  private smoothSide = 0;
  private intentSeeded = false;
  /** The heading he turns to for a shot (`faceToward`), and the seconds that turn still holds him. */
  private turnHeading = 0;
  private turnLeft = 0;
  /** Where his cop leads him while the law has him on foot (`lead`). */
  private ledX = 0;
  private ledZ = 0;

  constructor(host: SteerHost, arms: OnFootArms) {
    this.host = host;
    this.arms = arms;
  }

  /** His cop leads him to (x, z): his walker walks there until a patrol car takes him. */
  lead(x: number, z: number): void {
    this.ledX = x;
    this.ledZ = z;
  }

  /** The next walk starts from the keys as they are, not from where the easing left off. */
  unseed(): void {
    this.intentSeeded = false;
  }

  /** He turns to face the level direction (dx, dz) of a target behind him for a shot, and stands while he does; a turn in progress is not started again by the shots that follow. */
  faceToward(dx: number, dz: number): void {
    if (this.turnLeft > 0) return;
    this.turnHeading = detAtan2(dx, dz);
    this.turnLeft = FIRE_TURN_S;
  }

  /** In custody on foot (no patrol car has him yet): his walker walks to where his cop leads him, whatever he presses. */
  walkLed(): void {
    const { ragdolls } = this.host;
    const walker = ragdolls.walker;
    if (!walker.active || !ragdolls.walkerTorso(_torso)) return;
    if (hypot2(this.ledX - _torso.x, this.ledZ - _torso.z) < LED_REACH) {
      walker.command = 0;
      return;
    }
    walker.heading = detAtan2(this.ledX - _torso.x, this.ledZ - _torso.z);
    walker.command = WALK_SPEED;
    walker.ask();
  }

  /** The speed (m/s) a push of `reach` (0 to 1) asks for: Boost sprints, the walk control holds a walk, else the push walks from a creep up to a run along the reader's curve. */
  private pace(intent: WalkIntent, reach: number): number {
    if (intent.sprint) return SPRINT_SPEED;
    if (intent.walk) return WALK_SPEED;
    return CREEP_SPEED + (RUN_SPEED - CREEP_SPEED) * Math.min(1, reach);
  }

  /**
   * The stick and keys, relative to the view, into the walker's heading and speed. The view's way is the orbit's yaw (the eye stands at (sin, cos) of it behind
   * him), not the drawn camera's position: that eases in after the climb out, so a held direction read from it would curve with the blend.
   */
  walk(wallDt: number, armed: boolean): void {
    const { view, ragdolls, keys, pad, touch } = this.host;
    const walker = ragdolls.walker;
    const intent = readWalkIntent(keys, pad, touch, this.intent, armed);
    const reach = hypot2(intent.forward, intent.strafe);
    const ahead = -detSin(view.orbitAngle);
    const side = -detCos(view.orbitAngle);
    this.turnLeft = Math.max(0, this.turnLeft - wallDt);
    if (this.turnLeft > 0 && !this.arms.aiming) {
      walker.heading = this.turnHeading;
      walker.command = 0;
      this.intentSeeded = false;
      return;
    }
    if (this.arms.aiming) {
      // Aiming: he faces where the camera looks and walks forward only, at no more than a walk.
      walker.heading = detAtan2(ahead, side);
      walker.command = intent.forward > 0.5 ? Math.min(this.pace(intent, reach), WALK_SPEED) : 0;
      if (reach >= WALK_STOP) walker.ask();
      this.intentSeeded = false;
      return;
    }
    if (reach < WALK_STOP) {
      walker.command = 0;
      this.intentSeeded = false;
      return;
    }
    if (!this.intentSeeded || walker.state !== "stand") {
      this.smoothAhead = intent.forward;
      this.smoothSide = intent.strafe;
      this.intentSeeded = true;
    } else {
      const ease = 1 - Math.exp(-wallDt / INTENT_SECONDS);
      this.smoothAhead += (intent.forward - this.smoothAhead) * ease;
      this.smoothSide += (intent.strafe - this.smoothSide) * ease;
    }
    const x = ahead * this.smoothAhead - side * this.smoothSide;
    const z = side * this.smoothAhead + ahead * this.smoothSide;
    walker.heading = detAtan2(x, z);
    walker.command = this.pace(intent, reach);
    walker.ask();
  }
}
