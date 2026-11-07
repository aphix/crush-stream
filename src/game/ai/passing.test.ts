import { describe, expect, it } from "vitest";
import { Track } from "../world/track.ts";
import { parseTrack } from "../world/track-schema.ts";
import { TRACK_ID } from "../world/constants.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { DT } from "../vehicle/test-support.ts";
import { blankAiCar, type AiCar } from "./derby-ai.ts";
import { RaceBrain } from "./race-ai.ts";
import { SIGHT_MAX, visibleStretch } from "./sight.ts";
import city from "../world/tracks/city.json" with { type: "json" };

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

describe("given a racer doing 25 m/s on a straight with a side street's car crossing it 50 m ahead at 8 m/s", () => {
  /** A car `off` m to the side (+ left) of the point 50 m ahead, driving across the road toward the racer's left. */
  const crossing = (off: number): AiCar => {
    const p = road.pointAt(STRAIGHT_S + 50, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
    const yaw = Math.atan2(p.tz, -p.tx);
    return { ...blankAiCar(2), x: p.x + off * p.tz, z: p.z - off * p.tx, yaw, vx: Math.sin(yaw) * 8, vz: Math.cos(yaw) * 8, alive: true };
  };
  const cases = [
    { it: "when it gets to the crossing first (16 m off), then the racer slows to reach it only once the car is through", off: -16, yields: true },
    { it: "when it is 40 m off, so the racer is through well before it, then the racer keeps its speed", off: -40, yields: false },
    { it: "when it is already across (8 m beyond the racer's line), then the racer keeps its speed", off: 8, yields: false },
  ];
  for (const testCase of cases) {
    it(testCase.it, () => {
      const brain = think(RACER_SPEED, [crossing(testCase.off)]);
      // Through the crossing (4.5 m past where the headings meet, plus 0.5 s) at 8 m/s, the racer 45.5 m from its near edge: 15 m/s.
      if (testCase.yields) expect(follow(brain), `follows at ${follow(brain).toFixed(1)} m/s`).toBeLessThan(16);
      else expect(Number.isNaN(follow(brain)), `follow ${follow(brain).toFixed(1)}`).toBeTruthy();
    });
  }
});

describe("given a last-place racer doing 25 m/s on a straight, of 2 racers at the default slider's mild aggression, with the other racer crossing it at a right angle 10 m ahead at 25 m/s", () => {
  const p = road.pointAt(STRAIGHT_S + 10, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
  const yaw = Math.atan2(p.tz, -p.tx);
  /** The rival `off` m to the left of the crossing, driving leftward. */
  const rival = (off: number): AiCar => ({ ...blankAiCar(1), x: p.x + off * p.tz, z: p.z - off * p.tx, yaw, vx: Math.sin(yaw) * RACER_SPEED, vz: Math.cos(yaw) * RACER_SPEED, alive: true });
  /** The planned line (m) at `difficulty` after 1 s with `o` about. */
  const lineAt = (difficulty: "medium" | "hard", o: AiCar): number => {
    const brain = new RaceBrain(road, RACERS);
    brain.setAggression(0, 0.2);
    brain.setDifficulty(0, difficulty);
    const me = car(0, 0, 0, RACER_SPEED);
    for (let k = 0; k < 1 / DT; k++) brain.think(me, [me, o], { ...RACE, place: RACERS }, DT);
    return want(brain);
  };
  it("when the rival is 3 m to its right (it gets to the crossing 0.28 s first), then at hard the racer moves its line round it, and at medium it keeps the line it has with the rival already across (8 m to its left): it goes for the crossing", () => {
    const hard = lineAt("hard", rival(-3));
    expect(Math.abs(hard - lineAt("hard", rival(8))), `hard's line ${hard.toFixed(2)} m`).toBeGreaterThan(1.5);
    expect(lineAt("medium", rival(-3)), "medium's line").toBe(lineAt("medium", rival(8)));
  });
});

describe("given a racer doing 25 m/s 25 m short of the city course's first corner, a blind 90° bend", () => {
  const lineInto = (json: typeof city, traffic = true): number => {
    const track = new Track(json);
    const p = track.pointAt(10, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
    const yaw = Math.atan2(p.tx, p.tz);
    const me = { ...blankAiCar(0), x: p.x, z: p.z, yaw, vx: Math.sin(yaw) * RACER_SPEED, vz: Math.cos(yaw) * RACER_SPEED, alive: true };
    const brain = new RaceBrain(track, 1);
    // Field slots past the one racer are traffic (as `RaceField` sets it); the traffic cars are out of view.
    if (traffic) brain.guarded = 2;
    for (let k = 0; k < 1 / DT; k++) brain.think(me, [me], RACE, DT);
    return want(brain);
  };
  it("when the loop's traffic drives both ways, then its line keeps to its own half of the road, out of the oncoming lane round the bend; with one-way traffic, or no traffic in the field, it takes the apex across the middle", () => {
    const twoWay = lineInto(city);
    const oneWay = lineInto({ ...city, traffic: { ...city.traffic, lanes: city.traffic.lanes.map((lane) => ({ ...lane, dir: 1 as const })) } });
    const none = lineInto(city, false);
    expect(twoWay, `two-way line ${twoWay.toFixed(2)} m`).toBeLessThanOrEqual(-1.5);
    expect(oneWay, `one-way line ${oneWay.toFixed(2)} m`).toBeGreaterThan(0);
    expect(none, `line with no traffic in the field ${none.toFixed(2)} m`).toBeGreaterThan(0);
  });
});
