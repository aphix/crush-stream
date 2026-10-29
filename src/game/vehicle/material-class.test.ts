import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { makeGlassMaterial, makePaintMaterial, makeWheelGeometry, makeWheelMaterial, partsMaterial, trimMaterial } from "./car-materials.ts";
import { CANDY_FILM, CANDY_STRENGTH, CANDY_TIER } from "./car-candy.ts";
import { MATERIAL_ATTRIBUTE, MATERIAL_DETAIL, MATERIAL_DETAIL_READY, MATERIAL_GRAIN, MATERIAL_STRENGTH, tagLike, tagMaterial } from "./material-class.ts";
import { MAT } from "../kernel/material-ids.ts";
import { PART_KIND, partGeometry } from "./part-geometry.ts";
import { must } from "../kernel/must.test-util.ts";

/** The program build's input for `material`: three's physical template, includes unresolved, patched by the material's compile hook. */
function compile(material: THREE.Material) {
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  Reflect.apply(material.onBeforeCompile, material, [shader]);
  return shader;
}

const countOf = (text: string, needle: string): number => text.split(needle).length - 1;

const FAMILY_COUNT = 14;

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
      expect(countOf(fragment, CAR_ENV_LINE), "environment scale lines").toBe(testCase.expectedEnvLines);
    });
  }
});

/** The share of the studio reflection the car hook keeps at (roughness, metalness), read from the thresholds its own shader text carries. */
function carEnvShare(fragment: string, roughness: number, metalness: number): number {
  const match = /mix\(mix\(1\.0, (?<floor>[\d.]+), smoothstep\((?<roughFrom>[\d.]+), (?<roughTo>[\d.]+), roughnessFactor\)\), 1\.0, smoothstep\((?<metalFrom>[\d.]+), (?<metalTo>[\d.]+), metalnessFactor\)\)/.exec(fragment);
  must(match, "the car environment line");
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
      expect(tone.metalness, `metalness ${tone.metalness}`).toBeLessThanOrEqual(testCase.expectedMaxMetalness);
      expect(share >= testCase.expectedMinShare && share <= testCase.expectedMaxShare, `share ${share.toFixed(2)} at roughness ${tone.roughness}, metalness ${tone.metalness}`).toBeTruthy();
    });
  }

  it("when chrome and gloss paint tones are scaled, then they keep the whole reflection", () => {
    expect(carEnvShare(fragment, 0.16, 0.95), "chrome").toBe(1);
    expect(carEnvShare(fragment, 0.23, 0.2), "gloss paint").toBe(1);
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
  must(match, "the class table");
  const table = match[2]!.split(",").map(Number);
  expect(table.length, "table length").toBe(Number(match[1]));
  return table;
}

describe("given a world material tagged with a class", () => {
  const first = tagMaterial(new THREE.MeshStandardMaterial({ roughness: 0.9 }), MAT.RUBBER);
  const second = tagMaterial(new THREE.MeshStandardMaterial({ roughness: 0.9 }), MAT.CONCRETE);
  const shader = compile(first);

  it("when two materials of the same parameters carry different classes, then they share one program key and each names its own class", () => {
    expect(first.customProgramCacheKey(), "program key").toBe(second.customProgramCacheKey());
    expect(first.customProgramCacheKey().endsWith("|surf"), "key suffix").toBeTruthy();
    expect(shader.uniforms.materialId!.value, "first class").toBe(MAT.RUBBER);
    expect(compile(second).uniforms.materialId!.value, "second class").toBe(MAT.CONCRETE);
  });

  it("when it compiles, then its grain follows the one shared switch and yields to a normal map", () => {
    expect(shader.uniforms.materialGrain, "shared uniform object").toBe(MATERIAL_GRAIN);
    expect(shader.vertexShader.includes(`attribute float ${MATERIAL_ATTRIBUTE};`), "per-vertex class").toBeTruthy();
    const guard = shader.fragmentShader.indexOf("#ifndef USE_NORMALMAP");
    const bump = shader.fragmentShader.indexOf("materialPerturbedNormal(normal");
    expect(guard >= 0 && guard < bump, `normal map guard ${guard} before the bump ${bump}`).toBeTruthy();
  });

  it("when its clone is tagged like it, then the copy compiles the same class and the bare clone does not", () => {
    const bare = first.clone();
    const copy = tagLike(first.clone(), first);
    expect("materialId" in compile(bare).uniforms, "bare clone").toBe(false);
    expect(compile(copy).uniforms.materialId!.value, "tagged copy").toBe(MAT.RUBBER);
  });

  const table = envTable(shader.fragmentShader);

  it("when its table is read, then it has one row per class", () => {
    expect(table.length, "rows").toBe(FAMILY_COUNT);
  });

  for (const testCase of CLASS_BOUNDS) {
    it(`when the ${testCase.it} class is read from the table, then it keeps a share of the reflection no larger than ${testCase.expectedMaxShare}`, () => {
      expect(table[MAT[testCase.materialClass]]!, `share ${table[MAT[testCase.materialClass]]}`).toBeLessThanOrEqual(testCase.expectedMaxShare);
    });
  }

  it("when the glass, metal and untagged rows are read, then they keep the whole reflection", () => {
    expect(table[MAT.GLASS], "glass").toBe(1);
    expect(table[MAT.METAL], "metal").toBe(1);
    expect(table[MAT.GENERIC], "generic").toBe(1);
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
      expect(shader.uniforms.materialStrength === MATERIAL_STRENGTH, "the material uniform object").toBe(testCase.expectedMaterial);
      expect(countOf(shader.fragmentShader, "uniform float materialStrength;"), "material declaration").toBe(1);
      expect(countOf(shader.fragmentShader, "reflectedLight.indirectSpecular *= materialSpecular(carEnvShare);"), "the scaled env line").toBe(1);
    });
  }

  it("when a world material compiles, then its reflection share and its grain both go through the shared Material strength", () => {
    const shader = compile(tagMaterial(new THREE.MeshStandardMaterial(), MAT.CONCRETE));
    expect(shader.uniforms.materialStrength, "the shared uniform object").toBe(MATERIAL_STRENGTH);
    expect(countOf(shader.fragmentShader, "uniform float materialStrength;"), "declaration").toBe(1);
    expect(shader.fragmentShader.includes("*= materialSpecular(worldEnvShare(MATERIAL_ENV[materialClass], roughnessFactor, materialWetK));"), "the scaled env line").toBeTruthy();
    expect(shader.fragmentShader.includes("MATERIAL_SLOPE[materialClass] * materialStrength"), "the scaled grain").toBeTruthy();
  });
});

