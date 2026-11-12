import { describe, expect, it } from "vitest";
import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import { DECISION_HZ, LATERAL_MAX, MAX_PATH_NODES, MAX_WAITS, NEED, RESIDENT_FLOAT, RESIDENT_FLOAT_STRIDE, RESIDENT_INT, RESIDENT_INT_STRIDE, TICKS_PER_GAME_DAY } from "./civilian-constants.ts";
import { buildFixtureMap } from "./civilian-graph.test-util.ts";
import { LegPose, legPose } from "./civilian-leg.ts";
import { sendResidentTo } from "./civilian-plan.ts";
import { stateDigest } from "./civilian-run.test-util.ts";
import { openWorldSignals, type PedestrianSignals } from "./civilian-signals.ts";
import { computeTick } from "./civilian-tick.ts";
import { applyAnswer } from "./civilian-wire.ts";
import { residentNeuroticism } from "./civilian-temperament.ts";
import type { CityState } from "./civilian-state.ts";
import { createCityState } from "./society.ts";
import { isCrossingBetween } from "./society-crossing.ts";
import { intAt, stageResident } from "./society.test-util.ts";
import { hypot2 } from "../../kernel/physics-core.js";

const map = buildFixtureMap();
const SEED = 5;
const START_TICK = 2 * TICKS_PER_GAME_DAY + 6 * 120;
/** The lights are red for walkers until this crowd second (five minutes on), then walk for good. */
const RED_UNTIL = START_TICK / DECISION_HZ + 300;
const DWELL_TICKS = 60;
const SEEDS = 8;
/** What the jumpy's likelier dart puts between the darters' mean neuroticism and the waiters' (0.19 as the chances are set): over this, not under chance's spread of a few hundred walkers. */
const JUMPY_GAP = 0.1;

/** A signal that holds every walker until \`RED_UNTIL\` and is green for them after: asked at \`seconds\`, the wait is the rest. */
const redForAWhile: PedestrianSignals = { waitSeconds: (_fx, _fz, _tx, _tz, seconds) => Math.max(0, RED_UNTIL - seconds) };
const alwaysWalk: PedestrianSignals = { waitSeconds: () => 0 };

/** A pair of places (door to door) whose shortest walk crosses a road, found from the map: where a walker comes to a kerb. */
function placesAcrossARoad(graphMap: OpenWorldMap): { from: number; to: number } {
  const state = createCityState(SEED, graphMap, 60);
  const resident = state.cast.length;
  const first = resident * MAX_PATH_NODES;
  for (let from = 0; from < state.index.placeCount; from++) {
    for (let to = 0; to < state.index.placeCount; to++) {
      if (from === to || state.index.doorNode[from]! < 0 || state.index.doorNode[to]! < 0) continue;
      const count = state.finder.find(state.index.doorNode[from]!, state.index.doorNode[to]!, state.noFear, 1, state.pathNodes, first, MAX_PATH_NODES);
      for (let step = 0; step + 1 < count; step++) if (isCrossingBetween(state, state.pathNodes[first + step]!, state.pathNodes[first + step + 1]!)) return { from, to };
    }
  }
  throw new Error("no walk in the fixture crosses a road");
}

const ACROSS = placesAcrossARoad(map);

/** A city with \`signals\`, one resident staged at \`ACROSS.from\` and sent to \`ACROSS.to\` now. */
function planned(signals: PedestrianSignals | null, resident?: number): { state: CityState; resident: number } {
  const state = createCityState(SEED, map, 60, signals);
  const who = resident ?? state.cast.length;
  stageResident(state, who, { place: ACROSS.from, home: ACROSS.from, tick: START_TICK, nextDecision: START_TICK + DWELL_TICKS });
  state.floats[who * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.pace] = 1.4;
  expect(sendResidentTo(state, who, START_TICK, ACROSS.to, NEED.errand, DWELL_TICKS), "a walk was planned").toBe(true);
  return { state, resident: who };
}

