import type { LidSwing } from "./hinge-spec.ts";
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

/** A raked pane's plan bow (m, along z, + forward): how far its centre line stands off its edges' line at the base and at the top. */
export interface GlassBow {
  base: number;
  top: number;
}

/** A raked pane: its edges' base and top [y, z] and widths; `bow` its centre line's plan bow (default `REAR_GLASS_BOW`). */
export interface GlassQuad {
  base: YZ;
  top: YZ;
  wBase: number;
  wTop: number;
  bow?: GlassBow;
}

/** A deck lid that wraps the tail: below the deck it folds over the tail edge and runs down the rear face to `y`, `w` its half-width there (m); `z` the face's bottom edge, leaning it like a tailgate's `z0` (default `z1`, upright). */
export interface LidDrop {
  y: number;
  w: number;
  z?: number;
}

/** Ducktail kick on a boot's free edge (a deck lid's rear edge, a tailgate's top edge): it rises `rise` (m) outward at the edge, easing to the panel over `depth` (m). */
export interface BootLip {
  rise: number;
  depth: number;
}

/** The panel's shape; `pivot` is where it turns (default `origin`): a hatch's or liftgate's roof hinge, a drop gate's bottom edge. `swing`: its latch, struts and limits (default by kind, `hinge-spec.ts`). */
export type BootSpec = (
  /**
   * Deck lid lofted on the profile from z0 to z1, hinged at origin; with `drop` it wraps the tail, its face standing at z1. `crown` [drop, at]
   * (m, drawn only): its top domes as a parabola across x, `drop` under its centre line at |x| `at`, its edge (the shut line) kept.
   */
  | { kind: "lid"; z0: number; z1: number; origin: YZ; drop?: LidDrop; crown?: readonly [drop: number, at: number] }
  /**
   * Tail panel (hatch / tailgate) from its bottom edge [y0, z0] up to origin, its top edge; z0 defaults to origin's z (upright). `outline`:
   * its edge, the reference's gate seam, as [x, y] on the right side from top to bottom (held past its ends); absent, the tail panel's
   * half-width less the corners the lamps stand in.
   */
  | { kind: "tailgate"; y0: number; origin: YZ; z0?: number; outline?: readonly (readonly [number, number])[] }
) & {
  lip?: BootLip;
  pivot?: YZ;
  swing?: LidSwing;
  /** A drawn lid seated on the deck like the hood (its edge a groove over the deck edge, not a step up off it). Drawn only: the cage keeps the plain lid. */
  flush?: boolean;
  /** Drawn only: the lid's or gate's side edges round over this radius (m) into its skirt or thickness, as the reference's; absent, a sharp corner. */
  edgeRoll?: number;
};

/** Raised centre bulge on the drawn hood from z `z0` (cowl end) to `z1`, `width` (m) across, its top `rise` (m) over the lid's; it ramps into the lid at both ends. */
interface HoodBulge {
  z0: number;
  z1: number;
  width: number;
  rise: number;
  /** Scoop on the bulge rising from its cowl end to a mouth facing forward at z `z`, `width` across, `height` (m) over the bulge: one opening, or two either side of a centre rib. */
  scoop?: { inlets: 1 | 2; z: number; width: number; height: number };
}

/** Drawn roof parts, z spans as [rear, front] (m, car frame). */
interface RoofParts {
  /** Two black rails, |x| from `x[0]` to `x[1]`, their tops `rise` (m) over the roof skin, sloping into it at both ends. */
  rails?: { x: readonly [number, number]; z: readonly [number, number]; rise: number };
  /** Body-colour lip off the roof's rear end, ±`halfWidth`: its underside at y `y[0]`, its top `y[1]` at the front edge falling to the tip. */
  spoiler?: { z: readonly [number, number]; y: readonly [number, number]; halfWidth: number };
  /** Dark glass panel over the front seats, `width` (m) across, standing just proud of the roof skin. */
  glassPanel?: { z: readonly [number, number]; width: number };
}

