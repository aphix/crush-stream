import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { must } from "../kernel/must.test-util.ts";
import { PREFAB } from "../world/constants.ts";
import type { Placed } from "../world/placements.ts";
import { ASSET_FAMILIES, FAMILY_BASE, SCENERY_ASSETS, type AssetFamily, type SceneryAsset } from "../world/scenery-assets/index.ts";
import { assetPrefab, assetScale } from "../world/scenery-assets/pick.ts";
import { plainMaterials } from "./prefab-materials.test-util.ts";
import { PropTumble } from "./prop-tumble.ts";
import { ASSET_FIT, ASSET_RECT, assetCell, makeAssetMaterials } from "./scenery-assets-art.ts";
import { ATLAS } from "./scenery-atlas/index.ts";

const plain = new THREE.MeshBasicMaterial();
const MATS = plainMaterials(plain);

function rowOf(asset: number): SceneryAsset {
  const row = SCENERY_ASSETS[asset];
  must(row, `asset ${asset} is in the registry`);
  return row;
}

const familyOfPlacement = (p: Placed): AssetFamily => {
  must(p.asset !== undefined, "an asset placement names its asset");
  return rowOf(p.asset).family;
};

function tumbleOf(placed: readonly Placed[]): THREE.InstancedMesh[] {
  const meshes: THREE.InstancedMesh[] = [];
  new PropTumble(placed, MATS, (mesh) => meshes.push(mesh), () => false, familyOfPlacement);
  return meshes;
}

/** The first asset of `family` drawn from the atlas (a tile has no rect of its own); -1 when the family has none. */
const firstSprite = (family: AssetFamily): number => SCENERY_ASSETS.findIndex((row) => row.family === family && row.kind !== "tile");

const spritePlacement = (asset: number, x: number): Placed => {
  const row = rowOf(asset);
  const [sx, sy, sz] = assetScale(row, 1);
  return { prefab: assetPrefab(row), x, y: 0, z: 0, yaw: 0, sx, sy, sz, asset };
};

describe("given the family materials of one atlas size", () => {
  it("when a family is read twice and another once, then the two reads of the first are one material and the other is a different one", () => {
    // mutation: sed -i 's/if (!material) own.push/own.push/' src/game/present/scenery-assets-art.ts
    const materials = makeAssetMaterials(false);
    const [first, second] = ASSET_FAMILIES;
    expect(materials[first] === materials[first], `${first} read twice`).toBe(true);
    expect(materials[first] === materials[second], `${first} against ${second}`).toBe(false);
  });
});

/** Draw cells are 512 m: columns this far apart stand in different ones. */
const COLUMN_SPACING = 1024;
const COLUMNS = 3;
const PER_COLUMN = 4;
/** Metres between the placements of one column: far inside one draw cell. */
const COLUMN_STEP = 3;

/** Two assets of different families that are drawn by the same generic prefab: grouped by prefab and cell alone, they would share meshes. */
function sharedKindPair(): readonly [number, number] {
  for (const [first, row] of SCENERY_ASSETS.entries()) {
    if (row.kind === "tile") continue;
    const second = SCENERY_ASSETS.findIndex((other) => other.family !== row.family && other.kind !== "tile" && assetPrefab(other) === assetPrefab(row));
    if (second >= 0) return [first, second];
  }
  throw new Error("no two families share a generic asset prefab");
}

describe("given the assets of two families drawn by one generic prefab, each in several draw cells", () => {
  it("when the placements are built, then there is one mesh per family and cell, each holding that family's placements of the cell", () => {
    // mutation: sed -i 's/${styleOf(pl) ?? ""}/${""}/' src/game/present/prop-tumble.ts
    const pair = sharedKindPair();
    const placed: Placed[] = [];
    for (const asset of pair) for (let column = 0; column < COLUMNS; column++) for (let k = 0; k < PER_COLUMN; k++) placed.push(spritePlacement(asset, column * COLUMN_SPACING + k * COLUMN_STEP));
    const meshes = tumbleOf(placed);
    expect(meshes.length, "meshes").toBe(pair.length * COLUMNS);
    for (const mesh of meshes) expect(mesh.count, "placements in a mesh").toBe(PER_COLUMN);
  });
});

