import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { applySpray, BARE_SPRAY, sprayUniforms } from "../present/spray.ts";
import { CAR_SPRAY, NO_CAR_PICK } from "../match/look-data.ts";
import { wearCarLook } from "../present/car-look.ts";
import { HudStore } from "../hud/hud-store.ts";
import { CrashEngine } from "../engine/engine.ts";
import { element, stubBrowser } from "../engine/engine-headless.test-util.ts";
import { setGround } from "../world/ground.ts";
import "../kernel/rapier-node.test-util.ts";
import { DeformableCar } from "./car.ts";
import * as finishModule from "./car-finish.ts";
import type * as CarFinish from "./car-finish.ts";
import { makePaintMaterial, trimMaterial } from "./car-materials.ts";
import { assertSameNumbers, paint } from "./test-support.ts";

/** What a car material's program key is with the finish off: the strings these tests prove an OFF material still has (the trim's names its fittings hook). */
const PAINT_KEY_TODAY = "car-paint-primer";
const TRIM_KEY_TODAY = "car-trim-fittings";
const SPRAY_SUFFIX = "|spray-car";

type FinishModule = typeof CarFinish;
const { applyCarFinish, finishForTier } = finishModule;
type FinishKind = "paint" | "trim";

/** A second copy of the module with its own `once` caches, so a texture it builds is a build from scratch. A static import would return the one cached copy, which is the point of the dynamic one. */
async function freshFinishModule(): Promise<FinishModule> {
  return import(new URL("./car-finish.ts?fresh-build", import.meta.url).href);
}

const NO_UNIFORMS: Record<string, THREE.IUniform> = {};

/** The shader a three program build hands `onBeforeCompile`: the real physical template, includes still unresolved. */
function stubShader() {
  return { uniforms: { ...NO_UNIFORMS }, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
}

/** `#include <chunk>` lines replaced by the chunk's text, as the program build does after `onBeforeCompile`. */
function resolveIncludes(source: string): string {
  return source.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_line, chunk: string) => resolveIncludes(THREE.ShaderChunk[chunk as keyof typeof THREE.ShaderChunk]));
}

function compile(material: THREE.Material) {
  const shader = stubShader();
  Reflect.apply(material.onBeforeCompile, material, [shader]);
  return { uniforms: shader.uniforms, vertex: resolveIncludes(shader.vertexShader), fragment: resolveIncludes(shader.fragmentShader) };
}

function materialOfKind(kind: FinishKind, color: number): THREE.MeshStandardMaterial {
  return kind === "paint" ? makePaintMaterial(color) : trimMaterial(color);
}

function switchFinish(material: THREE.Material, enabled: boolean): void {
  applyCarFinish(new THREE.Mesh(new THREE.BufferGeometry(), material), enabled);
}

/** The finish map the shader of a fresh `kind` material samples, built by `module`. */
function finishTextureOf(module: FinishModule, kind: FinishKind): THREE.DataTexture {
  const material = module.applyFinish(kind === "paint" ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial(), kind);
  module.applyCarFinish(new THREE.Mesh(new THREE.BufferGeometry(), material), true);
  const { uniforms } = compile(material);
  return uniforms.finishMap!.value as THREE.DataTexture;
}

/** Every finish-capable material under `root`: paint (physical) and trim (standard). */
function finishMaterialsUnder(root: THREE.Object3D): { paints: THREE.Material[]; trims: THREE.Material[] } {
  const found = new Set<THREE.Material>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) for (const material of [object.material].flat()) if (material.userData.carFinish !== undefined) found.add(material);
  });
  const all = [...found];
  return { paints: all.filter((m) => m instanceof THREE.MeshPhysicalMaterial), trims: all.filter((m) => !(m instanceof THREE.MeshPhysicalMaterial)) };
}

const textureCases = [
  { it: "when the paint finish map is built, then it is a 256 x 256 RGBA8 map with R, G and B heights and opaque alpha", kind: "paint", width: 256, height: 256, format: THREE.RGBAFormat, channels: 4, heightChannels: [0, 1, 2] },
  { it: "when the trim grain map is built, then it is a 128 x 128 single-channel 8-bit map", kind: "trim", width: 128, height: 128, format: THREE.RedFormat, channels: 1, heightChannels: [0] },
] as const;

