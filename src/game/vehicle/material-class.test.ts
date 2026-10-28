import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { makeGlassMaterial, makePaintMaterial, makeWheelGeometry, makeWheelMaterial, partsMaterial, trimMaterial } from "./car-materials.ts";
import { CANDY_FILM, CANDY_STRENGTH, CANDY_TIER } from "./car-candy.ts";
import { MATERIAL, MATERIAL_ATTRIBUTE, MATERIAL_GRAIN, MATERIAL_STRENGTH, tagLike, tagMaterial } from "./material-class.ts";
import { PART_KIND, partGeometry } from "./part-geometry.ts";

/** The program build's input for `material`: three's physical template, includes unresolved, patched by the material's compile hook. */
function compile(material: THREE.Material) {
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  Reflect.apply(material.onBeforeCompile, material, [shader]);
  return shader;
}

const countOf = (text: string, needle: string): number => text.split(needle).length - 1;

const CAR_ENV_LINE = "float carEnvShare = mix(mix(1.0, ";

const CAR_MATERIALS = {
  paint: () => makePaintMaterial(0xcc2222),
  trim: () => trimMaterial(0x202020, "plastic"),
  parts: () => partsMaterial(),
  wheel: () => makeWheelMaterial(),
  glass: () => makeGlassMaterial(),
};

const hookCases = [
  { it: "when the paint compiles, then its reflection is scaled by its roughness and metalness once and its creases are shaded", material: "paint", expectedEnvLines: 1 },
  { it: "when the black plastic trim compiles, then its reflection is scaled once and its creases are left alone", material: "trim", expectedEnvLines: 1 },
  { it: "when the shared parts material compiles, then its reflection is scaled once and its creases are left alone", material: "parts", expectedEnvLines: 1 },
  { it: "when the wheel material compiles, then its reflection is scaled once and its creases are left alone", material: "wheel", expectedEnvLines: 1 },
  { it: "when the glass compiles, then it keeps the studio's full reflection", material: "glass", expectedEnvLines: 0 },
] as const;

describe("given the car's materials", () => {
  for (const testCase of hookCases) {
    it(testCase.it, () => {
      const fragment = compile(CAR_MATERIALS[testCase.material]()).fragmentShader;
      assert.equal(countOf(fragment, CAR_ENV_LINE), testCase.expectedEnvLines, "environment scale lines");
    });
  }
});

/** The share of the studio reflection the car hook keeps at (roughness, metalness), read from the thresholds its own shader text carries. */
function carEnvShare(fragment: string, roughness: number, metalness: number): number {
  const match = /mix\(mix\(1\.0, (?<floor>[\d.]+), smoothstep\((?<roughFrom>[\d.]+), (?<roughTo>[\d.]+), roughnessFactor\)\), 1\.0, smoothstep\((?<metalFrom>[\d.]+), (?<metalTo>[\d.]+), metalnessFactor\)\)/.exec(fragment);
  assert.ok(match, "the car environment line");
  const group = (name: string): number => Number(match.groups?.[name]);
  const [floor, roughFrom, roughTo, metalFrom, metalTo] = [group("floor"), group("roughFrom"), group("roughTo"), group("metalFrom"), group("metalTo")];
  const step = (from: number, to: number, x: number) => {
    const t = Math.min(Math.max((x - from) / (to - from), 0), 1);
    return t * t * (3 - 2 * t);
  };
  const dielectric = 1 + (floor - 1) * step(roughFrom, roughTo, roughness);
  return dielectric + (1 - dielectric) * step(metalFrom, metalTo, metalness);
}

/** A part geometry vertex's tone: the (roughness, metalness) its uv names in the 0.01-step tone grid. */
function toneAt(geometry: THREE.BufferGeometry, vertex: number): { roughness: number; metalness: number } {
  const uv = geometry.getAttribute("uv");
  const texels = 101;
  return { roughness: Math.round(uv.getX(vertex) * texels - 0.5) / 100, metalness: Math.round(uv.getY(vertex) * texels - 0.5) / 100 };
}

function firstVertexWhere(geometry: THREE.BufferGeometry, attribute: string): number {
  const weights = geometry.getAttribute(attribute);
  for (let i = 0; i < weights.count; i++) if (weights.getX(i) > 0.99) return i;
  throw new Error(`no vertex with ${attribute} at its crown`);
}

