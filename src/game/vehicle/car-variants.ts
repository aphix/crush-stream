import type { RigOverrides } from "../deform/deform-rig.ts";
import { COUPE } from "./car-styles/coupe.ts";
import { HATCHBACK } from "./car-styles/hatchback.ts";
import { PICKUP } from "./car-styles/pickup.ts";
import { POLICE } from "./car-styles/police.ts";
import { SEDAN } from "./car-styles/sedan.ts";
import { WAGON } from "./car-styles/wagon.ts";

export type CarStyleId = "sedan" | "hatchback" | "wagon" | "coupe" | "pickup" | "police";

/** Spawn order: a 5+ car field shows every fleet style. Police spawn only on request (pursuit, HUD class). */
export const FLEET_STYLE_IDS: readonly CarStyleId[] = ["sedan", "hatchback", "wagon", "coupe", "pickup"];

/** Every body in netplay wire order (a snapshot sends the index): append only. */
export const CAR_STYLE_IDS: readonly CarStyleId[] = [...FLEET_STYLE_IDS, "police"];

/** One side-profile station (car space, +z forward). */
export interface ProfileStation {
  z: number;
  /** Half-width at the shoulder. */
  hw: number;
  /** Deck / beltline height. */
  yBelt: number;
  /** Roof height where `cabin` is 1. */
  yRoof: number;
  /** Roof half-width. */
  cabinHw: number;
  /** 0 = no greenhouse, 1 = full roof. */
  cabin: number;
}

/** [y, z] in car space. */
export type YZ = readonly [number, number];

export interface GlassQuad {
  base: YZ;
  top: YZ;
  wBase: number;
  wTop: number;
}

type BootSpec =
  /** Deck lid lofted on the profile from z0 to z1, hinged at origin. */
  | { kind: "lid"; z0: number; z1: number; origin: YZ }
  /** Vertical tail panel (hatch / tailgate) from y0 up to origin, hinged at its top edge. */
  | { kind: "tailgate"; y0: number; origin: YZ };

/** Paint a style fixes whatever the fleet paint (police black-and-white). */
interface Livery {
  body: number;
  doors: number;
  accent: number;
}

export interface BodyStyle {
  id: CarStyleId;
  /** Stations rear → front; z ≥ 0.82 is the shared front clip. */
  profile: readonly ProfileStation[];
  /** Roof panel [rear, front] z. */
  roofZ: readonly [number, number];
  windshieldTop: YZ;
  rearGlass: GlassQuad;
  /** Side glass behind the B-pillar: rear edge z at the belt and at the top. */
  quarter: { zRearBot: number; zRearTop: number };
  /** Extra pillar splitting the quarter glass (wagon C-pillar), or null. */
  midPillarZ: number | null;
  rearBulkhead: { z: number; yTop: number };
  /** Open floors visible through the glass: [zRear, zFront, floorY]. */
  tubs: readonly (readonly [number, number, number])[];
  /** Rear door shut line on four-door bodies, or null. */
  rearDoorSeam: number | null;
  boot: BootSpec;
  /**
   * Lamp seats [x, y] (m, right side; the left mirrors it) on the end panels: the head lamps on the nose, the tail lamps
   * on the tail panel, standing upright in its corners beside a tailgate. Each housing sits whole on the skin, clear of
   * the bumpers, grille and boot (`lamps.test.ts`).
   */
  lamps: { head: readonly [number, number]; tail: readonly [number, number] };
  rig: RigOverrides;
  /** Fixed paint, or none (the fleet paint). */
  livery?: Livery;
  /** Roof light bar with red / blue sirens (`DeformableCar.setSirens`). */
  lightBar?: boolean;
}

export const CAR_STYLES: Readonly<Record<CarStyleId, BodyStyle>> = {
  sedan: SEDAN,
  hatchback: HATCHBACK,
  wagon: WAGON,
  coupe: COUPE,
  pickup: PICKUP,
  police: POLICE,
};
