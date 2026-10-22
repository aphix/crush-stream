import * as THREE from "three";
import { hypot2, detCos, detSin } from "../kernel/physics-core.js";
import { CAR_STYLES, type BodyStyle, type BootLip, type BootSpec, type BumperEnd, type LidDrop, type ProfileStation, type YZ } from "./car-variants.ts";
import { beltX, beltY, cantDrop, floorY, glassTopStation, rockerAt, tubWall } from "./car-lines.ts";
import { splitCreases } from "./car-crease.ts";
import { markSkinDynamic } from "../deform/fast-normals.ts";
import { carFrame } from "./car-rig.ts";
import { DECK_RISE, INNER_PANEL, PRIMER_ATTRIBUTE } from "./constants.ts";
import { bootPivot, roofHinged } from "./hinge-spec.ts";

export const SEDAN = CAR_STYLES.sedan;

/**
 * The hard edges the drawn parts declare: the angle (degrees) between two faces past which `splitCreases` gives the edge its
 * own vertices, so the live per-skin normals stay hard across a crush and smooth everywhere else. Faces turning less than the
 * angle shade as one surface.
 * A loft's flat end caps are the panel's cut ends: own vertices (set by the loft), hard at whatever angle the panel meets them.
 * - deckLid: a bonnet or boot lid's top meets its skirt at 90° (the shut line); its dome and skirt chords turn under 2°.
 * - tailgate: the hatch's bowed panel meets its edge at 90°; its bow turns under 2° a chord.
 * - door: the slab's edge wall meets the inner face at 90°; the edge roll turns 45° at most a chord and the shoulder under 30°.
 * - bumper: the fascia's splitter lip and back turn 73° and 90° (the lip's lower chord 67°); its rounded top and intake recess turn
 *   49° at most a chord. A quad the corner wrap warps folds 63° along its diagonal, which no fan of vertices can keep hard, so the angle sits above that.
 * - fitting: a style's drawn add-ons (hood bulge, scoop, roof rails, spoiler, glass panel) are boxes and wedges: their edges turn 70-90°, their tops under 10° a chord.
 * The body loft is never split (`panelRegions` primes and peels it by vertex id: a copy would stay painted while its original tears
 * to primer), but for a tub's wall top, which no panel takes; the greenhouse pillars, roof, liners and bulkheads are parts with their own vertices, hard against each other.
 */
export const CREASE_DEGREES = { deckLid: 45, tailgate: 45, door: 60, bumper: 70, fitting: 50 } as const;

/**
 * Which build of a body part a builder draws. `drawn`: the smoothed mesh the player sees. `cage`: the plain build the collision
 * cage is decimated from (`cageSourceOf`); the sim was tuned on it, so smoothing never reaches it.
 */
export type BodySource = "drawn" | "cage";

export type Pt = { x: number; y: number };
export type V3 = readonly [number, number, number];

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * PCHIP tangent (Fritsch–Butland) of station field `key` at station `i`: flat at a local extremum, the end
 * interval's secant at either end. Keeps the loft's width and beltline C1 along z without overshoot; a
 * smoothstep per interval flattened every station into a visible ring.
 */
function stationSlope(p: readonly ProfileStation[], i: number, key: "hw" | "yBelt"): number {
  const secant = (k: number) => (p[k + 1]![key] - p[k]![key]) / (p[k + 1]!.z - p[k]!.z);
  if (i === 0) return secant(0);
  if (i === p.length - 1) return secant(i - 1);
  const d0 = secant(i - 1);
  const d1 = secant(i);
  if (d0 * d1 <= 0) return 0;
  const h0 = p[i]!.z - p[i - 1]!.z;
  const h1 = p[i + 1]!.z - p[i]!.z;
  const w0 = 2 * h1 + h0;
  const w1 = h1 + 2 * h0;
  return (w0 + w1) / (w0 / d0 + w1 / d1);
}

export function sampleSlice(z: number, profile: readonly ProfileStation[]): ProfileStation {
  if (z <= profile[0]!.z) return { ...profile[0]!, z };
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1]!;
    const b = profile[i]!;
    if (z <= b.z) {
      const h = b.z - a.z;
      const t = (z - a.z) / h;
      const s = THREE.MathUtils.smoothstep(t, 0, 1);
      // Cubic Hermite on [a, b] with PCHIP tangents for the shell's width and beltline.
      const hermite = (key: "hw" | "yBelt") =>
        (2 * t ** 3 - 3 * t ** 2 + 1) * a[key] +
        (t ** 3 - 2 * t ** 2 + t) * h * stationSlope(profile, i - 1, key) +
        (3 * t ** 2 - 2 * t ** 3) * b[key] +
        (t ** 3 - t ** 2) * h * stationSlope(profile, i, key);
      return {
        z,
        hw: hermite("hw"),
        yBelt: hermite("yBelt"),
        yRoof: lerp(a.yRoof, b.yRoof, s),
        cabinHw: lerp(a.cabinHw, b.cabinHw, s),
        cabin: lerp(a.cabin, b.cabin, s),
      };
    }
  }
  return { ...profile[profile.length - 1]!, z };
}

/** Roof surface height and half-width (roof panel, glass tops, pillar tops all agree). */
export function roofAt(z: number, style: BodyStyle): { y: number; x: number } {
  const sl = sampleSlice(z, style.profile);
  const c = Math.max(sl.cabin, 0.25);
  return { y: lerp(sl.yBelt, sl.yRoof, c), x: lerp(sl.hw * 0.55, sl.cabinHw, c) };
}

/** Height of the roof panel's top at (`x`, `z`), the top ring of `makeRoofGeometry`: the centre-line crown, the dome's
 *  shoulder, then down to the cant line at the roof's half-width. */
export function roofTopY(x: number, z: number, style: BodyStyle): number {
  const r = roofAt(z, style);
  const [us, ys] = ROOF_SHOULDER;
  const u = Math.min(Math.abs(x) / r.x, 1);
  return r.y + (u < us ? lerp(ROOF_CROWN, ys, u / us) : lerp(ys, 0, (u - us) / (1 - us)));
}

/** The roof's cant line: its side lip's bottom, where the pillars end and the side glass plane leans to. */
export function cantY(z: number, style: BodyStyle): number {
  return roofAt(z, style).y - cantDrop(style);
}

/** Side glass top edge: the cant line, or the style's own stations under it. */
export function glassTopY(z: number, style: BodyStyle): number {
  const cant = cantY(z, style);
  const own = glassTopStation(z, style);
  return own === null ? cant : Math.min(own, cant);
}

export function cantX(z: number, style: BodyStyle): number {
  return roofAt(z, style).x + 0.08;
}

/** Tumblehome: side glass leans in from the belt to the roof cant. */
export function glassX(z: number, y: number, style: BodyStyle): number {
  const top = cantY(z, style);
  const belt = beltY(z, style);
  return lerp(beltX(z, style), cantX(z, style), THREE.MathUtils.clamp((y - belt) / (top - belt), 0, 1));
}

function wheelWell(z: number, wheels: readonly V3[], archR: number): number {
  let w = 0;
  for (const [, , wz] of wheels) {
    const dz = z - wz;
    if (Math.abs(dz) < archR) w = Math.max(w, Math.sqrt(archR * archR - dz * dz));
  }
  return w;
}

/** Fender flare band just outside the arch opening. */
function archFlare(z: number, y: number, wheels: readonly V3[], archR: number): number {
  let f = 0;
  for (const [, wy, wz] of wheels) {
    const dz = z - wz;
    const r = y >= wy ? hypot2(dz, y - wy) : Math.abs(dz);
    const band =
      THREE.MathUtils.smoothstep(r, archR - 0.04, archR + 0.02) *
      (1 - THREE.MathUtils.smoothstep(r, archR + 0.06, archR + 0.17));
    f = Math.max(f, band);
  }
  return f;
}

