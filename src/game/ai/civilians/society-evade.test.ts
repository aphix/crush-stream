import { describe, expect, it } from "vitest";
import { detAtan2, detCos, hypot2 } from "../../kernel/physics-core.js";
import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import { ACTIVITY } from "./civilian-activity.ts";
import {
  ALARM_DELAY_STEPS_PER_SECOND,
  CENTIMETRES_PER_METRE,
  DECISION_HZ,
  EVADE_HOLD_SECONDS,
  EVADE_PACE_CALM,
  EVADE_PACE_JUMPY,
  EVADE_REACH,
  EVENT_KIND,
  EVENT_LEAD_TICKS,
  MAX_PATH_NODES,
  NEVER_TICK,
  RESIDENT_FLOAT,
  RESIDENT_FLOAT_STRIDE,
  RESIDENT_INT,
  RESIDENT_INT_STRIDE,
} from "./civilian-constants.ts";
import { PACE, people, sendAlong, type StreetEdge } from "./civilian-crowd-contact.test-util.ts";
import { newCrowd } from "./civilian-crowd.test-util.ts";
import { applyReactionEvents, queueEvents } from "./civilian-events.ts";
import { buildFixtureMap } from "./civilian-graph.test-util.ts";
import { LegPose, legPose } from "./civilian-leg.ts";
import { measurePath, type CityState } from "./civilian-state.ts";
import { residentNeuroticism } from "./civilian-temperament.ts";
import { createCityState } from "./society.ts";
import { ActivityReading, readActivity } from "./society-activity.ts";
import { streetEdge } from "./civilian-crowd-contact.test-util.ts";

const map = buildFixtureMap();
const SEED = 5;
/** Seconds a stage lasts: well past the longest evasion. */
const STAGE_SECONDS = 60;
/** The frame step the poses are walked at (a power of two). */
const STEP = 1 / 16;
const STEP_SLACK = 1.05;
const MIN_CROSSING = 6;
/** The tick the danger is heard at, for the walkers who have been walking since tick 0. */
const DANGER_TICK = 16 * DECISION_HZ;
/** Metres onto the crossing a walker is when the danger is heard, and seconds after they notice it that they are looked at. */
const FEW_METRES = 4;
const EVADING_SOON = 0.1;
/** Seconds into a walk that a car leaves: after everything a staged walker does. */
const LEAVES_AT = 200;

/** The shortest road crossing of the map with at least `MIN_CROSSING` m: where a walker is out on the road. */
function crossingEdge(graphMap: OpenWorldMap): StreetEdge {
  const { nodeX, nodeZ, edgeStart, edgeTo, edgeCrossing } = graphMap.graph;
  let best: StreetEdge | null = null;
  for (let node = 0; node < nodeX.length; node++) {
    for (let edge = edgeStart[node]!; edge < edgeStart[node + 1]!; edge++) {
      if (edgeCrossing[edge] === 0) continue;
      const to = edgeTo[edge]!;
      const length = hypot2(nodeX[to]! - nodeX[node]!, nodeZ[to]! - nodeZ[node]!);
      if (length >= MIN_CROSSING && (best === null || length < best.length)) best = { from: node, to, length, dirX: (nodeX[to]! - nodeX[node]!) / length, dirZ: (nodeZ[to]! - nodeZ[node]!) / length };
    }
  }
  if (best === null) throw new Error("the map has no road crossing");
  return best;
}

const CROSSING = crossingEdge(map);
const SIDEWALK = streetEdge(map, 20);
const MIDDLE_X = (map.graph.nodeX[CROSSING.from]! + map.graph.nodeX[CROSSING.to]!) / 2;
const MIDDLE_Z = (map.graph.nodeZ[CROSSING.from]! + map.graph.nodeZ[CROSSING.to]!) / 2;

type Stage = { state: CityState; resident: number; walked: (seconds: number) => number; startSeconds: number };

