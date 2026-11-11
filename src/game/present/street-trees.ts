import * as THREE from "three";
import { MAT } from "../kernel/material-ids.ts";
import { PREFAB } from "../world/constants.ts";
import { mulberry32, type Placed } from "../world/placements.ts";
import { TREE_SCALE } from "../world/scenery.ts";
import { streetTreeKindOf, streetTreeOf, type StreetKind, type StreetTree, type StreetTreeKind, type StreetTreeSkin } from "../world/openworld/openworld-greenery.ts";
import { LEAF_CELLS, type LeafSpecies } from "./leaf-atlas.ts";
import { cyl, type Piece } from "./prefab-pieces.ts";

/** A canopy lump: an ellipsoid's middle and radii (m, in the tree's frame: +x toward its street, y up from the sidewalk) and its leaf colour. */
type Lump = readonly [x: number, y: number, z: number, rx: number, ry: number, rz: number, colour: number];
/** A limb from the trunk's top to a point in the canopy, and its radius at each end (m). */
type Limb = readonly [x: number, y: number, z: number, rootRadius: number, tipRadius: number];
/** A broadleaf street tree: a trunk leaning `trunkLean` m toward the street at its top, in bands of bark colour (a plane's mottling), limbs into the canopy, and the canopy's lumps. */
type TreeForm = { trunkHeight: number; trunkLean: number; rootRadius: number; topRadius: number; bark: readonly number[]; limbs: readonly Limb[]; canopy: readonly Lump[]; pit: Pit; ivy: readonly Lump[] };
/** The bare soil at a tree's foot: an octagon or a circle of these half extents across the strip (the tree frame's x) and along it (z), `sides` sides. */
type Pit = { halfAcross: number; halfAlong: number; sides: number };
type BareForm = Omit<TreeForm, "pit" | "ivy">;

const PLANE_LEAVES = [0x5b8a3c, 0x4e7e35, 0x6a9646, 0x46733a, 0x5f8f40, 0x527f38, 0x679343, 0x4a7836] as const;
const LINDEN_LEAVES = [0x3f6e2f, 0x4a7a36, 0x376428, 0x45722f, 0x3c6a2d] as const;
const YOUNG_LEAVES = [0x7ea24c, 0x8aac55, 0x74994a] as const;
const BLOSSOMS = [0xeaa6bf, 0xf3c3d3, 0xdf91ad, 0xd8869f] as const;
const CHERRY_LEAF = 0x6f9a48;

