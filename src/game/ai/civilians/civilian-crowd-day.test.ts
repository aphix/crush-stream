import { describe, expect, it } from "vitest";
import { DECISION_HZ, MAX_PATH_NODES, RESIDENT_INT, RESIDENT_INT_STRIDE, SPECIES, TICKS_PER_GAME_DAY } from "./civilian-constants.ts";
import type { CivilianCrowd } from "./civilian-crowd.ts";
import { buildFixtureMap } from "./civilian-graph.test-util.ts";
import { newCrowd } from "./civilian-crowd.test-util.ts";

const map = buildFixtureMap();
const DAY_SECONDS = TICKS_PER_GAME_DAY / DECISION_HZ;
/** A power of two, so the clock sums exactly; a sample for the stuck check every this many steps (one second). */
const STEP_SECONDS = 0.25;
const SAMPLE_EVERY = 4;
/** A walker covers over a metre a second, but a path that turns back on itself at a corner nets almost none for a moment: stuck is moving less than this in two looks in a row on one leg. */
const STUCK_METRES = 0.2;
const STUCK_LOOKS = 2;
const MIN_LEGS = 100;
const MIN_ANIMAL_METRES = 50;

type DayReport = { legs: number; badLegs: string[]; stuck: string[]; metres: Map<number, number>; species: Map<number, number> };

/** Whether the leg resident `resident` was just given starts at a door or portal and ends at the door of the place it is going to. */
function legProblem(crowd: CivilianCrowd, resident: number, doorsAndPortals: ReadonlySet<number>): string | null {
  const { state } = crowd;
  const base = resident * RESIDENT_INT_STRIDE;
  const first = resident * MAX_PATH_NODES;
  const count = state.ints[base + RESIDENT_INT.pathCount]!;
  const start = state.pathNodes[first]!;
  const end = state.pathNodes[first + count - 1]!;
  const place = state.ints[base + RESIDENT_INT.place]!;
  if (!doorsAndPortals.has(start)) return `resident ${resident} starts at node ${start}, no door`;
  return end === state.index.doorNode[place] ? null : `resident ${resident} ends at node ${end}, not the door ${state.index.doorNode[place]} of ${map.places[place]!.name}`;
}

/** A game day of crowd time in steps, checking each new leg and, once a second, that every shown civilian has moved. */
function runDay(): DayReport {
  const crowd = newCrowd(map);
  const { state, poses } = crowd;
  const doorsAndPortals = new Set<number>([...state.index.doorNode].filter((node) => node >= 0).concat([...map.portals]));
  const lastDepart = new Int32Array(poses.count).fill(-1);
  const sampled = { x: new Float32Array(poses.count), z: new Float32Array(poses.count), shown: new Uint8Array(poses.count), depart: new Int32Array(poses.count), slow: new Uint8Array(poses.count) };
  const report: DayReport = { legs: 0, badLegs: [], stuck: [], metres: new Map(), species: new Map() };
  for (let step = 1; step * STEP_SECONDS <= DAY_SECONDS; step++) {
    crowd.step(step * STEP_SECONDS, [], true);
    for (let resident = 0; resident < poses.count; resident++) {
      const base = resident * RESIDENT_INT_STRIDE;
      const depart = state.ints[base + RESIDENT_INT.departTick]!;
      if (state.ints[base + RESIDENT_INT.pathCount]! > 0 && depart !== lastDepart[resident]) {
        lastDepart[resident] = depart;
        report.legs++;
        const problem = legProblem(crowd, resident, doorsAndPortals);
        if (problem !== null) report.badLegs.push(problem);
      }
      if (step % SAMPLE_EVERY !== 0) continue;
      if (poses.shown[resident] === 1 && sampled.shown[resident] === 1 && sampled.depart[resident] === depart) {
        const moved = Math.hypot(poses.x[resident]! - sampled.x[resident]!, poses.z[resident]! - sampled.z[resident]!);
        sampled.slow[resident] = moved < STUCK_METRES ? sampled.slow[resident]! + 1 : 0;
        if (sampled.slow[resident] === STUCK_LOOKS) report.stuck.push(`resident ${resident} moved ${moved.toFixed(2)} m at ${step * STEP_SECONDS} s`);
        const species = state.ints[base + RESIDENT_INT.species]!;
        report.metres.set(species, (report.metres.get(species) ?? 0) + moved);
      }
      sampled.shown[resident] = poses.shown[resident]!;
      sampled.depart[resident] = depart;
      sampled.x[resident] = poses.x[resident]!;
      sampled.z[resident] = poses.z[resident]!;
    }
  }
  for (let resident = 0; resident < poses.count; resident++) report.species.set(state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.species]!, (report.species.get(state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.species]!) ?? 0) + 1);
  return report;
}

describe("given the fixture neighbourhood's crowd stepped through one game day", () => {
  const day = runDay();

  it("when the day is over, then every leg began at a door or the bus stop's portal and ended at the door of the place it went to", () => {
    expect(day.legs, "legs walked").toBeGreaterThan(MIN_LEGS);
    expect(day.badLegs, "legs that began or ended off a door").toEqual([]);
  });

  it("when the day is over, then no civilian shown on a leg stood still between two looks a second apart", () => {
    expect(day.stuck, "stuck samples").toEqual([]);
  });

  it("when the day is over, then there are cats and dogs among the residents and each kind walked", () => {
    for (const species of [SPECIES.cat, SPECIES.dog]) {
      expect(day.species.get(species) ?? 0, `residents of species ${species}`).toBeGreaterThan(0);
      expect(day.metres.get(species) ?? 0, `metres walked by species ${species}`).toBeGreaterThan(MIN_ANIMAL_METRES);
    }
  });
});