describe("given the procedural car finish maps", () => {
  for (const testCase of textureCases) {
    it(testCase.it, () => {
      const texture = finishTextureOf(finishModule, testCase.kind);
      const data = texture.image.data as Uint8Array;
      assert.equal(texture.image.width, testCase.width, "width");
      assert.equal(texture.image.height, testCase.height, "height");
      assert.equal(texture.format, testCase.format, "format");
      assert.equal(texture.type, THREE.UnsignedByteType, "type");
      assert.equal(data.length, testCase.width * testCase.height * testCase.channels, "byte count");
      assert.equal(texture.wrapS, THREE.RepeatWrapping, "wrapS");
      assert.equal(texture.wrapT, THREE.RepeatWrapping, "wrapT");
      assert.equal(texture.generateMipmaps, true, "mipmaps");
      assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter, "minFilter");
      assert.ok(texture.anisotropy > 1, "anisotropic");
      assert.equal(texture.userData.shared, true, "shared, never disposed with a car");
    });
  }

  for (const testCase of textureCases) {
    it(`when the ${testCase.kind} map is built twice from scratch, then every byte is the same`, async () => {
      const fresh = await freshFinishModule();
      const first = finishTextureOf(finishModule, testCase.kind).image.data as Uint8Array;
      const second = finishTextureOf(fresh, testCase.kind).image.data as Uint8Array;
      assert.notEqual(first, second, "two separate builds, not one cached array");
      assertSameNumbers(second, first, `${testCase.kind} finish bytes`);
    });
  }

  for (const testCase of textureCases) {
    for (const channel of testCase.heightChannels) {
      it(`when the ${testCase.kind} map's channel ${channel} is read, then it has relief (min below max) and the left edge continues into the right edge`, () => {
        const texture = finishTextureOf(finishModule, testCase.kind);
        const data = texture.image.data as Uint8Array;
        const at = (x: number, y: number) => data[(y * testCase.width + x) * testCase.channels + channel]!;
        let lowest = 255;
        let highest = 0;
        let interiorStepX = 0;
        let interiorStepY = 0;
        let wrapStepX = 0;
        let wrapStepY = 0;
        for (let y = 0; y < testCase.height; y++) {
          for (let x = 0; x < testCase.width; x++) {
            lowest = Math.min(lowest, at(x, y));
            highest = Math.max(highest, at(x, y));
            const rightOf = Math.abs(at((x + 1) % testCase.width, y) - at(x, y));
            const below = Math.abs(at(x, (y + 1) % testCase.height) - at(x, y));
            if (x === testCase.width - 1) wrapStepX = Math.max(wrapStepX, rightOf);
            else interiorStepX = Math.max(interiorStepX, rightOf);
            if (y === testCase.height - 1) wrapStepY = Math.max(wrapStepY, below);
            else interiorStepY = Math.max(interiorStepY, below);
          }
        }
        assert.ok(lowest < highest, `channel ${channel} is flat at ${lowest}`);
        assert.ok(wrapStepX <= interiorStepX, `right edge to left edge steps ${wrapStepX}, interior steps at most ${interiorStepX}`);
        assert.ok(wrapStepY <= interiorStepY, `bottom edge to top edge steps ${wrapStepY}, interior steps at most ${interiorStepY}`);
      });
    }
  }

  it("when the paint map is built, then its alpha channel is opaque in every texel", () => {
    const data = finishTextureOf(finishModule, "paint").image.data as Uint8Array;
    let lowestAlpha = 255;
    for (let i = 3; i < data.length; i += 4) lowestAlpha = Math.min(lowestAlpha, data[i]!);
    assert.equal(lowestAlpha, 255);
  });
});

const tierCases = [
  { it: "when the tier is ultra, then the finish is on", tier: "ultra", expectedOn: true },
  { it: "when the tier is high, then the finish is on", tier: "high", expectedOn: true },
  { it: "when the tier is low, then the finish is off", tier: "low", expectedOn: false },
  { it: "when the tier is minimal, then the finish is off", tier: "minimal", expectedOn: false },
  { it: "when the tier is off, then the finish is off", tier: "off", expectedOn: false },
] as const;

describe("given the FX tiers", () => {
  for (const testCase of tierCases) {
    it(testCase.it, () => {
      assert.equal(finishForTier(testCase.tier), testCase.expectedOn);
    });
  }
});

