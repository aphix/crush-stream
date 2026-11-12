import * as THREE from "three";
import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import type { DeformableCar } from "../vehicle/car.ts";
import type { DriverSeat } from "../vehicle/car-drive.ts";
import type { Ejection } from "../vehicle/ejection.ts";
import { blankStrike, fell, runsDown } from "../scenes/figure-strike.ts";
import { activeGround, NO_FLOOR } from "../world/ground.ts";
import { PAD_BUTTON, type PadState, type TouchPad } from "../vehicle/gamepad.ts";
import type { ChaseCamera } from "../present/engine-camera.ts";
import type { DriverLook } from "../present/driver-look.ts";
import { OnFootFlow, type OnFootRefusal, type OnFootSense, type OnFootStep } from "../present/onfoot-flow.ts";
import type { FootHud } from "../hud/hud-store.ts";
import type { RagdollSystem } from "../present/engine-ragdoll.ts";
import { RUN_SPEED, SPRINT_SPEED, WALK_SPEED } from "../present/walker-locomotion.ts";
import {
  BLEND_SECONDS,
  CAMERA_RADIUS,
  FIRST_PERSON_RADIUS,
  FOLLOW_PITCH,
  FOLLOW_RADIUS,
  FollowFocus,
  followFov,
  LOOK_AHEAD,
  type OnFootView,
  SHOULDER_BOOM,
  SHOULDER_NEAREST,
  SHOULDER_PITCH,
  type Sweep,
  VIEW_PITCH,
  WalkerView,
} from "../present/walker-camera.ts";
import { smoothstep } from "../present/walker-math.ts";
import type { Sight } from "../present/spectate-cam.ts";
import { doorBlocked, doorInReach, doorSpot, inPlay } from "./onfoot-doors.ts";
import { DRIVER_SIDE } from "../vehicle/constants.ts";
import { SEAT_KEYS } from "./engine-keys.ts";
import { blankWalkIntent, readWalkIntent, type WalkIntent } from "./engine-walk-input.ts";
import { OnFootArms, STRAIGHT_UP, type Gun } from "./engine-onfoot-arms.ts";
import { LookRay } from "../ai/civilians/civilian-look.ts";

/** What the director needs from the engine: the objects it acts on, and the questions only the engine can answer. */
interface OnFootHost {
  ragdolls: RagdollSystem;
  seat: DriverSeat;
  view: ChaseCamera;
  camera: THREE.PerspectiveCamera;
  keys: ReadonlySet<string>;
  pad: PadState;
  touch: TouchPad;
  cars(): readonly DeformableCar[];
  /** The game is running a scene with a player's car to leave: free play, a race (not in its menu), a derby, a mini game, a rig; online or off. */
  available(): boolean;
  /** A race is on: Escape and the pad's Back are its pause menu's, so they are not swallowed on foot. */
  racing(): boolean;
  /** The player's own look, as the garage dresses him. */
  look(): DriverLook;
  /** The scene's solids the camera keeps its line of sight clear of, or null where there are none. */
  sight(): Sight | null;
  /** The open world's free roam (solo, or a room's lobby): the reset on foot puts him in a fresh car, and his thrown-out driver is his to walk. */
  openWorld(): boolean;
  /** This browser runs the cars (solo, a netplay host): it moves his car and puts its driver back in; a client's are the host's. */
  runsCars(): boolean;
  /** Car `index` fresh on the road nearest (x, z), facing the way nearer `facing` (`RaceField.placeNear`); false where there is no clear spot. */
  freshCarNear(index: number, x: number, z: number, facing: number): boolean;
  /** The reset a driver has (R): his car back at its spawn, repaired; a client asks the host. */
  respawn(): void;
  /** Car `index`, not the one he left, has nobody in it and he may get into it (the open world's free roam, on a machine that runs the cars). */
  enterable(index: number): boolean;
  /** He gets into car `index`, not the one he left: it is the car he drives from now on, and the one he left stays where it stands, empty. */
  adopt(index: number): void;
  /** Whether this machine is a guest in a room (it holds no authority). The one line a later plan replaces to give guests weapons. */
  guest(): boolean;
  /** Mouse look (pointer lock) is on. */
  mouseCaptured(): boolean;
  /** Turns mouse look on (inside a user gesture) or off. */
  captureMouse(on: boolean): void;
  /** His punch lands from (x, z) along the unit (dirX, dirZ). */
  punchLanded(x: number, z: number, dirX: number, dirZ: number): void;
  /** The ray a shot goes along, into `out`: from the camera through the view's centre (`centre`), else through the cursor. */
  aimRay(centre: boolean, out: LookRay): void;
  /** One ray of `gun` at the authority: how far (m) it went. */
  shootRay(ray: LookRay, gun: Gun): number;
  /** A shot of `gun` was fired along `ray` and its farthest ray went `far` m: the flash, the tracer, the sound, the law. */
  shotFired(ray: LookRay, far: number, gun: Gun): void;
}

