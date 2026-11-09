import { createCanvas, loadImage } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { MAT } from "../kernel/material-ids.ts";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { BAY_WIDTH, ROWHOME_FLOOR_Y, SHOP_FLOOR_Y, SHOPFRONT } from "../world/openworld/interior-kinds.ts";
import { drawnHalf } from "../world/openworld/openworld-facade-solids.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import type { InteriorKind } from "../world/openworld/walk-graph.ts";
import { PREFAB } from "../world/constants.ts";
import { FACADE_LAYERS, LAYER, type FacadeStyle } from "./facades.ts";
import type { PrefabMaterials } from "./prefab-pieces.ts";
import { makePrefabMaterials, prefabParts, raceTextures } from "./prefabs.ts";

/** The styles whose ground band is cut open, with the interior behind them, and the world height of that band (m): a home's ground storey and a shop's. */
/** A face's layer runs to the viewer's right, the building's local -z: the plan's `across` is measured the other way. */
const OPEN_STYLES: Record<string, { kind: InteriorKind; floorY: number; ground: number }> = {
  rowbrick: { kind: "rowhome", floorY: ROWHOME_FLOOR_Y, ground: 3.6 },
  rowpainted: { kind: "rowhome", floorY: ROWHOME_FLOOR_Y, ground: 3.6 },
  coffee: { kind: "coffee", floorY: SHOP_FLOOR_Y, ground: 4 },
  bar: { kind: "bar", floorY: SHOP_FLOOR_Y, ground: 4 },
  office: { kind: "office", floorY: SHOP_FLOOR_Y, ground: 4 },
  cornerstore: { kind: "store", floorY: SHOP_FLOOR_Y, ground: 4 },
};
const LAYER_TEXELS = 256;
/** An opening's texels read by the shader are those with alpha under this (of 255). */
const CUT = 128;

async function alphaOf(style: string): Promise<{ at: (layer: number, u: number, v: number) => number; cut: (layer: number) => number }> {
  const image = await loadImage(new URL(`../../../public/facades/${style}-albedo.webp`, import.meta.url).pathname);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;
  const texel = (layer: number, x: number, y: number): number => data[((layer * LAYER_TEXELS + y) * LAYER_TEXELS + x) * 4 + 3]!;
  return {
    at: (layer, u, v) => texel(layer, Math.floor(u * LAYER_TEXELS), Math.floor((1 - v) * LAYER_TEXELS)),
    cut: (layer) => {
      let count = 0;
      for (let y = 0; y < LAYER_TEXELS; y++) for (let x = 0; x < LAYER_TEXELS; x++) if (texel(layer, x, y) < CUT) count++;
      return count;
    },
  };
}

describe("given the facade styles of the places that have interiors", () => {
  // mutation: sed -i '0,/"open": true/s//"open": false/' src/game/present/facade-layers.json
  it("when the layer data is read, then every style an interior stands behind is open in its ground band and no other new style is", () => {
    for (const style of Object.keys(OPEN_STYLES)) expect(FACADE_LAYERS[style as FacadeStyle].open, `${style} open`).toBe(true);
    expect(FACADE_LAYERS.supermarket.open, "the supermarket has no interior").toBeUndefined();
    expect(FACADE_LAYERS.rowhouse.open, "a style that was there before").toBeUndefined();
  });

  // mutation: sed -i 's/    if (!opening.door) continue;//' scripts/pack-facades.mjs, then repack the styles (the windows cut open too)
  it("when the packed albedo is read at each doorway and window of the plan, then a doorway is cut open at body height and a window is painted shut, the bay's edge is solid, and the other layers have no opening", async () => {
    const half = drawnHalf(BAY_WIDTH);
    for (const [style, open] of Object.entries(OPEN_STYLES)) {
      const alpha = await alphaOf(style);
      for (const opening of SHOPFRONT[open.kind]) {
        const u = (half - opening.centre) / (2 * half);
        const body = open.floorY + Math.max(opening.sill, 0) + Math.min(1, (opening.top - opening.sill) / 2);
        const at = alpha.at(LAYER.ground, u, body / open.ground);
        if (opening.door) expect(at, `${style} alpha in the doorway at u ${u.toFixed(2)}`).toBeLessThan(CUT);
        else expect(at, `${style} alpha in the window at u ${u.toFixed(2)}`).toBeGreaterThanOrEqual(CUT);
      }
      expect(alpha.at(LAYER.ground, 0.01, 0.5), `${style} alpha at the bay's edge`).toBeGreaterThanOrEqual(CUT);
      expect(alpha.cut(LAYER.cornice) + alpha.cut(LAYER.floor), `${style} openings above the ground band`).toBe(0);
    }
  });
});

describe("given the ground band of each open style drawn on its building", () => {
  let materials: PrefabMaterials;
  beforeAll(() => {
    stubBrowser();
    materials = makePrefabMaterials(raceTextures());
  });

  // mutation: node -e "const f='src/game/present/facade-layers.json';const j=JSON.parse(require('fs').readFileSync(f));j.rowbrick.metres.ground=4;require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\\n')"
  it("when a building of each style is stretched to its height on the map, then its ground band reaches the height the plan's doorway and ceiling are built for", () => {
    const buildings = layOutLots().buildings;
    for (const [style, open] of Object.entries(OPEN_STYLES)) {
      const height = buildings.find((building) => building.style === style)!.height;
      const [part] = prefabParts(PREFAB.building, materials, style as FacadeStyle);
      const region = part!.geometry.getAttribute("surfaceRegion");
      const position = part!.geometry.getAttribute("position");
      const klass = part!.geometry.getAttribute("materialClass");
      let groundTop = -Infinity;
      for (let i = 0; i < region.count; i++) if (klass.getX(i) !== MAT.BUILDING_ROOF && region.getX(i) === LAYER.ground) groundTop = Math.max(groundTop, position.getY(i));
      const BLOCK_HEIGHT = 14;
      expect((groundTop * height) / BLOCK_HEIGHT, `${style} ground band in world metres`).toBeCloseTo(open.ground, 1);
    }
  });
});
