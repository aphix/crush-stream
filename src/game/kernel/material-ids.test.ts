import { describe, expect, it } from "vitest";
import { MAT, MATERIALS } from "./material-ids.ts";

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
