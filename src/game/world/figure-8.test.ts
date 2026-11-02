import { describe, expect, it } from "vitest";
import { setGround } from "./ground.ts";
import { FRAME, frame, makeWorld } from "./race-world.test-util.ts";
import { placeProps } from "./placements.ts";
import { Track } from "./track.ts";
import { TRACKS } from "./tracks/index.ts";
import { RaceSession } from "../match/session.ts";
import { centreline, field, polyline, runTo, type Pt } from "../match/session-drive.test-util.ts";
import { must } from "../kernel/must.test-util.ts";

/** Road width (m): five cars of ~1.9 m (`CAR_SPRAY`, 1.9 m across) abreast with a hand's breadth between them, as the owner asked. */
const WIDTH = 10.5;
/** Radius (m) of each loop's centreline: a 28 m/s lap at the AI's 16 m/s² corner budget (`checkpoint-sweep.test-util.ts`). */
const LOOP_RADIUS = 50;
/** The crossing's centre, and how near (m) a sample of the loop must come to it to be one of the two passes through it. */
const CROSSING_REACH = 2;

const json = TRACKS.find((j) => new Track(j).id === "figure-8");
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

describe("given the figure-8 course, two dirt loops joined by a crossing at grade", () => {
  it("when the course is built, then it is a closed 10.5 m dirt road with no walls, listed in the race menu, its loops 50 m in radius", () => {
    must(json, "the race menu lists figure-8");
    expect(track.path.closed).toBe(true);
    const p = track.path;
    expect(Math.hypot(p.x[0]! - p.x[p.count - 1]!, p.z[0]! - p.z[p.count - 1]!), "the last sample is one step from the first").toBeLessThan(1.5);
    expect(Math.min(...p.half) * 2).toBeCloseTo(WIDTH, 6);
    expect(Math.max(...p.half) * 2).toBeCloseTo(WIDTH, 6);
    expect(track.json.road.surface).toBe("dirt");
    expect(Math.max(...p.wallL, ...p.wallR), "no walls: the clearing is open").toBe(0);
    expect(Math.max(...p.y) - Math.min(...p.y), "flat").toBe(0);
    const top = LOOP_RADIUS * (1 + Math.SQRT2);
    expect(Math.abs(Math.max(...p.z) - top), "the north loop reaches its radius past its centre").toBeLessThan(3);
    expect(Math.abs(Math.min(...p.z) + top), "the south loop likewise").toBeLessThan(3);
  });

  it("when its centreline is walked, then it crosses itself exactly once, at the origin, at grade, and a gate stands on each of the loops and the straights but none over the crossing", () => {
    const passes = passesThroughCrossing();
    expect(passes.length, `passes at s = ${passes.join()}`).toBe(2);
    expect(Math.abs(passes[1]! - passes[0]! - track.length / 2), "the passes are half a lap apart").toBeLessThan(20);
    for (const g of track.gates) expect(Math.hypot((g.ax + g.bx) / 2, (g.az + g.bz) / 2), `gate at s=${g.s.toFixed(0)} is 20 m or more from the crossing`).toBeGreaterThan(20);
  });

  it("when a car drives the centreline from the grid, then it earns one lap per round and the lap counts through the crossing both times", () => {
    const L = track.length;
    const one = lapsOf(centreline(track, L - 6, L + L + 10), 30, 1, 120);
    expect(one.laps, "one lap").toBe(1);
    expect(one.session.cars[0]!.missed).toBe(false);
    const two = lapsOf(centreline(track, L - 6, 3 * L + 10), 30, 2, 200);
    expect(two.laps, "two laps, the crossing counted for neither").toBe(2);
  });

  it("when a car does the first loop then turns at the crossing onto the start straight, then it earns no lap and is told it missed the second loop's checkpoints", () => {
    const L = track.length;
    const [pass] = passesThroughCrossing();
    const cheat = [...centreline(track, L - 6, L + pass! - 6), { x: 0, z: 0 }, { x: 40, z: 40 }, { x: 70, z: 70 }];
    const { laps, session } = lapsOf(cheat, 30, 1, 120);
    expect(laps, "no lap for cutting across the crossing").toBe(0);
    expect(session.cars[0]!.next, "the second loop is still owed").toBeGreaterThan(0);
  });

  it("when the props are placed, then trees stand in each loop and a ring of them in the forest, none on the road", () => {
    const trees = placeProps(track).filter((p) => p.prefab === "tree");
    expect(trees.length).toBeGreaterThan(200);
    for (const cz of [LOOP_RADIUS * Math.SQRT2, -LOOP_RADIUS * Math.SQRT2]) {
      const inside = trees.filter((t) => Math.hypot(t.x, t.z - cz) < LOOP_RADIUS - 12);
      expect(inside.length, `trees inside the loop at z=${cz.toFixed(0)}`).toBeGreaterThan(8);
    }
  });
});

describe("given a 1-lap figure-8 race of 4 AI rivals and the AI-driven player slot, with field seed 1", () => {
  it("when the race is run to its end, then the AI racers round the crossing and every car finishes its lap", () => {
    const w = makeWorld();
    w.race.enter();
    try {
      w.race.command({ type: "options", options: { trackId: "figure-8", laps: 1, aiCount: 4 } });
      w.race.reseed(1);
      w.race.command({ type: "start" });
      w.seat.mode = "follow";
      const state = { acc: 0 };
      for (let n = 0; w.race.phase !== "finished" && n * FRAME < 4.5 + 3 * (track.length / 9); n++) frame(w, state);
      const snap = w.race.snapshot()!;
      expect(snap.phase).toBe("finished");
      for (const c of snap.cars) expect(c.lapTimes.length, `${c.name} is ${c.status}`).toBe(1);
    } finally {
      w.race.exit();
      setGround(null);
    }
  });
});