const keyCases = [
  { it: "when the finish is on, then the paint program key names the paint finish and the trim key the trim finish", enabled: true, paintKey: `${PAINT_KEY_TODAY}|finish-paint`, trimKey: `${TRIM_KEY_TODAY}|finish-trim` },
  { it: "when the finish is switched off again, then every key is the one a car had before the finish existed", enabled: false, paintKey: PAINT_KEY_TODAY, trimKey: TRIM_KEY_TODAY },
] as const;

describe("given a built car", () => {
  for (const testCase of keyCases) {
    it(testCase.it, () => {
      const car = new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
      applyCarFinish(car.group, !testCase.enabled);
      applyCarFinish(car.group, testCase.enabled);
      const { paints, trims } = finishMaterialsUnder(car.group);
      assert.ok(paints.length > 0, "the car has finish-capable paint");
      assert.ok(trims.length > 0, "the car has finish-capable trim");
      for (const material of paints) assert.equal(material.customProgramCacheKey(), testCase.paintKey, "paint key");
      for (const material of trims) assert.equal(material.customProgramCacheKey(), testCase.trimKey, "trim key");
      car.dispose();
    });
  }

  it("when the finish is switched on and off, then each real change marks the material for a rebuild", () => {
    const car = new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
    applyCarFinish(car.group, false);
    const { paints, trims } = finishMaterialsUnder(car.group);
    const materials = [...paints, ...trims];
    const before = materials.map((m) => m.version);
    applyCarFinish(car.group, true);
    const afterOn = materials.map((m) => m.version);
    applyCarFinish(car.group, false);
    const afterOff = materials.map((m) => m.version);
    for (let i = 0; i < materials.length; i++) {
      assert.equal(afterOn[i], before[i]! + 1, `material ${i} rebuilt once on switching on`);
      assert.equal(afterOff[i], before[i]! + 2, `material ${i} rebuilt once on switching off`);
    }
    car.dispose();
  });

  it("when the finish is set to the state it is already in, then no material is marked for a rebuild and nothing reports a change", () => {
    const car = new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
    applyCarFinish(car.group, true);
    const { paints, trims } = finishMaterialsUnder(car.group);
    const materials = [...paints, ...trims];
    const before = materials.map((m) => m.version);
    const changed = applyCarFinish(car.group, true);
    const after = materials.map((m) => m.version);
    assert.equal(changed, false, "reports no change");
    assertSameNumbers(after, before, "material versions after a repeat");
    assert.equal(applyCarFinish(car.group, false), true, "the real switch still reports its change");
    car.dispose();
  });
});

describe("given a paint material that already wears a spray", () => {
  const sprayCases = [
    { it: "when the finish is on, then the key carries the finish before the spray's", enabled: true, expectedKey: `${PAINT_KEY_TODAY}|finish-paint${SPRAY_SUFFIX}` },
    { it: "when the finish is off, then the key is exactly today's primer and spray key", enabled: false, expectedKey: `${PAINT_KEY_TODAY}${SPRAY_SUFFIX}` },
  ] as const;
  for (const testCase of sprayCases) {
    it(testCase.it, () => {
      const material = makePaintMaterial(0x336699);
      applySpray(material, sprayUniforms(CAR_SPRAY, BARE_SPRAY, 1), "attribute vec3 sprayPos;\nattribute vec3 sprayNrm;", "vSprayP = sprayPos;\nvSprayN = sprayNrm;\nvSprayRow = 0.0;", "car");
      switchFinish(material, !testCase.enabled);
      switchFinish(material, testCase.enabled);
      assert.equal(material.customProgramCacheKey(), testCase.expectedKey);
    });
  }

  it("when the finish is on, then the compiled shader carries both the spray and the finish", () => {
    const material = makePaintMaterial(0x336699);
    applySpray(material, sprayUniforms(CAR_SPRAY, BARE_SPRAY, 1), "attribute vec3 sprayPos;\nattribute vec3 sprayNrm;", "vSprayP = sprayPos;\nvSprayN = sprayNrm;\nvSprayRow = 0.0;", "car");
    switchFinish(material, true);
    const { fragment } = compile(material);
    assert.ok(fragment.includes("sprayTexel()"), "spray in the shader");
    assert.ok(fragment.includes("finishPlaneWeights("), "finish in the shader");
  });
});

