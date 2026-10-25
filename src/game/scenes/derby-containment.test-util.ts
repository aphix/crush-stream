import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import type { DriveInput } from "../vehicle/car-drive.ts";
import { cageLift } from "../vehicle/car-cage-rig.ts";
import { frame, makeCar } from "../vehicle/ground-probe.test-util.ts";
import { armKill, CLASSES, HANDLING, VEHICLE_CLASS_IDS, type VehicleClassId } from "../vehicle/vehicle-classes.ts";
import { INITIAL_HUD } from "../hud/hud-store.ts";
import type { PropHits } from "../contact/prop-contact.ts";
import { DERBY_ARENA } from "./constants.ts";
import { arenaWorld, leaveArena } from "./derby-arena.test-util.ts";
import { DERBY_RAMPS, type DerbyRamp } from "./derby-ground.ts";

/**
 * A derby car stays in the arena however it gets to the wall. It is driven flat out, boosting, at the wall from the open floor at its
 * class's top speed, across the whole arena from the far side (over the table-top, the ramps and the props that lie on the way), at
 * each bowl ramp from the far end of its long run (the longest run-up the layout allows), and out of each ramp's lip from the foot of
 * its run and from its crest at top speed. "In" is the whole drawn body: no cage vertex is ever past the wall's outer face, the car
 * ends inside the inner face, and whenever the body touches the wall it is well under the wall's top.
 */
export const FLAT_OUT: DriveInput = { throttle: 1, steer: 0, brake: 0, ebrake: false, boost: true };
/** Seconds a launch plays: from rest across the arena or from a jump's far entry, the run-up and the wall; from the open ring at its top speed the car meets the wall at once (the last it was seen to move outward was 0.3 s in, in every class). */
const SECONDS = 8;
const OPEN_FLOOR_SECONDS = 3;
const HEADINGS = 16;
/** A second set of headings half a wall piece off the first, so one set of launches meets the wall at a seam. */
const SEAM_OFFSET = Math.PI / DERBY_ARENA.wallPieces;
const OFFSETS = [0, SEAM_OFFSET] as const;
const { radius, wallThickness, wallHeight, spawnInset } = DERBY_ARENA;
/** The open ring between the features and the wall's inner face (the spawn ring's radius), where a launch toward the wall is clean. */
const OPEN_RING_RADIUS = radius - spawnInset;
const OUTER_FACE = radius + wallThickness;
/** How far inside the wall a run-up starts (m): a car's length and a margin. */
const RUN_UP_MARGIN = 4.5;
/** The most of the wall's height (m) any part of a car may be at while it touches the wall: the rest is the margin to the top. */
const WALL_TOP_MARGIN = 1;
const WALL_TOUCH_CEILING = wallHeight - WALL_TOP_MARGIN;

type Flight = { maxRadius: number; maxHeightAtWall: number; finalRadius: number };

const vertex = new THREE.Vector3();

export function carOfClass(cls: VehicleClassId, x: number, z: number, yaw: number, speed: number): DeformableCar {
  const car = makeCar(cls);
  car.spawnFacing(x, z, yaw, speed);
  car.deform.squash = INITIAL_HUD.squash;
  car.deform.buckle = INITIAL_HUD.buckle;
  car.deform.setMode(INITIAL_HUD.deformMode);
  armKill(car.deform, cls, HANDLING.realism, "derby");
  return car;
}

function fly(cls: VehicleClassId, x: number, z: number, yaw: number, speed: number, seconds: number): Flight {
  const car = carOfClass(cls, x, z, yaw, speed);
  const hits: PropHits = { knock() {}, fx() {}, wall() {} };
  const { world } = arenaWorld([car], hits);
  const flight: Flight = { maxRadius: 0, maxHeightAtWall: 0, finalRadius: 0 };
  const accumulator = { acc: 0 };
  for (let step = 0; step < seconds * 60; step++) {
    frame(world, FLAT_OUT, accumulator, () => {
      const orientation = car.group.quaternion;
      const lift = cageLift(car);
      const { pos, panelOn } = car.cage.fields;
      const { vertexCount, vertexGroup } = car.cage.style;
      for (let k = 0; k < vertexCount; k++) {
        // A torn-off lid's points stay parked at its rest on the body; the wall meets the plan box `rasterise` builds without them.
        const group = vertexGroup[k]!;
        if (group > 0 && panelOn[group - 1] === 0) continue;
        vertex.set(pos[k * 3]!, pos[k * 3 + 1]! + lift, pos[k * 3 + 2]!).applyQuaternion(orientation).add(car.group.position);
        const vertexRadius = Math.hypot(vertex.x, vertex.z);
        flight.maxRadius = Math.max(flight.maxRadius, vertexRadius);
        if (vertexRadius >= radius) flight.maxHeightAtWall = Math.max(flight.maxHeightAtWall, vertex.y);
      }
    });
  }
  flight.finalRadius = Math.hypot(car.group.position.x, car.group.position.z);
  return flight;
}