/** A walker crossing `edge` at the pace, who noticed a hazard `hazardMetres` from its middle when it had walked `fraction` of the edge. */
function walkerOn(edge: StreetEdge, fraction: number, options: { hazardMetres?: number; resident?: number; hazardAtStart?: boolean } = {}): Stage {
  const state = createCityState(SEED, map, 60);
  const resident = options.resident ?? state.cast.length;
  const intBase = resident * RESIDENT_INT_STRIDE;
  const first = resident * MAX_PATH_NODES;
  state.pathNodes[first] = edge.from;
  state.pathNodes[first + 1] = edge.to;
  state.ints[intBase + RESIDENT_INT.pathCount] = 2;
  state.ints[intBase + RESIDENT_INT.departTick] = 0;
  state.ints[intBase + RESIDENT_INT.arriveTick] = Math.ceil((edge.length / PACE + STAGE_SECONDS) * DECISION_HZ);
  state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed] = PACE;
  state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.lateral] = 0;
  measurePath(state, resident);
  const startSeconds = (fraction * edge.length) / PACE;
  state.ints[intBase + RESIDENT_INT.alarmTick] = Math.round(startSeconds * DECISION_HZ);
  state.ints[intBase + RESIDENT_INT.alarmDelay] = 0;
  const hazardAt = options.hazardAtStart === true ? 0 : 0.5;
  const hazardX = state.map.graph.nodeX[edge.from]! + edge.dirX * edge.length * hazardAt + (options.hazardMetres ?? 0);
  const hazardZ = state.map.graph.nodeZ[edge.from]! + edge.dirZ * edge.length * hazardAt;
  state.ints[intBase + RESIDENT_INT.alarmX] = Math.round(hazardX * CENTIMETRES_PER_METRE);
  state.ints[intBase + RESIDENT_INT.alarmZ] = Math.round(hazardZ * CENTIMETRES_PER_METRE);
  return { state, resident, walked: (seconds) => Math.min(edge.length, PACE * seconds), startSeconds: state.ints[intBase + RESIDENT_INT.alarmTick]! / DECISION_HZ };
}

const pose = new LegPose();

/** Metres from the edge's first node that resident `stage.resident` stands at `seconds`, projected on the edge, with the pose's speed and whether they are evading. */
function along(stage: Stage, edge: StreetEdge, seconds: number): { walked: number; speed: number; evading: boolean } {
  expect(legPose(stage.state, stage.resident, seconds, pose), `on its leg at ${seconds} s`).toBe(true);
  const { nodeX, nodeZ } = stage.state.map.graph;
  return { walked: (pose.x - nodeX[edge.from]!) * edge.dirX + (pose.z - nodeZ[edge.from]!) * edge.dirZ, speed: pose.speed, evading: pose.evading };
}

/** The pace a walker is staged at as the brain holds it (a Float32). */
function paceOf(state: CityState, resident: number): number {
  return state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed]!;
}

/** The walker's run when it clears a road: its pace times a hurry or a run by its neuroticism. */
function runOf(state: CityState, resident: number): number {
  return paceOf(state, resident) * (EVADE_PACE_CALM + (EVADE_PACE_JUMPY - EVADE_PACE_CALM) * residentNeuroticism(state, resident));
}

describe("given a walker who has gone seven tenths of the way over a road crossing when a hazard is seen near it", () => {
  const stage = walkerOn(CROSSING, 0.7);
  const run = runOf(stage.state, stage.resident);
  const toKerb = (0.3 * CROSSING.length) / run;
  const start = stage.startSeconds;

  it("when the hazard has not been seen yet, then it walks its schedule: at its pace, not evading", () => {
    const before = along(stage, CROSSING, start - 0.25);
    expect(before.walked, "metres along").toBeCloseTo(stage.walked(start - 0.25), 3);
    expect([before.speed.toFixed(5), before.evading].join("/"), "speed and evading").toBe([PACE.toFixed(5), false].join("/"));
  });

  it("when it is seen, then they hurry to the kerb ahead, which is nearer, at their run, faster than the schedule", () => {
    const during = along(stage, CROSSING, start + toKerb / 2);
    expect(during.walked, "metres along midway to the kerb").toBeCloseTo(0.7 * CROSSING.length + run * (toKerb / 2), 2);
    expect(during.speed, "metres a second").toBeCloseTo(run, 6);
    expect(during.evading, "evading").toBe(true);
    expect(run, "their run is faster than their pace").toBeGreaterThan(PACE);
  });

  it("when they are at the kerb ahead, then they wait there for their schedule to come level, not moving, and then walk on at their pace", () => {
    const at = along(stage, CROSSING, start + toKerb + 0.2);
    expect(at.walked, "metres along at the kerb").toBeCloseTo(CROSSING.length, 3);
    expect([at.speed, at.evading].join("/"), "speed and evading while they wait").toBe([0, true].join("/"));
    const level = along(stage, CROSSING, CROSSING.length / PACE + 0.25);
    expect([level.speed.toFixed(5), level.evading].join("/"), "speed and evading once the schedule is level").toBe([PACE.toFixed(5), false].join("/"));
  });
});