/** Front door cut feathered over DOOR_EDGE at both ends. */
export const DOOR_EDGE = 0.04;

/** Front door cut (A-pillar to B-pillar) along z (m, car frame, + = forward), per style (`style.door.aperture`). Rear quarter stays a solid panel. */
export function doorAperture(z: number, style: BodyStyle): number {
  const [z0, z1] = style.door.aperture;
  if (z <= z0 || z >= z1) return 0;
  const a = THREE.MathUtils.smoothstep(z, z0, z0 + DOOR_EDGE);
  const b = 1 - THREE.MathUtils.smoothstep(z, z1 - DOOR_EDGE, z1);
  return a * b;
}

/** Half-width (m) of the blend into and out of a style's tub floor along z (8e2dc49). */
export const TUB_EDGE = 0.025;

/** The bay opens `rear` (m) ahead of the hood's cowl edge or the windshield's foot, whichever is further forward, and stops `front` inside the hood's nose edge; `cowl` (m) of closed deck stays between its blend and the cabin tub's, so a cowl stands there and not a fin. */
const BAY_CLEAR = { rear: 0.04, front: 0.08, cowl: 0.05 } as const;
/** The trough's default floor (m, car y; a style's `bayFloor` overrides it): deep enough that the bay set stands tall in it, clear of the body's floor pan at 0.145. */
const BAY_FLOOR = 0.28;

/** The drawn body's engine bay trough under the hood, as a tub [zRear, zFront, floorY] (`BodyStyle.tubs`): drawn only, the cage's deck stays closed. */
export function bayTub(style: BodyStyle): readonly [number, number, number] {
  const rear = Math.max(style.hood.z0, style.windshield.base[1]) + BAY_CLEAR.rear;
  const cabinFront = Math.max(-Infinity, ...style.tubs.map(([, front]) => front).filter((front) => front < rear));
  return [Math.max(rear, cabinFront + 2 * TUB_EDGE + BAY_CLEAR.cowl), style.hood.z1 - BAY_CLEAR.front, style.bayFloor ?? BAY_FLOOR];
}

/** The open floors a body build lofts: the style's tubs, and on the drawn body the engine bay under the hood (`bayTub`). */
export function bodyTubs(style: BodyStyle, source: BodySource): readonly (readonly [number, number, number])[] {
  return source === "drawn" ? [...style.tubs, bayTub(style)] : style.tubs;
}

/** How far (0..1) the drawn body's loft at `z` has dropped into the engine bay's trough (`bayTub`). */
export function bayAt(z: number, style: BodyStyle): number {
  return tubAt(z, style, [bayTub(style)]).t;
}

/** How far (0..1) the drawn body's loft at `z` has dropped into the cabin's tub (the style's first, the seats' floor). */
export function cabinAt(z: number, style: BodyStyle): number {
  return style.tubs.length === 0 ? 0 : tubAt(z, style, style.tubs.slice(0, 1)).t;
}

function tubAt(z: number, style: BodyStyle, tubs: readonly (readonly [number, number, number])[]): { t: number; floor: number } {
  let t = 0;
  let floor = floorY(z, style);
  for (const [z0, z1, f] of tubs) {
    const w =
      THREE.MathUtils.smoothstep(z, z0 - TUB_EDGE, z0 + TUB_EDGE) *
      (1 - THREE.MathUtils.smoothstep(z, z1 - TUB_EDGE, z1 + TUB_EDGE));
    if (w > t) {
      t = w;
      floor = Math.max(f, floorY(z, style));
    }
  }
  return { t, floor };
}

/**
 * The boot's opening in the drawn body (the cage's deck stays closed): an open floor `floor` high from `front` back to `rear`, and the
 * rear face's cut a tailgate, or a lid wrapping the tail, takes with it: `wall` its half-width and `sill` its bottom, over the face
 * from the tail to `face.front`. A deck lid's hollow is its own boot (`lined`, an unpainted inner panel); a tailgate or roof-hinged
 * lid opens the cabin's or bed's floor on through the tail.
 */
interface BootCut {
  rear: number;
  front: number;
  floor: number;
  lined: boolean;
  face: { front: number; wall: number; sill: number } | null;
}

/** A deck lid's hollow stops this far (m) inside the lid's ends, so its ramps stay under the shut lid. */
const BOOT_GAP = 0.005;
/** A face's opening stays this far (m) inside the panel that shuts it: the panel's edge closes over body, never over the hole. */
const BOOT_LAP = 0.01;
/** The face's cut runs at least this far (m) in from the tail: the opening's sill is the tail panel's top. */
const FACE_DEPTH = 0.06;
/** A hollow's floor stands at least this far (m) over the floor pan and over a wheel well's arch: inside the cage's hull, whose sill corner stands 2 cm over the pan. */
const BOOT_FLOOR_CLEAR = 0.03;
/** Past the tail: a hollow open "through" it never ramps back up. */
const THROUGH = 1;

export function bootCut(style: BodyStyle): BootCut {
  const b = style.boot;
  const tail = style.profile[0]!.z;
  const faceFront = (z: number) => Math.max(z, tail + FACE_DEPTH);
  let back: readonly [number, number, number] | null = null;
  for (const tub of style.tubs) if (!back || tub[0] < back[0]) back = tub;
  if (back && (b.kind === "tailgate" || roofHinged(b))) {
    const floor = back[2];
    const face =
      b.kind === "tailgate"
        ? { front: faceFront(Math.max(b.origin[1], b.z0 ?? b.origin[1])), wall: Math.max(...gateHeights(b).map((y) => tailgateHalf(style, y))) - BOOT_LAP, sill: Math.max(b.y0 + BOOT_LAP, floor) }
        : b.drop
          ? { front: faceFront(b.z1 + LID_FOLD_R), wall: b.drop.w - BOOT_LAP, sill: Math.max(b.drop.y + BOOT_LAP, floor) }
          : null;
    return { rear: tail - THROUGH, front: back[0] + 2 * TUB_EDGE, floor, lined: false, face };
  }
  if (b.kind !== "lid") throw new Error(`${style.id}: a tailgate needs a tub to open into`);
  const bumperTop = style.bumpers.rear.seat.y;
  const face = b.drop ? { front: faceFront(b.z1 + LID_FOLD_R), wall: b.drop.w - BOOT_LAP, sill: b.drop.y + BOOT_LAP } : null;
  return {
    rear: face ? tail - THROUGH : b.z1 + TUB_EDGE + BOOT_GAP,
    front: b.z0 - TUB_EDGE - BOOT_GAP,
    floor: Math.min(bumperTop, face?.sill ?? bumperTop),
    lined: true,
    face,
  };
}

/** How far (0..1) the drawn body's loft at `z` is open into the boot (`cut`), and into its face's cut. */
export function bootCutAt(z: number, cut: BootCut): { open: number; face: number } {
  const open = THREE.MathUtils.smoothstep(z, cut.rear - TUB_EDGE, cut.rear + TUB_EDGE) * (1 - THREE.MathUtils.smoothstep(z, cut.front - TUB_EDGE, cut.front + TUB_EDGE));
  const face = cut.face ? 1 - THREE.MathUtils.smoothstep(z, cut.face.front - TUB_EDGE, cut.face.front + TUB_EDGE) : 0;
  return { open, face };
}

/** Half-width (m) of the rear-door shut-line groove; seamInset sets its 9 mm depth (8e2dc49). */
export const SEAM_HALF = 0.012;