/** A lamp point (m, car frame, right side; the left mirrors it): [x, y] met on the lamp's end face from outside (or, in a `side` loop, [z, y] met on the body side from outboard), or [x, y, z] on the skin as given. */
type LampPoint = readonly [number, number] | readonly [number, number, number];
/** Points round a closed outline (or along a strip's line) on the skin; `side`: side-view [z, y] points, a wrap round the corner. */
interface LampLoop {
  side?: boolean;
  points: readonly LampPoint[];
}
/** A lens tone: `lit` the kind's lit lens (head white, tail red); the rest never glow. */
type LampTone = "lit" | "clear" | "red" | "amber" | "smoked" | "dark" | "chrome";

/**
 * A lamp drawn to its outline (drawn only), met on the skin: its lens filling `loops` (a wrap round the corner is another loop) a few mm
 * proud of it, in `lens`; a `bezel` lip round each loop cresting `recess` (m) over the lens, so the lens sits in its own pocket and no face
 * lies on the skin's; `cells` (sections, a reverse or smoked cell, a band) over the lens in their own tones; `strips` (a DRL or LED line,
 * ribs) along open lines `width` wide; `rounds` (projector cells, fog lenses) of radius `r`.
 */
interface LampShape {
  loops: readonly LampLoop[];
  lens: LampTone;
  bezel?: "chrome" | "black";
  recess?: number;
  cells?: readonly { loop: LampLoop; tone: LampTone }[];
  strips?: readonly { line: LampLoop; width: number; tone: LampTone }[];
  rounds?: readonly { at: LampPoint; side?: boolean; r: number; tone: LampTone }[];
}

/** Exhaust tips under the rear bumper: one at `x`, or two at ±`x`, centred at height `y`; `size` [w, h] (m) of the round (oval) or rectangular tip. */
interface Exhaust {
  tips: 1 | 2;
  x: number;
  y: number;
  size: readonly [number, number];
  shape: "round" | "rect";
}

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

/** A bumper's lofted end (m): how far back its corner turns, and how far its face stands off the body side along the run. */
export type BumperEnd = { corner: number; stand: number };

/** A bumper: where its group sits and the section its fascia is lofted from. */
interface BumperSpec {
  /** Group seat (m): its height, and its distance from the car's middle. */
  seat: { y: number; z: number };
  /** Fascia section about the seat, top to bottom: [y, out] (m). */
  fascia: readonly (readonly [number, number])[];
  /** Half-width (m) of the fascia across the car. */
  span: number;
  /**
   * Fascia corner sweep: `from` the |x| (m) where it starts sweeping back, `back` how far (m) its end sweeps back from the face.
   * `end` (drawn only): a lofted end instead, its corner turning over `corner` (m) back from the face, then running along the body side to `back`, its face `stand` (m) off the skin.
   */
  wrap: { from: number; back: number; end?: BumperEnd };
  /** What the bumper is drawn in: the body's paint colour, chrome or black; absent, the car's accent trim. */
  trim?: "body" | "chrome" | "black";
  /**
   * Its seam (drawn only, both or neither): the bumper wraps its corner up to it as the visible skin (`withSeamCover`) and tears off with it.
   * `top` its top edge on the end face, [x, y] from inboard out to the corner; `edge` on round the corner and down the side, [z, y], to its foot.
   */
  top?: readonly (readonly [number, number])[];
  edge?: readonly (readonly [number, number])[];
  /** A rear bumper's number plate centre height (m, car frame); absent, `PLATE_RISE` over the seat. */
  plate?: number;
}

type DetailView = "side" | "top" | "front" | "rear" | "bottom";

