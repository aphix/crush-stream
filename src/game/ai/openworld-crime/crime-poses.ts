import { ACTIVITY, ACTIVITY_OPEN_ENDED } from "../civilians/civilian-activity.ts";
import { STRIDE_RADIANS_PER_METRE } from "../civilians/civilian-crowd-constants.ts";
import { createCrowdPoses, type CrowdPoses } from "../civilians/crowd-poses.ts";
import { SUBJECT_MODE } from "./case-table.ts";
import { COP_LOOK, FOOT_COP_COUNT, GRIP_SECONDS } from "./crime-constants.ts";
import { COP_MODE } from "./foot-cops.ts";
import type { FootLaw } from "./foot-law.ts";

/** A pose set for the foot cops: drawn by a crowd art of their own, dressed by `COP_LOOK`. */
export function newCopPoses(): CrowdPoses {
  const poses = createCrowdPoses(FOOT_COP_COUNT);
  poses.look.fill(COP_LOOK);
  return poses;
}

/** The crowd's poses after the law's say: a suspect running, being cuffed or led away cuffed is where the law has them (acting it), a hider or a fighter thrown down is not drawn, and a resident held off the street stays hidden. Run after the crowd's own step. */
export function overlaySuspects(law: FootLaw, poses: CrowdPoses): void {
  const { table, walkers } = law;
  for (let at = 0; at < table.heldResident.length; at++) {
    const held = table.heldResident[at]!;
    if (held >= 0) poses.shown[held] = 0;
  }
  for (let slot = 0; slot < table.resident.length; slot++) {
    const resident = table.resident[slot]!;
    if (resident < 0) continue;
    const mode = table.mode[slot]!;
    if (mode === SUBJECT_MODE.hidden || (mode === SUBJECT_MODE.gripped && table.tookDown[slot] === 1)) {
      poses.shown[resident] = 0;
      continue;
    }
    if (mode !== SUBJECT_MODE.fleeing && mode !== SUBJECT_MODE.gripped && mode !== SUBJECT_MODE.escorted) continue;
    const walker = law.walkerOf(slot);
    poses.shown[resident] = 1;
    poses.x[resident] = walkers.x[walker]!;
    poses.z[resident] = walkers.z[walker]!;
    poses.yaw[resident] = walkers.yaw[walker]!;
    poses.stride[resident] = walkers.walked[walker]! * STRIDE_RADIANS_PER_METRE;
    poses.speed[resident] = walkers.speed[walker]!;
    poses.partner[resident] = -1;
    writeArrestActivity(law, slot, mode === SUBJECT_MODE.gripped ? ACTIVITY.cuffing : mode === SUBJECT_MODE.escorted ? ACTIVITY.cuffed : ACTIVITY.none, poses, resident);
  }
}

/** Pose `index` acts `activity` on the clock of subject slot `slot`'s phase (the grip, or the walk away): the grip's clips end with the cuffs, the walk's loop. */
function writeArrestActivity(law: FootLaw, slot: number, activity: number, poses: CrowdPoses, index: number): void {
  poses.activity[index] = activity;
  const gripping = activity === ACTIVITY.cuffing || activity === ACTIVITY.arresting;
  const clock = activity === ACTIVITY.none ? 0 : law.seconds - law.table.since[slot]!;
  poses.activityClock[index] = clock;
  poses.activityLeft[index] = gripping ? Math.max(0, GRIP_SECONDS - clock) : ACTIVITY_OPEN_ENDED;
}

/** The foot cops' own poses: a cop holding a suspect for the cuffs acts the arrest, one leading her away the escort. */
export function fillCopPoses(law: FootLaw, poses: CrowdPoses): void {
  const { cops, walkers, table } = law;
  for (let cop = 0; cop < FOOT_COP_COUNT; cop++) {
    poses.shown[cop] = cops.mode[cop] === COP_MODE.off ? 0 : 1;
    poses.x[cop] = walkers.x[cop]!;
    poses.z[cop] = walkers.z[cop]!;
    poses.yaw[cop] = walkers.yaw[cop]!;
    poses.stride[cop] = walkers.walked[cop]! * STRIDE_RADIANS_PER_METRE;
    poses.speed[cop] = walkers.speed[cop]!;
    writeArrestActivity(law, 0, ACTIVITY.none, poses, cop);
  }
  for (let slot = 0; slot < table.mode.length; slot++) {
    const mode = table.mode[slot]!;
    const holder = table.holder[slot]!;
    if (table.resident[slot]! < 0 || holder < 0 || table.tookDown[slot] === 1) continue;
    if (mode === SUBJECT_MODE.gripped) writeArrestActivity(law, slot, ACTIVITY.arresting, poses, holder);
    else if (mode === SUBJECT_MODE.escorted) writeArrestActivity(law, slot, ACTIVITY.escorting, poses, holder);
  }
}
