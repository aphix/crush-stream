import { describe, expect, it } from "vitest";
import { launch, pooledCar } from "../../contact/crash-scenarios.test-util.ts";
import { hypot2 } from "../../kernel/physics-core.js";
import { ACTIVITY, ACTIVITY_SECONDS } from "./civilian-activity.ts";
import { DECISION_HZ, EVENT_KIND, EVENT_TRIPLE, MAX_PATH_NODES, NEVER_TICK, PURPOSE, RESIDENT_FLOAT, RESIDENT_FLOAT_STRIDE, RESIDENT_INT, RESIDENT_INT_STRIDE, SPECIES } from "./civilian-constants.ts";
import { BODY_GAP, HARD_DISTANCE, MAX_OFFSET, WALKER_PUSH_DISTANCE } from "./civilian-crowd-constants.ts";
import { FRAME_SECONDS, newCrowd, stepUntilShown } from "./civilian-crowd.test-util.ts";
import type { CivilianCrowd } from "./civilian-crowd.ts";
import { buildFixtureMap } from "./civilian-graph.test-util.ts";
import { LegPose, legPose } from "./civilian-leg.ts";

const map = buildFixtureMap();
const PACE = 1.4;
/** A street edge this long (m) leaves room for two to meet and part on it. */
const LONG_EDGE = 20;
const AFTER_PASSING_SECONDS = 3;
/** What the relaxation leaves of an overlap (m). */
const RESIDUAL = 0.005;
/** Float32 spots round to this (m). */
const FLOAT_ERROR = 1e-3;
/** Past a figure's reach (0.3 m) and inside a car's nudge gap (0.5 m). */
const NUDGE_OFFSET = 0.4;
const FAR_OFFSET = 3;
const STRETCH_SECONDS = 600;
const STRETCH_STEP_SECONDS = 0.25;

function longEdge(): { from: number; to: number; length: number } {
  const { nodeX, nodeZ, edgeStart, edgeTo, edgeLength, edgeCrossing } = map.graph;
  for (let node = 0; node < nodeX.length; node++) {
    for (let edge = edgeStart[node]!; edge < edgeStart[node + 1]!; edge++) {
      if (edgeLength[edge]! >= LONG_EDGE && edgeCrossing[edge] === 0) return { from: node, to: edgeTo[edge]!, length: hypot2(nodeX[edgeTo[edge]!]! - nodeX[node]!, nodeZ[edgeTo[edge]!]! - nodeZ[node]!) };
    }
  }
  throw new Error(`the fixture map has no street edge of ${LONG_EDGE} m`);
}

const EDGE = longEdge();
const EDGE_DIR_X = (map.graph.nodeX[EDGE.to]! - map.graph.nodeX[EDGE.from]!) / EDGE.length;
const EDGE_DIR_Z = (map.graph.nodeZ[EDGE.to]! - map.graph.nodeZ[EDGE.from]!) / EDGE.length;

function people(crowd: CivilianCrowd, count: number): number[] {
  const found: number[] = [];
  for (let resident = 0; resident < crowd.poses.count && found.length < count; resident++) {
    if (crowd.state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.species] === SPECIES.person) found.push(resident);
  }
  return found;
}

/** `resident` walks straight from node `from` to node `to` at `PACE` m/s from the first second, on the street's middle, and decides nothing more. */
function sendAlong(crowd: CivilianCrowd, resident: number, from: number, to: number): void {
  const { state } = crowd;
  const first = resident * MAX_PATH_NODES;
  const intBase = resident * RESIDENT_INT_STRIDE;
  state.pathNodes[first] = from;
  state.pathNodes[first + 1] = to;
  state.pathDistance[first] = 0;
  state.pathDistance[first + 1] = EDGE.length;
  state.ints[intBase + RESIDENT_INT.pathCount] = 2;
  state.ints[intBase + RESIDENT_INT.departTick] = 0;
  state.ints[intBase + RESIDENT_INT.arriveTick] = Math.ceil((EDGE.length / PACE) * DECISION_HZ) + 1;
  state.ints[intBase + RESIDENT_INT.nextDecisionTick] = NEVER_TICK;
  state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed] = PACE;
  state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.lateral] = 0;
}

