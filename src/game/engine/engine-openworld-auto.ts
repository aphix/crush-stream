import * as THREE from "three";
import { MANUAL_HOLD_SECONDS, RING_STALE_SECONDS } from "../ai/openworld-auto/auto-constants.ts";
import { AutoCandidates, AutoDirector, SUBJECT, type SubjectKind } from "../ai/openworld-auto/auto-director.ts";
import { type AutoWorld, newAutoPose, OpenWorldScan } from "../ai/openworld-auto/auto-scan.ts";
import type { LookText } from "../ai/civilians/civilian-look.ts";
import type { ChaseCamera } from "../present/engine-camera.ts";
import { AutoFollowCam } from "../present/openworld-auto-cam.ts";
import type { Sight } from "../present/spectate-cam.ts";

/** What the Auto camera asks of the orbit camera that takes the view while the player turns it: the ride-along's (`ChaseCamera`'s drag and orbit), the one control path every followed thing has. */
export type AutoOrbit = {
  /** A drag is under way, or ended less than the ride pause ago: the player holds the view. */
  held(wallDt: number): boolean;
  /** This frame's aim (the subject's chest): a drag turns the camera round it, and its pose is taken from the camera as it stands. */
  aim(look: THREE.Vector3): void;
  /** The orbit camera's frame: the player's view round the aim. */
  orbit(wallDt: number, sight: Sight): void;
  /** Auto has no subject to frame: the orbit is not the ride's. */
  release(): void;
};

/** The orbit camera as the Auto camera uses it: the ride-along's hold (`rideHeld`), aim (`frameRide`) and orbit, which is also what a drag at a thrown driver's dummy turns. One path for every subject: a person, a foot cop, a car and its driver, the ambulance. */
export function autoOrbitOf(view: ChaseCamera): AutoOrbit {
  return {
    held: (wallDt) => view.rideHeld(true, wallDt),
    aim: (look) => view.frameRide(look),
    orbit: (wallDt, sight) => view.orbit(wallDt, 0, false, sight),
    release: () => view.frameRide(null),
  };
}

const NO_SUBJECT = -1;
/** Kinds Q/E walk: the people and what they drive (a wreck's or a knock's spot is a place, not someone to follow). */
const WALKED: readonly SubjectKind[] = [SUBJECT.civilian, SUBJECT.cop, SUBJECT.driver];

const _look = new THREE.Vector3();

/** The seeded side a shot takes, -1 to 1 across the camera's swing: from the cut's own count, so a replayed seed frames the same. */
function sideOf(seed: number, cuts: number): number {
  const h = Math.imul(seed ^ Math.imul(cuts + 1, 0x9e3779b1), 0x85ebca6b) >>> 0;
  return h / 0x80000000 - 1;
}

/**
 * The open world's Auto camera: one subject at a time (a civilian, a foot cop, a driver, a wrecked place), held 5 to 10 seconds, then a cut to the most interesting
 * other thing happening (`AutoDirector`), framed over the shoulder or behind the car (`AutoFollowCam`); its look-at bubble is the followed subject's. Local to the viewer.
 */
export class OpenWorldAuto {
  private readonly director: AutoDirector;
  private readonly scan: OpenWorldScan;
  private readonly cam = new AutoFollowCam();
  private readonly pose = newAutoPose();
  private readonly seed: number;
  private framedCuts = -1;
  /** Whether the player held the view last frame (the camera was the orbit's), so this frame's release hands it back where it stands. */
  private wasHeld = false;
  /** Q/E's walk: the subjects as they stood when it began, nearest the start first, and where in it the camera is. */
  private readonly ring: AutoCandidates;
  private readonly ringDistance: Float32Array;
  private ringCount = 0;
  private ringAt = NO_SUBJECT;
  private ringAge = Infinity;
  private readonly ringPose = newAutoPose();

  /** `sizes`: how many residents, foot cops, cars and logged events there can be, which is how many subjects a scan can list. */
  constructor(world: AutoWorld, sizes: { residents: number; cops: number; cars: number; events: number }, seed: number) {
    this.scan = new OpenWorldScan(world, sizes.residents);
    const capacity = sizes.residents + sizes.cops + sizes.cars + sizes.events;
    this.director = new AutoDirector(capacity, seed);
    this.ring = new AutoCandidates(capacity);
    this.ringDistance = new Float32Array(capacity);
    this.seed = seed;
  }

  /** Auto came on: the director forgets who it followed. */
  begin(): void {
    this.director.start(this.seed);
    this.framedCuts = -1;
    this.wasHeld = false;
    this.ringCount = 0;
    this.ringAge = Infinity;
  }

  /** The subject on screen, null before the first (nothing in the world worth a look yet). */
  get subject(): { kind: SubjectKind; id: number } | null {
    return this.director.kind < 0 ? null : { kind: this.director.kind as SubjectKind, id: this.director.id };
  }

  /** The director's cuts so far. */
  get cuts(): number {
    return this.director.cuts;
  }

