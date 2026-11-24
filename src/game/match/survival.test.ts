import { describe, expect, it } from "vitest";
import { Track } from "../world/track.ts";
import { parseTrack } from "../world/track-schema.ts";
import { HAVANA } from "../world/tracks/havana.ts";
import havana from "../world/tracks/havana.json" with { type: "json" };
import { BUST } from "../ai/constants.ts";
import { RaceSession } from "./session.ts";
import { SURVIVAL, humanSlot, settleRun } from "./survival.ts";
import type { CarPose, Entrant } from "./types.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { must } from "../kernel/must.test-util.ts";

const track = new Track(HAVANA);
const you: Entrant = { id: 0, name: "You", kind: "player", aggression: 0 };
const DT = 1 / FRAME_HZ;
/** The owner's "like 10-15 seconds", as one number. */
const HOLD = 12;

function session(survival: boolean): RaceSession {
  return new RaceSession(track, [you], { laps: 3, noReset: true, survival: survival ? SURVIVAL : undefined });
}

const pose = (x: number, z: number, kph: number): CarPose => ({ x, z, yaw: 0, vx: 0, vz: kph / 3.6, alive: true });

/** Step the session until the green. */
function toGreen(s: RaceSession): void {
  while (s.phase !== "racing") s.step(DT, [pose(0, 420, 0)]);
}

/** Hold the car at `kph` with one cop `copAt` m away; seconds until the bust (null: none within `limit`). */
function bustAfter(s: RaceSession, kph: number, copAt: number, limit: number): number | null {
  toGreen(s);
  const t0 = s.time;
  for (let n = 0; n * DT < limit; n++) {
    s.step(DT, [pose(0, 420, kph)], [{ x: 0, z: 420 + copAt }]);
    if (s.cars[0]!.bustedAt !== null) return s.time - t0;
  }
  return null;
}

describe("given one player car on the Havana track, busted when held under 20 km/h within 20 m of a cop for a hold time (12 s in survival, shorter in a race)", () => {
  it("when the car is held under 20 km/h within 20 m of a cop, then it is busted after 12 s and not a step before, and a bust ends the one-car run with the car out", () => {
    expect(SURVIVAL.bustTime).toBe(HOLD);
    const s = session(true);
    const at = bustAfter(s, 5, 10, 30);
    must(at !== null, "never busted");
    expect(at > HOLD && at < HOLD + 2 * DT, `busted after ${at.toFixed(3)} s`).toBeTruthy();
    expect(s.cars[0]!.status, "a bust is out in a no-reset run").toBe("out");
    expect(s.phase, "and the only car out ends the run").toBe("finished");
  });

  it("when the same stopped-near-a-cop situation runs as an ordinary race instead of survival, then the car is busted at the race's own shorter hold and is a DNF", () => {
    expect(SURVIVAL.bustTime, "the survival hold is the owner's 10-15 s, longer than the race's").toBeGreaterThan(BUST.time);
    const race = new RaceSession(track, [you], { laps: 3, noReset: false });
    const at = bustAfter(race, 5, 10, 40);
    expect(at !== null && at > BUST.time && at < BUST.time + 2 * DT, `race busted after ${at}`).toBeTruthy();
    expect(race.cars[0]!.status).toBe("dnf");
  });

  it("when the car is farther than 20 m from every cop, or moving at 20 km/h and over, then it is never busted", () => {
    expect(bustAfter(session(true), 5, BUST.near + 1, 40), "busted with the cop out of range").toBe(null);
    expect(bustAfter(session(true), BUST.kph + 1, 5, 40), "busted while moving").toBe(null);
  });

  it("when the car moves off, or the cops fall away, partway through the hold, then the hold restarts from zero and the bust comes only after a full hold again", () => {
    const s = session(true);
    toGreen(s);
    const step = (kph: number, copAt: number, seconds: number): void => {
      for (let n = 0; n * DT < seconds; n++) s.step(DT, [pose(0, 420, kph)], [{ x: 0, z: 420 + copAt }]);
    };
    step(5, 10, HOLD - 1);
    step(40, 10, DT * 2);
    step(5, 10, HOLD - 1);
    expect(s.cars[0]!.bustedAt, "a car that moved off was busted on the old clock").toBe(null);
    step(5, 60, DT * 2);
    step(5, 10, HOLD - 1);
    expect(s.cars[0]!.bustedAt, "a car the cops lost was busted on the old clock").toBe(null);
    step(5, 10, 2);
    expect(s.cars[0]!.bustedAt).not.toBe(null);
  });

  it("when the car drives the ring four times at 80 km/h, then no gates count, the run never finishes and the car is never flagged wrong-way", () => {
    const s = session(true);
    toGreen(s);
    const p = track.path;
    for (let lap = 0; lap < 4; lap++) {
      for (let k = 0; k < p.count; k++) s.step(DT, [pose(p.x[k]!, p.z[k]!, 80)], []);
    }
    const c = s.cars[0]!;
    expect(c.lap).toBe(0);
    expect(c.status).toBe("racing");
    expect(s.phase).toBe("racing");
    expect(c.wrongWay).toBe(false);
  });
});