describe("given a walker whose walk crosses a road, and lights that hold them at the kerb until a late second", () => {
  const withLights = planned(redForAWhile);
  const without = planned(null);
  const { state, resident } = withLights;
  const base = resident * RESIDENT_INT_STRIDE;
  const first = resident * MAX_PATH_NODES;

  it("when the walk is planned, then it keeps a wait at the kerb of the crossing, and is that long again as a leg", () => {
    expect(intAt(state, resident, RESIDENT_INT.waitCount), "waits kept in the leg").toBeGreaterThanOrEqual(1);
    expect(intAt(state, resident, RESIDENT_INT.waitCount), "waits kept in the leg").toBeLessThanOrEqual(MAX_WAITS);
    const waited = intAt(state, resident, RESIDENT_INT.waitTicks0);
    const crossingNode = state.pathNodes[first + intAt(state, resident, RESIDENT_INT.waitIndex0)]!;
    expect(isCrossingBetween(state, crossingNode, state.pathNodes[first + intAt(state, resident, RESIDENT_INT.waitIndex0) + 1]!), "the wait is at a kerb node, ahead of a crossing").toBe(true);
    expect(waited, "ticks of the first wait: until the lights give the walk").toBeGreaterThan(0);
    expect(intAt(without.state, without.resident, RESIDENT_INT.waitCount), "waits without lights").toBe(0);
    const total = intAt(state, resident, RESIDENT_INT.arriveTick) - intAt(state, resident, RESIDENT_INT.departTick);
    const plain = intAt(without.state, without.resident, RESIDENT_INT.arriveTick) - intAt(without.state, without.resident, RESIDENT_INT.departTick);
    let waitedTicks = 0;
    for (let wait = 0; wait < intAt(state, resident, RESIDENT_INT.waitCount); wait++) waitedTicks += intAt(state, resident, RESIDENT_INT.waitTicks0 + wait);
    expect(total - plain, "ticks the leg is longer by").toBe(waitedTicks);
  });

  it("when they are drawn through the wait, then they walk to the kerb, stand there not moving, and walk on across when it ends, reaching the door at the leg's end", () => {
    const pose = new LegPose();
    const depart = intAt(state, resident, RESIDENT_INT.departTick) / DECISION_HZ;
    const index = intAt(state, resident, RESIDENT_INT.waitIndex0);
    const pace = state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed]!;
    const reach = depart + state.pathDistance[first + index]! / pace;
    const held = intAt(state, resident, RESIDENT_INT.waitTicks0) / DECISION_HZ;
    const kerb = state.pathNodes[first + index]!;
    const { nodeX, nodeZ } = state.map.graph;
    const before = legPose(state, resident, reach - 1, pose);
    expect([before, pose.waiting, pose.speed.toFixed(3)].join("/"), "on its way to the kerb: on a leg, not waiting, at its pace").toBe([true, false, pace.toFixed(3)].join("/"));
    legPose(state, resident, reach + 0.25, pose);
    const [heldX, heldZ] = [pose.x, pose.z];
    expect(hypot2(heldX - nodeX[kerb]!, heldZ - nodeZ[kerb]!), "metres from the kerb node: their own lateral offset at most").toBeLessThanOrEqual(LATERAL_MAX + 0.01);
    for (const seconds of [reach + 0.25, reach + held / 2, reach + held - 0.25]) {
      legPose(state, resident, seconds, pose);
      expect([pose.x.toFixed(3), pose.z.toFixed(3), pose.waiting, pose.speed].join("/"), `still where they stood at ${seconds} s`).toBe([heldX.toFixed(3), heldZ.toFixed(3), true, 0].join("/"));
    }
    legPose(state, resident, reach + held + 1, pose);
    expect([pose.waiting, pose.speed.toFixed(3)].join("/"), "across: not waiting, at its pace").toBe([false, pace.toFixed(3)].join("/"));
    expect(hypot2(pose.x - heldX, pose.z - heldZ), "metres it has gone from where it stood a second after the wait").toBeCloseTo(pace, 1);
    const arrive = intAt(state, resident, RESIDENT_INT.arriveTick) / DECISION_HZ;
    expect(legPose(state, resident, arrive - 0.01, pose), "still on the leg just before its end").toBe(true);
    const door = state.index.doorNode[ACROSS.to]!;
    expect(hypot2(pose.x - nodeX[door]!, pose.z - nodeZ[door]!), "metres from the door just before the leg's end").toBeLessThan(pace * 0.05 + 0.5);
    expect(intAt(state, resident, RESIDENT_INT.nextDecisionTick) - intAt(state, resident, RESIDENT_INT.arriveTick), "dwell after the leg").toBe(DWELL_TICKS);
    expect(base, "row base").toBeGreaterThanOrEqual(0);
  });
});

