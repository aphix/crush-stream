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
  /** Drawn only (the rear glass): the clear pane drawn in by [side, bottom, top] (m; sides across, bottom and top along its slope), the band out to the outline the glass's black frit. */
  frame?: readonly [number, number, number];
  /**
   * Drawn only (an unframed rear glass): the clear pane's corners rounded to this radius (m), the chrome bead round them with it; the glass's
   * black frit fills out to the square outline, unless `roundOutline` rounds the glass's own outline too: the frit corners stand 1 cm in
   * behind it, a dark backing seen only through the gaps round the arcs, and the body shows up to the bead.
   */
  round?: number;
  roundOutline?: boolean;
}

/** A deck lid that wraps the tail: below the deck it folds over the tail edge and runs down the rear face to `y`, `w` its half-width there (m); `z` the face's bottom edge, leaning it like a tailgate's `z0` (default `z1`, upright). */
export interface LidDrop {
  y: number;
  w: number;
  z?: number;
}

/** Drawn only: a hood that wraps the nose, folding over it on a `radius` (m) bend and running `drop` (m) down its face from its edge, onto the grille's top. */
export type HoodNose = readonly [drop: number, radius: number];

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
   * `halfWidth` (m, drawn only, `flush` lids only): |x| of the lid's side edge, held under the profile's own (half-width less 7 cm); the body's
   * boot hollow narrows with it, its rim 1 cm outboard of the edge at the deck edge's height (a cap past the deck edge leaves it on the deck edge), so the quarter top outboard of the groove stands
   * 3 mm under the lid's edge, as the fender beside the hood does. Absent, the lid runs to the deck edge.
   */
  | { kind: "lid"; z0: number; z1: number; origin: YZ; drop?: LidDrop; crown?: readonly [drop: number, at: number]; halfWidth?: number }
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
  /** Drawn only, a roof-hinged gate: the share (0..1, exclusive) of each D-post's width, at its foot and at its head, from its rear-glass edge toward the quarter glass, that rides the gate beside its glass; the body keeps the rest. Absent, the whole post is the body's. */
  postShare?: readonly [foot: number, head: number];
};

/** Raised centre bulge on the drawn hood from z `z0` (cowl end) to `z1`, `width` (m) across, its top `rise` (m) over the lid's; it ramps into the lid at both ends. */
interface HoodBulge {
  z0: number;
  z1: number;
  width: number;
  rise: number;
  /** Rolled pod (m): each flank rolls from the lid up to the crest over this width in an S-curve (level at both ends) instead of the 5 cm chamfer; the crest spans ±(width/2 - round). The scoop stands on the crest: scoop.width/2 <= width/2 - round. */
  round?: number;
  /** Its cowl end (z0) eases into the lid over this run (m) instead of the front end's 0.15, so a long pod fades toward the windshield; absent = 0.15. */
  cowlRamp?: number;
  /** Its width (m) at the cowl end (z0), narrowing linearly to `width` at z1, for a pod that widens toward the windshield; absent = `width` throughout. */
  cowlWidth?: number;
  /** A twin pod: a V groove this deep (m), 6 mm wide, down the crest's centre line, in line with a twin scoop's rib; absent none. */
  groove?: number;
  /** Its nose end an intake's face: the pod stands at full rise to z1 and ends square, its front cap facing forward for `details` to draw the mouths on, instead of easing into the lid over 0.15. */
  mouth?: boolean;
  /** Scoop on the bulge rising from its cowl end to a mouth facing forward at z `z`, `width` across, `height` (m) over the bulge: one opening, or two either side of a centre rib. */
  scoop?: { inlets: 1 | 2; z: number; width: number; height: number };
}