function seamInset(z: number, style: BodyStyle): number {
  if (style.rearDoorSeam === null) return 0;
  return 0.009 * Math.max(0, 1 - Math.abs(z - style.rearDoorSeam) / SEAM_HALF);
}

/** The side's widest line sits this far below the belt (m), `SIDE_OUT` proud of the station half-width. */
const FEATURE_DROP = 0.1;
const SIDE_OUT = 0.004;
/** Shoulder: a quarter-ellipse from the feature line (vertical tangent) toward the deck edge, `SHOULDER` = [out, up] radii (m). */
const SHOULDER = [0.074, 0.104] as const;
/** The side's shoulder stops at this arc angle (rad); the deck (or the door glass) takes over above it. */
const SHOULDER_TOP = Math.PI / 3;
/** Tuck-under from the feature line to the rocker (m, parabolic in height). */
const TUCK = 0.03;

/**
 * Body-side half-width at height `y` for a station of half-width `hw` and belt `yb`: the shoulder rolls in
 * above the feature line, the side tucks under below it to the rocker at `rockerY`, C1 at the feature line. The door skin follows it too.
 */
export function sideX(y: number, hw: number, yb: number, rockerY: number): number {
  const yF = yb - FEATURE_DROP;
  if (y >= yF) {
    const sin = Math.min((y - yF) / SHOULDER[1], detSin(SHOULDER_TOP));
    return hw + SIDE_OUT - SHOULDER[0] * (1 - Math.sqrt(1 - sin * sin));
  }
  const v = Math.min((yF - y) / (yF - rockerY), 1);
  return hw + SIDE_OUT - TUCK * v * v;
}

/** The drawn body side's shoulder point at `SHOULDER_TOP` (its ring point 2) at `z`, and the shoulder's unit tangent there, up toward the deck. */
export function shoulderTop(z: number, style: BodyStyle): { x: number; y: number; tangent: readonly [number, number] } {
  const { hw, yBelt } = sampleSlice(z, style.profile);
  const y = yBelt - FEATURE_DROP + SHOULDER[1] * detSin(SHOULDER_TOP);
  const [dx, dy] = [-SHOULDER[0] * detSin(SHOULDER_TOP), SHOULDER[1] * detCos(SHOULDER_TOP)];
  const run = hypot2(dx, dy);
  return { x: sideX(y, hw, yBelt, 0) - seamInset(z, style), y, tangent: [dx / run, dy / run] };
}

/** Shoulder arc angles sampled by the ring (rad), top down; the feature line (0) follows. Two 30° chords sag 3 mm. */
const SHOULDER_RING = [SHOULDER_TOP, Math.PI / 6] as const;
/**
 * Points the ring spends on the tuck-under between the feature line and the rocker, evenly spaced down the side. The drawn body
 * gives the arch lip's parabola (`TUCK`, 3 cm) three chords, which sag under 1 mm each; the cage's plain build keeps its one.
 */
const TUCK_ROWS = { drawn: 2, cage: 1 } as const;
/** Half-ring indices of the feature line, and the drawn body's rocker: the side points between them flare at the arches. */
const FLARE_FIRST = 4;
export const ROCKER = FLARE_FIRST + TUCK_ROWS.drawn + 1;

/** The deck edge's height (ring point 1) at a station of belt `yb`, `t` into a tub: the fender's top beside a hood. */
function deckEdgeY(yb: number, t: number): number {
  return lerp(yb + 0.004, yb - 0.006, t);
}

/**
 * In the drawn nose's last `NOSE_ZONE` (m), where the profile's half-width and belt turn hardest, a chord whose half-width or belt sags more
 * than `NOSE_SAG` (m) off the station table's curve at its middle is halved, down to `NOSE_MIN_CHORD` (m): a wider chord shows as a facet.
 */
const NOSE_ZONE = 0.25;
const NOSE_SAG = 0.002;
const NOSE_MIN_CHORD = 0.015;

/** Ascending `zs` with the nose's chords halved until each lies within `NOSE_SAG` of the profile's curve (`NOSE_ZONE`). */
export function noseRefined(zs: readonly number[], profile: readonly ProfileStation[]): number[] {
  const noseZ = profile[profile.length - 1]!.z;
  const out = zs.slice(0, 1);
  const chord = (a: number, b: number): void => {
    const m = (a + b) / 2;
    if (b > noseZ - NOSE_ZONE && b - a > 2 * NOSE_MIN_CHORD) {
      const [sa, sm, sb] = [sampleSlice(a, profile), sampleSlice(m, profile), sampleSlice(b, profile)];
      if (Math.max(Math.abs(sm.hw - (sa.hw + sb.hw) / 2), Math.abs(sm.yBelt - (sa.yBelt + sb.yBelt) / 2)) > NOSE_SAG) {
        chord(a, m);
        chord(m, b);
        return;
      }
    }
    out.push(b);
  };
  for (let i = 1; i < zs.length; i++) chord(zs[i - 1]!, zs[i]!);
  return out;
}

/** The sill's outer corner over the floor pan (m), as first built on the 0.145 floor. */
const SILL_CORNER_RISE = 0.165 - 0.145;
/** The door cut's sill rows over the rocker (m), outboard to inboard, then the last tuck row's: as first built on the 0.2 rocker. */
const SILL_ROWS = [0.235, 0.236, 0.234, 0.231, 0.226].map((y) => y - 0.2);
const SILL_TUCK = 0.22 - 0.2;

/** The closed deck's crown points stand this far (m) inside the station's half-width and over its belt. */
const DECK_CROWN = { inset: 0.22, rise: DECK_RISE } as const;

/**
 * Lower body ring (left half top→bottom, keel, right half bottom→top; the
 * wrap edge is the deck). Deck crown → deck edge → rounded shoulder → feature
 * line → tuck-under → rocker → sill. Tubs open the deck into a floor with walls;
 * the door cut drops the side to the sill (unless `doorCut` is off). Greenhouse is never lofted metal.
 */
