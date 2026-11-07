import { describe, expect, it } from "vitest";
import { setGround } from "./ground.ts";
import { FRAME, frame, makeWorld } from "./race-world.test-util.ts";
import { placeProps } from "./placements.ts";
import { blankPoint, Track } from "./track.ts";
import { parseTrack } from "./track-schema.ts";
import { TRACKS } from "./tracks/index.ts";
import { RaceSession } from "../match/session.ts";
import { centreline, field, polyline, runTo, type Pt } from "../match/session-drive.test-util.ts";
import { RaceBrain } from "../ai/race-ai.ts";
import { blankAiCar } from "../ai/derby-ai.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { must } from "../kernel/must.test-util.ts";

/** Road width (m): six car lanes (the owner's 5-6 lane minimum, a car 1.9 m across in a 4 m lane). */
const WIDTH = 24;
/** Radius (m) of each loop's centreline: tight, so the field bunches at the X; its island stays 17 m to the wall line, room for a landmark. */
const LOOP_RADIUS = 30;
/** Each loop's centre is this far (m) north or south of the crossing (R·√2): the arms cross at 90°, tangent to both loops, 30 m from the X to each loop. */
const LOOP_CENTRE_Z = LOOP_RADIUS * Math.SQRT2;
/** The loop island's radius (m) to the wall line: the centreline radius less half the road and the 1 m runoff. */
const ISLAND_RADIUS = LOOP_RADIUS - WIDTH / 2 - 1;
/** Along either arm the walls stop this far (m) from the crossing: closer, a wall would stand across the other arm's road and runoff (13 m from its centreline). */
const WALL_OPEN = 14;
/** The crossing's centre, and how near (m) a sample of the loop must come to it to be one of the two passes through it. */
const CROSSING_REACH = 2;
/** Race seconds the field gets for three laps: the grid and lights, then the 403 m lap at the AI's 15 m/s (crossings and a pack's braking included). */
const AI_RACE_BUDGET_S = 4.5 + (3 * 403) / 15;

const json = TRACKS.find((j) => parseTrack(j).id === "figure-8");
must(json, "the race menu lists figure-8");
const track = new Track(json);

/** The arc lengths (m) at which the loop passes through the crossing at the origin, one per pass (neighbouring samples are one pass). */
function passesThroughCrossing(): number[] {
  const passes: number[] = [];
  const p = track.path;
  for (let k = 0; k < p.count; k++) {
    if (Math.hypot(p.x[k]!, p.z[k]!) > CROSSING_REACH) continue;
    const s = (k / p.count) * track.length;
    if (passes.length === 0 || s - passes[passes.length - 1]! > 20) passes.push(s);
  }
  return passes;
}

/** Laps of `laps` credited to one car driving `pts` at `v` m/s for `seconds`. */
function lapsOf(pts: Pt[], v: number, laps: number, seconds: number): { laps: number; session: RaceSession } {
  const session = new RaceSession(track, field(1), { laps, noReset: false });
  const events = runTo(session, [polyline(pts, v)], seconds);
  return { laps: events.filter((e) => e.type === "lap").length, session };
}