describe("given a fresh car material with the finish never switched on", () => {
  const todayCases = [
    { it: "when its program key is read, then a paint material has today's key", kind: "paint", color: 0x102030, expectedKey: PAINT_KEY_TODAY },
    { it: "when its program key is read, then a trim material has today's key", kind: "trim", color: 0x102031, expectedKey: TRIM_KEY_TODAY },
  ] as const;
  for (const testCase of todayCases) {
    it(testCase.it, () => {
      assert.equal(materialOfKind(testCase.kind, testCase.color).customProgramCacheKey(), testCase.expectedKey);
    });
  }
});

const shaderCases = [
  { it: "when a paint material compiles with the finish on, then its fragment shader samples the finish map in three planes and perturbs the clear coat normal after the clear coat chunk", kind: "paint", color: 0x203040, enabled: true, expectedBlock: true, expectedClearcoat: true },
  { it: "when a paint material compiles with the finish off, then its shader has no finish block and leaves the clear coat normal alone", kind: "paint", color: 0x203041, enabled: false, expectedBlock: false, expectedClearcoat: false },
  { it: "when a trim material compiles with the finish on, then its shader samples the grain map and has no clear coat to perturb", kind: "trim", color: 0x203042, enabled: true, expectedBlock: true, expectedClearcoat: false },
] as const;

describe("given a car material being compiled", () => {
  for (const testCase of shaderCases) {
    it(testCase.it, () => {
      const material = materialOfKind(testCase.kind, testCase.color);
      switchFinish(material, testCase.enabled);
      const { uniforms, vertex, fragment } = compile(material);
      assert.equal(uniforms.finishMap?.value instanceof THREE.DataTexture, testCase.expectedBlock, "finish map texture");
      assert.equal(fragment.includes("finishPlaneWeights("), testCase.expectedBlock, "triplanar weights in the fragment shader");
      assert.equal(vertex.includes("vFinishPos = position;"), testCase.expectedBlock, "object-space position handed on by the vertex shader");
      assert.equal(vertex.includes("vFinishNormal = objectNormal;"), testCase.expectedBlock, "object-space normal handed on by the vertex shader");
      assert.equal(fragment.includes("clearcoatNormal = finishPerturbedNormal("), testCase.expectedClearcoat, "clear coat normal perturbed");
      const declared = fragment.indexOf("vec3 clearcoatNormal = nonPerturbedNormal;");
      const perturbed = fragment.indexOf("clearcoatNormal = finishPerturbedNormal(");
      const lit = fragment.indexOf("material.diffuseColor = diffuseColor.rgb");
      if (testCase.expectedClearcoat) assert.ok(declared >= 0 && declared < perturbed && perturbed < lit, `declaration ${declared}, perturbation ${perturbed}, lighting ${lit}`);
    });
  }

  it("when a paint material compiles with the finish on, then the base normal also gets the flake term the clear coat does not", () => {
    const material = materialOfKind("paint", 0x203043);
    switchFinish(material, true);
    const { fragment } = compile(material);
    assert.ok(fragment.includes("normal = finishPerturbedNormal(normal, baseSlope"), "base layer: waviness, peel and flake");
    assert.ok(fragment.includes("clearcoatNormal = finishPerturbedNormal(clearcoatNormal, coatSlope"), "clear coat: waviness and peel only");
  });

  const gateCases = [
    {
      it: "when a paint material compiles with the finish on, then its broad fetch stops past 90 m, its grain fetch past 18 m and the whole block past 90 m from the mesh, reach 4 m",
      kind: "paint",
      gates: ["if (meshNear < 90.0) heights.x = (finishTriplanar(p, w, 2.4)", "if (meshNear < 18.0) heights.yz = (finishTriplanar(p, w, 0.12)"],
      fetchLines: 2,
    },
    { it: "when a trim material compiles with the finish on, then its grain fetch and the whole block stop past 16 m from the mesh, reach 4 m", kind: "trim", gates: ["if (finishMeshNear() >= 16.0) return vec3(0.0);"], fetchLines: 1 },
  ] as const;
  for (const testCase of gateCases) {
    it(testCase.it, () => {
      const material = materialOfKind(testCase.kind, 0x203044);
      switchFinish(material, true);
      const { fragment } = compile(material);
      const lines = fragment.split("\n").map((line) => line.trim());
      assert.equal(lines.filter((line) => line === "uniform mat4 modelViewMatrix;").length, 1, "the mesh's view transform declared once");
      assert.ok(lines.includes("return length(modelViewMatrix[3].xyz) - 4.0;"), "the nearest pixel of the draw: its origin's distance less the reach");
      assert.ok(lines.includes("if (finishMeshNear() < max(finishFadeEnd.x, max(finishFadeEnd.y, finishFadeEnd.z))) {"), "the normal block skipped once every layer has faded");
      const fetchLines = lines.filter((line) => line.includes("finishTriplanar(p, w,") || (line.includes("texture2D(finishMap") && !line.startsWith("return")));
      assert.equal(fetchLines.length, testCase.fetchLines, `fetch lines: ${fetchLines.join(" / ")}`);
      const gateAt = testCase.gates.map((gate) => lines.findIndex((line) => line.startsWith(gate)));
      assert.ok(gateAt.every((at) => at >= 0), `gates found at lines ${gateAt.join(", ")}`);
      if (testCase.kind === "trim") assert.ok(gateAt[0]! < lines.findIndex((line) => line.includes("texture2D(finishMap")), "the trim gate comes before its fetch");
    });
  }
});

