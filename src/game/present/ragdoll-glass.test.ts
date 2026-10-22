import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import type { GlassName } from "../vehicle/car-core.ts";
import { makeCar } from "../contact/crash-scenarios.test-util.ts";
import { glassOf, paneFrame } from "../vehicle/car-glass.test-util.ts";
import { RagdollSystem } from "./engine-ragdoll.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const FRAME = 1 / FRAME_HZ;
/** One physics step of the dummies' world: the strikes are followed step by step. */
const STEP = 1 / 480;
/** Steps a strike is followed: 0.125 s, before a torso through a pane can reach the far side of the cabin. */
const FOLLOW = 60;
/** How far out of the pane (m) the dummy's leading face starts. */
const START_GAP = 0.19;
/** How far the torso's centre is behind its leading face (m): chest first its half depth; head first, the tips of his raised arms (he is thrown arms up, `ARM`) are 0.80 m out along his spine, the end of his torso 0.27 m. */
const LEAD = { chest: 0.11, head: 0.8 } as const;
const TORSO_HALF_LENGTH = 0.27;
/**
 * Where a torso aims on a door window (m up the pane from its middle): the window is 0.45 m tall and the torso 0.36 m wide down it,
 * so he goes in through its lower part, his top end under the drawn roof rail that the cage shows over the window's top edge
 * (a torso aimed at the middle reached 1.23 m, over the rail's underside at 1.13 m, and hit it as the drawn car would).
 */
const DOOR_UP = -0.1;

type Body = { translation(): THREE.Vector3Like; linvel(): THREE.Vector3Like; collider(i: number): { setCollisionGroups(g: number): void } };
type Dolls = { bodies: Body[] }[];

type Strike = {
  /** The torso's velocity along the pane's outward normal (m/s): the step before the strike (the dummy reaching the glass, or stopping short of it), the step after it, and the most outward over the 12 steps (25 ms) after it. */
  before: number;
  next: number;
  peakOut: number;
  /** How far the torso's centre got past the glass into the cabin (m; negative: it stayed that far outside). */
  through: number;
};

/** How the dummy comes at the pane: his torso flat to it (its long side across the pane), or head first along its normal, arms up. */
type Pose = keyof typeof LEAD;

/**
 * A parked sedan at the origin facing +z (car 1); the thrower's own car parked 60 m away (car 0). Each of `speeds` throws
 * a dummy straight at pane `name` of car 1, aimed `up` m up and `along` m across the pane from its middle (across: the car's
 * width on the windshield, its length on a side window), in `pose`, his leading face `START_GAP` m off the glass;
 * `torsoOnly`: his head and limbs touch nothing, so his torso alone meets the car. Each throw is followed `FOLLOW` steps:
 * what his torso did, and the car's glass at the end. Each throw takes the one before out of the world, so he meets the glass, not the dummy lying at it.
 */