const PARTS_GEOMETRIES = {
  wipers: () => ({ geometry: partGeometry(PART_KIND.wipers), vertex: 0 }),
  grille: () => ({ geometry: partGeometry(PART_KIND.grille), vertex: 0 }),
  tyre: () => {
    const geometry = makeWheelGeometry();
    return { geometry, vertex: firstVertexWhere(geometry, "tyre") };
  },
};

const toneCases = [
  { it: "when the wiper blades' tone is read, then black plastic is not a metal and keeps most of the reflection", part: "wipers", expectedMaxMetalness: 0.1, expectedMinShare: 0.7, expectedMaxShare: 0.95 },
  { it: "when the grille's tone is read, then its plastic is not a metal and keeps most of the reflection", part: "grille", expectedMaxMetalness: 0.1, expectedMinShare: 0.7, expectedMaxShare: 0.95 },
  { it: "when the tyre rubber's tone is read, then it keeps a quarter of the reflection at most", part: "tyre", expectedMaxMetalness: 0.1, expectedMinShare: 0, expectedMaxShare: 0.3 },
] as const;

describe("given the shared parts material's reflection scale", () => {
  const fragment = compile(partsMaterial()).fragmentShader;
  for (const testCase of toneCases) {
    it(testCase.it, () => {
      const { geometry, vertex } = PARTS_GEOMETRIES[testCase.part]();
      const tone = toneAt(geometry, vertex);
      const share = carEnvShare(fragment, tone.roughness, tone.metalness);
      assert.ok(tone.metalness <= testCase.expectedMaxMetalness, `metalness ${tone.metalness}`);
      assert.ok(share >= testCase.expectedMinShare && share <= testCase.expectedMaxShare, `share ${share.toFixed(2)} at roughness ${tone.roughness}, metalness ${tone.metalness}`);
    });
  }

  it("when chrome and gloss paint tones are scaled, then they keep the whole reflection", () => {
    assert.equal(carEnvShare(fragment, 0.16, 0.95), 1, "chrome");
    assert.equal(carEnvShare(fragment, 0.23, 0.2), 1, "gloss paint");
  });
});

const CLASS_BOUNDS = [
  { it: "rubber", materialClass: "RUBBER", expectedMaxShare: 0.3 },
  { it: "soil", materialClass: "SOIL", expectedMaxShare: 0.3 },
  { it: "foliage", materialClass: "FOLIAGE", expectedMaxShare: 0.3 },
  { it: "concrete", materialClass: "CONCRETE", expectedMaxShare: 0.5 },
  { it: "wood", materialClass: "WOOD", expectedMaxShare: 0.4 },
] as const;

function envTable(fragment: string): number[] {
  const match = /float MATERIAL_ENV\[(\d+)\] = float\[\d+\]\(([^)]*)\)/.exec(fragment);
  assert.ok(match, "the class table");
  const table = match[2]!.split(",").map(Number);
  assert.equal(table.length, Number(match[1]), "table length");
  return table;
}

describe("given a world material tagged with a class", () => {
  const first = tagMaterial(new THREE.MeshStandardMaterial({ roughness: 0.9 }), MATERIAL.RUBBER);
  const second = tagMaterial(new THREE.MeshStandardMaterial({ roughness: 0.9 }), MATERIAL.CONCRETE);
  const shader = compile(first);

  it("when two materials of the same parameters carry different classes, then they share one program key and each names its own class", () => {
    assert.equal(first.customProgramCacheKey(), second.customProgramCacheKey(), "program key");
    assert.ok(first.customProgramCacheKey().endsWith("|surf"), "key suffix");
    assert.equal(shader.uniforms.materialId!.value, MATERIAL.RUBBER, "first class");
    assert.equal(compile(second).uniforms.materialId!.value, MATERIAL.CONCRETE, "second class");
  });

  it("when it compiles, then its grain follows the one shared switch and yields to a normal map", () => {
    assert.equal(shader.uniforms.materialGrain, MATERIAL_GRAIN, "shared uniform object");
    assert.ok(shader.vertexShader.includes(`attribute float ${MATERIAL_ATTRIBUTE};`), "per-vertex class");
    const guard = shader.fragmentShader.indexOf("#ifndef USE_NORMALMAP");
    const bump = shader.fragmentShader.indexOf("materialPerturbedNormal(normal");
    assert.ok(guard >= 0 && guard < bump, `normal map guard ${guard} before the bump ${bump}`);
  });

  it("when its clone is tagged like it, then the copy compiles the same class and the bare clone does not", () => {
    const bare = first.clone();
    const copy = tagLike(first.clone(), first);
    assert.equal("materialId" in compile(bare).uniforms, false, "bare clone");
    assert.equal(compile(copy).uniforms.materialId!.value, MATERIAL.RUBBER, "tagged copy");
  });

  const table = envTable(shader.fragmentShader);

  it("when its table is read, then it has one row per class", () => {
    assert.equal(table.length, Object.keys(MATERIAL).length, "rows");
  });

  for (const testCase of CLASS_BOUNDS) {
    it(`when the ${testCase.it} class is read from the table, then it keeps a share of the reflection no larger than ${testCase.expectedMaxShare}`, () => {
      assert.ok(table[MATERIAL[testCase.materialClass]]! <= testCase.expectedMaxShare, `share ${table[MATERIAL[testCase.materialClass]]}`);
    });
  }

  it("when the glass, metal and untagged rows are read, then they keep the whole reflection", () => {
    assert.equal(table[MATERIAL.GLASS], 1, "glass");
    assert.equal(table[MATERIAL.METAL], 1, "metal");
    assert.equal(table[MATERIAL.GENERIC], 1, "generic");
  });
});