function halfRing(s: ProfileStation, style: BodyStyle, source: BodySource, doorCut = true): [number, number][] {
  const { hw, yBelt: yb, z } = s;
  const hole = doorCut ? doorAperture(z, style) : 0;
  const rockerY = rockerAt(z, style);
  const floor = floorY(z, style);
  const tub = tubAt(z, style, bodyTubs(style, source));
  const { wheels } = carFrame(style);
  const well = wheelWell(z, wheels, style.arch.radius);
  const archY = wheels[0]![1] + well;
  const inset = seamInset(z, style);
  const yF = yb - FEATURE_DROP;
  const side = (y: number): [number, number] => [sideX(y, hw, yb, rockerY) - inset, y];
  const tuckRows = TUCK_ROWS[source];
  const rocker = FLARE_FIRST + tuckRows + 1;
  // A tub's floor stays flat over wheels whose tyres it clears (the pickup's bed), or that stand outboard of the body (the monster's).
  const floorClear = tub.t > 0 && wheels.every(([wx, wy]) => Math.abs(wx) > hw || wy + style.dims.wheel.radius < tub.floor);
  const edge = wellEdge(z, hw, tub.t, floorClear, well, style, source);
  // The deck edge drops into the style's own tubs (cabin, bed), not into the drawn bay: there it stays the fender's top under the hood's edge.
  const deckTub = tubAt(z, style, style.tubs).t;
  // The ring's half: deck crown and edge, the shoulder, the feature line, the tuck-under, the rocker, then the sill and the floor.
  const half: [number, number][] = [
    [lerp(hw - DECK_CROWN.inset, edge ?? hw - 0.06, tub.t), lerp(yb + DECK_CROWN.rise, tub.floor, tub.t)],
    [lerp(hw - 0.07, hw - tubWall(style), deckTub), deckEdgeY(yb, deckTub)],
    ...SHOULDER_RING.map((a) => side(yF + SHOULDER[1] * detSin(a))),
    side(yF),
    ...Array.from({ length: tuckRows }, (_, row) => side(lerp(yF, rockerY, (row + 1) / (tuckRows + 1)))),
    side(rockerY),
    [hw - 0.05, floor + SILL_CORNER_RISE],
    [edge === null ? hw * 0.8 : lerp(hw * 0.8, Math.min(hw * 0.8, edge), tub.t), floor + 0.004],
  ];
  const boot = bootCut(style);
  const cut = source === "drawn" ? bootCutAt(z, boot) : { open: 0, face: 0 };
  if (cut.open > 0) {
    // The hollow's floor stays inside the cage's hull: over its floor pan, and over a wheel's well.
    const hollow = Math.max(boot.floor, floor + BOOT_FLOOR_CLEAR, well >= 0.03 ? archY + BOOT_FLOOR_CLEAR : -Infinity);
    const wall = lerp(hw - 0.06, Math.min(boot.face?.wall ?? hw, hw - 0.06), cut.face);
    const bottom = lerp(hollow, Math.max(boot.face?.sill ?? 0, hollow), cut.face);
    half[0] = [lerp(half[0]![0], wall, cut.open), lerp(half[0]![1], bottom, cut.open)];
    half[1] = [lerp(half[1]![0], wall, cut.open), lerp(half[1]![1], yb - 0.006, cut.open)];
  }
  // The door cut: every point above the rocker drops onto the sill's top, the last tuck row onto its far edge.
  const sill: [number, number][] = [
    [hw - 0.1, rockerY + SILL_ROWS[0]!],
    [hw - 0.07, rockerY + SILL_ROWS[1]!],
    [hw - 0.05, rockerY + SILL_ROWS[2]!],
    [hw - 0.036, rockerY + SILL_ROWS[3]!],
    [hw - 0.029, rockerY + SILL_ROWS[4]!],
    ...Array.from({ length: tuckRows }, (_, row): [number, number] =>
      row === tuckRows - 1
        ? [hw - TUCK + SIDE_OUT, rockerY + SILL_TUCK]
        : [lerp(hw - 0.029, hw - TUCK + SIDE_OUT, (row + 1) / tuckRows), lerp(rockerY + SILL_ROWS[4]!, rockerY + SILL_TUCK, (row + 1) / tuckRows)],
    ),
  ];
  for (let i = 0; i < sill.length; i++) {
    const p = half[i]!;
    p[0] = lerp(p[0], sill[i]![0], hole);
    p[1] = lerp(p[1], sill[i]![1], hole);
  }
  for (let i = FLARE_FIRST; i <= rocker; i++) half[i]![0] += 0.022 * archFlare(z, half[i]![1], wheels, style.arch.radius);
  // The arch lifts every point under it to its edge, but a flat tub floor and, at a well's edge, the floor pan under it.
  const held = (i: number) => (i === 0 && (floorClear || edge !== null)) || (i === half.length - 1 && edge !== null);
  for (let i = 0; i < half.length; i++) {
    const p = half[i]!;
    if (well < 0.03 || p[0] < hw * 0.58 || p[1] > archY + 0.02 || held(i)) continue;
    const t = THREE.MathUtils.smoothstep((p[0] - hw * 0.58) / (hw * 0.42), 0, 1);
    p[1] = Math.max(p[1], lerp(p[1], archY, t));
  }
  return half;
}

/** The wheel-well liner's width across the car (m): it stands over the tyre, or inside the side of a body the tyre stands outboard of. */
export const WELL_LINER_WIDTH = 0.24;

/**
 * Where a tub's floor at `z` meets the well of a wheel under the body (both builds; not the drawn bay's trough, nor a floor clearing the
 * tyres): the liner's inner edge (m, |x|). The floor runs flat out to it, the floor pan holds under it, and the liner, in the cage as in the
 * drawn body, stands up through the floor there as the well's hump, only where the wheel is. Null elsewhere.
 */
function wellEdge(z: number, hw: number, tubT: number, floorClear: boolean, well: number, style: BodyStyle, source: BodySource): number | null {
  if (tubT === 0 || floorClear || well < 0.03 || (source === "drawn" && bayAt(z, style) >= tubT)) return null;
  // A tub only grazing an arch (the coupe's cabin floor ramping out over its rear arch's front edge) keeps the arch's lift.
  const wheel = carFrame(style).wheels.find(([wx, , wz]) => Math.abs(z - wz) < style.arch.radius && Math.abs(wx) <= hw && style.tubs.some(([a, b]) => wz > a && wz < b));
  return wheel ? Math.min(hw - 0.06, Math.abs(wheel[0]) - WELL_LINER_WIDTH / 2) : null;
}

/** The cage's own build has one tuck row, so the cage hull's side below the feature line ends at this half-ring index. */
const CAGE_ROCKER = FLARE_FIRST + TUCK_ROWS.cage + 1;

/**
 * The drawn side stays inside the cage hull: each tuck row the drawn ring added sits on the cage ring's chord at its height, never
 * proud of it. The fender flare is a bump the cage's one tuck row spans with a straight chord, so a drawn row that took the flare at
 * its own height stood up to 2.3 cm outside the hull the cage carries the ground on, and a car resting on its flank sank into the
 * ground by that much.
 */
function holdInsideCageHull(half: [number, number][], cageHalf: readonly (readonly [number, number])[]): void {
  for (let i = FLARE_FIRST + 1; i < ROCKER; i++) {
    const point = half[i]!;
    for (let k = FLARE_FIRST; k < CAGE_ROCKER; k++) {
      const [upperX, upperY] = cageHalf[k]!;
      const [lowerX, lowerY] = cageHalf[k + 1]!;
      if (point[1] > Math.max(upperY, lowerY) || point[1] < Math.min(upperY, lowerY)) continue;
      const chordX = lerp(upperX, lowerX, (upperY - point[1]) / (upperY - lowerY || 1));
      point[0] = Math.min(point[0], chordX);
      break;
    }
  }
}

export function sectionPoints(s: ProfileStation, style: BodyStyle, source: BodySource): Pt[] {
  const half = halfRing(s, style, source);
  if (source === "drawn") holdInsideCageHull(half, halfRing(s, style, "cage"));
  const left = half.map(([x, y]) => ({ x: -x, y }));
  const right = half.map(([x, y]) => ({ x, y })).reverse();
  return [...left, { x: 0, y: floorY(s.z, style) }, ...right];
}

/** The drawn body side's ring points [x, y] at `z` as if no door were cut there, top down from the shoulder's top to the rocker: the door skin's facets. */
export function drawnSideRing(z: number, style: BodyStyle): [number, number][] {
  const s = sampleSlice(z, style.profile);
  const half = halfRing(s, style, "drawn", false);
  holdInsideCageHull(half, halfRing(s, style, "cage", false));
  return half.slice(2, ROCKER + 1);
}

/** The drawn body side's x at height `y` at `z`, uncut by any door: on `drawnSideRing`'s chords over its span, above and below it `sideX` held at the end point's offset off it. */
export function drawnSideX(z: number, y: number, style: BodyStyle): number {
  const ring = drawnSideRing(z, style);
  for (let i = 1; i < ring.length; i++) {
    const [[x0, y0], [x1, y1]] = [ring[i - 1]!, ring[i]!];
    if (y <= y0 && y >= y1 && y0 > y1) return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
  }
  const { hw, yBelt } = sampleSlice(z, style.profile);
  const rockerY = rockerAt(z, style);
  const [ex, ey] = y > ring[0]![1] ? ring[0]! : ring[ring.length - 1]!;
  return sideX(y, hw, yBelt, rockerY) + ex - sideX(ey, hw, yBelt, rockerY);
}