const pushesOf = (crowd: CivilianCrowd): { victim: number; pusher: number }[] => {
  const log = crowd.eventLog();
  const found: { victim: number; pusher: number }[] = [];
  for (let at = 0; at + EVENT_TRIPLE <= log.length; at += EVENT_TRIPLE) {
    if (log[at] !== EVENT_KIND.push) continue;
    const subject = log[at + 1]!;
    found.push({ victim: subject % crowd.poses.count, pusher: Math.floor(subject / crowd.poses.count) - 1 });
  }
  return found;
};

function expectOnePushByNoCivilian(crowd: CivilianCrowd, victim: number): void {
  const pushes = pushesOf(crowd).filter((push) => push.victim === victim);
  expect(pushes.length, "pushes of them").toBe(1);
  expect(pushes[0]!.pusher, "pushed by a civilian").toBe(-1);
}

describe.each([true, false])("given two civilians walking at each other along one street, on the same line (host: %s)", (authority) => {
  const crowd = newCrowd(map);
  const [first, second] = people(crowd, 2) as [number, number];
  sendAlong(crowd, first, EDGE.from, EDGE.to);
  sendAlong(crowd, second, EDGE.to, EDGE.from);
  let minDrawnGap = Infinity;
  let minBrainGap = Infinity;
  let maxOffset = 0;
  let bumpFrames = 0;
  let bumpStartClock = -1;
  let bumpsPointAtEachOther = true;
  for (let seconds = FRAME_SECONDS; seconds < EDGE.length / (2 * PACE) + AFTER_PASSING_SECONDS; seconds += FRAME_SECONDS) {
    crowd.step(seconds, [], authority);
    const { shown, x, z, activity, activityClock, partner } = crowd.poses;
    const { brainX, brainZ, drawX, drawZ } = crowd.separation;
    if (shown[first] === 0 || shown[second] === 0) continue;
    minDrawnGap = Math.min(minDrawnGap, hypot2(x[first]! - x[second]!, z[first]! - z[second]!));
    minBrainGap = Math.min(minBrainGap, hypot2(brainX[first]! - brainX[second]!, brainZ[first]! - brainZ[second]!));
    maxOffset = Math.max(maxOffset, hypot2(drawX[first]! - brainX[first]!, drawZ[first]! - brainZ[first]!), hypot2(drawX[second]! - brainX[second]!, drawZ[second]! - brainZ[second]!));
    if (activity[first] !== ACTIVITY.bump) continue;
    bumpFrames++;
    if (bumpStartClock < 0) bumpStartClock = activityClock[first]!;
    bumpsPointAtEachOther = bumpsPointAtEachOther && activity[second] === ACTIVITY.bump && partner[first] === second && partner[second] === first;
  }

  it("when they pass, then the brain has them through each other but no frame draws them closer than a body's width, within the bound of the brain's spots", () => {
    expect(minBrainGap, "closest the brain has them").toBeLessThan(HARD_DISTANCE);
    expect(minDrawnGap, "closest drawn").toBeGreaterThanOrEqual(BODY_GAP - RESIDUAL);
    expect(maxOffset, "furthest drawn from the brain's spot").toBeLessThanOrEqual(MAX_OFFSET + FLOAT_ERROR);
  });

  it("when they pass, then both play the bump clip against each other for its length from its first second, on a client as on the host", () => {
    expect(bumpFrames, "frames of the clip").toBe(Math.ceil(ACTIVITY_SECONDS.bump / FRAME_SECONDS));
    expect(bumpStartClock, "the clip's clock on its first frame").toBe(0);
    expect(bumpsPointAtEachOther, "each bump has the other as its partner").toBe(true);
  });

  it(authority ? "when the host's log is read, then it holds one push, between the two of them" : "when the client's log is read, then it holds nothing: only the host reports a push", () => {
    const pushes = pushesOf(crowd).filter((push) => push.victim === first || push.victim === second);
    if (!authority) {
      expect(pushes.length, "pushes the client logged").toBe(0);
      return;
    }
    expect(pushes.length, "pushes").toBe(1);
    expect(Math.min(pushes[0]!.victim, pushes[0]!.pusher), "lower of the two in it").toBe(Math.min(first, second));
    expect(Math.max(pushes[0]!.victim, pushes[0]!.pusher), "higher of the two in it").toBe(Math.max(first, second));
  });
});

