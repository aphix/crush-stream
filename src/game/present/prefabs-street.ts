import type * as THREE from "three";
import { MAT } from "../kernel/material-ids.ts";
import type { PrefabId } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import { plazaBricks } from "../world/openworld/openworld-plaza.ts";
import { PAVILION, POSTS } from "../world/street-kit.ts";
import { box, cyl, painted, type Piece, type PrefabMaterials, type PrefabPart } from "./prefab-pieces.ts";
import { bicyclePieces, spokePart } from "./bicycle.ts";
import { monumentPieces } from "./prefabs-mall.ts";

/**
 * The open world's street kit (`STREET_KIT`): each piece in a few boxes and cylinders, vertex coloured on the plain material, its front (+x) toward the street. Origin at the foot's middle.
 * Real shapes in place of the sprite cards: a bench has a seat and a back, a rack its staple and a bicycle, a street sign two blades the street names are printed on (`street-name-blades.ts`).
 */

const KIT_COLOUR = {
  wood: 0x9b6b3d,
  iron: 0x26332c,
  galvanised: 0x7a8086,
  binGreen: 0x1f4a33,
  binLid: 0x173a28,
  meterPost: 0x4b5157,
  meterHead: 0x5a6068,
  meterFace: 0xd8c35a,
  hydrant: 0xe2661d,
  hydrantCap: 0xa84a14,
  tableTop: 0x3a3a3a,
  chair: 0x6b4a2b,
  canopy: 0x2f6e4a,
  roof: 0x3b4148,
  glass: 0x9db6c2,
  post: 0x8c939a,
  stopYellow: 0xf2c230,
  stopBlue: 0x2a59a8,
  signPole: 0x1e3a2b,
  signBlade: 0x1f56a6,
  bollard: 0x4a3426,
  cellarFrame: 0xa8a39a,
  cellarLeaf: 0x3d4045,
  fence: 0x1b1c1a,
  pavilionRoof: 0x2f5b45,
  pavilionPost: 0xe8e2d0,
  pavilionFloor: 0x9c968c,
  newsBody: 0xb32020,
  newsCap: 0x8c1818,
  newsWindow: 0x1c2a33,
} as const;

/** Sides of a round piece: a hydrant or a bin reads round at street level from 12 to 16, a thin post from 8. */
const ROUND = 14;
const THIN = 8;
const WHEEL = 16;

/** The street sign's blades (m): one along x over one along z, each this long, tall and thick, at these heights on a pole this tall; `street-name-blades.ts` prints on their faces. */
export const STREET_SIGN = { bladeLength: 0.9, bladeHeight: 0.18, bladeThickness: POSTS.streetSign.bladeThickness, alongXHeight: 2.78, alongZHeight: 2.56, poleHeight: 2.9 } as const;

/** A cylinder of radius `r` lying along x (`axis` "x") or z, centred at (x, y, z), `length` long. */
function lying(r: number, length: number, axis: "x" | "z", x: number, y: number, z: number): THREE.BufferGeometry {
  const round = cyl(r, r, -length / 2, length / 2, THIN);
  return (axis === "x" ? round.rotateZ(Math.PI / 2) : round.rotateX(Math.PI / 2)).translate(x, y, z);
}

function bench(): Piece[] {
  const pieces: Piece[] = [
    [box(0.45, 0.06, 1.6, 0.02, 0.45, 0), KIT_COLOUR.wood, MAT.BENCH_MAPLE],
    [box(0.05, 0.4, 1.6, -0.2, 0.7, 0), KIT_COLOUR.wood, MAT.BENCH_MAPLE],
  ];
  for (const z of [-0.72, 0.72]) pieces.push([box(0.5, 0.42, 0.06, 0, 0.21, z), KIT_COLOUR.iron, MAT.BRACKET_STEEL], [box(0.06, 0.5, 0.06, -0.2, 0.65, z), KIT_COLOUR.iron, MAT.BRACKET_STEEL]);
  return pieces;
}

/** A staple rack along the curb and a bicycle (`bicycle.ts`: a diamond frame of rods, ring tyres; its spokes are the kit's second part) locked to it on the street side. */
function bikeRack(): Piece[] {
  return [
    [box(0.05, 0.8, 0.05, -0.2, 0.4, -0.55), KIT_COLOUR.galvanised, MAT.BRACKET_STEEL],
    [box(0.05, 0.8, 0.05, -0.2, 0.4, 0.55), KIT_COLOUR.galvanised, MAT.BRACKET_STEEL],
    [box(0.05, 0.05, 1.15, -0.2, 0.8, 0), KIT_COLOUR.galvanised, MAT.BRACKET_STEEL],
    ...bicyclePieces(),
  ];
}