/** The control that gets him out and in: Enter on the keyboard (`SEAT_KEYS.onFoot`), Y (Triangle) on the pad. Neither drives, steers or switches a scene. */
const ON_FOOT_BUTTON = 1 << PAD_BUTTON.north;
/** Keys the car's seat uses that mean nothing on foot (and would pause, reset or switch cars under his feet). */
const SWALLOWED_KEYS: readonly string[] = ["Space", SEAT_KEYS.reset, SEAT_KEYS.stepOut, SEAT_KEYS.previousCar, SEAT_KEYS.nextCar, ...SEAT_KEYS.camera];
const BACK_BUTTON = 1 << PAD_BUTTON.back;
/** The pad's View button (B, Circle): the drive views in the seat, the on-foot views out of it. */
const VIEW_BUTTON = 1 << PAD_BUTTON.east;
/** The pad's reset (D-pad down, the touch Respawn): in the open world it puts him back in a fresh car (`resetsToCar`). */
const RESET_BUTTON = 1 << PAD_BUTTON.down;
const SWALLOWED_BUTTONS = BACK_BUTTON | VIEW_BUTTON | (1 << PAD_BUTTON.lb) | (1 << PAD_BUTTON.rb) | RESET_BUTTON;

/** The slowest speed (m/s) a push that clears the pad's own dead zone asks for; the pad reader (`gamepad.ts`) owns the one dead zone and curve. */
const CREEP_SPEED = 0.8;
/** A push below this (the reader's output, 0 inside its dead zone) does not move him. */
const WALK_STOP = 0.01;
/** The keys' direction eases to a new one over about this long (s), so a corner is turned, not snapped. */
const INTENT_SECONDS = 0.08;
/** While he climbs into his car the camera draws back by this share of its distance. */
const ENTER_PULL_BACK = 1.35;
/** A car that has just run him down does not do it again for this long (s): the launch carries him through its footprint. */
const STRIKE_COOLDOWN = 0.6;
/** Seconds a refusal stays on the prompt. */
const REFUSAL_SECONDS = 2;
/** Led by the law he walks at `WALK_SPEED` (a hair over the cop's escort pace) to where his cop leads him, and stands once within this far (m) of it. */
const LED_REACH = 0.5;
/** In the open world his driver's door swings this wide (rad) at this rate (rad/s) as he gets out or in, and shuts once he is this far (m) from it. */
const DOOR_OPEN = 1.1;
const DOOR_RATE = 3.5;
const DOOR_CLOSE_DISTANCE = 4;
/** Aiming: the shoulder boom (m), and how far the point it looks from moves to the camera's right (level) and up (m). */
const AIM_BOOM = 1.6;
const AIM_SIDE = 0.45;
const AIM_UP = 0.15;

const REFUSAL_TEXT: Record<OnFootRefusal, string> = {
  tooFast: "Stop the car first",
  doorBlocked: "No room to open the door",
  noCarInReach: "Walk up to your car's driver door",
  busy: "",
};

const _torso = new THREE.Vector3();
const _spot = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _aim = new THREE.Vector3();
/** The camera's view while it blends in from the car's (`BLEND_SECONDS`). */
const _blendEye = new THREE.Vector3();
const _blendAim = new THREE.Vector3();
const _aimRay = new LookRay();
const _shotRay = new LookRay();

/** `from` with its direction tilted inside a cone of half-angle `cone` (rad) by the two draws `r1`, `r2` (0 to 1), into `out`. Allocates nothing. */
function scatter(from: LookRay, cone: number, r1: number, r2: number, out: LookRay): void {
  out.eyeX = from.eyeX;
  out.eyeY = from.eyeY;
  out.eyeZ = from.eyeZ;
  // u: a level unit vector across the direction (straight up or down: +x); v = direction × u.
  const flat = Math.sqrt(from.dirX * from.dirX + from.dirZ * from.dirZ);
  const ux = flat > STRAIGHT_UP ? -from.dirZ / flat : 1;
  const uz = flat > STRAIGHT_UP ? from.dirX / flat : 0;
  const vx = from.dirY * uz;
  const vy = from.dirZ * ux - from.dirX * uz;
  const vz = -from.dirY * ux;
  const tilt = cone * Math.sqrt(r1);
  const spread = detSin(tilt) / detCos(tilt);
  const c = detCos(2 * Math.PI * r2) * spread;
  const s = detSin(2 * Math.PI * r2) * spread;
  const x = from.dirX + c * ux + s * vx;
  const y = from.dirY + s * vy;
  const z = from.dirZ + c * uz + s * vz;
  const n = 1 / Math.sqrt(x * x + y * y + z * z);
  out.dirX = x * n;
  out.dirY = y * n;
  out.dirZ = z * n;
}

