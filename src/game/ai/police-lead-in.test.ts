import { describe, expect, it } from "vitest";
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
/** A racer slow enough (m/s; back on the road after a respawn) that a woken cop reaches it within its lead-in. */
const SLOW_RACER = 5;
/** Seconds run from the first cop's wake: the lead-in (1.8 s) and a beat past it. */
const SECONDS = 3;
/** How far apart (m) the stakeout pair stands: one cop's nose at the other's. */
const PAIR_GAP = 12;
/** A car's half length and half width (m): the footprint two cops must not overlap. */
const HALF_LENGTH = 2.3;
const HALF_WIDTH = 0.95;
/** Seconds of the lead-in (the brain's is 2) whose heading is judged, as the race judge did. */
const LEAD_IN = 1.8;
/** A cop slower than this (m/s) has no heading to read. */
const MOVING = 3;
/** How far (m, in x and in z) the lone cop's mate is moved off the course. */
const OFF_COURSE = 1e4;
/** A lead-in heading that ends under this (rad) off the road is lined up, whether or not it started further off. */
const LINED_UP = 0.2;

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
 * (else the first has just woken with the racer 5 m past it). `lone`: the second cop is off the course, so nothing but the road steers the first, and the
 * racer drives at `SLOW_RACER`; the first cop's lead-in heading against the road under it (`heading`, rad, each frame) and its T-bones of the racer come back too.
 */
function runPair(
  leadShare: number,
  on: Track = track,
  approach = false,
  lone = false,
): { pulled: boolean[]; bad: string[]; touched: string[]; closest: number; spot: number; blind: number; heading: number[]; tbones: string[] } {
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
    // The lone cop keeps the brain's own spot and its nose turned toward the road.
    if (lone) Object.assign(r.cars[2]!, { x: r.cars[2]!.x + OFF_COURSE, z: r.cars[2]!.z + OFF_COURSE });
    else {
      stand(1, spotS[0]!, 0);
      stand(2, spotS[1]!, Math.PI);
    }
    for (const [i, car] of fleet.entries()) car.spawnFacing(r.cars[i]!.x, r.cars[i]!.z, r.cars[i]!.yaw, 0);
    const blind = on.project(r.cars[1]!.x, r.cars[1]!.z, -1, proj).s;
    const park = { ...idleDrive(), brake: 1 };
    const pulled = [false, false];
    const touched: string[] = [];
    const bad: string[] = [];
    let closest = Infinity;
    const heading: number[] = [];
    const tbones: string[] = [];
    let leadEnd = Infinity;
    const toSpot = (((spot0 - racerS0) % L) + L) % L;
    const racerSpeed = lone ? SLOW_RACER : RACER_SPEED;
    const seconds = approach ? toSpot / racerSpeed + SECONDS : SECONDS;
    for (let f = 0; f < seconds / DT; f++) {
      const racerS = (racerS0 + racerSpeed * f * DT) % L;
      const p = on.pointAt(racerS, pt);
      fleet[0]!.spawnFacing(p.x, p.z, Math.atan2(p.tx, p.tz), racerSpeed);
      for (const [i, car] of fleet.entries()) snapshotAiCar(r.cars[i]!, i, car, true);
      if (f % Math.round(BEAT / DT) === 0) r.beat();
      for (const id of [1, 2]) {
        const car = fleet[id]!;
        const driving = r.police.drives(id);
        if (driving && !pulled[id - 1]) {
          pulled[id - 1] = true;
          if (id === 1) leadEnd = f * DT + LEAD_IN;
          const along = racerS - spotS[id - 1]!;
          const ahead = along - L * Math.round(along / L);
          if (ahead < 0) bad.push(`cop ${id} pulled away at ${(f * DT).toFixed(2)} s with the racer ${(-ahead).toFixed(0)} m short of its spot`);
        }
        if (driving) applyAiDrive(car, r.police.think(r.cars[id]!, r.cars, DT), DT);
        else applyDrive(car, park, DT);
        car.integrate(DT);
      }
      closest = Math.min(closest, fleet[1]!.group.position.distanceTo(fleet[2]!.group.position));
      const cop = fleet[1]!;
      const v = cop.velocity;
      if (lone && f * DT < leadEnd && Math.hypot(v.x, v.z) > MOVING) {
        const road = on.pointAt(on.project(cop.group.position.x, cop.group.position.z, -1, proj).s, pt);
        heading.push(Math.abs(Math.atan2(v.x * road.tz - v.z * road.tx, v.x * road.tx + v.z * road.tz)));
        if (overlaps(footprintOf(cop), footprintOf(fleet[0]!))) {
          // Crossways to the racer and into its flank, not its bumpers.
          const dx = cop.group.position.x - fleet[0]!.group.position.x;
          const dz = cop.group.position.z - fleet[0]!.group.position.z;
          const ty = fleet[0]!.yaw;
          const alongRacer = Math.abs(dx * Math.sin(ty) + dz * Math.cos(ty)) / Math.hypot(dx, dz);
          if (alongRacer < 0.5 && Math.abs(Math.cos(cop.yaw - ty)) < 0.5) tbones.push(`${(f * DT).toFixed(2)} s`);
        }
      }
      if (overlaps(footprintOf(fleet[1]!), footprintOf(fleet[2]!))) touched.push(`${(f * DT).toFixed(2)} s`);
    }
    return { pulled, bad, touched, closest, spot: spotS[0]!, blind, heading, tbones };
  } finally {
    setGround(null);
  }
}