function litterBin(): Piece[] {
  return [
    [cyl(0.23, 0.21, 0, 0.82, ROUND), KIT_COLOUR.binGreen, MAT.DUMPSTER_STEEL],
    [cyl(0.25, 0.25, 0.82, 0.9, ROUND), KIT_COLOUR.binLid, MAT.DUMPSTER_LID],
  ];
}

function parkingMeter(): Piece[] {
  return [
    [cyl(0.035, 0.035, 0, 1.05, THIN), KIT_COLOUR.meterPost, MAT.LAMP_POLE],
    [box(0.16, 0.28, 0.13, 0, 1.2, 0), KIT_COLOUR.meterHead, MAT.LAMP_POLE],
    [cyl(0.06, 0.08, 1.34, 1.4, THIN), KIT_COLOUR.meterHead, MAT.LAMP_POLE],
    [box(0.01, 0.1, 0.09, 0.085, 1.24, 0), KIT_COLOUR.meterFace, MAT.SIGN_BOARD],
  ];
}

/** A hydrant's outlets (m): each this long, its middle this far from the barrel's axis, so the tip stands at the plan's reach (`POSTS.hydrant.reach`). */
const OUTLET_LENGTH = 0.1;
const OUTLET_MIDDLE = POSTS.hydrant.reach - OUTLET_LENGTH / 2;

/** Flange, barrel, bonnet and cap, a hose outlet each side and the pumper outlet toward the street. */
function hydrant(): Piece[] {
  return [
    [cyl(0.15, 0.15, 0, 0.05, ROUND), KIT_COLOUR.hydrantCap, MAT.DUMPSTER_STEEL],
    [cyl(0.12, 0.12, 0.05, 0.56, ROUND), KIT_COLOUR.hydrant, MAT.DUMPSTER_STEEL],
    [cyl(0.08, 0.14, 0.56, 0.68, ROUND), KIT_COLOUR.hydrant, MAT.DUMPSTER_STEEL],
    [cyl(0.04, 0.04, 0.68, 0.76, THIN), KIT_COLOUR.hydrantCap, MAT.DUMPSTER_STEEL],
    [lying(0.045, OUTLET_LENGTH, "z", 0, 0.42, -OUTLET_MIDDLE), KIT_COLOUR.hydrantCap, MAT.DUMPSTER_STEEL],
    [lying(0.045, OUTLET_LENGTH, "z", 0, 0.42, OUTLET_MIDDLE), KIT_COLOUR.hydrantCap, MAT.DUMPSTER_STEEL],
    [lying(0.06, OUTLET_LENGTH, "x", OUTLET_MIDDLE, 0.4, 0), KIT_COLOUR.hydrantCap, MAT.DUMPSTER_STEEL],
  ];
}

/** A café chair's seat (m), square; its back rises from the seat's far edge. */
const CHAIR_SEAT = 0.38;

/** A round table under a parasol, a chair either side of it along the curb. */
function cafeSet(): Piece[] {
  const pieces: Piece[] = [
    [cyl(0.35, 0.35, 0.7, 0.73, WHEEL), KIT_COLOUR.tableTop, MAT.GANTRY_STEEL],
    [cyl(0.2, 0.2, 0, 0.02, WHEEL), KIT_COLOUR.tableTop, MAT.GANTRY_STEEL],
    [cyl(0.02, 0.02, 0.02, 2.25, THIN), KIT_COLOUR.tableTop, MAT.GANTRY_STEEL],
    [cyl(0.03, 0.55, 1.9, 2.25, THIN + 2), KIT_COLOUR.canopy, MAT.GENERIC],
  ];
  for (const side of [-1, 1]) {
    const z = side * 0.62;
    pieces.push(
      [box(CHAIR_SEAT, 0.04, CHAIR_SEAT, 0, 0.45, z), KIT_COLOUR.chair, MAT.CRATE_WOOD],
      [box(0.04, 0.43, 0.04, -0.15, 0.215, z), KIT_COLOUR.chair, MAT.CRATE_WOOD],
      [box(0.04, 0.43, 0.04, 0.15, 0.215, z), KIT_COLOUR.chair, MAT.CRATE_WOOD],
      [box(CHAIR_SEAT, 0.45, 0.04, 0, 0.7, z + (side * CHAIR_SEAT) / 2), KIT_COLOUR.chair, MAT.CRATE_WOOD],
    );
  }
  return pieces;
}