/**
 * The player's trip out of his car and back, in any scene that has one: `OnFootFlow` decides what the control does, this carries it out (the walker
 * the ragdoll pool stands up, the seat stepped back, the camera that orbits him) and turns the driving controls into the walker's heading and pace.
 * Presentation only; the one thing it writes to a car is its driver's door, in the open world (`openDoor`): the engine reads `away` to treat the car as a driverless one holding its brakes.
 */
export class OnFootDirector {
  readonly flow = new OnFootFlow();
  readonly arms = new OnFootArms({ armed: () => this.armed(), punch: () => this.punch(), land: () => this.landPunch(), captured: () => this.host.mouseCaptured(), capture: (on) => this.host.captureMouse(on), shoot: (gun) => this.shoot(gun) });
  private readonly host: OnFootHost;
  private readonly intent = blankWalkIntent();
  private readonly sense: OnFootSense = { car: -1, speed: 0, doorBlocked: false };
  private readonly speed = new Float64Array(1);
  private readonly strike = blankStrike();
  private framed = false;
  /** The view he has chosen: View and the wheel's (or a pinch's) last notch change it, and nothing else does (`keepZoom`). */
  private mode: OnFootView = "shoulder";
  /** The zoom count (`ChaseCamera.zoomedTimes`) and the orbit's distance as the last frame left them: a distance that moved without a zoom is not his. */
  private zoomsSeen = 0;
  private zoomKept = 0;
  private blendLeft = 0;
  private readonly follow = new FollowFocus();
  private readonly walkerView = new WalkerView();
  private readonly sweep: Sweep;
  /** The orbit as the car left it, given back when he sits down again: its zoom range and distance, its pitch range and pitch. */
  private carMinRadius = 0;
  private carRadius = 0;
  private carPitch = 0;
  private carPitchLow = 0;
  private carPitchHigh = 0;
  private refusal: OnFootRefusal | null = null;
  private refusalLeft = 0;
  /** Whether his car's door is in reach this frame, for the prompt. */
  private reach = false;
  /** Where his cop leads him while the law has him on foot (`lead`). */
  private ledX = 0;
  private ledZ = 0;
  /** The car whose driver's door he is swinging (-1: none), how far open it is (rad), and where it is going. */
  private doorCar = -1;
  private door = 0;
  private doorTarget = 0;
  /** The walk direction the keys ask for, eased (`INTENT_SECONDS`); not seeded while he stands still. */
  private smoothAhead = 0;
  private smoothSide = 0;
  private intentSeeded = false;

  constructor(host: OnFootHost) {
    this.host = host;
    this.sweep = (x, y, z, dx, dy, dz, length) => host.ragdolls.sightClear(x, y, z, dx, dy, dz, length, CAMERA_RADIUS);
  }

  /** The view on foot: his own eyes once the wheel or View has brought the orbit inside the nearest shoulder camera, else over his shoulder. A drag, a click and every other camera's leavings never change it. */
  get footView(): OnFootView {
    return this.framed ? this.mode : "shoulder";
  }

  /** On foot in the open world the reset control (R, D-pad down, Respawn; a tap or a hold, as at the wheel) is his: back in a fresh car (`resetIntoCar`). */
  get resetsToCar(): boolean {
    return this.flow.phase === "onFoot" && this.host.openWorld();
  }

  /** Whether fire, aim and weapons are his: on foot in the open world, solo or as the room's host. */
  armed(): boolean {
    return this.host.openWorld() && this.flow.phase === "onFoot" && !this.host.guest();
  }

  private punch(): boolean {
    return this.host.ragdolls.walker.punch();
  }

  private landPunch(): void {
    const { ragdolls } = this.host;
    const walker = ragdolls.walker;
    if (walker.state !== "stand" || !ragdolls.walkerTorso(_torso)) return;
    this.host.punchLanded(_torso.x, _torso.z, detSin(walker.facing), detCos(walker.facing));
  }

  /** The shot counter's seeded stream: each ray takes two draws from it. */
  private shotSeed = 1;

  private draw(): number {
    this.shotSeed = (Math.imul(this.shotSeed, 1664525) + 1013904223) >>> 0;
    return this.shotSeed / 4294967296;
  }

