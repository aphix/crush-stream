import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { DummyMesh } from "../present/ragdoll-mesh.ts";
import { PARTS } from "../present/ragdoll-body.ts";
import { SHOWCASE_EYE } from "../present/showcase-art.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { runSeconds, bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

/**
 * A press on a showcase figure pushes him at the point it landed, the way the camera faces; he goes limp, gets up and walks back to his
 * mark, and the set takes him back as he stood.
 */

const HOME_WITHIN_SECONDS = 25;
const HEAD = 1;
const SHINS = [7, 9];
const UPPER_ARMS = [2, 4];
const FOREARMS = [3, 5];

describe("given the real engine booted on #scene=showcase", () => {
  let engine: CrashEngine;
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
    runSeconds(engine, 0.2);
  };

  beforeAll(async () => {
    stubBrowser();
    globalThis.location.hash = "#scene=showcase";
    engine = await bootEngine();
    await ragdolls().preload();
    runSeconds(engine, 0.5);
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when the set stands for 12 s with the parked car long gone off the rim, then nothing resets the scene under the figures", () => {
    settle();
    const seed = engine["sceneSeed"];
    runSeconds(engine, 12);
    expect(engine["sceneSeed"], "the scene was not rerolled").toBe(seed);
    expect(engine["cars"][0]!.vaporized, "the car did leave the sim, as it always does here").toBe(true);
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
      expect(press(2, testCase.height, testCase.across), "the press landed on him").toBe(true);
      const slot = ragdolls()["lastSlot"];
      const bodies = ragdolls()["dolls"][slot].bodies;
      const speeds = PARTS.map((_, k) => {
        const v = bodies[k].linvel();
        return Math.hypot(v.x, v.y, v.z);
      });
      const fastest = speeds.indexOf(Math.max(...speeds));
      expect(testCase.expectedParts.includes(fastest), `the fastest part is ${fastest} (${speeds[fastest]!.toFixed(1)} m/s), not one of ${testCase.expectedParts.join(", ")}`).toBeTruthy();
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
      expect(hit?.instanceId, "the ray lands on his slot").toBe(testCase.slot);
      expect(hit!.point.distanceTo(target), `and ${hit!.point.distanceTo(target).toFixed(3)} m from where the forearm is drawn`).toBeLessThan(0.1);
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
      expect(press(testCase.slot, 1.2), "the press landed on him").toBe(true);
      const slot = ragdolls()["lastSlot"];
      const from = new THREE.Vector3();
      ragdolls().torso(slot, from, null);
      runSeconds(engine, 0.4);
      const to = new THREE.Vector3();
      ragdolls().torso(slot, to, null);
      const moved = (to[testCase.axis] - from[testCase.axis]) * testCase.expectedSign;
      expect(moved, `moved ${moved.toFixed(2)} m the way the camera faces along ${testCase.axis}`).toBeGreaterThan(0.5);
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
      expect(press(testCase.slot, 1.2), "the press landed on him").toBe(true);
      expect(standing(testCase.slot), "off the set while he is away").toBe(false);
      const slot = ragdolls()["lastSlot"];
      const walker = ragdolls().walkers[slot]!;
      const seen = new Set<string>();
      let farthest = 0;
      const mark = art().markOf(testCase.slot, new THREE.Vector3());
      const torso = new THREE.Vector3();
      for (let t = 0; t < HOME_WITHIN_SECONDS && !standing(testCase.slot); t += 0.1) {
        runSeconds(engine, 0.1);
        seen.add(walker.state);
        if (ragdolls().walkerTorso(torso, slot)) farthest = Math.max(farthest, Math.hypot(torso.x - mark.x, torso.z - mark.z));
      }
      expect(standing(testCase.slot), "back on the set").toBe(true);
      expect(firstMismatch([...seen].sort(), ["down", "getUp", "stand"]), "he lay, got up and walked").toBeUndefined();
      expect(farthest, `he was knocked ${farthest.toFixed(1)} m from his mark`).toBeGreaterThan(1);
      expect(live(), "no dummy of his is left in the ragdoll world").toBe(0);
      expect(walker.active, "his walker is let go").toBe(false);
    });
  }

  it("when a fifth figure is knocked while four are away, then the one longest away is sent home at once and four dummies are out", () => {
    settle();
    for (const slot of [0, 1, 2, 3, 4]) expect(press(slot, 1.2), `figure ${slot} pressed`).toBe(true);
    expect(standing(0), "the first is back on his mark").toBe(true);
    for (const slot of [1, 2, 3, 4]) expect(standing(slot), `figure ${slot} is away`).toBe(false);
    expect(live(), "four dummies are out").toBe(4);
  });

  const againCases: readonly { it: string; waitFor: string }[] = [
    { it: "when a dummy that has just been knocked is pressed in the air, then he is knocked again and still gets home", waitFor: "down" },
    { it: "when a dummy that is getting up is pressed, then he is knocked down again and still gets home", waitFor: "getUp" },
    { it: "when a dummy that is walking home is pressed, then he is knocked down again and still gets home", waitFor: "stand" },
  ];
  for (const testCase of againCases) {
    it(testCase.it, () => {
      settle();
      expect(press(3, 1.2), "the first press landed on him").toBe(true);
      const slot = ragdolls()["lastSlot"];
      const walker = ragdolls().walkers[slot]!;
      const torso = new THREE.Vector3();
      runSeconds(engine, 0.3);
      for (let t = 0; t < 12 && walker.state !== testCase.waitFor; t += 0.1) runSeconds(engine, 0.1);
      expect(walker.state, "he reached the state under test").toBe(testCase.waitFor);
      const before = walker.sinceStruck;
      expect(ragdolls().walkerTorso(torso, slot), "his dummy is out").toBe(true);
      const [x, y] = screenOf(torso);
      expect(engine["view"].take!.down(x, y, 0), "the press landed on his dummy").toBe(true);
      expect(walker.state, "limp again").toBe("down");
      expect(walker.sinceStruck, `struck again: ${walker.sinceStruck.toFixed(2)} s ago, not ${before.toFixed(2)}`).toBeLessThan(before);
      expect(standing(3), "he is not back on the set yet").toBe(false);
      for (let t = 0; t < HOME_WITHIN_SECONDS && !standing(3); t += 0.1) runSeconds(engine, 0.1);
      expect(standing(3), "he got home after all").toBe(true);
      expect(live(), "and his dummy is gone from the ragdoll world").toBe(0);
    });
  }
});
