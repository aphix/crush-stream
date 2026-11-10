import { describe, expect, it } from "vitest";
import { hypot2 } from "../../kernel/physics-core.js";
import { must } from "../../kernel/must.test-util.ts";
import { NEVER_TICK } from "../civilians/civilian-constants.ts";
import { CRIME_HZ, ESCORT_ARRIVE, FOOT_COP_COUNT, MAX_SUBJECTS, PATROL_COPS, PATROL_RECENT } from "./crime-constants.ts";
import { stationOf } from "./arrests.ts";
import { FootLaw } from "./foot-law.ts";
import { FootWalkers } from "./foot-walkers.ts";
import type { OffenceSource, Spot, Walk } from "./offence-source.ts";
import { realMap, type RealMap } from "./real-map.test-util.ts";

const real: RealMap = realMap();
const station = stationOf(real.map);
must(station, "the real map has its police station");
const STATION = station;
const SEEDS = [7, 8, 9];
/** Ten minutes of the law's grid steps, a new crime at a random door every twenty seconds (the real city has far more). */
const MINUTES = 10;
const STEPS = MINUTES * 60 * CRIME_HZ;
const CRIME_EVERY_STEPS = 20 * CRIME_HZ;
const RESIDENTS = 8;
const WALKERS = FOOT_COP_COUNT + MAX_SUBJECTS;
/** A walker may come to the same corner (as the nearest node, entering it afresh) this many times in the ten minutes: a chase round a block passes a corner a few times, a loop passes it dozens. */
const MOST_REVISITS = 8;
/** The beat covers ground: over ten minutes the patrolling cops are, on average, in at least this many of the city's `CELL` m squares (a beat of a block or two gets 13; legs of a block or less, 9). */
const CELL = 40;
const LEAST_MEAN_CELLS = 11;
/** Sample points round the walk graph's nodes, each a few metres off one: a corner lot has some whose nearest node is across its wall. */
const SAMPLES = 2000;
const NODE_STRIDE = 7;
const SAMPLE_OFFSET = 5;

/** The society's rows as the law reads them, for the doors of the real map: a crime at a door is wanted until the host's bust. */
class Scene {
  readonly law: FootLaw;
  readonly wanted = new Uint8Array(RESIDENTS);
  private readonly spotX = new Float64Array(RESIDENTS);
  private readonly spotZ = new Float64Array(RESIDENTS);
  private readonly doors = real.map.places.filter((place) => place.doorNode >= 0);
  private crimes = 0;
  /** How far (m) the arresting cop stood from the station's door at each arrest the host was asked to raise. */
  readonly doorGaps: number[] = [];

  constructor(seed: number, sight: boolean) {
    const source: OffenceSource = {
      residentCount: RESIDENTS,
      wanted: (resident) => this.wanted[resident] === 1,
      spellOf: (resident) => 5000 + resident,
      fightTick: () => NEVER_TICK,
      fightPartner: () => -1,
      standing: (resident, _seconds, out: Spot) => {
        out.x = this.spotX[resident]!;
        out.z = this.spotZ[resident]!;
        return true;
      },
      legDepartSeconds: () => 0,
      onStreet: (_resident, out: Walk) => {
        out.x = 0;
        out.z = 0;
        out.dirX = 0;
        out.dirZ = 1;
        return false;
      },
      knocked: () => false,
      reportDoneTick: () => 0,
    };
    this.law = new FootLaw(
      real.map,
      source,
      { bust: (resident) => this.raised(resident), jaywalked: () => {}, copDown: () => {}, footBusted: () => {} },
      { opened: () => {}, closed: () => {}, cars: () => null },
      seed,
      { lineOfSight: sight ? real.sight : null, signals: null, otherCopsSee: null },
      12,
    );
    this.law.authority = true;
  }

  private raised(resident: number): void {
    const { table, walkers } = this.law;
    const cop = table.holder[table.subjectOf[resident]!]!;
    this.wanted[resident] = 0;
    this.doorGaps.push(hypot2(walkers.x[cop]! - STATION.x, walkers.z[cop]! - STATION.z));
  }

  /** A crime at a door picked by (step, seed). */
  commit(step: number, seed: number): void {
    const resident = this.crimes % RESIDENTS;
    const door = this.doors[(step * 7 + seed * 13) % this.doors.length]!;
    this.spotX[resident] = door.doorX;
    this.spotZ[resident] = door.doorZ;
    this.wanted[resident] = 1;
    this.crimes++;
  }
}

