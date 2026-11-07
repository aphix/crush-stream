import { describe, expect, it } from "vitest";
import { idleDrive } from "../vehicle/car-drive.ts";
import { blankAiCar, type AiCar } from "./derby-ai.ts";
import { RaceBrain, copyDrive } from "./race-ai.ts";
import { Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { DT } from "../vehicle/test-support.ts";

/** A field of 8 racers at the default slider's mild aggression: place 1 leads, place 8 is last. */
const FIELD = 8;
const AGGRESSION = 0.2;
const LEAD = { next: 1, lap: 0, place: 1 };
const LAST = { next: 1, lap: 0, place: FIELD };
const UNPLACED = { next: 1, lap: 0 };
type State = typeof UNPLACED & { place?: number };

const oval = new Track(TRACKS[0]);

function brain(track: Track): RaceBrain {
  const b = new RaceBrain(track, FIELD);
  for (let i = 0; i < FIELD; i++) b.setAggression(i, AGGRESSION);
  return b;
}

/** A car on `track`'s centre line `s` m along, doing `v` m/s along the road. */
function onRoad(track: Track, id: number, s: number, v: number): AiCar {
  const p = track.pointAt(s, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
  return { ...blankAiCar(id), x: p.x, z: p.z, yaw: Math.atan2(p.tx, p.tz), vx: p.tx * v, vz: p.tz * v };
}

describe("given a hard sedan at the oval's sharpest bend (sample 112) and on the straight leading to it", () => {
  const bend = (112 / oval.path.count) * oval.path.length;
  /** The plan's speed target (m/s) for a car at the bend doing 20 m/s, at `state`'s place. */
  const cornerSpeed = (state: State): number => {
    const b = brain(oval);
    const me = onRoad(oval, 0, bend, 20);
    b.think(me, [me], state, DT);
    return b["planTarget"][0]!;
  };
  /** The distance (m) before the bend, scanning in from 60 m, at which the brain first brakes a car doing `v` m/s, at `state`'s place. */
  const onset = (v: number, state: State): number => {
    for (let d = 60; d >= 0; d -= 0.25) {
      const me = onRoad(oval, 0, bend - d, v);
      if (brain(oval).think(me, [me], state, DT).brake > 0) return d;
    }
    return Number.NaN;
  };
  /** The deceleration (m/s²) its onsets from 50 and 40 m/s imply: the corner speed drops out of the two-speed difference (`race-ai.test.ts`). */
  const planned = (state: State): number => ((50 - 1.5) ** 2 - (40 - 1.5) ** 2) / (2 * (onset(50, state) - onset(40, state)));

  it("when it leads the race, then it takes the bend at the speed it did before the race had places; when it is last, then it plans the bend at least 5 % faster", () => {
    const lead = cornerSpeed(LEAD);
    expect(lead).toBe(cornerSpeed(UNPLACED));
    const last = cornerSpeed(LAST);
    expect(last / lead, `last ${last.toFixed(2)} m/s against the leader's ${lead.toFixed(2)}`).toBeGreaterThan(1.05);
  });

  it("when it leads the race, then it plans its stop on the brake it did before; when it is last, then it plans on at least a fifth more of it (it brakes later)", () => {
    const lead = planned(LEAD);
    expect(lead).toBe(planned(UNPLACED));
    const last = planned(LAST);
    expect(last / lead, `last plans ${last.toFixed(1)} m/s², the leader ${lead.toFixed(1)}`).toBeGreaterThan(1.2);
  });
});

describe("given a racer at 18 m/s on the oval's back straight, holding the drive it planned on clear road", () => {
  const me = onRoad(oval, 0, 40, 18);
  /** The guarded drive for racer 0 at `state`'s place, with `other` in the way. */
  const guarded = (state: State, other: AiCar) => {
    const b = brain(oval);
    const far = onRoad(oval, 2, 440, 0);
    const held = idleDrive();
    copyDrive(b.think(me, [me, far], state, DT), held);
    expect(held.throttle > 0 && held.brake === 0, `the held drive is clear road: throttle ${held.throttle}, brake ${held.brake}`).toBeTruthy();
    return b.guard(me, [me, other], held);
  };
  it("when a rival stands stopped 8 m ahead on its line, then neither the leader's nor the last car's guard brakes for it, the gas stays on (owner: a stopped racer is passed, never queued behind; the plan's pass picks the lane round it)", () => {
    const stopped = onRoad(oval, 1, 48, 0);
    for (const state of [LEAD, LAST]) {
      const out = guarded(state, stopped);
      expect(out.brake === 0 && out.throttle > 0, `place ${state.place}: brake ${out.brake.toFixed(2)}, throttle ${out.throttle.toFixed(2)}`).toBeTruthy();
    }
  });
});

describe("given a last-place racer at 25 m/s on the oval's back straight, holding the drive it planned on clear road, and a rival crossing its way at a right angle 20 m ahead (0.8 s) at 25 m/s, 12 m short of the crossing (it gets there 0.32 s first)", () => {
  const me = onRoad(oval, 0, 40, 25);
  const fx = me.vx / 25;
  const fz = me.vz / 25;
  // Left of travel is (fz, −fx): the rival drives leftward across, from 12 m to the right of the crossing.
  const rival: AiCar = { ...blankAiCar(1), x: me.x + 20 * fx - 12 * fz, z: me.z + 20 * fz + 12 * fx, yaw: Math.atan2(fz, -fx), vx: 25 * fz, vz: -25 * fx };
  /** The held drive and the guarded one at `difficulty`. */
  const guarded = (difficulty: "medium" | "hard") => {
    const b = brain(oval);
    b.setDifficulty(0, difficulty);
    const held = idleDrive();
    copyDrive(b.think(me, [me, onRoad(oval, 2, 440, 0)], LAST, DT), held);
    expect(held.throttle > 0 && held.brake === 0, `the held drive is clear road: throttle ${held.throttle}, brake ${held.brake}`).toBeTruthy();
    const out = b.guard(me, [me, rival], held);
    return { stands: out.throttle === held.throttle && out.brake === held.brake && out.steer === held.steer, out: `${out.throttle} ${out.brake} ${out.steer}` };
  };
  it("when it drives at medium, then it goes for the crossing (it misjudges that it makes it), where at hard it gives way", () => {
    const medium = guarded("medium");
    expect(medium.stands, `medium: the plan stands (out ${medium.out})`).toBe(true);
    const hard = guarded("hard");
    expect(hard.stands, `hard: the guard brakes or steers clear (out ${hard.out})`).toBe(false);
  });
});
