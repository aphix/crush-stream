import { ACTIVITY, ACTIVITY_OPEN_ENDED } from "../ai/civilians/civilian-activity.ts";
import { LOOK } from "../ai/civilians/civilian-crowd-constants.ts";
import { createCrowdPoses, type CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { AMBULANCE } from "../ai/openworld-traffic/ambulance.ts";
import { ATTIRE } from "../present/civilian-art-constants.ts";
import { dressOfLook } from "../present/civilian-dress.ts";
import type { DriverLook } from "../present/driver-look.ts";
import type { CrowdSight } from "../present/civilian-art.ts";

/** Paramedics who kneel by the one run down while the ambulance loads: one each side of them, this far off (m). */
export const MEDICS = { count: 2, beside: 0.7 } as const;
/** How far the look search runs for a man's and a woman's scrubs before it gives up (every look word dresses the same way each time). */
const LOOK_SEARCH = 1 << 14;

type MedicArt = {
  update(poses: CrowdPoses, eyeX: number, eyeZ: number, sight: CrowdSight, wallDt: number): void;
  dispose(): void;
};

/** The first look word at or after 1 that `dressOfLook` dresses in scrubs, a woman's when `woman`. */
function scrubsLook(woman: boolean): number {
  const scratch: DriverLook = { woman: false, shirt: 0, pants: 0, hair: 0, hat: null, mustache: false };
  const womanBit = woman ? 1 << LOOK.womanShift : 0;
  for (let hash = 1; hash < LOOK_SEARCH; hash++) {
    const look = (hash | womanBit) >>> 0;
    if (dressOfLook(look, scratch) === ATTIRE.SCRUBS) return look;
  }
  return womanBit + 1;
}

/** The medics' poses for a frame: while the ambulance is loading (`AMBULANCE.loading`, the traffic's), both kneel by the spot it was called to, one on each side along x, facing it; otherwise none is drawn. Drawn only: nothing reads them. */
export function placeMedics(poses: CrowdPoses, atX: number, atZ: number, ambulanceState: number, wallDt: number): void {
  const atScene = ambulanceState === AMBULANCE.loading;
  for (let medic = 0; medic < MEDICS.count; medic++) {
    const was = poses.shown[medic] === 1;
    poses.shown[medic] = atScene ? 1 : 0;
    if (!atScene) continue;
    const side = medic === 0 ? -1 : 1;
    poses.x[medic] = atX + side * MEDICS.beside;
    poses.z[medic] = atZ;
    poses.yaw[medic] = (-side * Math.PI) / 2;
    poses.speed[medic] = 0;
    poses.stride[medic] = 0;
    poses.activity[medic] = ACTIVITY.kneel;
    poses.activityClock[medic] = was ? poses.activityClock[medic]! + wallDt : 0;
    poses.activityLeft[medic] = ACTIVITY_OPEN_ENDED;
    poses.feetY[medic] = 0;
  }
}

/** The ambulance's crew at a scene (host and solo only: the traffic is theirs), drawn by the crowd's art over poses of their own. */
export class OpenWorldMedics {
  readonly poses = createCrowdPoses(MEDICS.count);
  /** Where the newest ambulance was called to: where the one run down was struck (m). */
  private sceneX = 0;
  private sceneZ = 0;
  private readonly art: MedicArt;

  constructor(art: MedicArt) {
    this.art = art;
    this.poses.look[0] = scrubsLook(false);
    this.poses.look[1] = scrubsLook(true);
  }

  call(x: number, z: number): void {
    this.sceneX = x;
    this.sceneZ = z;
  }

  frame(ambulanceState: number, eyeX: number, eyeZ: number, sight: CrowdSight, wallDt: number): void {
    placeMedics(this.poses, this.sceneX, this.sceneZ, ambulanceState, wallDt);
    this.art.update(this.poses, eyeX, eyeZ, sight, wallDt);
  }

  dispose(): void {
    this.art.dispose();
  }
}