describe("given a civilian walking along a street and a player on foot standing in their way", () => {
  function walkPast(walkerAt: number | null, authority: boolean) {
    const crowd = newCrowd(map);
    const [walker] = people(crowd, 1) as [number];
    sendAlong(crowd, walker, EDGE.from, EDGE.to);
    const standX = map.graph.nodeX[EDGE.from]! + EDGE_DIR_X * (walkerAt ?? 0);
    const standZ = map.graph.nodeZ[EDGE.from]! + EDGE_DIR_Z * (walkerAt ?? 0);
    let minDrawnGap = Infinity;
    let minBrainGap = Infinity;
    for (let seconds = FRAME_SECONDS; seconds < EDGE.length / PACE; seconds += FRAME_SECONDS) {
      crowd.walkers.clear();
      if (walkerAt !== null) crowd.walkers.add(standX, standZ, 0, 0);
      crowd.step(seconds, [], authority);
      if (crowd.poses.shown[walker] === 0 || walkerAt === null) continue;
      minDrawnGap = Math.min(minDrawnGap, hypot2(crowd.poses.x[walker]! - standX, crowd.poses.z[walker]! - standZ));
      minBrainGap = Math.min(minBrainGap, hypot2(crowd.separation.brainX[walker]! - standX, crowd.separation.brainZ[walker]! - standZ));
    }
    return { crowd, walker, minDrawnGap, minBrainGap };
  }
  const MIDDLE = Math.min(EDGE.length / 2, 10);

  it("when they walk into him, then they are drawn a body's width round him though the brain walks them through him, and the host logs a push of them by no civilian", () => {
    const { crowd, walker, minDrawnGap, minBrainGap } = walkPast(MIDDLE, true);
    expect(minBrainGap, "closest the brain has them").toBeLessThan(WALKER_PUSH_DISTANCE);
    expect(minDrawnGap, "closest drawn").toBeGreaterThanOrEqual(BODY_GAP - RESIDUAL);
    expectOnePushByNoCivilian(crowd, walker);
  });

  it("when the crowd is a client's, then they are drawn round him all the same and nothing is logged", () => {
    const { crowd, minDrawnGap } = walkPast(MIDDLE, false);
    expect(minDrawnGap, "closest drawn").toBeGreaterThanOrEqual(BODY_GAP - RESIDUAL);
    expect(pushesOf(crowd).length, "pushes").toBe(0);
  });

  it("when no one stands in their way, then nothing of theirs is logged", () => {
    const { crowd, walker } = walkPast(null, true);
    expect(pushesOf(crowd).filter((push) => push.victim === walker).length, "pushes of them").toBe(0);
  });
});