describe("given the figure-8 course, two tight walled mud loops running into a crossing at grade", () => {
  it("when the course is built, then it is a closed 24 m mud road dished 1 m and walled both sides, listed in the race menu, its loops 30 m in radius", () => {
    expect(track.path.closed).toBe(true);
    const p = track.path;
    expect(Math.hypot(p.x[0]! - p.x[p.count - 1]!, p.z[0]! - p.z[p.count - 1]!), "the last sample is one step from the first").toBeLessThan(1.5);
    expect(Math.min(...p.half) * 2).toBeCloseTo(WIDTH, 6);
    expect(Math.max(...p.half) * 2).toBeCloseTo(WIDTH, 6);
    expect(track.json.road.surface).toBe("mud");
    // Concave, so a sliding car runs back toward the middle instead of slapping the walls (owner).
    expect(track.json.road.dish).toBe(1);
    expect(Math.max(...p.y) - Math.min(...p.y), "flat").toBe(0);
    const top = LOOP_CENTRE_Z + LOOP_RADIUS;
    expect(Math.abs(Math.max(...p.z) - top), "the north loop reaches its radius past its centre").toBeLessThan(1);
    expect(Math.abs(Math.min(...p.z) + top), "the south loop likewise").toBeLessThan(1);
  });

  it("when its walls are read along the loop, then both sides stand everywhere but within 14 m of the crossing, where both are open", () => {
    const p = track.path;
    for (let k = 0; k < p.count; k++) {
      const fromX = Math.hypot(p.x[k]!, p.z[k]!);
      if (fromX < WALL_OPEN - 1) expect(p.wallL[k]! + p.wallR[k]!, `sample ${k}, ${fromX.toFixed(1)} m from the X, is open`).toBe(0);
      else if (fromX > WALL_OPEN + 1) expect(Math.min(p.wallL[k]!, p.wallR[k]!), `sample ${k}, ${fromX.toFixed(1)} m from the X, is walled`).toBeGreaterThan(0);
    }
  });

  it("when its centreline is walked, then it crosses itself exactly once, at the origin, at grade and square, and no gate stands over the crossing", () => {
    const passes = passesThroughCrossing();
    expect(passes.length, `passes at s = ${passes.join()}`).toBe(2);
    expect(Math.abs(passes[1]! - passes[0]! - track.length / 2), "the passes are half a lap apart").toBeLessThan(20);
    const [a, b] = passes.map((s) => track.pointAt(s, blankPoint()));
    const angle = (Math.acos(a!.tx * b!.tx + a!.tz * b!.tz) * 180) / Math.PI;
    expect(Math.abs(angle - 90), `the arms meet at ${angle.toFixed(1)} deg: a T-bone, not a glancing hit`).toBeLessThan(2);
    for (const g of track.gates) expect(Math.hypot((g.ax + g.bx) / 2, (g.az + g.bz) / 2), `gate at s=${g.s.toFixed(0)} is 20 m or more from the crossing`).toBeGreaterThan(20);
  });

  it("when a car does the first loop then turns at the crossing onto the start straight, then it earns no lap and is told it missed the second loop's checkpoints", () => {
    const L = track.length;
    const [pass] = passesThroughCrossing();
    const cheat = [...centreline(track, L - 6, L + pass! - 6), { x: 0, z: 0 }, { x: 21, z: 21 }, { x: 30, z: 42 }];
    const { laps, session } = lapsOf(cheat, 30, 1, 120);
    expect(laps, "no lap for cutting across the crossing").toBe(0);
    expect(session.cars[0]!.next, "the second loop is still owed").toBeGreaterThan(0);
  });

  it("when the props are placed, then trees stand in each loop's island and a ring of them in the forest", () => {
    const trees = placeProps(track).filter((p) => p.prefab === "tree");
    expect(trees.length).toBeGreaterThan(200);
    for (const cz of [LOOP_CENTRE_Z, -LOOP_CENTRE_Z]) {
      const inside = trees.filter((t) => Math.hypot(t.x, t.z - cz) < ISLAND_RADIUS);
      expect(inside.length, `trees inside the loop at z=${cz.toFixed(0)}`).toBeGreaterThan(8);
    }
  });
});

describe("given a 3-lap figure-8 race of 4 AI rivals and the AI-driven player slot, with field seed 1", () => {
  it("when the race is run to its end, then no car ever owes a missed checkpoint and every car finishes its three laps inside the pace budget", () => {
    const w = makeWorld();
    w.race.enter();
    try {
      w.race.command({ type: "options", options: { trackId: "figure-8", laps: 3, aiCount: 4 } });
      w.race.reseed(1);
      w.race.command({ type: "start" });
      w.seat.mode = "follow";
      const state = { acc: 0 };
      let missed = "";
      for (let n = 0; w.race.phase !== "finished" && n * FRAME < AI_RACE_BUDGET_S; n++) {
        frame(w, state);
        if (n % 10 === 0) missed ||= w.race.snapshot()!.cars.filter((c) => c.missed).map((c) => `${c.name} at ${(n * FRAME).toFixed(0)} s`).join();
      }
      const snap = w.race.snapshot()!;
      expect(missed, "cars that owed a checkpoint").toBe("");
      expect(snap.phase, `not over after ${AI_RACE_BUDGET_S.toFixed(0)} s`).toBe("finished");
      for (const c of snap.cars) expect(c.lapTimes.length, `${c.name} is ${c.status}`).toBe(3);
    } finally {
      w.race.exit();
      setGround(null);
    }
  });
});

describe("given an AI racer put back on the road at a side slot two metres before the crossing", () => {
  /** The brain's main-loop sample for racer 0 after one think from a spot `side` m left of the line, `seed` the sample the respawn event carries (−1: none). */
  function strandOf(side: number, seed: number): number {
    const brain = new RaceBrain(track, 1);
    const pt = track.pointAt(passesThroughCrossing()[0]! - 2, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
    const car = { ...blankAiCar(0), x: pt.x + side * pt.tz, z: pt.z - side * pt.tx, yaw: Math.atan2(pt.tx, pt.tz), vx: 0, vz: 0 };
    brain.respawned(0, seed >= 0 ? seed : undefined);
    brain.think(car, [car], { next: 1, lap: 0 }, 1 / FRAME_HZ);
    return (brain["seg"][0]! / track.path.count) * track.length;
  }
  for (const side of [2.6, -2.6]) {
    it(`when the respawn names its sample and it stands ${Math.abs(side)} m to its ${side > 0 ? "left" : "right"}, then it is on its own strand`, () => {
      const own = passesThroughCrossing()[0]!;
      const k = Math.round(((own - 2) / track.length) * track.path.count);
      expect(Math.abs(strandOf(side, k) - own), "the seeded sample").toBeLessThan(15);
    });
  }
  it("when the respawn names no sample, then one of the two slots is nearer the other strand and the racer drives that one (the hazard the sample prevents)", () => {
    const own = passesThroughCrossing()[0]!;
    const off = [2.6, -2.6].map((side) => Math.abs(strandOf(side, -1) - own));
    expect(Math.max(...off), `s off its own strand: ${off.join()}`).toBeGreaterThan(100);
  });
});
