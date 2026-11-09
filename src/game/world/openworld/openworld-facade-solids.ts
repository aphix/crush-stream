import { detCos, detSin } from "../../kernel/physics-core.js";
import { PREFABS } from "../catalog.ts";
import { PREFAB } from "../constants.ts";
import { bayFloorsOf, buildingHeight, DEFAULT_STOREYS, levelsOf } from "./interior-kinds.ts";
import type { Lots } from "./openworld-layout.ts";
import { PLACE_KIND, type Place } from "./walk-graph.ts";

/** A rowhome's frontage (m): the lot width the kit's cornice and bay stack are cut for. */
export const LOT_WIDTH = 5.6;

/** The drawn block's half side (m): a building prop's walls stand this share of the prefab's own side out from its centre (its roof slab reaches the whole side), at any instance size. */
export const BLOCK_FACE_HALF = 5.9;

/** How far from its centre (m) the drawn wall of a building prop stands whose footprint side is `extent`: short of the footprint's edge, under the roof slab's overhang. */
export function drawnHalf(extent: number): number {
  return (BLOCK_FACE_HALF / PREFABS[PREFAB.building].size[0]) * extent;
}

/** The height (m) of a three-storey rowhome: what the roofline cornice is built at (a house of any other count stands it up or down by the difference). */
export const HOME_HEIGHT = buildingHeight(DEFAULT_STOREYS, false);

/** Stone steps up to the door: 5 risers of 0.18 m (the interior floor sits on the top one), 0.28 m treads, a 0.5 m landing at the wall, 1.6 m wide (door 1.0 m and 0.3 m of stone each side). */
const STOOP_RISE = 0.18;
const STOOP_STEPS = 5;
const STOOP_TREAD = 0.28;
const STOOP_LANDING = 0.5;
const STOOP_WIDTH = 1.6;
export const STOOP = {
  rise: STOOP_RISE,
  steps: STOOP_STEPS,
  tread: STOOP_TREAD,
  landing: STOOP_LANDING,
  width: STOOP_WIDTH,
  /** Out from the facade face to the foot of the bottom step. */
  run: STOOP_LANDING + (STOOP_STEPS - 1) * STOOP_TREAD,
  /** The landing's top: the door sill. */
  sill: STOOP_RISE * STOOP_STEPS,
} as const;

/**
 * Door and bay side by side, the same on every house: across the lot (u, along the building's local z, from the lot's middle) the door and its stoop stand at +1.8 m and the bay stack
 * takes the other half, centred at -0.9 m and 2.8 m wide: 0.5 m of pier at each side of it and 0.45 m between the bay and the stoop (u 1.0 to 2.6).
 */
const DOOR_ACROSS = 1.8;
const BAY_ACROSS = -0.9;
/** The door hole every rowhome's ground band is cut with (m): half its width, and its height over the door sill. */
const DOOR_HALF_WIDTH = 0.5;
const DOOR_HEIGHT = 2.1;
export const DOOR = { across: DOOR_ACROSS, halfWidth: DOOR_HALF_WIDTH, sill: STOOP.sill, head: STOOP.sill + DOOR_HEIGHT } as const;

/** The door's centre on a house's drawn front face, for the place's door point: the lot's middle (lotX), its front line (frontZ) and the house's depth for a building facing `yaw`. */
export function homeDoorPoint(lotX: number, frontZ: number, yaw: number, depth: number): { x: number; z: number } {
  const inset = depth / 2 - drawnHalf(depth);
  return { x: lotX - inset * detCos(yaw) + DOOR_ACROSS * detSin(yaw), z: frontZ + inset * detSin(yaw) + DOOR_ACROSS * detCos(yaw) };
}

/**
 * The bay stack beside the door, from the ground to the roof: a stone plinth with a half-basement window, then on every floor a panelled apron, a window (flat front, two angled sides)
 * and a belt band, a panel and a roof slab on top; every ring is cut from one footprint. `out` 0.7 m is inside the 0.6-0.9 m a rowhome bay projects; its sides run `out` along the facade, so the width is `front` + 2 `out`.
 */
const BAY_FRONT = 1.4;
const BAY_OUT = 0.7;
/** Over the top window: the belt band, a panel and the roof slab (m). */
const BAY_CAP_BAND = 0.25;
const BAY_CAP_PANEL = 0.15;
const BAY_CAP_SLAB = 0.15;
/** The plinth's cap band over the basement (m). */
const BAY_PLINTH_BAND = 0.15;

type BayFloor = { sill: number; head: number };

/**
 * The bay stack of a house of `storeys` storeys: a sash window over each of the rowhome interior's floors (the raised ground storey's floor is the door sill, then each floor above) and where its roof slab tops out (m).
 * The interior draws its alcoves from the same floors.
 */
export function bayStackOf(storeys: number): { floors: readonly BayFloor[]; top: number } {
  const floors = bayFloorsOf(levelsOf("rowhome", storeys).floors);
  return { floors, top: floors[floors.length - 1]!.head + BAY_CAP_BAND + BAY_CAP_PANEL + BAY_CAP_SLAB };
}

const THREE_STOREY_TOP = bayStackOf(DEFAULT_STOREYS).top;