describe("given a walker who has gone three tenths of the way over when a hazard is seen near it", () => {
  const stage = walkerOn(CROSSING, 0.3);
  const run = runOf(stage.state, stage.resident);
  const start = stage.startSeconds;
  const there = paceOf(stage.state, stage.resident) * start;
  const back = there / run;

  it("when it is seen, then they hurry back to the kerb behind, which is nearer: going backwards, facing the way they go", () => {
    const during = along(stage, CROSSING, start + back / 2);
    expect(during.walked, "metres along midway back").toBeCloseTo(there - run * (back / 2), 2);
    expect(during.speed, "metres a second").toBeCloseTo(-run, 6);
    expect(detCos(pose.yaw - detAtan2(-CROSSING.dirX, -CROSSING.dirZ)), "facing back along the crossing (cosine of the angle to it)").toBeGreaterThan(0.999);
  });

  it("when they are back at the kerb, then they wait for the danger to pass, not moving, then hurry forward to meet their schedule, and walk on at their pace", () => {
    const waiting = along(stage, CROSSING, start + back + EVADE_HOLD_SECONDS / 2);
    expect([waiting.walked.toFixed(3), waiting.speed, waiting.evading].join("/"), "metres, speed and evading while they wait").toBe(["0.000", 0, true].join("/"));
    const catching = along(stage, CROSSING, start + back + EVADE_HOLD_SECONDS + 0.5);
    expect([catching.speed.toFixed(6), catching.evading].join("/"), "speed and evading while they catch up").toBe([run.toFixed(6), true].join("/"));
    const pace = paceOf(stage.state, stage.resident);
    const rejoin = (run * (start + back + EVADE_HOLD_SECONDS)) / (run - pace);
    const before = along(stage, CROSSING, rejoin - 1);
    expect(before.evading, "evading a second before they meet their schedule").toBe(true);
    const rejoined = along(stage, CROSSING, rejoin + 1);
    expect([rejoined.speed.toFixed(5), rejoined.evading].join("/"), "speed and evading just after").toBe([PACE.toFixed(5), false].join("/"));
    expect(rejoined.walked, "on the schedule again").toBeCloseTo(stage.walked(rejoin + 1), 3);
  });

  it("when they are drawn a frame at a time through all of it, then they never jump: no frame moves them further than their run allows", () => {
    let last = along(stage, CROSSING, start - STEP).walked;
    let most = 0;
    for (let seconds = start; seconds < CROSSING.length / PACE + STAGE_SECONDS - 1; seconds += STEP) {
      const now = along(stage, CROSSING, seconds).walked;
      most = Math.max(most, Math.abs(now - last));
      last = now;
    }
    expect(most, "most metres in one frame").toBeLessThanOrEqual(run * STEP * STEP_SLACK);
  });
});