export function loftFromRings(rings: Pt[][], zs: number[], u0: number, u1: number, capsOwnRings = true): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const n = rings[0]!.length;
  const zA = zs[0]!;
  const zSpan = zs[zs.length - 1]! - zA;
  for (let s = 0; s < rings.length; s++) {
    const z = zs[s]!;
    const u = u0 + ((u1 - u0) * (z - zA)) / zSpan;
    const ring = rings[s]!;
    for (let i = 0; i < n; i++) {
      const p = ring[i]!;
      positions.push(p.x, p.y, z);
      uvs.push(u, i / n);
    }
  }
  const indices: number[] = [];
  for (let s = 0; s < rings.length - 1; s++) {
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n;
      const a = s * n + i;
      const b = s * n + i1;
      const c = (s + 1) * n + i;
      const d = (s + 1) * n + i1;
      indices.push(a, b, c, b, d, c);
    }
  }
  // A small loft's end caps are its real hard edges (end panels, 50–90° off the loft): each gets its own copy of the end
  // ring, so the cap shades flat and the loft smooth instead of averaging the corner into both. The copies share rest
  // positions, so they skin (and wrinkle) as one. The body's rolled ends flow into their caps, which share the end ring.
  const cap = (slice: number, inward: boolean) => {
    const ring = rings[slice]!;
    const z = zs[slice]!;
    let cx = 0,
      cy = 0;
    const base = capsOwnRings ? positions.length / 3 : slice * n;
    for (const p of ring) {
      cx += p.x;
      cy += p.y;
      if (!capsOwnRings) continue;
      positions.push(p.x, p.y, z);
      uvs.push(inward ? 0 : 1, 0.5);
    }
    cx /= n;
    cy /= n;
    const turn = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    let area = 0;
    for (let i = 0; i < n; i++) area += turn({ x: cx, y: cy }, ring[i]!, ring[(i + 1) % n]!);
    // A notched end (a boot's face cut) folds the centre's fan over the notch: ear-clip it instead, wound as the fan would be.
    if (ring.some((p, i) => turn({ x: cx, y: cy }, p, ring[(i + 1) % n]!) * area < 0)) {
      const want = inward ? -area : area;
      for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p.x, p.y)), [])) {
        if (turn(ring[a!]!, ring[b!]!, ring[c!]!) * want >= 0) indices.push(base + a!, base + b!, base + c!);
        else indices.push(base + a!, base + c!, base + b!);
      }
      return;
    }
    const center = positions.length / 3;
    positions.push(cx, cy, z);
    uvs.push(inward ? 0 : 1, 0.5);
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n;
      if (inward) indices.push(center, base + i1, base + i);
      else indices.push(center, base + i, base + i1);
    }
  };
  cap(0, true);
  cap(rings.length - 1, false);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.userData.loft = { ring: n, slices: rings.length };
  return geo;
}