describe("given a civilian walking along a street and a car driving beside them at their pace", () => {
  function drivePast(sideways: number) {
    const crowd = newCrowd(map);
    const [walker] = people(crowd, 1) as [number];
    sendAlong(crowd, walker, EDGE.from, EDGE.to);
    const car = pooledCar(0);
    const yaw = Math.atan2(EDGE_DIR_X, EDGE_DIR_Z);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const reachRight = car.cage.fields.planBox[1]! + sideways;
    const pose = new LegPose();
    launch(car, 0, 0, yaw, EDGE_DIR_X * PACE, EDGE_DIR_Z * PACE);
    let struck = 0;
    for (let seconds = FRAME_SECONDS; seconds < EDGE.length / PACE; seconds += FRAME_SECONDS) {
      if (legPose(crowd.state, walker, seconds, pose)) car.group.position.set(pose.x - rightX * reachRight, car.group.position.y, pose.z - rightZ * reachRight);
      crowd.step(seconds, [car], true);
      struck += crowd.takeStrikes().length;
    }
    return { crowd, walker, struck };
  }

  it("when the car's side passes within a nudge of them, then it logs a push of them by no civilian and runs no one down", () => {
    const { crowd, walker, struck } = drivePast(NUDGE_OFFSET);
    expect(struck, "run down").toBe(0);
    expectOnePushByNoCivilian(crowd, walker);
  });

  it("when the car keeps its distance, then nothing is logged", () => {
    const { crowd, walker } = drivePast(FAR_OFFSET);
    expect(pushesOf(crowd).filter((push) => push.victim === walker).length, "pushes of them").toBe(0);
  });
});

describe.each([60])("given a host crowd of %i residents over ten minutes of its day", (residents) => {
  const crowd = newCrowd(map, residents);
  let seconds = stepUntilShown(crowd);
  const end = seconds + STRETCH_SECONDS;
  let overlappingFrames = 0;
  let framesBrainOverlaps = 0;
  let maxOffset = 0;
  for (; seconds < end; seconds += STRETCH_STEP_SECONDS) {
    crowd.step(seconds, [], true);
    const { shown, x, z } = crowd.poses;
    const { brainX, brainZ } = crowd.separation;
    let drawnOverlap = false;
    let brainOverlap = false;
    for (let first = 0; first < crowd.poses.count; first++) {
      if (shown[first] === 0) continue;
      maxOffset = Math.max(maxOffset, hypot2(x[first]! - brainX[first]!, z[first]! - brainZ[first]!));
      for (let second = first + 1; second < crowd.poses.count; second++) {
        if (shown[second] === 0) continue;
        drawnOverlap = drawnOverlap || hypot2(x[first]! - x[second]!, z[first]! - z[second]!) < BODY_GAP - RESIDUAL;
        brainOverlap = brainOverlap || hypot2(brainX[first]! - brainX[second]!, brainZ[first]! - brainZ[second]!) < BODY_GAP;
      }
    }
    if (drawnOverlap) overlappingFrames++;
    if (brainOverlap) framesBrainOverlaps++;
  }
  if (process.env.SEPARATION_PRINT) console.log(`civilian separation at ${residents}: frames with a drawn overlap ${overlappingFrames}, frames the brain overlaps ${framesBrainOverlaps}, furthest drawn from the brain ${maxOffset.toFixed(3)} m`);

  it("when the stretch is over, then the brain has had civilians through each other and no frame drew two of them closer than a body's width", () => {
    expect(framesBrainOverlaps, "frames the brain overlaps").toBeGreaterThan(0);
    expect(overlappingFrames, "frames with a drawn overlap").toBe(0);
    expect(maxOffset, "furthest drawn from the brain's spot").toBeLessThanOrEqual(MAX_OFFSET + FLOAT_ERROR);
  });
});

describe("given a civilian on a leg that is a drive", () => {
  it("when the crowd is stepped, then they are shown walking until the leg is a drive, and then not shown: the car is another's to draw", () => {
    const crowd = newCrowd(map);
    const [resident] = people(crowd, 1) as [number];
    sendAlong(crowd, resident, EDGE.from, EDGE.to);
    crowd.step(1, [], true);
    expect(crowd.poses.shown[resident], "shown on a walk").toBe(1);
    crowd.state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.legPurpose] = PURPOSE.drive;
    crowd.step(1 + FRAME_SECONDS, [], true);
    expect(crowd.poses.shown[resident], "shown on a drive").toBe(0);
  });
});