describe("given placements of an asset in each family", () => {
  for (const family of ASSET_FAMILIES) {
    const asset = firstSprite(family);
    it(`when a ${family} sprite is built twice, then each instance reads the asset's atlas cell with v turned to run up the picture`, () => {
      // mutation: sed -i 's/1 - top - height/top/' src/game/present/scenery-assets-art.ts
      must(asset >= 0, `${family} has a sprite asset`);
      const [mesh] = tumbleOf([spritePlacement(asset, 0), spritePlacement(asset, COLUMN_STEP)]);
      must(mesh, "one mesh");
      const rect = mesh.geometry.getAttribute(ASSET_RECT);
      const [left, top, width, height] = assetCell(asset).rect;
      expect(rect.count, "rects").toBe(2);
      for (let slot = 0; slot < rect.count; slot++) {
        expect(rect.getX(slot), `left of ${slot}`).toBeCloseTo(left, 5);
        expect(rect.getY(slot), `bottom of ${slot}`).toBeCloseTo(1 - top - height, 5);
        expect(rect.getZ(slot), `width of ${slot}`).toBeCloseTo(width, 5);
        expect(rect.getW(slot), `height of ${slot}`).toBeCloseTo(height, 5);
      }
    });
  }
});

/** A solid sprite's drawn width (m) and the thickness (m) of its collider along the front. */
const DRAWN_WIDTH = 2;
const THICKNESS = 0.5;

describe("given a solid cross asset whose collider is a fraction of its drawn width", () => {
  const asset = SCENERY_ASSETS.findIndex((row) => row.kind === "cross" && row.body === "solid" && row.core < 1);
  const testCases = [
    // mutation: sed -i 's/p.prefab === PREFAB.assetStandee ||/false ||/' src/game/present/scenery-assets-art.ts
    { it: "when it stands as a standee, then its quad is drawn wider across the front by one over its core and not along it", prefab: PREFAB.assetStandee, drawnAlong: THICKNESS },
    // mutation: sed -i 's/p.prefab === PREFAB.assetCrossSolid ? (p.sz/false ? (p.sz/' src/game/present/scenery-assets-art.ts
    { it: "when it stands as a solid cross, then both its quads are drawn as wide as the sprite, whatever the collider's depth", prefab: PREFAB.assetCrossSolid, drawnAlong: DRAWN_WIDTH },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      must(asset >= 0, "the registry holds a solid cross with a core under 1");
      const { core } = rowOf(asset);
      const placed: Placed = { prefab: testCase.prefab, x: 0, y: 0, z: 0, yaw: 0, sx: THICKNESS, sy: 1, sz: DRAWN_WIDTH * core, asset };
      const [mesh] = tumbleOf([placed]);
      must(mesh, "one mesh");
      const fit = mesh.geometry.getAttribute(ASSET_FIT);
      expect(placed.sz * fit.getY(0), "drawn width across the front").toBeCloseTo(DRAWN_WIDTH, 5);
      expect(placed.sx * fit.getX(0), "drawn width along the front").toBeCloseTo(testCase.drawnAlong, 5);
    });
  }
});

/** Slack (share of the atlas) for the rects' six-decimal rounding. */
const RECT_SLACK = 1e-6;

type Rect = readonly [number, number, number, number];

function overlap(a: Rect, b: Rect): boolean {
  return a[0] < b[0] + b[2] - RECT_SLACK && b[0] < a[0] + a[2] - RECT_SLACK && a[1] < b[1] + b[3] - RECT_SLACK && b[1] < a[1] + a[3] - RECT_SLACK;
}

/** The rows of `family`, contiguous in the registry. */
const rowsOf = (family: AssetFamily): typeof SCENERY_ASSETS => SCENERY_ASSETS.filter((row) => row.family === family);

describe("given each family's atlas and its asset rows", () => {
  it("when the registry is listed, then it holds assets and each is in the family it names at its index", () => {
    expect(SCENERY_ASSETS.length, "assets").toBeGreaterThan(0);
    for (const family of ASSET_FAMILIES) {
      for (const [k, row] of rowsOf(family).entries()) expect(SCENERY_ASSETS[FAMILY_BASE[family] + k], `${family} row ${k}`).toBe(row);
    }
  });

  for (const family of ASSET_FAMILIES) {
    const atlas = ATLAS[family];
    const rows = rowsOf(family);

    it(`when the ${family} atlas is read, then its cells run parallel to the family's rows by id, a sprite's rect lies inside the atlas and a tile names a layer`, () => {
      // mutation: sed -i 's/rect: \[0.538086/rect: [1.538086/' src/game/present/scenery-atlas/greenery.ts
      expect(atlas.family, "the atlas's family").toBe(family);
      expect(atlas.cells.length, `${family} cells against rows`).toBe(rows.length);
      for (const [k, row] of rows.entries()) {
        const cell = atlas.cells[k];
        must(cell, `${family} row ${k} has a cell`);
        expect(cell.id, `${family} cell ${k}`).toBe(row.id);
        if (row.kind === "tile") {
          must(cell.layer !== undefined, `${row.id} names a tile layer`);
          expect(Number.isInteger(cell.layer) && cell.layer >= 0 && cell.layer < atlas.tiles, `${row.id} layer ${cell.layer} of ${atlas.tiles}`).toBe(true);
          continue;
        }
        const [left, top, width, height] = cell.rect;
        expect(left >= 0 && top >= 0 && width > 0 && height > 0, `${row.id} rect ${cell.rect.join(", ")}`).toBe(true);
        expect(left + width <= 1 + RECT_SLACK && top + height <= 1 + RECT_SLACK, `${row.id} rect ${cell.rect.join(", ")} leaves the atlas`).toBe(true);
      }
    });

    it(`when the ${family} sprites' rects are compared two by two, then none overlaps another`, () => {
      // mutation: sed -i 's/rect: \[0.132813, 0.515625/rect: [0.007813, 0.519531/' src/game/present/scenery-atlas/greenery.ts
      const sprites = atlas.cells.filter((_, k) => rows[k]?.kind !== "tile");
      for (const [a, first] of sprites.entries()) {
        for (const second of sprites.slice(a + 1)) expect(overlap(first.rect, second.rect), `${first.id} over ${second.id}`).toBe(false);
      }
    });
  }
});