describe("given the jumpiest and the calmest of the city, each on the crossing when the same hazard is seen", () => {
  const state = createCityState(SEED, map, 60);
  const living = Array.from({ length: state.capacity }, (_, resident) => resident).filter((resident) => resident >= state.cast.length && state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.alive] === 1);
  const byNeuroticism = living.slice().sort((first, second) => residentNeuroticism(state, first) - residentNeuroticism(state, second));
  const calm = byNeuroticism[0]!;
  const jumpy = byNeuroticism[byNeuroticism.length - 1]!;

  it("when they clear the road, then the jumpy one runs at the jumpy pace, the calm one hurries at the calm one, and the jumpy one is the quicker", () => {
    const quick = walkerOn(CROSSING, 0.7, { resident: jumpy });
    const slow = walkerOn(CROSSING, 0.7, { resident: calm });
    const quickSpeed = along(quick, CROSSING, quick.startSeconds + 0.1).speed;
    const slowSpeed = along(slow, CROSSING, slow.startSeconds + 0.1).speed;
    expect(quickSpeed, "the jumpy one's metres a second").toBeCloseTo(runOf(quick.state, jumpy), 6);
    expect(slowSpeed, "the calm one's metres a second").toBeCloseTo(runOf(slow.state, calm), 6);
    expect(quickSpeed, "the jumpy one is quicker").toBeGreaterThan(slowSpeed);
    expect(slowSpeed, "the calm one still hurries").toBeGreaterThanOrEqual(PACE * EVADE_PACE_CALM - 1e-9);
    expect(quickSpeed, "the jumpiest does not outrun a run").toBeLessThanOrEqual(PACE * EVADE_PACE_JUMPY);
  });
});

describe("given a hazard seen where no road is walked on, or far away, or before the walk began", () => {
  it("when the walker is on a sidewalk, then they keep their schedule: the flinch is all", () => {
    const stage = walkerOn(SIDEWALK, 0.5);
    const at = along(stage, SIDEWALK, stage.startSeconds + 0.5);
    expect(at.walked, "metres along").toBeCloseTo(stage.walked(stage.startSeconds + 0.5), 3);
    expect([at.speed.toFixed(5), at.evading].join("/"), "speed and evading").toBe([PACE.toFixed(5), false].join("/"));
  });

  it("when the hazard is farther than the reach from the crossing, then they keep their schedule", () => {
    const stage = walkerOn(CROSSING, 0.7, { hazardMetres: EVADE_REACH + CROSSING.length });
    const at = along(stage, CROSSING, stage.startSeconds + 0.5);
    expect([at.speed.toFixed(5), at.evading].join("/"), "speed and evading").toBe([PACE.toFixed(5), false].join("/"));
  });

  it("when the hazard was seen before this walk began, then they keep their schedule", () => {
    const stage = walkerOn(CROSSING, 0.7, { hazardAtStart: true });
    const base = stage.resident * RESIDENT_INT_STRIDE;
    stage.state.ints[base + RESIDENT_INT.departTick] = stage.state.ints[base + RESIDENT_INT.alarmTick]! + 1;
    const seconds = (stage.state.ints[base + RESIDENT_INT.alarmTick]! + 2) / DECISION_HZ;
    const at = along({ ...stage, startSeconds: 0 }, CROSSING, seconds);
    expect(at.evading, "evading").toBe(false);
    expect(at.walked, "metres along: on the schedule of the walk that began after the alarm").toBeCloseTo(paceOf(stage.state, stage.resident) * (seconds - stage.state.ints[base + RESIDENT_INT.departTick]! / DECISION_HZ), 3);
    expect(stage.state.ints[base + RESIDENT_INT.alarmTick], "the alarm is still the old one").not.toBe(NEVER_TICK);
  });

  it("when the walker is going to a car or has just got out of one, then nothing moves it off its leg's own timeline", () => {
    const stage = walkerOn(CROSSING, 0.7);
    const base = stage.resident * RESIDENT_INT_STRIDE;
    stage.state.ints[base + RESIDENT_INT.driveLeaveTick] = LEAVES_AT * DECISION_HZ;
    stage.state.ints[base + RESIDENT_INT.driveParkTick] = (LEAVES_AT + 10) * DECISION_HZ;
    stage.state.ints[base + RESIDENT_INT.driveFirst] = 1;
    stage.state.ints[base + RESIDENT_INT.driveLast] = 1;
    const at = along(stage, CROSSING, stage.startSeconds + 0.5);
    expect(at.evading, "evading on a leg by car").toBe(false);
    expect(at.walked, "metres along: on the walk to the car").toBeCloseTo(stage.walked(stage.startSeconds + 0.5), 3);
  });
});

