import { launch, pooledCar } from "../../contact/crash-scenarios.test-util.ts";
import type { DeformableCar } from "../../vehicle/car.ts";
import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import { ACTIVITY } from "./civilian-activity.ts";
import { CivilianCrowd } from "./civilian-crowd.ts";
import { RESIDENT_INT, RESIDENT_INT_STRIDE, SPECIES } from "./civilian-constants.ts";
import { CivilianRemote } from "./civilian-remote.ts";
import type { CrowdPoses } from "./crowd-poses.ts";

import { detCos, detSin } from "../../kernel/physics-core.js";
export const CROWD_SEED = 17;
export const CROWD_RESIDENTS = 60;
/** The step of a crowd test's frames: a power of two, so sums of it are exact and two clocks that count the same frames read the same seconds. */
export const FRAME_SECONDS = 1 / 64;

function noFailure(err: Error): never {
  throw err;
}

/** A crowd on `map`, its brain in the main thread unless a `Worker` is installed on `globalThis` (or `remote` is given). */
export function newCrowd(map: OpenWorldMap, residents = CROWD_RESIDENTS, seed = CROWD_SEED, remote = CivilianRemote.open(noFailure)): CivilianCrowd {
  return new CivilianCrowd(map, seed, residents, remote);
}

/** A hash of everything the drawing reads that every peer must agree on: the bump clip is a local flinch (it starts when a peer first steps past a close pair), so it is not in it. */
export function posesDigest(poses: CrowdPoses): string {
  let hash = 2166136261;
  const mix = (value: number): void => void (hash = Math.imul(hash ^ value, 16777619) >>> 0);
  const bitsOf = (array: Float32Array): Int32Array => new Int32Array(array.buffer, array.byteOffset, array.length);
  const placed = [poses.x, poses.z, poses.yaw, poses.stride, poses.speed, poses.feetY, poses.surfaceY].map(bitsOf);
  const activityTimes = [poses.activityClock, poses.activityLeft].map(bitsOf);
  for (let resident = 0; resident < poses.count; resident++) {
    mix(poses.shown[resident]!);
    if (poses.shown[resident] === 0) continue;
    mix(poses.look[resident]!);
    for (const view of placed) mix(view[resident]!);
    if (poses.activity[resident] === ACTIVITY.bump) continue;
    mix(poses.activity[resident]!);
    mix(poses.partner[resident]!);
    for (const view of activityTimes) mix(view[resident]!);
  }
  return hash.toString(16);
}

/** The first resident of `species` (default: a person) the crowd shows now, or -1. */
export function shownResident(crowd: CivilianCrowd, species: number = SPECIES.person): number {
  for (let resident = 0; resident < crowd.poses.count; resident++) {
    if (crowd.poses.shown[resident] === 1 && crowd.state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.species] === species) return resident;
  }
  return -1;
}

/** Steps `crowd` (no cars, as a host) in frames of `FRAME_SECONDS` until it shows a person; returns the crowd time then. */
export function stepUntilShown(crowd: CivilianCrowd, from = 0): number {
  let seconds = from;
  while (shownResident(crowd) < 0) {
    seconds += FRAME_SECONDS;
    crowd.step(seconds, [], true);
    if (seconds - from > 3600) throw new Error("no civilian came out in an hour of crowd time");
  }
  return seconds;
}

/** A car `behind` metres back along the way civilian `resident` walks, driving at them at `mps` m/s: where it starts and where it is after `seconds` more. */
export function carAtWalker(crowd: CivilianCrowd, resident: number, behind: number, mps: number, slot = 0): { car: DeformableCar; place: (seconds: number) => void } {
  const { x, z, yaw } = crowd.poses;
  const dirX = detSin(yaw[resident]!);
  const dirZ = detCos(yaw[resident]!);
  const car = pooledCar(slot);
  const startX = x[resident]! - dirX * behind;
  const startZ = z[resident]! - dirZ * behind;
  launch(car, startX, startZ, yaw[resident]!, dirX * mps, dirZ * mps);
  return {
    car,
    place: (seconds) => car.group.position.set(startX + dirX * mps * seconds, car.group.position.y, startZ + dirZ * mps * seconds),
  };
}