describe("given a stakeout pair of cops standing 12 m apart in one lane of the oval, nose to nose, and a racer passing them at 50 m/s", () => {
  /** Where along the lap the stakeout stands (shares of its length): the oval's near straight and its far one. */
  const testCases = [
    { it: "when the racer passes the stakeout 0.4 of the lap on and the cops wake into their lead-ins, then no two cops touch, and each cop that pulls away has the racer past its spot", share: 0.4 },
    { it: "when the racer passes the stakeout 0.7 of the lap on and the cops wake into their lead-ins, then no two cops touch, and each cop that pulls away has the racer past its spot", share: 0.7 },
  ];
  for (const testCase of testCases) {
    it(testCase.it, (t) => {
      const r = runPair(testCase.share);
      t.annotate(`closest ${r.closest.toFixed(1)} m`);
      expect(r.pulled[0] && r.pulled[1], `both cops woke (cop 1 ${r.pulled[0]}, cop 2 ${r.pulled[1]}): the test proves nothing`).toBeTruthy();
      expect(r.bad).toHaveLength(0);
      expect(r.touched, "frames in which the two cops' footprints overlapped").toHaveLength(0);
    });
  }
});

describe("given one stakeout cop parked by the oval, its nose turned toward the road and no pack-mate near, and a slow racer (5 m/s) just past it", () => {
  /** The lone cop's stakeouts (the racer's lead share): its spot on the straight before the line, and mid-bend, where the error must rise while it turns into the road. */
  const testCases = [
    { it: "when the cop wakes into its lead-in on a straight, then its heading off the road ends under where it started or under 0.2 rad, and it never T-bones the racer", share: 0.8 },
    { it: "when the cop wakes into its lead-in on a bend, then its heading off the road ends under where it started or under 0.2 rad, and it never T-bones the racer", share: 0.5 },
  ];
  for (const testCase of testCases) {
    it(testCase.it, (t) => {
      const r = runPair(testCase.share, track, false, true);
      expect(r.pulled[0] && r.heading.length > 0, "the cop woke and drove its lead-in").toBeTruthy();
      const start = r.heading[0]!;
      const end = r.heading.at(-1)!;
      t.annotate(`spot ${r.spot.toFixed(0)} m, heading ${start.toFixed(2)} → ${end.toFixed(2)} rad`);
      expect(end < start || end < LINED_UP, `heading ${start.toFixed(2)} → ${end.toFixed(2)} rad off the road`).toBeTruthy();
      expect(r.bad).toHaveLength(0);
      expect(r.tbones, "frames the cop was crossways into the racer's flank").toHaveLength(0);
    });
  }
});

describe("given a stakeout pair of cops parked 12 m apart nose to nose on a long fast course, and a racer driven up the road past them at 50 m/s", () => {
  /** The long fast courses' stakeouts: Dam Spine's on the valley road under the dam (stacked in plan: a blind read of the spot takes the dam, 2 km back), Four-Count's on its long back straight. */
  const testCases = [
    { it: "when the racer passes the stakeout on dam-spine, then both cops wake into their lead-ins, no two cops touch, and each cop that pulls away has the racer past its spot", id: "dam-spine", share: 0.506, stacked: true },
    { it: "when the racer passes the stakeout on four-count, then both cops wake into their lead-ins, no two cops touch, and each cop that pulls away has the racer past its spot", id: "four-count", share: 0.5, stacked: false },
  ];
  for (const testCase of testCases) {
    it(testCase.it, (t) => {
      const r = runPair(testCase.share, new Track(TRACKS.find((j) => parseTrack(j).id === testCase.id)), true);
      t.annotate(`spot ${r.spot.toFixed(0)} m (blind read ${r.blind.toFixed(0)} m), closest ${r.closest.toFixed(1)} m`);
      if (testCase.stacked) expect(Math.abs(r.blind - r.spot), `the stakeout at ${r.spot.toFixed(0)} m is not under the dam: the stacked case is not staged`).toBeGreaterThan(1000);
      expect(r.pulled[0] && r.pulled[1], `both cops woke (cop 1 ${r.pulled[0]}, cop 2 ${r.pulled[1]})`).toBeTruthy();
      expect(r.bad).toHaveLength(0);
      expect(r.touched, "frames in which the two cops' footprints overlapped").toHaveLength(0);
    });
  }
});
