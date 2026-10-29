import { describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { HIGH_JUMP_MEASURED, MINIGAME_MODE, STATION_ANCHORS, STATION_HALF_WIDTH } from "../scenes/minigame-constants.ts";
import { BOX_CELL_PITCH, BOX_COUNT, highJumpLayout } from "../scenes/minigame-high-jump.ts";
import { MinigameGround } from "../scenes/minigame-ground.ts";
import { lipHeight } from "../scenes/minigame-profile.ts";
import { setGround } from "../world/ground.ts";
import { RagdollSystem } from "./engine-ragdoll.ts";
import { loadedRagdolls } from "./ragdoll-throws.test-util.ts";
import { NET_HALF_WIDTH } from "./high-jump-art.ts";
import { BOX_POSE_FLOATS, type BoxPlacement } from "./ragdoll-boxes.ts";
import { STEP } from "./ragdoll-config.ts";

const FRAME = 1 / FRAME_HZ;
const STEPS_PER_FRAME = Math.round(FRAME / STEP);
const UP = new THREE.Vector3(0, 1, 0);

/** The shipped pile: the High jump's real layout (station-local), moved to the station's place in the world as the engine does, on the real ground. */
const layout = highJumpLayout(HIGH_JUMP_MEASURED, lipHeight(MINIGAME_MODE.highJump));
const anchor = STATION_ANCHORS.highJump;
const PLACEMENTS: readonly BoxPlacement[] = layout.boxes.map((box) => ({ ...box, x: box.x + anchor.x, z: box.z + anchor.z }));
const ground = new MinigameGround({ highJump: { netX: layout.netX, netHalfWidth: NET_HALF_WIDTH, netHeight: layout.netHeight, frame: layout } });

/** A stack: where its top box stands (world), its top (m above the pad) and how many boxes it holds. */
type Stack = { x: number; z: number; top: number; boxCount: number };

/**
 * The pile's stacks, tallest first: a base box is one that sits on the pad, its stack every box within half a cell of it. A stack within
 * a cell of the posts' plane is left out: the frame's lip slat hangs over it (and catches a dummy dropped from above, as the High jump
 * rows in `minigame-ground.test.ts` pin), so the drop never reaches the boxes.
 */
function stacksTallestFirst(): Stack[] {
  const baseTolerance = 1e-6;
  const bases = PLACEMENTS.filter((box) => box.y - box.height / 2 < baseTolerance);
  const stacks = bases.map((base) => {
    const members = PLACEMENTS.filter((box) => Math.hypot(box.x - base.x, box.z - base.z) < BOX_CELL_PITCH / 2);
    const highest = members.reduce((best, box) => (box.y + box.height / 2 > best.y + best.height / 2 ? box : best));
    return { x: highest.x, z: highest.z, top: highest.y + highest.height / 2, boxCount: members.length };
  });
  return stacks.filter((stack) => Math.abs(stack.x - (anchor.x + layout.postsX)) >= BOX_CELL_PITCH).sort((first, second) => second.top - first.top);
}
const STACKS = stacksTallestFirst();
const PILE_TOP = STACKS[0]!.top;
const PILE_MIN_X = Math.min(...PLACEMENTS.map((box) => box.x)) - BOX_CELL_PITCH / 2;
const PILE_MAX_X = Math.max(...PLACEMENTS.map((box) => box.x)) + BOX_CELL_PITCH / 2;
const PILE_MIN_Z = Math.min(...PLACEMENTS.map((box) => box.z)) - BOX_CELL_PITCH / 2;
const PILE_MAX_Z = Math.max(...PLACEMENTS.map((box) => box.z)) + BOX_CELL_PITCH / 2;

/** A ragdoll system on the real High jump ground as the range runs it, its dummies held lying where they land. */
async function system(boxes: readonly BoxPlacement[]): Promise<RagdollSystem> {
  const sys = await loadedRagdolls();
  setGround(ground);
  sys.update(FRAME, [], true, false, null);
  sys.holdThrown();
  sys.setBoxes(boxes);
  return sys;
}

function spawnDummy(sys: RagdollSystem, at: THREE.Vector3, velocity: THREE.Vector3): void {
  const lie = velocity.lengthSq() > 0 ? velocity.clone().normalize() : UP;
  sys["spawn"]({ car: 0, p: at, q: new THREE.Quaternion().setFromUnitVectors(UP, lie), v: velocity, w: new THREE.Vector3(), age: 0, cop: false, rides: true });
}

/** Where a dummy thrown straight up at `FAR_THROW_SPEED` keeps the world stepping from (world): on the flat between the High jump and Ring Fling stations, clear of both. */
const FAR_SPOT = new THREE.Vector3(anchor.x + 20, 1.5, anchor.z + 60);
/** 70 m/s up is 14.6 s of flight: longer than any window below that needs the world stepping without a box being touched. */
const FAR_THROW_SPEED = 70;

/** A dummy flying far from the pile: keeps the world stepping, touching no box. */
function flyFarAway(sys: RagdollSystem): void {
  spawnDummy(sys, FAR_SPOT.clone(), new THREE.Vector3(0, FAR_THROW_SPEED, 0));
}

/** A best run's horizontal speed at the posts (m/s): the sizing table's forward 3.9 m/s. */
const FORWARD_SPEED = 3.9;
/** How far over a stack's top he starts (m): the fall to it only adds gravity's 6 m. */
const START_OVER_TOP = 6;

/** A dummy dropped on `stack`'s top box, head first, at `speed` m/s down and `FORWARD_SPEED` along the throw, as a best run lands. */
function dropOnStack(sys: RagdollSystem, stack: Stack, speed: number): void {
  const flight = START_OVER_TOP / speed;
  spawnDummy(sys, new THREE.Vector3(stack.x - FORWARD_SPEED * flight, stack.top + START_OVER_TOP, stack.z), new THREE.Vector3(FORWARD_SPEED, -speed, 0));
}

const dummyOf = (sys: RagdollSystem) => sys["dolls"][0]!;
const boxBodiesOf = (sys: RagdollSystem) => sys["boxes"]["bodies"];

const _local = new THREE.Vector3();
const _turn = new THREE.Quaternion();
/** How deep (m, positive; 0 outside it) `point` is inside box `index` of the pile, whose pose is in `poses` (`copyBoxPoses`). */
function depthInside(poses: Float32Array, index: number, point: { x: number; y: number; z: number }): number {
  const o = index * BOX_POSE_FLOATS;
  const box = PLACEMENTS[index]!;
  _turn.set(poses[o + 3]!, poses[o + 4]!, poses[o + 5]!, poses[o + 6]!).invert();
  _local.set(point.x - poses[o]!, point.y - poses[o + 1]!, point.z - poses[o + 2]!).applyQuaternion(_turn);
  const clearance = Math.max(Math.abs(_local.x) - box.width / 2, Math.abs(_local.y) - box.height / 2, Math.abs(_local.z) - box.depth / 2);
  return Math.max(0, -clearance);
}

type Settle = { stillSeconds: number; simSeconds: number; deepestInside: number; lowestPart: number; farthestBoxMove: number; torso: THREE.Vector3 };

/** Run frames until the torso has lain still `stillWanted` s (or `limit` sim s), tracking how deep any part went into any box and how low any part went. */
function runUntilStill(sys: RagdollSystem, stillWanted: number, limit: number): Settle {
  const poses = new Float32Array(BOX_COUNT * BOX_POSE_FLOATS);
  const torso = new THREE.Vector3();
  const dummy = dummyOf(sys);
  let deepestInside = 0;
  let lowestPart = Infinity;
  let stillSeconds = -1;
  let frames = 0;
  for (; frames < limit * FRAME_HZ && stillSeconds < stillWanted; frames++) {
    sys.update(FRAME, [], true, false, null);
    stillSeconds = sys.latest(torso);
    sys.copyBoxPoses(poses);
    for (const part of dummy.bodies) {
      const centre = part.translation();
      lowestPart = Math.min(lowestPart, centre.y);
      for (let i = 0; i < BOX_COUNT; i++) deepestInside = Math.max(deepestInside, depthInside(poses, i, centre));
    }
  }
  return { stillSeconds, simSeconds: frames * FRAME, deepestInside, lowestPart, farthestBoxMove: currentMove(sys), torso };
}

/** The farthest any box (as `copyBoxPoses` reports it) is from its placement (m). */
function currentMove(sys: RagdollSystem): number {
  const poses = new Float32Array(BOX_COUNT * BOX_POSE_FLOATS);
  sys.copyBoxPoses(poses);
  let farthest = 0;
  for (let i = 0; i < BOX_COUNT; i++) {
    const o = i * BOX_POSE_FLOATS;
    const placement = PLACEMENTS[i]!;
    farthest = Math.max(farthest, Math.hypot(poses[o]! - placement.x, poses[o + 1]! - placement.y, poses[o + 2]! - placement.z));
  }
  return farthest;
}

const allAsleep = (sys: RagdollSystem) => boxBodiesOf(sys).every((body) => body.isSleeping());

/** Most a box may drift from where it was put while nothing touches it (m). */
const DRIFT_MAX = 0.05;
/** Lowest a part centre may be (m): under the pad by at most this much, as a 60 m/s landing on the pad itself sinks (measured 0.042 m at worst; the repo's other dummy-on-ground rows allow 0.05). */
const PAD_SOAK = 0.05;
/** A box lying on a face rests with its centre half an edge up; this much lower (m) is a box sunk into the pad. */
const BOX_SETTLE_SOAK = 0.02;
/** Sim seconds the torso must have lain under 0.4 m/s (`latest()`), and the sim time allowed to get there. */
const REST_HOLD = 1;
const REST_WITHIN = 20;
/** A box he hits moves at least this far (m). */
const BOX_HIT_MOVE = 0.1;
/** A restacked box is this near its placement (m). */
const RESTACK_TOLERANCE = 0.01;
/** A lying dummy's length (m): his torso may rest this far past the station's band, and counts as perched when it lies within this of a stack's top. */
const LYING_LENGTH = 2;
/** The drop that scatters boxes in the rows that need scattered boxes: the 4th tallest stack at the fastest landing (his shot there moves boxes 6 m; the tallest's at 60 m/s leaves him lying on top). */
const SCATTER_STACK = STACKS[3]!;
const SCATTER_SPEED = 60;
/** The drops that must show a moved box, and a rest near the pile (of 15; measured 14 and 13). */
const MOST_DROPS = 12;
/** Frames after a shot while the boxes still tumble (0.5 s). */
const HIT_FRAMES = FRAME_HZ / 2;
/** Impact speeds (m/s): where the sizing table's best runs come down on the pile. */
const IMPACT_SPEEDS = [40, 50, 60] as const;

describe("given the High jump's real pile of 48 cardboard boxes standing asleep on the real ground", () => {
  it("when the layout is read, then it holds 48 boxes in 3-high stacks of 1.6-2.6 m boxes at the station", () => {
    expect(PLACEMENTS.length, "box count").toBe(BOX_COUNT);
    expect(STACKS[0]!.boxCount, "the tallest stack is 3 boxes high").toBe(3);
    expect(PILE_TOP, `the tallest stack's top is ${PILE_TOP.toFixed(2)} m`).toBeGreaterThan(5);
    expect(PLACEMENTS.every((box) => box.z > anchor.z - 6 && box.z < anchor.z + 6), "the boxes stand in the lane at the station's z").toBeTruthy();
  });

  it("when nothing touches it while the world steps for 10 s, then no box drifts 5 cm and every box is still asleep", async () => {
    const sys = await system(PLACEMENTS);
    flyFarAway(sys);
    const stepsBefore = sys.stats.steps;
    for (let frame = 0; frame < 10 * FRAME_HZ; frame++) sys.update(FRAME, [], true, false, null);
    const stepped = sys.stats.steps - stepsBefore;
    const drift = currentMove(sys);
    const asleep = allAsleep(sys);
    sys.dispose();
    expect(stepped, `the world stepped ${stepped} times: a dummy was flying`).toBeGreaterThanOrEqual(10 * STEPS_PER_FRAME * FRAME_HZ - STEPS_PER_FRAME);
    expect(drift, `a box drifted ${drift.toFixed(3)} m`).toBeLessThan(DRIFT_MAX);
    expect(asleep, "every box is asleep").toBeTruthy();
  });

  it("when every box is woken and left untouched for 10 s, then the 3-high stacks hold: no box ends 5 cm from where it stood", async () => {
    const sys = await system(PLACEMENTS);
    flyFarAway(sys);
    for (let frame = 0; frame < 30; frame++) sys.update(FRAME, [], true, false, null);
    for (const body of boxBodiesOf(sys)) body.wakeUp();
    let maxDrift = 0;
    let awakeFrames = 0;
    for (let frame = 0; frame < 10 * FRAME_HZ; frame++) {
      sys.update(FRAME, [], true, false, null);
      maxDrift = Math.max(maxDrift, currentMove(sys));
      if (!sys["boxes"].asleep()) awakeFrames++;
    }
    sys.dispose();
    expect(awakeFrames, `the pile was awake for ${awakeFrames} frames: a jitter or a slow collapse is what that would show`).toBeGreaterThan(FRAME_HZ);
    expect(maxDrift, `a box moved ${maxDrift.toFixed(3)} m from its place`).toBeLessThan(DRIFT_MAX);
  });
});

type Shot = Settle & { stack: Stack; speed: number; perched: boolean; outsidePile: number };

/** How far (m) the point (x, z) is from the pile's cells, 0 over them. */
function distanceOutsidePile(x: number, z: number): number {
  return Math.hypot(Math.max(PILE_MIN_X - x, 0, x - PILE_MAX_X), Math.max(PILE_MIN_Z - z, 0, z - PILE_MAX_Z));
}

/** The drops, each run once however many rows read it: a held dummy dropped on stack `rank` (0: the tallest) at `speed` m/s, run until he lies still. */
const shots = new Map<string, Promise<Shot>>();
function shotOf(rank: number, speed: number): Promise<Shot> {
  const key = `${rank}@${speed}`;
  const known = shots.get(key);
  if (known) return known;
  const shot = (async () => {
    const stack = STACKS[rank]!;
    const sys = await system(PLACEMENTS);
    dropOnStack(sys, stack, speed);
    const settle = runUntilStill(sys, REST_HOLD, REST_WITHIN);
    sys.dispose();
    return { ...settle, stack, speed, perched: settle.torso.y > stack.top - LYING_LENGTH, outsidePile: distanceOutsidePile(settle.torso.x, settle.torso.z) };
  })();
  shots.set(key, shot);
  return shot;
}

const RANKS = [0, 1, 2, 3, 4] as const;
const hitCases = RANKS.flatMap((rank) => IMPACT_SPEEDS.map((speed) => ({ it: `when he is dropped on stack ${rank + 1} of the 5 tallest at ${speed} m/s, then he lies still in the landing field, no part tunnels a box or sinks under the pad, and the boxes move or he lies on the stack`, rank, speed })));

describe("given a held dummy dropped on the pile's five tallest stacks, 3 boxes high, at the best runs' landing speeds", () => {
  for (const testCase of hitCases) {
    it(testCase.it, async () => {
      const shot = await shotOf(testCase.rank, testCase.speed);
      console.log(
        `boxes ${shot.speed} m/s on the stack topping ${shot.stack.top.toFixed(1)} m at (${shot.stack.x.toFixed(1)}, ${(shot.stack.z - anchor.z).toFixed(1)}): still ${shot.stillSeconds.toFixed(2)} s after ${shot.simSeconds.toFixed(2)} s, torso (${shot.torso.x.toFixed(1)}, ${shot.torso.y.toFixed(2)}, ${(shot.torso.z - anchor.z).toFixed(1)}) ${shot.outsidePile.toFixed(1)} m outside the pile${shot.perched ? ", on the stack" : ""}, deepest part in a box ${shot.deepestInside.toFixed(3)} m, lowest part ${shot.lowestPart.toFixed(3)} m, farthest box ${shot.farthestBoxMove.toFixed(2)} m`,
      );
      const stepTravel = shot.speed * STEP;
      const inLandingField = shot.torso.x > anchor.x && shot.torso.x < anchor.x + layout.netX && Math.abs(shot.torso.z - anchor.z) < STATION_HALF_WIDTH + LYING_LENGTH;
      expect(shot.stillSeconds, `his still-time reached ${shot.stillSeconds.toFixed(2)} s in ${shot.simSeconds.toFixed(1)} s sim`).toBeGreaterThanOrEqual(REST_HOLD);
      expect(shot.deepestInside, `a part went ${shot.deepestInside.toFixed(3)} m into a box: more than a step's ${stepTravel.toFixed(3)} m travel is a tunnel`).toBeLessThan(stepTravel);
      expect(shot.lowestPart, `a part went down to ${shot.lowestPart.toFixed(3)} m: under the pad`).toBeGreaterThan(-PAD_SOAK);
      expect(shot.perched || shot.farthestBoxMove > BOX_HIT_MOVE, `no box moved (the farthest went ${shot.farthestBoxMove.toFixed(3)} m) and he is not on the stack (torso ${shot.torso.y.toFixed(2)} m up, top ${shot.stack.top.toFixed(2)} m)`).toBeTruthy();
      expect(inLandingField, `his torso lies at (${(shot.torso.x - anchor.x).toFixed(1)}, ${(shot.torso.z - anchor.z).toFixed(1)}) in the station's frame: outside the landing field`).toBeTruthy();
    });
  }

  it("when the 15 drops are read together, then the boxes moved in at least 12 of them and he rested within 2 m of the pile in at least 12", async () => {
    const all = await Promise.all(RANKS.flatMap((rank) => IMPACT_SPEEDS.map((speed) => shotOf(rank, speed))));
    const moved = all.filter((shot) => shot.farthestBoxMove > BOX_HIT_MOVE).length;
    const nearPile = all.filter((shot) => shot.outsidePile <= LYING_LENGTH).length;
    console.log(`boxes: ${all.length} drops, boxes moved in ${moved}, he lay within ${LYING_LENGTH} m of the pile in ${nearPile}, on a stack in ${all.filter((shot) => shot.perched).length}`);
    expect(all.length, "every drop ran").toBe(RANKS.length * IMPACT_SPEEDS.length);
    expect(moved, `the boxes moved in only ${moved} of ${all.length} drops`).toBeGreaterThanOrEqual(MOST_DROPS);
    expect(nearPile, `he lay within ${LYING_LENGTH} m of the pile in only ${nearPile} of ${all.length} drops`).toBeGreaterThanOrEqual(MOST_DROPS);
  });
});

describe("given boxes a dummy has scattered", () => {
  it("when restackBoxes() is called, then every box is within 1 cm of its placement and asleep, and a second dummy scatters them again", async () => {
    const sys = await system(PLACEMENTS);
    dropOnStack(sys, SCATTER_STACK, SCATTER_SPEED);
    const first = runUntilStill(sys, REST_HOLD, REST_WITHIN);
    sys.releaseThrown();
    sys.restackBoxes();
    let farthest = 0;
    for (let i = 0; i < PLACEMENTS.length; i++) {
      const at = boxBodiesOf(sys)[i]!.translation();
      const placement = PLACEMENTS[i]!;
      farthest = Math.max(farthest, Math.hypot(at.x - placement.x, at.y - placement.y, at.z - placement.z));
    }
    const asleep = allAsleep(sys);
    const poseMove = currentMove(sys);
    sys.holdThrown();
    dropOnStack(sys, SCATTER_STACK, SCATTER_SPEED);
    const second = runUntilStill(sys, REST_HOLD, REST_WITHIN);
    sys.dispose();
    expect(first.farthestBoxMove, `the first dummy scattered them ${first.farthestBoxMove.toFixed(2)} m`).toBeGreaterThan(BOX_HIT_MOVE);
    expect(farthest, `a box is ${farthest.toFixed(4)} m from its place`).toBeLessThan(RESTACK_TOLERANCE);
    expect(poseMove, `copyBoxPoses has a box ${poseMove.toFixed(4)} m from its place`).toBeLessThan(RESTACK_TOLERANCE);
    expect(asleep, "every box is asleep").toBeTruthy();
    expect(second.farthestBoxMove, `the second dummy moved a restacked box ${second.farthestBoxMove.toFixed(3)} m: it never woke`).toBeGreaterThan(BOX_HIT_MOVE);
  });

  it("when the dummy is released while the boxes still tumble, then the world keeps stepping until they lie asleep above the pad", async () => {
    const sys = await system(PLACEMENTS);
    dropOnStack(sys, SCATTER_STACK, SCATTER_SPEED);
    for (let frame = 0; frame < HIT_FRAMES; frame++) sys.update(FRAME, [], true, false, null);
    const awakeAtRelease = boxBodiesOf(sys).filter((body) => !body.isSleeping()).length;
    sys.releaseThrown();
    sys.update(FRAME, [], true, false, null);
    const stepWithBoxesAlone = sys["step"];
    for (let frame = 0; frame < 20 * FRAME_HZ; frame++) sys.update(FRAME, [], true, false, null);
    const lowest = Math.min(...boxBodiesOf(sys).map((body, i) => body.translation().y - Math.min(PLACEMENTS[i]!.width, PLACEMENTS[i]!.height, PLACEMENTS[i]!.depth) / 2));
    const asleep = allAsleep(sys);
    const poolAsleep = sys["boxes"].asleep();
    sys.dispose();
    expect(awakeAtRelease, "boxes were still moving when he went").toBeGreaterThan(0);
    expect(stepWithBoxesAlone, "boxes tumbling alone are stepped as finely as a dummy is: they have no continuous collision detection").toBe(STEP);
    expect(asleep && poolAsleep, "every box ended asleep").toBeTruthy();
    expect(lowest, `a box ended with its lowest face ${lowest.toFixed(3)} m: under the pad`).toBeGreaterThan(-BOX_SETTLE_SOAK);
  });

  it("when the dummy falls asleep while boxes he hit still move, then the world steps on until the pile lies asleep", async () => {
    const sys = await system(PLACEMENTS);
    dropOnStack(sys, SCATTER_STACK, SCATTER_SPEED);
    let awakeWhenDummySlept = -1;
    for (let frame = 0; frame < 20 * FRAME_HZ; frame++) {
      sys.update(FRAME, [], true, false, null);
      if (awakeWhenDummySlept < 0 && dummyOf(sys).bodies[0]!.isSleeping()) awakeWhenDummySlept = boxBodiesOf(sys).filter((body) => !body.isSleeping()).length;
    }
    const asleep = allAsleep(sys);
    sys.dispose();
    expect(awakeWhenDummySlept, "he fell asleep").toBeGreaterThanOrEqual(0);
    expect(asleep, "every box ended asleep").toBeTruthy();
  });
});

/** A shove (m/s) like the ones that matter to the damping's derivation, and the share of the undamped slide a damped carton may still travel (measured 0.47). */
const SHOVE_SPEED = 10;
const DAMPED_SLIDE_SHARE_MAX = 0.6;
const SHOVE_SECONDS = 5;

describe("given two cartons on the flat ground beside the pile, one with its air drag taken off", () => {
  it("when both are shoved along the pad at 10 m/s, then the carton with air drag slides under 0.6 of what the other does", async () => {
    const sys = await system([]);
    const lane = [-4, 4].map((offset) => ({ x: anchor.x + 14, y: 1, z: anchor.z + offset, yaw: 0, width: 2, height: 2, depth: 2 }));
    sys.setBoxes(lane);
    flyFarAway(sys);
    const [damped, undamped] = boxBodiesOf(sys);
    undamped!.setLinearDamping(0);
    undamped!.setAngularDamping(0);
    for (const body of [damped!, undamped!]) body.setLinvel({ x: SHOVE_SPEED, y: 0, z: 0 }, true);
    for (let frame = 0; frame < SHOVE_SECONDS * FRAME_HZ; frame++) sys.update(FRAME, [], true, false, null);
    const dampedSlide = damped!.translation().x - lane[0]!.x;
    const undampedSlide = undamped!.translation().x - lane[1]!.x;
    sys.dispose();
    expect(undampedSlide, `the control slid ${undampedSlide.toFixed(2)} m: it was shoved`).toBeGreaterThan(1);
    expect(dampedSlide, `with air drag it slid ${dampedSlide.toFixed(2)} m against ${undampedSlide.toFixed(2)} m without`).toBeLessThan(DAMPED_SLIDE_SHARE_MAX * undampedSlide);
  });
});

describe("given the boxes a ragdoll system draws from and the bodies it holds", () => {
  it("when 48 boxes are set before and after Rapier is in, then none exist before and every one after, in placement order with the pose layout position xyz, rotation xyzw", async () => {
    const sys = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
    sys.setBoxes(PLACEMENTS);
    const out = new Float32Array(BOX_COUNT * BOX_POSE_FLOATS);
    const before = sys.copyBoxPoses(out);
    await sys.preload();
    const bodiesBefore = sys.stats.bodies;
    const after = sys.copyBoxPoses(out);
    const farthest = Math.max(...PLACEMENTS.map((placement, i) => Math.hypot(out[i * 7]! - placement.x, out[i * 7 + 1]! - placement.y, out[i * 7 + 2]! - placement.z)));
    const turnError = Math.max(...PLACEMENTS.map((placement, i) => Math.hypot(out[i * 7 + 3]!, out[i * 7 + 4]! - Math.sin(placement.yaw / 2), out[i * 7 + 5]!, out[i * 7 + 6]! - Math.cos(placement.yaw / 2))));
    expect(() => sys.copyBoxPoses(new Float32Array(BOX_POSE_FLOATS * (BOX_COUNT - 1))), "a buffer one box short is refused").toThrow(RangeError);
    sys.setBoxes(PLACEMENTS.slice(0, 3));
    const replaced = sys.copyBoxPoses(out);
    const bodiesReplaced = sys.stats.bodies;
    sys.clearBoxes();
    const cleared = sys.copyBoxPoses(out);
    const bodiesCleared = sys.stats.bodies;
    sys.dispose();
    expect(before, "no boxes before Rapier").toBe(0);
    expect(after, "every box once Rapier is in").toBe(BOX_COUNT);
    expect(farthest, `a pose is ${farthest} m from its placement`).toBeLessThan(1e-4);
    expect(turnError, `a rotation is ${turnError} off the yaw's quaternion`).toBeLessThan(1e-5);
    expect(replaced, "setBoxes replaces the pile").toBe(3);
    expect(bodiesBefore - bodiesReplaced, "the replaced boxes' bodies are removed from the world").toBe(BOX_COUNT - 3);
    expect(cleared, "clearBoxes leaves none").toBe(0);
    expect(bodiesBefore - bodiesCleared, "every box's body is removed from the world").toBe(BOX_COUNT);
  });

  it("when a dummy has scattered them, then copyBoxPoses reads where the bodies are", async () => {
    const sys = await system(PLACEMENTS);
    dropOnStack(sys, SCATTER_STACK, SCATTER_SPEED);
    runUntilStill(sys, REST_HOLD, REST_WITHIN);
    const out = new Float32Array(BOX_COUNT * BOX_POSE_FLOATS);
    sys.copyBoxPoses(out);
    let farthest = 0;
    for (let i = 0; i < BOX_COUNT; i++) {
      const at = boxBodiesOf(sys)[i]!.translation();
      farthest = Math.max(farthest, Math.hypot(out[i * 7]! - at.x, out[i * 7 + 1]! - at.y, out[i * 7 + 2]! - at.z));
    }
    sys.dispose();
    expect(farthest, `a drawn box is ${farthest} m from its body`).toBeLessThan(1e-4);
  });
});

/** One render frame of `sys`; how many boxes are awake after it. A sleeping body costs the solver nothing, so this count is the pile's added work. */
function awakeBoxesAfterFrame(sys: RagdollSystem): number {
  sys.update(FRAME, [], true, false, null);
  return sys["boxes"]["awake"];
}

/** Frames of the flight window (well inside the 14 s flight of a 70 m/s throw), and the longest hit window. */
const FLIGHT_FRAMES = 240;
const HIT_WINDOW_FRAMES = 10 * FRAME_HZ;

describe("given the real pile of 48 boxes in the dummies' world and a dummy flying far from it or dropped through it", () => {
  it("when a dummy flies far from the pile, then no box is awake in any frame, and when every box is woken they are awake for over half a second and then sleep again", async () => {
    const sys = await system(PLACEMENTS);
    flyFarAway(sys);
    let mostAwakeWhileAsleep = 0;
    for (let frame = 0; frame < FLIGHT_FRAMES; frame++) mostAwakeWhileAsleep = Math.max(mostAwakeWhileAsleep, awakeBoxesAfterFrame(sys));
    for (const body of boxBodiesOf(sys)) body.wakeUp();
    let awakeFrames = 0;
    let mostAwakeWhenWoken = 0;
    while (awakeFrames < FLIGHT_FRAMES) {
      const awake = awakeBoxesAfterFrame(sys);
      mostAwakeWhenWoken = Math.max(mostAwakeWhenWoken, awake);
      if (awake === 0) break;
      awakeFrames++;
    }
    sys.dispose();
    expect(mostAwakeWhileAsleep, "boxes awake while the dummy flew far away").toBe(0);
    expect(mostAwakeWhenWoken, "the control: every box woken counts as awake").toBe(BOX_COUNT);
    expect(awakeFrames, `the woken boxes slept again after ${awakeFrames} frames: too soon to have been awake`).toBeGreaterThan(FRAME_HZ / 2);
    expect(awakeFrames, "the woken boxes never slept again within the window").toBeLessThan(FLIGHT_FRAMES);
  });

  it("when a dummy is dropped through the pile, then boxes wake and the whole pile lies asleep again within the window", async () => {
    const sys = await system(PLACEMENTS);
    dropOnStack(sys, SCATTER_STACK, SCATTER_SPEED);
    let mostAwake = 0;
    let frame = 0;
    for (; frame < HIT_WINDOW_FRAMES; frame++) {
      const awake = awakeBoxesAfterFrame(sys);
      mostAwake = Math.max(mostAwake, awake);
      if (frame > FRAME_HZ && awake === 0) break;
    }
    sys.dispose();
    expect(mostAwake, "the control: the dummy woke boxes").toBeGreaterThan(0);
    expect(frame, "the pile was still awake at the end of the window").toBeLessThan(HIT_WINDOW_FRAMES);
  });
});