  /** One shot of `gun` along the aim: the view's centre when the mouse is captured, aim is held or he looks through his own eyes, else the cursor's ray. Each ray scatters inside the gun's cone by a seeded draw. Allocates nothing: the rifle calls it eight times a second. */
  private shoot(gun: Gun): void {
    this.host.aimRay(this.arms.aiming || this.host.mouseCaptured() || this.footView === "first", _aimRay);
    let far = 0;
    for (let ray = 0; ray < gun.rays; ray++) {
      scatter(_aimRay, gun.cone, this.draw(), this.draw(), _shotRay);
      far = Math.max(far, this.host.shootRay(_shotRay, gun));
    }
    this.host.shotFired(_aimRay, far, gun);
  }

  /**
   * The reset on foot in the open world: the trip ends and he is at the wheel of his car, fresh (repaired, at rest) on the road nearest where he stood,
   * facing the way he faced. Where no road spot is clear, or on a netplay client (the host runs its cars), the reset a driver has puts it back at its spawn.
   */
  resetIntoCar(): void {
    const { ragdolls, seat } = this.host;
    const car = this.flow.car;
    const out = ragdolls.walkerTorso(_torso);
    const placed = out && this.host.runsCars() && this.host.freshCarNear(car, _torso.x, _torso.z, ragdolls.walker.facing);
    ragdolls.stopWalker();
    this.reset();
    seat.focus(car);
    seat.mode = "drive";
    if (!placed) this.host.respawn();
  }

  /**
   * Car `car`'s driver is thrown out (`e`): in the open world, when it is the car he drives, the player takes him over (`RagdollSystem.ejectWalker`): he
   * flies limp, gets up once asked and walks, the camera on him, and the car stays where it ends up for him to climb back into. True when he was taken over.
   */
  takeEjected(e: Ejection): boolean {
    const { ragdolls, seat } = this.host;
    if (this.flow.active || !this.host.openWorld() || !this.host.available() || seat.mode !== "drive" || seat.carIndex !== e.car) return false;
    if (ragdolls.ejectWalker(e, this.host.cars()) < 0) return false;
    this.flow.thrownOut(e.car);
    seat.esc();
    this.framed = false;
    this.refusal = null;
    return true;
  }

  /** The law has him (open world, host and solo): his walker is led where it takes him and nothing he presses acts until it sets him down (`deliver`). */
  arrest(): void {
    if (!this.flow.active) return;
    this.flow.arrest();
    this.refusal = null;
    if (this.host.ragdolls.walkerTorso(_torso)) this.lead(_torso.x, _torso.z);
  }

  /** His cop leads him to (x, z): his walker walks there until a patrol car takes him. */
  lead(x: number, z: number): void {
    this.ledX = x;
    this.ledZ = z;
  }

  /** Patrol car `carIndex` has him aboard: his walker is gone from the street and the camera follows the car. */
  take(carIndex: number): void {
    if (this.flow.phase !== "arrested") return;
    this.endView();
    this.host.ragdolls.stopWalker();
    this.host.seat.focus(carIndex);
  }

  /** The law sets him down at (x, z) facing `yaw`: he stands there, his own car brought to the road nearest, and the controls are his again. */
  deliver(x: number, z: number, yaw: number): void {
    const { ragdolls, seat } = this.host;
    if (this.flow.phase !== "arrested") return;
    const car = this.flow.car;
    if (!this.host.freshCarNear(car, x, z, yaw)) this.host.respawn();
    this.endView();
    ragdolls.stopWalker();
    const ground = activeGround().heightAt(x, z);
    _spot.set(x, ground === NO_FLOOR ? 0 : ground, z);
    seat.focus(car);
    if (ragdolls.startWalker(_spot, yaw, { cop: false, look: this.host.look() }) >= 0) {
      this.flow.released();
      return;
    }
    this.reset();
    seat.mode = "drive";
  }

  /** View (V, T, C, the pad's B, the HUD's camera) on foot: over the shoulder to his eyes and back. Nothing while he climbs in or out. */
  cycleView(): void {
    if (this.flow.phase !== "onFoot" || !this.framed) return;
    const { view } = this.host;
    const next: OnFootView = this.footView === "first" ? "shoulder" : "first";
    const pitch = Math.max(VIEW_PITCH[next].low, Math.min(VIEW_PITCH[next].high, view.orbitPitch));
    this.mode = next;
    view.easeOrbit(next === "first" ? FIRST_PERSON_RADIUS : SHOULDER_BOOM, pitch, 1);
    this.zoomKept = view.orbitRadius;
  }

  get active(): boolean {
    return this.flow.active;
  }