/** Drawn roof parts, z spans as [rear, front] (m, car frame). */
interface RoofParts {
  /** Two black rails, |x| from `x[0]` to `x[1]`, their tops `rise` (m) over the roof skin, sloping into it at both ends. */
  rails?: { x: readonly [number, number]; z: readonly [number, number]; rise: number };
  /**
   * Body-colour lip off the roof's rear end, ±`halfWidth`: its underside at y `y[0]`, its top `y[1]` at the front edge falling to the tip.
   * `ends` [slope, taper] (m): the top's side ends stand `slope` inboard of the underside's, and the tip's ends `taper` inboard of the front edge's.
   * `round`: the tip's corners turn on a quarter ellipse in plan (`taper` across, the whole z run along) instead of the straight chamfer.
   * `crown` (m): the top's middle stands this much over its sloped ends' tops (a parabola across, carrying the roof's crown over it); absent, level.
   * `bow` (m): the front edge bows back in plan, its middle this far behind its ends on a parabola across (as a rear glass top's plan bow), easing to none at the tip; absent, straight.
   * `gate` (m, a roof-hinged gate): z of the shut line across the spoiler; the share behind it (toward the tip) rides the gate, the share ahead stays on the roof; absent, all on the roof.
   * `lip` (m, with `gate`): a flange on the gate's share hanging over the rear glass's top edge: a box `drop` under the underside and `depth` behind the shut line, ±`halfWidth` across; absent, none.
   */
  spoiler?: { z: readonly [number, number]; y: readonly [number, number]; halfWidth: number; ends?: readonly [number, number]; round?: boolean; crown?: number; bow?: number; gate?: number; lip?: { drop: number; depth: number; halfWidth: number } };
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
/** A lens tone: `lit` the kind's lit lens (head white, tail red); `black` the trim's matte black plastic (a valance or diffuser band); `cavity` the grille
 *  backing's matte near-black (an open intake reading as a hole, not a gloss panel mirroring the road); the rest never glow. */
type LampTone = "lit" | "clear" | "red" | "amber" | "smoked" | "dark" | "black" | "chrome" | "cavity";

/**
 * A lamp drawn to its outline (drawn only), met on the skin: its lens filling `loops` (a wrap round the corner is another loop) a few mm
 * proud of it, in `lens`; a `bezel` lip round each loop cresting `recess` (m) over the lens, so the lens sits in its own pocket and no face
 * lies on the skin's; `cells` (sections, a reverse or smoked cell, a band) over the lens in their own tones; `strips` (a DRL or LED line,
 * ribs) along open lines `width` wide; `rounds` (projector cells, fog lenses) of radius `r`. `onBody`: a bumper lamp met on the body's
 * skin too, the nearer one winning, where the nose or tail corner stands proud of the fascia (the fascia alone hides it there).
 */
interface LampShape {
  loops: readonly LampLoop[];
  lens: LampTone;
  bezel?: "chrome" | "black";
  recess?: number;
  cells?: readonly { loop: LampLoop; tone: LampTone }[];
  strips?: readonly { line: LampLoop; width: number; tone: LampTone }[];
  rounds?: readonly { at: LampPoint; side?: boolean; r: number; tone: LampTone }[];
  /** Bumper lamps only: also met on the body skin, the outermost hit winning, where a wrapped fascia corner is held inside the body. */
  onBody?: boolean;
  /** The lens and cells' longest fill edge (m) before it is split onto the skin: shorter where a lens wraps a corner tighter than its chords. */
  fill?: number;
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
  /** A rear plate's seating (drawn only): its rear face `out` (m, as `fascia`'s) behind the seat and its `color` (sRGB); absent, the platform plate's (0.09, cream). */
  plateFace?: { out?: number; color?: number };
  /** Drawn only: the fascia rows whose height (m, car y) lies in [bottom, top] carry a black inlay just proud of the face (a rear diffuser band, a truck's front valance). */
  band?: readonly [bottom: number, top: number];
  /** With `band` on a lofted-end bumper (`wrap.end`): the inlay stops at the last ring whose face point stands within this |x| (m), so the corners stay body colour; absent, it runs the bumper's whole width. */
  bandHalfWidth?: number;
  /** A rear bumper drawn without the platform plate (its reference shows none): its tail trim is its rear bumper lamps alone. */
  plateless?: boolean;
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
  /** The whole lip stands this far (m) in from the opening's edge, over it, so the opening reads smaller than the arch it covers (drawn only). */
  inset?: number;
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

/** Drawn only: the windshield, the door glass's front edge and the roof's ends as the player sees them (`BodyStyle.drawn`, `drawnStyle`). */
export type DrawnTwin = Partial<Pick<BodyStyle, "windshield" | "windshieldTop" | "aPillarFoot" | "aPillarTop" | "aPillarKnee" | "aPillarSailGlass" | "roofEnds">>;

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
   * unset, the roof ends in its full section. `flush` (0..1 per end, absent 0): the share of the side lip's reach past the dome's
   * edge that end tucks in at the end itself, fading out over its run, so a boxy cab's roof corners sit flush over its posts. `glassBow`
   * (per end): that end bows in plan with its glass top's whole bow, not only past the default bow, so a roof rolled level onto its glass
   * top meets it with no slit between them. Set or not, the front end never stands behind the windshield's top row in plan.
   */
  roofEnds?: { rear?: number; front?: number; flush?: { rear?: number; front?: number }; glassBow?: { rear?: boolean; front?: boolean } };
  /** Drawn only: how far (m) the roof's side rolls out past the cant line (the side glass's plane) at its bottom; absent 0.01 (a drip lip the pillars' faces meet flush); 0 rolls the roof flush into the glass, no drip rail. */
  roofDrip?: number;
  /**
   * The drawn roof's section (the raked panes' tops follow its dome, `domeFall`, so it moves their cage-skinned rest and the sim too): from its crown down to its cant line as one curve (`roofArc`), a cubic Bézier leaving the crown level
   * and arriving along the side glass's plane: `crown`, its crown handle's share of the half-width (more: a broader top); `blend`, its
   * side handle's share of the section's height (more: a softer roll into the glass); `squareFront` (m), a run back from the front end
   * over which it eases into the dome's flat top and rolled lip, so a flat windshield's top corners stay under the roof. Absent, the
   * dome's flat top and its rolled side lip.
   */
  roofSection?: { crown: number; blend: number; squareFront?: number };
  /**
   * Windshield: base [y, z] of its edges' line, its widths at the base and the top (`windshieldTop`), its centre line's plan bow (default `WINDSHIELD_BOW`).
   * `sideBow` (m): the pane bulges this far forward (z) at mid-height, none at its base and top: a convex side edge in side view; absent, straight.
   * `seat`: drawn only, set it in a `drawn` twin's `windshield`: the base row sits `WINDSHIELD_SEAT` over the hood's top at every column (the hood as `hood.followGlass` bends it, or straight at `hood.z0`), never above `base[0]`; the A-post and the door glass's foot follow it.
   * `round` (m): drawn only, set it in a `drawn` twin's `windshield` (the cage's pane keeps its plain grid): the pane's top corners round to this radius, the glass's own outline (the base corners stay square on the cowl), and the A-post's front rail follows the arc into the roof.
   */
  windshield: { base: YZ; wBase: number; wTop: number; bow?: GlassBow; sideBow?: number; seat?: boolean; round?: number };
  windshieldTop: YZ;
  /**
   * Windshield wipers parked along the glass's base (`styleWipers`): `count` blades (default 2), each `length` of the glass's base width
   * (default 0.42), their tips toward `park` (+1 the car's left, the driver's side of a left-hand drive car: the default, `DRIVER_SIDE`).
   */
  wipers?: { count?: 1 | 2; length?: number; park?: 1 | -1 };
  /** B-pillar z band. */
  bPillar: { rear: number; front: number };
  /** Side glass sill: its half-width (one value, or [z, x] stations where the sill narrows toward a tail), and its height as [z, y] stations; stations ascend in z, linear between, held past the ends. */
  belt: { x: number | readonly (readonly [number, number])[]; y: readonly (readonly [number, number])[] };
  /** The body side's lowest line (m); under it the sill turns in to the floor pan at `dims.rideHeight`. */
  rocker: { y: number };
  /** The body side's widest line's drop under the profile belt (m) as [z, drop] stations, linear between them and held past the ends; absent: FEATURE_DROP (0.1). A smaller drop gives a higher, tighter crest: the roll above it keeps its out radius and still rises to the deck edge. Feeds the cage too. */
  shoulder?: readonly (readonly [number, number])[];
  /** Floor pan height as [z, y] stations in ascending z (linear between, held past the ends); absent = flat at `dims.rideHeight`. The rocker rides up with it. */
  underside?: readonly (readonly [number, number])[];
  /**
   * Front door: hinge axis at the A-pillar (±hingeX, hingeY, hingeZ), `length` hinge to trailing edge, skin ±halfHeight about the hinge, `aperture` [z0, z1] the body's front-door cut (the skin overlaps it 0.02 each end), mirror seated `mirrorY` over the hinge and `mirrorZ` (default 0) behind it, reaching `mirrorReach` out, ±mirrorHalfDepth deep.
   * `mirror` (drawn only): its own mirror, `cap` rounded, box, tear (the rounded cap tapering to its rear face) or nose (tapering to its front face, the glass's face full) of `size` [w out, h, d along z] (default `MIRROR_CAP_SIZE`) in `finish` (body: the door's paint), its outer face at `mirrorReach`, its foot on the skin; absent = the platform mirror x-scaled to the reach.
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
    /**
     * `lift` (m): head, glass and stalk stand this far higher than the seat, the foot growing up to meet them (default 0), for a mirror on a pedestal above the door skin's top.
     * `stalk` (m): the foot's length along the car, a slim post under the head; absent = 0.7 of the cap's depth.
     * `neck` (m): the foot runs this far below the head's bottom, an arm holding the head up off the belt; absent = 0.7 of the cap's height, hidden behind it.
     * `mount` "glass": the seat stands on the door glass's plane at its z and height (`mirrorY` may stand over `halfHeight`), its foot leaning with the pane, as a tow mirror on the glass's front corner; absent, on the skin.
     * `round`: a rounded, tear or nose cap's edge radius as a share of its smallest side (absent `MIRROR_CAP_ROUND`, 0.35); toward 0.5 the outer end rounds right across that side.
     * `taper`: a tear or nose cap's small face's section as a share of its full one (absent `MIRROR_TEAR`, 0.6); toward 1 the cap reads as a fuller pod.
     */
    mirror?: { cap: "rounded" | "box" | "tear" | "nose"; finish: "body" | "black" | "chrome"; size?: readonly [number, number, number]; lift?: number; stalk?: number; neck?: number; mount?: "glass"; round?: number; taper?: number };
    hingeTop?: number;
    /** Drawn only: the door skin's outer face stands this far (m) over the body side inside its cut (absent `DOOR_PROUD`, 3 mm); 0: flush, the shut line a groove only. */
    proud?: number;
    /** Drawn only: under the lowest body-ring row the skin carries, its outer face stands no less than this far (m) over the body side, easing in from `proud` at that row to this at the door's bottom edge and tapering in over the cut's ends like `proud`; those cells turn their diagonal on the hinge half so the lift reaches both end cells alike. The cut's ramp barely leaves the side down there (the rocker point never drops), so a flush skin lies within a millimetre of it and z-fights; absent: the skin holds `proud` all the way down. */
    lowProud?: number;
    /** Drawn only: the body's rings at its cut's ends shade the panel either side from its own faces, a crease at the shut line, not rounded off by the cut's ramp; absent, one smooth normal across it. */
    shutCrease?: boolean;
  };
  /** Where the A-pillar's foot meets the belt (z, m): the door glass's front edge starts there. */
  aPillarFoot: number;
  /** Where the A-pillar's rear edge meets the cant line (z, m): the door glass's top-front corner; absent = 5 cm behind the windshield's top. */
  aPillarTop?: number;
  /** Where the door glass's front edge, rising from `aPillarFoot`, meets the A-post's rear edge (y, m); over it the edge runs in under the post to `aPillarTop`, under it the sail is a small triangle. Absent: one straight edge, the sail filling any gap to the post. */
  aPillarKnee?: number;
  /** Drawn only: with no `aPillarKnee`, the A-post's sail gets a station where the door glass's straight front edge ends at the glass's top (`glassTopY` at `aPillarTop`), so its rear edge follows that edge, not one chord from its middle to the post's top over a see-through wedge. Absent: three stations (belt, middle, post's top). */
  aPillarSailGlass?: boolean;
  /** Side glass top: its drop under the roof (m, absent 0.075), the roof's side lip ending there too; or [z, y] stations (ascending, linear, held past the ends) under a 0.075 lip, painted fill between them and the lip. */
  glassTop?: number | readonly (readonly [number, number])[];
  /**
   * Wheel-arch opening radius (m) about each hub; `lip` its drawn flare lip (drawn only: the cage keeps the bare opening); `wellWall` (drawn only) the |x| (m) of an outboard tyre's well wall, the liner widened inboard to it; `rise` (drawn only, absent 1) the opening's crown height over the hub as a fraction of `radius`: an elliptic opening, as wide at hub height, its lip following it under the round fender flare.
   * `feet` (drawn only): each opening's legs get a ring either side of them (the nearest plain station within 6 cm outside moving onto the outer one), so they drop straight to the rocker under the lip's; absent, a leg spans the gap between its nearest stations, leaning out.
   */
  arch: { radius: number; lip?: ArchLip; wellWall?: number; rise?: number; feet?: boolean };
  /** Drawn only: [z0, z1] (m): each body loft gap whose middle lies in it gets a ring there, where the flank turns hard between stations (an arch's flare); the cage keeps its rings. */
  ringSplit?: readonly [z0: number, z1: number];
  /** Drawn only: inside the front door's cut (between its feathered edges) the loft keeps only its knots' rings, no plain stations: there it is the bare sill and floor, straight along z, under the door skin. The cage keeps its rings. */
  bareDoorCut?: boolean;
  /**
   * Bonnet lid lofted on the profile from z0 (cowl) to z1 (nose), hinged at origin. A `clamshell` lid (drawn only) wraps over the fender tops, its side shut line on the shoulder; `bulge` stands on it; `crown` [drop, at] (m, drawn only) domes its top as a parabola across x, `drop` under its centre line at |x| `at`.
   * `groove` [out, down] (m, drawn only): over the open bay the fender's deck edge beside a lid hood stands `out` outboard of the hood's edge and `down` lower, a shut-line slot onto the bay wall.
   * `nose` [drop, radius] (drawn only, `HoodNose`): the lid folds over the nose at z1 and runs down its face.
   * `inset` [nose, cowl] (m, drawn only, with `crown`): the side shut line's inset from the half-width, z1 to z0; the flat fender top runs in to it, the crown kept.
   * `followGlass` (m): drawn only, the hood's rear edge runs this far in front of the windshield's base along its plan bow (the cowl between them), fading into the lid; absent, straight at `z0`.
   * `calmPan` (drawn only): the hidden inner pan (skirts, underside) lays its gentle folds flat, keeping the bends a stamped panel would; absent, it follows the lid's own curve.
   */
  hood: { z0: number; z1: number; origin: YZ; kind?: "lid" | "clamshell"; bulge?: HoodBulge; crown?: readonly [drop: number, at: number]; groove?: readonly [out: number, down: number]; nose?: HoodNose; inset?: readonly [nose: number, cowl: number]; followGlass?: number; calmPan?: boolean };
  /** The rear bumper may carry a tow-hitch receiver under its middle (`hitch`). */
  bumpers: { front: BumperSpec; rear: BumperSpec & { hitch?: boolean } };
  rearGlass: GlassQuad;
  /** Side glass behind the B-pillar: rear edge z at the belt and at the top. `drawn` (drawn only): the drawn pane, sail and trim's own; the cage's post and rail and the dummies' pane keep these. */
  quarter: { zRearBot: number; zRearTop: number; drawn?: { zRearBot: number; zRearTop: number } };
  /** Extra pillar splitting the quarter glass (wagon C-pillar), or null. */
  midPillarZ: number | null;
  /**
   * Drawn only: side-view pillar bands (`PillarSpan`). `a`: the A-post's width behind the windshield edge (absent 0.06). `aCrown`: its outer
   * face's crown as a share of its width (absent 0.13): the face's edge normals fan across it from the side glass to the windshield, less
   * reads a flatter plank, more a rounder post. `b`: the
   * B-pillar, centred on its `bPillar` band unless it leans. `divider`: the post at `midPillarZ`. Absent: the `bPillar` band (its top
   * 3 cm narrower); a divider 0.08 / 0.07 wide, upright at `midPillarZ`. `rearFoot` [x, y] (m): a point on the body's shoulder beside the
   * rear glass's base; the plank rear post's (no `cPillar`) foot fans out to it, covering the cabin's opening there; absent, no fan. `aSeat`
   * (y, m): a deck under the drawn A-post's foot lower than the belt; a skirt of the post's own section hangs from the foot down to it,
   * so the cabin never shows through the gap; absent, none. `glassBar`: a slim divider bar standing on the side glass, belt to roof,
   * `width` [belt, top] about its centre line at `z` [belt, top], toned by `blackout.divider`; a flat strip with no cage post; absent, none.
   * `rearSquare`: the plank rear post (no `cPillar`) squared, a truck cab's back corner: its rear edge on the side glass's plane like its
   * front, so its face never turns to the tail, and a flat cab back panel from inside it over the rear glass's side edge; absent, the
   * post's rear edge at the rear glass's corner.
   */
  pillars?: { a?: number; aCrown?: number; b?: PillarSpan; divider?: PillarSpan; rearFoot?: readonly [number, number]; aSeat?: number; glassBar?: Required<PillarSpan>; rearSquare?: boolean };
  /** Drawn only: the windshield and the door glass's front edge as the player sees them, in place of the style's own for every drawn part (`drawnStyle`); the cage, the dummies' panes, the cabin, the sim and the windshield's centre (the thrown driver's exit point) keep the style's own. */
  drawn?: DrawnTwin;
  /**
   * Drawn only: parts in gloss black (the paint's primer-dark tone, no draw of their own): the A-post, its sail, the B-pillar, the divider, the rear pillar,
   * and the cowl (the deck between the hood's rear edge and the windshield's foot). A "matte" rear pillar is the black at plastic's roughness, its clear coat off.
   */
  blackout?: { a?: boolean; sail?: boolean; b?: boolean; divider?: boolean; rear?: boolean | "matte"; cowl?: boolean };
  /**
   * Drawn only: the C-pillar as a sail lofted from the haunch's shoulder, tangent to it, up to the rear glass and the roof, its front on
   * the side window's line; absent, a flat post. `tip` ([y, z]): where that line ends at the belt behind the quarter glass, the gloss-black
   * triangle between them filling the gap; absent, the line is the quarter glass's own rear edge. `flush`: the sail's head laps the rear
   * glass's side edge, standing on the glass and arriving level across it (one broad pillar rolling into the glass), not a rounded
   * buttress beside it. `flat`: on the haunch each section runs straight from its head down to where it touches the body's section
   * (one broad flat fastback panel leaving the body tangent), not a curve from the shoulder point; on a curved roof its head eases from the
   * roof end's out to the post's top over the run ahead, not back out in one ring. `corner`: on a curved roof with round
   * rear glass corners, a flush sail's head at the roof's end laps the glass's side edge this share of the way round its top corner's arc
   * (0 its side end, 1 its top end), so the head covers the arc above that point; absent 0.5, mid-arc. `pinch` (m): the side window's
   * line rounds over from its foot at the belt into the glass's top line this far ahead of `quarter.zRearTop` (one quadratic through that
   * corner), so the window narrows to a point at the sail instead of ending on a straight rear edge; absent, the straight edge. `sweep`
   * (m): behind the window's point the sail's foot sweeps out onto the shoulder over this run; absent 0.15. `bead` (drawn only): ahead of a
   * pinched window's corner the sail's head is a bead, and its inner face holds the head's depth to mid-face; absent, a post's round head.
   * `blend` (m): a flat sail takes on the roof end's roll over this run behind the roof's rear end (the rest of its haunch straight); absent 0.45.
   * `railRun` (m, drawn only): the belt rail runs on this far behind the quarter glass's rear point, under the sail's foot; absent, it ends at the point.
   * `rollShare` (0..1, drawn only): the share of the roof end's roll a flat sail's rings behind the roof end carry (absent 1); less keeps a widened roof end's bulge off the haunch.
   * `reachLip` (0..1, drawn only, a flat sail on a `roofSection`): ahead of the roof end the sail's outer face reaches the roof's cant lip at the cant line (the roll end's own section carried onto each ring), not a chord under the roof's edge; absent 0.
   * `dEnd` ([radius, z], m, drawn only, with `pinch`): the side window's rear end rounded: its line leaves the belt on an arc of `radius` tangent to the
   * line's start (tip to the glass's top corner), the arc's rearmost point at car `z` (ahead of the tip); the sail covers the glass behind it; absent,
   * the line meets the belt in a point at the tip. `cageSail`: the cage's C-post is the sail's own loft, so a tyre above stands on the bulge it sees; absent, the flat box between the post's corners.
   */
  cPillar?: { tip?: YZ; flush?: boolean; flat?: boolean; corner?: number; pinch?: number; sweep?: number; bead?: boolean; blend?: number; railRun?: number; reachLip?: number; rollShare?: number; dEnd?: readonly [radius: number, z: number]; cageSail?: boolean };
  /** Dark-tinted panes (drawn only): the rear glass and the side panes behind the B-pillar, as the reference's privacy glass; "matte" ones rougher. */
  privacyGlass?: { rear?: boolean | "matte"; quarter?: boolean | "matte" };
  /** Drawn only: the body paint's base roughness, clear coat and clear coat roughness (`makePaintMaterial`); absent the platform paint's (0.42, 0.72, 0.24). */
  paintFinish?: { roughness: number; clearcoat: number; clearcoatRoughness: number };
  /** Chrome bead round every glass pane's border (drawn only): the door glass's rides its door, the rest the body. */
  windowTrim?: "chrome";
  /** Chrome strips on the body side (drawn only, with `windowTrim`): side-view polylines [z, y] (m), `width` (m) tall, on the skin's +x and -x. A strip whose points all lie inside the door aperture rides the door; any other rides the body. */
  chromeStrips?: readonly { points: readonly (readonly [number, number])[]; width: number }[];
  rearBulkhead: { z: number; yTop: number };
  /** Open floors visible through the glass: [zRear, zFront, floorY]. */
  tubs: readonly (readonly [number, number, number])[];
  /** The engine bay trough's floor (m, car y) under the hood (`bayTub`); absent, 0.28. A lifted body whose floor pan stands over that at the bay (the trucks) sets its pan height, so the trough the paint row and the bay set read is the one drawn. */
  bayFloor?: number;
  /** The engine bay trough's front end (m, car z, `bayTub`); absent, 8 cm inside the hood's nose edge (`hood.z1`). A hood wrapping a nose on the profile's own nose rings keeps its bay off them. */
  bayFront?: number;
  /** How much of the roof's dome a raked pane's top edge falls with (`domeFall`, 0..1), and its posts with it; absent, 1. A flat-roofed cab takes less, so its panes' corners twist less. */
  domeFall?: number;
  /** A bed's wheel tubs (both builds): over each wheel whose liner stands in a tub floor, a half cylinder `rise` (m) over the floor and `length` along the car, `width` in from the bed's side wall; absent, a drawn-only hump hugs the liner. */
  wheelTub?: { rise: number; length: number; width: number };
  /** A tub's rim width (m): its side wall's top edge stands this far in from the body side (its foot stays 6 cm in); absent, 6 cm. */
  tubWall?: number;
  /**
   * Where the dummies' world takes the cabin to start (m, the cage's frame; `ragdoll-proxy.ts` `BELT_Y`): a cage top under it is a column
   * from under the ground (a hood, a deck, a bed), one over it a roof slab. Absent, `BELT_Y`'s 1 m: every car's hood and deck under it,
   * every roof over it, but a truck's and the SUV's.
   */
  proxyBelt?: number;
  /** Rear door shut line on four-door bodies, or null. */
  rearDoorSeam: number | null;
  boot: BootSpec;
  /**
   * Lamp seats [x, y] (m, right side; the left mirrors it) on the end panels: the head lamps on the nose, the tail lamps
   * on the tail panel, standing upright in its corners beside a tailgate. `shapes` (drawn only): `head` / `tail` each kind's own lamp
   * riding its seat (a tail's share that lands on the boot lid rides the lid, lit with the tails); `front` / `rear` lamps, reflectors and
   * pods on that bumper's fascia (unlit, torn off with it). Absent, the platform housing (`LAMP_HOUSING`, standing 4.5 cm proud).
   * `brake`: a high-mount brake lamp `size` [w, h] met on the skin or the rear glass from behind at [x, y] (a pickup's cab glass); `sideMarkers`:
   * amber markers on each side met from outboard at [y, z], `tint` (sRGB) multiplied into the shared amber lens (absent, the amber as is).
   * Brake lamp and markers are drawn only, lit (brake) with the tails, never broken.
   * `bulb`: the head lamps' light, warm halogen or cool-white LED, in their lit lens pieces and glow; absent, the neutral white.
   */
  lamps: {
    head: readonly [number, number];
    tail: readonly [number, number];
    shapes?: { head?: LampShape; tail?: LampShape; front?: LampShape; rear?: LampShape };
    brake?: {
      at: readonly [number, number];
      size: readonly [number, number];
      /** Metres the seated lamp sits recessed into the surface it meets, along its probe ray (default 0). */
      inset?: number;
    };
    sideMarkers?: readonly { at: readonly [number, number]; size: readonly [number, number]; tint?: number }[];
    bulb?: "halogen" | "led";
  };
  /**
   * The front grille (drawn only; it tears off with the front bumper): centre height `y` and face `z` (m, car frame; z absent: the platform
   * grille's face); `size` [w at the top, h], `bottom` its width at the bottom (a trapezoid; absent, w), corners rounded `round` (m); `kind`
   * horizontal bars, vertical slats, a mesh of both or a diagonal (hex) mesh, `count` bars or slats (a mesh: lines each way; absent, at the default pitch); a round
   * `badge` of that radius at its centre, a chrome `bezel` framing its edge; in `finish` (body: the body's paint). Absent: the platform grille.
   */
  grille?: {
    y: number;
    z?: number;
    size: readonly [number, number];
    bottom?: number;
    round?: number;
    kind: "bars" | "mesh" | "slats" | "hex";
    count?: number;
    /** Its bars' or slats' width (m); absent, 12 mm (a mesh's 6 mm). */
    bar?: number;
    badge?: number;
    /** A hex mesh's bars cross at ± this angle (rad) from the horizontal (flatter: wider diamonds, more rows); absent, 60°. */
    angle?: number;
    /** A chrome frame this wide (m) round the grille's outer edge, its face standing out past the grille's (drawn only). */
    bezel?: number;
    finish: "black" | "chrome" | "body";
    /** Its top leaning back (rad) about its centre line, onto a raked face; absent, upright. */
    lean?: number;
    /** The surround's own finish (a chrome frame round a black mesh); absent, `finish`. */
    rim?: "black" | "chrome" | "body";
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

const DRAWN_STYLES = new WeakMap<BodyStyle, { twin: DrawnTwin; style: BodyStyle }>();

/** `style` as drawn: its `drawn` twin's fields over its own, one object per twin (style-keyed caches such as `carFrame` hold); `style` itself without one. */
export function drawnStyle(style: BodyStyle): BodyStyle {
  const twin = style.drawn;
  if (twin === undefined) return style;
  const cached = DRAWN_STYLES.get(style);
  if (cached?.twin === twin) return cached.style;
  const drawn: BodyStyle = { ...style, ...twin };
  DRAWN_STYLES.set(style, { twin, style: drawn });
  return drawn;
}