const MB = 1024 * 1024;
/** A texel is four bytes; a mip chain adds a third. */
const TEXEL_BYTES = 4;
const MIP_CHAIN = 4 / 3;
/** The most GPU memory (MB) one family's textures hold at the full tier (atlas, half-size normal, tile layers): seven families stay within about 56 MB. */
const FULL_TIER_GPU_MB = 8;
/** The most (MB) a family holds at the half tiers and on phones. */
const HALF_TIER_GPU_MB = 1;
/** The most (MB) one family's files download at either tier. */
const TIER_FILE_MB = 1;

const SCENERY_FILES = new URL("../../../public/scenery/", import.meta.url);

type FamilyFiles = { full: string[]; half: string[] };

/** The files of `family`'s textures per tier (tile arrays only when it has tiles). */
function filesOf(family: AssetFamily): FamilyFiles {
  const tiled = ATLAS[family].tiles > 0;
  return {
    full: [`${family}-albedo.webp`, `${family}-normal.webp`, ...(tiled ? [`${family}-tiles-albedo.webp`, `${family}-tiles-normal.webp`] : [])],
    half: [`${family}-albedo-half.webp`, ...(tiled ? [`${family}-tiles-albedo-half.webp`] : [])],
  };
}

const bytesOf = (name: string): number => statSync(new URL(name, SCENERY_FILES)).size;

/** GPU texels of `family` at the full tier: the atlas, the half-size normal, the tile layers and their half-size normals. */
function fullTexels(family: AssetFamily): number {
  const { width, height, tiles, tileSize } = ATLAS[family];
  return width * height + (width / 2) * (height / 2) + tiles * (tileSize * tileSize + (tileSize / 2) * (tileSize / 2));
}

/** GPU texels at the half tiers: the half-size atlas and half-size tile layers, no normals. */
function halfTexels(family: AssetFamily): number {
  const { width, height, tiles, tileSize } = ATLAS[family];
  return (width / 2) * (height / 2) + tiles * (tileSize / 2) * (tileSize / 2);
}

const gpuMb = (texels: number): number => (texels * TEXEL_BYTES * MIP_CHAIN) / MB;

const families = ASSET_FAMILIES.filter((family) => ATLAS[family].cells.length > 0);

describe("given the textures each family's atlas names", () => {
  it("when the families are listed, then some have atlases and every file each names is under public/scenery", () => {
    // mutation: sed -i 's/tiles: 0/tiles: 2/' src/game/present/scenery-atlas/greenery.ts
    expect(families.length, "families with an atlas").toBeGreaterThan(0);
    for (const family of families) {
      const files = filesOf(family);
      for (const name of [...files.full, ...files.half]) {
        const file = new URL(name, SCENERY_FILES);
        expect(existsSync(file), file.pathname).toBe(true);
        expect(bytesOf(name), `${name} bytes`).toBeGreaterThan(0);
      }
    }
  });

  it("when each family's textures are totalled, then the full tier holds under its GPU cap and the half tier under its own, and both download under theirs", () => {
    // mutation: sed -i 's/width: 1024/width: 8192/' src/game/present/scenery-atlas/greenery.ts
    expect(families.length, "families with an atlas").toBeGreaterThan(0);
    for (const family of families) {
      const files = filesOf(family);
      expect(gpuMb(fullTexels(family)), `${family} full tier GPU MB`).toBeLessThanOrEqual(FULL_TIER_GPU_MB);
      expect(gpuMb(halfTexels(family)), `${family} half tier GPU MB`).toBeLessThan(HALF_TIER_GPU_MB);
      expect(files.full.reduce((sum, name) => sum + bytesOf(name), 0) / MB, `${family} full tier download MB`).toBeLessThanOrEqual(TIER_FILE_MB);
      expect(files.half.reduce((sum, name) => sum + bytesOf(name), 0) / MB, `${family} half tier download MB`).toBeLessThanOrEqual(TIER_FILE_MB);
    }
  });
});