  /** The index of the car he left and may get back into (his own, and only his own) while he is out or climbing in or out; -1 while he is in the seat. */
  get away(): number {
    return this.flow.active ? this.flow.car : -1;
  }

  /** Back in the seat, nothing out: a scene reset has emptied the world. */
  reset(): void {
    this.flow.reset();
    this.endView();
    this.refusal = null;
    this.reach = false;
  }

  /** A keydown: true when the director took it (the control, or a seat key that means nothing on foot). */
  key(e: KeyboardEvent): boolean {
    if (!this.host.available()) return false;
    if (this.armed() && this.arms.key(e.code)) return true;
    if (e.code === SEAT_KEYS.onFoot) {
      e.preventDefault();
      this.press();
      return true;
    }
    if (this.flow.active && SEAT_KEYS.camera.includes(e.code)) {
      this.cycleView();
      return true;
    }
    if (e.code === SEAT_KEYS.reset && this.resetsToCar) return false;
    if (!this.flow.active || !SWALLOWED_KEYS.includes(e.code)) return false;
    return e.code !== SEAT_KEYS.stepOut || !this.host.racing();
  }

  /** The pad buttons that went down this poll: true when none is left for the seat (the control, and on foot the seat's buttons). */
  padPress(pressed: number): boolean {
    if (!this.host.available()) return false;
    if (this.armed() && (pressed & (1 << PAD_BUTTON.lb)) !== 0) this.arms.cycle(-1);
    if (this.armed() && (pressed & (1 << PAD_BUTTON.rb)) !== 0) this.arms.cycle(1);
    if ((pressed & ON_FOOT_BUTTON) !== 0) this.press();
    if (this.flow.active && (pressed & VIEW_BUTTON) !== 0) this.cycleView();
    const swallowed = (this.host.racing() ? SWALLOWED_BUTTONS & ~BACK_BUTTON : SWALLOWED_BUTTONS) & (this.resetsToCar ? ~RESET_BUTTON : -1);
    return (pressed & ON_FOOT_BUTTON) !== 0 || (this.flow.active && (pressed & swallowed) !== 0);
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

  /** The car he sits in and may leave: the seat is driving it and its driver is still in it (a thrown-out one has nobody to get out). Null otherwise. */
  private carAtWheel(): DeformableCar | null {
    const { seat } = this.host;
    const car = this.host.cars()[seat.carIndex];
    return seat.mode === "drive" && car && car.driverOut === null ? car : null;
  }

  /** What the flow needs to know: in the driving seat, the car and whether its door has room; on foot, whether his car is in reach. Null while the seat is not his to leave. */
  private senseWorld(): OnFootSense | null {
    const { seat, ragdolls } = this.host;
    const cars = this.host.cars();
    const sense = this.sense;
    if (this.flow.phase === "inCar") {
      const car = this.carAtWheel();
      if (car === null) return null;
      sense.car = seat.carIndex;
      sense.speed = car.velocity.length();
      sense.doorBlocked = doorBlocked(cars, car, ragdolls.poles);
      return sense;
    }
    sense.doorBlocked = false;
    const car = cars[this.flow.car];
    if (!car || !ragdolls.walkerTorso(_torso)) return null;
    sense.car = this.carInReach(cars);
    sense.speed = sense.car < 0 ? 0 : this.speed[0]!;
    return sense;
  }

  /** The car whose driver door he is at (torso in `_torso`): his own first, else an empty one the engine offers; -1 when none. Its speed goes to `speed[0]`. */
  private carInReach(cars: readonly DeformableCar[]): number {
    if (doorInReach(cars[this.flow.car]!, _torso, this.speed)) return this.flow.car;
    for (let index = 0; index < cars.length; index++) {
      if (index !== this.flow.car && this.host.enterable(index) && doorInReach(cars[index]!, _torso, this.speed)) return index;
    }
    return -1;
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
    seat.esc();
    this.framed = false;
    this.openDoor(this.flow.car);
  }

  private beginEnter(): void {
    const { ragdolls } = this.host;
    const car = this.host.cars()[this.flow.car]!;
    ragdolls.walker.command = 0;
    if (ragdolls.walkerTorso(_torso)) ragdolls.walker.heading = detAtan2(car.group.position.x - _torso.x, car.group.position.z - _torso.z);
    // A car that is not the one he left: the seat and the engine follow him to it now, so the one he left is empty from here.
    if (this.host.seat.carIndex !== this.flow.car) {
      this.host.adopt(this.flow.car);
      this.host.seat.focus(this.flow.car);
    }
    this.openDoor(this.flow.car);
  }

  /** He starts through car `index`'s driver's door: it swings open from wherever it stands. Only in the open world on a machine that runs the cars, where residents' doors swing by the same call; anywhere else the walker writes nothing to a car. */
  private openDoor(index: number): void {
    if (!this.host.openWorld() || !this.host.runsCars()) return;
    const cars = this.host.cars();
    if (this.doorCar >= 0 && this.doorCar !== index) cars[this.doorCar]?.setDoorOpen(DRIVER_SIDE, 0);
    this.doorCar = index;
    this.door = Math.abs(cars[index]?.doorAngle(DRIVER_SIDE) ?? 0);
    this.doorTarget = DOOR_OPEN;
  }

  /** Once a frame: the door eases to where it is going. It is sent shut once he is seated, once the trip ends any other way, or once he has walked `DOOR_CLOSE_DISTANCE` from it. */
  private swingDoor(wallDt: number): void {
    if (this.doorCar < 0) return;
    if (!this.host.openWorld() || !this.host.runsCars()) {
      this.doorCar = -1;
      return;
    }
    const car = this.host.cars()[this.doorCar];
    if (!car) {
      this.doorCar = -1;
      return;
    }
    const phase = this.flow.phase;
    if (this.doorTarget > 0 && phase !== "exiting" && phase !== "entering") {
      if (phase !== "onFoot") this.doorTarget = 0;
      else if (this.host.ragdolls.walkerTorso(_torso)) {
        doorSpot(car, _spot);
        if (hypot2(_spot.x - _torso.x, _spot.z - _torso.z) > DOOR_CLOSE_DISTANCE) this.doorTarget = 0;
      }
    }
    // A door the crash or a reset moved is eased from where it stands, not from where this swing last left it; read after the trip's end has sent it shut.
    if (this.doorTarget === 0) this.door = Math.min(this.door, Math.abs(car.doorAngle(DRIVER_SIDE)));
    const gap = this.doorTarget - this.door;
    if (gap !== 0) {
      this.door += Math.max(-DOOR_RATE * wallDt, Math.min(DOOR_RATE * wallDt, gap));
      car.setDoorOpen(DRIVER_SIDE, this.door);
    }
    if (this.doorTarget === 0 && this.door === 0) this.doorCar = -1;
  }

  /** The seat no longer follows his car (a race put him to watching, a scene took it), or his car is gone from play: the trip is over and he is in the seat's follow. */
  private lost(): boolean {
    const car = this.host.cars()[this.flow.car];
    return !car || !inPlay(car) || this.host.seat.carIndex !== this.flow.car;
  }

  /** Once per frame, before the ragdoll world steps: the driving controls into the walker's pace, the flow's clock. */
  frame(wallDt: number): void {
    this.swingDoor(wallDt);
    const flow = this.flow;
    this.refusalLeft = Math.max(0, this.refusalLeft - wallDt);
    this.arms.pad(this.host.pad, this.host.touch);
    this.arms.frame(wallDt);
    if (!flow.active) return;
    const { ragdolls } = this.host;
    if (flow.phase === "arrested") {
      this.walkLed();
      return;
    }
    if (!ragdolls.walker.active || this.lost()) {
      ragdolls.stopWalker();
      this.reset();
      return;
    }
    if (flow.phase === "onFoot") {
      if (this.host.available()) this.walk(wallDt);
      else ragdolls.walker.command = 0;
      this.runDown();
    } else ragdolls.walker.command = 0;
    const car = flow.car;
    this.finish(flow.tick(wallDt), car);
    this.reach = flow.phase === "onFoot" && ragdolls.walkerTorso(_torso) && this.carInReach(this.host.cars()) >= 0;
  }

  /** In custody on foot (no patrol car has him yet): his walker walks to where his cop leads him, whatever he presses. */
  private walkLed(): void {
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

  /** A car moving fast enough over him (`runsDown`, the lawn guards' and the VIP's rule) throws him with the same launch (`fell`): he goes ragdoll. */
  private runDown(): void {
    const { ragdolls } = this.host;
    const walker = ragdolls.walker;
    if (walker.sinceStruck < STRIKE_COOLDOWN || !ragdolls.walkerTorso(_torso)) return;
    const ground = activeGround().heightAt(_torso.x, _torso.z, _torso.y);
    if (ground === NO_FLOOR) return;
    const cars = this.host.cars();
    for (let i = 0; i < cars.length; i++) {
      if (!runsDown(cars[i]!, _torso.x, _torso.z, ground)) continue;
      ragdolls.knockWalker(fell(cars[i]!, i, -1, _torso.x, ground, _torso.z, detSin(walker.facing), detCos(walker.facing), this.strike));
      return;
    }
  }

  /** The speed (m/s) a push of `reach` (0 to 1) asks for: Boost sprints, the walk control holds a walk, else the push walks from a creep up to a run along the reader's curve. */
  private pace(intent: WalkIntent, reach: number): number {
    if (intent.sprint) return SPRINT_SPEED;
    if (intent.walk) return WALK_SPEED;
    return CREEP_SPEED + (RUN_SPEED - CREEP_SPEED) * Math.min(1, reach);
  }

  /** The stick and keys, relative to the camera, into the walker's heading and speed. */
  private walk(wallDt: number): void {
    const { camera, view, ragdolls, keys, pad, touch } = this.host;
    const walker = ragdolls.walker;
    const intent = readWalkIntent(keys, pad, touch, this.intent, this.armed());
    const reach = hypot2(intent.forward, intent.strafe);
    if (this.arms.aiming) {
      // Aiming: he faces where the camera looks and walks forward only, at no more than a walk.
      walker.heading = detAtan2(view.look.x - camera.position.x, view.look.z - camera.position.z);
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
    let ahead = view.look.x - camera.position.x;
    let side = view.look.z - camera.position.z;
    const along = hypot2(ahead, side) || 1;
    ahead /= along;
    side /= along;
    const x = ahead * this.smoothAhead - side * this.smoothSide;
    const z = side * this.smoothAhead + ahead * this.smoothSide;
    walker.heading = detAtan2(x, z);
    walker.command = this.pace(intent, reach);
    walker.ask();
  }

  private finish(step: OnFootStep, car: number): void {
    if (step === "seated") this.seated(car);
  }

  /** In the seat: he leaves the pool and the wheel of car `index`, the one he left, is in his hands. */
  private seated(index: number): void {
    const { ragdolls, seat } = this.host;
    this.endView();
    ragdolls.stopWalker();
    // Back in a car his driver was thrown out of: he is its driver again. A client's car is the host's to say, so for him it is the reset a driver has.
    const car = this.host.cars()[index];
    if (car && car.driverOut !== null) {
      if (this.host.runsCars()) car.driverOut = null;
      else this.host.respawn();
    }
    seat.focus(index);
    seat.mode = "drive";
    this.reach = false;
  }

  /**
   * The camera, with the same drag, stick, mouse look and wheel as everywhere: over his right shoulder, its boom pulled in short of every solid of the
   * dummies' world it would pass through on the way out from his head (walls, a building's streamed boxes, the facades, cars), coming back behind
   * him after a pause in the look; or, once View or the wheel brings it inside the nearest boom, through his eyes, his head and torso not drawn to it
   * (and not when a pulled-in boom puts it in his head either). Taking it over from the car blends over `BLEND_SECONDS`; while he climbs back in it draws
   * back round the car on the orbit. True while it is his.
   */
  aim(wallDt: number): boolean {
    if (!this.flow.active || !this.host.ragdolls.walkerTorso(_torso)) return false;
    const { view, camera, ragdolls } = this.host;
    const walker = ragdolls.walker;
    if (!this.framed) this.beginFollow();
    if (this.flow.phase === "entering") {
      this.drawBack(wallDt);
      return true;
    }
    this.follow.follow(wallDt, _torso.x, _torso.y, _torso.z, walker.loco.speed);
    this.keepZoom();
    const first = this.footView === "first" && walker.state === "stand";
    const range = VIEW_PITCH[first ? "first" : "shoulder"];
    view.pitchLow = range.low;
    view.pitchHigh = range.high;
    view.look.set(this.follow.point[0]!, this.follow.point[1]!, this.follow.point[2]!);
    if (!first) view.turnOrbit(this.follow.recenter(wallDt, view.orbitAngle, walker.facing, walker.loco.speed, view.lookingAround));
    view.setLens(followFov(camera.aspect), false);
    // The orbit takes the stick, the drag and the mouse look; the eye it places is this one's to replace.
    view.orbit(wallDt, 0, false, null);
    const pitch = Math.max(range.low, Math.min(range.high, view.orbitPitch));
    const sight = this.walkerView;
    if (first) sight.first(_torso.x, _torso.y, _torso.z, view.orbitAngle, pitch, this.sweep, wallDt);
    else if (this.arms.aiming) sight.shoulder(_torso.x, _torso.y, _torso.z, this.follow.point[0]! + detCos(view.orbitAngle) * AIM_SIDE, this.follow.point[1]! + AIM_UP, this.follow.point[2]! - detSin(view.orbitAngle) * AIM_SIDE, view.orbitAngle, pitch, AIM_BOOM, this.sweep, wallDt);
    else sight.shoulder(_torso.x, _torso.y, _torso.z, this.follow.point[0]!, this.follow.point[1]!, this.follow.point[2]!, view.orbitAngle, pitch, view.orbitRadius, this.sweep, wallDt);
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
    ragdolls.showWalkerHead(!sight.inHead || this.blendLeft > 0);
    return true;
  }

  /**
   * The zoom is his: the wheel and a pinch set the view (inside the nearest shoulder camera is his own eyes), View sets it, and nothing else may. A distance the orbit's
   * pose moved to without a zoom (a hold on the view another camera left, an eased pose) is put back, so no click or drag can put him in first person.
   */
  private keepZoom(): void {
    const { view } = this.host;
    if (view.zoomedTimes !== this.zoomsSeen) {
      this.zoomsSeen = view.zoomedTimes;
      this.mode = view.orbitRadius < SHOULDER_NEAREST ? "first" : "shoulder";
    } else if (view.orbitRadius !== this.zoomKept) {
      view.easeOrbit(this.zoomKept, view.orbitPitch, 1);
    }
    this.zoomKept = view.orbitRadius;
  }

  /** While he climbs in: the orbit's focus moves to the car and the camera draws back round it, his head in view again. */
  private drawBack(wallDt: number): void {
    const { view, ragdolls } = this.host;
    const walker = ragdolls.walker;
    const car = this.host.cars()[this.flow.car];
    if (car) _torso.set(car.group.position.x, _torso.y, car.group.position.z);
    this.follow.follow(wallDt, _torso.x, _torso.y, _torso.z, walker.loco.speed);
    view.look.set(this.follow.point[0]!, this.follow.point[1]!, this.follow.point[2]!);
    view.turnOrbit(this.follow.recenter(wallDt, view.orbitAngle, walker.facing, walker.loco.speed, view.lookingAround));
    view.easeOrbit(FOLLOW_RADIUS * ENTER_PULL_BACK, FOLLOW_PITCH, 1 - Math.exp((-3 * wallDt) / BLEND_SECONDS));
    view.setLens(null, false);
    view.orbit(wallDt, 0, true, this.host.sight());
    ragdolls.showWalkerHead(true);
  }

  /**
   * He has just got out: the follow starts on him, the camera's view as the car left it is where the blend starts, and the orbit (its pose adopted
   * from the car's camera) takes the shoulder camera's boom and pitch and the walker's zoom range; the car's are kept for when he sits down again.
   */
  private beginFollow(): void {
    const { view, camera } = this.host;
    this.framed = true;
    this.blendLeft = BLEND_SECONDS;
    this.follow.seed(_torso.x, _torso.y, _torso.z);
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
    view.pitchLow = VIEW_PITCH.shoulder.low;
    view.pitchHigh = VIEW_PITCH.shoulder.high;
    view.easeOrbit(SHOULDER_BOOM, SHOULDER_PITCH, 1);
    this.mode = "shoulder";
    this.zoomsSeen = view.zoomedTimes;
    this.zoomKept = view.orbitRadius;
  }

  /** The trip's camera is over: the car's zoom and pitch range and its orbit back as they were, his head drawn again. */
  private endView(): void {
    this.intentSeeded = false;
    if (!this.framed) return;
    const { view, ragdolls } = this.host;
    this.framed = false;
    view.minRadius = this.carMinRadius;
    view.pitchLow = this.carPitchLow;
    view.pitchHigh = this.carPitchHigh;
    view.easeOrbit(this.carRadius, this.carPitch, 1);
    ragdolls.showWalkerHead(true);
  }

  /** The HUD's read of the trip, or null where the control does nothing: the scene does not offer it, or he neither sits at a wheel he may leave nor is out. */
  hud(): FootHud | null {
    if (!this.host.available() || (!this.flow.active && this.carAtWheel() === null)) return null;
    return {
      out: this.flow.active,
      prompt: this.prompt(),
      refusal: this.refusalText(),
      arms: this.arms.hud(),
    };
  }

  /** Why the control just refused, for `REFUSAL_SECONDS`; null otherwise. */
  private refusalText(): string | null {
    return this.refusalLeft > 0 && this.refusal !== null && this.refusal !== "busy" ? REFUSAL_TEXT[this.refusal] : null;
  }

  /** The line under the view: what the control does here, or why it just refused. Null when there is nothing to say. */
  prompt(): string | null {
    const refused = this.refusalText();
    if (refused !== null) return refused;
    if (!this.host.available()) return null;
    if (this.flow.phase === "arrested") return "Under arrest";
    if (this.flow.phase === "onFoot") return this.reach ? "Enter or Y: get in" : REFUSAL_TEXT.noCarInReach;
    return this.carAtWheel() !== null ? "Enter or Y: get out" : null;
  }
}