type Tally = { insideSteps: number; mostRevisits: number; cells: number[]; doorGaps: number[] };

const tallies = new Map<string, Tally>();

/** Runs ten minutes of crimes and counts, over every walker, the steps spent inside a building and the most times one corner was entered afresh; `corners` the distinct corners each patrolling cop was at. */
function tally(seed: number, sight: boolean, crimes: boolean): Tally {
  const key = `${seed}/${sight}/${crimes}`;
  const kept = tallies.get(key);
  if (kept !== undefined) return kept;
  const scene = new Scene(seed, sight);
  const walkers = scene.law.walkers;
  const last = new Int32Array(WALKERS).fill(-1);
  const visits = Array.from({ length: WALKERS }, () => new Map<number, number>());
  const out: Tally = { insideSteps: 0, mostRevisits: 0, cells: [], doorGaps: scene.doorGaps };
  const cells = Array.from({ length: PATROL_COPS }, () => new Set<string>());
  for (let step = 1; step <= STEPS; step++) {
    if (crimes && step % CRIME_EVERY_STEPS === 0) scene.commit(step, seed);
    scene.law.advance();
    for (let cop = 0; cop < PATROL_COPS; cop++) cells[cop]!.add(`${Math.floor(walkers.x[cop]! / CELL)},${Math.floor(walkers.z[cop]! / CELL)}`);
    for (let walker = 0; walker < WALKERS; walker++) {
      if (real.insideBuilding(walkers.x[walker]!, walkers.z[walker]!)) out.insideSteps++;
      const node = walkers.nearestNode(walkers.x[walker]!, walkers.z[walker]!);
      if (node === last[walker]) continue;
      last[walker] = node;
      const seen = (visits[walker]!.get(node) ?? 0) + 1;
      visits[walker]!.set(node, seen);
      out.mostRevisits = Math.max(out.mostRevisits, seen);
    }
  }
  for (let cop = 0; cop < PATROL_COPS; cop++) out.cells.push(cells[cop]!.size);
  tallies.set(key, out);
  return out;
}

describe("given the real open world and ten minutes of crimes", () => {
  // mutation: in src/game/ai/openworld-crime/foot-cops.ts run(), change `<= STRAIGHT_APPROACH && walkers.straightClear(walkers.x[cop]!, walkers.z[cop]!, aimX, aimZ)) {` to `<= STRAIGHT_APPROACH) {`
  it("when cops chase and arrest, then nobody walks into a building, whatever corner the chase turns", () => {
    for (const seed of SEEDS) expect(tally(seed, true, true).insideSteps, `walker-steps inside a building (seed ${seed})`).toBe(0);
  });

  // mutation: sed -i 's/this.replanIfAimMoved(cop, aimX, aimZ);/this.walkers.plan(cop, this.finder, this.walkers.nearestSeenNode(aimX, aimZ), this.noFear, 0);/' src/game/ai/openworld-crime/foot-cops.ts
  // mutation: sed -i 's/new FootWalkers(map.graph, FOOT_COP_COUNT + MAX_SUBJECTS, senses.lineOfSight)/new FootWalkers(map.graph, FOOT_COP_COUNT + MAX_SUBJECTS, null)/' src/game/ai/openworld-crime/foot-law.ts
  it("when cops chase and arrest, then no walker keeps coming back to one corner", () => {
    for (const seed of SEEDS) expect(tally(seed, true, true).mostRevisits, `most times one corner was entered (seed ${seed})`).toBeLessThanOrEqual(MOST_REVISITS);
  });
});

describe("given the real open world with its police station and ten minutes of crimes", () => {
  // mutation: sed -i 's/to === ESCORT_TO.station ? STATION_ESCORT_SECONDS : ESCORT_SECONDS/ESCORT_SECONDS/' src/game/ai/openworld-crime/arrests.ts
  it("when cops arrest, then each arrest is raised with the cop at the station's door, wherever the suspect was cuffed", () => {
    let arrests = 0;
    for (const seed of SEEDS) {
      const { doorGaps } = tally(seed, true, true);
      arrests += doorGaps.length;
      for (const gap of doorGaps) expect(gap, `cop's distance from the station's door at an arrest (seed ${seed})`).toBeLessThanOrEqual(ESCORT_ARRIVE);
    }
    expect(arrests, "arrests raised in the ten minutes, three seeds").toBeGreaterThanOrEqual(3);
  });
});

