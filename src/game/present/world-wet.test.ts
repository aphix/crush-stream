import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { MATERIAL, MATERIAL_WET, tagMaterial, type MaterialClass } from "../vehicle/material-class.ts";
import { SURFACE_IDS } from "../world/catalog.ts";
import { surfaceClass } from "./track-mesh.ts";
import { WorldStage } from "./engine-world.ts";
import { GarageArt } from "./garage-art.ts";
import { ShowcaseArt } from "./showcase-art.ts";

/** The program build's input for `material`: three's physical template, patched by the material's compile hook. */
function compile(material: THREE.Material) {
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  Reflect.apply(material.onBeforeCompile, material, [shader]);
  return shader;
}

const tableOf = (fragment: string, name: string): number[] => {
  const match = new RegExp(`float ${name}\\[\\d+\\] = float\\[\\d+\\]\\(([^)]*)\\)`).exec(fragment);
  assert.ok(match, `the ${name} table`);
  return match[1]!.split(",").map(Number);
};

const constantOf = (fragment: string, name: string): number => {
  const match = new RegExp(`const float ${name} = ([\\d.]+);`).exec(fragment);
  assert.ok(match, `the ${name} constant`);
  return Number(match[1]);
};

/** `worldEnvShare`'s two thresholds, read off its own text. */
function glossLine(fragment: string): { from: number; to: number } {
  const match = /smoothstep\(([\d.]+), ([\d.]+), roughness\)/.exec(fragment);
  assert.ok(match, "the gloss line");
  return { from: Number(match[1]), to: Number(match[2]) };
}

const step = (from: number, to: number, x: number): number => {
  const t = Math.min(Math.max((x - from) / (to - from), 0), 1);
  return t * t * (3 - 2 * t);
};

