import * as THREE from "three";
import { ACTIVITY_OPEN_ENDED } from "../ai/civilians/civilian-activity.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { mulberry32 } from "../world/placements.ts";

const LOOK_STEP = 0x9e3779b1;
const NO_PARTNER = -1;

/** A crowd of `count` shown civilians at the origin, standing still, each in its own look. */
export function emptyPoses(count: number): CrowdPoses {
  const poses: CrowdPoses = {
    count,
    x: new Float32Array(count),
    z: new Float32Array(count),
    yaw: new Float32Array(count),
    stride: new Float32Array(count),
    speed: new Float32Array(count),
    look: new Uint32Array(count),
    shown: new Uint8Array(count).fill(1),
    activity: new Uint8Array(count),
    activityClock: new Float32Array(count),
    activityLeft: new Float32Array(count).fill(ACTIVITY_OPEN_ENDED),
    surfaceY: new Float32Array(count),
    partner: new Int32Array(count).fill(NO_PARTNER),
    feetY: new Float32Array(count),
  };
  for (let civilian = 0; civilian < count; civilian++) poses.look[civilian] = Math.imul(civilian + 1, LOOK_STEP) >>> 0;
  return poses;
}

/** Civilians standing down the x axis at `distances` (m), the eye at the origin. */
export function posesAlongStreet(distances: readonly number[]): CrowdPoses {
  const poses = emptyPoses(distances.length);
  for (const [civilian, distance] of distances.entries()) poses.x[civilian] = distance;
  return poses;
}

/** `count` civilians scattered over a disc of `radius` (m) round the origin, walking, from seed `seed`. */
export function posesScattered(count: number, radius: number, seed: number): CrowdPoses {
  const poses = emptyPoses(count);
  const random = mulberry32(seed);
  for (let civilian = 0; civilian < count; civilian++) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * radius;
    poses.x[civilian] = Math.cos(angle) * distance;
    poses.z[civilian] = Math.sin(angle) * distance;
    poses.yaw[civilian] = random() * Math.PI * 2;
    poses.stride[civilian] = random() * Math.PI * 2;
    poses.speed[civilian] = 1;
  }
  return poses;
}

/** Draws a renderer would issue for everything visible under `root`: each visible mesh, an instanced one only with instances. */
export function drawCalls(root: THREE.Object3D): number {
  let calls = 0;
  root.traverseVisible((object) => {
    if (object instanceof THREE.InstancedMesh ? object.count > 0 : object instanceof THREE.Mesh) calls++;
  });
  return calls;
}
