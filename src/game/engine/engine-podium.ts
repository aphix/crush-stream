import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { PODIUM_BLOCKS, type PodiumPlace } from "../match/podium.ts";
import type { PodiumHud } from "../match/types.ts";
import { PodiumStage } from "../present/podium-stage.ts";
import { sinCosAt } from "../kernel/physics-core.js";
import type { CarDamage } from "./car-damage.ts";

/** What the podium needs from the engine. */
export type PodiumHost = {
  /** Where the stage floats (its platform's top, at its middle); null without a course. */
  spot(): { x: number; y: number; z: number } | null;
  /** The podium's car for racer `id`: `reuse` when it already is a car of that racer's body and class, else one built (and `reuse` let go). Null when the field has no such car. Hidden, outside the field, not yet dressed. */
  carFor(id: number, reuse: DeformableCar | null): DeformableCar | null;
  /** Dress `car` as racer `id` wore it in the race: paint and spray, the crumple settings, the class's parts. */
  dress(car: DeformableCar): void;
  /** A car the podium built is let go. */
  discard(car: DeformableCar): void;
  /** Racer `id`'s damage as the race ended. */
  damageOf(id: number): CarDamage | null;
  /** The stage joins this. */
  scene: THREE.Object3D;
  /** One fountain jet (`FountainSystem.jet`): at (x, y, z) in `startIn` wall s, firing for `runFor` s at `power`, in `color`. */
  jet(x: number, y: number, z: number, startIn: number, runFor: number, power: number, color: THREE.Color): void;
};

/** What the reel director asks of a podium while it has the screen (`ReelDirector.showPodium`). */
export type PodiumShow = {
  /**
   * The frame's time, in and out: the caller writes the wall time (s) into `time[NOW]` and `frame` leaves the wall seconds the effects advance by in `time[STEP]`. A typed array, not an
   * argument and a result: a double passed to or returned from a call that is not inlined is a heap number each frame.
   */
  readonly time: Float64Array;
  /** Once per rendered frame, after `time[NOW]` is written. */
  frame(): void;
  /** The camera's pose for this frame. */
  aim(camera: THREE.PerspectiveCamera): void;
  /** The car the sun's shadow box follows: the winner's. */
  focus(): DeformableCar | null;
  /** The cars on show (the lamp pool lights them). */
  cars(): readonly DeformableCar[];
};

/** The swing of the camera around the stand: how far either side of dead ahead (rad), and the wall seconds of a full there-and-back. A pendulum, so the banner stays behind the cars. */
const SWEEP_ARC = 0.8;
const SWEEP_PERIOD = 30;
/** The camera's distance from the stand's middle (m) at the start and settled, and its height over the platform. */
const RADIUS_START = 34;
const RADIUS_SETTLED = 19;
const EYE_ABOVE = 8.5;
/** What the camera aims at over the platform (m), and the half-width of the stand it keeps in view (m: the three blocks and the cars' overhang). */
const AIM_UP = 2.8;
const STAND_HALF_WIDTH = 9;
/** Slots of the show's clock (`PodiumDirector.clock`). */
export const NOW = 0;
export const STEP = 1;
const BEGAN = 0;
const LAST = 1;
const AGE = 2;
const NEXT_JETS = 3;
/** Wall seconds the camera takes to dolly in. */
const INTRO_S = 3.5;
/** Frames after a raise the cars' skins are drawn: the dents, parts and glass settle in the first, and a car that does not move needs no more (`updateSkin` allocates, and the stand is still). */
const SKIN_FRAMES = 3;
/** The fountains: a round of jets every `JET_GAP` wall s, each firing `JET_RUN` s, at these spots on the platform (x, z) and in these colours in turn. */
const JET_GAP = 3;
const JET_RUN = 2.2;
const JET_POWER = 1;
const JET_SPOTS: readonly (readonly [number, number])[] = [
  [-8.4, 3.5],
  [8.4, 3.5],
  [-10, -3.6],
  [10, -3.6],
];
const JET_COLOURS = [0xffd34d, 0xff5a5f, 0x5aa9ff, 0xffffff].map((hex) => new THREE.Color(hex));