  /** One frame of the director; true when it cut to another subject. */
  step(wallDt: number): boolean {
    this.ringAge += wallDt;
    return this.director.step(wallDt, this.scan);
  }

  /** The bubble for the subject on screen; null when there is none. */
  text(): LookText | null {
    return this.director.kind < 0 ? null : this.scan.textOf(this.director.kind as SubjectKind, this.director.id);
  }

  /**
   * Frames the subject in `camera`; false (the regular camera keeps it) while there is none to follow. While the player turns the view (`orbit.held`) the orbit camera has it, round the subject, and the subject is
   * kept; when he lets go the shot picks up from where the camera stands.
   */
  aim(camera: THREE.PerspectiveCamera, sight: Sight, wallDt: number, orbit: AutoOrbit): boolean {
    if (this.director.kind < 0 || !this.scan.poseOf(this.director.kind as SubjectKind, this.director.id, this.pose)) {
      orbit.release();
      return false;
    }
    _look.set(this.pose.x, this.pose.y + this.pose.aimUp, this.pose.z);
    const held = orbit.held(wallDt);
    orbit.aim(_look);
    if (held) {
      this.director.hold(MANUAL_HOLD_SECONDS);
      this.wasHeld = true;
      orbit.orbit(wallDt, sight);
      return true;
    }
    if (this.wasHeld) {
      this.wasHeld = false;
      this.framedCuts = this.director.cuts;
      this.cam.adopt(camera, _look);
    } else if (this.framedCuts !== this.director.cuts) {
      this.framedCuts = this.director.cuts;
      this.cam.cut(sideOf(this.seed, this.director.cuts));
    }
    this.cam.update(camera, this.pose, sight, wallDt);
    return true;
  }

  /**
   * Q/E: the next (`dir` 1) or the previous (-1) person, foot cop or driver in the walk of the subjects by distance from where it began (the subject on screen, else (x, z)), which is kept between presses so a
   * press back undoes a press on. The camera goes there and the director keeps it (`MANUAL_HOLD_SECONDS`). False when there is nobody to go to.
   */
  cycle(dir: 1 | -1, x: number, z: number): boolean {
    if (this.ringAge > RING_STALE_SECONDS || this.ringCount === 0 || !this.ringHolds(this.director.kind, this.director.id)) this.buildRing(x, z);
    const count = this.ringCount;
    for (let tried = 0; tried < count; tried++) {
      this.ringAt = this.ringAt === NO_SUBJECT ? (dir > 0 ? 0 : count - 1) : (((this.ringAt + dir) % count) + count) % count;
      const kind = this.ring.kind[this.ringAt]! as SubjectKind;
      const id = this.ring.id[this.ringAt]!;
      if (kind === this.director.kind && id === this.director.id) continue;
      if (!this.scan.watchable(kind, id)) continue;
      this.director.follow(kind, id, MANUAL_HOLD_SECONDS);
      this.ringAge = 0;
      return true;
    }
    return false;
  }

  /** The walk is the subjects now (people, foot cops and drivers), nearest first by distance from the subject on screen, or from (x, z) with none; the subject on screen is its first. */
  private buildRing(x: number, z: number): void {
    const table = this.ring;
    table.clear();
    this.scan.fill(table);
    let aroundX = x;
    let aroundZ = z;
    if (this.director.kind >= 0 && this.scan.poseOf(this.director.kind as SubjectKind, this.director.id, this.ringPose)) {
      aroundX = this.ringPose.x;
      aroundZ = this.ringPose.z;
    }
    let kept = 0;
    for (let at = 0; at < table.count; at++) {
      const kind = table.kind[at]! as SubjectKind;
      const id = table.id[at]!;
      if (!WALKED.includes(kind) || !this.scan.poseOf(kind, id, this.ringPose)) continue;
      const distance = (this.ringPose.x - aroundX) ** 2 + (this.ringPose.z - aroundZ) ** 2;
      let into = kept++;
      while (into > 0 && this.ringDistance[into - 1]! > distance) {
        table.kind[into] = table.kind[into - 1]!;
        table.id[into] = table.id[into - 1]!;
        this.ringDistance[into] = this.ringDistance[into - 1]!;
        into--;
      }
      table.kind[into] = kind;
      table.id[into] = id;
      this.ringDistance[into] = distance;
    }
    table.count = kept;
    this.ringCount = kept;
    this.ringAge = 0;
    this.ringAt = NO_SUBJECT;
    for (let at = 0; at < kept; at++) {
      if (table.kind[at] === this.director.kind && table.id[at] === this.director.id) {
        this.ringAt = at;
        return;
      }
    }
  }

  /** The walk has the subject (kind, id). */
  private ringHolds(kind: number, id: number): boolean {
    for (let at = 0; at < this.ringCount; at++) if (this.ring.kind[at] === kind && this.ring.id[at] === id) return true;
    return false;
  }
}
