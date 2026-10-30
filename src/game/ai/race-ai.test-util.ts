import * as THREE from "three";
import { DRIVE, applyDrive, idleDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { applyAiDrive } from "./input-fade.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { blankAiCar, type AiCar } from "./derby-ai.ts";
import { snapshotAiCar } from "../match/derby.ts";
import { fleetStyle } from "../scenes/fleet.ts";
import { RaceBrain, copyDrive } from "./race-ai.ts";
import { AI_EVERY_SLICE, type AiDifficulty } from "./constants.ts";
import { RaceSession } from "../match/session.ts";
import { Track, blankProjection, projectPath } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { activeGround, setGround } from "../world/ground.ts";
import type { CarPose, Entrant } from "../match/types.ts";
import { DT } from "../vehicle/test-support.ts";
import { assignClass, carClass, classStats, type VehicleClassId } from "../vehicle/vehicle-classes.ts";
import { SURFACE_IDS, type SurfaceId } from "../world/catalog.ts";

export type Run = { session: RaceSession; onRoad: number; samples: number; mistakes: number };

/** The race cars of the process, by grid slot: no car is ever hit here, so each is stood up again (`spawnFacing`) for the next race instead of built anew. */
const carPool: DeformableCar[] = [];
/** Cars built on a named class's body (`classes`), by slot and class. */
const classPool = new Map<string, DeformableCar>();

/**
 * Real cars on the real drive model (kinematic, as every car is until it crashes) on the course's
 * ground, no car-to-car contact: the AI alone has to keep them on the road and round the laps. Each car's brain plans with its own class's
 * figures (`setClass`), as the game's race field does: a muscle car plans as a muscle car. `each` sees the cars after every step. `classes` puts
 * slot i on class `classes[i]`'s body and class (a fleet body and its style's class otherwise).
 */
export function race(track: Track, n: number, aggression: number, laps: number, limit: number, difficulty: AiDifficulty = AI_EVERY_SLICE, tap?: (id: number, out: DriveInput) => void, each?: (cars: readonly DeformableCar[], session: RaceSession) => void, classes?: readonly VehicleClassId[]): Run {
  const scene = new THREE.Scene();
  const ground = track.ground();
  setGround(ground);
  const cars = Array.from({ length: n }, (_, i) => {
    const id = classes?.[i];
    if (id === undefined) return (carPool[i] ??= new DeformableCar({ body: 0x808080, accent: 0x404040, name: `ai${i}` }, scene, null, fleetStyle(i)));
    const key = `${i}/${id}`;
    let car = classPool.get(key);
    if (!car) {
      car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: `ai${i}` }, scene, null, classStats(id).style);
      assignClass(car, id);
      classPool.set(key, car);
    }
    return car;
  });
  const entrants: Entrant[] = cars.map((_, i) => ({ id: i, name: `ai${i}`, kind: "ai", aggression }));
  const session = new RaceSession(track, entrants, { laps, noReset: false });
  const brain = new RaceBrain(track, n);
  for (const [i, c] of cars.entries()) {
    const g = track.gridSlot(i);
    c.spawnFacing(g.x, g.z, g.yaw, 0);
    brain.setAggression(i, aggression);
    brain.setDifficulty(i, difficulty);
    brain.setClass(i, classStats(carClass(c)));
  }
  const snaps: AiCar[] = cars.map((_, i) => blankAiCar(i));
  const poses: CarPose[] = cars.map(() => ({ x: 0, z: 0, yaw: 0, vx: 0, vz: 0, alive: true }));
  const hold = { ...idleDrive(), brake: 1 };
  const held = cars.map(() => idleDrive());
  const p = blankProjection();
  let onRoad = 0;
  let samples = 0;
  let step = 0;
  while (session.phase !== "finished" && session.time < limit) {
    for (const [i, c] of cars.entries()) snapshotAiCar(snaps[i]!, i, c, true);
    for (const [i, c] of cars.entries()) {
      const rec = session.cars[i]!;
      if (session.phase === "racing" && rec.status === "racing") {
        const out = brain.think(snaps[i]!, snaps, rec, DT);
        tap?.(i, out);
        copyDrive(out, held[i]!);
        applyAiDrive(c, brain.guard(snaps[i]!, snaps, held[i]!, DT), DT);
      } else applyDrive(c, hold, DT);
      c.integrate(DT);
    }
    for (const [i, c] of cars.entries()) {
      const pose = poses[i]!;
      pose.x = c.group.position.x;
      pose.z = c.group.position.z;
      pose.yaw = c.yaw;
      pose.vx = c.velocity.x;
      pose.vz = c.velocity.z;
    }
    session.step(DT, poses);
    session.events();
    each?.(cars, session);
    if (session.phase === "racing" && ++step % 6 === 0) {
      for (const [i, c] of cars.entries()) {
        if (session.cars[i]!.status !== "racing") continue;
        samples++;
        const x = c.group.position.x;
        const z = c.group.position.z;
        projectPath(track.path, x, z, -1, p);
        if (Math.abs(p.lateral) <= track.path.half[p.k]! + 0.3) {
          onRoad++;
          continue;
        }
        for (const sc of track.shortcuts) {
          projectPath(sc.path, x, z, -1, p);
          if (Math.abs(p.lateral) <= sc.path.half[p.k]! + 0.3) {
            onRoad++;
            break;
          }
        }
      }
    }
  }
  setGround(null);
  return { session, onRoad, samples, mistakes: brain.mistakes.reduce((a, b) => a + b, 0) };
}

