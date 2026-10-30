import { describe, expect, it } from "vitest";
import { MAT, MATERIALS, SCRATCH_CUT, TAKES_SCRATCH } from "./material-ids.ts";

const FAMILY_COUNT = 14;
const ROLES: readonly string[] = [
  "none", "sheet-metal", "metal", "cast-metal", "chrome", "plastic", "soft", "rubber", "glass", "concrete", "stone", "asphalt", "cobble", "dirt", "gravel", "grass", "sand", "wood", "foliage", "water", "fabric", "leather", "skin", "hair", "paper", "paint", "foam", "ceramic", "liquid",
];

describe("given the material registry", () => {
  it("when the names are collected, then every name is unique", () => {
    const names = MATERIALS.map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("when the family of each legacy row is read, then each is its own index", () => {
    for (let id = 0; id < FAMILY_COUNT; id++) expect(MATERIALS[id][1], `row ${id} ${MATERIALS[id][0]}`).toBe(id);
  });

  it("when the family of every row is read, then it is one of the 14 shading families", () => {
    for (const [name, family] of MATERIALS) expect(Number.isInteger(family) && family >= 0 && family < FAMILY_COUNT, `${name} family ${family}`).toBeTruthy();
  });

  it("when the role of every row is read, then it is a known role", () => {
    for (const [name, , role] of MATERIALS) expect(ROLES.includes(role), `${name} role ${role}`).toBeTruthy();
  });

  it("when every row is looked up by name, then the lookup returns its index", () => {
    for (let id = 0; id < MATERIALS.length; id++) expect(MAT[MATERIALS[id][0]], MATERIALS[id][0]).toBe(id);
  });

  it("when the legacy names are looked up, then they keep their shipped ids", () => {
    const legacy = ["GENERIC", "PAINTED_METAL", "PLASTIC", "RUBBER", "CONCRETE", "ASPHALT", "SOIL", "WOOD", "FOLIAGE", "GLASS", "STONE", "LEATHER", "METAL", "INTERIOR"] as const;
    for (let id = 0; id < legacy.length; id++) expect(MAT[legacy[id]!]).toBe(id);
  });
});

/** Each striker's cut and whether the surface shows cut lines when struck, against the collision-repair note's verdict on it; the bumpers take strokes by the owner's ruling ("the name bumper is because it's the most common to bump, so yeah it should probably scratch too"), each in its finish's look. */
const SCRATCH_RULE = [
  { it: "painted steel cuts paint readily at an edge, and its panel shows the lines", material: "CAR_PAINT", cut: 1, takes: true },
  { it: "chrome cuts paint locally as hard metal, and by the owner's bumper ruling takes strokes, scuffed bright", material: "BUMPER_CHROME", cut: 1, takes: true },
  { it: "a painted plastic bumper cuts sometimes, at its edge, and by the owner's bumper ruling takes strokes as the body", material: "BUMPER_PAINTED", cut: 0.6, takes: true },
  { it: "satin accent trim cuts as painted trim, and by the owner's bumper ruling takes strokes", material: "BUMPER_SATIN", cut: 0.6, takes: true },
  { it: "black plastic usually cuts nothing with a broad face, yes at an edge, and by the owner's bumper ruling takes strokes, whitened grey", material: "BUMPER_BLACK", cut: 0.4, takes: true },
  { it: "a tyre transfers rubber and never cuts", material: "TYRE", cut: 0, takes: false },
  { it: "glass cuts nothing in v1", material: "GLASS", cut: undefined, takes: false },
] as const;

describe("given the paint-scratch rule over the material registry", () => {
  for (const testCase of SCRATCH_RULE) {
    it(`when ${testCase.material} slides along a painted panel or is slid along, then ${testCase.it}`, () => {
      expect(SCRATCH_CUT.get(MAT[testCase.material]), `${testCase.material} cut`).toBe(testCase.cut);
      expect(TAKES_SCRATCH.has(MAT[testCase.material]), `${testCase.material} takes scratches`).toBe(testCase.takes);
    });
  }
});