/** A shallow shelter open to the curb: roof, back and end panels of glass, four posts and a bench inside. */
function busShelter(): Piece[] {
  const pieces: Piece[] = [
    [box(1.1, 0.08, 4.3, 0, 2.46, 0), KIT_COLOUR.roof, MAT.GANTRY_STEEL],
    [box(0.03, 2, 4, -0.5, 1.2, 0), KIT_COLOUR.glass, MAT.WINDOW_PANE],
    [box(0.9, 2, 0.03, 0, 1.2, -2), KIT_COLOUR.glass, MAT.WINDOW_PANE],
    [box(0.9, 2, 0.03, 0, 1.2, 2), KIT_COLOUR.glass, MAT.WINDOW_PANE],
    [box(0.3, 0.05, 2.4, -0.32, 0.45, 0), KIT_COLOUR.wood, MAT.BENCH_MAPLE],
  ];
  for (const x of [-0.5, 0.5]) for (const z of [-2.08, 2.08]) pieces.push([box(0.07, 2.42, 0.07, x, 1.21, z), KIT_COLOUR.roof, MAT.GANTRY_STEEL]);
  return pieces;
}

/** The stop's pole with its plates facing along the street (the kit turns it a quarter). */
function busStopSign(): Piece[] {
  return [
    [cyl(0.03, 0.03, 0, 2.6, THIN), KIT_COLOUR.post, MAT.LAMP_POLE],
    [box(0.02, 0.34, 0.34, 0.035, 2.35, 0), KIT_COLOUR.stopYellow, MAT.SIGN_BOARD],
    [box(0.02, 0.28, 0.28, 0.035, 1.98, 0), KIT_COLOUR.stopBlue, MAT.SIGN_BOARD],
  ];
}

function streetSign(): Piece[] {
  const { bladeLength, bladeHeight, bladeThickness, alongXHeight, alongZHeight, poleHeight } = STREET_SIGN;
  return [
    [cyl(0.04, 0.045, 0, poleHeight, THIN), KIT_COLOUR.signPole, MAT.LAMP_POLE],
    [box(bladeLength, bladeHeight, bladeThickness, 0, alongXHeight, 0), KIT_COLOUR.signBlade, MAT.SIGN_BOARD],
    [box(bladeThickness, bladeHeight, bladeLength, 0, alongZHeight, 0), KIT_COLOUR.signBlade, MAT.SIGN_BOARD],
  ];
}

/** Philadelphia's brown cast-iron corner bollard: a post, a collar and a domed cap. */
function bollard(): Piece[] {
  const { postRadius, collarRadius, collarBottom, collarTop, capBottom, capTopRadius, top } = POSTS.bollard;
  return [
    [cyl(postRadius, postRadius, 0, collarBottom, THIN), KIT_COLOUR.bollard, MAT.LAMP_POLE],
    [cyl(collarRadius, collarRadius, collarBottom, collarTop, THIN), KIT_COLOUR.bollard, MAT.LAMP_POLE],
    [cyl(postRadius, postRadius, collarTop, capBottom, THIN), KIT_COLOUR.bollard, MAT.LAMP_POLE],
    [cyl(capTopRadius, postRadius, capBottom, top, THIN), KIT_COLOUR.bollard, MAT.LAMP_POLE],
  ];
}

/** A basement's steel doors in the sidewalk: two leaves on a concrete curb a hand high, hinged along the curb's sides. */
function cellarDoor(): Piece[] {
  return [
    [box(1, 0.1, 1.1, 0, 0.05, 0), KIT_COLOUR.cellarFrame, MAT.JERSEY_CONCRETE],
    [box(0.9, 0.04, 0.48, 0, 0.12, -0.26), KIT_COLOUR.cellarLeaf, MAT.DUMPSTER_STEEL],
    [box(0.9, 0.04, 0.48, 0, 0.12, 0.26), KIT_COLOUR.cellarLeaf, MAT.DUMPSTER_STEEL],
    [box(0.06, 0.04, 0.2, 0.3, 0.16, 0), KIT_COLOUR.cellarLeaf, MAT.DUMPSTER_STEEL],
  ];
}