describe("given the candy paint on the car's exterior paint", () => {
  const paint = compile(makePaintMaterial(0xcc2222));

  it("when the paint compiles, then it reads the three shared candy uniform objects and declares them once", () => {
    expect(paint.uniforms.candyStrength, "slider").toBe(CANDY_STRENGTH);
    expect(paint.uniforms.candyTier, "tier share").toBe(CANDY_TIER);
    expect(paint.uniforms.candyFilm, "film switch").toBe(CANDY_FILM);
    for (const name of ["candyStrength", "candyTier", "candyFilm"]) expect(countOf(paint.fragmentShader, `uniform float ${name};`), name).toBe(1);
  });

  it("when the paint compiles, then candy deepens colour, sharpens the coat, shifts the film once each and leaves bare steel and black trim out of its share", () => {
    const { fragmentShader } = paint;
    expect(countOf(fragmentShader, "float candyW = candyAmount * (1.0 - bareW) * (1.0 - glossW) * (1.0 - cabinW) * (1.0 - wellW);"), "paint-only share").toBe(1);
    expect(countOf(fragmentShader, "material.clearcoat = mix(material.clearcoat, 1.0, min(candyW, 1.0));"), "full coat").toBe(1);
    expect(countOf(fragmentShader, "if (candyFilm > 0.0)"), "film branch").toBe(1);
    expect(countOf(fragmentShader, "clearcoatSpecularIndirect *= filmTint;"), "film tint").toBe(1);
  });

  it("when the trim, parts, wheel and glass compile, then none carries candy", () => {
    for (const name of ["trim", "parts", "wheel", "glass"] as const) expect(compile(CAR_MATERIALS[name]()).fragmentShader.includes("candyW"), name).toBe(false);
  });
});

function glslTable(fragment: string, name: string): number[] {
  const match = new RegExp(`const float ${name}\\[\\d+\\] = float\\[\\d+\\]\\(([^)]*)\\)`).exec(fragment);
  must(match, `${name} table`);
  return match[1]!.split(",").map(Number);
}

const detailCases = [
  { it: "concrete", materialClass: "CONCRETE", expectedOn: 1 },
  { it: "stone", materialClass: "STONE", expectedOn: 1 },
  { it: "asphalt", materialClass: "ASPHALT", expectedOn: 1 },
  { it: "rubber", materialClass: "RUBBER", expectedOn: 0 },
  { it: "wood", materialClass: "WOOD", expectedOn: 0 },
  { it: "soil", materialClass: "SOIL", expectedOn: 0 },
  { it: "foliage", materialClass: "FOLIAGE", expectedOn: 0 },
  { it: "glass", materialClass: "GLASS", expectedOn: 0 },
  { it: "generic", materialClass: "GENERIC", expectedOn: 0 },
] as const;