/** Street trees' shapes: no lump reaches over 2.32 m behind the trunk toward the houses (2.6 m turned and at the largest size: 0.4 m street-side of the property line, clear of the bays); */
/** a lump over the clear path keeps its underside 2.84 m up (2.5 m at the smallest size). A plane's canopy reaches past the street's middle. */
const STREET_FORMS: Readonly<Record<StreetKind, BareForm>> = {
  plane: {
    trunkHeight: 4.6,
    trunkLean: 0.23,
    rootRadius: 0.26,
    topRadius: 0.18,
    bark: [0xd9d1b5, 0x9e9b7a, 0xc8bc98, 0xb3ad8c],
    limbs: [
      [1.8, 7.4, 0.5, 0.15, 0.09],
      [-0.2, 7.8, -0.5, 0.13, 0.08],
      [2.6, 7.0, -1.4, 0.12, 0.07],
      [1.0, 8.4, 1.6, 0.1, 0.06],
    ],
    canopy: [
      [2.8, 8.2, 0, 3.0, 2.2, 3.0, PLANE_LEAVES[0]],
      [0.6, 9.6, 1.2, 2.6, 2.0, 2.4, PLANE_LEAVES[1]],
      [-0.2, 8.6, -0.6, 1.8, 1.6, 1.8, PLANE_LEAVES[2]],
      [4.4, 7.6, 1.6, 2.4, 1.8, 2.4, PLANE_LEAVES[3]],
      [4.0, 8.0, -2.0, 2.2, 1.7, 2.2, PLANE_LEAVES[4]],
      [2.0, 11.0, 0.4, 2.2, 1.6, 2.2, PLANE_LEAVES[5]],
      [1.4, 6.6, 0.4, 2.0, 1.4, 2.0, PLANE_LEAVES[6]],
      [1.0, 7.4, 2.4, 1.8, 1.5, 1.8, PLANE_LEAVES[7]],
    ],
  },
  linden: {
    trunkHeight: 3.6,
    trunkLean: 0.11,
    rootRadius: 0.2,
    topRadius: 0.14,
    bark: [0x5c4e40, 0x4b4034, 0x66584b],
    limbs: [
      [1.2, 5.8, 0.4, 0.12, 0.07],
      [0, 6.2, -0.4, 0.11, 0.06],
      [2.0, 5.4, -0.8, 0.1, 0.06],
    ],
    canopy: [
      [1.4, 6.6, 0, 2.4, 2.4, 2.4, LINDEN_LEAVES[0]],
      [0.6, 8.6, 0.3, 1.9, 1.8, 1.9, LINDEN_LEAVES[1]],
      [2.8, 6.0, 1.1, 1.8, 1.6, 1.8, LINDEN_LEAVES[2]],
      [-0.3, 5.8, -0.5, 1.6, 1.5, 1.6, LINDEN_LEAVES[3]],
      [2.4, 6.8, -1.4, 1.7, 1.6, 1.7, LINDEN_LEAVES[4]],
    ],
  },
  young: {
    trunkHeight: 3.4,
    trunkLean: 0.06,
    rootRadius: 0.1,
    topRadius: 0.07,
    bark: [0x6e5c4a, 0x7a6754],
    limbs: [],
    canopy: [
      [0.3, 4.6, 0, 1.2, 1.6, 1.2, YOUNG_LEAVES[0]],
      [0.4, 5.6, 0.2, 0.9, 1.0, 0.9, YOUNG_LEAVES[1]],
      [0.8, 4.2, -0.3, 0.8, 0.9, 0.8, YOUNG_LEAVES[2]],
    ],
  },
  cherry: {
    trunkHeight: 2.4,
    trunkLean: 0.19,
    rootRadius: 0.15,
    topRadius: 0.11,
    bark: [0x4d3832, 0x5c4239],
    limbs: [
      [1.5, 3.8, 0.5, 0.09, 0.05],
      [-0.3, 4.0, -0.5, 0.08, 0.05],
      [1.1, 3.6, -1.1, 0.08, 0.05],
    ],
    canopy: [
      [1.8, 4.3, 0.4, 1.8, 1.2, 1.8, BLOSSOMS[0]],
      [-0.1, 4.7, -0.4, 1.5, 1.1, 1.6, BLOSSOMS[1]],
      [1.3, 5.3, -0.6, 1.4, 1.0, 1.4, BLOSSOMS[2]],
      [2.6, 4.0, -1.0, 1.3, 0.9, 1.3, BLOSSOMS[3]],
      [0.6, 4.1, 1.2, 0.9, 0.7, 0.9, CHERRY_LEAF],
    ],
  },
};