/** The paint's tones: what its old 1 x 1 colour map (sRGB 0xf2f2f0) and roughness map (0x8a) multiplied in. */
const PAINT_TONE = new THREE.Color(0xf2f2f0);
const PAINT_TONE_LINE = `diffuseColor.rgb *= vec3(${PAINT_TONE.r}, ${PAINT_TONE.g}, ${PAINT_TONE.b});`;
const ROUGHNESS_TONE_LINE = `roughnessFactor *= ${0x8a / 0xff};`;

describe("given the tones every paint material multiplies in", () => {
  it("when a paint material is made where there is no document, then it samples no texture for them: no colour map, no roughness map", () => {
    const material = makePaintMaterial(0x445566);
    assert.equal(typeof document, "undefined");
    assert.equal(material.map, null, "colour map");
    assert.equal(material.roughnessMap, null, "roughness map");
  });

  it("when a sprayed paint compiles, then the colour tone lands where the map was, before the spray, and the roughness tone after the roughness chunk", () => {
    const material = makePaintMaterial(0x445566);
    applySpray(material, sprayUniforms(CAR_SPRAY, BARE_SPRAY, 1), "attribute vec3 sprayPos;\nattribute vec3 sprayNrm;", "vSprayP = sprayPos;\nvSprayN = sprayNrm;\nvSprayRow = 0.0;", "car");
    const { fragment } = compile(material);
    const tone = fragment.indexOf(PAINT_TONE_LINE);
    assert.ok(tone > fragment.indexOf("diffuseColor *= sampledDiffuseColor"), "the colour tone follows the map chunk");
    assert.ok(tone < fragment.indexOf("vec4 sprayS = sprayTexel();"), "the colour tone comes before the spray (the spray is not toned)");
    assert.ok(fragment.indexOf(ROUGHNESS_TONE_LINE) > fragment.indexOf("float roughnessFactor = roughness;"), "the roughness tone follows roughnessFactor");
  });
});

const FINISH_KEY_MARK = "|finish-";

/** The engine's tiers this file switches to, with whether each draws the finish. */
const engineTierCases = [
  { it: "when the player picks high, then every paint and trim key carries the finish", tier: "high", expectedOn: true },
  { it: "when the player picks low, then every paint and trim key is today's plain key again", tier: "low", expectedOn: false },
  { it: "when the player picks minimal, then the finish is off", tier: "minimal", expectedOn: false },
  { it: "when the player picks off, then the finish is off", tier: "off", expectedOn: false },
] as const;