/** One launch: where it starts and heads, and what it is (for a failure message). */
export type Launch = { label: string; x: number; z: number; yaw: number; speed: number; seconds: number };

function openFloorLaunches(cls: VehicleClassId): Launch[] {
  return OFFSETS.flatMap((offset) =>
    Array.from({ length: HEADINGS }, (_, k) => {
      const heading = (k / HEADINGS) * 2 * Math.PI + offset;
      return { label: `open floor, heading ${heading.toFixed(2)}`, x: Math.sin(heading) * OPEN_RING_RADIUS, z: Math.cos(heading) * OPEN_RING_RADIUS, yaw: heading, speed: CLASSES[cls].topSpeed, seconds: OPEN_FLOOR_SECONDS };
    }),
  );
}

function acrossLaunches(stride: number): Launch[] {
  return OFFSETS.flatMap((offset) =>
    Array.from({ length: HEADINGS / stride }, (_, i) => {
      const k = i * stride;
      const heading = (k / HEADINGS) * 2 * Math.PI + offset;
      return { label: `across the arena, heading ${heading.toFixed(2)}`, x: -Math.sin(heading) * OPEN_RING_RADIUS, z: -Math.cos(heading) * OPEN_RING_RADIUS, yaw: heading, speed: 0, seconds: SECONDS };
    }),
  );
}

/** Each ramp's far entry: the far end of its long run on the opposite side of the arena, the longest run-up the layout allows, heading up the ramp into the wall. */
function farEntryLaunches(): Launch[] {
  return DERBY_RAMPS.map((ramp) => {
    const across = ramp.toward.x !== 0 ? ramp.plateau.z : ramp.plateau.x;
    const start = Math.sqrt(radius ** 2 - across ** 2) - RUN_UP_MARGIN;
    return {
      label: `${ramp.name} ramp from its far entry`,
      x: ramp.toward.x !== 0 ? -ramp.toward.x * start : ramp.plateau.x,
      z: ramp.toward.z !== 0 ? -ramp.toward.z * start : ramp.plateau.z,
      yaw: Math.atan2(ramp.toward.x, ramp.toward.z),
      speed: 0,
      seconds: SECONDS,
    };
  });
}

/** A car `distance` m from the middle along a ramp's rising direction, on the ramp's own line, heading up it. */
function onRamp(ramp: DerbyRamp, distance: number, label: string, speed: number, seconds: number): Launch {
  const { plateau, toward } = ramp;
  return {
    label: `${ramp.name} ramp ${label}`,
    x: toward.x !== 0 ? toward.x * distance : plateau.x,
    z: toward.z !== 0 ? toward.z * distance : plateau.z,
    yaw: Math.atan2(toward.x, toward.z),
    speed,
    seconds,
  };
}

/** Outward flights: from rest at the foot of each ramp's long run (the run-up its own length allows), and from each ramp's crest at the class's top speed (the fastest and highest a car leaves a lip). */
function outwardLaunches(cls: VehicleClassId): Launch[] {
  return DERBY_RAMPS.flatMap((ramp) => {
    const { plateau, toward } = ramp;
    const crest = toward.x * plateau.x + toward.z * plateau.z;
    const crestHalfDepth = Math.abs(toward.x) * plateau.halfX + Math.abs(toward.z) * plateau.halfZ;
    return [
      onRamp(ramp, crest - crestHalfDepth - ramp.length, "from the foot of its run", 0, SECONDS),
      onRamp(ramp, crest, "from its crest at top speed", CLASSES[cls].topSpeed, OPEN_FLOOR_SECONDS),
    ];
  });
}

/** Headings (deg) off the square a launch takes at a side wedge: square, and a slant either way (the owner's two traces met a side at 0° and about 40°). */
const SIDE_SLANTS_DEGREES = [0, 30, -30] as const;

/**
 * From rest at the longest run-up the arena allows (back along the heading from the wedge to a car's length inside the wall), each bowl ramp's
 * two side planes met at the middle of the plane's run, square and slanted: the run a player boosts across at the 45° wedge beside a ramp.
 */
