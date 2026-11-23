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
import type { OnFootView } from "../present/walker-camera.ts";
import { OnFootCamera } from "./onfoot-camera.ts";
import type { Sight } from "../present/spectate-cam.ts";
import { doorBlocked, doorInReach, doorSpot, inPlay } from "./onfoot-doors.ts";
import { DRIVER_SIDE } from "../vehicle/constants.ts";
import { SEAT_KEYS } from "./engine-keys.ts";
import { blankWalkIntent, readWalkIntent, type WalkIntent } from "./engine-walk-input.ts";
import { OnFootArms, type Gun } from "./engine-onfoot-arms.ts";
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
  /** Whether this machine is a guest in a room (it holds no authority): it sends what it does to the host, and has no hook yet. */
  guest(): boolean;
  /** Mouse look (pointer lock) is on. */
  mouseCaptured(): boolean;
  /** Turns mouse look on (inside a user gesture) or off. */
  captureMouse(on: boolean): void;
  /** His punch lands along the unit (dirX, dirZ): the host carries it out, a guest tells the host. */
  punchLanded(dirX: number, dirZ: number): void;
  /** The ray a shot goes along, into `out`: from the camera through the view's centre (`centre`), else through the cursor. */
  aimRay(centre: boolean, out: LookRay): void;
  /** One shot of `gun` along `aim`, the unscattered sight line: the host resolves it, a guest tells the host. How far (m) the tracer runs. */
  shootRay(aim: LookRay, gun: Gun): number;
  /** A shot of `gun` was fired along `ray` and its farthest ray went `far` m: the flash, the tracer, the sound, the law. */
  shotFired(ray: LookRay, far: number, gun: Gun): void;
  /** Fire with the hook in hand. */
  hook(): void;
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
/** Firing at a target off his facing turns him to it, and holds him turning (not walking) this long (s): his facing turns at most 8 rad/s, so a half turn is done well inside it. */
const FIRE_TURN_S = 0.6;
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

const REFUSAL_TEXT: Record<OnFootRefusal, string> = {
  tooFast: "Stop the car first",
  doorBlocked: "No room to open the door",
  noCarInReach: "Walk up to your car's driver door",
  busy: "",
};

const _torso = new THREE.Vector3();
const _spot = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _aimRay = new LookRay();

/**
 * The player's trip out of his car and back, in any scene that has one: `OnFootFlow` decides what the control does, this carries it out (the walker
 * the ragdoll pool stands up, the seat stepped back, the camera that orbits him) and turns the driving controls into the walker's heading and pace.
 * Presentation only; the one thing it writes to a car is its driver's door, in the open world (`openDoor`): the engine reads `away` to treat the car as a driverless one holding its brakes.
 */
export class OnFootDirector {
  readonly flow = new OnFootFlow();
  readonly arms = new OnFootArms({ armed: () => this.armed(), punch: () => this.punch(), land: () => this.landPunch(), captured: () => this.host.mouseCaptured(), capture: (on) => this.host.captureMouse(on), shoot: (gun) => this.shoot(gun), hook: () => this.host.hook(), hooks: () => !this.host.guest() });
  private readonly host: OnFootHost;
  private readonly intent = blankWalkIntent();
  private readonly sense: OnFootSense = { car: -1, speed: 0, doorBlocked: false };
  private readonly speed = new Float64Array(1);
  private readonly strike = blankStrike();
  private readonly cam: OnFootCamera;
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
  /** The heading he turns to for a shot (`faceToward`), and the seconds that turn still holds him. */
  private turnHeading = 0;
  private turnLeft = 0;

  constructor(host: OnFootHost) {
    this.host = host;
    this.cam = new OnFootCamera(host);
  }

  /** The view on foot (`OnFootCamera.view`): a drag, a click and every other camera's leavings never change it. */
  get footView(): OnFootView {
    return this.cam.view;
  }

  /** On foot in the open world the reset control (R, D-pad down, Respawn; a tap or a hold, as at the wheel) is his: back in a fresh car (`resetIntoCar`). */
  get resetsToCar(): boolean {
    return this.flow.phase === "onFoot" && this.host.openWorld();
  }

  /** Whether fire, aim and weapons are his: on foot in the open world, as a guest too. */
  armed(): boolean {
    return this.host.openWorld() && this.flow.phase === "onFoot";
  }

  private punch(): boolean {
    return this.host.ragdolls.walker.punch();
  }

  private landPunch(): void {
    const { ragdolls } = this.host;
    const walker = ragdolls.walker;
    if (walker.state !== "stand" || !ragdolls.walkerTorso(_torso)) return;
    this.host.punchLanded(detSin(walker.facing), detCos(walker.facing));
  }

  /** Whether his shots are aimed through the view's centre (the mouse is captured, aim is held or he looks through his own eyes) rather than the cursor. */
  aimsAtCentre(): boolean {
    return this.arms.aiming || this.host.mouseCaptured() || this.footView === "first";
  }

  /** He turns to face the level direction (dx, dz) of a target behind him for a shot, and stands while he does; a turn in progress is not started again by the shots that follow. */
  faceToward(dx: number, dz: number): void {
    if (this.turnLeft > 0) return;
    this.turnHeading = detAtan2(dx, dz);
    this.turnLeft = FIRE_TURN_S;
  }

  /** One shot of `gun` along the aim: the view's centre when `aimsAtCentre`, else the cursor's ray. */
  private shoot(gun: Gun): void {
    this.host.aimRay(this.aimsAtCentre(), _aimRay);
    this.host.shotFired(_aimRay, this.host.shootRay(_aimRay, gun), gun);
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
    this.cam.unframe();
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

  /** View (V, T, C, the pad's B, the HUD's camera) on foot: follow, over his shoulder, his eyes, and round. Nothing while he climbs in or out. */
  cycleView(): void {
    if (this.flow.phase === "onFoot") this.cam.cycle();
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
    this.cam.unframe();
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
    this.host.ragdolls.walker.holdGun(this.armed() && this.arms.gunInHand());
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

  /**
   * The stick and keys, relative to the view, into the walker's heading and speed. The view's way is the orbit's yaw (the eye stands at (sin, cos) of it behind
   * him), not the drawn camera's position: that eases in after the climb out, so a held direction read from it would curve with the blend.
   */
  private walk(wallDt: number): void {
    const { view, ragdolls, keys, pad, touch } = this.host;
    const walker = ragdolls.walker;
    const intent = readWalkIntent(keys, pad, touch, this.intent, this.armed());
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

  /** The camera on him (`OnFootCamera`), or drawing back round his car while he climbs in. True while it is his. */
  aim(wallDt: number): boolean {
    if (!this.flow.active || !this.host.ragdolls.walkerTorso(_torso)) return false;
    if (this.flow.phase === "entering") this.cam.drawBack(wallDt, _torso, this.host.cars()[this.flow.car]);
    else this.cam.aim(wallDt, _torso, this.arms.aiming);
    return true;
  }

  /** The trip's camera is over: the car's view back, his head drawn again. */
  private endView(): void {
    this.intentSeeded = false;
    this.cam.end();
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
