import { describe, expect, it } from "vitest";
import { idleDrive } from "../vehicle/car-drive.ts";
import { Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { DT } from "../vehicle/test-support.ts";
import { REVERSE_THROTTLE } from "./constants.ts";
import { blankAiCar, type AiCar } from "./derby-ai.ts";
import { RaceBrain, copyDrive } from "./race-ai.ts";
import { SIGHT_MAX, visibleStretch } from "./sight.ts";

const oval = new Track(TRACKS[0]);
const RACE = { next: 1, lap: 0 };
const RACER_SPEED = 25;

/** A car on the oval's centre line `s` m along, `off` m left of it, doing `v` m/s along the road (negative: facing back down it). */
function onRoad(id: number, s: number, off: number, v: number, alive = true): AiCar {
  const p = oval.pointAt(s, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
  const turn = v < 0 ? Math.PI : 0;
  return { ...blankAiCar(id), x: p.x + off * p.tz, z: p.z - off * p.tx, yaw: Math.atan2(p.tx, p.tz) + turn, vx: p.tx * v, vz: p.tz * v, alive };
}

/** Arc length (m) where the oval's road ahead is open for `SIGHT_MAX` m (a straight), and where it bends within 60 m (a driver there sees only what lies short of the bend). */
function firstS(open: boolean): number {
  for (let s = 0; s < oval.path.length; s += 5) {
    const seen = visibleStretch(oval.path, s, 1);
    if (open ? seen >= SIGHT_MAX : seen > 40 && seen < 60) return s;
  }
  throw new Error("no such stretch");
}

/** Thinks racer 0 (at `s`, doing `RACER_SPEED`) for `seconds`, with `others(t)` the other cars at time `t`; the brain, to read its plan. */
function think(s: number, seconds: number, others: (t: number) => AiCar[], brain = new RaceBrain(oval, 2)): RaceBrain {
  const me = onRoad(0, s, 0, RACER_SPEED);
  for (let k = 0; k < seconds / DT; k++) brain.think(me, [me, ...others(k * DT)], RACE, DT);
  return brain;
}
const skipped = (brain: RaceBrain, id: number): number => brain["hitOf"][0]![id]!;
/** Whether racer 0 has planned a swerve (its lane moves faster than on an open road) against `control`, a run with nobody about. */
const swerving = (brain: RaceBrain, control: RaceBrain): boolean => brain["planRate"][0]! > control["planRate"][0]!;

describe("given a racer doing 25 m/s on a straight with a stopped car in its lane", () => {
  const straight = firstS(true);
  const bend = firstS(false);
  const cases = [
    { it: "when the car is 20 m ahead on the open road, then it is seen and the racer plans a swerve round it", s: straight, ahead: 20, expectedMoved: true },
    { it: "when the car is round the next bend, past what the road leaves in view, then it is not seen and the racer's lane stays on its line", s: bend, ahead: visibleStretch(oval.path, bend, 1) + 25, expectedMoved: false },
  ];
  for (const testCase of cases) {
    it(testCase.it, () => {
      const control = think(testCase.s, 1, () => []);
      const brain = think(testCase.s, 1, () => [onRoad(1, testCase.s + testCase.ahead, control["planWant"][0]!, 0)]);
      expect(swerving(brain, control), "swerve planned").toBe(testCase.expectedMoved);
      expect(skipped(brain, 1), "the contact guard's skip mask").toBe(testCase.expectedMoved ? 0 : 1);
    });
  }
});

describe("given a racer doing 25 m/s on a straight and a car that comes into view after being hidden", () => {
  it("when it has been in view 0.05 s, then the racer has not noticed it; when 0.5 s, then it has", () => {
    const s = firstS(true);
    const visibleAt = 0.5;
    const seen = (afterView: number) => skipped(think(s, visibleAt + afterView, (t) => [onRoad(1, s + (t < visibleAt ? 300 : 70), 0, 0)]), 1);
    expect(seen(0.05), "0.05 s after it came into view").toBe(1);
    expect(seen(0.5), "0.5 s after it came into view").toBe(0);
  });
});

describe("given a racer at 25 m/s whose contact guard sees a stopped car 14 m ahead on its line", () => {
  const s = firstS(true);
  /** The guarded drive of racer 0 (of `racers` racers: car 1 is a racer when 2, a police car when 1) with car 1 stopped ahead. */
  const guarded = (racers: number, alive: boolean) => {
    const brain = new RaceBrain(oval, racers);
    const me = onRoad(0, s, 0, RACER_SPEED);
    const others = [me, onRoad(1, s + 14, 0, 0, alive)];
    const held = idleDrive();
    for (let k = 0; k < 4; k++) copyDrive(brain.think(me, others, RACE, DT), held);
    return brain.guard(me, others, held, DT);
  };
  const cases = [
    { it: "when it is another racer, then the guard brakes", racers: 2, alive: true, expectedBraking: true },
    { it: "when it is a police car (live, stopped), then the guard only steers: it is passed at speed, never braked for", racers: 1, alive: true, expectedBraking: false },
    { it: "when it is a dead police car, then the guard only steers", racers: 1, alive: false, expectedBraking: false },
  ];
  for (const testCase of cases) {
    it(testCase.it, () => {
      const out = guarded(testCase.racers, testCase.alive);
      expect(out.brake > 0, `brake ${out.brake.toFixed(2)}`).toBe(testCase.expectedBraking);
    });
  }
});

describe("given a racer crawling at 1.6 m/s with its throttle down", () => {
  const s = firstS(true);
  const crawl = (nose: boolean) => {
    const brain = new RaceBrain(oval, 2);
    const me = onRoad(0, s, 0, 1.6);
    let lowest = 0;
    for (let k = 0; k < 2 / DT; k++) {
      const out = brain.think(me, nose ? [me, onRoad(1, s + 4, 0, -0.2)] : [me], RACE, DT);
      lowest = Math.min(lowest, out.throttle);
    }
    return lowest;
  };
  it("when a car faces it 4 m ahead, then it backs off to go round (reverses within 2 s); with nothing on its nose it drives on", () => {
    expect(crawl(true), "nose to nose").toBe(REVERSE_THROTTLE);
    expect(crawl(false), "nothing in the way").toBeGreaterThanOrEqual(0);
  });
});
