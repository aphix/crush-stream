import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { humanSlot } from "../match/survival.ts";
import { PLATFORM_CAMERA } from "../vehicle/car-styles/platform.ts";
import { CAR_STYLES } from "../vehicle/car-variants.ts";
import { GROUND_PAINT_PREFABS, PREFABS } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import { openWorldCourse } from "../world/openworld/openworld-course.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { placeProps } from "../world/placements.ts";
import { SCENERY_ASSETS } from "../world/scenery-assets/index.ts";
import { ROAD_DECAL_ASSET } from "../world/scenery-assets/types.ts";
import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import { EyeClear } from "./eye-clear.ts";
import { inside, occluder, raceSight, solid } from "./spectate-cam.ts";

import { detCos, detSin } from "../kernel/physics-core.js";
/** A car at rest stands its origin a little over the road (tyre squash and suspension): over the top of the 1 m box a crossing's paint once made, under the chase line's first sample through it. */
const CAR_REST_Y = 0.1;
/** Height (m) over a crossing's paint asked about: a car's bumper, well under any chase line. */
const OVER_PAINT_M = 0.5;
/** A drawn building's front stands this far (m) from the car in the companion row: on the sidewalk's clear path, short of the trees and lamps. */
const FROM_FRONT_M = 2;
/** The rig's eye counts as moved when it ends this far (m) from where the rig put it. */
const MOVED_M = 1;

const track = new Track(parseTrack(openWorldCourse(layOutLots())));
const placed = placeProps(track);
const sight = raceSight(track, placed);
const chase = (CAR_STYLES.sedan.camera ?? PLATFORM_CAMERA).third;
const crosswalk = ROAD_DECAL_ASSET.crosswalk;
const crossings = placed.filter((prop) => GROUND_PAINT_PREFABS.has(prop.prefab) && prop.asset !== undefined && SCENERY_ASSETS[prop.asset]!.id === crosswalk);

/** The sedan's chase view of a car at (x, z) facing `yaw` (0 faces +z): its aim point and the rig's eye behind and over it. */
function chaseOf(x: number, z: number, yaw: number) {
  const subject = new THREE.Vector3(x, CAR_REST_Y + chase.aimUp, z);
  const eye = new THREE.Vector3(x - detSin(yaw) * chase.dist, CAR_REST_Y + chase.height, z - detCos(yaw) * chase.dist);
  return { subject, eye, rigEye: eye.clone() };
}

describe("given the open world's course, its crossings painted on the road", () => {
  it("when the solids the cameras keep clear of are read, then no crossing's paint stands up as one", () => {
    const standing = crossings.filter((prop) => solid(sight, prop.x, prop.y + OVER_PAINT_M, prop.z, 0));
    expect(crossings.length, "crossings painted on the course").toBeGreaterThan(0);
    expect(standing.map((prop) => `${prop.x.toFixed(1)},${prop.z.toFixed(1)}`), "crossings a solid stands over").toEqual([]);
  });

  it("when the player's car stands at its spawn on a crossing, then the chase eye keeps the chase view's distance and does not close on the cab", () => {
    const start = track.survival!.start;
    const spawn = humanSlot(start, 0);
    const underSpawn = crossings.filter((prop) => inside(occluder(prop.x, prop.z, prop.yaw, (PREFABS[prop.prefab].size[0] * prop.sx) / 2, (PREFABS[prop.prefab].size[2] * prop.sz) / 2, false, -1, 1), spawn.x, 0, spawn.z, 0));
    expect(underSpawn.length, "crossings painted under the spawn").toBeGreaterThan(0);
    const { subject, eye, rigEye } = chaseOf(spawn.x, spawn.z, spawn.yaw);
    new EyeClear().apply(sight, [], subject, eye, Infinity);
    expect(eye.distanceTo(subject), "the eye's distance from the car's aim point").toBeCloseTo(rigEye.distanceTo(subject), 6);
  });

  it("when a drawn building stands on the chase line, then the eye still moves off the rig's spot inside it", () => {
    const building = placed.find((prop) => prop.prefab === PREFAB.buildingShell || prop.prefab === PREFAB.building)!;
    const halfDepth = (PREFABS[building.prefab].size[0] * building.sx) / 2;
    const frontX = detCos(building.yaw);
    const frontZ = -detSin(building.yaw);
    const carX = building.x + frontX * (halfDepth + FROM_FRONT_M);
    const carZ = building.z + frontZ * (halfDepth + FROM_FRONT_M);
    const subject = new THREE.Vector3(carX, CAR_REST_Y + chase.aimUp, carZ);
    const eye = new THREE.Vector3(building.x, CAR_REST_Y + chase.height, building.z);
    const rigEye = eye.clone();
    new EyeClear().apply(sight, [], subject, eye, Infinity);
    expect(eye.distanceTo(rigEye), "metres the eye moved off the rig's spot inside the building").toBeGreaterThan(MOVED_M);
  });
});
