import * as THREE from "three";
import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import type { DeformableCar } from "../vehicle/car.ts";
import type { DriverSeat } from "../vehicle/car-drive.ts";
import { blankStrike, fell, runsDown } from "../scenes/figure-strike.ts";
import { activeGround, NO_FLOOR } from "../world/ground.ts";
import { PAD_BUTTON, type PadState, type TouchPad } from "../vehicle/gamepad.ts";
import type { ChaseCamera } from "../present/engine-camera.ts";
import type { DriverLook } from "../present/driver-look.ts";
import { OnFootFlow, type OnFootRefusal, type OnFootSense, type OnFootStep } from "../present/onfoot-flow.ts";
import type { FootHud } from "../hud/hud-store.ts";
import type { RagdollSystem } from "../present/engine-ragdoll.ts";
import { RUN_SPEED, SPRINT_SPEED, WALK_SPEED } from "../present/walker-locomotion.ts";
import { BLEND_SECONDS, FOLLOW_PITCH, FOLLOW_RADIUS, FollowFocus, followFov } from "../present/walker-camera.ts";
import type { Sight } from "../present/spectate-cam.ts";
import { doorBlocked, doorInReach, doorSpot, inPlay } from "./onfoot-doors.ts";
import { SEAT_KEYS } from "./engine-keys.ts";
import { blankWalkIntent, readWalkIntent, type WalkIntent } from "./engine-walk-input.ts";

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
}

/** The control that gets him out and in: Enter on the keyboard (`SEAT_KEYS.onFoot`), B (Circle) on the pad. Neither drives, steers or switches a scene. */
const ON_FOOT_BUTTON = 1 << PAD_BUTTON.east;
/** Keys the car's seat uses that mean nothing on foot (and would pause, reset or switch cars under his feet). */
const SWALLOWED_KEYS: readonly string[] = ["Space", SEAT_KEYS.reset, SEAT_KEYS.stepOut, SEAT_KEYS.previousCar, SEAT_KEYS.nextCar, ...SEAT_KEYS.camera];
const BACK_BUTTON = 1 << PAD_BUTTON.back;
const SWALLOWED_BUTTONS = BACK_BUTTON | (1 << PAD_BUTTON.lb) | (1 << PAD_BUTTON.rb) | (1 << PAD_BUTTON.north) | (1 << PAD_BUTTON.down);

/** A stick pushed less than this far does not move him (research: pad dead zone 0.12-0.18); a push beyond it walks from this speed (m/s) up to a run along this curve (research: 1.5-2). */
const WALK_DEADZONE = 0.15;
const CREEP_SPEED = 0.8;
const STICK_CURVE = 1.5;
/** While he climbs into his car the camera draws back by this share of its distance. */
const ENTER_PULL_BACK = 1.35;
/** A car that has just run him down does not do it again for this long (s): the launch carries him through its footprint. */
const STRIKE_COOLDOWN = 0.6;
/** Seconds a refusal stays on the prompt. */
const REFUSAL_SECONDS = 2;

const REFUSAL_TEXT: Record<OnFootRefusal, string> = {
  tooFast: "Stop the car first",
  doorBlocked: "No room to open the door",
  noCarInReach: "Walk up to your car's driver door",
  busy: "",
};

const _torso = new THREE.Vector3();
const _spot = new THREE.Vector3();
const _forward = new THREE.Vector3();

/**
 * The player's trip out of his car and back, in any scene that has one: `OnFootFlow` decides what the control does, this carries it out (the walker
 * the ragdoll pool stands up, the seat stepped back, the camera that orbits him) and turns the driving controls into the walker's heading and pace.
 * Presentation only, and the car is never written: the engine reads `away` to treat the car as a driverless one holding its brakes.
 */
export class OnFootDirector {
  readonly flow = new OnFootFlow();
  private readonly host: OnFootHost;
  private readonly intent = blankWalkIntent();
  private readonly sense: OnFootSense = { car: -1, speed: 0, doorBlocked: false };
  private readonly speed = new Float64Array(1);
  private readonly strike = blankStrike();
  private framed = false;
  private blendLeft = 0;
  private readonly follow = new FollowFocus();
  private refusal: OnFootRefusal | null = null;
  private refusalLeft = 0;
  /** Whether his car's door is in reach this frame, for the prompt. */
  private reach = false;

  constructor(host: OnFootHost) {
    this.host = host;
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
    this.framed = false;
    this.refusal = null;
    this.reach = false;
  }

  /** A keydown: true when the director took it (the control, or a seat key that means nothing on foot). */
  key(e: KeyboardEvent): boolean {
    if (!this.host.available()) return false;
    if (e.code === SEAT_KEYS.onFoot) {
      e.preventDefault();
      this.press();
      return true;
    }
    if (!this.flow.active || !SWALLOWED_KEYS.includes(e.code)) return false;
    return e.code !== SEAT_KEYS.stepOut || !this.host.racing();
  }

  /** The pad buttons that went down this poll: true when none is left for the seat (the control, and on foot the seat's buttons). */
  padPress(pressed: number): boolean {
    if (!this.host.available()) return false;
    if ((pressed & ON_FOOT_BUTTON) !== 0) this.press();
    const swallowed = this.host.racing() ? SWALLOWED_BUTTONS & ~BACK_BUTTON : SWALLOWED_BUTTONS;
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
    sense.car = doorInReach(car, _torso, this.speed) ? this.flow.car : -1;
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
    seat.esc();
    this.framed = false;
  }