/**
 * The podium (docs/PODIUM.md): the top three of a finished race or campaign, their cars as the race left them (`CarDamage`: the dents, the torn parts and lost wheels) standing on a stage that floats over
 * the course, with a slow camera swing and fountains. It owns three cars of its own (built beside the field, never in it): the field's cars are the reel's to respawn, and a race that goes on after the podium
 * finds them as it left them.
 */
export class PodiumDirector {
  private readonly host: PodiumHost;
  private stage: PodiumStage | null = null;
  private readonly built: (DeformableCar | null)[] = PODIUM_BLOCKS.map(() => null);
  /** The cars standing now (the winner's first), in place of a place nobody holds. */
  private readonly standing: DeformableCar[] = [];
  /** The damage each standing car wears, in `standing` order. */
  private readonly worn: (CarDamage | null)[] = [];
  private names: string[] = [];
  private kind: PodiumHud["kind"] = "race";
  private up = false;
  private readonly spot = new THREE.Vector3();
  /** The show's clock in a typed array (a double stored in a field of the class is a heap number every frame): when it began, the last frame, seconds in, when the next jets fire. */
  private readonly clock = new Float64Array(4).fill(NaN);
  readonly time = new Float64Array(2);
  /** Scratch of `aim`: sine and cosine pairs of the sweep, its half and the pitch (`sinCosAt` writes them in place), and the lens's last fov, aspect and the distance it asks. */
  private readonly trig = new Float64Array(4);
  private readonly lens = new Float64Array(3).fill(NaN);
  private round = 0;
  private skinFrames = 0;

  constructor(host: PodiumHost) {
    this.host = host;
  }

  get open(): boolean {
    return this.up;
  }

  /** Raise the stage over the course with `places` on it, `title` small on its banner (the course, or the championship). False (nothing raised) with no course or nobody to show. */
  raise(places: readonly PodiumPlace[], kind: PodiumHud["kind"], title: string): boolean {
    const spot = this.host.spot();
    if (!spot || places.length === 0) return false;
    if (!this.stage) {
      this.stage = new PodiumStage();
      this.host.scene.add(this.stage.group);
    }
    this.spot.set(spot.x, spot.y, spot.z);
    this.stage.group.position.copy(this.spot);
    this.stage.group.visible = true;
    this.stage.setNames(places, title);
    this.standing.length = 0;
    this.worn.length = 0;
    for (let k = 0; k < PODIUM_BLOCKS.length; k++) {
      const place = places[k];
      const car = place ? this.host.carFor(place.id, this.built[k]!) : null;
      this.built[k] = car;
      if (!place || !car) continue;
      this.stand(car, place.id, PODIUM_BLOCKS[k]!);
      this.standing.push(car);
      this.worn.push(this.host.damageOf(place.id));
    }
    this.skinFrames = SKIN_FRAMES;
    this.names = places.map((p) => p.name);
    this.kind = kind;
    this.clock.fill(NaN);
    this.round = 0;
    this.up = true;
    return true;
  }

  /** The stage and its cars go away. */
  lower(): void {
    this.up = false;
    if (this.stage) this.stage.group.visible = false;
    for (const car of this.built) if (car) car.group.visible = false;
    this.standing.length = 0;
  }

  /** The cars and the stage are let go for good (the engine ends). */
  dispose(): void {
    this.lower();
    for (const car of this.built) if (car) this.host.discard(car);
    this.built.fill(null);
    this.stage?.dispose();
    this.stage = null;
  }

  /** What the HUD draws while the stage is up; `reel` is the campaign reel option's clip count (`RaceHud.campaignReel`). */
  hud(reel: number): PodiumHud | null {
    return this.up ? { kind: this.kind, names: this.names, reel } : null;
  }

