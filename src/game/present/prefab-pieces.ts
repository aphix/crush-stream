/**
 * The pieces every prefab drawing builds from: coloured geometry (`Piece`) merged into one painted mesh, boxes, cylinders,
 * square frustums and pool stone, the Mall's marble shades, and the materials and parts the drawings hand to the track art.
 */
import * as THREE from "three";
import { detCos, detSin } from "../kernel/physics-core.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MATERIAL_ATTRIBUTE, SURFACE_REGION_ATTRIBUTE } from "../vehicle/material-class.ts";
import { MAT, type MaterialId } from "../kernel/material-ids.ts";
import type { FacadeSkin, FacadeStyle } from "./facades.ts";
import type { AssetFamily } from "../world/scenery-assets/types.ts";
import type { StreetTreeSkin } from "../world/openworld/openworld-greenery.ts";
import type { PARK_LAMP } from "../world/openworld/openworld-park.ts";

/** Materials the prefabs draw with (shared with the track art where it says so). */
export type PrefabMaterials = {
  /** Flat-shaded vertex colours (most props, gantry). */
  plain: THREE.Material;
  /** Flat-shaded vertex colours with the world-space tint, dust and foot shade (`nature-look.ts`): rocks, trees, palms, bushes. */
  nature: THREE.Material;
  /** The nature look smooth-shaded with leafy crowns (`LeafMaterial`): the street and park trees. */
  leaves: THREE.Material;
  /** Vertex colours × concrete texture (barrier blocks, walls). */
  concrete: THREE.Material;
  /** A sidewalk slab: the concrete's colour with the paving's normal map. */
  paving: THREE.Material;
  /** The building styles (`present/facades.ts`), each one shared material. */
  facades: Readonly<Record<FacadeStyle, THREE.Material>>;
  billboard: THREE.Material;
  /** Still water: vertex colours, near-mirror gloss (the pools). */
  water: THREE.Material;
  /** The scenery assets' families (`present/scenery-assets-art.ts`), each one shared material of sprites. */
  assets: Readonly<Record<AssetFamily, THREE.Material>>;
};

/** What a prefab is dressed in: a building's facade style, a scenery asset's family, a street tree's kind or a park's lamp (one draw per prefab, skin and draw cell); none for a prefab with one look. */
export type Skin = FacadeSkin | AssetFamily | StreetTreeSkin | typeof PARK_LAMP | null;

/** A turn (rad) and a size factor a placement is drawn with on top of its own yaw and scale: drawing's only, the placement's collider never reads it. */
export type DrawnPose = { yaw: number; scale: number };

/** One drawable part of a prefab: its geometry, its material, whether the material is shared with the track art, and whether it casts a shadow (default: yes; ground cover and flat paving do not). */
export type PrefabPart = { geometry: THREE.BufferGeometry; material: THREE.Material; shared: boolean; shadow?: boolean };

/** Which layer of a layered texture a piece reads (negative: the roof covering, picked per building), how much of its normal map it keeps (1: all), and whether its uv is laid in the instance's own metres (1) or the block's (0, default). */
export type SurfaceRegion = readonly [layer: number, relief: number, metres: number];

/** A coloured piece: geometry already in prefab space, its sRGB colour, its `MaterialId` (unset: the material's own) and its texture region (unset: layer 0, full relief). */
export type Piece = [THREE.BufferGeometry, number, MaterialId?, SurfaceRegion?];

/** Merge pieces into one non-indexed geometry with position, normal, uv (zero when a piece has none), a per-vertex `color` and, when any piece names a class, `materialClass` (and a region, `surfaceRegion`). */
export function painted(pieces: readonly Piece[]): THREE.BufferGeometry {
  const col = new THREE.Color();
  const classed = pieces.some((piece) => piece[2] !== undefined);
  const regioned = pieces.some((piece) => piece[3] !== undefined);
  const parts = pieces.map(([g, hex, materialClass, region]) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    for (const name of Object.keys(n.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") n.deleteAttribute(name);
    n.clearGroups();
    const count = n.getAttribute("position").count;
    if (!n.getAttribute("normal")) n.computeVertexNormals();
    if (!n.getAttribute("uv")) n.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    col.setHex(hex);
    const c = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) col.toArray(c, i * 3);
    n.setAttribute("color", new THREE.BufferAttribute(c, 3));
    if (classed) n.setAttribute(MATERIAL_ATTRIBUTE, new THREE.BufferAttribute(new Float32Array(count).fill(materialClass ?? MAT.GENERIC), 1));
    if (regioned) {
      const regions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) regions.set(region ?? [0, 1, 0], i * 3);
      n.setAttribute(SURFACE_REGION_ATTRIBUTE, new THREE.BufferAttribute(regions, 3));
    }
    return n;
  });
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

/** Axis-aligned box of size (w, h, d) centred at (x, y, z). */
export function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

/** Vertical cylinder / cone from y0 to y1 at (x, z). */
export function cyl(rTop: number, rBottom: number, y0: number, y1: number, seg: number, open = false): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBottom, y1 - y0, seg, 1, open).translate(0, (y0 + y1) / 2, 0);
}

/** A plan outline as (x, z) points, in either winding. */
type Outline = readonly (readonly [number, number])[];

/** A regular polygon of `seg` sides inscribed in a circle of radius `r`, the corners where `cyl` puts its own. */
export function circleOutline(r: number, seg: number): Outline {
  return Array.from({ length: seg }, (_, i): [number, number] => [r * detSin((2 * Math.PI * i) / seg), r * detCos((2 * Math.PI * i) / seg)]);
}

/** A prism over `outline` from `y0` to `y1`, with `hole` (when given) cut through it. */
function prism(outline: Outline, hole: Outline | null, y0: number, y1: number): THREE.BufferGeometry {
  // Drawn in (x, -z) and laid flat: the shape's y becomes the world's -z, its extrusion the world's up.
  const toShape = (o: Outline): THREE.Vector2[] => o.map(([x, z]) => new THREE.Vector2(x, -z));
  const shape = new THREE.Shape(toShape(outline));
  if (hole) shape.holes.push(new THREE.Path(toShape(hole)));
  return new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, y0, 0);
}

/**
 * The stone of a pool, in `hex` and material `id`: a floor from the ground to `floorTop` under all of `outer`, and the kerb between `outer` and `water`
 * from the floor up to `kerbTop`. The water's footprint is then bare floor, well under the water's surface: stone filled up to the kerb
 * would put its top face a centimetre under the water's, and the depth buffer cannot tell the two apart from overhead (they flicker).
 */
export function poolStone(outer: Outline, water: Outline, floorTop: number, kerbTop: number, hex: number, id: MaterialId): Piece[] {
  return [[prism(outer, null, 0, floorTop), hex, id], [prism(outer, water, floorTop, kerbTop), hex, id]];
}

export const MARBLE_SHADE = { low: 0xe9e2d3, high: 0xd9d0bf, wall: 0xece7dc, dome: 0xf3f1ea, trim: 0xc9c2b2 };

/** A square-plan frustum (half sides `h0` at y0, `h1` at y1), faces square to the axes. */
export function squareFrustum(h0: number, h1: number, y0: number, y1: number): THREE.BufferGeometry {
  return cyl(h1 * Math.SQRT2, h0 * Math.SQRT2, y0, y1, 4).rotateY(Math.PI / 4);
}

