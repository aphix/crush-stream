import { describe, expect, it } from "vitest";
import { COURSES, hotLap, type HotLap } from "./race-ai.test-util.ts";
import type { VehicleClassId } from "../vehicle/vehicle-classes.ts";

const course = (id: string) => COURSES.find((t) => t.id === id)!;
const table = (laps: readonly (readonly [VehicleClassId, HotLap])[]) => laps.map(([id, l]) => `${id} ${l.time.toFixed(2)} s`).join(", ");
const mix = (l: HotLap) => Object.entries(l.mix).map(([s, f]) => `${s} ${(100 * f!).toFixed(0)}%`).join(" ");

describe("given a muscle car and a monster truck each hot-lapping the National Mall alone (all asphalt), driven by the hard AI", () => {
  it("when their flying laps are timed, then the monster's is at least 15 % slower than the muscle's", (t) => {
    const mall = course("national-mall");
    const muscle = hotLap(mall, "muscle");
    const monster = hotLap(mall, "monster");
    t.annotate(`${mix(muscle)}: muscle ${muscle.time.toFixed(2)} s, monster ${monster.time.toFixed(2)} s`);
    expect(monster.time / muscle.time, `muscle ${muscle.time.toFixed(2)} s, monster ${monster.time.toFixed(2)} s`).toBeGreaterThanOrEqual(1.15);
  });
});

describe("given every racing class hot-lapping Razor Shelf alone (its lap 97 % dirt and gravel), driven by the hard AI", () => {
  it("when their flying laps are timed, then the monster's is within 10 % of the best and the muscle's at least 10 % off it", (t) => {
    const razor = course("razor-shelf");
    const laps = (["muscle", "sedan", "hatch", "suv", "truck", "monster"] as const).map((id) => [id, hotLap(razor, id)] as const);
    const best = Math.min(...laps.map(([, l]) => l.time));
    const lap = (id: VehicleClassId) => laps.find(([c]) => c === id)![1].time;
    t.annotate(`${mix(laps[0]![1])}: ${table(laps)}`);
    expect(lap("monster") / best, table(laps)).toBeLessThanOrEqual(1.1);
    expect(lap("muscle") / best, table(laps)).toBeGreaterThanOrEqual(1.1);
  });
});
