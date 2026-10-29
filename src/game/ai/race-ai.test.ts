import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BOOST } from "../vehicle/car-drive.ts";
import { applyDrive, idleDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { classStats } from "../vehicle/vehicle-classes.ts";
import { fleetStyle } from "../scenes/fleet.ts";
import { setGround } from "../world/ground.ts";
import { blankAiCar, type AiCar } from "./derby-ai.ts";
import { BRAKE_SHARE, RaceBrain, copyDrive } from "./race-ai.ts";
import { race, raced, summarize } from "./race-ai.test-util.ts";
import { AI_DIFFICULTIES, AI_EVERY_SLICE, GUARD_BRAKE_IDX, GUARD_LEAD_IDX, SLIP_RECOVER, SLIP_WINDOW, type AiDifficulty } from "./constants.ts";
import { fieldAggression, mood } from "./ai-aggression.ts";
import { Track } from "../world/track.ts";
import { parseTrack } from "../world/track-schema.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { assertSameNumbers, DT } from "../vehicle/test-support.ts";

const at = (id: number, x: number, z: number, vz: number): AiCar => ({ ...blankAiCar(id), x, z, vz });
const oval = new Track(TRACKS[0]);

const f64 = new Float64Array(5);
const bits = new Uint32Array(f64.buffer);
/** FNV-1a over the bits of one brain output: any change to any float, however small, changes it. */
function fold(h: number, o: DriveInput): number {
  f64.set([o.throttle, o.steer, o.brake, o.boost ? 1 : 0, o.ebrake ? 1 : 0]);
  for (let k = 0; k < bits.length; k++) h = Math.imul(h ^ bits[k]!, 16777619) >>> 0;
  return h;
}
/** A hard brain's output, hashed over each of 8 cars' first 300 and first 600 thinks: marks[2 * car] and marks[2 * car + 1]. */
function hardMarks(track: Track): string[] {
  const hash = new Uint32Array(8).fill(2166136261);
  const count = new Int32Array(8);
  const marks: string[] = [];
  race(track, 8, 0, 3, 20, "hard", (id, out) => {
    if (count[id]! >= 600) return;
    hash[id] = fold(hash[id]!, out);
    if (++count[id]! % 300 === 0) marks[2 * id + count[id]! / 300 - 1] = hash[id]!.toString(16);
  });
  return marks;
}
/**
 * `hardMarks` of the hard brain driving the 8 cars from the grid: the tiers must leave hard's outputs bit for bit as they were. The marks hash those
 * outputs along a real drive, so a change to the drive under the brain re-pins them; these are the marks on the constant-power drive with the
 * traction cap and rolling resistance (the brain was not touched by it beyond planning with the surface's terminal), re-pinned when the plan's braking went from 0.5 to the guard's
 * 0.72 of the class brake (`BRAKE_SHARE`: the plan's decel is what moved, so the brake and throttle outputs hash differently), the guard took a car ahead to shed the
 * whole class brake, and the harness began to give each car its class (`setClass`: the mix of fleet styles plans with its own figures, as the game does), and re-pinned when the contact guard's push and braking demand began to be held and released over time instead of coming and going with the contact on its 0.1 s look-ahead grid (`contact-guard.ts` `PUSH_RELEASE_S`: a bug fix, the racer's wheel reversed 32 times a second on a grazing contact),
 * and when every AI's wheel was held to a pad player's 12 of lock a second (`applyAiDrive`, which the harness drives through as the game does) and the guard's push kept its side on a contact near the path's centre (`SIDE_BAND`): bug fixes, AI wheels flipped full lock in a step;
 * and when that side was kept only while the guard steers clear, not while it brakes: a bug fix, the push steered toward a car crossing the centre line,
 * and when every style's cabin cages came from its own panels (the fleet's hatchback, wagon, coupe and pickup meet each other on new contact shapes),
 * and when a tyre in its springs on a slope began to be pulled down it by the weight it carries, at any slope (a coasting or driven car on rally's and stunt's grades met a different pull; oval is flat and keeps its marks),
 * and when a coasting car's rigid tyre rows' straight-up lift came off its plan speed instead of adding to it (stunt's cars 0 and 1 between thinks 300 and 600: 6c1aa909 -> 480dfde1 and 27444265 -> 1bbd006a; the other 14 marks, and oval's and rally's, stand),
 * and when the pull down a face became the plan part of each tyre's real load (the spring's push over the face's normal, not a fixed share of the weight): every rally and stunt mark changes (a loaded bank and a crest read their own load), oval is flat and keeps its marks,
 * and when a rigid tread on the world's ground began to push along the face's normal, not straight up (stunt's cars 0 to 7 between thinks 300 and 600, 9 of its 16 marks: its kicker and crests meet the normal's plan push; oval's and rally's stand),
 * and when the contact guard's arc was held to the yaw rate the tyres give (`GUARD_GRIP_IDX`: grip / speed, as `applyDrive` caps it) and began to count a stopped car lying across the way at its true reach (rally's cars 1 to 7 and stunt's 3 to 7 between thinks 300 and 600: the cars that meet traffic; oval's marks stand).
 */
const HARD_MARKS: Record<string, string[]> = {
  oval: ["e9df8473", "7e9593ab", "6b5fc308", "9be8ec8e", "1da391b9", "15cb62d5", "b81974e2", "f9f01605", "1eb60b86", "92a70774", "5aed2cd0", "ccaba551", "c3295f1d", "cd39d90a", "7cb6e26c", "52acf03f"],
  rally: ["91996808", "275c4c87", "67b6acec", "11693bb", "e3754e83", "5156843b", "9249d068", "ec6998a4", "fff59221", "6d696987", "a0554cfe", "bb3c5113", "b8c140d", "a77c0348", "c3de18f", "faa65b07"],
  stunt: ["10806970", "5d6c0a38", "1437e3fe", "5252720a", "258a4215", "b2a128c8", "fd72ae50", "45f7eca6", "bb9a8610", "c2e3138b", "614dbfdd", "cf40067b", "39fef24f", "890af02a", "33160d2d", "c4f91e59"],
};

describe("given 8 clean AI cars (aggression 0) on the grid of the oval", () => {
  for (const difficulty of AI_DIFFICULTIES) {
    it(`when they race 3 laps at ${difficulty} difficulty, then all 8 finish, they stay on the road at least 95% of the time, and the winner finishes within the time bound`, (t) => {
      const r = raced(oval, difficulty);
      t.annotate(`${oval.id} ${difficulty}: winner ${r.winner.toFixed(1)} s, best lap ${Math.min(...r.lapTimes).toFixed(2)} s, slowest lap ${Math.max(...r.lapTimes).toFixed(2)} s, on road ${(100 * r.share).toFixed(1)}%, mistakes ${r.mistakes}`);
      expect(r.finished, `finished ${r.finished}/8 by ${r.time.toFixed(0)} s (bound ${r.limit.toFixed(0)} s); laps ${r.laps}`).toBe(8);
      expect(r.share, `on the road ${(r.share * 100).toFixed(1)}% of ${r.samples} samples`).toBeGreaterThanOrEqual(0.95);
      expect(r.winner).toBeLessThan(r.limit);
    });
  }

  it("when easy races hard, then easy's winner is at least 8% slower, and medium's is faster than easy's", () => {
    const [e, m, h] = AI_DIFFICULTIES.map((d) => raced(oval, d).winner);
    expect(e! > h! && m! < e!, `winner easy ${e!.toFixed(1)} s, medium ${m!.toFixed(1)} s, hard ${h!.toFixed(1)} s`).toBeTruthy();
    expect(e! / h!, `easy takes ${((e! / h! - 1) * 100).toFixed(1)}% longer than hard`).toBeGreaterThanOrEqual(1.08);
  });

  it("when they race 3 laps, then easy makes mistakes and hard makes exactly none", () => {
    expect(raced(oval, "easy").mistakes, "easy made no mistake").toBeGreaterThan(0);
    expect(raced(oval, "hard").mistakes).toBe(0);
  });
});

describe("given the same 8 easy AI cars raced twice from the grid of the oval", () => {
  it("when both runs finish, then every car's lap times are identical, to the bit (slips and sway are seeded, not random)", () => {
    const once = raced(oval, "easy");
    const again = summarize(oval, "easy");
    expect(once.mistakes, "a run with no mistakes proves nothing about their seeding").toBeGreaterThan(0);
    assertSameNumbers(again.lapTimes, once.lapTimes, "lap times, run twice");
    expect(again.mistakes).toBe(once.mistakes);
  });
});

describe("given a stale medium driver holding its last drive between thinks, with a stopped car 8 m ahead of it at 17 m/s", () => {
  it("when the slice's contact guard reads the held drive, then it brakes where the held input drove on, and a hard (every-slice) brain's guard leaves the drive it was given", () => {
    const me = at(0, pt.x, pt.z, 17);
    const parked = at(1, pt.x, pt.z + 8, 0);
    const far = at(1, pt.x, pt.z - 400, 0);
    const clear = (difficulty: AiDifficulty) => {
      const brain = new RaceBrain(oval, 2);
      brain.setDifficulty(0, difficulty);
      const held = idleDrive();
      copyDrive(brain.think(me, [me, far], { next: 1, lap: 0 }, DT), held);
      return { brain, held };
    };
    const medium = clear("medium");
    expect(medium.held.throttle > 0 && medium.held.brake === 0, `the held drive is clear road: throttle ${medium.held.throttle}, brake ${medium.held.brake}`).toBeTruthy();
    const guarded = medium.brain.guard(me, [me, parked], medium.held);
    expect(guarded.brake > 0 && guarded.throttle === 0, `guard brakes for the stopped car: brake ${guarded.brake.toFixed(2)}, throttle ${guarded.throttle.toFixed(2)}`).toBeTruthy();
    const hard = clear(AI_EVERY_SLICE);
    expect(hard.brain.guard(me, [me, parked], hard.held), "a hard brain guarded inside think, so its guard hands the drive back").toBe(hard.held);
  });
});

describe("given a hard brain driving 8 cars from the grid of a course", () => {
  for (const [id, expected] of Object.entries(HARD_MARKS)) {
    it(`when each thinks 600 times on ${id}, then every checkpoint of its output is bit for bit what it was before the tiers existed`, () => {
      const got = hardMarks(new Track(TRACKS.find((j) => parseTrack(j).id === id)!));
      const first = got.findIndex((m, k) => m !== expected[k]);
      expect(first < 0 && got.length === expected.length, `${got.length}/${expected.length} checkpoints, first differing: ${first} (car ${first >> 1}, think ${first % 2 ? 600 : 300})`).toBeTruthy();
    });
  }
});

const s0 = 40;
const lane = (brain: RaceBrain, self: AiCar, others: AiCar[], steps: number) => {
  let steer = 0;
  for (let k = 0; k < steps; k++) steer = brain.think(self, others, { next: 1, lap: 0 }, DT).steer;
  return steer;
};
const pt = oval.pointAt(s0, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
/** A car on `track`'s centre line `s` m along, `off` m to the left of it (+), doing `v` m/s along the road. */
const onRoad = (track: Track, id: number, s: number, off: number, v: number): AiCar => {
  const p = track.pointAt(s, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
  return { ...blankAiCar(id), x: p.x + off * p.tz, z: p.z - off * p.tx, yaw: Math.atan2(p.tx, p.tz), vx: p.tx * v, vz: p.tz * v };
};

describe("given AI drivers at about 17 m/s on the oval course's back straight, with another car close by", () => {
  it("when a slower car is ahead on its line near the left edge, so the only pass is to the right, then a clean driver pulls right to pass while an aggressive one stays on the slow car's line, keeping the throttle in to ram it", () => {
    // Back straight runs +Z at x = −55: left of travel is +X. Both near the left edge, so the only pass is to the right.
    const me = at(0, pt.x + 6, pt.z, 17);
    const slow = at(1, pt.x + 6, pt.z + 9, 8);
    const clean = new RaceBrain(oval, 2);
    const passing = lane(clean, me, [me, slow], 40);
    const brute = new RaceBrain(oval, 2);
    brute.setAggression(0, 1);
    const ramming = lane(brute, me, [me, slow], 40);
    expect(passing, `clean pulls right to pass, steer ${passing.toFixed(3)}`).toBeLessThan(-0.05);
    expect(Math.abs(ramming) < 0.06 && Math.abs(ramming) < Math.abs(passing) / 3, `aggressive stays on the slow car's line, steer ${ramming.toFixed(3)} vs clean ${passing.toFixed(3)}`).toBeTruthy();
    const charge = brute.think(me, [me, slow], { next: 1, lap: 0 }, DT);
    expect(charge.throttle > 0 && charge.brake === 0, "and keeps the throttle in").toBeTruthy();
  });

  it("when a faster car comes through just behind on its left, then an aggressive driver steers left into its path to close the door and a clean one moves away to give it room", () => {
    const me = at(0, pt.x, pt.z, 12);
    const fast = at(1, pt.x + 3, pt.z - 5, 18);
    const clean = new RaceBrain(oval, 2);
    const brute = new RaceBrain(oval, 2);
    brute.setAggression(0, 1);
    const yields = lane(clean, me, [me, fast], 40);
    const blocks = lane(brute, me, [me, fast], 40);
    expect(blocks, `aggressive steers into its path (left is +), steer ${blocks.toFixed(3)}`).toBeGreaterThan(0.02);
    expect(yields, `clean moves away from it, steer ${yields.toFixed(3)}`).toBeLessThan(-0.02);
  });

  it("when a rival ahead is closed on at a ram's speed (9 m/s) or a nudge's (1 m/s), then a middling driver passes the rammable car, wrecked or not, and pushes the nudge-speed one unless it is itself the more wrecked car, while a full-aggression driver rams regardless of its own state", () => {
    const me = at(0, pt.x + 6, pt.z, 17);
    const mid = () => {
      const b = new RaceBrain(oval, 2);
      b.setAggression(0, 0.5);
      return b;
    };
    // A rival 9 m ahead doing 8 m/s is a ram (closing 9 m/s): passed, wrecked or not. One doing 16 m/s is a nudge (1 m/s): pushed.
    const slow = at(1, pt.x + 6, pt.z + 9, 8);
    const pace = at(1, pt.x + 6, pt.z + 9, 16);
    expect(lane(mid(), me, [me, slow], 40), "passes the slow car it would ram").toBeLessThan(-0.05);
    expect(lane(mid(), me, [me, { ...slow, damage: 0.6 }], 40), "and a wrecked one too").toBeLessThan(-0.05);
    expect(Math.abs(lane(mid(), me, [me, pace], 40)), "pushes the one it closes on at a nudge").toBeLessThan(0.06);
    const hurtMe = { ...me, damage: 0.8 };
    expect(lane(mid(), hurtMe, [hurtMe, { ...pace, damage: 0.6 }], 40), "but not when it is the more wrecked of the two").toBeLessThan(-0.05);
    const brute = new RaceBrain(oval, 2);
    brute.setAggression(0, 1);
    expect(Math.abs(lane(brute, hurtMe, [hurtMe, slow], 40)), "full aggression rams regardless of its own state").toBeLessThan(0.06);
  });

  it("when a rival is abreast 2.6 m to its left, then a clean driver steers away, a full-aggression driver always shoves, and a middling one shoves only a safe rival: not one 1.5 m off the wall, not at a ram's closing speed, not over the stunt course's crest", () => {
    const stunt = new Track(TRACKS.find((j) => parseTrack(j).id === "stunt"));
    // `me` abreast of a rival 2.6 m to its left (+) on `track` at `s`, doing `my` and `its` m/s, the rival `lean` m left of the road's middle: the steer after a second.
    // A middling driver's shove swings over gently (0.5 m/s: the two close at a nudge), so its steer stays about level where a clean driver's goes away.
    const abreast = (aggression: number, track: Track, s: number, lean: number, my = 15, its = 15) => {
      const b = new RaceBrain(track, 2);
      b.setAggression(0, aggression);
      const self = onRoad(track, 0, s, lean - 2.6, my);
      return lane(b, self, [self, onRoad(track, 1, s + 0.5, lean, its)], 60);
    };
    const edge = pt.half - 1.5;
    expect(abreast(0, oval, s0, 1.3), "a clean driver steers away").toBeLessThan(-0.05);
    expect(abreast(1, oval, s0, 1.3), "a full one shoves").toBeGreaterThan(0.15);
    expect(abreast(0.5, oval, s0, 1.3), "a middling one shoves a rival mid-road, level").toBeGreaterThan(0);
    expect(abreast(0.5, oval, s0, edge), "but not one 1.5 m off the wall it would be pushed into").toBeLessThan(-0.05);
    expect(abreast(1, oval, s0, edge), "where a full driver shoves regardless").toBeGreaterThan(0.15);
    expect(abreast(0.5, oval, s0, 1.3, 15, 12), "nor closing on it at 3 m/s").toBeLessThan(-0.05);
    expect(abreast(0.5, oval, s0, 1.3, 12, 15), "nor with the rival the faster by 3 m/s").toBeLessThan(-0.05);
    expect(abreast(0.5, stunt, 300, 1.3, 20, 20), "on level road at 20 m/s it shoves").toBeGreaterThan(0.1);
    expect(abreast(0.5, stunt, 899.5, 1.3, 20, 20), "the same pair on the stunt course's crest (a car leaves it above 17 m/s): it keeps off").toBeLessThan(-0.05);
    expect(abreast(1, stunt, 899.5, 1.3, 20, 20), "and a full driver shoves there regardless").toBeGreaterThan(0.1);
  });

  it("when a rival 6 m ahead drives at the driver's own 17 m/s pace, then a clean driver brakes to keep a gap without boosting, and a hungry one boosts to catch it", () => {
    const me = at(0, pt.x, pt.z, 17);
    const rival = at(1, pt.x, pt.z + 6, 17);
    const clean = new RaceBrain(oval, 2).think(me, [me, rival], { next: 1, lap: 0 }, DT);
    expect(!clean.boost && clean.brake > 0, `clean opens the gap: brake ${clean.brake.toFixed(2)}, boost ${clean.boost}`).toBeTruthy();
    const brute = new RaceBrain(oval, 2);
    brute.setAggression(0, 1);
    const hunt = brute.think(me, [me, rival], { next: 1, lap: 0 }, DT);
    expect(hunt.boost && hunt.throttle > 0, `hungry boosts into it: throttle ${hunt.throttle.toFixed(2)}, boost ${hunt.boost}`).toBeTruthy();
  });

  it("when a rival is 2.6 m to its left at 15 m/s, then a hungry driver steers left into it and a clean one steers away, and at a 2 m/s crawl a hungry driver steers the same as if it were alone", () => {
    // Left of travel is +X on this straight: the rival sits on our left.
    const me = at(0, pt.x, pt.z, 15);
    const rival = at(1, pt.x + 2.6, pt.z + 0.5, 15);
    const brute = new RaceBrain(oval, 2);
    brute.setAggression(0, 1);
    const shove = lane(brute, me, [me, rival], 20);
    const shy = lane(new RaceBrain(oval, 2), me, [me, rival], 20);
    expect(shove, `hungry steers left into it, steer ${shove.toFixed(3)}`).toBeGreaterThan(0.05);
    expect(shy, `clean steers away, steer ${shy.toFixed(3)}`).toBeLessThan(-0.02);
    const slowMe = at(0, pt.x, pt.z, 2);
    const slowRival = at(1, pt.x + 2.6, pt.z + 0.5, 2);
    const hungry = () => {
      const b = new RaceBrain(oval, 2);
      b.setAggression(0, 1);
      return b;
    };
    const withRival = lane(hungry(), slowMe, [slowMe, slowRival], 20);
    const alone = lane(hungry(), slowMe, [slowMe], 20);
    expect(Math.abs(withRival - alone), `at a crawl it drives its line as if alone (two hungry cars wedged each other on a wall): ${withRival.toFixed(3)} vs ${alone.toFixed(3)}`).toBeLessThan(0.01);
  });

  it("when a driver crawling at 2 m/s comes up on a parked car 5.5 m ahead, then it keeps rolling without braking and steers round it", () => {
    const me = at(0, pt.x, pt.z, 2);
    const parked = at(1, pt.x, pt.z + 5.5, 0);
    const out = new RaceBrain(oval, 2).think(me, [me, parked], { next: 1, lap: 0 }, DT);
    expect(out.throttle > 0 && out.brake === 0, `keeps rolling: throttle ${out.throttle.toFixed(2)}, brake ${out.brake.toFixed(2)}`).toBeTruthy();
    expect(Math.abs(lane(new RaceBrain(oval, 2), me, [me, parked], 40)), "and steers round it").toBeGreaterThan(0.05);
  });
});

describe("given the field's aggression slider (the most aggressive any rival may be)", () => {
  it("when 15 rivals roll their own values under a slider of 0.6, then each is between 0 and 0.6 with a real spread, the same seed gives the same field, a new race rolls again, a slider of 0 gives all 0, and the mood to hit is negative at aggression 0 and positive at full aggression", () => {
    const rolls = Array.from({ length: 15 }, (_, id) => fieldAggression(0.6, 4, id + 1));
    expect(rolls.every((a) => a >= 0 && a <= 0.6)).toBeTruthy();
    expect(Math.max(...rolls) - Math.min(...rolls), "a spread, not one value").toBeGreaterThan(0.3);
    assertSameNumbers(rolls, Array.from({ length: 15 }, (_, id) => fieldAggression(0.6, 4, id + 1)), "same seed, same field");
    const reroll = Array.from({ length: 15 }, (_, id) => fieldAggression(0.6, 5, id + 1));
    expect(reroll.some((a, i) => a !== rolls[i]), "a new race rolls again").toBeTruthy();
    expect(Array.from({ length: 15 }, (_, id) => fieldAggression(0, 4, id)).every((a) => a === 0)).toBeTruthy();
    expect(mood(0, 0, 1) < 0 && mood(1, 1, 0) > 0).toBeTruthy();
  });
});

describe("given an AI driver at 17 m/s alone on a clear straight with a full boost meter", () => {
  it("when it drives for 10 s, then it boosts in bursts no longer than a full meter and in total no more than a full meter plus what the meter refills over the run", () => {
    const me = at(0, pt.x, pt.z, 17);
    const brain = new RaceBrain(oval, 1);
    const T = 10;
    let boosted = 0;
    let run = 0;
    let longest = 0;
    for (let k = 0; k < T / DT; k++) {
      const b = brain.think(me, [me], { next: 1, lap: 0 }, DT).boost;
      boosted += b ? DT : 0;
      run = b ? run + DT : 0;
      longest = Math.max(longest, run);
    }
    expect(longest, `first burst ${longest.toFixed(2)} s`).toBeGreaterThanOrEqual(BOOST.full - 2 * DT);
    expect(longest, `one burst ${longest.toFixed(2)} s, a full meter is ${BOOST.full} s`).toBeLessThanOrEqual(BOOST.full + DT);
    // A full meter plus what it refills over the run.
    const budget = BOOST.full + (T * BOOST.full) / BOOST.recharge;
    expect(boosted, `boosted ${boosted.toFixed(2)} s of ${T} s, budget ${budget.toFixed(2)} s`).toBeLessThanOrEqual(budget + DT);
  });
});

describe("given a road only 6 m wide with a driver at 15 m/s coming up on a 6 m/s car 7 m ahead", () => {
  it("when the driver reaches it, then it brakes with the throttle off and follows instead of passing", () => {
    const narrow = new Track({ ...(TRACKS[0] as object), road: { width: 6, runoff: [3, 3], surface: "asphalt", runoffSurface: "concrete" } });
    const p = narrow.pointAt(s0, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
    const me = at(0, p.x, p.z, 15);
    const slow = at(1, p.x, p.z + 7, 6);
    const brain = new RaceBrain(narrow, 2);
    const out = brain.think(me, [me, slow], { next: 1, lap: 0 }, DT);
    expect(out.brake > 0 && out.throttle === 0, `brake ${out.brake} throttle ${out.throttle}`).toBeTruthy();
  });
});

describe("given an AI driver at 30 m/s on the oval's back straight, alone, its nose 0.6 rad off the road's heading toward the left edge", () => {
  it("when it is 1 m past the left edge, so steering back onto its line asks for more than full lock off the road, then it brakes with the throttle off; and on the road's centre line, pointed the same way, it keeps the throttle on", () => {
    // Of the two headings 0.6 rad off the road's, the one with a component along the road's left (tz, -tx).
    const roadYaw = Math.atan2(pt.tx, pt.tz);
    const yaw = Math.sin(roadYaw + 0.6) * pt.tz - Math.cos(roadYaw + 0.6) * pt.tx > 0 ? roadYaw + 0.6 : roadYaw - 0.6;
    const pointedOut = (off: number): AiCar => ({ ...onRoad(oval, 0, s0, off, 0), yaw, vx: 30 * Math.sin(yaw), vz: 30 * Math.cos(yaw) });
    const offRoad = pointedOut(pt.half + 1);
    const wide = new RaceBrain(oval, 1).think(offRoad, [offRoad], { next: 1, lap: 0 }, DT);
    expect(wide.brake > 0 && wide.throttle === 0, `off the road: brake ${wide.brake} throttle ${wide.throttle}`).toBeTruthy();
    const centred = pointedOut(0);
    const onLine = new RaceBrain(oval, 1).think(centred, [centred], { next: 1, lap: 0 }, DT);
    expect(onLine.throttle > 0 && onLine.brake === 0, `on the road: brake ${onLine.brake} throttle ${onLine.throttle}`).toBeTruthy();
  });
});

describe("given an easy driver whose slip starts on the oval's open road, then held in traffic past the slip's whole length", () => {
  it("when the road clears, then its slip timer has run out and it plans unshaken top speed, not `shaken` x top", () => {
    const brain = new RaceBrain(oval, 2);
    brain.setDifficulty(0, "easy");
    brain["slipP"][0] = 1;
    const race = { next: 1, lap: 0 };
    const slip = onRoad(oval, 0, 70, 0, 17);
    brain.think(slip, [slip], race, DT);
    expect(brain["slip"][0], "a corner on an open road started the slip").toBe(SLIP_WINDOW + SLIP_RECOVER);
    // On the back straight (no corner in the plan), an 8 m/s car 9 m ahead on its line: it follows, so the road is not open.
    const me = onRoad(oval, 0, 340, 0, 17);
    const slow = onRoad(oval, 1, 349, 0, 8);
    for (let k = 0; k < Math.ceil((SLIP_WINDOW + SLIP_RECOVER + 1) / DT); k++) brain.think(me, [me, slow], race, DT);
    expect(brain["busy"][0], "the slow car held it in traffic").toBe(1);
    const out = brain.think(me, [me], race, DT);
    expect(brain["busy"][0], "the road cleared").toBe(0);
    expect(brain["slip"][0], "the slip aged out in traffic").toBe(0);
    expect(out.throttle === 1 && out.brake === 0, `unshaken: throttle ${out.throttle} brake ${out.brake}`).toBeTruthy();
  });
});

/** The deceleration (m/s²) a sedan really sheds at full brake from `v` m/s on the oval's back straight, over one second: the drive model's own. */
function realBrake(v: number): number {
  setGround(oval.ground());
  const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: "brake" }, new THREE.Scene(), null, fleetStyle(0));
  car.spawnFacing(pt.x, pt.z, Math.atan2(pt.tx, pt.tz), v);
  const full = { ...idleDrive(), brake: 1 };
  let t = 0;
  for (; t < 1 - 1e-9; t += DT) {
    applyDrive(car, full, DT);
    car.integrate(DT);
  }
  setGround(null);
  return (v - Math.hypot(car.velocity.x, car.velocity.z)) / t;
}

describe("given a hard sedan brain flat out at the oval's sharpest bend (33 m/s there) on the back straight leading to it", () => {
  // The bend is sample 112 of the path; a car at the planned speed's edge (`err` -1.5 m/s) is the first to brake: its distance to the bend is the stop distance.
  const bend = (112 / oval.path.count) * oval.path.length;
  /** The distance (m) before the bend, scanning in from 60 m (the road before that is other bends), at which the brain first brakes a car doing `v` m/s down the road's centre. */
  const onset = (v: number): number => {
    const brain = new RaceBrain(oval, 1);
    for (let d = 60; d >= 0; d -= 0.25) {
      const me = onRoad(oval, 0, bend - d, 0, v);
      if (brain.think(me, [me], { next: 1, lap: 0 }, DT).brake > 0) return d;
    }
    return NaN;
  };
  it("when it brakes from 50 and from 40 m/s, then the braking its onset distances imply is the share of the class brake the contact guard counts on, and a real car's full brake is more than that by the measured margin", (t) => {
    const sedan = classStats("sedan");
    // v² - vc² = 2 a d for both onsets (a car 1.5 m/s over the plan brakes): the corner speed drops out of the two-speed difference.
    const [far, near] = [onset(50), onset(40)];
    const planned = ((50 - 1.5) ** 2 - (40 - 1.5) ** 2) / (2 * (far - near));
    const real = realBrake(40);
    const brain = new RaceBrain(oval, 1);
    const me = onRoad(oval, 0, 40, 0, 17);
    brain.think(me, [me], { next: 1, lap: 0 }, DT);
    const tune = brain["tunes"][0]!;
    const want = sedan.brake * BRAKE_SHARE;
    t.annotate(`onsets ${far.toFixed(1)} m / ${near.toFixed(1)} m: plan sheds ${planned.toFixed(1)} m/s², guard ${tune[GUARD_BRAKE_IDX]!.toFixed(1)} m/s², a car ahead ${tune[GUARD_LEAD_IDX]!.toFixed(1)} m/s², real full brake ${real.toFixed(1)} m/s²`);
    expect(tune[GUARD_BRAKE_IDX], "the guard's own braking").toBe(want);
    expect(tune[GUARD_LEAD_IDX], "what a car ahead is taken to shed: the whole class brake, the most it can (the guard never counts on a leader stopping gentler than it can)").toBe(sedan.brake);
    // The onsets are found to 0.25 m but the plan reads the road every 3 m: against the 23 m the two speeds' stops differ by (measured) a 3 m step is 13 % of it, so 15 % is the least the reading can be trusted to; the old 0.5 share reads 14.0 m/s², 31 % under.
    expect(Math.abs(planned / want - 1), `the plan sheds ${planned.toFixed(1)} m/s², the guard counts on ${want.toFixed(1)}`).toBeLessThan(0.15);
    // The share is of what the car really sheds: full brake measures the class brake (28 m/s² for the sedan) within 5 %, so the plan asks for less than the car has by about the share.
    expect(Math.abs(real / sedan.brake - 1) < 0.05 && planned < real, `real full brake ${real.toFixed(1)} m/s² of the class's ${sedan.brake}, the plan ${planned.toFixed(1)}`).toBeTruthy();
  });
});

describe("given a racer on the oval's back straight with a car 12 m ahead at 2.3 m left of the centre line and a faster car 10 m behind, whose yield nudge pushes the planned lane to the narrow (left) side", () => {
  /** The lateral target (m, + = left) `line` picks for racer 0 doing 15 m/s with the blocker doing `blockerSpeed` m/s along the road (negative: oncoming). */
  const chosen = (blockerSpeed: number): { want: number; room: number } => {
    const brain = new RaceBrain(oval, 3);
    brain["traits"][0] = { ...brain["traits"][0]!, side: 1 };
    const me = onRoad(oval, 0, s0, 0, 15);
    const cars = [me, onRoad(oval, 1, s0 + 12, 2.3, blockerSpeed), onRoad(oval, 2, s0 - 10, 0, 25)];
    brain.think(me, cars, { next: 1, lap: 0 }, DT);
    return { want: brain["line"](me, brain["traits"][0]!, cars), room: pt.half - 1.4 };
  };
  it("when the blocker is stopped, or oncoming at 10 m/s, then the racer rounds it on the side with more road (right: the blocker's lane less the 3.3 m a pass needs), not the narrow one the nudge points at", () => {
    for (const speed of [0, -10]) {
      const { want } = chosen(speed);
      expect(want < -1 && want > -1.5, `blocker doing ${speed} m/s: chose ${want.toFixed(2)} m, the wide side is about -1.2 m (right of the centre line), the narrow one 5.4 m`).toBeTruthy();
    }
  });
  it("when the blocker moves with it at 8 m/s, then the pass is unchanged: the side nearest the planned lane (left, with the nudge)", () => {
    const { want, room } = chosen(8);
    expect(want > 5 && want <= room, `chose ${want.toFixed(2)} m, the left pass is about 5.4 m (room ${room.toFixed(1)} m)`).toBeTruthy();
  });
});

describe("given an every-slice brain whose contact guard runs after its think (`guardLate`, as the engine runs it) with a car 10 m or 14 m ahead of it at 28 m/s on a boost it wants", () => {
  /** The oval at 100 m round, the brain's car doing 28 m/s along it with a car `gap` m ahead; 20 steps of think and guard. */
  function steps(gap: number, late: boolean): { out: DriveInput; meter: number } {
    const brain = new RaceBrain(oval, 2);
    brain.guardLate = late;
    brain.setDifficulty(0, AI_EVERY_SLICE);
    brain.setAggression(0, 1);
    const p = oval.pointAt(100, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
    const me = { ...blankAiCar(0), x: p.x, z: p.z, yaw: Math.atan2(p.tx, p.tz), vx: p.tx * 28, vz: p.tz * 28 };
    const all = [me, { ...blankAiCar(1), x: p.x + p.tx * gap, z: p.z + p.tz * gap, yaw: me.yaw }];
    const held = idleDrive();
    let out = held;
    for (let k = 0; k < 20; k++) {
      copyDrive(brain.think(me, all, { next: 1, lap: 0 }, DT), held);
      out = late ? brain.guard(me, all, held, DT) : held;
    }
    return { out: { ...out }, meter: brain.meter[0]! };
  }

  it("when the guard cancels the boost and the throttle, then the boost meter is as full as with the guard inside think: a boost never used is never drained", () => {
    for (const gap of [10, 14]) {
      const inside = steps(gap, false);
      const late = steps(gap, true);
      expect(inside.out.brake > 0.5 && !inside.out.boost, `${gap} m: the guard brakes and cancels the boost (brake ${inside.out.brake.toFixed(2)})`).toBeTruthy();
      expect(inside.meter, `${gap} m: the meter inside think ${inside.meter}`).toBe(1);
      expect(late.out.brake, `${gap} m: the late guard's brake`).toBe(inside.out.brake);
      expect(late.out.boost, `${gap} m: the late guard's boost`).toBe(inside.out.boost);
      expect(late.meter, `${gap} m: the late guard's meter`).toBe(inside.meter);
    }
  });
});
