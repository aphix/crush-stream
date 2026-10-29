import { describe, expect, it } from "vitest";
import { Track } from "../world/track.ts";
import { parseTrack } from "../world/track-schema.ts";
import { TRACK_ID } from "../world/constants.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { DT } from "../vehicle/test-support.ts";
import { blankAiCar, type AiCar } from "./derby-ai.ts";
import { RaceBrain } from "./race-ai.ts";
import { SIGHT_MAX, visibleStretch } from "./sight.ts";

/** Four-Count's back straight: dead straight for over `SIGHT_MAX` m, 20 m wide, so a car `d` m down the road is `d` m down the racer's heading too. */
const road = new Track(TRACKS.find((json) => parseTrack(json).id === TRACK_ID.fourCount));
const STRAIGHT_S = 3580;
const RACE = { next: 1, lap: 0 };
const RACER_SPEED = 25;
/** The racer is car 0 of 2 racers: the cars it passes are traffic (ids from 2), all of which it keeps clear of (`guarded`). */
const RACERS = 2;
const GUARDED = 5;
/** The next lane over (m): a car's width and a hand's breadth beside another, where traffic holds a lane; a pass swings at least `MIN_SWING` of it. */
const NEXT_LANE = 3.3;
const MIN_SWING = 3;

/** A traffic car on the straight's centre line `ahead` m past the racer, `off` m left of it, doing `v` m/s along the road (negative: facing back down it). */
function car(id: number, ahead: number, off: number, v: number): AiCar {
  const p = road.pointAt(STRAIGHT_S + ahead, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
  return { ...blankAiCar(id), x: p.x + off * p.tz, z: p.z - off * p.tx, yaw: Math.atan2(p.tx, p.tz) + (v < 0 ? Math.PI : 0), vx: p.tx * v, vz: p.tz * v, alive: true };
}

/** The racer (on the straight's centre line, at `speed`) thinks for `seconds` with `others`: its brain, to read the plan. */
function think(speed: number, others: AiCar[], seconds = 1): RaceBrain {
  const brain = new RaceBrain(road, RACERS);
  brain.guarded = GUARDED;
  const me = car(0, 0, 0, speed);
  for (let k = 0; k < seconds / DT; k++) brain.think(me, [me, ...others], RACE, DT);
  return brain;
}
const want = (brain: RaceBrain): number => brain["planWant"][0]!;
const follow = (brain: RaceBrain): number => brain["planFollow"][0]!;
const target = (brain: RaceBrain): number => brain["planTarget"][0]!;
const swerves = (brain: RaceBrain, control: RaceBrain): boolean => brain["planRate"][0]! > control["planRate"][0]!;

describe("given a racer doing 25 m/s on a straight", () => {
  const control = think(RACER_SPEED, []);
  it("when the straight is the open stretch these rows assume, then the road ahead is in view", () => {
    expect(visibleStretch(road.path, STRAIGHT_S, 1)).toBeGreaterThanOrEqual(SIGHT_MAX);
  });

  const oncoming = [
    { it: "when a car comes head-on down its lane 90 m ahead (closing at 43 m/s), then it swerves to a side with room and does not slow", ahead: 90, expectedPass: true },
    { it: "when that car is 130 m ahead, farther than the 2.8 s its closing speed covers, then it has not been looked for yet and the line stays", ahead: 130, expectedPass: false },
  ];
  for (const testCase of oncoming) {
    it(testCase.it, () => {
      const brain = think(RACER_SPEED, [car(2, testCase.ahead, 0, -18)]);
      expect(Math.abs(want(brain)) >= MIN_SWING, `line ${want(brain).toFixed(2)} m against the car's lane at 0`).toBe(testCase.expectedPass);
      expect(swerves(brain, control), "quick lane change").toBe(testCase.expectedPass);
      expect(Number.isNaN(follow(brain)), "not boxed in behind it").toBeTruthy();
      expect(target(brain), `plan speed ${target(brain).toFixed(1)} m/s against ${target(control).toFixed(1)} on a clear road`).toBeGreaterThanOrEqual(target(control));
    });
  }

  it("when a car doing 15 m/s the same way is 24 m ahead in its lane, then it goes round at its own pace: a side with room, the speed not held back", () => {
    const brain = think(RACER_SPEED, [car(2, 24, 0, 15)]);
    expect(Math.abs(want(brain)), `line ${want(brain).toFixed(2)} m against the car's lane at 0`).toBeGreaterThanOrEqual(MIN_SWING);
    expect(Number.isNaN(follow(brain)), `follow ${follow(brain).toFixed(1)}: a pass that clears in time keeps its speed`).toBeTruthy();
    expect(target(brain), "plan speed").toBe(target(control));
  });
});

describe("given a racer doing 8 m/s 14 m behind a slower car (6 m/s)", () => {
  const behind = (side: number[]) => think(8, [car(2, 14, 0, 6), ...side.map((off, k) => car(3 + k, 16, off, 6))], 2);
  it("when traffic holds the lane on each side of it, then it follows at that car's pace and waits: no lane change, no stop", () => {
    const brain = behind([NEXT_LANE, -NEXT_LANE]);
    expect(Math.abs(want(brain)), `line ${want(brain).toFixed(2)} m`).toBeLessThan(MIN_SWING / 2);
    expect(follow(brain) > 6 && follow(brain) < 40, `follows at ${follow(brain).toFixed(1)} m/s`).toBeTruthy();
  });
  it("when the lane on one side is free, then it takes that side at once", () => {
    const brain = behind([NEXT_LANE]);
    expect(want(brain), `line ${want(brain).toFixed(2)} m, to the side no car holds`).toBeLessThanOrEqual(-MIN_SWING);
    expect(Number.isNaN(follow(brain)), "not held to the car's speed").toBeTruthy();
  });
});
