import { createCanvas, loadImage } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { MAT } from "../kernel/material-ids.ts";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import windowTable from "../world/openworld/facade-windows.json" with { type: "json" };
import { BAY_WIDTH, BLOCK_HEIGHT, buildingHeight, DEFAULT_STOREYS, DOOR_SURROUND, FACADE_ALPHA, MAX_STOREYS, MIN_STOREYS, ROWHOME_FLOOR_Y, SHOP_FLOOR_Y, SHOPFRONT } from "../world/openworld/interior-kinds.ts";
import { drawnHalf } from "../world/openworld/openworld-facade-solids.ts";
import type { InteriorKind } from "../world/openworld/walk-graph.ts";
import { PREFAB } from "../world/constants.ts";
import { FACADE_LAYERS, facadeSkin, LAYER, type FacadeStyle } from "./facades.ts";
import type { PrefabMaterials } from "./prefab-pieces.ts";
import { makePrefabMaterials, prefabParts, raceTextures } from "./prefabs.ts";

/** The styles whose doorways and windows are cut open, with the interior behind them, and the world height of the ground band (m): a home's ground storey and a shop's. A face's layer runs to the viewer's right, the building's local -z: the plan's `across` is measured the other way. */
const OPEN_STYLES: Record<string, { kind: InteriorKind; floorY: number; ground: number }> = {
  rowbrick: { kind: "rowhome", floorY: ROWHOME_FLOOR_Y, ground: 3.6 },
  rowpainted: { kind: "rowhome", floorY: ROWHOME_FLOOR_Y, ground: 3.6 },
  coffee: { kind: "coffee", floorY: SHOP_FLOOR_Y, ground: 4 },
  bar: { kind: "bar", floorY: SHOP_FLOOR_Y, ground: 4 },
  office: { kind: "office", floorY: SHOP_FLOOR_Y, ground: 4 },
  cornerstore: { kind: "store", floorY: SHOP_FLOOR_Y, ground: 4 },
};
const LAYER_TEXELS = 256;
/** What the shader takes a texel's alpha to be: a doorway under the first, a window under the second, else wall (halfway between the classes the packer writes). */
const DOORWAY_BELOW = (FACADE_ALPHA.doorway + FACADE_ALPHA.window) / 2;
const WINDOW_BELOW = (FACADE_ALPHA.window + FACADE_ALPHA.wall) / 2;
const classOf = (alpha: number): "doorway" | "window" | "wall" => (alpha < DOORWAY_BELOW ? "doorway" : alpha < WINDOW_BELOW ? "window" : "wall");