describe("given a survival run's recorded best time", () => {
  it("when a first run, a longer run, a shorter run and an equal run settle against it, then only the first and the longer run are a new best", () => {
    const testCases = [
      { name: "a first run", previousBest: null, seconds: 12.5, expectedBest: 12.5, expectedIsNew: true },
      { name: "a longer run", previousBest: 12.5, seconds: 30, expectedBest: 30, expectedIsNew: true },
      { name: "a shorter run", previousBest: 30, seconds: 12.5, expectedBest: 30, expectedIsNew: false },
      { name: "an equal run", previousBest: 30, seconds: 30, expectedBest: 30, expectedIsNew: false },
    ] as const;
    for (const testCase of testCases) {
      const run = settleRun(testCase.previousBest, testCase.seconds);
      expect(run.best, `${testCase.name}: best`).toBe(testCase.expectedBest);
      expect(run.isNew, `${testCase.name}: isNew`).toBe(testCase.expectedIsNew);
    }
  });
});

/** `humanSlot(start, k)` of Havana's start for seats 0 to 11 as it answered before a course could name its seats: x, z, yaw per seat. */
const ABREAST_BEFORE = [
  0, 426, 3.1416, -3.9999999998920606, 426.0000293856408, 3.1416, 3.9999999998920606, 425.9999706143592, 3.1416, -7.999999999784121, 426.00005877128166, 3.1416,
  -0.0000587712816531487, 418.0000000002159, 3.1416, -4.0000587711737134, 418.0000293858567, 3.1416, 3.9999412286104072, 417.9999706145751, 3.1416, -8.000058771065774, 418.00005877149755, 3.1416,
  -0.0001175425633062974, 410.0000000004318, 3.1416, -4.000117542455367, 410.0000293860726, 3.1416, 3.9998824573287544, 409.999970614791, 3.1416, -8.000117542347427, 410.00005877171344, 3.1416,
];
const SEAT_TOLERANCE = 1e-9;
const NAMED_SEATS = [
  { x: 1, z: 2, yaw: 0.5 },
  { x: 3, z: 4, yaw: 0.5 },
];

describe("given a Survival course that names no seats", () => {
  it("when twelve seats are asked for, then they are where four abreast and a row 8 m ahead put them, with the list absent or null", () => {
    const seats = Array.from({ length: 12 }, (_, k) => humanSlot(havana.survival.start, k));
    expect(firstMismatch(seats.flatMap((seat) => [seat.x, seat.z, seat.yaw]), ABREAST_BEFORE, SEAT_TOLERANCE), "first seat value that moved").toBeUndefined();
    const undef = Array.from({ length: 12 }, (_, k) => humanSlot(havana.survival.start, k, undefined));
    expect(firstMismatch(undef.map((seat) => seat.z), seats.map((seat) => seat.z)), "an absent list").toBeUndefined();
    const none = Array.from({ length: 12 }, (_, k) => humanSlot(havana.survival.start, k, null));
    expect(firstMismatch(none.map((seat) => seat.x), seats.map((seat) => seat.x)), "a null list").toBeUndefined();
  });

  it("when the course is loaded as a track, then it has no seats", () => {
    const spec = new Track(HAVANA).survival;
    must(spec, "Havana has survival anchors");
    expect(spec.seats, "seats").toBeUndefined();
  });
});

describe("given a course that names two seats", () => {
  it("when seats 0 to 3 are asked for, then the named seats come first and the seats past the list fall back to the abreast rule", () => {
    const start = havana.survival.start;
    expect(humanSlot(start, 0, NAMED_SEATS).x, "seat 0").toBe(1);
    expect(humanSlot(start, 1, NAMED_SEATS).z, "seat 1").toBe(4);
    expect(humanSlot(start, 2, NAMED_SEATS).x, "seat 2 as the abreast rule has it").toBe(humanSlot(start, 2).x);
    expect(humanSlot(start, 3, NAMED_SEATS).z, "seat 3 as the abreast rule has it").toBe(humanSlot(start, 3).z);
  });

  it("when a course lists none or more than a room's twelve seats, then it is refused as an invalid track, and two are kept", () => {
    const course = (seats: unknown[]): unknown => ({ ...havana, survival: { ...havana.survival, seats } });
    expect(() => parseTrack(course([])), "no seats").toThrow(/seats/);
    expect(() => parseTrack(course(Array.from({ length: 13 }, () => NAMED_SEATS[0]))), "thirteen seats").toThrow(/seats/);
    expect(parseTrack(course(NAMED_SEATS)).survival?.seats?.length, "two seats").toBe(2);
  });
});