/** How much looser each tier's finish bound is than hard's: the owner asked for slower lower tiers, and a stuck or lost car still misses it by minutes. */
const BOUND_SCALE: Record<AiDifficulty, number> = { easy: 1.2, medium: 1.1, hard: 1 };
export const COURSES = TRACKS.map((json) => new Track(json));
export type Summary = { winner: number; share: number; samples: number; finished: number; mistakes: number; lapTimes: number[]; time: number; limit: number; laps: string };

/** 8 clean cars racing 3 laps of `track` at `difficulty`, in numbers. */
export function summarize(track: Track, difficulty: AiDifficulty): Summary {
  // Half the drive model's top speed on average, plus the countdown and grid.
  const limit = ((3 * track.length) / (DRIVE.maxFwd / 2) + 10) * BOUND_SCALE[difficulty];
  const { session, onRoad, samples, mistakes } = race(track, 8, 0, 3, limit, difficulty);
  return { winner: session.cars.find((c) => c.id === session.winnerId)?.finishTime ?? Infinity, share: onRoad / samples, samples, finished: session.cars.filter((c) => c.status === "finished").length, mistakes, lapTimes: session.cars.flatMap((c) => c.lapTimes), time: session.time, limit, laps: session.cars.map((c) => c.lap).join(",") };
}

const memo = new Map<string, Summary>();
/** `summarize`, remembered: the per-course tests and the tier comparisons share each race. */
export function raced(track: Track, difficulty: AiDifficulty): Summary {
  const key = `${track.id}/${difficulty}`;
  if (!memo.has(key)) memo.set(key, summarize(track, difficulty));
  return memo.get(key)!;
}

export type HotLap = { time: number; distance: number; mix: Partial<Record<SurfaceId, number>> };

/**
 * Flying lap of class `id` alone on `track` (aggression 0, no traffic): the second of two laps, the first started off the grid. `mix` is the
 * share of that lap's driven distance on each surface, read under the car, on whatever line (shortcuts included) the AI took.
 */
export function hotLap(track: Track, id: VehicleClassId): HotLap {
  const metres: Partial<Record<SurfaceId, number>> = {};
  let total = 0;
  const each = (cars: readonly DeformableCar[], session: RaceSession) => {
    if (session.cars[0]!.lapTimes.length !== 1) return;
    const c = cars[0]!;
    const d = Math.hypot(c.velocity.x, c.velocity.z) * DT;
    const s = activeGround().surfaceAt(c.group.position.x, c.group.position.z);
    metres[s] = (metres[s] ?? 0) + d;
    total += d;
  };
  // 8 m/s average over both laps, plus the countdown: a stuck car misses it.
  const { session } = race(track, 1, 0, 2, (2 * track.length) / 8 + 10, AI_EVERY_SLICE, undefined, each, [id]);
  const mix: Partial<Record<SurfaceId, number>> = {};
  for (const s of SURFACE_IDS) if (metres[s] !== undefined) mix[s] = metres[s] / total;
  return { time: session.cars[0]!.lapTimes[1] ?? Infinity, distance: total, mix };
}