export function sideWedgeLaunches(): Launch[] {
  return DERBY_RAMPS.flatMap((ramp) => {
    const { plateau, toward } = ramp;
    const alongX = toward.x !== 0;
    const halfAcross = alongX ? plateau.halfZ : plateau.halfX;
    const centre = alongX ? plateau.x : plateau.z;
    return ([1, -1] as const).flatMap((side) => {
      // run: -x, +x, -z, +z.
      const planeRun = plateau.run[(alongX ? 2 : 0) + (side > 0 ? 1 : 0)]!;
      const across = (alongX ? plateau.z : plateau.x) + side * (halfAcross + planeRun / 2);
      const targetX = alongX ? centre : across;
      const targetZ = alongX ? across : centre;
      const square = alongX ? Math.atan2(0, -side) : Math.atan2(-side, 0);
      return SIDE_SLANTS_DEGREES.map((slant): Launch => {
        const yaw = square + (slant * Math.PI) / 180;
        const dx = Math.sin(yaw);
        const dz = Math.cos(yaw);
        const along = targetX * dx + targetZ * dz;
        const reach = radius - RUN_UP_MARGIN;
        const back = along + Math.sqrt(along * along - (targetX * targetX + targetZ * targetZ - reach * reach));
        return { label: `${ramp.name} ramp's ${side > 0 ? "+" : "-"}${alongX ? "z" : "x"} side, ${slant}° off square`, x: targetX - dx * back, z: targetZ - dz * back, yaw, speed: 0, seconds: SECONDS };
      });
    });
  });
}

/**
 * The launches of one class: the open ring in every direction, across the arena at every `stride`th of the headings, each ramp's far entry, and each ramp's outward flights
 * (from the foot of its run, from its crest at top speed). The per-commit suite (`derby-containment.test.ts`) takes every fourth heading across the arena, the full-sanity
 * suite (`derby-containment.ai-long-run.ts`) every one. Not a test file itself.
 */
export function containmentCases(stride: number): void {
  afterEach(leaveArena);

  describe("given a derby car driven flat out at the arena wall", () => {
    for (const cls of VEHICLE_CLASS_IDS) {
      const launches = [...openFloorLaunches(cls), ...acrossLaunches(stride), ...farEntryLaunches(), ...outwardLaunches(cls)];
      it(`when the ${cls} is launched from the open ring in every direction, across the arena (${stride === 1 ? "every direction" : `every ${stride}th`}), from each ramp's far entry, its foot and its crest, then no part of it passes the wall's outer face and it ends inside`, () => {
        for (const launch of launches) {
          const flight = fly(cls, launch.x, launch.z, launch.yaw, launch.speed, launch.seconds);
          assert.ok(flight.maxRadius < OUTER_FACE, `${launch.label}: a vertex reached ${flight.maxRadius.toFixed(2)} m, past the outer face at ${OUTER_FACE} m`);
          assert.ok(flight.finalRadius < radius, `${launch.label}: ended at ${flight.finalRadius.toFixed(2)} m, outside the inner face at ${radius} m`);
          assert.ok(flight.maxHeightAtWall <= WALL_TOUCH_CEILING, `${launch.label}: touched the wall ${flight.maxHeightAtWall.toFixed(2)} m up, over ${WALL_TOUCH_CEILING} m of its ${wallHeight} m`);
        }
      });
    }
  });

  describe("given a derby car driven flat out from the arena's far side at each bowl ramp's side wedge (the 45° plane beside the ramp), square and slanted", () => {
    const launches = sideWedgeLaunches();
    for (const cls of VEHICLE_CLASS_IDS) {
      let flights: Flight[] | null = null;
      const flown = (): Flight[] => (flights ??= launches.map((l) => fly(cls, l.x, l.z, l.yaw, l.speed, l.seconds)));
      it(`when the ${cls} meets each ramp's two sides, then no part of it passes the wall's outer face and it ends inside`, () => {
        for (const [i, flight] of flown().entries()) {
          assert.ok(flight.maxRadius < OUTER_FACE, `${launches[i]!.label}: a vertex reached ${flight.maxRadius.toFixed(2)} m, past the outer face at ${OUTER_FACE} m`);
          assert.ok(flight.finalRadius < radius, `${launches[i]!.label}: ended at ${flight.finalRadius.toFixed(2)} m, outside the inner face at ${radius} m`);
        }
      });
      it(`when the ${cls} meets each ramp's two sides, then it touches the wall no higher than ${WALL_TOUCH_CEILING} m of its ${wallHeight} m`, () => {
        const over = flown().flatMap((flight, i) => (flight.maxHeightAtWall > WALL_TOUCH_CEILING ? [`${launches[i]!.label}: ${flight.maxHeightAtWall.toFixed(1)} m`] : []));
        assert.deepEqual(over, []);
      });
    }
  });
}
