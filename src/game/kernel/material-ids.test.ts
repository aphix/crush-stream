import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { MAT, MATERIALS } from "./material-ids.ts";

const FAMILY_COUNT = 14;
const ROLES: readonly string[] = [
  "none", "sheet-metal", "metal", "cast-metal", "chrome", "plastic", "soft", "rubber", "glass", "concrete", "stone", "asphalt", "cobble", "dirt", "gravel", "grass", "sand", "wood", "foliage", "water", "fabric", "leather", "skin", "hair", "paper", "paint", "foam", "ceramic", "liquid",
];

describe("material registry", () => {
  it("given the rows, when names are collected, then every name is unique", () => {
    const names = MATERIALS.map(([name]) => name);
    assert.equal(new Set(names).size, names.length);
  });

  it("given the legacy rows, when their family is read, then each is its own index", () => {
    for (let id = 0; id < FAMILY_COUNT; id++) assert.equal(MATERIALS[id][1], id, `row ${id} ${MATERIALS[id][0]}`);
  });

  it("given every row, when its family is read, then it is one of the 14 shading families", () => {
    for (const [name, family] of MATERIALS) assert.ok(Number.isInteger(family) && family >= 0 && family < FAMILY_COUNT, `${name} family ${family}`);
  });

  it("given every row, when its role is read, then it is a known role", () => {
    for (const [name, , role] of MATERIALS) assert.ok(ROLES.includes(role), `${name} role ${role}`);
  });

  it("given every row, when looked up by name, then MAT returns its index", () => {
    for (let id = 0; id < MATERIALS.length; id++) assert.equal(MAT[MATERIALS[id][0]], id, MATERIALS[id][0]);
  });

  it("given the legacy names, when looked up, then they keep their shipped ids", () => {
    const legacy = ["GENERIC", "PAINTED_METAL", "PLASTIC", "RUBBER", "CONCRETE", "ASPHALT", "SOIL", "WOOD", "FOLIAGE", "GLASS", "STONE", "LEATHER", "METAL", "INTERIOR"] as const;
    for (let id = 0; id < legacy.length; id++) assert.equal(MAT[legacy[id]!], id);
  });
});
