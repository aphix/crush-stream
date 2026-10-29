import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { GARAGE } from "../present/garage-art.ts";
import { must } from "../kernel/must.test-util.ts";

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
      expect(texture.image.width, "width").toBe(testCase.width);
      expect(texture.image.height, "height").toBe(testCase.height);
      expect(texture.format, "format").toBe(testCase.format);
      expect(texture.type, "type").toBe(THREE.UnsignedByteType);
      expect(data.length, "byte count").toBe(testCase.width * testCase.height * testCase.channels);
      expect(texture.wrapS, "wrapS").toBe(THREE.RepeatWrapping);
      expect(texture.wrapT, "wrapT").toBe(THREE.RepeatWrapping);
      expect(texture.generateMipmaps, "mipmaps").toBe(true);
      expect(texture.minFilter, "minFilter").toBe(THREE.LinearMipmapLinearFilter);
      expect(texture.anisotropy, "anisotropic").toBeGreaterThan(1);
      expect(texture.userData.shared, "shared, never disposed with a car").toBe(true);
    });
  }

  for (const testCase of textureCases) {
    it(`when the ${testCase.kind} map is built twice from scratch, then every byte is the same`, async () => {
      const fresh = await freshFinishModule();
      const first = finishTextureOf(finishModule, testCase.kind).image.data as Uint8Array;
      const second = finishTextureOf(fresh, testCase.kind).image.data as Uint8Array;
      expect(first, "two separate builds, not one cached array").not.toBe(second);
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
        expect(lowest, `channel ${channel} is flat at ${lowest}`).toBeLessThan(highest);
        expect(wrapStepX, `right edge to left edge steps ${wrapStepX}, interior steps at most ${interiorStepX}`).toBeLessThanOrEqual(interiorStepX);
        expect(wrapStepY, `bottom edge to top edge steps ${wrapStepY}, interior steps at most ${interiorStepY}`).toBeLessThanOrEqual(interiorStepY);
      });
    }
  }

  it("when the paint map is built, then its alpha channel is opaque in every texel", () => {
    const data = finishTextureOf(finishModule, "paint").image.data as Uint8Array;
    let lowestAlpha = 255;
    for (let i = 3; i < data.length; i += 4) lowestAlpha = Math.min(lowestAlpha, data[i]!);
    expect(lowestAlpha).toBe(255);
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
      expect(finishForTier(testCase.tier)).toBe(testCase.expectedOn);
    });
  }
});

const keyCases = [
  { it: "when the finish is on, then the paint program key names the paint finish (and the sedan's detail map) and the trim key the trim finish", enabled: true, paintKey: `${PAINT_KEY_TODAY}|finish-paint|detail`, trimKey: `${TRIM_KEY_TODAY}|finish-trim` },
  { it: "when the finish is switched off again, then every key is the one a car had before the finish existed", enabled: false, paintKey: PAINT_KEY_TODAY, trimKey: TRIM_KEY_TODAY },
] as const;

describe("given a built car", () => {
  for (const testCase of keyCases) {
    it(testCase.it, () => {
      const car = new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
      applyCarFinish(car.group, !testCase.enabled);
      applyCarFinish(car.group, testCase.enabled);
      const { paints, trims } = finishMaterialsUnder(car.group);
      expect(paints.length, "the car has finish-capable paint").toBeGreaterThan(0);
      expect(trims.length, "the car has finish-capable trim").toBeGreaterThan(0);
      for (const material of paints) expect(material.customProgramCacheKey(), "paint key").toBe(testCase.paintKey);
      for (const material of trims) expect(material.customProgramCacheKey(), "trim key").toBe(testCase.trimKey);
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
      expect(afterOn[i], `material ${i} rebuilt once on switching on`).toBe(before[i]! + 1);
      expect(afterOff[i], `material ${i} rebuilt once on switching off`).toBe(before[i]! + 2);
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
    expect(changed, "reports no change").toBe(false);
    assertSameNumbers(after, before, "material versions after a repeat");
    expect(applyCarFinish(car.group, false), "the real switch still reports its change").toBe(true);
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
      expect(material.customProgramCacheKey()).toBe(testCase.expectedKey);
    });
  }

  it("when the finish is on, then the compiled shader carries both the spray and the finish", () => {
    const material = makePaintMaterial(0x336699);
    applySpray(material, sprayUniforms(CAR_SPRAY, BARE_SPRAY, 1), "attribute vec3 sprayPos;\nattribute vec3 sprayNrm;", "vSprayP = sprayPos;\nvSprayN = sprayNrm;\nvSprayRow = 0.0;", "car");
    switchFinish(material, true);
    const { fragment } = compile(material);
    expect(fragment.includes("sprayTexel()"), "spray in the shader").toBeTruthy();
    expect(fragment.includes("finishPlaneWeights("), "finish in the shader").toBeTruthy();
  });
});