const strengthCases = [
  { it: "the paint", material: "paint", expectedMaterial: true },
  { it: "the trim", material: "trim", expectedMaterial: true },
  { it: "the shared parts", material: "parts", expectedMaterial: true },
  { it: "the wheel", material: "wheel", expectedMaterial: true },
] as const;

describe("given the sliders' two shared strength uniforms", () => {
  for (const testCase of strengthCases) {
    it(`when ${testCase.it} compiles, then it reads the Material strength object, declared once`, () => {
      const shader = compile(CAR_MATERIALS[testCase.material]());
      assert.equal(shader.uniforms.materialStrength === MATERIAL_STRENGTH, testCase.expectedMaterial, "the material uniform object");
      assert.equal(countOf(shader.fragmentShader, "uniform float materialStrength;"), 1, "material declaration");
      assert.equal(countOf(shader.fragmentShader, "reflectedLight.indirectSpecular *= materialSpecular(carEnvShare);"), 1, "the scaled env line");
    });
  }

  it("when a world material compiles, then its reflection share and its grain both go through the shared Material strength", () => {
    const shader = compile(tagMaterial(new THREE.MeshStandardMaterial(), MATERIAL.CONCRETE));
    assert.equal(shader.uniforms.materialStrength, MATERIAL_STRENGTH, "the shared uniform object");
    assert.equal(countOf(shader.fragmentShader, "uniform float materialStrength;"), 1, "declaration");
    assert.ok(shader.fragmentShader.includes("*= materialSpecular(MATERIAL_ENV[materialClass]);"), "the scaled env line");
    assert.ok(shader.fragmentShader.includes("MATERIAL_SLOPE[materialClass] * materialStrength"), "the scaled grain");
  });

});

describe("given the candy paint on the car's exterior paint", () => {
  const paint = compile(makePaintMaterial(0xcc2222));

  it("when the paint compiles, then it reads the three shared candy uniform objects and declares them once", () => {
    assert.equal(paint.uniforms.candyStrength, CANDY_STRENGTH, "slider");
    assert.equal(paint.uniforms.candyTier, CANDY_TIER, "tier share");
    assert.equal(paint.uniforms.candyFilm, CANDY_FILM, "film switch");
    for (const name of ["candyStrength", "candyTier", "candyFilm"]) assert.equal(countOf(paint.fragmentShader, `uniform float ${name};`), 1, name);
  });

  it("when the paint compiles, then candy deepens colour, sharpens the coat, shifts the film once each and leaves bare steel and black trim out of its share", () => {
    const { fragmentShader } = paint;
    assert.equal(countOf(fragmentShader, "float candyW = candyAmount * (1.0 - bareW) * (1.0 - glossW) * (1.0 - cabinW) * (1.0 - wellW);"), 1, "paint-only share");
    assert.equal(countOf(fragmentShader, "material.clearcoat = mix(material.clearcoat, 1.0, min(candyW, 1.0));"), 1, "full coat");
    assert.equal(countOf(fragmentShader, "if (candyFilm > 0.0)"), 1, "film branch");
    assert.equal(countOf(fragmentShader, "clearcoatSpecularIndirect *= filmTint;"), 1, "film tint");
  });

  it("when the trim, parts, wheel and glass compile, then none carries candy", () => {
    for (const name of ["trim", "parts", "wheel", "glass"] as const) assert.equal(compile(CAR_MATERIALS[name]()).fragmentShader.includes("candyW"), false, name);
  });
});
