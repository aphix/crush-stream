import * as THREE from "three";
import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import type { DeformableCar } from "../vehicle/car.ts";
import type { DriverSeat } from "../vehicle/car-drive.ts";
import { DRIVER_SIDE } from "../vehicle/constants.ts";
import { blankStrike, fell, runsDown } from "../scenes/figure-strike.ts";
import { activeGround, NO_FLOOR } from "../world/ground.ts";
import { PAD_BUTTON, type PadState } from "../vehicle/gamepad.ts";
import type { ChaseCamera } from "../present/engine-camera.ts";
import type { DriverLook } from "../present/driver-look.ts";
import { OnFootFlow, type OnFootRefusal, type OnFootSense, type OnFootStep } from "../present/onfoot-flow.ts";
import type { FootHud } from "../hud/hud-store.ts";
import type { RagdollSystem } from "../present/engine-ragdoll.ts";
import { RUN_SPEED, WALK_SPEED } from "../present/walker-gait.ts";
import { doorBlocked, doorSpot, nearestDoor } from "./onfoot-doors.ts";
import { SEAT_KEYS } from "./engine-keys.ts";
import { blankWalkIntent, readWalkIntent } from "./engine-walk-input.ts";

/** What the director needs from the engine: the objects it acts on, and the questions only the engine can answer. */
interface OnFootHost {
  ragdolls: RagdollSystem;
  seat: DriverSeat;
  view: ChaseCamera;
  camera: THREE.PerspectiveCamera;
  keys: ReadonlySet<string>;
  pad: PadState;
  cars(): readonly DeformableCar[];
  /** Offline free play only: the scene is the fleet, no room, no race or reel. */
  available(): boolean;
  /** The player's own look, as the garage dresses him. */
  look(): DriverLook;
}

/** The control that gets him out and in: Enter on the keyboard (`SEAT_KEYS.onFoot`), B (Circle) on the pad. Neither drives, steers or switches a scene. */
const ON_FOOT_BUTTON = 1 << PAD_BUTTON.east;
/** Keys the car's seat uses that mean nothing on foot (and would pause, reset or switch cars under his feet). */
const SWALLOWED_KEYS: readonly string[] = ["Space", SEAT_KEYS.reset, SEAT_KEYS.stepOut, SEAT_KEYS.previousCar, SEAT_KEYS.nextCar, ...SEAT_KEYS.camera];
const SWALLOWED_BUTTONS = (1 << PAD_BUTTON.back) | (1 << PAD_BUTTON.lb) | (1 << PAD_BUTTON.rb) | (1 << PAD_BUTTON.north) | (1 << PAD_BUTTON.down);

/** The driver's door swings this wide (rad), at this rate (rad/s); it shuts once he is this far (m) from it. */
const DOOR_OPEN = 1.1;
const DOOR_RATE = 3.5;
const DOOR_CLOSE_DISTANCE = 4;
/** A stick pushed less than this far does not move him; slower pushes walk slower, down to this speed (m/s). */
const WALK_DEADZONE = 0.15;
const CREEP_SPEED = 0.8;
/** The walk camera: it looks at his chest from this far (m) and pitch (rad), and the wheel may bring it this close. */
const WALK_SHOT = { lookY: 1.3, radius: 4.8, pitch: 0.34, lookX: 0, lookZ: 0, minRadius: 1.8 };
const LOOK_OVER_TORSO = 0.2;
/** A car that has just run him down does not do it again for this long (s): the launch carries him through its footprint. */
const STRIKE_COOLDOWN = 0.6;
/** Seconds a refusal stays on the prompt. */
const REFUSAL_SECONDS = 2;

const REFUSAL_TEXT: Record<OnFootRefusal, string> = {
  tooFast: "Stop the car first",
  doorBlocked: "No room to open the door",
  noCarInReach: "Walk up to a car's driver door",
  busy: "",
};

const _torso = new THREE.Vector3();
const _spot = new THREE.Vector3();
const _forward = new THREE.Vector3();

/**
 * The player's trip out of the car and back, in the offline fleet: `OnFootFlow` decides what the control does, this carries it out (the
 * door, the seat, the car left parked, the walker the ragdoll pool stands up, the camera that orbits him) and turns the driving controls
 * into the walker's heading and pace. Presentation only: nothing here writes a car's sim state but its parking brake and its driver's door.
 */
export class OnFootDirector {
  readonly flow = new OnFootFlow();
  private readonly host: OnFootHost;
  private readonly intent = blankWalkIntent();
  private readonly sense: OnFootSense = { car: -1, speed: 0, doorBlocked: false };
  private readonly speed = new Float64Array(1);
  private readonly strike = blankStrike();
  /** The car he left or is entering: its door is the one that swings. */
  private car: DeformableCar | null = null;
  private door = 0;
  private doorTarget = 0;
  private framed = false;
  private refusal: OnFootRefusal | null = null;
  private refusalLeft = 0;
  /** The car whose door is in reach this frame (-1 none), for the prompt. */
  private reach = -1;