describe("given a cop standing beside a corner lot of the real map", () => {
  // mutation: in src/game/ai/openworld-crime/foot-walkers.ts nearestSeenNode(), change `if (gap >= seenGap || !this.clear(x, z, nodeX[node]!, nodeZ[node]!)) continue;` to `if (gap >= seenGap) continue;`
  it("when the nearest corner is across a building, then the node he walks to is the nearest one he can see", () => {
    const walkers = new FootWalkers(real.map.graph, 1, real.sight);
    const { nodeX, nodeZ } = real.map.graph;
    let across = 0;
    for (let sample = 0; sample < SAMPLES; sample++) {
      const node = (sample * NODE_STRIDE) % nodeX.length;
      const x = nodeX[node]! + SAMPLE_OFFSET * Math.cos(sample);
      const z = nodeZ[node]! + SAMPLE_OFFSET * Math.sin(sample);
      if (real.insideBuilding(x, z) || !real.sight(x, z, nodeX[node]!, nodeZ[node]!)) continue;
      const seen = walkers.nearestSeenNode(x, z);
      if (seen !== walkers.nearestNode(x, z)) across++;
      expect(real.sight(x, z, nodeX[seen]!, nodeZ[seen]!), `a clear line from sample ${sample} to its node`).toBe(true);
    }
    expect(across, "samples whose nearest node was across a building").toBeGreaterThan(0);
  });
});

describe("given the real open world and ten minutes of patrolling", () => {
  // mutation: in src/game/ai/openworld-crime/foot-cops.ts nextCorner(), change `if (edgeStart[node + 1]! - edgeStart[node]! < 2 || this.isRecent(cop, node)) continue;` to `if (edgeStart[node + 1]! - edgeStart[node]! < 1 || this.isRecent(cop, node)) continue;`
  it("when no crime calls them, then the cops walk the sidewalks and crossings without entering a building", () => {
    for (const seed of SEEDS) expect(tally(seed, true, false).insideSteps, `walker-steps inside a building (seed ${seed})`).toBe(0);
  });

  // mutation: in src/game/ai/openworld-crime/crime-constants.ts, change `PATROL_LEG_MAX = 120;` to `PATROL_LEG_MAX = 30;`
  it("when no crime calls them, then each cop walks a beat across the city, not round one corner", () => {
    const cells: number[] = [];
    for (const seed of SEEDS) {
      const patrol = tally(seed, true, false);
      cells.push(...patrol.cells);
      expect(patrol.mostRevisits, `most times one corner was entered (seed ${seed})`).toBeLessThanOrEqual(MOST_REVISITS);
    }
    expect(cells.reduce((sum, count) => sum + count, 0) / cells.length, "cells a cop was in, on average").toBeGreaterThanOrEqual(LEAST_MEAN_CELLS);
  });
});

describe("given a cop's last few corners", () => {
  // mutation: in src/game/ai/openworld-crime/foot-cops.ts nextCorner(), change `this.isRecent(cop, node)) continue;` to `false) continue;`
  it("when he picks the next, then it is not one of the last `PATROL_RECENT` he walked to", () => {
    for (const seed of SEEDS) {
      const scene = new Scene(seed, true);
      const walkers = scene.law.walkers;
      for (let cop = 0; cop < PATROL_COPS; cop++) {
        const reached: number[] = [];
        let moving = false;
        for (let step = 1; step <= STEPS; step++) {
          scene.law.advance();
          const walking = walkers.speed[cop]! > 0;
          if (moving && !walking) reached.push(walkers.nearestNode(walkers.x[cop]!, walkers.z[cop]!));
          moving = walking;
        }
        let repeats = 0;
        for (let at = 1; at < reached.length; at++) {
          for (let back = Math.max(0, at - PATROL_RECENT + 1); back < at; back++) if (reached[back] === reached[at]) repeats++;
        }
        expect(repeats, `corners repeated within ${PATROL_RECENT} legs (seed ${seed}, cop ${cop})`).toBe(0);
      }
    }
  });
});
