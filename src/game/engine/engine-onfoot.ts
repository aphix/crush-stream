import * as THREE from "three";
import { detAtan2, detCos, detSin } from "../kernel/physics-core.js";
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
import type { OnFootView } from "../present/walker-camera.ts";
import { OnFootCamera } from "./onfoot-camera.ts";
import type { Sight } from "../present/spectate-cam.ts";
import { doorBlocked, doorInReach, doorSpot, inPlay } from "./onfoot-doors.ts";
import { entrySeat, SEAT_DRIVER } from "../vehicle/car-seats.ts";
import { OnFootRide, type OnFootDesk } from "./engine-onfoot-ride.ts";
import { SEAT_KEYS } from "./engine-keys.ts";
import { OnFootSteer } from "./engine-onfoot-steer.ts";
import { OnFootArms, type Gun } from "./engine-onfoot-arms.ts";
import { LookRay } from "../ai/civilians/civilian-look.ts";
import type { BodyMotion } from "../net/body-codec.ts";
import type { BodyHost } from "./openworld-bodies.ts";
import { dragOwnWalker, knockOwnWalker, STRIKE_COOLDOWN } from "./onfoot-shared.ts";

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
  /** He sits in car `index` now, the one he drives from here: this browser's own car (`RaceDirector.adoptCar`) and the seat's. */
  adopt(index: number): void;
  /** The seats of the open world, null in every other scene: who sits where, and asking for a seat or to leave one. */
  desk(): OnFootDesk | null;
  /** Player (this browser's actor) `actor` sat down in seat `seat`, beside his door: the figure drawn in the car slides from it to his own. */
  sitDown(seat: number): void;
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
  /** The ragdoll pool as the open world's bodies see it: the host's cable moves his lying walker through it. */
  bodyHost: BodyHost;
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