  constructor(host: OnFootHost) {
    this.host = host;
  }

  get active(): boolean {
    return this.flow.active;
  }

  /** Back in the seat, nothing out: a scene reset has emptied the world. */
  reset(): void {
    this.flow.reset();
    this.car = null;
    this.door = this.doorTarget = 0;
    this.framed = false;
    this.refusal = null;
    this.reach = -1;
  }

  /** A keydown: true when the director took it (the control, or a seat key that means nothing on foot). */
  key(e: KeyboardEvent): boolean {
    if (!this.host.available()) return false;
    if (e.code === SEAT_KEYS.onFoot) {
      e.preventDefault();
      this.press();
      return true;
    }
    return this.flow.active && SWALLOWED_KEYS.includes(e.code);
  }

  /** The pad buttons that went down this poll: true when none is left for the seat (the control, and on foot the seat's buttons). */
  padPress(pressed: number): boolean {
    if (!this.host.available()) return false;
    if ((pressed & ON_FOOT_BUTTON) !== 0) this.press();
    return (pressed & ON_FOOT_BUTTON) !== 0 || (this.flow.active && (pressed & SWALLOWED_BUTTONS) !== 0);
  }

  /** The control was pressed: ask the flow, carry out what it allows, remember what it refused. */
  private press(): void {
    const sense = this.senseWorld();
    if (sense === null) return;
    const step = this.flow.press(sense);
    if (step === "refused") {
      this.refusal = this.flow.refusal;
      this.refusalLeft = REFUSAL_SECONDS;
      return;
    }
    this.refusal = null;
    if (step === "exitStarted") this.beginExit();
    else if (step === "enterStarted") this.beginEnter();
  }

  /** What the flow needs to know: in the driving seat, the car and whether its door has room; on foot, the car in reach. Null while the seat is not his to leave. */
  private senseWorld(): OnFootSense | null {
    const { seat, ragdolls } = this.host;
    const cars = this.host.cars();
    const sense = this.sense;
    if (this.flow.phase === "inCar") {
      const car = cars[seat.carIndex];
      if (seat.mode !== "drive" || !car) return null;
      sense.car = seat.carIndex;
      sense.speed = car.velocity.length();
      sense.doorBlocked = doorBlocked(cars, car, ragdolls.poles);
      return sense;
    }
    sense.doorBlocked = false;
    if (!ragdolls.walkerTorso(_torso)) return null;
    sense.car = nearestDoor(cars, _torso, this.speed);
    sense.speed = sense.car < 0 ? 0 : this.speed[0]!;
    return sense;
  }

  private beginExit(): void {
    const { ragdolls, seat } = this.host;
    const car = this.host.cars()[this.flow.car]!;
    car.group.getWorldDirection(_forward);
    doorSpot(car, _spot);
    if (ragdolls.startWalker(_spot, detAtan2(_forward.x, _forward.z), { cop: false, look: this.host.look() }) < 0) {
      this.flow.reset();
      return;
    }
    car.parked = true;
    car.driverOut = "doorR";
    seat.esc();
    this.car = car;
    this.doorTarget = DOOR_OPEN;
    this.framed = false;
  }

  private beginEnter(): void {
    const { ragdolls } = this.host;
    this.car = this.host.cars()[this.flow.car]!;
    this.doorTarget = DOOR_OPEN;
    ragdolls.walker.command = 0;
    doorSpot(this.car, _spot);
    if (ragdolls.walkerTorso(_torso)) ragdolls.walker.heading = detAtan2(this.car.group.position.x - _torso.x, this.car.group.position.z - _torso.z);
  }

  /** Once per frame, before the ragdoll world steps: the driving controls into the walker's pace, the flow's clock, the door. */
  frame(wallDt: number): void {
    const flow = this.flow;
    this.refusalLeft = Math.max(0, this.refusalLeft - wallDt);
    if (!flow.active) return;
    const { ragdolls } = this.host;
    if (!ragdolls.walker.active) {
      this.reset();
      return;
    }
    if (flow.phase === "onFoot") {
      this.walk();
      this.runDown();
    } else ragdolls.walker.command = 0;
    this.finish(flow.tick(wallDt));
    this.swingDoor(wallDt);
    this.reach = flow.phase === "onFoot" && ragdolls.walkerTorso(_torso) ? nearestDoor(this.host.cars(), _torso, this.speed) : -1;
  }