/** A stroke drawn on one view of the car, cut into (depth < 0) or raised from (depth > 0) the surface. */
interface DetailLine {
  /** "side": points [z, y], both sides of the car. "top" / "bottom" (seen from below): [z, x]. "front" / "rear": [x, y]. x >= 0 only: mirrored to -x. */
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

/**
 * A wheel arch's drawn lip: it stands `flare` (m) proud of the body side at the opening's edge, rolls into the well there and fairs into
 * the skin `width` (m) out; `square` squares its outline and face (a box flare), `band` gives the round outline that stepped face (a raised flare band).
 */
interface ArchLip {
  flare: number;
  width: number;
  square?: boolean;
  band?: boolean;
}

/** A chase eye: `dist` behind and `height` over the car's origin, aimed `aimUp` over it (m). */
interface ChaseEye {
  dist: number;
  height: number;
  aimUp: number;
}

/** A drawn pillar's side-view band: `width` [belt, top] (z, m) about its centre line at `z` [belt, top]; absent `z`, upright on its style's mark. */
export interface PillarSpan {
  width: readonly [number, number];
  z?: readonly [number, number];
}

export interface BodyStyle {
  id: CarStyleId;
  /** What the reference was measured to; the tables below are built to it (`car-variants.test.ts`). */
  dims: CarDims;
  /** Stations rear → front; z ≥ 0.82 is the shared front clip. */
  profile: readonly ProfileStation[];
  /** Roof panel [rear, front] z. */
  roofZ: readonly [number, number];
  /**
   * Drawn only: over this run (m) in from each end the drawn roof rolls onto that end's glass top in a quarter ellipse, its crown
   * settling to the glass top's height and its whole section dropping where the glass top sits under the dome's edge (`roofDome`);
   * unset, the roof ends in its full section.
   */
  roofEnds?: { rear?: number; front?: number };
  /** Windshield: base [y, z] of its edges' line, its widths at the base and the top (`windshieldTop`), its centre line's plan bow (default `WINDSHIELD_BOW`). */
  windshield: { base: YZ; wBase: number; wTop: number; bow?: GlassBow };
  windshieldTop: YZ;
  /** B-pillar z band. */
  bPillar: { rear: number; front: number };
  /** Side glass sill: its half-width (one value, or [z, x] stations where the sill narrows toward a tail), and its height as [z, y] stations; stations ascend in z, linear between, held past the ends. */
  belt: { x: number | readonly (readonly [number, number])[]; y: readonly (readonly [number, number])[] };
  /** The body side's lowest line (m); under it the sill turns in to the floor pan at `dims.rideHeight`. */
  rocker: { y: number };
  /** Floor pan height as [z, y] stations in ascending z (linear between, held past the ends); absent = flat at `dims.rideHeight`. The rocker rides up with it. */
  underside?: readonly (readonly [number, number])[];
  /**
   * Front door: hinge axis at the A-pillar (±hingeX, hingeY, hingeZ), `length` hinge to trailing edge, skin ±halfHeight about the hinge, `aperture` [z0, z1] the body's front-door cut (the skin overlaps it 0.02 each end), mirror seated `mirrorY` over the hinge and `mirrorZ` (default 0) behind it, reaching `mirrorReach` out, ±mirrorHalfDepth deep.
   * `mirror` (drawn only): its own mirror, `cap` rounded or box of `size` [w out, h, d along z] (default `MIRROR_CAP_SIZE`) in `finish` (body: the door's paint), its outer face at `mirrorReach`, its foot on the skin; absent = the platform mirror x-scaled to the reach.
   * `hingeTop` (car y, m, drawn only): the skin's top edge at its hinge cut, its rows closing down to it over the hinge end's slope so the top meets the fender's deck edge there; absent = only the slope.
   */
  door: {
    hingeX: number;
    hingeY: number;
    hingeZ: number;
    length: number;
    halfHeight: number;
    mirrorY: number;
    mirrorZ?: number;
    mirrorReach: number;
    mirrorHalfDepth: number;
    aperture: readonly [number, number];
    mirror?: { cap: "rounded" | "box"; finish: "body" | "black" | "chrome"; size?: readonly [number, number, number] };
    hingeTop?: number;
  };
  /** Where the A-pillar's foot meets the belt (z, m): the door glass's front edge starts there. */
  aPillarFoot: number;
  /** Where the A-pillar's rear edge meets the cant line (z, m): the door glass's top-front corner; absent = 5 cm behind the windshield's top. */
  aPillarTop?: number;
  /** Where the door glass's front edge, rising from `aPillarFoot`, meets the A-post's rear edge (y, m); over it the edge runs in under the post to `aPillarTop`, under it the sail is a small triangle. Absent: one straight edge, the sail filling any gap to the post. */
  aPillarKnee?: number;
  /** Side glass top: its drop under the roof (m, absent 0.075), the roof's side lip ending there too; or [z, y] stations (ascending, linear, held past the ends) under a 0.075 lip, painted fill between them and the lip. */
  glassTop?: number | readonly (readonly [number, number])[];
  /** Wheel-arch opening radius (m) about each hub; `lip` its drawn flare lip (drawn only: the cage keeps the bare opening); `wellWall` (drawn only) the |x| (m) of an outboard tyre's well wall, the liner widened inboard to it. */
  arch: { radius: number; lip?: ArchLip; wellWall?: number };
  /**
   * Bonnet lid lofted on the profile from z0 (cowl) to z1 (nose), hinged at origin. A `clamshell` lid (drawn only) wraps over the fender tops, its side shut line on the shoulder; `bulge` stands on it; `crown` [drop, at] (m, drawn only) domes its top as a parabola across x, `drop` under its centre line at |x| `at`.
   * `groove` [out, down] (m, drawn only): over the open bay the fender's deck edge beside a lid hood stands `out` outboard of the hood's edge and `down` lower, a shut-line slot onto the bay wall.
   */
  hood: { z0: number; z1: number; origin: YZ; kind?: "lid" | "clamshell"; bulge?: HoodBulge; crown?: readonly [drop: number, at: number]; groove?: readonly [out: number, down: number] };
  /** The rear bumper may carry a tow-hitch receiver under its middle (`hitch`). */
  bumpers: { front: BumperSpec; rear: BumperSpec & { hitch?: boolean } };
  rearGlass: GlassQuad;
  /** Side glass behind the B-pillar: rear edge z at the belt and at the top. */
  quarter: { zRearBot: number; zRearTop: number };
  /** Extra pillar splitting the quarter glass (wagon C-pillar), or null. */
  midPillarZ: number | null;
  /**
   * Drawn only: side-view pillar bands (`PillarSpan`). `b`: the B-pillar, centred on its `bPillar` band unless it leans, the side
   * panes tucked under it. `divider`: the post at `midPillarZ`. Absent: the `bPillar` band (its top 3 cm narrower); a divider
   * 0.08 / 0.07 wide, upright at `midPillarZ`.
   */
  pillars?: { b?: PillarSpan; divider?: PillarSpan };
  /** Drawn only: parts in gloss black (the paint's primer-dark tone, no draw of their own): the A-post, its sail, the B-pillar, the divider, the rear pillar, and the cowl (the deck between the hood's rear edge and the windshield's foot). */
  blackout?: { a?: boolean; sail?: boolean; b?: boolean; divider?: boolean; rear?: boolean; cowl?: boolean };
  /**
   * Drawn only: the C-pillar as a sail lofted from the haunch's shoulder, tangent to it, up to the rear glass and the roof, its front on
   * the side window's line; absent, a flat post. `tip` ([y, z]): where that line ends at the belt behind the quarter glass, the gloss-black
   * triangle between them filling the gap; absent, the line is the quarter glass's own rear edge.
   */
  cPillar?: { tip?: YZ };
  /** Dark-tinted panes (drawn only): the rear glass and the side panes behind the B-pillar, as the reference's privacy glass. */
  privacyGlass?: { rear?: boolean; quarter?: boolean };
  /** Chrome bead round every glass pane's border (drawn only): the door glass's rides its door, the rest the body. */
  windowTrim?: "chrome";
  /** Chrome strips on the body side (drawn only, with `windowTrim`): side-view polylines [z, y] (m), `width` (m) tall, on the skin's +x and -x. A strip whose points all lie inside the door aperture rides the door; any other rides the body. */
  chromeStrips?: readonly { points: readonly (readonly [number, number])[]; width: number }[];
  rearBulkhead: { z: number; yTop: number };
  /** Open floors visible through the glass: [zRear, zFront, floorY]. */
  tubs: readonly (readonly [number, number, number])[];
  /** The engine bay trough's floor (m, car y) under the hood (`bayTub`); absent, 0.28. A lifted body whose floor pan stands over that at the bay (the trucks) sets its pan height, so the trough the paint row and the bay set read is the one drawn. */
  bayFloor?: number;
  /** A bed's wheel tubs (both builds): over each wheel whose liner stands in a tub floor, a half cylinder `rise` (m) over the floor and `length` along the car, `width` in from the bed's side wall; absent, a drawn-only hump hugs the liner. */
  wheelTub?: { rise: number; length: number; width: number };
  /** A tub's rim width (m): its side wall's top edge stands this far in from the body side (its foot stays 6 cm in); absent, 6 cm. */
  tubWall?: number;
  /** Rear door shut line on four-door bodies, or null. */
  rearDoorSeam: number | null;
  boot: BootSpec;
  /**
   * Lamp seats [x, y] (m, right side; the left mirrors it) on the end panels: the head lamps on the nose, the tail lamps
   * on the tail panel, standing upright in its corners beside a tailgate. `shapes` (drawn only): `head` / `tail` each kind's own lamp
   * riding its seat (a tail's share that lands on the boot lid rides the lid, lit with the tails); `front` / `rear` lamps, reflectors and
   * pods on that bumper's fascia (unlit, torn off with it). Absent, the platform housing (`LAMP_HOUSING`, standing 4.5 cm proud).
   * `brake`: a high-mount brake lamp `size` [w, h] met on the skin from behind at [x, y] (a pickup's cab); `sideMarkers`: amber markers
   * on each side met from outboard at [y, z]. Brake lamp and markers are drawn only, lit (brake) with the tails, never broken.
   */
  lamps: {
    head: readonly [number, number];
    tail: readonly [number, number];
    shapes?: { head?: LampShape; tail?: LampShape; front?: LampShape; rear?: LampShape };
    brake?: { at: readonly [number, number]; size: readonly [number, number] };
    sideMarkers?: readonly { at: readonly [number, number]; size: readonly [number, number] }[];
  };
  /**
   * The front grille (drawn only; it tears off with the front bumper): centre height `y` and face `z` (m, car frame; z absent: the platform
   * grille's face); `size` [w at the top, h], `bottom` its width at the bottom (a trapezoid; absent, w), corners rounded `round` (m); `kind`
   * horizontal bars, vertical slats, a mesh of both or a diagonal (hex) mesh, `count` bars or slats (absent, at the default pitch); a round
   * `badge` of that radius at its centre; in `finish` (body: the body's paint). Absent: the platform grille.
   */
  grille?: {
    y: number;
    z?: number;
    size: readonly [number, number];
    bottom?: number;
    round?: number;
    kind: "bars" | "mesh" | "slats" | "hex";
    count?: number;
    badge?: number;
    finish: "black" | "chrome" | "body";
  };
  /**
   * Seats (m, car space): the driver's H-point [x, y, z], x across from the centre line on `DRIVER_SIDE` (the passenger mirrors him),
   * and the rear bench's [y, z] on the centre line, or null with no rear row (a regular cab). The drawn seats, the seated driver and the sim's seat all read it.
   */
  seats: { front: readonly [number, number, number]; rear: readonly [number, number] | null };
  /** Fixed paint, or none (the fleet paint). */
  livery?: Livery;
  /** Roof light bar with red / blue sirens (`DeformableCar.setSirens`). */
  lightBar?: boolean;
  /** Push bar in front of the front bumper, drawn in its trim (`withPushBar`). */
  pushBar?: boolean;
  /** Roof rails, spoiler lip and glass panel, drawn on the roof and crushed with it. */
  roof?: RoofParts;
  /** Exhaust tips, drawn in the rear bumper (they tear off with it). */
  exhaust?: Exhaust;
  /** The lifted truck's undercarriage under the body (`hangUnderbody`): ladder frame, coil-over pairs, driveshafts and steering on the body, a solid axle on each pair of hubs. Drawn only, for the monster's lift. */
  underbody?: boolean;
  /** Fine contours drawn as detail maps, not geometry: strokes and patches on the side, top, front and rear views, car-frame metres, x >= 0 mirrored. */
  details?: { lines: readonly DetailLine[]; patches: readonly DetailPatch[] };
  /** Cameras (m, car frame as drawn, a class lift included): the hood eye [y, z] over the bonnet ahead of the windshield base, and the chase and far chase eyes `dist` behind and `height` over the car's origin, aimed `aimUp` over it; absent = `PLATFORM_CAMERA`. */
  camera?: { hood: YZ; third: ChaseEye; far: ChaseEye };
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
