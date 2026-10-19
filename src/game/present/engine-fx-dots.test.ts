import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { FountainSystem, GlassDotSystem, SparkSystem } from "./engine-fx.ts";

/** A point sprite never draws under one pixel however far it is, so the dot pools must hand the GPU only their live dots. */

// The fx pools paint their dot sprites on a canvas; the headless run lends them one that takes any draw.
const ctx = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: "" };
const CANVAS = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const STEP = 1 / FRAME_HZ;
const ORIGIN = new THREE.Vector3(0, 1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const STILL = new THREE.Vector3();
/** Longer than any dot lives here (a spark 0.63 s, a glass chip 2.2 s, a power-1 jet's spark 2 x 16 m/s / g = 3.3 s, the jet's 0.5 s run on top), so every dot of a shower has died. */
const ALL_DEAD_S = 6;
/** Drawn dots are on or near the ground (m); a dead dot parked high in the sky is far above this. */
const NEAR_WORLD_M = 50;

type Dots = SparkSystem | GlassDotSystem | FountainSystem;
type Pool = { name: string; make: (scene: THREE.Scene) => { sys: Dots; shower: () => void } };

const POOLS: readonly Pool[] = [
  {
    name: "spark",
    make: (scene) => {
      const sys = new SparkSystem(scene);
      return { sys, shower: () => sys.poof(ORIGIN, UP, 48) };
    },
  },
  {
    name: "glass chip",
    make: (scene) => {
      const sys = new GlassDotSystem(scene);
      return { sys, shower: () => sys.burst(ORIGIN, STILL, 40) };
    },
  },
  {
    name: "fountain",
    make: (scene) => {
      const sys = new FountainSystem(scene);
      return { sys, shower: () => sys.jet(0, 0, 0, 0, 0.5) };
    },
  },
];

before(() => {
  Object.defineProperty(globalThis, "document", { value: CANVAS, configurable: true });
});
after(() => {
  Reflect.deleteProperty(globalThis, "document");
});

const run = (sys: Dots, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) sys.update(STEP);
};
const alive = (sys: Dots): number => sys["life"].filter((life) => life > 0).length;
const drawn = (sys: Dots): number => sys["geo"].drawRange.count;
const drawnY = (sys: Dots): number[] => {
  const pos = sys["geo"].getAttribute("position");
  return Array.from({ length: drawn(sys) }, (_, k) => pos.getY(k));
};

for (const { name, make } of POOLS) {
  describe(`given a ${name} pool`, () => {
    it("when nothing has been thrown, then the GPU draws no dot", () => {
      const { sys } = make(new THREE.Scene());
      assert.equal(drawn(sys), 0);
    });

    it("when a shower is in the air, then the GPU draws exactly its live dots, all near the world", () => {
      const { sys, shower } = make(new THREE.Scene());
      shower();
      run(sys, 0.2);
      const live = alive(sys);
      assert.ok(live > 0, "the shower is still up");
      assert.equal(drawn(sys), live, "one drawn dot per live dot");
      assert.ok(Math.max(...drawnY(sys)) < NEAR_WORLD_M, "no drawn dot is parked high above the world");
    });

    it("when every dot of the shower has died, then the GPU draws none", () => {
      const { sys, shower } = make(new THREE.Scene());
      shower();
      run(sys, ALL_DEAD_S);
      assert.equal(drawn(sys), 0);
    });

    it("when the pool is reset in mid-air, then the GPU draws none", () => {
      const { sys, shower } = make(new THREE.Scene());
      shower();
      run(sys, 0.2);
      sys.reset();
      assert.equal(drawn(sys), 0);
    });
  });
}

describe("given a fountain pool whose first jet is spent", () => {
  it("when a spark has died among live ones, then every drawn dot is lit", () => {
    const scene = new THREE.Scene();
    const sys = new FountainSystem(scene);
    sys.jet(0, 0, 0, 0, 0.5);
    run(sys, 0.5);
    sys.jet(0, 0, 0, 0, 0.5);
    run(sys, 2.2);
    const tint = sys["geo"].getAttribute("color");
    const live = alive(sys);
    assert.ok(live > 0 && drawn(sys) === live, "some sparks are up and the first jet's are gone");
    for (let k = 0; k < drawn(sys); k++) assert.ok(Math.max(tint.getX(k), tint.getY(k), tint.getZ(k)) > 0, `drawn dot ${k} carries its own spark's colour`);
  });
});