async function strikes(name: GlassName, up: number, along: number, pose: Pose, torsoOnly: boolean, speeds: readonly number[]): Promise<{ throws: Strike[]; glass: Record<string, string> }> {
  const own = makeCar();
  const car = makeCar();
  own.spawnFacing(-60, 0, 0, 0);
  car.spawnFacing(0, 0, 0, 0);
  car.group.updateMatrixWorld(true);
  const cars = [own, car];
  const ragdolls = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
  await ragdolls.preload();
  ragdolls.update(FRAME, cars, true, false, null);
  const { centre, out } = paneFrame(car, name);
  const side = Math.abs(out.x) > 0.5;
  const across = (side ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).addScaledVector(out, -(side ? out.z : out.x)).normalize();
  const upPane = new THREE.Vector3().crossVectors(out, across);
  const aim = centre.clone().addScaledVector(upPane, up).addScaledVector(across, along);
  const inward = out.clone().negate();
  // Chest first: the torso's width down the pane, its length across it, its thin side to the glass. Head first: his spine along the pane's normal.
  const basis = pose === "chest" ? new THREE.Matrix4().makeBasis(upPane.clone().negate(), across, out) : new THREE.Matrix4().makeBasis(across, inward, new THREE.Vector3().crossVectors(across, inward));
  const q = new THREE.Quaternion().setFromRotationMatrix(basis);
  const throws: Strike[] = [];
  for (const speed of speeds) {
    if (throws.length > 0) ragdolls["despawn"](ragdolls["lastSlot"]);
    ragdolls["spawn"]({ car: 0, p: aim.clone().addScaledVector(out, LEAD[pose] + START_GAP), q, v: inward.clone().multiplyScalar(speed), w: new THREE.Vector3(), age: 0, cop: false, rides: true });
    const bodies = (ragdolls["dolls"] as Dolls)[ragdolls["lastSlot"]]!.bodies;
    if (torsoOnly) for (let k = 1; k < bodies.length; k++) bodies[k]!.collider(0).setCollisionGroups(0);
    const torso = bodies[0]!;
    const normal: number[] = [];
    const apart: number[] = [];
    for (let f = 0; f < FOLLOW; f++) {
      ragdolls.update(STEP, cars, true, false, null);
      const v = torso.linvel();
      const t = torso.translation();
      normal.push(v.x * out.x + v.y * out.y + v.z * out.z);
      apart.push((t.x - aim.x) * out.x + (t.y - aim.y) * out.y + (t.z - aim.z) * out.z);
    }
    // The strike: the first step whose leading face is within 1 cm of the glass, or whose inward speed fell by over 1 m/s (stopped short of it).
    const at = apart.findIndex((d, f) => d < LEAD[pose] + 0.01 || (f > 0 && normal[f]! - normal[f - 1]! > 1));
    throws.push({ before: normal[Math.max(0, at - 1)]!, next: normal[at + 1]!, peakOut: Math.max(...normal.slice(at + 1, at + 13)), through: -Math.min(...apart) });
  }
  const glass = glassOf(car);
  ragdolls.dispose();
  return { throws, glass };
}

const show = (throws: readonly Strike[]): string => JSON.stringify(throws.map((s) => ({ before: +s.before.toFixed(2), next: +s.next.toFixed(2), peakOut: +s.peakOut.toFixed(2), through: +s.through.toFixed(3) })));

/**
 * The door rows as todos (Main): the reference sedan's door window (lane-cars-sedan's DLO, 0b9f6600: fc2d022c 3/3, then 0/3) is 0.356 m
 * tall (its belt at y 0.90, its glass's top at 1.256) and the torso chest first 0.36 m wide down the pane, so it meets the door skin or
 * the A-pillar with the glass. Measured on the union (f5de6388): at DOOR_UP the 10 m/s torso cracks the windshield too (its slab, a
 * cuboid on the pane's mean width, stands 11 cm past its header's ends over the door window's front) and the 3 m/s one never comes back
 * out (-1.57 m/s); swept up -0.1 to 0 and along 0 to -0.2 m, 0 of 3 rows at every aim, with the panes as their glass's own quads too
 * (CarRig rig-pane 4409f165, parked); end first (0.22 m down the pane) at up -0.1, 2 of 3 (the 3 m/s strike stays in, -1.28 m/s).
 */
const doorTooShort =
  "after the overhaul: a door strike that fits the window (end first, or a smaller aim); the reference sedan's door window is 0.356 m tall against the torso's 0.36 m, so a chest-first torso meets the door skin or the A-pillar (the windshield's slab past its header) with the glass";