/** The street tree pit's bare soil: an octagon 0.68 m across the strip and 1.4 m along it, a little proud of the paving; at the largest size and turn its corner stays 0.94 m of the walk path's middle. */
const STREET_PIT: Pit = { halfAcross: 0.34, halfAlong: 0.7, sides: 8 };
/** A park tree's bed: a round dirt bed 3.2 m across, as under the big plane tree in Rittenhouse Square, with no ivy. */
const PARK_BED: Pit = { halfAcross: 1.6, halfAlong: 1.6, sides: 16 };
const PIT_TOP = 0.04;
const SOIL = 0x4a3a2c;
/** A park tree is its street kind grown this much in every length: trunk, limbs and canopy. */
const PARK_GROWTH = 1.3;
/** The leaf cards a whole tree of each kind carries, each card's edge (m), and the atlas column it reads. */
const CARDS: Record<StreetTreeKind, { count: number; edge: number; species: LeafSpecies }> = {
  plane: { count: 120, edge: 2.4, species: "plane" },
  linden: { count: 80, edge: 1.7, species: "linden" },
  young: { count: 28, edge: 1.2, species: "young" },
  cherry: { count: 72, edge: 1.5, species: "cherry" },
  parkPlane: { count: 120, edge: 2.4 * PARK_GROWTH, species: "plane" },
  parkLinden: { count: 80, edge: 1.7 * PARK_GROWTH, species: "linden" },
};
/** Each ivy lump at a tree's foot is this many cards of this edge (m), lying flat. */
const IVY_CARDS = 5;
const IVY_EDGE = 0.36;
const FORWARD = new THREE.Vector3(0, 0, 1);
/** The shell that card centres are scattered into never shrinks below this share of the lump's radius. */
const SHELL_FLOOR = 0.35;
/** Ivy over the pit, a lump spilling toward the curb on the street side (the strip's edge is 0.6 m toward the street). */
const IVY: readonly Lump[] = [
  [0.12, 0.1, 0.35, 0.28, 0.16, 0.32, 0x2f5a28],
  [-0.04, 0.12, -0.3, 0.24, 0.18, 0.3, 0x3a6b2e],
  [0.32, 0.08, -0.05, 0.24, 0.14, 0.3, 0x2a4f24],
  [-0.08, 0.09, 0.05, 0.2, 0.13, 0.25, 0x356229],
];
/** `form` with every length grown by `factor`; colours and the number of lumps stay. */
function grown(form: BareForm, factor: number): BareForm {
  const lumps = (lump: Lump): Lump => [lump[0] * factor, lump[1] * factor, lump[2] * factor, lump[3] * factor, lump[4] * factor, lump[5] * factor, lump[6]];
  return {
    trunkHeight: form.trunkHeight * factor,
    trunkLean: form.trunkLean * factor,
    rootRadius: form.rootRadius * factor,
    topRadius: form.topRadius * factor,
    bark: form.bark,
    limbs: form.limbs.map((limb): Limb => [limb[0] * factor, limb[1] * factor, limb[2] * factor, limb[3] * factor, limb[4] * factor]),
    canopy: form.canopy.map(lumps),
  };
}

const STREET_TREE_FORMS: Readonly<Record<StreetTreeKind, TreeForm>> = {
  plane: { ...STREET_FORMS.plane, pit: STREET_PIT, ivy: IVY },
  linden: { ...STREET_FORMS.linden, pit: STREET_PIT, ivy: IVY },
  young: { ...STREET_FORMS.young, pit: STREET_PIT, ivy: IVY },
  cherry: { ...STREET_FORMS.cherry, pit: STREET_PIT, ivy: IVY },
  parkPlane: { ...grown(STREET_FORMS.plane, PARK_GROWTH), pit: PARK_BED, ivy: [] },
  parkLinden: { ...grown(STREET_FORMS.linden, PARK_GROWTH), pit: PARK_BED, ivy: [] },
};

const TRUNK_SIDES = 8;
const LIMB_SIDES = 6;

const UP = new THREE.Vector3(0, 1, 0);

/** A tapered rod from `from` to `to` with radius `rootRadius` at `from` and `tipRadius` at `to`, open-ended. */
function rod(from: THREE.Vector3, to: THREE.Vector3, rootRadius: number, tipRadius: number, sides: number): THREE.BufferGeometry {
  const along = to.clone().sub(from);
  const length = along.length();
  return cyl(tipRadius, rootRadius, 0, length, sides, true)
    .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, along.divideScalar(length)))
    .translate(from.x, from.y, from.z);
}

