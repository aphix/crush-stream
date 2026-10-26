import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FRAME_HZ, GRAVITY } from "../kernel/constants.ts";
import { DebrisSystem, GlassDotSystem, SparkSystem, TireSmokeSystem } from "./engine-fx.ts";
import { sparkLives } from "./fountain-sparks.test-util.ts";
import { FountainSystem, JET_FADE_S, REBASE_S } from "./fountain-system.ts";
import { drawQueued } from "./fx-uploads.test-util.ts";

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

type Dots = SparkSystem | GlassDotSystem;
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
];

before(() => {
  Object.defineProperty(globalThis, "document", { value: CANVAS, configurable: true });
});
after(() => {
  Reflect.deleteProperty(globalThis, "document");
});

/** `seconds` of frames, each drawn but the last (three sends and clears a drawn frame's queued uploads): the last frame's queue is what a row reads. */
const run = (sys: Dots | FountainSystem, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    if (i > 0) drawQueued(sys["points"]);
    sys.update(STEP);
  }
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

    it("when the pool is made, then its material reads vertex colours exactly when it has a colour attribute", () => {
      const { sys } = make(new THREE.Scene());
      const material = sys["points"].material;
      assert.ok(material instanceof THREE.PointsMaterial);
      assert.equal(material.vertexColors, sys["geo"].getAttribute("color") !== undefined);
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

/** A fountain's sparks are not packed by the CPU: each slot's launch is written once at spawn and the vertex shader flies it, so what the GPU is sent is the spawned slots. */
const ITEM_SIZE = { position: 3, aVel: 3, aSpan: 2, color: 3 } as const;

function fountainRanges(sys: FountainSystem): { name: string; attr: THREE.BufferAttribute; item: number }[] {
  return Object.entries(ITEM_SIZE).map(([name, item]) => {
    const attr = sys["geo"].getAttribute(name);
    assert.ok(attr instanceof THREE.BufferAttribute, `${name} is a plain buffer`);
    return { name, attr, item };
  });
}

/** The shader the pool compiles, from a stand-in carrying the three.js chunks it edits. */
function compiledVertex(sys: FountainSystem): { vertexShader: string; uniforms: Record<string, { value: number }> } {
  const shader = { vertexShader: "#include <common>\n#include <color_vertex>\n#include <begin_vertex>\n#include <project_vertex>", uniforms: {} };
  // The material's hook takes three's whole program-parameters type, of which it reads these two fields.
  (sys["points"].material as THREE.PointsMaterial).onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  return shader;
}

describe("given a fountain pool", () => {
  it("when nothing has been thrown, then it draws no spark and is not drawn", () => {
    const sys = new FountainSystem(new THREE.Scene());
    assert.equal(sys["geo"].drawRange.count, 0);
    assert.equal(sys["points"].visible, false);
  });

  it("when it is made, then its material reads vertex colours and the geometry carries each spark's colour", () => {
    const sys = new FountainSystem(new THREE.Scene());
    const material = sys["points"].material;
    assert.ok(material instanceof THREE.PointsMaterial);
    assert.equal(material.vertexColors, true);
    assert.ok(sys["geo"].getAttribute("color") !== undefined);
  });

  it("when a jet has thrown for a frame, then each attribute queues exactly the slots it spawned and the draw reaches them", () => {
    const sys = new FountainSystem(new THREE.Scene());
    sys.jet(0, 0, 0, 0, 5);
    run(sys, STEP);
    const spawned = sys["cursor"];
    assert.ok(spawned > 0, "the jet threw");
    for (const { name, attr, item } of fountainRanges(sys)) {
      assert.equal(attr.usage, THREE.DynamicDrawUsage, `${name} usage`);
      assert.equal(attr.updateRanges.length, 1, `${name} ranges`);
      assert.equal(attr.updateRanges[0]!.start, 0, `${name} range start`);
      assert.equal(attr.updateRanges[0]!.count, spawned * item, `${name} range count`);
    }
    assert.equal(sys["geo"].drawRange.count, spawned);
    drawQueued(sys["points"]);
    run(sys, STEP);
    const second = sys["cursor"] - spawned;
    assert.ok(second > 0, "the jet threw again");
    for (const { name, attr, item } of fountainRanges(sys)) {
      assert.equal(attr.updateRanges[0]!.start, spawned * item, `${name} second range start`);
      assert.equal(attr.updateRanges[0]!.count, second * item, `${name} second range count`);
    }
    assert.equal(sys["geo"].drawRange.count, spawned + second);
  });

  it("when a frame spawns nothing, then no attribute is sent to the GPU", () => {
    const sys = new FountainSystem(new THREE.Scene());
    sys.jet(0, 0, 0, 1, 5);
    const before = fountainRanges(sys).map(({ attr }) => attr.version);
    run(sys, 0.5);
    for (const [i, { name, attr }] of fountainRanges(sys).entries()) assert.equal(attr.version, before[i], `${name} was sent`);
  });

  it("when the ring wraps, then the spawn that crosses its end sends every slot and the draw stays inside the ring", () => {
    const ring = 21;
    const sys = new FountainSystem(new THREE.Scene(), ring);
    sys.jet(0, 0, 0, 0, 5);
    let sentWhole = false;
    for (let f = 0; f < 30; f++) {
      sys.update(STEP);
      const position = sys["geo"].getAttribute("position") as THREE.BufferAttribute;
      if (position.updateRanges[0]!.count === ring * ITEM_SIZE.position && position.updateRanges[0]!.start === 0) sentWhole = true;
      assert.ok(sys["geo"].drawRange.count <= ring, "the draw stays inside the ring");
    }
    assert.ok(sentWhole, "a frame sent the whole ring");
  });

  it("when update runs at slow-mo or not at all, then the shader's clock advances by exactly the FX time it was given", () => {
    const sys = new FountainSystem(new THREE.Scene());
    sys.update(STEP / 4);
    sys.update(STEP / 4);
    sys.update(0);
    assert.ok(Math.abs(sys["clock"].value - STEP / 2) < 1e-12, `the clock reads ${sys["clock"].value}`);
  });

  it("when every spark has landed, then the pool is not drawn", () => {
    const sys = new FountainSystem(new THREE.Scene());
    sys.jet(0, 0, 0, 0, 0.5);
    run(sys, 0.2);
    assert.equal(sys["points"].visible, true);
    run(sys, ALL_DEAD_S);
    assert.equal(sys["points"].visible, false);
    assert.ok(sparkLives(sys).every((life) => life <= 0));
  });

  it("when the pool is reset in mid-air, then the GPU draws none and every spark is gone", () => {
    const sys = new FountainSystem(new THREE.Scene());
    sys.jet(0, 0, 0, 0, 2);
    run(sys, 0.2);
    sys.reset();
    assert.equal(sys["geo"].drawRange.count, 0);
    assert.equal(sys["points"].visible, false);
    assert.ok(sparkLives(sys).every((life) => life <= 0));
  });

  it("when the clock passes the rebase, then every spark in flight keeps the time it had left", () => {
    const sys = new FountainSystem(new THREE.Scene());
    sys.jet(0, 0, 0, 0, 1000);
    while (sys["clock"].value + STEP < REBASE_S) sys.update(STEP);
    const before = sparkLives(sys);
    assert.ok(before.some((life) => life > 0), "the control: sparks are in flight");
    sys.update(STEP);
    assert.ok(sys["clock"].value < 1, `the clock restarted at ${sys["clock"].value}`);
    for (const [k, life] of sparkLives(sys).entries()) {
      if (before[k]! > STEP * 2) assert.ok(Math.abs(life - (before[k]! - STEP)) < 1e-3, `slot ${k} had ${before[k]} s and has ${life} s a frame later`);
    }
  });

  it("when the vertex shader is built, then it flies each spark by the clock uniform, fades it over its last JET_FADE_S and culls a slot not in flight", () => {
    const sys = new FountainSystem(new THREE.Scene());
    const shader = compiledVertex(sys);
    assert.equal(shader.uniforms.uFxTime, sys["clock"], "the pool's own clock is the uniform");
    assert.ok(shader.vertexShader.includes("uniform float uFxTime"));
    assert.ok(shader.vertexShader.includes(`/ ${JET_FADE_S.toFixed(6)}`), "the fade runs over JET_FADE_S");
    assert.ok(shader.vertexShader.includes(`${(GRAVITY / 2).toFixed(6)} * fxAge * fxAge`), "the arc falls at GRAVITY");
    assert.ok(/if \(fxAge < 0\.0 \|\| fxAge >= aSpan\.y\) gl_Position/.test(shader.vertexShader), "a slot outside its flight is clipped");
  });
});

const runSmoke = (smoke: TireSmokeSystem, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    if (i > 0) drawQueued(smoke["mesh"]);
    smoke.update(STEP, CAMERA);
  }
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
