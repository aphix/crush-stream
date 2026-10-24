import assert from "node:assert/strict";
import { blankAiCar, type AiCar } from "./derby-ai.ts";
import { PoliceBrain } from "./police.ts";
import type { HunterWorld } from "./cop-brain.ts";
import { RaceBrain } from "./race-ai.ts";
import { hypot2 } from "../kernel/physics-core.js";
import { blankPoint, blankProjection, Track } from "../world/track.ts";
import oval from "../world/tracks/oval.json" with { type: "json" };

export const track = new Track(oval);
export const BEAT = 0.25;
export const pt = blankPoint();

/**
 * `racers` racers (car 0 racing, any others half a lap on and not yet racing) and a stakeout of two units (cars `racers` and `racers + 1`) parked
 * ahead of car 0, `units` cops in all, the stakeout a `leadShare` of the lap on. The first unit has just woken (the racer passed it); the second,
 * 12 m on, is still parked. The local camera sees nothing (as the headless race's) until a test sets `camera.sees`.
 */
export function rig(units = 2, seed = 1, leadShare = 0.4, racers = 1) {
  const first = racers;
  const cars: AiCar[] = Array.from({ length: racers + units }, (_, i) => blankAiCar(i));
  const hunt = new Uint8Array(cars.length);
  hunt[0] = 1;
  const stored: number[] = [];
  const spots: { x: number; z: number }[] = [];
  /** Every placement, with the racer's place at that moment. */
  const parks: { id: number; x: number; z: number; racer: { x: number; z: number } }[] = [];
  const knockedOut = new Set<number>();
  const camera = { sees: false };
  const world: HunterWorld = {
    park: (id, x, _y, z, yaw) => {
      spots[id] = { x, z };
      parks.push({ id, x, z, racer: { x: cars[0]!.x, z: cars[0]!.z } });
      Object.assign(cars[id]!, { x, z, vx: 0, vz: 0, yaw });
    },
    store: (id) => {
      stored.push(id);
    },
    down: (id) => knockedOut.has(id),
    speed: (id) => hypot2(cars[id]!.vx, cars[id]!.vz),
    sirens: () => {},
    hidden: () => !camera.sees,
  };
  const police = new PoliceBrain(track, new RaceBrain(track, racers), first, units, seed);
  const lead = track.length * leadShare;
  let time = 0;
  let finishedAt = Number.NaN;
  const beat = () => {
    police.update(Number.isNaN(finishedAt) ? time : finishedAt, BEAT, cars, hunt, lead, world);
    time += BEAT;
  };
  /** The race is over: its clock (what `update` is given) stands still from here while the beats go on. */
  const finish = () => {
    finishedAt = time;
  };
  const run = (seconds: number) => {
    for (let n = 0; n < seconds / BEAT; n++) beat();
  };
  /** Car 0 on the centreline `ds` m along from the first unit's spot. */
  const sit = (ds: number) => {
    const s = track.project(spots[first]!.x, spots[first]!.z, -1, blankProjection()).s;
    const p = track.pointAt(s + ds, pt);
    Object.assign(cars[0]!, { x: p.x, z: p.z });
  };
  const start = track.pointAt(lead, pt);
  Object.assign(cars[0]!, { x: start.x, z: start.z });
  for (let i = 1; i < racers; i++) {
    const p = track.pointAt(lead + track.length / 2, pt);
    Object.assign(cars[i]!, { x: p.x, z: p.z });
  }
  beat();
  assert.ok(spots[first] && spots[first + 1], "the stakeout parked");
  sit(5);
  beat();
  assert.deepEqual(police.chasers(cars, []).map((c) => c.id), [first], "the first unit chases");
  assert.equal(stored.length, 0);
  return { police, cars, hunt, stored, parks, knockedOut, camera, beat, run, sit, world, clock: () => time, finish };
}
