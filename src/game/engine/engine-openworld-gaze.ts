import type { LineOfSight } from "../ai/openworld-crime/offence-source.ts";
import { LOOK_RADIUS, LOOK_REACH } from "../ai/civilians/civilian-crowd-constants.ts";
import { chestMet, placeMet, type LookRay, type LookText, type Meeting } from "../ai/civilians/civilian-look.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { CrowdGaze, STIMULUS } from "../present/civilian-gaze.ts";
import { FACE_HEIGHT_M, KIND_RANGE } from "../present/civilian-gaze-constants.ts";
import { blankSenses, type GazeCar } from "../present/civilian-gaze-table.ts";
import { activeGround } from "../world/ground.ts";
import { PLACE_KIND, type OpenWorldMap } from "../world/openworld/walk-graph.ts";
import type { OpenWorldBodies } from "./openworld-bodies.ts";

/** A wall hit turns heads from this closing speed (m/s) and draws full interest from `CRASH_FULL_SPEED` (tuned by feel: under the brain's 8 m/s wreck, as a look costs less than an alarm). */
const CRASH_LOOK_SPEED = 6;
const CRASH_FULL_SPEED = 15;
/** One crash pulse in this long (s): a car grinding along a wall reports a hit every step. */
const CRASH_PULSE_GAP_S = 0.5;
/** A shop sign's middle over the ground (m): the band is 1 m tall from 2.9 m up (`openworld-shop-signs.ts`). */
const SIGN_Y_M = 3.4;
/** Places whose front draws an idle glance: the businesses and hangouts with a window or a sign. */
const GLANCED_KINDS = new Set<number>([PLACE_KIND.work, PLACE_KIND.food, PLACE_KIND.shop, PLACE_KIND.hangout]);

/** What gaze needs of the engine: the cars, the player on foot (false in a car) and the buildings' line of sight (absent: none blocks). */
type GazePorts = {
  cars(): readonly GazeCar[];
  foot(out: { x: number; z: number; velocityX: number; velocityZ: number }): boolean;
  lineOfSight: LineOfSight | null;
};

/** The open world's gaze in the engine: the senses filled each frame, the loud things pulsed as they happen, the bodies' necks aimed, and the look panel's gaze line. */
export class OpenWorldGaze {
  readonly gaze: CrowdGaze;
  private readonly ports: GazePorts;
  private readonly senses = blankSenses();
  private readonly foot = { x: 0, z: 0, velocityX: 0, velocityZ: 0 };
  private readonly met: Meeting = { index: -1, along: 0 };
  private readonly placeMeeting: Meeting = { index: -1, along: 0 };
  private sinceCrash = CRASH_PULSE_GAP_S;

  constructor(capacity: number, map: OpenWorldMap, ports: GazePorts) {
    this.gaze = new CrowdGaze(capacity);
    this.ports = ports;
    this.senses.lineOfSight = ports.lineOfSight;
    const fronts = map.places.filter((place) => GLANCED_KINDS.has(place.kind));
    const ground = activeGround();
    this.gaze.attractors = Float32Array.from(fronts.flatMap((place) => [place.doorX, ground.heightAt(place.doorX, place.doorZ) + SIGN_Y_M, place.doorZ]));
  }

  /** A frame of `wallDt` s with the eye at (eyeX, eyeZ): the crowd senses and turns, and the bodies standing for some of them turn their necks with them. */
  frame(poses: CrowdPoses, eyeX: number, eyeZ: number, wallDt: number, bodies: OpenWorldBodies | null): void {
    const senses = this.senses;
    senses.eyeX = eyeX;
    senses.eyeZ = eyeZ;
    senses.cars = this.ports.cars();
    senses.player = this.ports.foot(this.foot);
    if (senses.player) {
      senses.playerX = this.foot.x;
      senses.playerY = activeGround().heightAt(this.foot.x, this.foot.z) + FACE_HEIGHT_M;
      senses.playerZ = this.foot.z;
    }
    this.gaze.update(poses, wallDt, senses);
    bodies?.aimNecks(this.gaze.headYaw, this.gaze.torsoTwist, this.gaze.headPitch);
    this.sinceCrash += wallDt;
  }

  /** A car met a solid at (x, z) closing at `closing` m/s: a hard one is a crash heads turn to. */
  noteWallHit(closing: number, x: number, z: number): void {
    if (closing < CRASH_LOOK_SPEED || this.sinceCrash < CRASH_PULSE_GAP_S) return;
    this.sinceCrash = 0;
    const salience = Math.min(1, closing / CRASH_FULL_SPEED);
    this.gaze.pulse(STIMULUS.crash, x, activeGround().heightAt(x, z) + 1, z, KIND_RANGE[STIMULUS.crash]! * salience, salience);
  }

  /** Someone was knocked down at (x, z). */
  noteKnock(x: number, z: number): void {
    this.gaze.pulse(STIMULUS.knock, x, activeGround().heightAt(x, z), z, KIND_RANGE[STIMULUS.knock]!, 1);
  }

  /** The player on foot fired: everyone in earshot looks his way. */
  noteShot(): void {
    if (!this.ports.foot(this.foot)) return;
    this.gaze.pulse(STIMULUS.gunshot, this.foot.x, activeGround().heightAt(this.foot.x, this.foot.z) + FACE_HEIGHT_M, this.foot.z, KIND_RANGE[STIMULUS.gunshot]!, 1);
  }

  /** The look panel's `text` with a last line saying what the person the ray meets is looking at (when the panel is about a person). */
  describe(text: LookText | null, poses: CrowdPoses, map: OpenWorldMap, ray: LookRay): LookText | null {
    if (text === null) return null;
    const resident = chestMet(poses, poses.count, null, ray, LOOK_RADIUS, LOOK_REACH, this.met);
    if (resident.index < 0 || resident.along > placeMet(map, ray, LOOK_REACH, this.placeMeeting).along) return text;
    return { title: text.title, lines: [...text.lines, this.gaze.describe(resident.index)] };
  }
}
