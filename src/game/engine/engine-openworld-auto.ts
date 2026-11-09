import type * as THREE from "three";
import { AutoDirector, type SubjectKind } from "../ai/openworld-auto/auto-director.ts";
import { type AutoWorld, newAutoPose, OpenWorldScan } from "../ai/openworld-auto/auto-scan.ts";
import type { LookText } from "../ai/civilians/civilian-look.ts";
import { AutoFollowCam } from "../present/openworld-auto-cam.ts";
import type { Sight } from "../present/spectate-cam.ts";

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

  constructor(world: AutoWorld, capacity: number, seed: number) {
    this.scan = new OpenWorldScan(world);
    this.director = new AutoDirector(capacity, seed);
    this.seed = seed;
  }

  /** Auto came on: the director forgets who it followed. */
  begin(): void {
    this.director.start(this.seed);
    this.framedCuts = -1;
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
    return this.director.step(wallDt, this.scan);
  }

  /** The bubble for the subject on screen; null when there is none. */
  text(): LookText | null {
    return this.director.kind < 0 ? null : this.scan.textOf(this.director.kind as SubjectKind, this.director.id);
  }

  /** Frames the subject in `camera`; false (the regular camera keeps it) while there is none to follow. */
  aim(camera: THREE.PerspectiveCamera, sight: Sight, wallDt: number): boolean {
    if (this.director.kind < 0 || !this.scan.poseOf(this.director.kind as SubjectKind, this.director.id, this.pose)) return false;
    if (this.framedCuts !== this.director.cuts) {
      this.framedCuts = this.director.cuts;
      this.cam.cut(sideOf(this.seed, this.director.cuts));
    }
    this.cam.update(camera, this.pose, sight, wallDt);
    return true;
  }
}
