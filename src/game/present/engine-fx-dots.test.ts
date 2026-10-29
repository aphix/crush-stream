import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { FRAME_HZ, GRAVITY } from "../kernel/constants.ts";
import { DebrisSystem, GlassDotSystem, SparkSystem, TireSmokeSystem } from "./engine-fx.ts";
import { sparkLives } from "./fountain-sparks.test-util.ts";
import { FountainSystem, JET_FADE_S, REBASE_S } from "./fountain-system.ts";
import { drawQueued } from "./fx-uploads.test-util.ts";
import { must } from "../kernel/must.test-util.ts";

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
type PoolName = "spark" | "glass chip";

const POOLS: readonly { name: PoolName }[] = [{ name: "spark" }, { name: "glass chip" }];

function makePool(name: PoolName, scene: THREE.Scene): { sys: Dots; shower: () => void } {
  if (name === "spark") {
    const sys = new SparkSystem(scene);
    return { sys, shower: () => sys.poof(ORIGIN, UP, 48) };
  }
  const sys = new GlassDotSystem(scene);
  return { sys, shower: () => sys.burst(ORIGIN, STILL, 40) };
}

beforeAll(() => {
  Object.defineProperty(globalThis, "document", { value: CANVAS, configurable: true });
});
afterAll(() => {
  Reflect.deleteProperty(globalThis, "document");
});

/** `seconds` of frames, each drawn but the last (three sends and clears a drawn frame's queued uploads): the last frame's queue is what a row reads. */
const run = (sys: Dots | FountainSystem, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    if (i > 0) drawQueued(sys instanceof FountainSystem ? sys["points"] : sys["points"]);
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
  must(attr instanceof THREE.BufferAttribute, `${label} is a plain buffer`);
  expect(attr.usage, `${label} usage`).toBe(THREE.DynamicDrawUsage);
  expect(attr.updateRanges.length, `${label} ranges`).toBe(1);
  expect(attr.updateRanges[0]!.start, `${label} range start`).toBe(0);
  expect(attr.updateRanges[0]!.count, `${label} range count`).toBe(floats);
}

for (const { name } of POOLS) {
  describe(`given a ${name} pool`, () => {
    it("when nothing has been thrown, then the GPU draws no dot", () => {
      const { sys } = makePool(name, new THREE.Scene());
      expect(drawn(sys)).toBe(0);
    });

    it("when the pool is made, then its material reads vertex colours exactly when it has a colour attribute", () => {
      const { sys } = makePool(name, new THREE.Scene());
      const material = sys["points"].material;
      must(material instanceof THREE.PointsMaterial, "the pool's material is a points material");
      expect(material.vertexColors).toBe(sys["geo"].getAttribute("color") !== undefined);
    });

    it("when a shower is in the air, then the GPU draws exactly its live dots, all near the world", () => {
      const { sys, shower } = makePool(name, new THREE.Scene());
      shower();
      run(sys, 0.2);
      const live = alive(sys);
      expect(live, "the shower is still up").toBeGreaterThan(0);
      expect(drawn(sys), "one drawn dot per live dot").toBe(live);
      expect(Math.max(...drawnY(sys)), "no drawn dot is parked high above the world").toBeLessThan(NEAR_WORLD_M);
    });

    it("when a shower is in the air, then only the live dots' floats are queued for the GPU, into dynamic buffers", () => {
      const { sys, shower } = makePool(name, new THREE.Scene());
      shower();
      run(sys, 0.2);
      const live = alive(sys);
      for (const attrName of Object.keys(sys["geo"].attributes)) assertFrontUpload(sys["geo"].getAttribute(attrName), live * RGB, attrName);
    });

    it("when every dot of the shower has died, then the GPU draws none", () => {
      const { sys, shower } = makePool(name, new THREE.Scene());
      shower();
      run(sys, ALL_DEAD_S);
      expect(drawn(sys)).toBe(0);
    });

    it("when the pool is reset in mid-air, then the GPU draws none", () => {
      const { sys, shower } = makePool(name, new THREE.Scene());
      shower();
      run(sys, 0.2);
      sys.reset();
      expect(drawn(sys)).toBe(0);
    });
  });
}

