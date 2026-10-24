import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { DummyMesh } from "../present/ragdoll-mesh.ts";
import { PARTS } from "../present/ragdoll-body.ts";
import { SHOWCASE_EYE } from "../present/showcase-art.ts";
import { setGround } from "../world/ground.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

/**
 * A press on a showcase figure pushes him at the point it landed, the way the camera faces; he goes limp, gets up and walks back to his
 * mark, and the set takes him back as he stood.
 */

const FRAME = 1 / FRAME_HZ;
const HOME_WITHIN_SECONDS = 25;
const HEAD = 1;
const SHINS = [7, 9];
const UPPER_ARMS = [2, 4];
const FOREARMS = [3, 5];

describe("given the real engine booted on #scene=showcase", () => {
  let engine: CrashEngine;
  const run = (seconds: number): void => {
    for (let i = 0; i < seconds * FRAME_HZ; i++) engine.advance(FRAME, { frameDt: FRAME });
  };
  const art = () => engine["showcase"]!.art;
  const ragdolls = () => engine["ragdolls"];
  const standing = (slot: number): boolean => ((art().people["mesh"] as DummyMesh)["shown"] >> slot & 1) === 1;
  const live = (): number => ragdolls()["dolls"].filter((d: { live: boolean }) => d.live).length;
  /** The camera at `eye` looking at `target`, with the stand-in canvas's 800 x 600 shape. */
  const lookFrom = (eye: readonly number[], target: readonly number[]): void => {
    const camera = engine["camera"];
    camera.clearViewOffset();
    camera.aspect = 800 / 600;
    camera.updateProjectionMatrix();
    camera.position.set(eye[0]!, eye[1]!, eye[2]!);
    camera.lookAt(target[0]!, target[1]!, target[2]!);
    camera.updateMatrixWorld(true);
  };
  /** Client coordinates of the world point (x, y, z) in the camera now. */
  const screenOf = (at: THREE.Vector3): [number, number] => {
    const p = at.clone().project(engine["camera"]);
    return [((p.x + 1) / 2) * 800, ((1 - p.y) / 2) * 600];
  };
  /** Press figure `slot` at height `y` and `across` m along his mark's row (the eye's right), with the camera where it is. */
  const press = (slot: number, y: number, across = 0): boolean => {
    const at = art().markOf(slot, new THREE.Vector3());
    at.set(at.x + across, y, at.z);
    const [x, py] = screenOf(at);
    return engine["view"].take!.down(x, py, 0);
  };
  const settle = (): void => {
    engine.reset();
    lookFrom([SHOWCASE_EYE.x, SHOWCASE_EYE.y, SHOWCASE_EYE.z], [SHOWCASE_EYE.lookX, SHOWCASE_EYE.lookY, SHOWCASE_EYE.lookZ]);
    run(0.2);
  };

  before(async () => {
    stubBrowser();
    globalThis.location.hash = "#scene=showcase";
    engine = new CrashEngine(element(), new HudStore(), element());
    Object.assign(engine["renderer"], { render() {}, compile() {}, compileAsync: () => Promise.resolve() });
    await engine.ready;
    engine.fadeScenes = false;
    await ragdolls().preload();
    run(0.5);
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  it("when the set stands for 12 s with the parked car long gone off the rim, then nothing resets the scene under the figures", () => {
    settle();
    const seed = engine["sceneSeed"];
    run(12);
    assert.equal(engine["sceneSeed"], seed, "the scene was not rerolled");
    assert.equal(engine["cars"][0]!.vaporized, true, "the car did leave the sim, as it always does here");
  });

  const partCases: readonly { it: string; height: number; across: number; expectedParts: readonly number[] }[] = [
    { it: "when a figure is pressed at head height, then the head is the part that is sent", height: 1.65, across: 0, expectedParts: [HEAD] },
    { it: "when a figure is pressed low on a leg, then a shin is the part that is sent", height: 0.2, across: 0.09, expectedParts: SHINS },
    { it: "when a figure is pressed on a hand hanging at his side, then that arm is the part that is sent", height: 0.8, across: 0.26, expectedParts: FOREARMS },
    { it: "when a figure is pressed on his upper arm, then that arm is the part that is sent", height: 1.22, across: 0.26, expectedParts: UPPER_ARMS },
  ];
  for (const testCase of partCases) {
    it(testCase.it, () => {
      settle();
      assert.equal(press(2, testCase.height, testCase.across), true, "the press landed on him");
      const slot = ragdolls()["lastSlot"];
      const bodies = ragdolls()["dolls"][slot].bodies;
      const speeds = PARTS.map((_, k) => {
        const v = bodies[k].linvel();
        return Math.hypot(v.x, v.y, v.z);
      });
      const fastest = speeds.indexOf(Math.max(...speeds));
      assert.ok(testCase.expectedParts.includes(fastest), `the fastest part is ${fastest} (${speeds[fastest]!.toFixed(1)} m/s), not one of ${testCase.expectedParts.join(", ")}`);
    });
  }

  const strideCases: readonly { it: string; slot: number; part: number }[] = [
    { it: "when the right hand of a figure caught mid-stride is aimed at, then the press lands on him where the hand is drawn", slot: 6, part: 3 },
    { it: "when the left hand of a figure caught mid-stride is aimed at, then the press lands on him where the hand is drawn", slot: 6, part: 5 },
    { it: "when the right hand of the cop caught mid-stride is aimed at, then the press lands on him where the hand is drawn", slot: 11, part: 3 },
    { it: "when the left hand of the cop caught mid-stride is aimed at, then the press lands on him where the hand is drawn", slot: 11, part: 5 },
  ];
  for (const testCase of strideCases) {
    it(testCase.it, () => {
      settle();
      lookFrom([0, 6, 8], [0, 1, 0]);
      const mesh = art().people["mesh"] as DummyMesh;
      const target = mesh.partPoint(testCase.slot, testCase.part, new THREE.Vector3(...PARTS[testCase.part]!.c), new THREE.Vector3());
      const ray = new THREE.Raycaster();
      const ndc = target.clone().project(engine["camera"]);
      ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), engine["camera"]);
      const hit = ray.intersectObject(art().people.group, true).find((h) => h.object instanceof DummyMesh);
      assert.equal(hit?.instanceId, testCase.slot, "the ray lands on his slot");
      assert.ok(hit!.point.distanceTo(target) < 0.1, `and ${hit!.point.distanceTo(target).toFixed(3)} m from where the forearm is drawn`);
    });
  }

  const facingCases: readonly { it: string; eye: readonly number[]; target: readonly number[]; slot: number; axis: "x" | "z"; expectedSign: 1 | -1 }[] = [
    { it: "when the camera looks along -z from the front, then he is knocked toward -z", eye: [0, 1.5, 8], target: [0, 1, 0], slot: 2, axis: "z", expectedSign: -1 },
    { it: "when the camera looks along +z from behind the set, then he is knocked toward +z", eye: [0, 1.5, -8], target: [0, 1, 0], slot: 8, axis: "z", expectedSign: 1 },
    { it: "when the camera looks along +x from the side, then he is knocked toward +x", eye: [-9, 1.5, 0], target: [0, 1, 0], slot: 0, axis: "x", expectedSign: 1 },
  ];
  for (const testCase of facingCases) {
    it(testCase.it, () => {
      settle();
      lookFrom(testCase.eye, testCase.target);
      assert.equal(press(testCase.slot, 1.2), true, "the press landed on him");
      const slot = ragdolls()["lastSlot"];
      const from = new THREE.Vector3();
      ragdolls().torso(slot, from, null);
      run(0.4);
      const to = new THREE.Vector3();
      ragdolls().torso(slot, to, null);
      const moved = (to[testCase.axis] - from[testCase.axis]) * testCase.expectedSign;
      assert.ok(moved > 0.5, `moved ${moved.toFixed(2)} m the way the camera faces along ${testCase.axis}`);
    });
  }

  const homeCases: readonly { it: string; slot: number }[] = [
    { it: "when the man in the blue tee is knocked, then he gets up and walks back to his mark and the set takes him back", slot: 0 },
    { it: "when the plain-clothes guard is knocked, then he gets up and walks back to his mark and the set takes him back", slot: 3 },
    { it: "when the uniformed cop of the back row is knocked, then he gets up and walks back to his mark and the set takes him back", slot: 11 },
  ];
  for (const testCase of homeCases) {
    it(testCase.it, () => {
      settle();
      assert.equal(press(testCase.slot, 1.2), true, "the press landed on him");
      assert.equal(standing(testCase.slot), false, "off the set while he is away");
      const slot = ragdolls()["lastSlot"];
      const walker = ragdolls().walkers[slot]!;
      const seen = new Set<string>();
      let farthest = 0;
      const mark = art().markOf(testCase.slot, new THREE.Vector3());
      const torso = new THREE.Vector3();
      for (let t = 0; t < HOME_WITHIN_SECONDS && !standing(testCase.slot); t += 0.1) {
        run(0.1);
        seen.add(walker.state);
        if (ragdolls().walkerTorso(torso, slot)) farthest = Math.max(farthest, Math.hypot(torso.x - mark.x, torso.z - mark.z));
      }
      assert.equal(standing(testCase.slot), true, "back on the set");
      assert.deepEqual([...seen].sort(), ["down", "getUp", "stand"], "he lay, got up and walked");
      assert.ok(farthest > 1, `he was knocked ${farthest.toFixed(1)} m from his mark`);
      assert.equal(live(), 0, "no dummy of his is left in the ragdoll world");
      assert.equal(walker.active, false, "his walker is let go");
    });
  }

  it("when a fifth figure is knocked while four are away, then the one longest away is sent home at once and four dummies are out", () => {
    settle();
    for (const slot of [0, 1, 2, 3, 4]) assert.equal(press(slot, 1.2), true, `figure ${slot} pressed`);
    assert.equal(standing(0), true, "the first is back on his mark");
    for (const slot of [1, 2, 3, 4]) assert.equal(standing(slot), false, `figure ${slot} is away`);
    assert.equal(live(), 4, "four dummies are out");
  });

  const againCases: readonly { it: string; waitFor: string }[] = [
    { it: "when a dummy that has just been knocked is pressed in the air, then he is knocked again and still gets home", waitFor: "down" },
    { it: "when a dummy that is getting up is pressed, then he is knocked down again and still gets home", waitFor: "getUp" },
    { it: "when a dummy that is walking home is pressed, then he is knocked down again and still gets home", waitFor: "stand" },
  ];
  for (const testCase of againCases) {
    it(testCase.it, () => {
      settle();
      assert.equal(press(3, 1.2), true, "the first press landed on him");
      const slot = ragdolls()["lastSlot"];
      const walker = ragdolls().walkers[slot]!;
      const torso = new THREE.Vector3();
      run(0.3);
      for (let t = 0; t < 12 && walker.state !== testCase.waitFor; t += 0.1) run(0.1);
      assert.equal(walker.state, testCase.waitFor, "he reached the state under test");
      const before = walker.sinceStruck;
      assert.equal(ragdolls().walkerTorso(torso, slot), true, "his dummy is out");
      const [x, y] = screenOf(torso);
      assert.equal(engine["view"].take!.down(x, y, 0), true, "the press landed on his dummy");
      assert.equal(walker.state, "down", "limp again");
      assert.ok(walker.sinceStruck < before, `struck again: ${walker.sinceStruck.toFixed(2)} s ago, not ${before.toFixed(2)}`);
      assert.equal(standing(3), false, "he is not back on the set yet");
      for (let t = 0; t < HOME_WITHIN_SECONDS && !standing(3); t += 0.1) run(0.1);
      assert.equal(standing(3), true, "he got home after all");
      assert.equal(live(), 0, "and his dummy is gone from the ragdoll world");
    });
  }
});