/** A lump of leaves as `cards` square cards of `edge` m, each reading one atlas cell of `species`; they fill the shell, darker inward, normals bent outward; `flat` (ivy) lies level. */
export function cardPieces(lump: Lump, seed: number, cards: number, edge: number, species: LeafSpecies, flat = false): Piece[] {
  const [x, y, z, rx, ry, rz, colour] = lump;
  const random = mulberry32(seed);
  const cells = LEAF_CELLS[species];
  const shrink = (radius: number): number => Math.max(SHELL_FLOOR * radius, radius - 0.71 * edge);
  const tint = new THREE.Color();
  const pieces: Piece[] = [];
  for (let card = 0; card < cards; card++) {
    const up = flat ? 0 : random() * 2 - 1;
    const turn = random() * Math.PI * 2;
    const level = Math.sqrt(1 - up * up);
    const reach = 0.45 + 0.55 * random();
    const centre = new THREE.Vector3(level * Math.cos(turn) * shrink(rx) * reach, up * shrink(ry) * reach, level * Math.sin(turn) * shrink(rz) * reach);
    const normal = flat ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(random() * 2 - 1, random() * 2 - 0.4, random() * 2 - 1).normalize();
    const geometry = new THREE.PlaneGeometry(edge, edge);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(FORWARD, normal));
    geometry.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(normal, random() * Math.PI * 2));
    geometry.translate(centre.x, centre.y, centre.z);
    const [u0, v0, du, dv] = cells[card % cells.length]!;
    const mirrored = random() < 0.5;
    const uv = geometry.getAttribute("uv");
    for (let corner = 0; corner < uv.count; corner++) uv.setXY(corner, u0 + (mirrored ? 1 - uv.getX(corner) : uv.getX(corner)) * du, v0 + uv.getY(corner) * dv);
    const position = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    const facing = normal.dot(centre) >= 0 ? 1 : -1;
    for (let corner = 0; corner < position.count; corner++) {
      const outward = flat ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(position.getX(corner), position.getY(corner), position.getZ(corner)).normalize();
      outward.multiplyScalar(0.8).addScaledVector(normal, 0.2 * facing).normalize();
      normals.setXYZ(corner, outward.x, outward.y, outward.z);
    }
    geometry.translate(x, y, z);
    const shade = (0.62 + 0.38 * reach) * (0.92 + 0.16 * random());
    pieces.push([geometry, tint.setHex(colour).multiplyScalar(shade).getHex(), MAT.CONIFER_FOLIAGE]);
  }
  return pieces;
}

/** The pieces of the street tree `skin` names, at the scale its prop stands at (`TREE_SCALE`): pit, ivy, trunk in its bark bands, limbs, canopy. */
export function streetTreePieces(skin: StreetTreeSkin): Piece[] {
  const kind = streetTreeKindOf(skin);
  const form = STREET_TREE_FORMS[kind];
  const kindIndex = Object.keys(STREET_TREE_FORMS).indexOf(kind);
  const { pit } = form;
  const pieces: Piece[] = [[cyl(pit.halfAlong, pit.halfAlong, 0, PIT_TOP, pit.sides).scale(pit.halfAcross / pit.halfAlong, 1, 1), SOIL, MAT.HAY]];
  for (const [index, ivy] of form.ivy.entries()) pieces.push(...cardPieces(ivy, 1000 + index, IVY_CARDS, IVY_EDGE, CARDS[kind].species, true));
  const top = new THREE.Vector3(form.trunkLean, form.trunkHeight, 0);
  const bands = form.bark.length;
  for (let band = 0; band < bands; band++) {
    const from = top.clone().multiplyScalar(band / bands);
    const to = top.clone().multiplyScalar((band + 1) / bands);
    const radius = (share: number): number => form.rootRadius + (form.topRadius - form.rootRadius) * share;
    pieces.push([rod(from, to, radius(band / bands), radius((band + 1) / bands), TRUNK_SIDES), form.bark[band]!, MAT.TREE_BARK]);
  }
  for (const [x, y, z, rootRadius, tipRadius] of form.limbs) pieces.push([rod(top, new THREE.Vector3(x, y, z), rootRadius, tipRadius, LIMB_SIDES), form.bark[bands - 1]!, MAT.TREE_BARK]);
  const volume = (lump: Lump): number => lump[3] * lump[4] * lump[5];
  const whole = form.canopy.reduce((sum, lump) => sum + volume(lump), 0);
  for (const [index, leaves] of form.canopy.entries()) pieces.push(...cardPieces(leaves, kindIndex * 97 + index + 1, Math.max(1, Math.round((CARDS[kind].count * volume(leaves)) / whole)), CARDS[kind].edge, CARDS[kind].species));
  for (const [geometry] of pieces) geometry.scale(1 / TREE_SCALE, 1 / TREE_SCALE, 1 / TREE_SCALE);
  return pieces;
}

/** The street tree a placement's `style` names (its kind, its drawn turn and size), null for any other: a tree of every other course has no style and draws as ever. */
export function treeOf(p: Pick<Placed, "prefab" | "style">): StreetTree | null {
  return p.prefab === PREFAB.tree ? streetTreeOf(p.style) : null;
}