/** Flip winding if the area-weighted face normals point at the centroid on balance. */
export function ensureOutwardNormals(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const idx = geo.getIndex();
  if (!idx) return;
  const a = idx.array;
  let cx = 0,
    cy = 0,
    cz = 0;
  for (let i = 0; i < pos.count; i++) {
    cx += pos.getX(i);
    cy += pos.getY(i);
    cz += pos.getZ(i);
  }
  const c = new THREE.Vector3(cx / pos.count, cy / pos.count, cz / pos.count);
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  let flux = 0;
  for (let i = 0; i < a.length; i += 3) {
    p0.fromBufferAttribute(pos, a[i]!);
    p1.fromBufferAttribute(pos, a[i + 1]!);
    p2.fromBufferAttribute(pos, a[i + 2]!);
    e1.subVectors(p1, p0);
    e2.subVectors(p2, p0);
    e1.cross(e2);
    flux += e1.dot(p0.add(p1).add(p2).multiplyScalar(1 / 3).sub(c));
  }
  if (flux < 0) {
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1]!;
      a[i + 1] = a[i + 2]!;
      a[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
  geo.computeVertexNormals();
}

/** Roof crown above the cant line at the centre line (m): the roof panel's gentle dome. */
export const ROOF_CROWN = 0.026;
/** The dome's shoulder: [share of the roof half-width, rise above the cant line (m)]. */
export const ROOF_SHOULDER = [0.45, 0.018] as const;

/** A deck lid's top stands `LID_RISE` (m) over its station's belt, `DECK_INSET` (m) inside its half-width, domed `DECK_DOME` (m) at the centre line and 0.7 of that at `DECK_SHOULDER` of its half-width. */
const LID_RISE = 0.016;
const DECK_INSET = 0.075;
const DECK_DOME = 0.012;
const DECK_SHOULDER = 0.45;
/** The drawn hood's edge stands over the deck edge (ring point 1, `HOOD_INSET` m inside the station's half-width), `HOOD_SEAT` (m) over the fender: a groove, not a step; its outer dome point stands `HOOD_SEAT` over the closed deck's crown. Its centre line keeps the deck lid's crown unless the style sets `hood.crown`. */
const HOOD_INSET = 0.07;
const HOOD_SEAT = 0.003;
/** Where a boot lip's extra rings stand, as shares of its depth from the edge: the kick's curve needs them on a 6 cm ring spacing. */
const LIP_RINGS = [0.5, 1] as const;
/** A clamshell lid's skin laps the body it wraps this far (m) clear in x and y: flush to the eye, never coincident with it. */
const CLAMSHELL_GAP = 0.001;

/** A lid's dome across it: [share of the half-width, share of the crown's rise over the edge] points from the centre line out, both ends left out. */
type Dome = readonly (readonly [number, number])[];
/** A deck lid's dome: 0.7 of its rise at `DECK_SHOULDER` of its half-width. */
const DECK_DOME_POINTS: Dome = [[DECK_SHOULDER, 0.7]];
/** A crowned hood's dome (`hood.crown`): its parabola across x, 1 - u², drawn in this many chords a side, each turning under 5° on the sedan's 6 cm at |x| .66. */
const CROWN_CHORDS = 4;
const CROWN_DOME: Dome = Array.from({ length: CROWN_CHORDS - 1 }, (_, k) => [(k + 1) / CROWN_CHORDS, 1 - ((k + 1) / CROWN_CHORDS) ** 2] as const);

/** A dome's share of its rise at `u` (share of the half-width): straight between its points, as the loft draws it. */
function domeAt(dome: Dome, u: number): number {
  let [u0, v0] = [0, 1];
  for (const [u1, v1] of [...dome, [1, 0] as const]) {
    if (u <= u1) return lerp(v0, v1, (u - u0) / (u1 - u0));
    [u0, v0] = [u1, v1];
  }
  return 0;
}

/** A deck lid's half-width, its top's heights (car frame, m) at `z` at its edge and at its crown, and its dome. A `seated` lid's edge (the drawn hood's, a flush boot lid's) rests on the deck edge beside it; `crowned` domes it as `hood.crown`. */
function lidSection(z: number, style: BodyStyle, seated: boolean, crowned: BodyStyle["hood"]["crown"]): { w: number; edge: number; crown: number; dome: Dome } {
  const sl = sampleSlice(z, style.profile);
  const crown = sl.yBelt + LID_RISE + DECK_DOME;
  if (!seated) return { w: sl.hw - DECK_INSET, edge: sl.yBelt + LID_RISE, crown, dome: DECK_DOME_POINTS };
  const w = sl.hw - HOOD_INSET;
  // A rigid lid: its edge keeps the fender's height where a cabin tub's blend runs under its rear end (the coupe's and monster's), never bending into it.
  const edge = deckEdgeY(sl.yBelt, 0) + HOOD_SEAT;
  if (crowned !== undefined) return { w, edge, crown: edge + crowned[0] * (w / crowned[1]) ** 2, dome: CROWN_DOME };
  // The deck dome's chord from its shoulder to the edge passes within a millimetre of the closed deck's crown point: the dome steps out over it.
  const u = (sl.hw - DECK_CROWN.inset) / w;
  const over = (sl.yBelt + DECK_CROWN.rise + HOOD_SEAT - edge) / (crown - edge);
  return { w, edge, crown, dome: [[u, Math.max(domeAt(DECK_DOME_POINTS, u), over)]] };
}

/** Height (car frame, m) of a deck lid's top at (`x`, `z`), as `makeDeckPanel` lofts it: the drawn `hood`'s, or a plain lid's. */
export function deckTopY(x: number, z: number, style: BodyStyle, hood: boolean): number {
  const { w, edge, crown, dome } = lidSection(z, style, hood, hood ? style.hood.crown : undefined);
  return lerp(edge, crown, domeAt(dome, Math.min(Math.abs(x) / w, 1)));
}

/** How far (m) a boot lip lifts the panel `d` (m) in from its free edge: a quadratic kick from 0 at `depth` to `rise` at the edge. */
function lipKick(d: number, lip: BootLip | undefined): number {
  if (!lip || d >= lip.depth) return 0;
  const t = 1 - d / lip.depth;
  return lip.rise * t * t;
}

/** `count + 1` loft stations from 0 to 1, plus a lip's rings near the free end at 1 (`span` m long). */
function panelStations(count: number, lip: BootLip | undefined, span: number): number[] {
  const ts = Array.from({ length: count + 1 }, (_, s) => s / count);
  if (lip) for (const share of LIP_RINGS) ts.push(1 - (share * lip.depth) / span);
  return ts.sort((a, b) => a - b);
}

/** A wrapping lid's fold over the tail edge: its radius (m), its quarter turn's rings, and the face's rings below it. */
const LID_FOLD_R = 0.08;
const LID_FOLD_STEPS = 3;
const LID_FACE_STEPS = 2;

/**
 * Lid lofted on the deck line (hood / trunk), local to its hinge origin. The drawn `hood` rests on the fenders (`lidSection`) and takes
 * the nose's rings (`noseRefined`); a `clamshell` lid wraps the body's shoulder to its side shut line; a `lip` kicks its top up at its end;
 * a `drop` folds it over the tail edge and down the rear face to `drop.y`, `drop.w` wide, the face at `z1`.
 */
function makeDeckPanel(
  style: BodyStyle,
  z0: number,
  z1: number,
  origin: YZ,
  source: BodySource,
  { hood = false, seated = hood, clamshell = false, lip, drop }: { hood?: boolean; seated?: boolean; clamshell?: boolean; lip?: BootLip; drop?: LidDrop } = {},
): THREE.BufferGeometry {
  const segs = 10;
  const tk = 0.04;
  const skirt = 0.06;
  const [oy, oz] = origin;
  const ring = (w: number, y: number, edge: number, crown: number, dome: Dome): Pt[] => {
    const points = dome.map(([u, v]) => ({ x: w * u, y: lerp(edge, crown, v) }));
    return [
      { x: -w, y: edge },
      ...points.map((p) => ({ x: -p.x, y: p.y })).reverse(),
      { x: 0, y: crown },
      ...points,
      { x: w, y: edge },
      { x: w, y: y - skirt * 0.55 },
      { x: w, y: y - skirt },
      { x: w - tk, y: y - skirt },
      { x: w - tk, y: y - tk },
      { x: -w + tk, y: y - tk },
      { x: -w + tk, y: y - skirt },
      { x: -w, y: y - skirt },
      { x: -w, y: y - skirt * 0.55 },
    ];
  };
  const fold = drop ? LID_FOLD_R : 0;
  const zEnd = z1 + fold;
  const rings: Pt[][] = [];
  const zs: number[] = [];
  const stations = panelStations(segs, lip, Math.abs(zEnd - z0)).map((t) => lerp(z0, zEnd, t));
  for (const z of hood ? noseRefined(stations, style.profile) : stations) {
    const sl = sampleSlice(z, style.profile);
    const lid = lidSection(z, style, seated, hood ? style.hood.crown : undefined);
    const kick = lipKick(Math.abs(zEnd - z), lip);
    const r = ring(lid.w, sl.yBelt + LID_RISE - oy, lid.edge - oy + kick, lid.crown - oy + kick, lid.dome);
    if (clamshell) wrapShoulder(r, sectionPoints(sl, style, "drawn"), oy, tk);
    rings.push(r);
    zs.push(z - oz);
  }
  // The fold and the face are lofted straight on past the deck's end (z = path length), then bent onto the tail below.
  const end = sampleSlice(zEnd, style.profile);
  const wEnd = end.hw - DECK_INSET;
  const yc = end.yBelt + LID_RISE - oy - fold;
  const zA = zEnd - oz;
  const arc = (fold * Math.PI) / 2;
  if (drop) {
    const run = arc + yc - (drop.y - oy);
    for (let k = 1; k <= LID_FOLD_STEPS + LID_FACE_STEPS; k++) {
      rings.push(ring(wEnd, 0, 0, DECK_DOME, DECK_DOME_POINTS));
      zs.push(zA - (k <= LID_FOLD_STEPS ? (k / LID_FOLD_STEPS) * arc : arc + ((k - LID_FOLD_STEPS) / LID_FACE_STEPS) * (run - arc)));
    }
  }
  const geo = loftFromRings(rings, zs, 0, 1);
  if (drop) {
    const lean = ((drop.z ?? z1) - z1) / (yc - (drop.y - oy));
    bendOverTail(geo.getAttribute("position") as THREE.BufferAttribute, zA, yc, drop.w / wEnd, lean);
  }
  ensureOutwardNormals(geo);
  if (source === "drawn") splitCreases(geo, CREASE_DEGREES.deckLid);
  geo.computeBoundingBox();
  return geo;
}

/**
 * Bends the straight run lofted past `zA` (its z the path length, its y the offset off the panel) a quarter turn down over the
 * tail edge, about the fold's centre (`yc`, `zA`), then down the face, `lean` m of z per m down; x scales to `wFace` × on the way round.
 */
function bendOverTail(pos: THREE.BufferAttribute, zA: number, yc: number, wFace: number, lean: number): void {
  const arc = (LID_FOLD_R * Math.PI) / 2;
  for (let i = 0; i < pos.count; i++) {
    const s = zA - pos.getZ(i);
    if (s < 1e-9) continue;
    const turn = Math.min(s / LID_FOLD_R, Math.PI / 2);
    const r = LID_FOLD_R + pos.getY(i);
    const down = Math.max(0, s - arc);
    pos.setXYZ(i, pos.getX(i) * lerp(1, wFace, turn / (Math.PI / 2)), yc + r * detCos(turn) - down, zA - r * detSin(turn) + lean * down);
  }
}

/**
 * A clamshell: the lid ring's top edge and skirt laid `CLAMSHELL_GAP` over the body ring's deck edge and shoulder (`body`: its right half
 * ends shoulder 30°, shoulder 60°, deck edge, crown), down to the 30° point, the side shut line.
 */
function wrapShoulder(ring: Pt[], body: readonly Pt[], oy: number, tk: number): void {
  const top = body[body.length - 2]!;
  const upper = body[body.length - 3]!;
  const shut = body[body.length - 4]!;
  for (const sign of [1, -1]) {
    const last = ring.length - 1;
    const [rim, over, edge, inner] = sign > 0 ? [last - 8, last - 7, last - 6, last - 5] : [0, last, last - 1, last - 2];
    ring[rim] = { x: ring[rim]!.x, y: top.y + CLAMSHELL_GAP - oy };
    ring[over] = { x: sign * (upper.x + CLAMSHELL_GAP), y: upper.y + CLAMSHELL_GAP - oy };
    ring[edge] = { x: sign * (shut.x + CLAMSHELL_GAP), y: shut.y - oy };
    ring[inner] = { x: sign * (shut.x + CLAMSHELL_GAP - tk), y: shut.y - oy };
  }
}

/** Under a clamshell's side shut line the drawn body's 30° shoulder point steps in this far (m): the lid's edge meets a groove, not a step. */
const SHUT_RECESS = 0.003;
/** The groove ramps in over this run (m) inside each lid end, between body slices of its own (`sliceZs`), so no dent shows past the lid. */
export const SHUT_RAMP = 0.02;
/** The section ring's left 30° shoulder point (after the deck crown, the deck edge and the 60° point); the right one mirrors it. */
const SHUT_POINT = 1 + SHOULDER_RING.length;

/** Steps the drawn body ring's shut-line points (`wrapShoulder`'s `shut`) in under a clamshell lid at `z`. */
export function recessShutLine(ring: Pt[], z: number, style: BodyStyle): void {
  if (style.hood.kind !== "clamshell") return;
  const { z0, z1 } = style.hood;
  const recess = SHUT_RECESS * THREE.MathUtils.smoothstep(z, z0, z0 + SHUT_RAMP) * (1 - THREE.MathUtils.smoothstep(z, z1 - SHUT_RAMP, z1));
  ring[SHUT_POINT]!.x += recess;
  ring[ring.length - 1 - SHUT_POINT]!.x -= recess;
}

/** Without an `outline`, the tailgate stops this far (m) inside the tail panel's half-width: the tail lamps stand upright in the corners. */
const TAILGATE_INSET = 0.135;
/** A tailgate's (and the infill beside its step) thickness (m). */
const TAILGATE_TK = 0.03;
/** The shut line (m) between a stepped tailgate's edge and the infill panel beside it. */
const SEAM_GAP = 0.004;

type Tailgate = Extract<BootSpec, { kind: "tailgate" }>;

/** A tailgate's half-width (m) at height `y`: its `outline` there (held past its ends), or its tail panel's half-width less `TAILGATE_INSET`. */
export function tailgateHalf(style: BodyStyle, y: number): number {
  const b = style.boot;
  if (b.kind !== "tailgate") throw new Error(`${style.id}: its boot is no tailgate`);
  const o = b.outline;
  if (!o) return sampleSlice(b.origin[1], style.profile).hw - TAILGATE_INSET;
  let i = 1;
  while (i < o.length - 1 && y < o[i]![1]) i++;
  const [xa, ya] = o[i - 1]!;
  const [xb, yb] = o[i]!;
  return lerp(xa, xb, THREE.MathUtils.clamp((ya - y) / (ya - yb || 1), 0, 1));
}

/** A tailgate's bottom edge, its outline's corners between, and its top edge (m), bottom to top. */
function gateHeights(b: Tailgate): number[] {
  const top = b.origin[0];
  const corners = (b.outline ?? []).map(([, y]) => y).filter((y) => (y - b.y0) * (y - top) < 0);
  return [b.y0, ...corners, top].sort((p, q) => p - q);
}

/** Rings lofted up a tailgate's lean (each ring [x, out] at height `ys[k]`), as geometry relative to its top edge `origin`. */
function gateLoft(rings: Pt[][], ys: number[], b: Tailgate): THREE.BufferGeometry {
  const [y1, oz] = b.origin;
  const geo = loftFromRings(rings, ys.map((y) => y - y1), 0, 1);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const lean = ((b.z0 ?? oz) - oz) / (b.y0 - y1);
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i), pos.getZ(i), -(pos.getY(i) - pos.getZ(i) * lean));
  ensureOutwardNormals(geo);
  return geo;
}