describe("given thirty walkers a few metres onto the crossing when a danger is heard at the kerb they came from", () => {
  it("when the brain applies the danger, then the walkers it alarms clear the road, back to that kerb (not flinch where they stand): evading, and no recoil clip", () => {
    const city = createCityState(SEED, map, 60);
    const people = Array.from({ length: 30 }, (_, at) => city.cast.length + at);
    const onTheRoadFor = Math.ceil((FEW_METRES / PACE) * DECISION_HZ);
    for (const resident of people) {
      const base = resident * RESIDENT_INT_STRIDE;
      city.pathNodes[resident * MAX_PATH_NODES] = CROSSING.from;
      city.pathNodes[resident * MAX_PATH_NODES + 1] = CROSSING.to;
      city.ints[base + RESIDENT_INT.pathCount] = 2;
      city.ints[base + RESIDENT_INT.departTick] = DANGER_TICK - onTheRoadFor;
      city.ints[base + RESIDENT_INT.arriveTick] = DANGER_TICK + Math.ceil((CROSSING.length / PACE + STAGE_SECONDS) * DECISION_HZ);
      city.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed] = PACE;
      city.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.lateral] = 0;
      measurePath(city, resident);
    }
    queueEvents(city, DANGER_TICK, [EVENT_KIND.danger, CROSSING.from, DANGER_TICK / DECISION_HZ]);
    applyReactionEvents(city, DANGER_TICK + EVENT_LEAD_TICKS);
    const reading = new ActivityReading();
    let alarmed = 0;
    let evading = 0;
    let flinching = 0;
    for (const resident of people) {
      const started = city.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.alarmTick]!;
      if (started === NEVER_TICK) continue;
      alarmed++;
      const seconds = started / DECISION_HZ + city.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.alarmDelay]! / ALARM_DELAY_STEPS_PER_SECOND + EVADING_SOON;
      readActivity(city, resident, seconds, reading);
      legPose(city, resident, seconds, pose);
      if (pose.evading) evading++;
      if (reading.code === ACTIVITY.recoil) flinching++;
    }
    expect(alarmed, "walkers alarmed").toBeGreaterThan(0);
    expect(evading, "walkers clearing the road").toBe(alarmed);
    expect(flinching, "walkers flinching where they stand, on the road").toBe(0);
  });
});

describe("given the crowd's drawn walker clearing a crossing", () => {
  it("when it is stepped, then the poses carry the speed they really go at, faster than their pace, and nothing at the kerb", () => {
    const crowd = newCrowd(map);
    const [resident] = people(crowd, 1) as [number];
    sendAlong(crowd, resident, CROSSING, CROSSING.from, CROSSING.to);
    const base = resident * RESIDENT_INT_STRIDE;
    const startSeconds = 0.7 * (CROSSING.length / PACE);
    crowd.state.ints[base + RESIDENT_INT.alarmTick] = Math.round(startSeconds * DECISION_HZ);
    crowd.state.ints[base + RESIDENT_INT.alarmDelay] = 0;
    crowd.state.ints[base + RESIDENT_INT.alarmX] = Math.round(MIDDLE_X * CENTIMETRES_PER_METRE);
    crowd.state.ints[base + RESIDENT_INT.alarmZ] = Math.round(MIDDLE_Z * CENTIMETRES_PER_METRE);
    const run = runOf(crowd.state, resident);
    const dashing = startSeconds + (0.3 * CROSSING.length) / run / 2;
    crowd.step(Math.ceil(startSeconds) - 1, [], true);
    crowd.step(Math.floor(dashing * 16) / 16 + 1 / 16, [], true);
    expect(crowd.poses.shown[resident], "drawn").toBe(1);
    expect(crowd.poses.speed[resident], "metres a second they are drawn going at").toBeGreaterThan(PACE * 1.1);
  });
});
