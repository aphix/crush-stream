import { describe, expect, it } from "vitest";
import { Track } from "../world/track.ts";
import { HAVANA } from "../world/tracks/havana.ts";
import { BUST, RaceSession } from "./session.ts";
import { SURVIVAL, settleRun } from "./survival.ts";
import type { CarPose, Entrant } from "./types.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
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
  it("when a first run, a longer run and an equal run settle against it, then only a longer run is a new best", () => {
    const cases = [
      { run: settleRun(null, 12.5), best: 12.5, isNew: true },
      { run: settleRun(12.5, 30), best: 30, isNew: true },
      { run: settleRun(30, 12.5), best: 30, isNew: false },
      { run: settleRun(30, 30), best: 30, isNew: false },
    ];
    for (let i = 0; i < cases.length; i++) {
      const { run, best, isNew } = cases[i]!;
      expect(run.best, `settle ${i} best`).toBe(best);
      expect(run.isNew, `settle ${i} isNew`).toBe(isNew);
    }
  });
});
