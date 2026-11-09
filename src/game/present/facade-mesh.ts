import * as THREE from "three";
import { MAT, type MaterialId } from "../kernel/material-ids.ts";
import { FACADE_LAYERS, type FacadeStyle, LAYER, ROOF_LAYER, ROOF_TILE_M, ROOFLINE } from "./facades.ts";
import { box, type Piece, type SurfaceRegion } from "./prefab-pieces.ts";

/**
 * A city block cut into regions, each reading its own layer of the style's layered textures (`facades.ts`) with its uv in real metres (a tile's own
 * height and one bay's width), so a layer repeats by its true size at any block size: per face the ground band, the storeys (one quad, the layer repeating
 * up it), the cornice, and the corner stones; the street face (+x, which a row of blocks turns to the road) has the shopfront band, the other three walls
 * run their storeys to the ground and keep a share of the relief. The roof slab's top is read from the roof strips by the shader.
 */

/** Half a block's side (m): a block is 11.8 m square. */
export const HALF = 5.9;
/** The corner stones' width (m), and the height (m) one tile of their layer spans (its six courses). */
const QUOIN_W = 0.6;
const QUOIN_TILE_H = 1.8;
/** How far a wall reaches below the block's ground (m), so a slope under it shows wall, not a gap. */
const UNDER = 1.5;
/** The share of the normal map a side or back wall keeps: plainer than the street face. */
const SIDE_RELIEF = 0.5;
/** The roof slab: its top (m) and its sides' colour (a concrete parapet). */
const SLAB_TOP = 14;
const PARAPET = 0xd8d4cc;
/** The street face's index among the four faces a block is built from (turned a quarter each): +x. */
const STREET_FACE = 1;

/** A vertical band of a face: its height range (m), the layer it reads and the layer's v range over it. */
type Band = { y0: number; y1: number; layer: number; v0: number; v1: number; relief: number };

/** The bands of a face from the ground up: a strip below the ground, the shopfront (the street face), the storeys, the cornice. */
function bands(style: FacadeStyle, street: boolean): Band[] {
  const { cornice, floor, ground } = FACADE_LAYERS[style].metres;
  const relief = street ? 1 : SIDE_RELIEF;
  const bottom = street ? ground : 0;
  const top = ROOFLINE - cornice;
  const storeys = Math.max(1, Math.round((top - bottom) / floor));
  const out: Band[] = [{ y0: -UNDER, y1: 0, layer: street ? LAYER.ground : LAYER.floor, v0: 0, v1: 0, relief }];
  if (street) out.push({ y0: 0, y1: ground, layer: LAYER.ground, v0: 0, v1: 1, relief });
  out.push({ y0: bottom, y1: top, layer: LAYER.floor, v0: 0, v1: storeys, relief }, { y0: top, y1: ROOFLINE, layer: LAYER.cornice, v0: 0, v1: 1, relief });
  return out;
}

/** The street face's storeys as drawn (block metres): where the first starts, how tall each is and how many. */
export function streetStoreys(style: FacadeStyle): { start: number; height: number; storeys: number } {
  const floor = bands(style, true).find((band) => band.layer === LAYER.floor && band.v1 > 0)!;
  return { start: floor.y0, height: (floor.y1 - floor.y0) / floor.v1, storeys: floor.v1 };
}

/** A quad on the +z face from x0 to x1 and y0 to y1, its uv running u0 to u1 and v0 to v1 left to right and bottom to top. */
function quad(x0: number, x1: number, y0: number, y1: number, u: readonly [number, number], v: readonly [number, number]): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0).translate((x0 + x1) / 2, (y0 + y1) / 2, HALF);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u[0] + uv.getX(i) * (u[1] - u[0]), v[0] + uv.getY(i) * (v[1] - v[0]));
  return g;
}

/** One face of the block, its quads turned to face `index` (a quarter turn each); `wall` is its material id. A `slab` has the street face's shopfront band on every face. */
function face(style: FacadeStyle, wall: MaterialId, index: number, slab: boolean): Piece[] {
  const spec = FACADE_LAYERS[style];
  const street = slab || index === STREET_FACE;
  const stones = spec.layers > LAYER.quoin;
  const inner = stones ? 2 * HALF - 2 * QUOIN_W : 2 * HALF;
  const bays = Math.max(1, Math.round(inner / ((2 * HALF) / spec.bays)));
  const bay = inner / bays;
  const turn = (g: THREE.BufferGeometry): THREE.BufferGeometry => g.rotateY((index * Math.PI) / 2);
  const region = (layer: number, relief: number): SurfaceRegion => [layer, relief, slab ? 1 : 0];
  const out: Piece[] = [];
  for (const band of bands(style, street)) {
    const cornice = band.layer === LAYER.cornice;
    // The cornice runs the whole width (the stones stop under it); the rest between the stones.
    const x0 = cornice || !stones ? -HALF : -inner / 2;
    const x1 = cornice || !stones ? HALF : inner / 2;
    out.push([turn(quad(x0, x1, band.y0, band.y1, [(x0 + inner / 2) / bay, (x1 + inner / 2) / bay], [band.v0, band.v1])), 0xffffff, wall, region(band.layer, band.relief)]);
  }
  if (stones) {
    const top = ROOFLINE - FACADE_LAYERS[style].metres.cornice;
    const courses: [number, number] = [0, (top + UNDER) / QUOIN_TILE_H];
    out.push([turn(quad(-HALF, -HALF + QUOIN_W, -UNDER, top, [0, 1], courses)), 0xffffff, wall, region(LAYER.quoin, 1)]);
    out.push([turn(quad(HALF - QUOIN_W, HALF, -UNDER, top, [1, 0], courses)), 0xffffff, wall, region(LAYER.quoin, 1)]);
  }
  return out;
}

/** The roof slab: its sides read a bare patch of the style's wall, its top is in roof tiles (`ROOF_TILE_M`), for the shader to cover from the roof strips. */
function roofSlab(style: FacadeStyle, wall: MaterialId, slab: boolean): Piece[] {
  const [u, v] = FACADE_LAYERS[style].plain as readonly [number, number];
  const sides = box(12, 0.5, 12, 0, 13.75, 0);
  const uv = sides.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
  // A box's faces are +x, -x, +y, -y, +z, -z, six indices each: leave the +y face to the top piece.
  const indices = Array.from((sides.index as THREE.BufferAttribute).array);
  sides.setIndex([...indices.slice(0, 12), ...indices.slice(18)]);
  const top = new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2).translate(0, SLAB_TOP, 0);
  const position = top.getAttribute("position");
  const topUv = top.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < topUv.count; i++) topUv.setXY(i, position.getX(i) / ROOF_TILE_M, position.getZ(i) / ROOF_TILE_M);
  return [[sides, PARAPET, wall, [LAYER.floor, 1, 0]], [top, 0xffffff, MAT.BUILDING_ROOF, [ROOF_LAYER, 1, slab ? 1 : 0]]];
}

/** A city block in `style`: its four faces and its roof slab; `wall` is the faces' material id. A `slab` is a block drawn at a stretched instance scale: its uv is laid in the instance's own metres (`facades.ts`). */
export function buildingPieces(style: FacadeStyle, wall: MaterialId, slab = false): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < 4; i++) out.push(...face(style, wall, i, slab));
  out.push(...roofSlab(style, wall, slab));
  return out;
}