export const BAY = {
  front: BAY_FRONT,
  out: BAY_OUT,
  width: BAY_FRONT + 2 * BAY_OUT,
  /** The footprint's middle across the lot (u). */
  across: BAY_ACROSS,
  plinthTop: STOOP.sill,
  plinthBand: BAY_PLINTH_BAND,
  capBand: BAY_CAP_BAND,
  capPanel: BAY_CAP_PANEL,
  capSlab: BAY_CAP_SLAB,
  /** The three-storey stack's roof slab (m). */
  top: THREE_STOREY_TOP,
} as const;

/** A point of the bay's plan: out from the facade face, across the lot (u). */
type BayCorner = { out: number; across: number };

/** The bay's outline (flat front, 45-degree sides), pushed `offset` m outward on every edge (0: the kit's walls): wall corner, front corner, front corner, wall corner, from -u to +u. */
export function bayOutline(offset = 0): readonly BayCorner[] {
  const half = BAY.front / 2;
  const mitre = offset * (Math.SQRT2 - 1);
  return [
    { out: 0, across: BAY.across - (half + BAY.out) - offset * Math.SQRT2 },
    { out: BAY.out + offset, across: BAY.across - half - mitre },
    { out: BAY.out + offset, across: BAY.across + half + mitre },
    { out: 0, across: BAY.across + half + BAY.out + offset * Math.SQRT2 },
  ];
}

/** A rowhome's front as the kit stands it: a point on the drawn facade at the lot's middle, the building's yaw (its front is local +x), its depth (m), its facade style, its storeys and a number that picks the house's accent. */
export type Frontage = { x: number; z: number; yaw: number; depth: number; style: string; storeys: number; variant: number };

/** A pseudo-random number from the lot's place: the same on every peer, whatever the order the places come in. */
function variantOf(x: number, z: number): number {
  return Math.imul(Math.round(x * 8) ^ Math.imul(Math.round(z * 8), 0x9e3779b1), 0x85ebca6b) >>> 0;
}

/** The frontages of the rowhomes among `places`: the caller passes only places inside the walls. */
export function homeFrontages(places: readonly Place[]): Frontage[] {
  const frontages: Frontage[] = [];
  for (const place of places) {
    if (place.kind !== PLACE_KIND.home || place.interior !== "rowhome") continue;
    const face = drawnHalf(place.depth);
    frontages.push({ x: place.x + detCos(place.yaw) * face, z: place.z - detSin(place.yaw) * face, yaw: place.yaw, depth: place.depth, style: place.style, storeys: place.storeys, variant: variantOf(place.x, place.z) });
  }
  return frontages;
}

/** Where one step's tread runs (m out from the facade face) and how high it stands; step 1 is the lowest, the last is the landing. */
export function stoopStepRange(step: number): { near: number; far: number; top: number } {
  const far = step === STOOP.steps ? STOOP.landing : STOOP.run - (step - 1) * STOOP.tread;
  const near = step === STOOP.steps ? 0 : far - STOOP.tread;
  return { near, far, top: STOOP.rise * step };
}

/** A box the course stands as a prop of the invisible wall's prefab: size is [along the building's front direction, height, across]; `stairs` makes it a flight of stairs (`world/stairs.ts`). */
type FacadeSolid = { prefab: typeof PREFAB.invisibleWall; x: number; z: number; yaw: number; size: [number, number, number]; stairs?: true };

/** A box `out` m from the facade face and `across` m (u) from the lot's middle. */
function boxOn(frontage: Frontage, out: number, across: number, size: [number, number, number]): FacadeSolid {
  const cos = detCos(frontage.yaw);
  const sin = detSin(frontage.yaw);
  return { prefab: PREFAB.invisibleWall, x: frontage.x + cos * out + sin * across, z: frontage.z - sin * out + cos * across, yaw: frontage.yaw, size };
}

/** The stoop's ramp stands as high as its highest tread (m). */
const RAMP_TOP = STOOP.rise * (STOOP.steps - 1);

/**
 * Colliders of one rowhome's kit, three boxes: the bay stack from the ground to its roof (one box of the footprint's own area), the stoop's ramp over the four treads and its landing.
 * The ramp is a flight of stairs: four treads of 0.28 m falling from 0.72 m at the landing to 0.18 m at the foot, the visible steps'.
 */
export function facadeSolidsOf(frontage: Frontage): FacadeSolid[] {
  return [
    boxOn(frontage, BAY.out / 2, BAY.across, [BAY.out, bayStackOf(frontage.storeys).top, BAY.width - BAY.out]),
    { ...boxOn(frontage, (STOOP.landing + STOOP.run) / 2, DOOR.across, [STOOP.run - STOOP.landing, RAMP_TOP, STOOP.width]), stairs: true },
    boxOn(frontage, STOOP.landing / 2, DOOR.across, [STOOP.landing, STOOP.sill, STOOP.width]),
  ];
}

/** The kit's colliders for every playable home of the layout. */
export function facadeSolidProps(lots: Lots): FacadeSolid[] {
  return homeFrontages(lots.places.slice(0, lots.backdropStart)).flatMap(facadeSolidsOf);
}
