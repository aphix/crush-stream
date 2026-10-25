import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { allocatedBytes, COMPILE_WAIT_S, untilQuiet } from "../kernel/alloc-sample.test-util.ts";
import { DebrisSystem, FountainSystem, GlassDotSystem, SparkSystem, TireSmokeSystem } from "./engine-fx.ts";

/**
 * The FX pools allocate nothing of their own in a frame: a warmed scene with eight fountain jets, crash sparks, glass, debris and a
 * full ring of smoke, read as the bytes V8's sampling heap profiler sees allocated per frame (a clean read is 4-5 KB, the profiler's
 * own cost). A pool that boxes a double or makes a vector a frame reads far above the bound.
 */

// The fx pools paint their dot sprites on a canvas; the headless run lends them one that takes any draw.
const ctx = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: "" };
const CANVAS = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const STEP = 1 / FRAME_HZ;
const JETS = 8;
const WARM = 600;
const MEASURE = 300;
const BOUND_KB = 8;
/** Vectors the control makes each frame: far more than the bar's worth (over 50 B each). */
const CONTROL_VECTORS = 200;
const ORIGIN = new THREE.Vector3(0, 1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const STILL = new THREE.Vector3();
const CAMERA = new THREE.PerspectiveCamera();

type Pools = { debris: DebrisSystem; sparks: SparkSystem; glass: GlassDotSystem; fountain: FountainSystem; smoke: TireSmokeSystem };
type PoolName = keyof Pools;

before(() => {
  Object.defineProperty(globalThis, "document", { value: CANVAS, configurable: true });
});
after(() => {
  Reflect.deleteProperty(globalThis, "document");
});

function makePools(): Pools {
  const scene = new THREE.Scene();
  const pools = { debris: new DebrisSystem(scene), sparks: new SparkSystem(scene), glass: new GlassDotSystem(scene), fountain: new FountainSystem(scene), smoke: new TireSmokeSystem(scene) };
  pools.sparks.streaked = true;
  for (let j = 0; j < JETS; j++) pools.fountain.jet(j * 3 - 10, 0, 5, 0, 1000);
  return pools;
}

/** One frame: spawns on their own cadences, then every pool's update in the engine's order. */
function frame(p: Pools, f: number): void {
  if (f % 90 === 0) p.debris.burst(ORIGIN, UP, 40);
  p.debris.update(STEP);
  if (f % 60 === 0) p.sparks.poof(ORIGIN, UP, 48);
  p.sparks.update(STEP);
  if (f % 100 === 0) p.glass.burst(ORIGIN, STILL, 40);
  p.glass.update(STEP);
  p.fountain.update(STEP);
  p.smoke.plume(ORIGIN, STILL, 4);
  p.smoke.update(STEP, CAMERA);
}

/** `update` followed by a burst of vectors kept in a few slots: the allocation the measure must see. */
function allocating<A extends unknown[]>(update: (...args: A) => void, kept: THREE.Vector3[]): (...args: A) => void {
  return (...args) => {
    update(...args);
    for (let i = 0; i < CONTROL_VECTORS; i++) kept[i % 8] = new THREE.Vector3();
  };
}

/** Each pool's update made to allocate. */
const MUTATIONS: Record<PoolName, (p: Pools, kept: THREE.Vector3[]) => void> = {
  debris: (p, kept) => void (p.debris.update = allocating(p.debris.update.bind(p.debris), kept)),
  sparks: (p, kept) => void (p.sparks.update = allocating(p.sparks.update.bind(p.sparks), kept)),
  glass: (p, kept) => void (p.glass.update = allocating(p.glass.update.bind(p.glass), kept)),
  fountain: (p, kept) => void (p.fountain.update = allocating(p.fountain.update.bind(p.fountain), kept)),
  smoke: (p, kept) => void (p.smoke.update = allocating(p.smoke.update.bind(p.smoke), kept)),
};

/** KB a frame of a fresh warmed scene over `MEASURE` frames; `mutate` names a pool whose update is made to allocate. */
function kbPerFrame(mutate?: PoolName): number {
  const pools = makePools();
  if (mutate !== undefined) MUTATIONS[mutate](pools, []);
  let f = 0;
  for (; f < WARM; f++) frame(pools, f);
  const kb =
    allocatedBytes(() => {
      for (const end = f + MEASURE; f < end; f++) frame(pools, f);
    }) /
    1024 /
    MEASURE;
  if (process.env.ALLOC_PRINT) console.log(`engine-fx-alloc ${mutate ?? "clean"}: ${kb.toFixed(2)} KB/frame`);
  return kb;
}

describe("given a warmed FX scene of eight fountain jets, sparks, glass, debris and smoke", () => {
  it(`when 300 frames are stepped, then the pools allocate at most ${BOUND_KB} KB per frame`, () => {
    const kb = untilQuiet(() => kbPerFrame(), BOUND_KB);
    assert.ok(kb <= BOUND_KB, `${kb.toFixed(2)} KB per frame > ${BOUND_KB} in every run for ${COMPILE_WAIT_S} s: an FX pool allocates again`);
  });
});

const POOL_NAMES: readonly PoolName[] = ["debris", "sparks", "glass", "fountain", "smoke"];
for (const name of POOL_NAMES) {
  describe(`given the allocation measure on the ${name} pool`, () => {
    it("when its update also makes two hundred vectors a frame, then the scene reads over the bar", () => {
      const kb = kbPerFrame(name);
      assert.ok(kb > BOUND_KB, `${kb.toFixed(2)} KB per frame for ${CONTROL_VECTORS} vectors a frame: the measure sees nothing`);
    });
  });
}