/** The up component range the wet drop fades in over, read off the shader's own text. */
function upLine(fragment: string): { from: number; to: number } {
  const match = /smoothstep\(([\d.]+), ([\d.]+), dot\(normalize\(normal\)/.exec(fragment);
  assert.ok(match, "the up-facing line");
  return { from: Number(match[1]), to: Number(match[2]) };
}

/** What the shader's own text draws a `materialClass` surface of `roughness` with at wetness `wet` (0-1), its normal's up component `up`: the roughness it ends on and the share of the specular IBL it keeps. */
function effective(fragment: string, materialClass: MaterialClass, roughness: number, wet: number, up = 1): { roughness: number; share: number } {
  const facing = step(upLine(fragment).from, upLine(fragment).to, up);
  const wetK = wet * tableOf(fragment, "MATERIAL_WET")[materialClass]! * facing;
  const final = roughness + (Math.min(roughness, constantOf(fragment, "WET_ROUGHNESS")) - roughness) * wetK;
  const share = tableOf(fragment, "MATERIAL_ENV")[materialClass]!;
  const { from, to } = glossLine(fragment);
  const glossy = share + (1 - share) * (1 - step(from, to, final));
  return { roughness: final, share: glossy + (1 - glossy) * wetK };
}

/** Two evaluated surfaces draw the same: roughness and reflection share each equal. */
function assertSame(actual: { roughness: number; share: number }, expected: { roughness: number; share: number }, label: string): void {
  assert.equal(actual.roughness, expected.roughness, `${label}: roughness`);
  assert.equal(actual.share, expected.share, `${label}: share`);
}

/** A class's fragment program at a typical dry road roughness. */
const programOf = (materialClass: MaterialClass): string => compile(tagMaterial(new THREE.MeshStandardMaterial({ roughness: 0.9 }), materialClass)).fragmentShader;

const DRY_ROAD_ROUGHNESS = 0.9;
/** The dry roughness a class's share is tuned at: no lift from here up. */
const TUNED_FROM = 0.8;

describe("given a world material tagged with a class", () => {
  it("when it compiles, then it reads the one shared wet uniform", () => {
    const shader = compile(tagMaterial(new THREE.MeshStandardMaterial(), MATERIAL.ASPHALT));
    assert.equal(shader.uniforms.materialWet, MATERIAL_WET, "the shared uniform object");
  });

  it("when every surface a terrain paints is read wet, then the class its cell is drawn in wets, a lawn as soil on a paved terrain", () => {
    const fragment = programOf(MATERIAL.CONCRETE);
    for (let index = 0; index < SURFACE_IDS.length; index++) {
      const cell = surfaceClass(index);
      assert.ok(tableOf(fragment, "MATERIAL_WET")[cell]! > 0, `${SURFACE_IDS[index]} is drawn in class ${cell}`);
    }
  });

  it("when wet soil and a lawn are read, then they keep a fifth of the sun's specular and only the sky's reflection comes back with the wetness", () => {
    const fragment = programOf(MATERIAL.SOIL);
    assert.ok(tableOf(fragment, "MATERIAL_DIRECT")[MATERIAL.SOIL]! <= 0.25, "soil's direct share");
    assert.ok(effective(fragment, MATERIAL.SOIL, 1, 1).share > 0.8, "the sky's reflection is back");
  });

  it("when the classes that stay dry are read wet, then their roughness and reflection do not change", () => {
    for (const materialClass of [MATERIAL.RUBBER, MATERIAL.WOOD, MATERIAL.FOLIAGE, MATERIAL.INTERIOR]) {
      const fragment = programOf(materialClass);
      assertSame(effective(fragment, materialClass, DRY_ROAD_ROUGHNESS, 1), effective(fragment, materialClass, DRY_ROAD_ROUGHNESS, 0), `class ${materialClass}`);
    }
  });

  it("when a class is dry and rough, then it keeps exactly its tuned share", () => {
    for (const materialClass of Object.values(MATERIAL)) {
      const fragment = programOf(materialClass);
      assert.equal(effective(fragment, materialClass, TUNED_FROM, 0).share, tableOf(fragment, "MATERIAL_ENV")[materialClass], `class ${materialClass}`);
    }
  });

  it("when a cut class is glossy and dry, then it keeps more of the reflection than the same class rough", () => {
    const fragment = programOf(MATERIAL.PLASTIC);
    const rough = effective(fragment, MATERIAL.PLASTIC, DRY_ROAD_ROUGHNESS, 0).share;
    assert.ok(effective(fragment, MATERIAL.PLASTIC, 0.25, 0).share > rough + 0.3, `rough ${rough}`);
  });

  it("when the albedo darkening is read, then wet soil loses some and wet asphalt none", () => {
    const dark = tableOf(programOf(MATERIAL.SOIL), "MATERIAL_DARK");
    assert.ok(dark[MATERIAL.SOIL]! > 0.2, "soil");
    assert.equal(dark[MATERIAL.ASPHALT], 0, "asphalt");
  });

  const pavements = [
    { it: "asphalt", materialClass: MATERIAL.ASPHALT, expectedMinShare: 0.99 },
    { it: "concrete", materialClass: MATERIAL.CONCRETE, expectedMinShare: 0.8 },
    { it: "stone", materialClass: MATERIAL.STONE, expectedMinShare: 0.8 },
    { it: "soil", materialClass: MATERIAL.SOIL, expectedMinShare: 0.8 },
  ] as const;

  it("when a wall faces sideways, then Wet leaves it dry whatever its class", () => {
    for (const materialClass of [MATERIAL.ASPHALT, MATERIAL.CONCRETE, MATERIAL.STONE]) {
      const fragment = programOf(materialClass);
      assertSame(effective(fragment, materialClass, DRY_ROAD_ROUGHNESS, 1, 0), effective(fragment, materialClass, DRY_ROAD_ROUGHNESS, 0, 0), `class ${materialClass}`);
    }
  });

  for (const testCase of pavements) {
    it(`when ${testCase.it} goes from dry to wet, then its roughness drops and it keeps at least ${testCase.expectedMinShare} of the reflection`, () => {
      const fragment = programOf(testCase.materialClass);
      const dry = effective(fragment, testCase.materialClass, DRY_ROAD_ROUGHNESS, 0);
      const wet = effective(fragment, testCase.materialClass, DRY_ROAD_ROUGHNESS, 1);
      assert.ok(wet.roughness < dry.roughness - 0.2, `roughness ${dry.roughness} -> ${wet.roughness}`);
      assert.ok(wet.share >= testCase.expectedMinShare && wet.share > dry.share + 0.15, `share ${dry.share} -> ${wet.share}`);
    });
  }
});

/** A lit world material's effective dry and wet state, off the program its compile hook builds. */
function dryAndWet(material: THREE.MeshStandardMaterial) {
  const shader = compile(material);
  assert.equal(shader.uniforms.materialWet, MATERIAL_WET, "reads the shared wet object");
  const materialClass = material.userData.materialClass as MaterialClass;
  const wetShare = Number(shader.uniforms.materialWetShare?.value);
  return { dry: effective(shader.fragmentShader, materialClass, material.roughness, 0), wet: effective(shader.fragmentShader, materialClass, material.roughness, wetShare) };
}

function assertWetter(state: ReturnType<typeof dryAndWet>): void {
  const { dry, wet } = state;
  assert.ok(wet.roughness < dry.roughness - 0.3 && wet.share > dry.share, `roughness ${dry.roughness} -> ${wet.roughness}, share ${dry.share} -> ${wet.share}`);
}

describe("given the stage's ground and the showcase's floor", () => {
  it("when Wet is turned on and off, then the one wet uniform follows it and the ground reads wetter", () => {
    stubBrowser();
    const stage = new WorldStage(new THREE.Scene());
    stage.setWet(true);
    assert.equal(MATERIAL_WET.value, 1, "wet");
    assertWetter(dryAndWet(stage.ground.material as THREE.MeshStandardMaterial));
    stage.setWet(false);
    assert.equal(MATERIAL_WET.value, 0, "dry again");
  });

  it("when the showcase's floor is compiled, then it is a lit wet-prone surface that Wet changes as it does the ground", () => {
    stubBrowser();
    const floor = new ShowcaseArt().group.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.geometry instanceof THREE.CircleGeometry);
    assert.ok(floor, "the floor");
    assert.ok(floor.material instanceof THREE.MeshStandardMaterial, "a lit material");
    const state = dryAndWet(floor.material);
    assertWetter(state);
    assert.ok(state.wet.roughness > 0.5, `the floor stays too rough for the back light's hot spot: ${state.wet.roughness}`);
  });

  it("when the garage's floor is compiled, then it is interior and Wet leaves it as it was", () => {
    stubBrowser();
    const floor = new GarageArt().group.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.geometry instanceof THREE.PlaneGeometry && child.position.y === 0);
    assert.ok(floor?.material instanceof THREE.MeshStandardMaterial, "a lit floor");
    const { dry, wet } = dryAndWet(floor.material);
    assertSame(wet, dry, "garage floor");
  });
});