/** A run of low hoop fence along a path (4 m along z): a post at each end and the middle, a rail at the top and one low. */
function hoopFence(): Piece[] {
  const pieces: Piece[] = [];
  for (const z of [-1.97, 0, 1.97]) pieces.push([box(0.04, 0.45, 0.04, 0, 0.225, z), KIT_COLOUR.fence, MAT.BRACKET_STEEL]);
  for (const y of [0.12, 0.4]) pieces.push([box(0.025, 0.025, 4, 0, y, 0), KIT_COLOUR.fence, MAT.BRACKET_STEEL]);
  return pieces;
}

/** The square's little pavilion: a round floor, eight posts, a fascia and a green cone roof with a finial (`PAVILION`: what a car meets is these). */
function pavilion(): Piece[] {
  const { sides, posts, postRing, postHalf, floorRadius, floorHeight, fasciaRadius, fasciaBottom, fasciaTop, coneRadius, coneTop, finialRadius, top } = PAVILION;
  const pieces: Piece[] = [
    [cyl(floorRadius, floorRadius, 0, floorHeight, sides), KIT_COLOUR.pavilionFloor, MAT.JERSEY_CONCRETE],
    [cyl(fasciaRadius, fasciaRadius, fasciaBottom, fasciaTop, sides), KIT_COLOUR.pavilionRoof, MAT.GANTRY_STEEL],
    [cyl(PAVILION_CONE_TIP, coneRadius, fasciaTop, coneTop, sides), KIT_COLOUR.pavilionRoof, MAT.GANTRY_STEEL],
    [cyl(PAVILION_FINIAL_TIP, finialRadius, coneTop, top, THIN), KIT_COLOUR.pavilionRoof, MAT.GANTRY_STEEL],
  ];
  for (let post = 0; post < posts; post++) {
    const angle = ((post + 0.5) * 2 * Math.PI) / posts;
    pieces.push([box(2 * postHalf, fasciaBottom - floorHeight, 2 * postHalf, postRing * Math.cos(angle), (floorHeight + fasciaBottom) / 2, postRing * Math.sin(angle)), KIT_COLOUR.pavilionPost, MAT.GANTRY_STEEL]);
  }
  return pieces;
}

/** The pavilion roof's cone narrows to this radius (m) at its tip, and its finial to this. */
const PAVILION_CONE_TIP = 0.1;
const PAVILION_FINIAL_TIP = 0.03;

/** A newspaper vending box: a red body under a darker cap, a dark window and a coin plate on its street face. */
function newsBox(): Piece[] {
  return [
    [box(0.46, 0.85, 0.56, 0, 0.425, 0), KIT_COLOUR.newsBody, MAT.DUMPSTER_STEEL],
    [box(0.5, 0.1, 0.6, 0, 0.9, 0), KIT_COLOUR.newsCap, MAT.DUMPSTER_STEEL],
    [box(0.02, 0.3, 0.4, 0.235, 0.6, 0), KIT_COLOUR.newsWindow, MAT.WINDOW_PANE],
    [box(0.02, 0.1, 0.12, 0.235, 0.33, 0.15), KIT_COLOUR.galvanised, MAT.BRACKET_STEEL],
  ];
}

const KIT_PIECES: Partial<Record<PrefabId, () => Piece[]>> = {
  [PREFAB.bench]: bench,
  [PREFAB.bikeRack]: bikeRack,
  [PREFAB.litterBin]: litterBin,
  [PREFAB.parkingMeter]: parkingMeter,
  [PREFAB.hydrant]: hydrant,
  [PREFAB.cafeSet]: cafeSet,
  [PREFAB.busShelter]: busShelter,
  [PREFAB.busStopSign]: busStopSign,
  [PREFAB.streetSign]: streetSign,
  [PREFAB.bollard]: bollard,
  [PREFAB.cellarDoor]: cellarDoor,
  [PREFAB.hoopFence]: hoopFence,
  [PREFAB.pavilion]: pavilion,
  [PREFAB.newsBox]: newsBox,
  [PREFAB.plaza]: () => monumentPieces(plazaBricks()),
};

/** A street kit piece as one part on the plain material. */
export function streetKitParts(id: PrefabId, mats: PrefabMaterials): PrefabPart[] {
  const draw = KIT_PIECES[id];
  if (draw === undefined) throw new Error(`${id} is no street kit piece`);
  const parts: PrefabPart[] = [{ geometry: painted(draw()), material: mats.plain, shared: false }];
  if (id === PREFAB.bikeRack) parts.push(spokePart());
  return parts;
}
