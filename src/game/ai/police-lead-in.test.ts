import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { snapshotAiCar } from "../match/derby.ts";
import { setGround } from "../world/ground.ts";
import { blankPoint, blankProjection, Track } from "../world/track.ts";
import { parseTrack } from "../world/track-schema.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { applyDrive, idleDrive } from "../vehicle/car-drive.ts";
import { applyAiDrive } from "./input-fade.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { fleetStyle } from "../scenes/fleet.ts";
import { BEAT, rig, track } from "./police-rig.test-util.ts";
import { DT } from "../vehicle/test-support.ts";

/** The racer's speed past the stakeout (m/s): the long fast courses' pace. */
const RACER_SPEED = 50;
/** Seconds run from the first cop's wake: the lead-in (1.8 s) and a beat past it. */
const SECONDS = 3;
/** How far apart (m) the stakeout pair stands: one cop's nose at the other's. */
const PAIR_GAP = 12;
/** A car's half length and half width (m): the footprint two cops must not overlap. */
const HALF_LENGTH = 2.3;
const HALF_WIDTH = 0.95;

/** Where along the lap the stakeout stands (shares of its length): the oval's near straight and its far one. */
const SHARES = [0.4, 0.7];

type Footprint = { x: number; z: number; yaw: number };

const footprintOf = (car: DeformableCar): Footprint => ({ x: car.group.position.x, z: car.group.position.z, yaw: car.yaw });

/** Whether two car footprints overlap, by the separating axes of the two rectangles. */
function overlaps(a: Footprint, b: Footprint): boolean {
  for (const f of [a, b]) {
    const axes = [
      [Math.sin(f.yaw), Math.cos(f.yaw)],
      [Math.cos(f.yaw), -Math.sin(f.yaw)],
    ] as const;
    for (const [ax, az] of axes) {
      const reach = (c: Footprint) => HALF_LENGTH * Math.abs(Math.sin(c.yaw) * ax + Math.cos(c.yaw) * az) + HALF_WIDTH * Math.abs(Math.cos(c.yaw) * ax - Math.sin(c.yaw) * az);
      if (Math.abs((b.x - a.x) * ax + (b.z - a.z) * az) > reach(a) + reach(b)) return false;
    }
  }
  return true;
}

/**
 * The pair's run on `on`: which cops woke, the cops that pulled away without the racer past their spot, the frames the two footprints overlapped,
 * and the first cop's spot (arc, m) with what a blind read of it says. `approach`: both cops still parked and the racer driven up from the lead past them
 * (else the first has just woken with the racer 5 m past it).
 */