describe("given a parked car's glass (each pane intact, then cracked, then shattered) and a thrown dummy whose head and limbs touch nothing, so his torso alone meets the car", () => {
  const torsoStrikeCases = [
    { it: "when his torso strikes the windshield once at 10 m/s, then the windshield cracks and holds, and he bounces back off it", pane: "windshield", up: 0.1, along: 0, speeds: [10], expected: "cracked", goesThrough: false },
    { it: "when torsos strike the windshield twice at 10 m/s, then the second strike shatters it and that torso goes on through into the cabin", pane: "windshield", up: 0.1, along: 0, speeds: [10, 10], expected: "shattered", goesThrough: true },
    { it: "when his torso strikes the windshield at 3 m/s, under the 4 m/s that breaks glass, then the windshield stays intact and he bounces back off it", pane: "windshield", up: 0.1, along: 0, speeds: [3], expected: "intact", goesThrough: false },
    { it: "when his torso strikes the left door window once at 10 m/s, then the window cracks and holds, and he bounces back off it", pane: "doorL", up: DOOR_UP, along: 0, speeds: [10], expected: "cracked", goesThrough: false },
    { it: "when torsos strike the left door window twice at 10 m/s, then the second strike shatters it and that torso goes on through into the cabin", pane: "doorL", up: DOOR_UP, along: 0, speeds: [10, 10], expected: "shattered", goesThrough: true },
    { it: "when his torso strikes the left door window at 3 m/s, under the 4 m/s that breaks glass, then the window stays intact and he bounces back off it", pane: "doorL", up: DOOR_UP, along: 0, speeds: [3], expected: "intact", goesThrough: false },
  ] as const;
  for (const testCase of torsoStrikeCases) {
    it(testCase.it, { todo: testCase.pane === "doorL" ? doorTooShort : false }, async (t) => {
      const { throws, glass } = await strikes(testCase.pane, testCase.up, testCase.along, "chest", true, testCase.speeds);
      t.diagnostic(`glass ${JSON.stringify(glass)}; throws ${show(throws)}`);
      for (const [name, state] of Object.entries(glass)) assert.equal(state, name === testCase.pane ? testCase.expected : "intact", `${name}'s state`);
      const last = throws.at(-1)!;
      assert.ok(last.before < -0.9 * testCase.speeds.at(-1)!, `the torso came at the pane at ${(-last.before).toFixed(2)} m/s`);
      if (testCase.goesThrough) {
        assert.ok(last.next < -0.9 * testCase.speeds.at(-1)!, `the step after the pane went it moved in at ${(-last.next).toFixed(2)} m/s`);
        assert.ok(last.through > LEAD.chest, `its centre got ${last.through.toFixed(3)} m past the glass, not its whole depth`);
      } else {
        assert.ok(last.peakOut > 0, `it never moved back out: at most ${last.peakOut.toFixed(2)} m/s out after the strike`);
        assert.ok(last.through < 0, `its centre got ${last.through.toFixed(3)} m past the glass`);
      }
    });
  }
});

describe("given a parked sedan's intact glass and a thrown dummy whose torso alone meets the car, aimed at the front of its left door window", () => {
  // The windshield's slab is its glass's own quad: a cuboid on the pane's mean width stood 11 cm past its header's ends over the door
  // window's front, and a door strike cracked the windshield (union 44c33a2a). The door window's own state is the door rows' (todo).
  it("when his torso strikes the left door window at 10 m/s, then the windshield stays intact", async (t) => {
    const { throws, glass } = await strikes("doorL", DOOR_UP, 0, "chest", true, [10]);
    t.diagnostic(`glass ${JSON.stringify(glass)}; throws ${show(throws)}`);
    assert.ok(throws[0]!.before < -9, `the torso came at the door at ${(-throws[0]!.before).toFixed(2)} m/s`);
    assert.equal(glass.windshield, "intact", "the windshield's state");
  });
});

describe("given a parked car's intact windshield and whole thrown dummies", () => {
  it("when two dummies strike it chest first at 10 m/s, one after the other, then the first leaves it cracked and the second shatters it", async (t) => {
    const once = await strikes("windshield", 0.1, 0, "chest", false, [10]);
    const twice = await strikes("windshield", 0.1, 0, "chest", false, [10, 10]);
    t.diagnostic(`once ${show(once.throws)}; twice ${show(twice.throws)}`);
    assert.equal(once.glass.windshield, "cracked");
    assert.equal(twice.glass.windshield, "shattered");
  });

  it("when a dummy strikes it head first at 10 m/s, arms up, then his arms and head stop him at the glass before his torso reaches it, and the windshield stays intact (only a torso breaks glass)", async (t) => {
    const { throws, glass } = await strikes("windshield", 0, 0, "head", false, [10]);
    t.diagnostic(`glass ${JSON.stringify(glass)}; torso ${show(throws)}`);
    const torso = throws[0]!;
    assert.ok(torso.before < -9 && torso.peakOut > -5, `the torso came at ${(-torso.before).toFixed(2)} m/s and went on at ${(-torso.peakOut).toFixed(2)} m/s or slower`);
    assert.ok(torso.through < -TORSO_HALF_LENGTH, `the torso's centre got within ${(-torso.through).toFixed(3)} m of the glass`);
    assert.equal(glass.windshield, "intact");
  });
});
