import type { RigOverrides } from "../deform/deform-rig.ts";
import { COUPE } from "./car-styles/coupe.ts";
import { HATCHBACK } from "./car-styles/hatchback.ts";
import { MONSTER } from "./car-styles/monster.ts";
import { PICKUP } from "./car-styles/pickup.ts";
import { POLICE } from "./car-styles/police.ts";
import { SEDAN } from "./car-styles/sedan.ts";
import { WAGON } from "./car-styles/wagon.ts";

export type CarStyleId = "sedan" | "hatchback" | "wagon" | "coupe" | "pickup" | "police" | "monster";

/** Spawn order: a 5+ car field shows every fleet style. Police spawn only on request (pursuit, HUD class). */
export const FLEET_STYLE_IDS: readonly CarStyleId[] = ["sedan", "hatchback", "wagon", "coupe", "pickup"];

/** Every body in netplay wire order (a snapshot sends the index): append only. */
export const CAR_STYLE_IDS: readonly CarStyleId[] = [...FLEET_STYLE_IDS, "police", "monster"];

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
  /** Tail panel (hatch / tailgate) from its bottom edge [y0, z0] up to origin, hinged at its top edge; z0 defaults to origin's z (upright). */
  | { kind: "tailgate"; y0: number; origin: YZ; z0?: number };

/** Paint a style fixes whatever the fleet paint (police black-and-white). */
interface Livery {
  body: number;
  doors: number;
  accent: number;
}

/** A car's spec dimensions (m) in car space: origin on the ground midway between the axles, +z forward. Length = overhangs + wheelbase. */
interface CarDims {
  wheelbase: number;
  /** Axle to bumper face. */
  overhang: { front: number; rear: number };
  /** Wheel centre to wheel centre. */
  track: number;
  /** Widest body, mirrors off. */
  width: number;
  /** Ground to roof crown at rest, light bar off. */
  height: number;
  /** Ground to floor pan, class lift off. */
  rideHeight: number;
  /** Tyre, before the class's wheelScale. */
  wheel: { radius: number; width: number };
}

/** A bumper: where its group sits and the section its fascia is lofted from. */
interface BumperSpec {
  /** Group seat (m): its height, and its distance from the car's middle. */
  seat: { y: number; z: number };
  /** Fascia section about the seat, top to bottom: [y, out] (m). */
  fascia: readonly (readonly [number, number])[];
  /** Half-width (m) of the fascia across the car. */
  span: number;
  /** Fascia corner sweep: `from` the |x| (m) where it starts sweeping back, `back` how far (m) its end sweeps back from the face. */
  wrap: { from: number; back: number };
}

type DetailView = "side" | "top" | "front" | "rear";

/** A stroke drawn on one view of the car, cut into (depth < 0) or raised from (depth > 0) the surface. */
interface DetailLine {
  /** "side": points [z, y], both sides of the car. "top": [z, x]. "front" / "rear": [x, y]. x >= 0 only: mirrored to -x. */
  view: DetailView;
  /** Polyline (m, car frame, ground y = 0 before class lift, origin mid-axles, +z forward), at least 2 points. */
  points: readonly (readonly [number, number])[];
  /** Loop back to the first point (lamp outline, fuel flap, vent rim). Default false. */
  closed?: boolean;
  /** Full width across the stroke (m); >= 0.006 (thinner aliases away). */
  width: number;
  /** Peak height (m), |depth| <= 0.006: negative = groove (shut line ~ -0.004), positive = raised (bead, seal ~ 0.002). */
  depth: number;
  /** Section: "v" sharp groove, "u" rounded (crease, bead), "step" character line: the LEFT side walking along the points stands `depth` proud of the right, ramped over `width`. */
  profile: "v" | "u" | "step";
  /** 0..1 darkening at the centre: panel gap ~0.85, deep vent slot ~0.7, crease 0. */
  cavity: number;
}

/** A filled patch: vent, grille infill, lamp internals, badge plate. */
interface DetailPatch {
  view: DetailView;
  /** Closed polygon (m, the view's axes as above), x >= 0 only, mirrored. */
  points: readonly (readonly [number, number])[];
  /** The patch floor's height (m) against the surface around it (negative = recessed), ramped over `rim` (m) at its edge. */
  depth: number;
  rim: number;
  /** Repeated relief inside: hslats = horizontal bars, vslats = vertical bars, hex mesh, dots; bar width and depth (m). */
  pattern?: { kind: "hslats" | "vslats" | "hex" | "dots"; pitch: number; bar: number; depth: number };
  /** 0..1 darkening of the patch floor (open grille ~0.8, blind vent ~0.4). */
  cavity: number;
}

export interface BodyStyle {
  id: CarStyleId;
  /** What the reference was measured to; the tables below are built to it (`car-variants.test.ts`). */
  dims: CarDims;
  /** Stations rear → front; z ≥ 0.82 is the shared front clip. */
  profile: readonly ProfileStation[];
  /** Roof panel [rear, front] z. */
  roofZ: readonly [number, number];
  /** Windshield: base [y, z] of its centre line and its widths at the base and the top (`windshieldTop`). */
  windshield: { base: YZ; wBase: number; wTop: number };
  windshieldTop: YZ;
  /** B-pillar z band. */
  bPillar: { rear: number; front: number };
  /** Side glass sill: its half-width (one value, or [z, x] stations where the sill narrows toward a tail), and its height as [z, y] stations; stations ascend in z, linear between, held past the ends. */
  belt: { x: number | readonly (readonly [number, number])[]; y: readonly (readonly [number, number])[] };
  /** The body side's lowest line (m); under it the sill turns in to the floor pan at `dims.rideHeight`. */
  rocker: { y: number };
  /** Floor pan height as [z, y] stations in ascending z (linear between, held past the ends); absent = flat at `dims.rideHeight`. The rocker rides up with it. */
  underside?: readonly (readonly [number, number])[];
  /** Front door: hinge axis at the A-pillar (±hingeX, hingeY, hingeZ), `length` hinge to trailing edge, skin ±halfHeight about the hinge, `aperture` [z0, z1] the body's front-door cut (the skin overlaps it 0.02 each end), mirror seated `mirrorY` over the hinge and `mirrorZ` (default 0) behind it, reaching `mirrorReach` out, ±mirrorHalfDepth deep. */
  door: { hingeX: number; hingeY: number; hingeZ: number; length: number; halfHeight: number; mirrorY: number; mirrorZ?: number; mirrorReach: number; mirrorHalfDepth: number; aperture: readonly [number, number] };
  /** Where the A-pillar's foot meets the belt (z, m): the door glass's front edge starts there. */
  aPillarFoot: number;
  /** Wheel-arch opening radius (m) about each hub. */
  arch: { radius: number };
  /** Bonnet lid lofted on the profile from z0 (cowl) to z1 (nose), hinged at origin. */
  hood: { z0: number; z1: number; origin: YZ };
  bumpers: { front: BumperSpec; rear: BumperSpec };
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
  /** Push bar in front of the front bumper, drawn in its trim (`withPushBar`). */
  pushBar?: boolean;
  /** Fine contours drawn as detail maps, not geometry: strokes and patches on the side, top, front and rear views, car-frame metres, x >= 0 mirrored. */
  details?: { lines: readonly DetailLine[]; patches: readonly DetailPatch[] };
}

export const CAR_STYLES: Readonly<Record<CarStyleId, BodyStyle>> = {
  sedan: SEDAN,
  hatchback: HATCHBACK,
  wagon: WAGON,
  coupe: COUPE,
  pickup: PICKUP,
  police: POLICE,
  monster: MONSTER,
};