function runPair(leadShare: number, on: Track = track, approach = false): { pulled: boolean[]; bad: string[]; touched: string[]; closest: number; spot: number; blind: number } {
  const r = rig(2, 1, leadShare, 1, on, !approach);
  const ground = on.ground();
  setGround(ground);
  try {
    const scene = new THREE.Scene();
    const fleet = [0, 1, 2].map((i) => new DeformableCar({ body: 0x808080, accent: 0x404040, name: `car${i}` }, scene, null, fleetStyle(i)));
    const proj = blankProjection();
    const pt = blankPoint();
    const L = on.length;
    // Arcs come from the road itself, not blind reads: where two stretches stack in plan (Dam Spine's dam over its valley road) a blind read may take the other one.
    const spot0 = (Reflect.get(r.police, "parkS") as Float64Array)[0]!;
    const racerS0 = approach ? L * leadShare : on.project(r.cars[0]!.x, r.cars[0]!.z, -1, proj).s;
    // The pair as the sweeps found it: the second cop stands ${PAIR_GAP} m on from the first along the road, in its lane, facing it (the first faces the way the racers go).
    const lateral = on.project(r.cars[1]!.x, r.cars[1]!.z, Math.floor((spot0 / L) * on.path.count), proj).lateral;
    const stand = (id: number, s: number, turn: number) => {
      const q = on.pointAt(s, pt);
      Object.assign(r.cars[id]!, { x: q.x + q.tz * lateral, z: q.z - q.tx * lateral, yaw: Math.atan2(q.tx, q.tz) + turn });
    };
    const spotS = [spot0, spot0 + PAIR_GAP];
    stand(1, spotS[0]!, 0);
    stand(2, spotS[1]!, Math.PI);
    for (const [i, car] of fleet.entries()) car.spawnFacing(r.cars[i]!.x, r.cars[i]!.z, r.cars[i]!.yaw, 0);
    const blind = on.project(r.cars[1]!.x, r.cars[1]!.z, -1, proj).s;
    const park = { ...idleDrive(), brake: 1 };
    const pulled = [false, false];
    const touched: string[] = [];
    const bad: string[] = [];
    let closest = Infinity;
    const toSpot = (((spot0 - racerS0) % L) + L) % L;
    const seconds = approach ? toSpot / RACER_SPEED + SECONDS : SECONDS;
    for (let f = 0; f < seconds / DT; f++) {
      const racerS = (racerS0 + RACER_SPEED * f * DT) % L;
      const p = on.pointAt(racerS, pt);
      fleet[0]!.spawnFacing(p.x, p.z, Math.atan2(p.tx, p.tz), RACER_SPEED);
      for (const [i, car] of fleet.entries()) snapshotAiCar(r.cars[i]!, i, car, true);
      if (f % Math.round(BEAT / DT) === 0) r.beat();
      for (const id of [1, 2]) {
        const car = fleet[id]!;
        const driving = r.police.drives(id);
        if (driving && !pulled[id - 1]) {
          pulled[id - 1] = true;
          const along = racerS - spotS[id - 1]!;
          const ahead = along - L * Math.round(along / L);
          if (ahead < 0) bad.push(`cop ${id} pulled away at ${(f * DT).toFixed(2)} s with the racer ${(-ahead).toFixed(0)} m short of its spot`);
        }
        if (driving) applyAiDrive(car, r.police.think(r.cars[id]!, r.cars, DT), DT);
        else applyDrive(car, park, DT);
        car.integrate(DT);
      }
      closest = Math.min(closest, fleet[1]!.group.position.distanceTo(fleet[2]!.group.position));
      if (overlaps(footprintOf(fleet[1]!), footprintOf(fleet[2]!))) touched.push(`${(f * DT).toFixed(2)} s`);
    }
    return { pulled, bad, touched, closest, spot: spotS[0]!, blind };
  } finally {
    setGround(null);
  }
}

describe("given a stakeout pair of cops standing 12 m apart in one lane of the oval, nose to nose, and a racer passing them at 50 m/s", () => {
  for (const share of SHARES) {
    it(`when the racer passes the stakeout ${share} of the lap on and the cops wake into their lead-ins, then no two cops touch, and each cop that pulls away has the racer past its spot`, (t) => {
      const r = runPair(share);
      t.diagnostic(`closest ${r.closest.toFixed(1)} m`);
      assert.ok(r.pulled[0] && r.pulled[1], `both cops woke (cop 1 ${r.pulled[0]}, cop 2 ${r.pulled[1]}): the test proves nothing`);
      assert.deepEqual(r.bad, []);
      assert.deepEqual(r.touched, [], "frames in which the two cops' footprints overlapped");
    });
  }
});

/** The long fast courses' stakeouts: Dam Spine's on the valley road under the dam (stacked in plan: a blind read of the spot takes the dam, 2 km back), Four-Count's on its long back straight. */
const LONG_FAST = [
  { id: "dam-spine", share: 0.506, stacked: true },
  { id: "four-count", share: 0.5, stacked: false },
] as const;

describe("given a stakeout pair of cops parked 12 m apart nose to nose on a long fast course, and a racer driven up the road past them at 50 m/s", () => {
  for (const c of LONG_FAST) {
    it(`when the racer passes the stakeout on ${c.id}, then both cops wake into their lead-ins, no two cops touch, and each cop that pulls away has the racer past its spot`, (t) => {
      const r = runPair(c.share, new Track(TRACKS.find((j) => parseTrack(j).id === c.id)), true);
      t.diagnostic(`spot ${r.spot.toFixed(0)} m (blind read ${r.blind.toFixed(0)} m), closest ${r.closest.toFixed(1)} m`);
      if (c.stacked) assert.ok(Math.abs(r.blind - r.spot) > 1000, `the stakeout at ${r.spot.toFixed(0)} m is not under the dam: the stacked case is not staged`);
      assert.ok(r.pulled[0] && r.pulled[1], `both cops woke (cop 1 ${r.pulled[0]}, cop 2 ${r.pulled[1]})`);
      assert.deepEqual(r.bad, []);
      assert.deepEqual(r.touched, [], "frames in which the two cops' footprints overlapped");
    });
  }
});
