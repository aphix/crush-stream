import { describe, expect, it } from "vitest";
import { MAT, MATERIALS } from "./material-ids.ts";

const FAMILY_COUNT = 14;
const ROLES: readonly string[] = [
  "none", "sheet-metal", "metal", "cast-metal", "chrome", "plastic", "soft", "rubber", "glass", "concrete", "stone", "asphalt", "cobble", "dirt", "gravel", "grass", "sand", "wood", "foliage", "water", "fabric", "leather", "skin", "hair", "paper", "paint", "foam", "ceramic", "liquid",
];

describe("material registry", () => {
  it("given the rows, when names are collected, then every name is unique", () => {
    const names = MATERIALS.map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("given the legacy rows, when their family is read, then each is its own index", () => {
    for (let id = 0; id < FAMILY_COUNT; id++) expect(MATERIALS[id][1], `row ${id} ${MATERIALS[id][0]}`).toBe(id);
  });

  it("given every row, when its family is read, then it is one of the 14 shading families", () => {
    for (const [name, family] of MATERIALS) expect(Number.isInteger(family) && family >= 0 && family < FAMILY_COUNT, `${name} family ${family}`).toBeTruthy();
  });

  it("given every row, when its role is read, then it is a known role", () => {
    for (const [name, , role] of MATERIALS) expect(ROLES.includes(role), `${name} role ${role}`).toBeTruthy();
  });

  it("given every row, when looked up by name, then MAT returns its index", () => {
    for (let id = 0; id < MATERIALS.length; id++) expect(MAT[MATERIALS[id][0]], MATERIALS[id][0]).toBe(id);
  });

  it("given the legacy names, when looked up, then they keep their shipped ids", () => {
    const legacy = ["GENERIC", "PAINTED_METAL", "PLASTIC", "RUBBER", "CONCRETE", "ASPHALT", "SOIL", "WOOD", "FOLIAGE", "GLASS", "STONE", "LEATHER", "METAL", "INTERIOR"] as const;
    for (let id = 0; id < legacy.length; id++) expect(MAT[legacy[id]!]).toBe(id);
  });
});
