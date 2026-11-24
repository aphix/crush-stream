import { ACTIVITY, ACTIVITY_OPEN_ENDED, ACTIVITY_SECONDS } from "../civilians/civilian-activity.ts";
import type { Stoops } from "../../world/openworld/openworld-stoops.ts";
import { createCrowdPoses, type CrowdPoses } from "../civilians/crowd-poses.ts";
import { SUBJECT_MODE } from "./case-table.ts";
import { COP_LOOK, FOOT_COP_COUNT, GRIP_SECONDS } from "./crime-constants.ts";
import type { FootLaw } from "./foot-law.ts";

/** A pose set for the foot cops: drawn by a crowd art of their own, dressed by `COP_LOOK`. */
export function newCopPoses(): CrowdPoses {
  const poses = createCrowdPoses(FOOT_COP_COUNT);
  poses.look.fill(COP_LOOK);
  return poses;
}

/** Whether a suspect in `mode` is drawn by the law (running, gripped and not thrown down, led, boarding or alighting), where she is not the crowd's. */
function drawnByLaw(mode: number, tookDown: number): boolean {
  if (mode === SUBJECT_MODE.gripped) return tookDown !== 1;
  return mode === SUBJECT_MODE.fleeing || mode === SUBJECT_MODE.escorted || mode === SUBJECT_MODE.boarding || mode === SUBJECT_MODE.alighting;
}

/** Suspect `index` stands at the height of the stoop under her (`stoops`: none, the street's). The law walks her along the walk graph, where only a door's spur meets a stoop, so she is marked `onSpur`: the crowd keeps her on the steps and does not move her off them as it does a lane walker. */
function standOnStoop(poses: CrowdPoses, index: number, stoops: Stoops | null): void {
  poses.onSpur[index] = 1;
  if (stoops !== null) stoops.liftFeet(poses.x, poses.z, poses.feetY, index);
}

/** The crowd's poses after the law's say (`share` of the way through the grid step after the last one taken): a suspect running, being cuffed or led away cuffed is where the law has them (acting it) at the height of the stoop under her, a hider, one driven off in the patrol car or a fighter thrown down is not drawn, and a resident held off the street stays hidden. Run after the crowd's own step. */
export function overlaySuspects(law: FootLaw, poses: CrowdPoses, share: number, stoops: Stoops | null): void {
  const { table, walkers } = law;
  for (let at = 0; at < table.heldResident.length; at++) {
    const held = table.heldResident[at]!;
    if (held >= 0) poses.shown[held] = 0;
  }
  for (let slot = 0; slot < table.resident.length; slot++) {
    const resident = table.resident[slot]!;
    if (resident < 0) continue;
    const mode = table.mode[slot]!;
    if (mode === SUBJECT_MODE.hidden || mode === SUBJECT_MODE.conveyed || (mode === SUBJECT_MODE.gripped && table.tookDown[slot] === 1)) {
      poses.shown[resident] = 0;
      continue;
    }
    if (!drawnByLaw(mode, table.tookDown[slot]!)) continue;
    const walker = law.walkerOf(slot);
    poses.shown[resident] = 1;
    poses.x[resident] = walkers.drawnX(walker, share);
    poses.z[resident] = walkers.drawnZ(walker, share);
    poses.yaw[resident] = walkers.drawnYaw(walker, share);
    poses.stride[resident] = walkers.drawnStride(walker, share);
    poses.speed[resident] = walkers.speed[walker]!;
    poses.partner[resident] = -1;
    standOnStoop(poses, resident, stoops);
    writeArrestActivity(law, slot, suspectActivity(mode), poses, resident);
  }
}