describe("given a fresh car material with the finish never switched on", () => {
  const todayCases = [
    { it: "when its program key is read, then a paint material has today's key", kind: "paint", color: 0x102030, expectedKey: PAINT_KEY_TODAY },
    { it: "when its program key is read, then a trim material has today's key", kind: "trim", color: 0x102031, expectedKey: TRIM_KEY_TODAY },
  ] as const;
  for (const testCase of todayCases) {
    it(testCase.it, () => {
      expect(materialOfKind(testCase.kind, testCase.color).customProgramCacheKey()).toBe(testCase.expectedKey);
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
      expect(uniforms.finishMap?.value instanceof THREE.DataTexture, "finish map texture").toBe(testCase.expectedBlock);
      expect(fragment.includes("finishPlaneWeights("), "triplanar weights in the fragment shader").toBe(testCase.expectedBlock);
      expect(vertex.includes("vFinishPos = position;"), "object-space position handed on by the vertex shader").toBe(testCase.expectedBlock);
      expect(vertex.includes("vFinishNormal = objectNormal;"), "object-space normal handed on by the vertex shader").toBe(testCase.expectedBlock);
      expect(fragment.includes("clearcoatNormal = finishPerturbedNormal("), "clear coat normal perturbed").toBe(testCase.expectedClearcoat);
      const declared = fragment.indexOf("vec3 clearcoatNormal = nonPerturbedNormal;");
      const perturbed = fragment.indexOf("clearcoatNormal = finishPerturbedNormal(");
      const lit = fragment.indexOf("material.diffuseColor = diffuseColor.rgb");
      if (testCase.expectedClearcoat) expect(declared >= 0 && declared < perturbed && perturbed < lit, `declaration ${declared}, perturbation ${perturbed}, lighting ${lit}`).toBeTruthy();
    });
  }

  for (const kind of ["paint", "trim"] as const) {
    it(`when a ${kind} material compiles with the finish on, then after the finish perturbs its normals and three adds its own geometry roughness, the perturbation's screen-space change widens the base${kind === "paint" ? " and clear coat" : ""} lobe before any light is summed: a peel or grain finer than a pixel blurs instead of sparkling`, () => {
      const material = materialOfKind(kind, kind === "paint" ? 0x203047 : 0x203048);
      switchFinish(material, true);
      const { fragment } = compile(material);
      const perturbed = fragment.indexOf("normal = finishPerturbedNormal(normal, ");
      const threeWidens = fragment.indexOf("material.roughness += geometryRoughness;");
      const widened = fragment.indexOf("material.roughness = min( sqrt( sqrt( pow2( specAaAlpha )");
      const coatWidened = fragment.indexOf("material.clearcoatRoughness = min( sqrt( sqrt( pow2( specAaAlpha )");
      const lit = fragment.indexOf("vec3 geometryPosition = - vViewPosition;");
      expect(fragment.includes("vec3 specAaDx = dFdx( normal - nonPerturbedNormal );"), `${kind}: the variance reads the perturbation alone (three already widens for the vertex normal's own change)`).toBeTruthy();
      expect(perturbed >= 0 && perturbed < threeWidens && threeWidens < widened && widened < lit, `${kind}: perturbation ${perturbed}, three's widening ${threeWidens}, the perturbation's ${widened}, lighting ${lit}`).toBeTruthy();
      expect(coatWidened > widened && coatWidened < lit, `${kind}: the clear coat's widening (${coatWidened}) follows the base's, before lighting`).toBeTruthy();
    });
  }

  it("when a paint material compiles with the finish on, then the base normal also gets the flake term the clear coat does not", () => {
    const material = materialOfKind("paint", 0x203043);
    switchFinish(material, true);
    const { fragment } = compile(material);
    expect(fragment.includes("normal = finishPerturbedNormal(normal, baseSlope"), "base layer: waviness, peel and flake").toBeTruthy();
    expect(fragment.includes("clearcoatNormal = finishPerturbedNormal(clearcoatNormal, coatSlope"), "clear coat: waviness and peel only").toBeTruthy();
  });

  it("when a paint material compiles with the finish on, then its orange peel keeps a quarter of its relief nearer than 2 m and all of it only past the garage's opening orbit: drawn 50 times real, nearer it reads as hammered metal; the trim's grain keeps all of its", () => {
    const nearShare = (kind: "paint" | "trim") => {
      const material = materialOfKind(kind, 0x203045);
      switchFinish(material, true);
      const lines = compile(material).fragment.split("\n").map((line) => line.trim());
      const ramp = lines.find((line) => line.startsWith("* mix(finishNearShare, vec3(1.0), smoothstep(")) ?? "";
      const [near, full] = (/smoothstep\(([\d.]+), ([\d.]+), finishDistance\)\)$/.exec(ramp) ?? []).slice(1).map(Number);
      expect(near === 2 && full! > GARAGE.shot.radius, `${kind}: the near share rises to full from ${near} to ${full} m, the garage opening at ${GARAGE.shot.radius} m (${ramp})`).toBeTruthy();
      return lines.find((line) => line.startsWith("const vec3 finishNearShare"));
    };
    expect(nearShare("paint"), "paint: waviness and flake in full, the peel a quarter up close").toBe("const vec3 finishNearShare = vec3(1.0, 0.25, 1.0);");
    expect(nearShare("trim"), "trim: its grain in full").toBe("const vec3 finishNearShare = vec3(1.0);");
  });

  it("when a paint material compiles with the finish on, then near-black paint drops its peel and flake (their sparse glints read as brown speckle) from a linear luma of 0.04 down to 0.004, after the tone and spray set its albedo; the trim keeps its grain", () => {
    const keepOf = (kind: "paint" | "trim") => {
      const material = materialOfKind(kind, 0x203046);
      switchFinish(material, true);
      const fragment = compile(material).fragment;
      const lines = fragment.split("\n").map((line) => line.trim());
      const gate = lines.indexOf("* finishKeep(diffuseColor.rgb);");
      expect(gate, `${kind}: the fade takes the albedo's keep`).toBeGreaterThan(lines.findIndex((line) => line.startsWith("vec3 finishFade =")));
      const albedoAt = fragment.indexOf("diffuseColor *= sampledDiffuseColor");
      expect(albedoAt >= 0 && fragment.indexOf("* finishKeep(diffuseColor.rgb);") > albedoAt, `${kind}: read after the map has set the albedo`).toBeTruthy();
      return lines[lines.indexOf("vec3 finishKeep(vec3 albedo) {") + 1];
    };
    expect(keepOf("paint"), "paint: peel and flake fade out on near-black").toBe("float keep = smoothstep(0.004, 0.04, dot(albedo, vec3(0.2126, 0.7152, 0.0722)));");
    expect(keepOf("trim"), "trim: its grain in full").toBe("return vec3(1.0);");
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
      expect(lines.filter((line) => line === "uniform mat4 modelViewMatrix;").length, "the mesh's view transform declared once").toBe(1);
      expect(lines.includes("return length(modelViewMatrix[3].xyz) - 4.0;"), "the nearest pixel of the draw: its origin's distance less the reach").toBeTruthy();
      expect(lines.includes("if (finishMeshNear() < max(finishFadeEnd.x, max(finishFadeEnd.y, finishFadeEnd.z))) {"), "the normal block skipped once every layer has faded").toBeTruthy();
      const fetchLines = lines.filter((line) => line.includes("finishTriplanar(p, w,") || (line.includes("texture2D(finishMap") && !line.startsWith("return")));
      expect(fetchLines.length, `fetch lines: ${fetchLines.join(" / ")}`).toBe(testCase.fetchLines);
      const gateAt = testCase.gates.map((gate) => lines.findIndex((line) => line.startsWith(gate)));
      expect(gateAt.every((at) => at >= 0), `gates found at lines ${gateAt.join(", ")}`).toBeTruthy();
      if (testCase.kind === "trim") expect(gateAt[0]!, "the trim gate comes before its fetch").toBeLessThan(lines.findIndex((line) => line.includes("texture2D(finishMap")));
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
    expect(typeof document).toBe("undefined");
    expect(material.map, "colour map").toBe(null);
    expect(material.roughnessMap, "roughness map").toBe(null);
  });

  it("when a sprayed paint compiles, then the colour tone lands where the map was, before the spray, and the roughness tone after the roughness chunk", () => {
    const material = makePaintMaterial(0x445566);
    applySpray(material, sprayUniforms(CAR_SPRAY, BARE_SPRAY, 1), "attribute vec3 sprayPos;\nattribute vec3 sprayNrm;", "vSprayP = sprayPos;\nvSprayN = sprayNrm;\nvSprayRow = 0.0;", "car");
    const { fragment } = compile(material);
    const tone = fragment.indexOf(PAINT_TONE_LINE);
    expect(tone, "the colour tone follows the map chunk").toBeGreaterThan(fragment.indexOf("diffuseColor *= sampledDiffuseColor"));
    expect(tone, "the colour tone comes before the spray (the spray is not toned)").toBeLessThan(fragment.indexOf("vec4 sprayS = sprayTexel();"));
    expect(fragment.indexOf(ROUGHNESS_TONE_LINE), "the roughness tone follows roughnessFactor").toBeGreaterThan(fragment.indexOf("float roughnessFactor = roughness;"));
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
  beforeAll(async () => {
    stubBrowser();
    engine = new CrashEngine(element(), new HudStore(), element());
    Object.assign(engine["renderer"], { render() {}, compile() {}, compileAsync: () => Promise.resolve() });
    await engine.ready;
  });
  afterAll(() => {
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
      expect(paintKeys.length > 0 && trimKeys.length > 0, "the cars carry finish-capable materials").toBeTruthy();
      for (const key of paintKeys) expect(key.includes(FINISH_KEY_MARK), `paint key ${key}`).toBe(testCase.expectedOn);
      for (const key of trimKeys) expect(key.includes(FINISH_KEY_MARK), `trim key ${key}`).toBe(testCase.expectedOn);
    });
  }

  it("when a car that never wore a look wears its first one on the high tier and is dressed, then its new lid and door paints carry the finish too", () => {
    engine.setFxTier("high");
    const car = engine["buildCar"](engine["cars"].length);
    wearCarLook(car, { ...NO_CAR_PICK, body: 0x2244cc, bumpers: 0xcc4422 }, null);
    const unfinished = finishMaterialsUnder(car.group).paints.filter((material) => !material.customProgramCacheKey().includes(FINISH_KEY_MARK));
    expect(unfinished.length, "the look's new paints start without the finish").toBeGreaterThan(0);
    engine["dressCar"](car);
    const { paints, trims } = finishMaterialsUnder(car.group);
    for (const material of [...paints, ...trims]) expect(material.customProgramCacheKey().includes(FINISH_KEY_MARK), `key ${material.customProgramCacheKey()}`).toBeTruthy();
    engine["scene"].remove(car.group);
    car.dispose();
  });

  it("when a car dressed on the low tier still has its finish switched on, then dressing it switches the finish off", () => {
    engine.setFxTier("low");
    const car = engine["live"]()[1]!;
    applyCarFinish(car.group, true);
    engine["dressCar"](car);
    const { paints, trims } = finishMaterialsUnder(car.group);
    for (const material of [...paints, ...trims]) expect(material.customProgramCacheKey().includes(FINISH_KEY_MARK), `key ${material.customProgramCacheKey()}`).toBe(false);
  });
});

/** What the renderer binds for `material` now (`WebGLRenderer.properties`): whether its current program draws the finish, and the finish map in the uniforms it uploads to that program (null: none). */
function boundFinish(renderer: THREE.WebGLRenderer, material: THREE.Material): { finishProgram: boolean; finishMap: THREE.Texture | null } {
  const built = renderer.properties.get(material);
  must(typeof built === "object" && built !== null && "currentProgram" in built && "uniforms" in built, "the renderer has built the material");
  const { currentProgram: program, uniforms } = built;
  must(typeof program === "object" && program !== null && "cacheKey" in program && typeof program.cacheKey === "string", "a current program");
  must(typeof uniforms === "object" && uniforms !== null, "uniforms for it");
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
    expect(paints.length >= 2 && trims.length > 0, `the cop's body and door paints and its trim: ${paints.length} paints, ${trims.length} trims`).toBeTruthy();
    expect(bound.every((b) => b.finishProgram), "every finish material is back on its finish program").toBeTruthy();
    const unbound = bound.filter((b) => b.finishMap === null).length;
    expect(unbound, `${unbound} of ${bound.length} finish materials handed no finish map`).toBe(0);
    car.dispose();
    renderer.dispose();
  });
});
