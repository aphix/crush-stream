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
const evades = (brain: RaceBrain): boolean => brain["planEvade"][0] === 1;

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

  const slower = [
    { who: "traffic car (id 2) doing 15 m/s", id: 2, speed: 15 },
    { who: "rival racer (id 1) doing 10 m/s", id: 1, speed: 10 },
  ];
  for (const { who, id, speed } of slower) {
    it(`when a ${who} the same way is 24 m ahead in its lane and a side is free, then it goes round at once and on the gas: a quick lane change to a side with room, the plan speed not held back, no following speed`, () => {
      const brain = think(RACER_SPEED, [car(id, 24, 0, speed)]);
      expect(Math.abs(want(brain)), `line ${want(brain).toFixed(2)} m against the car's lane at 0`).toBeGreaterThanOrEqual(MIN_SWING);
      expect(swerves(brain, control), "quick lane change").toBe(true);
      expect(evades(brain), "a pass round a car in the way is an evade (the boost stays on)").toBe(true);
      expect(Number.isNaN(follow(brain)), `follow ${follow(brain).toFixed(1)}: a free side is never followed at the car's pace`).toBeTruthy();
      expect(target(brain), "plan speed").toBe(target(control));
    });
  }
});

describe("given a racer doing 8 m/s 14 m behind a slower car (6 m/s)", () => {
  const control = think(8, []);
  const behind = (side: number[], seconds = 2, extra: AiCar[] = []) => think(8, [car(2, 14, 0, 6), ...side.map((off, k) => car(3 + k, 16, off, 6)), ...extra], seconds);
  const cases = [
    { it: "traffic holds the lane on each side of it", extra: [] as AiCar[] },
    { it: "traffic holds the lane on each side of it and a live police car is 10 m behind it and 6 m to the side", extra: [car(GUARDED, -10, 6, 8)] },
  ];
  for (const testCase of cases) {
    it(`when ${testCase.it} on a road with room beyond them, then within the first 0.2 s it takes a free line round all three, at once and on the gas (a lane change like a pass's, no following speed, no wait): no car is spared, since none is pushed through`, () => {
      const brain = behind([NEXT_LANE, -NEXT_LANE], 0.2, testCase.extra);
      expect(Math.abs(want(brain)), `line ${want(brain).toFixed(2)} m: clear of the outer cars at ${NEXT_LANE} m by the ${NEXT_LANE} m a pass needs`).toBeGreaterThanOrEqual(2 * NEXT_LANE - 0.01);
      expect(swerves(brain, control), "quick lane change").toBe(true);
      expect(evades(brain), "evading").toBe(true);
      expect(Number.isNaN(follow(brain)), `follow ${follow(brain).toFixed(1)}: not held to the car's pace`).toBeTruthy();
      const spared = brain["hitOf"][0]!;
      expect(spared[2]! + spared[3]! + spared[4]!, "no car spared: the line is free").toBe(0);
    });
  }
  it("when traffic has held both sides for 2 s, then it is still on the free line round them, never queued behind", () => {
    const brain = behind([NEXT_LANE, -NEXT_LANE]);
    expect(Math.abs(want(brain)), `line ${want(brain).toFixed(2)} m`).toBeGreaterThanOrEqual(2 * NEXT_LANE - 0.01);
    expect(Number.isNaN(follow(brain)), "never queued behind it").toBeTruthy();
  });
  const boxed = [NEXT_LANE, -NEXT_LANE, 2 * NEXT_LANE, -2 * NEXT_LANE, 8.6];
  for (const seconds of [0.2, 2]) {
    it(`when traffic holds every line across the 20 m road (cars at 0, \u00b1${NEXT_LANE}, \u00b1${2 * NEXT_LANE} and one more at +8.6 m by the left edge: no free line), then after ${seconds} s it is pushing through the biggest gap (owner: "gas it towards the biggest gap"), the line farthest from every car (2 m off the car at -${2 * NEXT_LANE} m, by the right edge), not onto a car's own line, on the gas, and the guard spares the car holding it only, not the one ahead`, () => {
      const brain = behind(boxed, seconds);
      const clear = Math.min(...[0, ...boxed].map((lat) => Math.abs(want(brain) - lat)));
      expect(clear, `line ${want(brain).toFixed(2)} m: ${clear.toFixed(2)} m from the nearest car's line`).toBeGreaterThanOrEqual(2 - 0.01);
      expect(Number.isNaN(follow(brain)), "never queued behind it").toBeTruthy();
      const spared = brain["hitOf"][0]!;
      let held = 0;
      for (let id = 3; id <= 7; id++) held += spared[id]!;
      expect(held, `spared: ${[3, 4, 5, 6, 7].map((id) => `car ${id} ${spared[id]}`).join(", ")}: the one holding the line it takes`).toBe(1);
      expect(spared[2], "the car ahead it goes round is not spared").toBe(0);
    });
  }
  it("when the lane on one side is free, then it takes that side at once", () => {
    const brain = behind([NEXT_LANE]);
    expect(want(brain), `line ${want(brain).toFixed(2)} m, to the side no car holds`).toBeLessThanOrEqual(-MIN_SWING);
    expect(Number.isNaN(follow(brain)), "not held to the car's speed").toBeTruthy();
    expect(evades(brain), "evading").toBe(true);
  });

  const blockers = [
    { who: "traffic car", id: 2 },
    { who: "rival racer", id: 1 },
  ];
  for (const { who, id } of blockers) {
    it(`when a ${who} 14 m ahead is 1 m left of the racer's line, then the line clears its lane by the 3.3 m a pass needs, to whichever side is nearer, round its predicted span and not through it`, () => {
      const brain = think(8, [car(id, 14, 1.0, 6)], 2);
      expect(Math.abs(want(brain) - 1.0), `line ${want(brain).toFixed(2)} m against the car's lane at 1.0`).toBeGreaterThanOrEqual(NEXT_LANE - 0.1);
      expect(Number.isNaN(follow(brain)), "not following").toBeTruthy();
    });
  }
  it("when a pile holds the lane slots on both sides of the car ahead (cars at 1.0, -2.3 and 4.3 m, 14 to 16 m on), then it finds the line round the whole group, 3.3 m clear of every car, in one quick lane change on the gas, and the guard spares none of them", () => {
    const brain = think(8, [car(2, 14, 1.0, 6), car(3, 16, -2.3, 6), car(4, 16, 4.3, 6)], 2);
    expect(want(brain), `line ${want(brain).toFixed(2)} m: round the group at -5.6 m`).toBeLessThanOrEqual(-5.5);
    expect(swerves(brain, control), "quick lane change").toBe(true);
    expect(Number.isNaN(follow(brain)), "not boxed in behind it").toBeTruthy();
    const spared = brain["hitOf"][0]!;
    expect(spared[2]! + spared[3]! + spared[4]!, "a free line holds no car to spare").toBe(0);
  });
  it("when cars hold the road between 5.5 m left and 6.5 m right of the racer, a gap too narrow for a pass, then the only free line is the road's left edge, 3.1 m beyond the first car, and it takes that", () => {
    const brain = think(8, [car(2, 14, 5.5, 6), car(3, 16, -0.5, 6), car(4, 16, -6.5, 6)], 2);
    expect(want(brain), `line ${want(brain).toFixed(2)} m: the left wall's room (8.6 m on this 20 m road)`).toBeGreaterThan(8);
    expect(Number.isNaN(follow(brain)), "not boxed in behind it").toBeTruthy();
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