describe("given the worn-concrete detail map shared by the concrete family", () => {
  const shader = compile(tagMaterial(new THREE.MeshStandardMaterial(), MAT.CONCRETE));

  it("when a world material compiles, then it reads the one shared map and switch objects, each declared once, and fetches the map once behind the switch", () => {
    expect(shader.uniforms.materialDetailMap, "shared map object").toBe(MATERIAL_DETAIL);
    expect(shader.uniforms.materialDetailReady, "shared switch object").toBe(MATERIAL_DETAIL_READY);
    expect(countOf(shader.fragmentShader, "uniform sampler2D materialDetailMap;"), "map declaration").toBe(1);
    expect(countOf(shader.fragmentShader, "uniform float materialDetailReady;"), "switch declaration").toBe(1);
    expect(countOf(shader.fragmentShader, "textureGrad(materialDetailMap"), "one fetch").toBe(1);
    expect(shader.fragmentShader.includes("if (materialDetailOn > 0.0) materialDetail = textureGrad"), "behind the switch and the class's own flag").toBeTruthy();
    expect(shader.fragmentShader.includes("float materialDetailOn = materialDetailReady * MATERIAL_DETAIL_ON[materialClass];"), "the switch gates every use").toBeTruthy();
  });

  it("when no finish tier has loaded the map, then the switch is off and the map is the image-less stand-in", () => {
    expect(MATERIAL_DETAIL_READY.value, "switch").toBe(0);
    expect(MATERIAL_DETAIL.value.image, "no picture").toBe(null);
  });

  it("when the detail is read, then the normal, tone and roughness use the map's channels the packer writes them to", () => {
    expect(shader.fragmentShader.includes("materialDetail.rg * 2.0 - 1.0"), "normal in red and green").toBeTruthy();
    expect(shader.fragmentShader.includes("materialDetail.b * 2.0"), "lightness in blue").toBeTruthy();
    expect(shader.fragmentShader.includes("(0.5 - materialDetail.b)"), "roughness opposite the lightness").toBeTruthy();
  });

  for (const testCase of detailCases) {
    it(`when the ${testCase.it} class is read from the detail table, then it takes the map: ${testCase.expectedOn === 1}`, () => {
      expect(glslTable(shader.fragmentShader, "MATERIAL_DETAIL_ON")[MAT[testCase.materialClass]], "flag").toBe(testCase.expectedOn);
    });
  }

  it("when the asphalt row is read, then it takes the map darker than the concrete and never smoother (a smoother road mirrors more sky at grazing angles and comes out brighter)", () => {
    const tint = glslTable(shader.fragmentShader, "MATERIAL_TINT");
    const smooth = glslTable(shader.fragmentShader, "MATERIAL_SMOOTH");
    expect(tint[MAT.ASPHALT]!, "darker").toBeLessThan(tint[MAT.CONCRETE]!);
    expect(smooth[MAT.ASPHALT]!, "no smoothing").toBeGreaterThanOrEqual(1);
  });

  it("when a material has a normal map of its own, then the class's darkening is cut to a small share, and a plain one takes all of it", () => {
    const mapped = compile(tagMaterial(new THREE.MeshStandardMaterial(), MAT.ASPHALT)).fragmentShader;
    const guard = mapped.indexOf("#ifdef USE_NORMALMAP\nfloat materialTintBlend = materialBlend * ");
    const plain = mapped.indexOf("#else\nfloat materialTintBlend = materialBlend;");
    expect(guard >= 0 && guard < plain, `scaled under the normal map ${guard}, whole otherwise ${plain}`).toBeTruthy();
    const share = Number(/materialTintBlend = materialBlend \* ([\d.]+);/.exec(mapped)?.[1]);
    expect(share > 0 && share < 0.5, `share ${share}`).toBeTruthy();
  });

  it("when the stone row is read, then it takes a weaker normal than the concrete", () => {
    const normal = glslTable(shader.fragmentShader, "MATERIAL_NORMAL");
    expect(normal[MAT.STONE]!, "weaker").toBeLessThan(normal[MAT.CONCRETE]!);
  });
});

const softGround = [
  { it: "soil", materialClass: "SOIL" },
  { it: "foliage", materialClass: "FOLIAGE" },
] as const;
const hardSurfaces = ["ASPHALT", "CONCRETE", "STONE", "GLASS", "METAL", "PAINTED_METAL", "GENERIC"] as const;

describe("given the share of a light's specular each class keeps", () => {
  const fragment = compile(tagMaterial(new THREE.MeshStandardMaterial(), MAT.SOIL)).fragmentShader;
  const direct = glslTable(fragment, "MATERIAL_DIRECT");
  const relief = glslTable(fragment, "MATERIAL_RELIEF");

  for (const testCase of softGround) {
    it(`when the ${testCase.it} class is read, then a low sun keeps at most a quarter of its specular there, so a lawn does not shine like wet ground`, () => {
      expect(direct[MAT[testCase.materialClass]]!, `share ${direct[MAT[testCase.materialClass]]}`).toBeLessThanOrEqual(0.25);
      expect(relief[MAT[testCase.materialClass]]!, "a photograph's relief is cut where the class is not the material's own").toBeLessThan(1);
    });
  }

  it("when the roads, walls, glass, metal and paint are read, then their lights' specular and photographs' relief are whole", () => {
    for (const name of hardSurfaces) {
      expect(direct[MAT[name]], `${name} specular`).toBe(1);
      expect(relief[MAT[name]], `${name} relief`).toBe(1);
    }
  });

  it("when its tables are read, then each has one row per class", () => {
    expect(direct.length, "direct rows").toBe(FAMILY_COUNT);
    expect(relief.length, "relief rows").toBe(FAMILY_COUNT);
  });
});