async function alphaOf(style: string): Promise<{ at: (layer: number, u: number, v: number) => "doorway" | "window" | "wall"; count: (layer: number, kind: "doorway" | "window" | "wall") => number }> {
  const image = await loadImage(new URL(`../../../public/facades/${style}-albedo.webp`, import.meta.url).pathname);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;
  const texel = (layer: number, x: number, y: number): number => data[((layer * LAYER_TEXELS + y) * LAYER_TEXELS + x) * 4 + 3]!;
  return {
    at: (layer, u, v) => classOf(texel(layer, Math.floor(u * LAYER_TEXELS), Math.floor((1 - v) * LAYER_TEXELS))),
    count: (layer, kind) => {
      let count = 0;
      for (let y = 0; y < LAYER_TEXELS; y++) for (let x = 0; x < LAYER_TEXELS; x++) if (classOf(texel(layer, x, y)) === kind) count++;
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

  // mutation: sed -i 's/const x0 = Math.round(((half - (opening.centre + opening.width \/ 2))/const x0 = Math.round(((half - (opening.centre + opening.width \/ 2) + 1)/' scripts/pack-facades.mjs, then repack the styles (the cut lands a metre off the door)
  it("when the packed albedo is read at each doorway of the plan, then it is a doorway at body height, wall at the bay's edge, and no doorway stands in the other layers", async () => {
    const half = drawnHalf(BAY_WIDTH);
    for (const [style, open] of Object.entries(OPEN_STYLES)) {
      const alpha = await alphaOf(style);
      for (const opening of SHOPFRONT[open.kind]) {
        const u = (half - opening.centre) / (2 * half);
        const v = (open.floorY + opening.top / 2) / open.ground;
        expect(alpha.at(LAYER.ground, u, v), `${style} alpha in the doorway at u ${u.toFixed(2)}`).toBe("doorway");
      }
      expect(alpha.at(LAYER.ground, 0.01, 0.5), `${style} alpha at the bay's edge`).toBe("wall");
      expect(alpha.count(LAYER.cornice, "doorway") + alpha.count(LAYER.floor, "doorway") + alpha.count(LAYER.cornice, "window"), `${style} openings where there are none`).toBe(0);
    }
  });

  // mutation: sed -i 's/      for (let y = Math.floor((1 - v1) \* LAYER); y < Math.ceil((1 - v0) \* LAYER); y++) for (let x = x0; x < x1; x++) strip\[layer \* LAYER \* LAYER + y \* LAYER + x\] = FACADE_ALPHA.window;//' scripts/pack-facades.mjs, then repack the styles (no window is marked)
  it("when the packed albedo is read in each window the picture's table lists, then it is a window the shader cuts once its room is built: on every layer, but for a door's transom and its glass, which stay wall or doorway", async () => {
    const half = drawnHalf(BAY_WIDTH);
    for (const [style, open] of Object.entries(OPEN_STYLES)) {
      const alpha = await alphaOf(style);
      const table = windowTable[style as keyof typeof windowTable].windows;
      const doors = SHOPFRONT[open.kind].map((opening) => ({ from: (half - opening.centre - opening.width / 2) / (2 * half), to: (half - opening.centre + opening.width / 2) / (2 * half), head: open.floorY + opening.top }));
      for (const [layer, rects] of [[LAYER.floor, table.floor], [LAYER.ground, table.ground]] as const) {
        for (const [u0, v0, u1, v1] of rects) {
          const transom = layer === LAYER.ground && doors.some((door) => u1 > door.from && u0 < door.to && v0 * open.ground < door.head + DOOR_SURROUND);
          const found = alpha.at(layer, (u0 + u1) / 2, (v0 + v1) / 2);
          if (transom) expect(["wall", "doorway"], `${style} layer ${layer} transom at u ${u0.toFixed(2)} is no window the shader cuts`).toContain(found);
          else expect(found, `${style} layer ${layer} window at u ${u0.toFixed(2)}`).toBe("window");
        }
      }
    }
  });
});

describe("given the ground band of each open style drawn on its building", () => {
  let materials: PrefabMaterials;
  beforeAll(() => {
    stubBrowser();
    materials = makePrefabMaterials(raceTextures());
  });

  // mutation: sed -i 's/export const GROUND_STOREY = 3.6;/export const GROUND_STOREY = 3.2;/' src/game/world/openworld/interior-kinds.ts
  it("when a building of each style at each storey count is stretched to its height on the map, then its ground band reaches the height the plan's doorway and ceiling are built for", () => {
    for (const [style, open] of Object.entries(OPEN_STYLES)) {
      for (const storeys of [MIN_STOREYS, DEFAULT_STOREYS, MAX_STOREYS]) {
        const height = buildingHeight(storeys, open.kind !== "rowhome");
        const [part] = prefabParts(PREFAB.building, materials, facadeSkin(style as FacadeStyle, storeys));
        const region = part!.geometry.getAttribute("surfaceRegion");
        const position = part!.geometry.getAttribute("position");
        const klass = part!.geometry.getAttribute("materialClass");
        let groundTop = -Infinity;
        for (let i = 0; i < region.count; i++) if (klass.getX(i) !== MAT.BUILDING_ROOF && region.getX(i) === LAYER.ground) groundTop = Math.max(groundTop, position.getY(i));
        expect((groundTop * height) / BLOCK_HEIGHT, `${style} x${storeys} ground band in world metres`).toBeCloseTo(open.ground, 1);
      }
    }
  });
});