/** Hatch / tailgate: a slightly bowed panel leaning from its bottom edge [y0, z0] up to its hinge at its top edge, its edge on `tailgateHalf`; a `lip` kicks its top edge out. */
function makeTailgate(style: BodyStyle, b: Tailgate, source: BodySource, lip?: BootLip): THREE.BufferGeometry {
  const { y0 } = b;
  const [y1] = b.origin;
  const bow = 0.02;
  const segs = 5;
  const corners = gateHeights(b).slice(1, -1).map((y) => (y - y0) / (y1 - y0));
  // The bow is one parabola over the widest span and its inner lines stand at half the narrowest width, so its lines run smooth past a
  // step in the outline (a narrower stretch's edge stands a little proud of the body beside it).
  const widths = gateHeights(b).map((y) => tailgateHalf(style, y));
  const mid = Math.min(...widths) * 0.5;
  const wide = Math.max(...widths);
  const bowAt = (x: number) => bow * (1 - (x / wide) ** 2);
  const rings: Pt[][] = [];
  const ys: number[] = [];
  for (const t of [...panelStations(segs, lip, Math.abs(y1 - y0)), ...corners].sort((p, q) => p - q)) {
    const y = lerp(y0, y1, t);
    const out = lipKick(y1 - y, lip);
    const w = tailgateHalf(style, y);
    rings.push([
      { x: -w, y: bowAt(w) + out },
      { x: -mid, y: bowAt(mid) + out },
      { x: 0, y: bow + out },
      { x: mid, y: bowAt(mid) + out },
      { x: w, y: bowAt(w) + out },
      { x: w, y: -TAILGATE_TK },
      { x: -w, y: -TAILGATE_TK },
    ]);
    ys.push(y);
  }
  const geo = gateLoft(rings, ys, b);
  if (source === "drawn") splitCreases(geo, CREASE_DEGREES.tailgate);
  geo.computeBoundingBox();
  return geo;
}

/**
 * Beside a stepped tailgate (its outline narrower than the face's cut, the hatch's under its lamps), the drawn body's tail panel on each
 * side: flush with the gate's edge, from a `SEAM_GAP` shut line off it out over the cut's edge, up to where the gate fills the cut.
 * Car frame; none without an outline.
 */
export function bootInfill(style: BodyStyle): THREE.BufferGeometry[] {
  const b = style.boot;
  const face = bootCut(style).face;
  if (b.kind !== "tailgate" || !b.outline || !face) return [];
  const [y1, oz] = b.origin;
  const lean = ((b.z0 ?? oz) - oz) / (b.y0 - y1);
  const ys: number[] = [];
  const spans: [number, number][] = [];
  for (const y of gateHeights(b)) {
    const outer = Math.min(face.wall, sampleSlice(oz + (y - y1) * lean, style.profile).hw - 0.06) + BOOT_LAP;
    const inner = tailgateHalf(style, y) + SEAM_GAP;
    const filled = inner >= outer - SEAM_GAP;
    if (filled && ys.length === 0) continue;
    ys.push(y);
    spans.push([Math.min(inner, outer - SEAM_GAP), outer]);
    if (filled) break;
  }
  if (spans.length < 2) return [];
  return [1, -1].map((side) => {
    const rings = spans.map(([inner, outer]): Pt[] => [
      { x: side * inner, y: 0 },
      { x: side * outer, y: 0 },
      { x: side * outer, y: -TAILGATE_TK },
      { x: side * inner, y: -TAILGATE_TK },
    ]);
    const geo = gateLoft(rings, ys, b);
    geo.translate(0, y1, oz);
    return geo;
  });
}

