import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { DebrisSystem, FountainSystem, GlassDotSystem, SparkSystem, TireSmokeSystem } from "./engine-fx.ts";

/** A point sprite never draws under one pixel however far it is, so the dot pools must hand the GPU only their live dots; every crash FX pool uploads only those. */

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
const CAMERA = new THREE.PerspectiveCamera();
const DUST_BOX = new THREE.Vector3(0.3, 0.3, 0.3);
/** Past a glass-dust puff's 0.35 s, inside a plume puff's 2.2 s. */
const DUST_GONE_S = 0.5;
/** Past a plume puff's 3.3 s. */
const SMOKE_GONE_S = 4;
const PUFFS = 10;
const MATRIX_FLOATS = 16;
const RGB = 3;

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

/** `attr` is a dynamic buffer with exactly one queued upload: the first `floats` floats, where the live entries are packed. */
function assertFrontUpload(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, floats: number, label: string): void {
  assert.ok(attr instanceof THREE.BufferAttribute, `${label} is a plain buffer`);
  assert.equal(attr.usage, THREE.DynamicDrawUsage, `${label} usage`);
  assert.equal(attr.updateRanges.length, 1, `${label} ranges`);
  assert.equal(attr.updateRanges[0]!.start, 0, `${label} range start`);
  assert.equal(attr.updateRanges[0]!.count, floats, `${label} range count`);
}

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

    it("when a shower is in the air, then only the live dots' floats are queued for the GPU, into dynamic buffers", () => {
      const { sys, shower } = make(new THREE.Scene());
      shower();
      run(sys, 0.2);
      const live = alive(sys);
      for (const attrName of Object.keys(sys["geo"].attributes)) assertFrontUpload(sys["geo"].getAttribute(attrName), live * RGB, attrName);
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

const runSmoke = (smoke: TireSmokeSystem, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) smoke.update(STEP, CAMERA);
};
const liveSlots = (life: Float32Array): number[] => Array.from(life.keys()).filter((i) => life[i]! > 0);

/** Short glass-dust puffs in slots 0-9 and 20-29, long plume puffs in 10-19 and 30-39: the dust dies first and leaves gaps. */
function gappedSmoke(): TireSmokeSystem {
  const smoke = new TireSmokeSystem(new THREE.Scene());
  for (let band = 0; band < 2; band++) {
    smoke.glassDust(ORIGIN, new THREE.Quaternion(), DUST_BOX, PUFFS);
    smoke.plume(ORIGIN, UP, PUFFS);
  }
  runSmoke(smoke, DUST_GONE_S);
  return smoke;
}

describe("given a crash smoke pool with dead puffs among live ones", () => {
  it("when it draws, then it draws one instance per live puff, in slot order", () => {
    const smoke = gappedSmoke();
    const mesh = smoke["mesh"];
    const live = liveSlots(smoke["life"]);
    assert.equal(live.length, 2 * PUFFS, "the plumes are up, the dust is gone");
    assert.equal(mesh.count, live.length, "instances drawn");
    const m = new THREE.Matrix4();
    const at = new THREE.Vector3();
    for (let k = 0; k < live.length; k++) {
      at.setFromMatrixPosition(m.fromArray(mesh.instanceMatrix.array, k * MATRIX_FLOATS));
      const slot = live[k]!;
      assert.equal(at.x, smoke["px"][slot], `instance ${k} x is slot ${slot}'s`);
      assert.equal(at.y, smoke["py"][slot], `instance ${k} y is slot ${slot}'s`);
      assert.equal(at.z, smoke["pz"][slot], `instance ${k} z is slot ${slot}'s`);
    }
  });

  it("when it draws, then only the live puffs' matrices and colours are queued for the GPU, into dynamic buffers", () => {
    const smoke = gappedSmoke();
    const mesh = smoke["mesh"];
    const live = liveSlots(smoke["life"]).length;
    assertFrontUpload(mesh.instanceMatrix, live * MATRIX_FLOATS, "matrix");
    assertFrontUpload(mesh.instanceColor!, live * RGB, "colour");
  });

  it("when every puff has died, then it draws none", () => {
    const smoke = gappedSmoke();
    runSmoke(smoke, SMOKE_GONE_S);
    assert.equal(liveSlots(smoke["life"]).length, 0, "all gone");
    assert.equal(smoke["mesh"].count, 0, "instances drawn");
  });
});

describe("given a debris burst in the air", () => {
  it("when it moves, then only the burst's matrices are queued for the GPU", () => {
    const debris = new DebrisSystem(new THREE.Scene());
    debris.burst(ORIGIN, UP, PUFFS);
    debris.update(STEP);
    assert.equal(debris["mesh"].count, PUFFS, "instances drawn");
    assertFrontUpload(debris["mesh"].instanceMatrix, PUFFS * MATRIX_FLOATS, "matrix");
  });
});