  frame(): void {
    const now = this.time[NOW]!;
    const c = this.clock;
    if (Number.isNaN(c[BEGAN]!)) {
      c[BEGAN] = now;
      c[LAST] = now;
      c[NEXT_JETS] = 0;
    }
    this.time[STEP] = Math.min(Math.max(now - c[LAST]!, 0), 0.1);
    c[LAST] = now;
    c[AGE] = now - c[BEGAN]!;
    if (c[AGE]! >= c[NEXT_JETS]!) {
      c[NEXT_JETS] = c[AGE]! + JET_GAP;
      this.fire();
    }
    if (this.skinFrames > 0) {
      this.skinFrames--;
      for (let k = 0; k < this.standing.length; k++) {
        this.standing[k]!.updateSkin();
        this.worn[k]?.drawOn(this.standing[k]!);
      }
    }
  }

  aim(camera: THREE.PerspectiveCamera): void {
    const age = this.clock[AGE]!;
    const settle = Math.min(1, age / INTRO_S);
    const ease = 1 - (1 - settle) * (1 - settle) * (1 - settle);
    const lens = this.lens;
    // Far enough that the whole stand fits the view's width, whatever its shape (a phone upright sees a narrow slice); worked out again only when the lens changes.
    if (lens[0] !== camera.fov || lens[1] !== camera.aspect) {
      lens[0] = camera.fov;
      lens[1] = camera.aspect;
      lens[2] = STAND_HALF_WIDTH / (Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
    }
    const radius = Math.max(RADIUS_START + (RADIUS_SETTLED - RADIUS_START) * ease, lens[2]!);
    // The sweep's sine, then the sine and cosine of half the swing: the swing's own are their double angle, and the camera's yaw quaternion is the half angle itself.
    const trig = this.trig;
    trig[0] = (age * 2 * Math.PI) / SWEEP_PERIOD;
    sinCosAt(trig, 0);
    trig[2] = (trig[0]! * SWEEP_ARC * ease) / 2;
    sinCosAt(trig, 2);
    const sinHalf = trig[2]!;
    const cosHalf = trig[3]!;
    const s = this.spot;
    camera.position.set(s.x + 2 * sinHalf * cosHalf * radius, s.y + EYE_ABOVE, s.z + (cosHalf * cosHalf - sinHalf * sinHalf) * radius);
    // Turned to the stand by yaw (the half angle) and pitch down (the half of an angle whose cosine is the run over the distance, by the half-angle identities): no roll, no trig of the pitch, and
    // no lookAt or Euler (each allocates every call). The quaternion is the yaw about y then the pitch about x (YXZ).
    const rise = EYE_ABOVE - AIM_UP;
    const cosPitch = radius / Math.sqrt(rise * rise + radius * radius);
    const sinPitchHalf = -Math.sqrt((1 - cosPitch) / 2);
    const cosPitchHalf = Math.sqrt((1 + cosPitch) / 2);
    camera.quaternion.set(cosHalf * sinPitchHalf, sinHalf * cosPitchHalf, -sinHalf * sinPitchHalf, cosHalf * cosPitchHalf);
  }

  focus(): DeformableCar | null {
    return this.standing[0] ?? null;
  }

  cars(): readonly DeformableCar[] {
    return this.standing;
  }

  /** Car `car` (racer `id`) on `block`'s top, nose turned as the block says, wearing the damage the race ended with. */
  private stand(car: DeformableCar, id: number, block: (typeof PODIUM_BLOCKS)[number]): void {
    const s = this.spot;
    car.spawnFacing(s.x + block.x, s.z, block.yaw, 0);
    car.group.position.y = s.y + block.top;
    this.host.dress(car);
    this.host.damageOf(id)?.lay(car);
    car.followHubs(false);
    car.hideLoose();
    car.group.visible = true;
    car.group.updateMatrixWorld(true);
  }

  /** A round of fountain jets at the platform's spots, each in the next colour. */
  private fire(): void {
    const s = this.spot;
    for (let k = 0; k < JET_SPOTS.length; k++) {
      const at = JET_SPOTS[k]!;
      this.host.jet(s.x + at[0], s.y, s.z + at[1], 0, JET_RUN, JET_POWER, JET_COLOURS[this.round++ % JET_COLOURS.length]!);
    }
  }
}