/** A fountain's sparks are not packed by the CPU: each slot's launch is written once at spawn and the vertex shader flies it, so what the GPU is sent is the spawned slots. */
const ITEM_SIZE = { position: 3, aVel: 3, aSpan: 2, color: 3 } as const;

function fountainRanges(sys: FountainSystem): { name: string; attr: THREE.BufferAttribute; item: number }[] {
  return Object.entries(ITEM_SIZE).map(([name, item]) => {
    const attr = sys["geo"].getAttribute(name);
    must(attr instanceof THREE.BufferAttribute, `${name} is a plain buffer`);
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
    expect(sys["geo"].drawRange.count).toBe(0);
    expect(sys["points"].visible).toBe(false);
  });

  it("when it is made, then its material reads vertex colours and the geometry carries each spark's colour", () => {
    const sys = new FountainSystem(new THREE.Scene());
    const material = sys["points"].material;
    must(material instanceof THREE.PointsMaterial, "the pool's material is a points material");
    expect(material.vertexColors).toBe(true);
    expect(sys["geo"].getAttribute("color")).not.toBe(undefined);
  });

  it("when a jet has thrown for a frame, then each attribute queues exactly the slots it spawned and the draw reaches them", () => {
    const sys = new FountainSystem(new THREE.Scene());
    sys.jet(0, 0, 0, 0, 5);
    run(sys, STEP);
    const spawned = sys["cursor"];
    expect(spawned, "the jet threw").toBeGreaterThan(0);
    for (const { name, attr, item } of fountainRanges(sys)) {
      expect(attr.usage, `${name} usage`).toBe(THREE.DynamicDrawUsage);
      expect(attr.updateRanges.length, `${name} ranges`).toBe(1);
      expect(attr.updateRanges[0]!.start, `${name} range start`).toBe(0);
      expect(attr.updateRanges[0]!.count, `${name} range count`).toBe(spawned * item);
    }
    expect(sys["geo"].drawRange.count).toBe(spawned);
    drawQueued(sys["points"]);
    run(sys, STEP);
    const second = sys["cursor"] - spawned;
    expect(second, "the jet threw again").toBeGreaterThan(0);
    for (const { name, attr, item } of fountainRanges(sys)) {
      expect(attr.updateRanges[0]!.start, `${name} second range start`).toBe(spawned * item);
      expect(attr.updateRanges[0]!.count, `${name} second range count`).toBe(second * item);
    }
    expect(sys["geo"].drawRange.count).toBe(spawned + second);
  });

  it("when a frame spawns nothing, then no attribute is sent to the GPU", () => {
    const sys = new FountainSystem(new THREE.Scene());
    sys.jet(0, 0, 0, 1, 5);
    const before = fountainRanges(sys).map(({ attr }) => attr.version);
    run(sys, 0.5);
    for (const [i, { name, attr }] of fountainRanges(sys).entries()) expect(attr.version, `${name} was sent`).toBe(before[i]);
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
      expect(sys["geo"].drawRange.count, "the draw stays inside the ring").toBeLessThanOrEqual(ring);
    }
    expect(sentWhole, "a frame sent the whole ring").toBeTruthy();
  });

  it("when the fountain is stepped at slow-mo rates or not at all, then the shader's clock advances by exactly the FX time it was given", () => {
    const sys = new FountainSystem(new THREE.Scene());
    sys.update(STEP / 4);
    sys.update(STEP / 4);
    sys.update(0);
    expect(Math.abs(sys["clock"].value - STEP / 2), `the clock reads ${sys["clock"].value}`).toBeLessThan(1e-12);
  });

  it("when every spark has landed, then the pool is not drawn", () => {
    const sys = new FountainSystem(new THREE.Scene());
    sys.jet(0, 0, 0, 0, 0.5);
    run(sys, 0.2);
    expect(sys["points"].visible).toBe(true);
    run(sys, ALL_DEAD_S);
    expect(sys["points"].visible).toBe(false);
    expect(sparkLives(sys).every((life) => life <= 0)).toBeTruthy();
  });

  it("when the pool is reset in mid-air, then the GPU draws none and every spark is gone", () => {
    const sys = new FountainSystem(new THREE.Scene());
    sys.jet(0, 0, 0, 0, 2);
    run(sys, 0.2);
    sys.reset();
    expect(sys["geo"].drawRange.count).toBe(0);
    expect(sys["points"].visible).toBe(false);
    expect(sparkLives(sys).every((life) => life <= 0)).toBeTruthy();
  });

  it("when the clock passes the rebase, then every spark in flight keeps the time it had left", () => {
    const sys = new FountainSystem(new THREE.Scene());
    sys.jet(0, 0, 0, 0, 1000);
    while (sys["clock"].value + STEP < REBASE_S) sys.update(STEP);
    const before = sparkLives(sys);
    expect(before.some((life) => life > 0), "the control: sparks are in flight").toBeTruthy();
    sys.update(STEP);
    expect(sys["clock"].value, `the clock restarted at ${sys["clock"].value}`).toBeLessThan(1);
    for (const [k, life] of sparkLives(sys).entries()) {
      if (before[k]! > STEP * 2) expect(Math.abs(life - (before[k]! - STEP)), `slot ${k} had ${before[k]} s and has ${life} s a frame later`).toBeLessThan(1e-3);
    }
  });

  it("when the vertex shader is built, then it flies each spark by the pool's clock, fades it over the end of its flight and culls a slot not in flight", () => {
    const sys = new FountainSystem(new THREE.Scene());
    const shader = compiledVertex(sys);
    expect(shader.uniforms.uFxTime, "the pool's own clock is the uniform").toBe(sys["clock"]);
    expect(shader.vertexShader.includes("uniform float uFxTime")).toBeTruthy();
    expect(shader.vertexShader.includes(`/ ${JET_FADE_S.toFixed(6)}`), "the fade runs over JET_FADE_S").toBeTruthy();
    expect(shader.vertexShader.includes(`${(GRAVITY / 2).toFixed(6)} * fxAge * fxAge`), "the arc falls at GRAVITY").toBeTruthy();
    expect(/if \(fxAge < 0\.0 \|\| fxAge >= aSpan\.y\) gl_Position/.test(shader.vertexShader), "a slot outside its flight is clipped").toBeTruthy();
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
    expect(live.length, "the plumes are up, the dust is gone").toBe(2 * PUFFS);
    expect(mesh.count, "instances drawn").toBe(live.length);
    const m = new THREE.Matrix4();
    const at = new THREE.Vector3();
    for (let k = 0; k < live.length; k++) {
      at.setFromMatrixPosition(m.fromArray(mesh.instanceMatrix.array, k * MATRIX_FLOATS));
      const slot = live[k]!;
      expect(at.x, `instance ${k} x is slot ${slot}'s`).toBe(smoke["px"][slot]);
      expect(at.y, `instance ${k} y is slot ${slot}'s`).toBe(smoke["py"][slot]);
      expect(at.z, `instance ${k} z is slot ${slot}'s`).toBe(smoke["pz"][slot]);
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
    expect(liveSlots(smoke["life"]).length, "all gone").toBe(0);
    expect(smoke["mesh"].count, "instances drawn").toBe(0);
  });
});

describe("given a debris burst in the air", () => {
  it("when it moves, then only the burst's matrices are queued for the GPU", () => {
    const debris = new DebrisSystem(new THREE.Scene());
    debris.burst(ORIGIN, UP, PUFFS);
    debris.update(STEP);
    expect(debris["mesh"].count, "instances drawn").toBe(PUFFS);
    assertFrontUpload(debris["mesh"].instanceMatrix, PUFFS * MATRIX_FLOATS, "matrix");
  });
});
