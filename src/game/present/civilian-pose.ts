import { ACTIVITY_OPEN_ENDED } from "../ai/civilians/civilian-activity.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import type { Stoops } from "../world/openworld/openworld-stoops.ts";
import { type ActivityPose, poseActivity } from "./civilian-anim.ts";
import type { PoseSmoothing } from "./civilian-anim-smoothing.ts";
import type { DummyMesh } from "./ragdoll-mesh.ts";

const pose: ActivityPose = { x: 0, y: 0, z: 0, yaw: 0, stride: 0, speed: 0, activity: 0, clock: 0, left: ACTIVITY_OPEN_ENDED, surface: 0, hasPartner: false, bearing: 0, variant: 0, nerve: 0, onSpur: false, stoops: null };

/**
 * Slot `slot` of `mesh` posed as civilian `civilian` of `poses` stands, walks or does her activity: on her feet at her place facing her yaw, her pose not snapping (`smoothing`), her walk drawn smoothed
 * (`PoseSmoothing.walk`), and with `stoops` her feet planted on the treads when she walks a stoop's spur. Allocates nothing.
 */
export function poseCivilian(mesh: DummyMesh, slot: number, poses: CrowdPoses, civilian: number, smoothing: PoseSmoothing, stoops: Stoops | null): void {
  pose.x = poses.x[civilian]!;
  pose.y = poses.feetY[civilian]!;
  pose.z = poses.z[civilian]!;
  pose.yaw = poses.yaw[civilian]!;
  pose.stride = poses.stride[civilian]!;
  pose.speed = poses.speed[civilian]!;
  smoothing.walk(civilian, pose);
  pose.onSpur = poses.onSpur[civilian] === 1;
  pose.stoops = stoops;
  pose.activity = poses.activity[civilian]!;
  pose.clock = poses.activityClock[civilian]!;
  pose.left = poses.activityLeft[civilian]!;
  pose.surface = poses.surfaceY[civilian]! - pose.y;
  pose.variant = poses.look[civilian]!;
  smoothing.refreshNerve(poses.look, civilian);
  pose.nerve = smoothing.nerve[civilian]!;
  const partner = poses.partner[civilian]!;
  pose.hasPartner = partner >= 0 && partner < poses.count;
  if (pose.hasPartner) {
    const dx = poses.x[partner]! - pose.x;
    const dz = poses.z[partner]! - pose.z;
    const yaw = pose.yaw;
    pose.bearing = Math.atan2(dx * Math.cos(yaw) - dz * Math.sin(yaw), dx * Math.sin(yaw) + dz * Math.cos(yaw));
  }
  poseActivity(mesh, slot, pose, smoothing, civilian);
}