  private beginEnter(): void {
    const { ragdolls } = this.host;
    const car = this.host.cars()[this.flow.car]!;
    ragdolls.walker.command = 0;
    if (ragdolls.walkerTorso(_torso)) ragdolls.walker.heading = detAtan2(car.group.position.x - _torso.x, car.group.position.z - _torso.z);
  }

  /** The seat no longer follows his car (a race put him to watching, a scene took it), or his car is gone from play: the trip is over and he is in the seat's follow. */
  private lost(): boolean {
    const car = this.host.cars()[this.flow.car];
    return !car || !inPlay(car) || this.host.seat.carIndex !== this.flow.car;
  }

  /** Once per frame, before the ragdoll world steps: the driving controls into the walker's pace, the flow's clock. */
  frame(wallDt: number): void {
    const flow = this.flow;
    this.refusalLeft = Math.max(0, this.refusalLeft - wallDt);
    if (!flow.active) return;
    const { ragdolls } = this.host;
    if (!ragdolls.walker.active || this.lost()) {
      ragdolls.stopWalker();
      this.reset();
      return;
    }
    if (flow.phase === "onFoot") {
      if (this.host.available()) this.walk();
      else ragdolls.walker.command = 0;
      this.runDown();
    } else ragdolls.walker.command = 0;
    const car = flow.car;
    this.finish(flow.tick(wallDt), car);
    this.reach = flow.phase === "onFoot" && ragdolls.walkerTorso(_torso) && doorInReach(this.host.cars()[flow.car]!, _torso, this.speed);
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

  /** The speed (m/s) a push of `reach` (0 to 1) asks for: Boost sprints, the walk control holds a walk, else the push walks from a creep up to a run along `STICK_CURVE`. */
  private pace(intent: WalkIntent, reach: number): number {
    if (intent.sprint) return SPRINT_SPEED;
    if (intent.walk) return WALK_SPEED;
    const push = (Math.min(1, reach) - WALK_DEADZONE) / (1 - WALK_DEADZONE);
    return CREEP_SPEED + (RUN_SPEED - CREEP_SPEED) * push ** STICK_CURVE;
  }

  /** The stick and keys, relative to the camera, into the walker's heading and speed. */
  private walk(): void {
    const { camera, view, ragdolls, keys, pad, touch } = this.host;
    const walker = ragdolls.walker;
    const intent = readWalkIntent(keys, pad, touch, this.intent);
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
    walker.command = this.pace(intent, reach);
    walker.ask();
  }

  private finish(step: OnFootStep, car: number): void {
    if (step === "seated") this.seated(car);
  }

  /** In the seat: he leaves the pool and the wheel of car `index`, the one he left, is in his hands. */
  private seated(index: number): void {
    const { ragdolls, seat } = this.host;
    ragdolls.stopWalker();
    seat.focus(index);
    seat.mode = "drive";
    this.reach = false;
  }

  /**
   * The camera: it orbits his chest from `FOLLOW_RADIUS`, with the same drag, stick and mouse look as everywhere, its focus following him critically damped (so
   * the bob never reaches the screen), coming back behind him after a pause in the look, and pulled in by the scene's walls. Taking it over from the car, and
   * handing it back, blend over `BLEND_SECONDS`. True while it is his.
   */
  aim(wallDt: number): boolean {
    if (!this.flow.active || !this.host.ragdolls.walkerTorso(_torso)) return false;
    const { view, camera, ragdolls } = this.host;
    const walker = ragdolls.walker;
    if (!this.framed) this.beginFollow();
    const entering = this.flow.phase === "entering";
    const car = this.host.cars()[this.flow.car];
    if (entering && car) _torso.set(car.group.position.x, _torso.y, car.group.position.z);
    this.follow.follow(wallDt, _torso.x, _torso.y, _torso.z, walker.loco.speed);
    view.look.set(this.follow.point[0]!, this.follow.point[1]!, this.follow.point[2]!);
    view.turnOrbit(this.follow.recenter(wallDt, view.orbitAngle, walker.facing, walker.loco.speed, view.lookingAround));
    this.blendLeft = Math.max(0, this.blendLeft - wallDt);
    if (this.blendLeft > 0 || entering) view.easeOrbit(entering ? FOLLOW_RADIUS * ENTER_PULL_BACK : FOLLOW_RADIUS, FOLLOW_PITCH, 1 - Math.exp((-3 * wallDt) / BLEND_SECONDS));
    view.setLens(entering ? null : followFov(camera.aspect), false);
    view.orbit(wallDt, 0, true, this.host.sight());
    return true;
  }

  /** He has just got out: the follow starts on him, the lens, distance and pitch ease to the on-foot shot from the car's. */
  private beginFollow(): void {
    this.framed = true;
    this.blendLeft = BLEND_SECONDS;
    this.follow.seed(_torso.x, _torso.y, _torso.z);
  }

  /** The HUD's read of the trip, or null where the control does nothing: the scene does not offer it, or he neither sits at a wheel he may leave nor is out. */
  hud(): FootHud | null {
    if (!this.host.available() || (!this.flow.active && this.carAtWheel() === null)) return null;
    return { out: this.flow.active, prompt: this.prompt(), refusal: this.refusalText() };
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
    if (this.flow.phase === "onFoot") return this.reach ? "Enter or B: get in" : REFUSAL_TEXT.noCarInReach;
    return this.carAtWheel() !== null ? "Enter or B: get out" : null;
  }
}