/** Seconds a refusal stays on the prompt. */
const REFUSAL_SECONDS = 2;
/** The open world's refusal for a car with no seat he may take, any door of it. */
const OW_NO_CAR_TEXT = "Walk up to a car's door";

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
  readonly arms = new OnFootArms({ armed: () => this.armed(), punch: () => this.punch(), land: () => this.landPunch(), captured: () => this.host.mouseCaptured(), capture: (on) => this.host.captureMouse(on), shoot: (gun) => this.shoot(gun), hook: () => this.host.hook() });
  private readonly host: OnFootHost;
  private readonly sense: OnFootSense = { car: -1, speed: 0, doorBlocked: false };
  private readonly speed = new Float64Array(1);
  private readonly strike = blankStrike();
  private readonly cam: OnFootCamera;
  private refusal: OnFootRefusal | null = null;
  private refusalLeft = 0;
  /** Whether his car's door is in reach this frame, for the prompt. */
  private reach = false;
  /** Steers the walker: the controls, the law's lead and a turn for a shot. */
  readonly steer: OnFootSteer;
  /** The seats side of his trip: the door, a passenger's seat, what he waits for the host to answer (`OnFootRide`). */
  private readonly ride: OnFootRide;

  constructor(host: OnFootHost) {
    this.host = host;
    this.cam = new OnFootCamera(host);
    this.steer = new OnFootSteer(host, this.arms);
    this.ride = new OnFootRide({ seat: host.seat, desk: () => host.desk(), adopt: (index) => host.adopt(index) });
  }

  /** The view on foot (`OnFootCamera.view`): a drag, a click and every other camera's leavings never change it. */
  get footView(): OnFootView {
    return this.cam.view;
  }

  /** On foot in the open world the reset control (R, D-pad down, Respawn; a tap or a hold, as at the wheel) is his: back in a fresh car (`resetIntoCar`); not after a ride in another's car. */
  get resetsToCar(): boolean {
    return this.flow.phase === "onFoot" && this.host.openWorld() && !this.ride.passenger;
  }

  /** On foot in the open world on any machine, guest or not: where the hook's offer starts. */
  get afootInOpenWorld(): boolean {
    return this.host.openWorld() && this.flow.phase === "onFoot";
  }

  /** Whether fire, aim and weapons are his: on foot in the open world, as a guest too. */
  armed(): boolean {
    return this.host.openWorld() && this.flow.phase === "onFoot";
  }

  /** A car or shot of the host struck him (`MSG.bodies`, `struck`): he is knocked limp, launched at (vx, vy, vz) m/s; false while that cannot be (not on foot, struck just now). */
  knocked(vx: number, vy: number, vz: number): boolean {
    return knockOwnWalker(this.host.ragdolls, this.flow, this.strike, vx, vy, vz);
  }

  /** The host's cable holds his body at `t` (`MSG.bodies`, `roped`): he is knocked if he stands and follows `t` while he lies. */
  dragged(t: BodyMotion): void {
    dragOwnWalker(this.host.bodyHost, this.flow, t, this.strike, this.host.ragdolls);
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
    const driven = this.host.desk()?.respawnMine() ?? -1;
    const car = driven >= 0 ? driven : this.flow.car;
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
    this.steer.lead(x, z);
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
    if (this.host.runsCars() && !this.host.freshCarNear(car, x, z, yaw)) this.host.respawn();
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

  /** The index of the car he drove and left, which he may get back into, while he is out or climbing in or out; -1 while he is in a seat, and on a passenger's trip (that car is another's). */
  get away(): number {
    return this.flow.active && !this.ride.passenger ? this.flow.car : -1;
  }

  /**
   * Back in the seat, nothing out: a scene reset has emptied the world. In the open world the seat table has him at his own wheel again; a passenger caught
   * mid-climb out stands on foot at his door instead (`standAtDoor`), or at the wheel of his own car where no walker can be started.
   */
  reset(): void {
    const desk = this.host.desk();
    desk?.tripEnded();
    if (this.ride.passenger && this.flow.phase === "exiting" && desk?.myCar() === -1) {
      if (this.standAtDoor()) return;
      this.backAtWheel();
      return;
    }
    if (!this.ride.passenger) desk?.respawnMine();
    this.flow.reset();
    this.endView();
    this.refusal = null;
    this.reach = false;
    this.ride.reset();
  }

  /** His climb out was cut short: he stands on foot at the door he was leaving by, his walker started. False where no walker can be started. */
  private standAtDoor(): boolean {
    const car = this.host.cars()[this.flow.car];
    if (!car) return false;
    car.group.getWorldDirection(_forward);
    doorSpot(car, _spot, this.ride.side);
    if (this.host.ragdolls.startWalker(_spot, detAtan2(_forward.x, _forward.z), { cop: false, look: this.host.look() }) < 0) return false;
    this.flow.released();
    this.refusal = null;
    this.reach = false;
    this.cam.unframe();
    return true;
  }

  /** No walker could be started: the trip is over and he is at the wheel (a guest asks the host for one) of the car the seat table gives him (his own, or the one he last drove), the view and the wheel on it. */
  private backAtWheel(): void {
    const car = this.host.desk()?.respawnMine() ?? -1;
    this.flow.reset();
    this.endView();
    this.refusal = null;
    this.reach = false;
    this.ride.reset();
    if (car >= 0) this.ride.take(car, SEAT_DRIVER);
    // A guest's host unseated him when it let him out and seats nobody on its own: the reset the R key sends has it seat him.
    else if (this.host.guest()) this.host.respawn();
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

  /** The control was pressed: judge it, ask the seats (the host's, for a guest) and carry out what they allow, remember what was refused. */
  private press(): void {
    const sense = this.senseWorld();
    if (sense === null || this.ride.waiting) return;
    const step = this.flow.judge(sense);
    if (step === "refused") {
      this.refuseFor(this.flow.refusal);
      return;
    }
    const asked = this.ride.ask(step, sense.car);
    if (asked === "refused") {
      this.refuseFor(this.ride.refusal);
      return;
    }
    this.refusal = null;
    if (asked === "begin") this.begin(step, sense.car);
  }

  private refuseFor(why: OnFootRefusal | null): void {
    this.refusal = why;
    this.refusalLeft = REFUSAL_SECONDS;
  }

  /** The seats agreed: the climb out (`exitStarted`) or in of car `car` starts. */
  private begin(step: OnFootStep, car: number): void {
    this.flow.start(step, car);
    if (step === "exitStarted") this.beginExit();
    else this.beginEnter();
  }

  /** The index of the car he sits in and may leave: at the driver's seat the one the seat drives while its driver is still in it (a thrown-out one has nobody to get out), at any other the one the seat table gives him. -1 otherwise. */
  private seatedIndex(): number {
    const { seat } = this.host;
    const desk = this.host.desk();
    if (desk !== null && desk.myCar() >= 0) return desk.myCar();
    const car = this.host.cars()[seat.carIndex];
    return seat.mode === "drive" && car && car.driverOut === null ? seat.carIndex : -1;
  }

  /** What the flow needs to know: in a seat, the car and whether its door has room; on foot, whether a car's door is in reach. Null while the seat is not his to leave. */
  private senseWorld(): OnFootSense | null {
    const { ragdolls } = this.host;
    const cars = this.host.cars();
    const sense = this.sense;
    if (this.flow.phase === "inCar") {
      const index = this.seatedIndex();
      const car = cars[index];
      if (!car) return null;
      sense.car = index;
      sense.speed = car.velocity.length();
      const desk = this.host.desk();
      // The seat table names his door (his own side's, or the far one when that has no room); a car it does not list him in is judged by its driver's door, as outside the open world.
      sense.doorBlocked = desk === null || desk.myCar() < 0 ? doorBlocked(cars, car, ragdolls.poles) : desk.myExitSide() === 0;
      return sense;
    }
    sense.doorBlocked = false;
    if (!ragdolls.walkerTorso(_torso) || (this.host.desk() === null && !cars[this.flow.car])) return null;
    sense.car = this.carInReach(cars);
    sense.speed = sense.car < 0 ? 0 : this.speed[0]!;
    return sense;
  }

  /** The car whose door he is at (torso in `_torso`; the door goes to `ride.side`): in the open world any car with a seat he may take, elsewhere only his own; -1 when none. Its speed goes to `speed[0]`. */
  private carInReach(cars: readonly DeformableCar[]): number {
    if (this.host.desk() !== null) return this.ride.reach(_torso, this.speed);
    return doorInReach(cars[this.flow.car]!, _torso, this.speed) ? this.flow.car : -1;
  }

  private beginExit(): void {
    const { ragdolls, seat } = this.host;
    const car = this.host.cars()[this.flow.car]!;
    car.group.getWorldDirection(_forward);
    doorSpot(car, _spot, this.ride.side);
    if (ragdolls.startWalker(_spot, detAtan2(_forward.x, _forward.z), { cop: false, look: this.host.look() }) < 0) {
      this.backAtWheel();
      return;
    }
    if (!this.ride.passenger) seat.esc();
    this.cam.unframe();
  }

  private beginEnter(): void {
    const { ragdolls, seat } = this.host;
    const car = this.host.cars()[this.flow.car]!;
    ragdolls.walker.command = 0;
    if (ragdolls.walkerTorso(_torso)) ragdolls.walker.heading = detAtan2(car.group.position.x - _torso.x, car.group.position.z - _torso.z);
    this.ride.passenger = this.ride.seatedAsPassenger();
    // A car that is not the one he left: the seat and the engine follow him to it now, so the one he left is empty from here.
    if (this.ride.passenger) seat.focus(this.flow.car);
    else {
      this.host.adopt(this.flow.car);
      if (seat.carIndex !== this.flow.car) seat.focus(this.flow.car);
    }
    if (this.host.desk() !== null) this.host.sitDown(entrySeat(this.ride.side));
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
    this.arms.pad(this.host.pad, this.host.touch);
    this.arms.frame(wallDt);
    this.host.ragdolls.walker.holdGun(this.armed() && this.arms.heldOut());
    this.settle(wallDt);
    if (!flow.active) {
      this.ride.follow();
      return;
    }
    const { ragdolls } = this.host;
    if (flow.phase === "arrested") {
      this.steer.walkLed();
      return;
    }
    if (!ragdolls.walker.active || this.lost()) {
      ragdolls.stopWalker();
      this.reset();
      return;
    }
    if (flow.phase === "onFoot") {
      if (this.host.available()) this.steer.walk(wallDt, this.armed());
      else ragdolls.walker.command = 0;
      this.runDown();
    } else ragdolls.walker.command = 0;
    const car = flow.car;
    this.finish(flow.tick(wallDt), car);
    this.reach = flow.phase === "onFoot" && ragdolls.walkerTorso(_torso) && this.carInReach(this.host.cars()) >= 0;
  }

  /** A car moving fast enough over a man on his feet (`runsDown`, the lawn guards' and the VIP's rule) throws him with the same launch (`fell`): he goes ragdoll. One who already lies is not thrown again (a guest's body is judged the same, `OpenWorldPlayers.step`): a car that reaches him moves him as a solid does. */
  private runDown(): void {
    if (this.host.openWorld() && this.host.guest()) return;
    const { ragdolls } = this.host;
    const walker = ragdolls.walker;
    if (walker.state !== "stand" || walker.sinceStruck < STRIKE_COOLDOWN || !ragdolls.walkerTorso(_torso)) return;
    const ground = activeGround().heightAt(_torso.x, _torso.z, _torso.y);
    if (ground === NO_FLOOR) return;
    const cars = this.host.cars();
    for (let i = 0; i < cars.length; i++) {
      if (!runsDown(cars[i]!, _torso.x, _torso.z, ground)) continue;
      ragdolls.knockWalker(fell(cars[i]!, i, -1, _torso.x, ground, _torso.z, detSin(walker.facing), detCos(walker.facing), this.strike));
      return;
    }
  }

  private finish(step: OnFootStep, car: number): void {
    if (step === "seated") this.seated(car);
  }

  /** In the seat: he leaves the pool and the wheel of car `index`, the one he left, is in his hands. */
  private seated(index: number): void {
    const { ragdolls, seat } = this.host;
    this.endView();
    ragdolls.stopWalker();
    // Back in a car his driver was thrown out of: he is its driver again. In the open world the seat table has seated him (`OpenWorldSeats.getIn` made it driven again); a client's car elsewhere is the host's to say, so for him it is the reset a driver has.
    const car = this.host.cars()[index];
    if (!this.ride.passenger && car && car.driverOut !== null && this.host.desk() === null) {
      if (this.host.runsCars()) car.driverOut = null;
      else this.host.respawn();
    }
    seat.focus(index);
    if (!this.ride.passenger) seat.mode = "drive";
    this.reach = false;
    this.ride.reset();
  }

  /** A guest waits for the host: begins what its answer allows, or shows why it was refused. */
  private settle(wallDt: number): void {
    const step = this.ride.settle(wallDt);
    if (step === "refused") this.refuseFor(this.ride.refusal);
    else if (step !== "none") this.begin(step, this.ride.car);
  }

  /** The camera on him (`OnFootCamera`), or drawing back round his car while he climbs in. True while it is his. */
  aim(wallDt: number): boolean {
    if (!this.flow.active || !this.host.ragdolls.walkerTorso(_torso)) return false;
    if (this.flow.phase === "entering") this.cam.drawBack(wallDt, _torso, this.host.cars()[this.flow.car]);
    else this.cam.aim(wallDt, _torso, this.arms.aiming, this.armed() && this.arms.heldOut());
    return true;
  }

  /** The trip's camera is over: the car's view back, his head drawn again. */
  private endView(): void {
    this.steer.unseed();
    this.cam.end();
  }

  /** The HUD's read of the trip, or null where the control does nothing: the scene does not offer it, or he neither sits at a wheel he may leave nor is out. */
  hud(): FootHud | null {
    if (!this.host.available() || (!this.flow.active && this.seatedIndex() < 0)) return null;
    return {
      out: this.flow.active,
      prompt: this.prompt(),
      refusal: this.refusalText(),
      arms: this.arms.hud(),
    };
  }

  /** Why the control just refused, for `REFUSAL_SECONDS`; null otherwise. */
  private refusalText(): string | null {
    if (this.refusalLeft <= 0 || this.refusal === null || this.refusal === "busy") return null;
    return this.refusal === "noCarInReach" ? this.noCarText() : REFUSAL_TEXT[this.refusal];
  }

  /** What he is told when no car's door is in reach: his own car's driver's door in the other scenes, any car's door in the open world. */
  private noCarText(): string {
    return this.host.desk() !== null ? OW_NO_CAR_TEXT : REFUSAL_TEXT.noCarInReach;
  }

  /** The line under the view: what the control does here, or why it just refused. Null when there is nothing to say. */
  prompt(): string | null {
    const refused = this.refusalText();
    if (refused !== null) return refused;
    if (!this.host.available()) return null;
    if (this.flow.phase === "arrested") return "Under arrest";
    if (this.flow.phase === "onFoot") return this.reach ? "Enter or Y: get in" : this.noCarText();
    return this.seatedIndex() >= 0 ? "Enter or Y: get out" : null;
  }
}