// Last in the file: the engine's browser stand-ins define `document`, which the headless paint map row above must not see.
describe("given the real engine with its cars on the screen", () => {
  let engine: CrashEngine;
  before(async () => {
    stubBrowser();
    engine = new CrashEngine(element(), new HudStore(), element());
    Object.assign(engine["renderer"], { render() {}, compile() {}, compileAsync: () => Promise.resolve() });
    await engine.ready;
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  const keysOfEveryCar = (): { paintKeys: string[]; trimKeys: string[] } => {
    const paintKeys: string[] = [];
    const trimKeys: string[] = [];
    for (const car of engine["live"]()) {
      const { paints, trims } = finishMaterialsUnder(car.group);
      for (const material of paints) paintKeys.push(material.customProgramCacheKey());
      for (const material of trims) trimKeys.push(material.customProgramCacheKey());
    }
    return { paintKeys, trimKeys };
  };

  for (const testCase of engineTierCases) {
    it(testCase.it, () => {
      engine.setFxTier(testCase.expectedOn ? "low" : "high");
      engine.setFxTier(testCase.tier);
      const { paintKeys, trimKeys } = keysOfEveryCar();
      assert.ok(paintKeys.length > 0 && trimKeys.length > 0, "the cars carry finish-capable materials");
      for (const key of paintKeys) assert.equal(key.includes(FINISH_KEY_MARK), testCase.expectedOn, `paint key ${key}`);
      for (const key of trimKeys) assert.equal(key.includes(FINISH_KEY_MARK), testCase.expectedOn, `trim key ${key}`);
    });
  }

  it("when a car that never wore a look wears its first one on the high tier and is dressed, then its new lid and door paints carry the finish too", () => {
    engine.setFxTier("high");
    const car = engine["buildCar"](engine["cars"].length);
    wearCarLook(car, { ...NO_CAR_PICK, body: 0x2244cc, bumpers: 0xcc4422 }, null);
    const unfinished = finishMaterialsUnder(car.group).paints.filter((material) => !material.customProgramCacheKey().includes(FINISH_KEY_MARK));
    assert.ok(unfinished.length > 0, "the look's new paints start without the finish");
    engine["dressCar"](car);
    const { paints, trims } = finishMaterialsUnder(car.group);
    for (const material of [...paints, ...trims]) assert.ok(material.customProgramCacheKey().includes(FINISH_KEY_MARK), `key ${material.customProgramCacheKey()}`);
    engine["scene"].remove(car.group);
    car.dispose();
  });

  it("when a car dressed on the low tier still has its finish switched on, then dressing it switches the finish off", () => {
    engine.setFxTier("low");
    const car = engine["live"]()[1]!;
    applyCarFinish(car.group, true);
    engine["dressCar"](car);
    const { paints, trims } = finishMaterialsUnder(car.group);
    for (const material of [...paints, ...trims]) assert.equal(material.customProgramCacheKey().includes(FINISH_KEY_MARK), false, `key ${material.customProgramCacheKey()}`);
  });
});

/** What the renderer binds for `material` now (`WebGLRenderer.properties`): whether its current program draws the finish, and the finish map in the uniforms it uploads to that program (null: none). */
function boundFinish(renderer: THREE.WebGLRenderer, material: THREE.Material): { finishProgram: boolean; finishMap: THREE.Texture | null } {
  const built = renderer.properties.get(material);
  assert.ok(typeof built === "object" && built !== null && "currentProgram" in built && "uniforms" in built, "the renderer has built the material");
  const { currentProgram: program, uniforms } = built;
  assert.ok(typeof program === "object" && program !== null && "cacheKey" in program && typeof program.cacheKey === "string", "a current program");
  assert.ok(typeof uniforms === "object" && uniforms !== null, "uniforms for it");
  const holder = "finishMap" in uniforms ? uniforms.finishMap : null;
  const map: unknown = typeof holder === "object" && holder !== null && "value" in holder ? holder.value : null;
  return { finishProgram: program.cacheKey.includes(FINISH_KEY_MARK), finishMap: map instanceof THREE.Texture ? map : null };
}

describe("given a police car whose paint and trim the renderer built with the finish on, then off (Auto drops to minimal as a match starts)", () => {
  it("when the finish comes back on and the renderer returns to the programs it built first, then each is handed its finish map", () => {
    const renderer = new THREE.WebGLRenderer({ canvas: element() });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const car = new DeformableCar(paint(), scene, null, "police");
    scene.add(car.group);
    const { paints, trims } = finishMaterialsUnder(car.group);
    for (const on of [true, false, true]) {
      applyCarFinish(car.group, on);
      renderer.compile(scene, camera);
    }
    const bound = [...paints, ...trims].map((material) => boundFinish(renderer, material));
    assert.ok(paints.length >= 2 && trims.length > 0, `the cop's body and door paints and its trim: ${paints.length} paints, ${trims.length} trims`);
    assert.ok(bound.every((b) => b.finishProgram), "every finish material is back on its finish program");
    const unbound = bound.filter((b) => b.finishMap === null).length;
    assert.equal(unbound, 0, `${unbound} of ${bound.length} finish materials handed no finish map`);
    car.dispose();
    renderer.dispose();
  });
});