describe("given lights that always give the walk", () => {
  it("when a walk across a road is planned, then there is no wait and the leg is as long as without lights", () => {
    const { state, resident } = planned(alwaysWalk);
    const plain = planned(null);
    expect(intAt(state, resident, RESIDENT_INT.waitCount), "waits").toBe(0);
    expect(intAt(state, resident, RESIDENT_INT.arriveTick), "tick the leg ends at").toBe(intAt(plain.state, plain.resident, RESIDENT_INT.arriveTick));
  });
});

describe("given the walkers of eight cities planned across the same road against lights that hold them", () => {
  const waiters: number[] = [];
  const darters: number[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const state = createCityState(seed, map, 60, redForAWhile);
    for (let resident = state.cast.length; resident < state.capacity; resident++) {
      if (state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.alive] !== 1) continue;
      stageResident(state, resident, { place: ACROSS.from, home: ACROSS.from, tick: START_TICK, nextDecision: START_TICK + DWELL_TICKS });
      state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.pace] = 1.4;
      sendResidentTo(state, resident, START_TICK, ACROSS.to, NEED.errand, DWELL_TICKS);
      (intAt(state, resident, RESIDENT_INT.waitCount) > 0 ? waiters : darters).push(residentNeuroticism(state, resident));
    }
  }
  const mean = (list: readonly number[]): number => list.reduce((sum, value) => sum + value, 0) / list.length;

  it("when each decides, then most wait and a few go against the light, the jumpy likelier to", () => {
    const share = darters.length / (darters.length + waiters.length);
    expect(darters.length + waiters.length, "walkers planned").toBeGreaterThan(200);
    expect(share, "share who go against the light").toBeGreaterThan(0.08);
    expect(share, "share who go against the light").toBeLessThan(0.25);
    expect(mean(darters) - mean(waiters), "mean neuroticism of those who go against it over those who wait").toBeGreaterThan(JUMPY_GAP);
  });
});

/** A game day and a half of the fixture city with the open world's lights, stepped by its own tick and by a peer that only hears the answers. */
describe("given the neighbourhood living a game day and a half with lights at its crossings", () => {
  const state = createCityState(SEED, map, 60, openWorldSignals());
  const mirror = createCityState(SEED, map, 60, openWorldSignals());
  let mostWaiting = 0;
  for (let tick = 0; tick < (TICKS_PER_GAME_DAY * 3) / 2; tick++) {
    applyAnswer(mirror, computeTick(state, tick));
    if (tick % 60 !== 0) continue;
    let waiting = 0;
    for (let resident = 0; resident < state.capacity; resident++) if (intAt(state, resident, RESIDENT_INT.waitCount) > 0 && intAt(state, resident, RESIDENT_INT.pathCount) > 0 && tick < intAt(state, resident, RESIDENT_INT.arriveTick)) waiting++;
    mostWaiting = Math.max(mostWaiting, waiting);
  }

  it("when it has lived, then walkers had waits at kerbs, and a peer that only hears the answers holds the same city", () => {
    expect(mostWaiting, "most walkers on a leg with a wait at once").toBeGreaterThan(0);
    expect(stateDigest(mirror), "digest of the whole state").toBe(stateDigest(state));
  });
});