  /** A car moving fast enough over him (`runsDown`, the lawn guards' and the VIP's rule) throws him with the same launch (`fell`): he goes ragdoll. */
  private runDown(): void {
    const { ragdolls } = this.host;
    const walker = ragdolls.walker;
    if (walker.sinceStruck < STRIKE_COOLDOWN || !ragdolls.walkerTorso(_torso)) return;
    const ground = activeGround().heightAt(_torso.x, _torso.z);
    if (ground === NO_FLOOR) return;
    const cars = this.host.cars();
    for (let i = 0; i < cars.length; i++) {
      if (!runsDown(cars[i]!, _torso.x, _torso.z, ground)) continue;
      ragdolls.knockWalker(fell(cars[i]!, i, -1, _torso.x, ground, _torso.z, detSin(walker.facing), detCos(walker.facing), this.strike));
      return;
    }
  }

  /** The stick and keys, relative to the camera, into the walker's heading and speed. */
  private walk(): void {
    const { camera, view, ragdolls, keys, pad } = this.host;
    const walker = ragdolls.walker;
    const intent = readWalkIntent(keys, pad, this.intent);
    const reach = hypot2(intent.forward, intent.strafe);
    if (reach < WALK_DEADZONE) {
      walker.command = 0;
      return;
    }
    let ahead = view.look.x - camera.position.x;
    let side = view.look.z - camera.position.z;
    const along = hypot2(ahead, side) || 1;
    ahead /= along;
    side /= along;
    const x = ahead * intent.forward - side * intent.strafe;
    const z = side * intent.forward + ahead * intent.strafe;
    walker.heading = detAtan2(x, z);
    walker.command = intent.run ? RUN_SPEED : Math.max(CREEP_SPEED, WALK_SPEED * Math.min(1, reach));
    walker.ask();
  }

  private finish(step: OnFootStep): void {
    if (step === "seated") this.seated();
  }

  /** In the seat: he leaves the pool, the door shuts, the car is his again and the wheel is in his hands. */
  private seated(): void {
    const { ragdolls, seat } = this.host;
    const car = this.car!;
    const index = this.host.cars().indexOf(car);
    ragdolls.stopWalker();
    car.setDoorOpen(DRIVER_SIDE, 0);
    car.driverOut = null;
    car.parked = false;
    seat.focus(index);
    seat.mode = "drive";
    this.car = null;
    this.door = this.doorTarget = 0;
    this.reach = -1;
  }

  /** The door eases toward its target; once he has walked away from it the target is shut. */
  private swingDoor(wallDt: number): void {
    const car = this.car;
    if (car === null) return;
    const { ragdolls } = this.host;
    if (this.flow.phase === "onFoot" && this.doorTarget > 0 && ragdolls.walkerTorso(_torso)) {
      doorSpot(car, _spot);
      if (hypot2(_spot.x - _torso.x, _spot.z - _torso.z) > DOOR_CLOSE_DISTANCE) this.doorTarget = 0;
    }
    const gap = this.doorTarget - this.door;
    if (gap === 0) return;
    this.door += Math.max(-DOOR_RATE * wallDt, Math.min(DOOR_RATE * wallDt, gap));
    car.setDoorOpen(DRIVER_SIDE, this.door);
    if (this.doorTarget === 0 && this.door === 0 && this.flow.phase === "onFoot") this.car = null;
  }

  /** The camera: it orbits his chest, with the same drag, stick and mouse look as everywhere. True while it is his. */
  aim(wallDt: number): boolean {
    if (!this.flow.active || !this.host.ragdolls.walkerTorso(_torso)) return false;
    const view = this.host.view;
    const camera = this.host.camera;
    if (!this.framed) {
      this.framed = true;
      WALK_SHOT.lookX = _torso.x;
      WALK_SHOT.lookZ = _torso.z;
      view.frameReset(true, this.host.cars(), detAtan2(camera.position.x - _torso.x, camera.position.z - _torso.z), WALK_SHOT);
    }
    view.look.set(_torso.x, _torso.y + LOOK_OVER_TORSO, _torso.z);
    view.orbit(wallDt, 0, true, null);
    return true;
  }

  /** The HUD's read of the trip, or null where it is not offered. */
  hud(): FootHud | null {
    return this.host.available() ? { out: this.flow.active, prompt: this.prompt() } : null;
  }

  /** The line under the view: what the control does here, or why it just refused. Null when there is nothing to say. */
  prompt(): string | null {
    if (this.refusalLeft > 0 && this.refusal !== null && this.refusal !== "busy") return REFUSAL_TEXT[this.refusal];
    if (!this.host.available()) return null;
    if (this.flow.phase === "onFoot") return this.reach >= 0 ? "Enter or B: get in" : "Walk up to a car's driver door";
    return this.host.seat.mode === "drive" ? "Enter or B: get out" : null;
  }
}