/** Bonnet lid per style; the drawn build rests on the fenders, or wraps a `clamshell` lid over them (the hood bulge is `withHoodBulge`'s). Local to `style.hood.origin`. */
export function makeHoodGeometry(style: BodyStyle = SEDAN, source: BodySource = "drawn"): THREE.BufferGeometry {
  const { z0, z1, origin, kind } = style.hood;
  const drawn = source === "drawn";
  const geo = makeDeckPanel(style, z0, z1, origin, source, { hood: drawn, clamshell: drawn && kind === "clamshell" });
  if (source === "drawn") {
    // Its underside, the lid over the bay, is an unpainted inner panel.
    const normal = geo.getAttribute("normal");
    const primer = new Float32Array(normal.count);
    for (let v = 0; v < normal.count; v++) if (normal.getY(v) < -0.5) primer[v] = INNER_PANEL;
    geo.setAttribute(PRIMER_ATTRIBUTE, new THREE.BufferAttribute(primer, 1));
  }
  return markSkinDynamic(geo);
}

/** Trunk lid, hatch or tailgate per style, the drawn build with its `lip`; local to the boot's pivot (`bootPivot`, [y, z]). */
export function makeTrunkGeometry(style: BodyStyle = SEDAN, source: BodySource = "drawn"): THREE.BufferGeometry {
  const b = style.boot;
  const lip = source === "drawn" ? b.lip : undefined;
  const g = b.kind === "lid" ? makeDeckPanel(style, b.z0, b.z1, b.origin, source, { lip, drop: b.drop, seated: source === "drawn" && b.flush === true }) : makeTailgate(style, b, source, lip);
  const [py, pz] = bootPivot(b);
  if (py !== b.origin[0] || pz !== b.origin[1]) g.translate(0, b.origin[0] - py, b.origin[1] - pz);
  return markSkinDynamic(g);
}

/** How far inside the body side (m) a bumper's wrapped corner is held: a tail or nose narrower than the fascia would show the corner through the skin. */
const BUMPER_TUCK = 0.01;
/** The fascia's section shrinks by this share at its wrapped end. */
const BUMPER_WRAP_SHRINK = 0.228;
/** The fascia top's crown runs out this far (m) past each end of its span. */
const BUMPER_CROWN_RUN = 0.03;
/** A lofted bumper end's segments per side: the flat face, the corner (18° each), the near-straight run along the body side; 16 in all, as the plain wrap's. */
const END_SEGMENTS = { face: 2, corner: 5, run: 1 } as const;
/** A lofted end's section thins to this share of its corner's tightest radius, so its hidden back never folds through itself. */
const END_DEPTH_SHARE = 0.9;

/** Bumper fascia: rounded top, intake recess, splitter lip, wrapped corners, the corners held inside `style`'s body side (or a lofted `wrap.end`). */
export function makeBumperGeometry(front: boolean, style: BodyStyle): THREE.BufferGeometry {
  const s = front ? 1 : -1;
  const spec = front ? style.bumpers.front : style.bumpers.rear;
  if (spec.wrap.end) return makeBumperWithEnds(s, spec, spec.wrap.end, style);
  const { seat, fascia, span, wrap } = spec;
  const wrapAt = (x: number) => Math.max(0, Math.abs(x) - wrap.from) / (span - wrap.from);
  const stations = 16;
  const rings: Pt[][] = [];
  const xs: number[] = [];
  const wraps: number[] = [];
  for (let i = 0; i <= stations; i++) {
    const x = lerp(-span, span, i / stations);
    const u = wrapAt(x);
    const crown = (1 - Math.abs(x) / (span + BUMPER_CROWN_RUN)) * 0.02;
    rings.push(fascia.map(([y, out]) => ({ x: y + crown, y: out * (1 - u * BUMPER_WRAP_SHRINK) })));
    xs.push(x);
    wraps.push(u);
  }
  const geo = loftFromRings(rings, xs, 0, 1);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const n = fascia.length;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getZ(i);
    const ring = Math.min(stations, Math.floor(i / n));
    const u = i < (stations + 1) * n ? wraps[ring]! : wrapAt(x);
    const y = pos.getX(i);
    const z = s * (pos.getY(i) - u * wrap.back);
    const slice = sampleSlice(s * seat.z + z, style.profile);
    const side = sideX(seat.y + y, slice.hw, slice.yBelt, rockerAt(s * seat.z + z, style)) - BUMPER_TUCK;
    pos.setXYZ(i, Math.sign(x) * Math.min(Math.abs(x), side), y, z);
  }
  ensureOutwardNormals(geo);
  return splitCreases(geo, CREASE_DEGREES.bumper);
}

/**
 * Bumper fascia with lofted ends: the face straight to `wrap.from`, a quarter-ellipse corner `end.corner` deep out to `end.stand`
 * off the body side, then a run along that side to `wrap.back`. The section keeps its outer face and thins its hidden back round the corner.
 */
function makeBumperWithEnds(s: number, { seat, fascia, span, wrap }: BodyStyle["bumpers"]["front"], end: BumperEnd, style: BodyStyle): THREE.BufferGeometry {
  const outMax = Math.max(...fascia.map(([, out]) => out));
  const depth = outMax - Math.min(...fascia.map(([, out]) => out));
  // The body side's widest half-width (m) over the fascia's heights, `d` back from the bumper's face.
  const skinAt = (d: number) => {
    const z = s * (seat.z + outMax - d);
    const slice = sampleSlice(z, style.profile);
    const rocker = rockerAt(z, style);
    return Math.max(...fascia.map(([y]) => sideX(seat.y + y, slice.hw, slice.yBelt, rocker)));
  };
  const [a, b] = [skinAt(end.corner) + end.stand - wrap.from, end.corner];
  const thin = Math.min(1, (END_DEPTH_SHARE * b * b) / (a * depth));
  const { face, corner, run } = END_SEGMENTS;
  const half = face + corner + run;
  // Per ring from the middle out: the outer face's plan point (x, d back from the face), its outward normal, its section's depth share.
  const path: { x: number; d: number; nx: number; nd: number; k: number }[] = [];
  for (let m = 0; m <= half; m++) {
    if (m <= face) {
      path.push({ x: (wrap.from * m) / face, d: 0, nx: 0, nd: -1, k: 1 });
    } else if (m <= face + corner) {
      const q = ((m - face) / corner) * (Math.PI / 2);
      const [sin, cos] = [detSin(q), detCos(q)];
      const len = hypot2(b * sin, a * cos);
      path.push({ x: wrap.from + a * sin, d: b * (1 - cos), nx: (b * sin) / len, nd: (-a * cos) / len, k: 1 - (1 - thin) * sin * sin });
    } else {
      const d = lerp(b, wrap.back, (m - face - corner) / run);
      path.push({ x: skinAt(d) + end.stand, d, nx: 1, nd: 0, k: thin });
    }
  }
  const rings: Pt[][] = [];
  const ts: number[] = [];
  for (let m = -half; m <= half; m++) {
    const p = path[Math.abs(m)]!;
    const crown = (1 - Math.min(p.x, span) / (span + BUMPER_CROWN_RUN)) * 0.02;
    rings.push(fascia.map(([y, out]) => ({ x: y + crown, y: (out - outMax) * p.k })));
    ts.push(m / half);
  }
  const geo = loftFromRings(rings, ts, 0, 1);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getZ(i);
    const p = path[Math.round(Math.abs(t) * half)]!;
    const inset = pos.getY(i);
    pos.setXYZ(i, Math.sign(t) * (p.x + p.nx * inset), pos.getX(i), s * (outMax - p.d - p.nd * inset));
  }
  ensureOutwardNormals(geo);
  return splitCreases(geo, CREASE_DEGREES.bumper);
}