/** A guest drew the host's poses over `crowdPoses` and `copPoses` (`OpenWorldShared.poseRows`): the cops and the suspects the law draws stand at the height of the stoop under them as on the host, from the spots the records gave. */
export function liftHeard(law: FootLaw, crowdPoses: CrowdPoses, copPoses: CrowdPoses, stoops: Stoops | null): void {
  if (stoops === null) return;
  for (let cop = 0; cop < FOOT_COP_COUNT; cop++) if (copPoses.shown[cop] === 1) stoops.liftFeet(copPoses.x, copPoses.z, copPoses.feetY, cop);
  const { table } = law;
  for (let slot = 0; slot < table.resident.length; slot++) {
    const resident = table.resident[slot]!;
    if (resident >= 0 && crowdPoses.shown[resident] === 1 && drawnByLaw(table.mode[slot]!, table.tookDown[slot]!)) standOnStoop(crowdPoses, resident, stoops);
  }
}

/** What a suspect in `mode` acts: cuffed, being cuffed, getting into the car or out of it. */
function suspectActivity(mode: number): number {
  if (mode === SUBJECT_MODE.gripped) return ACTIVITY.cuffing;
  if (mode === SUBJECT_MODE.escorted) return ACTIVITY.cuffed;
  if (mode === SUBJECT_MODE.boarding) return ACTIVITY.carIn;
  return mode === SUBJECT_MODE.alighting ? ACTIVITY.carOut : ACTIVITY.none;
}

/** Pose `index` acts `activity` on the clock of subject slot `slot`'s phase (the grip, or the walk away): the grip's clips end with the cuffs, the walk's loop. */
function writeArrestActivity(law: FootLaw, slot: number, activity: number, poses: CrowdPoses, index: number): void {
  poses.activity[index] = activity;
  const gripping = activity === ACTIVITY.cuffing || activity === ACTIVITY.arresting;
  const clock = activity === ACTIVITY.none ? 0 : law.seconds - law.table.since[slot]!;
  poses.activityClock[index] = clock;
  const door = activity === ACTIVITY.carIn ? ACTIVITY_SECONDS.carIn : activity === ACTIVITY.carOut ? ACTIVITY_SECONDS.carOut : 0;
  poses.activityLeft[index] = gripping ? Math.max(0, GRIP_SECONDS - clock) : door > 0 ? Math.max(0, door - clock) : ACTIVITY_OPEN_ENDED;
}

/** The foot cops' own poses, blended as the suspects': a cop holding a suspect for the cuffs acts the arrest, one leading her away the escort. A cop stands at the height of the stoop under his drawn spot (`stoops`: none, the street's): he walks the graph, so on a door's spur he is on the steps, and past them he is on the street. */
export function fillCopPoses(law: FootLaw, poses: CrowdPoses, share: number, stoops: Stoops | null): void {
  const { cops, walkers, table } = law;
  for (let cop = 0; cop < FOOT_COP_COUNT; cop++) {
    poses.shown[cop] = cops.onStreet(cop) ? 1 : 0;
    poses.x[cop] = walkers.drawnX(cop, share);
    poses.z[cop] = walkers.drawnZ(cop, share);
    poses.yaw[cop] = walkers.drawnYaw(cop, share);
    poses.stride[cop] = walkers.drawnStride(cop, share);
    poses.speed[cop] = walkers.speed[cop]!;
    if (stoops !== null) stoops.liftFeet(poses.x, poses.z, poses.feetY, cop);
    writeArrestActivity(law, 0, ACTIVITY.none, poses, cop);
  }
  for (let slot = 0; slot < table.mode.length; slot++) {
    const mode = table.mode[slot]!;
    const holder = table.holder[slot]!;
    if (holder < 0 || table.tookDown[slot] === 1) continue;
    if (mode === SUBJECT_MODE.gripped) writeArrestActivity(law, slot, ACTIVITY.arresting, poses, holder);
    else if (mode === SUBJECT_MODE.escorted) writeArrestActivity(law, slot, ACTIVITY.escorting, poses, holder);
    else if (mode === SUBJECT_MODE.boarding || mode === SUBJECT_MODE.alighting) writeArrestActivity(law, slot, suspectActivity(mode), poses, holder);
  }
}
