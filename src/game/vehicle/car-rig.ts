/**
 * A body style's sim frame: its rig (`StreamedDeformation`'s cages, sensors, masses and tyre, and the heights and reaches its skin and
 * crush read off them), where its wheels stand, its body box, centre of mass and inertia, and the underside its rigid step rests on.
 * One frame per style, built once: the platform's tables, tuned on `PLATFORM_DIMS` and `PLATFORM_CABIN`, carried onto the car by its
 * own dims' and cabin's offsets from those. Zero offsets leave every number as it was.
 */
import * as THREE from "three";
import { PLATFORM_TYRE, type CageSpec, type MassSpec, type SensorSpec } from "../kernel/rig-spec.ts";
import { PLATFORM_RIG, type RigTables } from "../deform/deform-rig.ts";
import type { FaceBands } from "../deform/load-crush.ts";
import { CAR_STYLE_IDS, CAR_STYLES, type BodyStyle } from "./car-variants.ts";
import { PLATFORM_CABIN, PLATFORM_DIMS, PLATFORM_HARDPOINTS } from "./car-styles/platform.ts";
import { CLASSES, STYLE_CLASS } from "./vehicle-classes.ts";
import { floorY } from "./car-lines.ts";

type V3 = readonly [number, number, number];
type Dims = BodyStyle["dims"];

/** The platform's body box (half extents, m) every table below was tuned on. */
export const PLATFORM_HALF = { x: 0.88, y: 0.68, z: 2.22 } as const;
/**
 * The plan length (half length; m) a car meets a solid with: the drawn body with its mirrors and a margin, longer than `half`
 * (the body's own box). The look-ahead of a hard-driving car reads it too (`markApproaches`).
 */
const PLATFORM_FOOT_HALF_L = 2.3;
/** Centre of mass above the group's origin (car-local y, m); the origin is on the ground under the body's middle. */
const PLATFORM_COM_Y = 0.55;
/**
 * The body's underside (x, z, height m over the ground at the stock ride with no class lift), read off the skinned
 * wreck mesh of every style (sedan, wagon, coupe, hatchback and pickup alike): the keel along the middle, rising to
 * the tail, and the rocker and bumper corners 0.8 m out. The wheel arches are cut out and left out.
 */
const PLATFORM_UNDERSIDE: readonly V3[] = [
  [0, 2, 0.032], [0, 1, 0.072], [0, 0, 0.131], [0, -1, 0.136], [0, -2, 0.161],
  ...([-0.8, 0.8] as const).flatMap((x) => [[x, 2, 0.051], [x, 1, 0.101], [x, 0, 0.134], [x, -0.5, 0.147], [x, -2, 0.169]] as const),
];
/** `PLATFORM_UNDERSIDE` rows of the keel and of the right rocker at the belly's cross rows (z 2, 1, 0 and −2 on the platform). */
const BELLY_KEEL_ROWS = [0, 1, 2, 4] as const;
const BELLY_ROCKER_ROWS = [10, 11, 12, 14] as const;
/** The belly's points between keel and rocker: this far out (m, on the platform) at this share of the way from the keel's height to the rocker's. */
const BELLY_MID_X = 0.5;
const BELLY_MID_SHARE = 0.625;
/** The underside's height (m) at each hub's plan position (a front hub's is the bumper corner's, a rear hub's the tail's). */
const PLATFORM_SILL = [0.084, 0.084, 0.157, 0.157] as const;
/** The pan's half width and half length (m). */
const PAN_HALF = 0.35;
/** A bumper's bottom corner over the tyre plane (m): `hullUnder`'s corner rows. */
const BUMPER_UNDER = 0.35;
/** The cage lattice's half extents (m) on the platform: the body (x ±0.91, z ±2.11) and the skin's 1.35 m travel cap, trimmed. A bigger body widens it by its own growth. */
const PLATFORM_LATTICE = { x: 1.2, z: 2.4 } as const;
/** The roof cage's reach (m) over the roof's own top on a body carrying a light bar: the bar skins with the roof, never clamped flat at the cage top. */
const LIGHT_BAR_ROOM = 0.18;
/** A tailgate's boot cage about its panel (m): behind and ahead of its hinge line, below its foot and above its hinge (fitted on the first hatchback). */
const TAILGATE_CAGE = { back: 0.065, ahead: 0.395, below: 0.04, above: 0.07 } as const;
/** The boot sensor on a tailgate: this far over its panel's middle and ahead of its hinge line (m). */
const TAILGATE_SENSOR = { up: 0.015, ahead: 0.135 } as const;
/** The crush sensor (`SENSORS` index) that follows the boot. */
const BOOT_SENSOR = 18;
const HUB_NAMES = ["hubFL", "hubFR", "hubRL", "hubRR"] as const;

export interface CarFrame {
  /** What the car's `StreamedDeformation` builds from. */
  readonly rig: RigTables;
  /** Hub rests (car-local m) in FL, FR, RL, RR order: the tyre's centre over its contact patch. */
  readonly wheels: readonly V3[];
  /** The hubs' x and z (`wheels`' columns), for the per-slice loops. */
  readonly wx: Float64Array;
  readonly wz: Float64Array;
  /** Half the wheelbase and half the track (m). */
  readonly halfBase: number;
  readonly halfTrack: number;
  /** The body's own box (half extents, m). */
  readonly half: { readonly x: number; readonly y: number; readonly z: number };
  /** The plan half length (m) the car meets a solid with: its body with its mirrors and a margin. */
  readonly footHalfL: number;
  /** Centre of mass over the group's origin (m), and as a car-local point. */
  readonly comY: number;
  readonly centre: THREE.Vector3;
  /** Inverse inertia per unit mass (1/m²) of the body's box about its centre of mass: car-local x, y, z. */
  readonly invI: THREE.Vector3;
  /** The underside's samples, rows of car-local x, z and height over the tyre plane (stock ride, no class lift). */
  readonly underside: readonly V3[];
  /** The underside's height (m) under each hub, `wheels` order. */
  readonly sill: readonly number[];
  /** The belly's centre patch under the cabin (car-local x, height, z): six points on the underside's plane there. */
  readonly pan: readonly V3[];
  /**
   * The belly (car-local x, height, z): the underside's keel and rockers, the belly between them either side of the keel (its height
   * interpolated), so a car on another's flat roof rests on its width, not balanced on the keel line, and the pan last.
   */
  readonly belly: readonly V3[];
  /** What the body bottoms out on: the underside's samples and the bumpers' bottom corners, rows of x, z, height. */
  readonly hullUnder: Float64Array;
  /** The cage lattice's half extents (m): room for the body and the skin's travel. */
  readonly lattice: { readonly x: number; readonly z: number };
}

/** A car's offsets from the platform: displacement (m) at the platform's knots along z (tail face, rear axle, front axle, nose face) and up y (ground, floor, crown), and its width's scale across x. */
interface Warp {
  readonly zAt: readonly number[];
  readonly zBy: readonly number[];
  readonly yAt: readonly number[];
  readonly yBy: readonly number[];
  readonly xScale: number;
}

const knotsZ = (d: Dims): number[] => [-(d.wheelbase / 2 + d.overhang.rear), -d.wheelbase / 2, d.wheelbase / 2, d.wheelbase / 2 + d.overhang.front];
const knotsY = (d: Dims): number[] => [0, d.rideHeight, d.height];
const lengthOf = (d: Dims): number => d.overhang.front + d.wheelbase + d.overhang.rear;

function warpOf(dims: Dims): Warp {
  const zAt = knotsZ(PLATFORM_DIMS);
  const yAt = knotsY(PLATFORM_DIMS);
  const z = knotsZ(dims);
  const y = knotsY(dims);
  return { zAt, zBy: z.map((v, i) => v - zAt[i]!), yAt, yBy: y.map((v, i) => v - yAt[i]!), xScale: dims.width / PLATFORM_DIMS.width };
}

/** The displacement at `v` of knots `at` moved by `by`: linear between knots, held past the ends. */
function shift(at: readonly number[], by: readonly number[], v: number): number {
  if (v <= at[0]!) return by[0]!;
  for (let i = 1; i < at.length; i++) if (v <= at[i]!) return by[i - 1]! + ((by[i]! - by[i - 1]!) * (v - at[i - 1]!)) / (at[i]! - at[i - 1]!);
  return by[at.length - 1]!;
}

const dzOf = (w: Warp, z: number): number => shift(w.zAt, w.zBy, z);
const dxOf = (w: Warp, x: number): number => x * (w.xScale - 1);

function warped(w: Warp, p: V3): [number, number, number] {
  return [p[0] + dxOf(w, p[0]), p[1] + shift(w.yAt, w.yBy, p[1]), p[2] + dzOf(w, p[2])];
}

function warpedCage(w: Warp, base: CageSpec): CageSpec {
  return { ...base, min: warped(w, base.min), max: warped(w, base.max) };
}

/** A cage face's offset (m) at the platform coordinate it stands at. */
type Shift = (c: number) => number;
const lifted = (d: number): Shift => () => d;
/** The affine map taking the platform's panel span [p0, p1] onto the car's [q0, q1]: a cage keeps its margins about its panel in proportion, as the lattice's slack (a share of the cage's size) does. */
const spanned = (p0: number, p1: number, q0: number, q1: number): Shift => (c) => q0 - p0 + (c - p0) * ((q1 - q0) / (p1 - p0) - 1);

/** A platform cage with its y and z faces moved by `dy` and `dz`, its top raised a further `topRoom` (m); x scales with the body's width. */
function moved(base: CageSpec, xScale: number, dy: Shift, dz: Shift, topRoom = 0): CageSpec {
  return {
    ...base,
    min: [base.min[0] + base.min[0] * (xScale - 1), base.min[1] + dy(base.min[1]), base.min[2] + dz(base.min[2])],
    max: [base.max[0] + base.max[0] * (xScale - 1), base.max[1] + dy(base.max[1]) + topRoom, base.max[2] + dz(base.max[2])],
  };
}

/** A wrapping lid's cage reaches this far (m) below and behind its face, so the face skins inside it. */
const LID_DROP_ROOM = 0.02;

function bootCage(boot: BodyStyle["boot"], base: CageSpec, xScale: number): CageSpec {
  if (boot.kind === "lid") {
    const P = PLATFORM_CABIN.boot;
    const cage = moved(base, xScale, lifted(boot.origin[0] - P.origin[0]), spanned(P.z1, P.z0, boot.z1, boot.z0));
    if (!boot.drop) return cage;
    const back = Math.min(boot.z1, boot.drop.z ?? boot.z1);
    return { ...cage, min: [cage.min[0], Math.min(cage.min[1], boot.drop.y - LID_DROP_ROOM), Math.min(cage.min[2], back - LID_DROP_ROOM)] };
  }
  // A leaning tailgate's foot (`z0`) stands behind or ahead of its top edge: the cage spans both.
  const [y, z] = boot.origin;
  const foot = boot.z0 ?? z;
  const x = base.max[0] + base.max[0] * (xScale - 1);
  return { ...base, min: [-x, boot.y0 - TAILGATE_CAGE.below, Math.min(z, foot) - TAILGATE_CAGE.back], max: [x, y + TAILGATE_CAGE.above, Math.max(z, foot) + TAILGATE_CAGE.ahead] };
}

/** The cages wrapping the cabin's panels, the hood and the boot: carried by the car's own panel offsets from the platform's, not by the body's warp. */
function cabinCage(style: BodyStyle, base: CageSpec, xScale: number): CageSpec | null {
  const P = PLATFORM_CABIN;
  const H = PLATFORM_HARDPOINTS;
  const glass = style.rearGlass;
  switch (base.name) {
    case "roof": {
      const dy = spanned(P.windshieldTop[0], PLATFORM_DIMS.height, style.windshieldTop[0], style.dims.height);
      return moved(base, xScale, dy, spanned(P.roofZ[0], P.roofZ[1], style.roofZ[0], style.roofZ[1]), style.lightBar ? LIGHT_BAR_ROOM : 0);
    }
    case "glassFront": {
      const dy = spanned(H.windshield.base[0], P.windshieldTop[0], style.windshield.base[0], style.windshieldTop[0]);
      return moved(base, xScale, dy, spanned(P.windshieldTop[1], H.windshield.base[1], style.windshieldTop[1], style.windshield.base[1]));
    }
    case "glassRear": {
      const dy = spanned(P.rearGlass.base[0], P.rearGlass.top[0], glass.base[0], glass.top[0]);
      return moved(base, xScale, dy, spanned(P.rearGlass.base[1], P.rearGlass.top[1], glass.base[1], glass.top[1]));
    }
    case "bonnet":
      return moved(base, xScale, lifted(style.hood.origin[0] - H.hood.origin[0]), spanned(H.hood.z0, H.hood.z1, style.hood.z0, style.hood.z1));
    case "boot":
      return bootCage(style.boot, base, xScale);
    default:
      return null;
  }
}

function bootSensor(boot: BodyStyle["boot"], base: SensorSpec): SensorSpec {
  if (boot.kind === "tailgate") return { ...base, rest: [0, (boot.y0 + boot.origin[0]) / 2 + TAILGATE_SENSOR.up, boot.origin[1] + TAILGATE_SENSOR.ahead] };
  const P = PLATFORM_CABIN.boot;
  return { ...base, rest: [base.rest[0], base.rest[1] + (boot.origin[0] - P.origin[0]), base.rest[2] + ((boot.z0 + boot.z1) / 2 - (P.z0 + P.z1) / 2)] };
}

function named<T extends { name: string }>(list: readonly T[], name: T["name"]): T {
  return list.find((e) => e.name === name)!;
}

/** Where each face's crush reaches into this body: the platform's bands carried by the warp, the top's from its own bonnet to its roof mass. */
function bandsOf(w: Warp, cages: readonly CageSpec[], masses: readonly MassSpec[]): FaceBands {
  const { nose, tail, side } = PLATFORM_RIG.faceBands;
  const from = named(cages, "bonnet").max[1];
  return {
    top: [from, named(masses, "roof").rest[1] - from],
    nose: [nose[0] + dzOf(w, nose[0]), nose[1] + dzOf(w, nose[0] + nose[1]) - dzOf(w, nose[0])],
    tail: [tail[0] - dzOf(w, -tail[0]), tail[1] - dzOf(w, -tail[0] - tail[1]) + dzOf(w, -tail[0])],
    side: [side[0] + dxOf(w, side[0]), side[1] + dxOf(w, side[0] + side[1]) - dxOf(w, side[0])],
  };
}

function rigOf(style: BodyStyle, w: Warp, wheels: readonly V3[]): RigTables {
  const P = PLATFORM_RIG;
  const cages = P.cages.map((base) => cabinCage(style, base, w.xScale) ?? warpedCage(w, base));
  const hubs = new Map<string, V3>(HUB_NAMES.map((name, i) => [name, wheels[i]!]));
  const masses = P.masses.map((spec): MassSpec => {
    const hub = hubs.get(spec.name);
    return { ...spec, rest: hub ? [hub[0], hub[1], hub[2]] : warped(w, spec.rest) };
  });
  const sensors = P.sensors.map((spec, i): SensorSpec => (i === BOOT_SENSOR ? bootSensor(style.boot, spec) : { ...spec, rest: warped(w, spec.rest) }));
  const r = style.dims.wheel.radius;
  const arch = style.arch.radius - PLATFORM_HARDPOINTS.arch.radius;
  return {
    cages,
    sensors,
    masses,
    tyre: { r, halfW: style.dims.wheel.width / 2 },
    massScale: CLASSES[STYLE_CLASS[style.id]].crashMass,
    archTop: P.archTop + (r - PLATFORM_TYRE.r) + arch,
    archPlant: P.archPlant + arch,
    roofClampY: P.roofClampY + (named(cages, "roof").min[1] - named(P.cages, "roof").min[1]),
    faceBands: bandsOf(w, cages, masses),
    tyreReach: P.tyreReach + (r - PLATFORM_TYRE.r),
  };
}

/** The underside's height (m) at car-local (`x`, `z`) within the rockers: its keel and rocker lines along z, between them across. */
export function underY(underside: readonly V3[], x: number, z: number): number {
  let rockerX = 0;
  for (const p of underside) rockerX = Math.max(rockerX, p[0]);
  let keel = 0;
  let rocker = 0;
  for (const [line, side] of [[0, 0], [rockerX, 1]] as const) {
    let lo: V3 | undefined;
    let hi: V3 | undefined;
    for (const p of underside) {
      if (p[0] !== line) continue;
      if (p[1] <= z && (!lo || p[1] > lo[1])) lo = p;
      if (p[1] >= z && (!hi || p[1] < hi[1])) hi = p;
    }
    const h = !lo || !hi || lo === hi ? (lo ?? hi)![2] : lo[2] + ((hi[2] - lo[2]) * (z - lo[1])) / (hi[1] - lo[1]);
    if (side === 0) keel = h;
    else rocker = h;
  }
  return keel + ((rocker - keel) * Math.abs(x)) / rockerX;
}

/**
 * The pan: six points on the least-squares plane through the underside under its rows (22 mm higher at the rear row than at the
 * front on the platform), flat across. On the underside's V (keel 5 mm under its rocker side) it stood on the keel line alone,
 * rolling 1° each way on a flat roof; a flat pan at 0.132 stood 15-22 mm over the underside at its front row.
 */
function panOf(underside: readonly V3[]): V3[] {
  let sum = 0;
  let sz = 0;
  let n = 0;
  for (const z of [-PAN_HALF, PAN_HALF]) {
    for (const x of [-PAN_HALF, 0, PAN_HALF]) {
      const h = underY(underside, x, z);
      sum += h;
      sz += h * z;
      n++;
    }
  }
  const at = sum / n;
  const rise = sz / (n * PAN_HALF * PAN_HALF);
  return [-PAN_HALF, PAN_HALF].flatMap((z) => [-PAN_HALF, 0, PAN_HALF].map((x): V3 => [x, at + rise * z, z]));
}

function bellyOf(w: Warp, underside: readonly V3[], pan: readonly V3[]): V3[] {
  return [
    ...underside.map(([x, z, h]): V3 => [x, h, z]),
    ...BELLY_KEEL_ROWS.flatMap((k, i) => {
      const keel = underside[k]!;
      const rocker = underside[BELLY_ROCKER_ROWS[i]!]!;
      return [-BELLY_MID_X, BELLY_MID_X].map((x): V3 => [x + dxOf(w, x), keel[2] + (rocker[2] - keel[2]) * BELLY_MID_SHARE, keel[1]]);
    }),
    ...pan,
  ];
}

function wheelsOf(d: Dims): V3[] {
  const b = d.wheelbase / 2;
  const t = d.track / 2;
  const r = d.wheel.radius;
  return [[-t, r, b], [t, r, b], [-t, r, -b], [t, r, -b]];
}

function buildFrame(style: BodyStyle): CarFrame {
  const d = style.dims;
  const P = PLATFORM_DIMS;
  const w = warpOf(d);
  const wheels = wheelsOf(d);
  const rise = d.rideHeight - P.rideHeight;
  const grow = (lengthOf(d) - lengthOf(P)) / 2;
  const half = { x: PLATFORM_HALF.x + (d.width - P.width) / 2, y: PLATFORM_HALF.y + (d.height - P.height) / 2, z: PLATFORM_HALF.z + grow };
  const comY = PLATFORM_COM_Y + (rise + (d.height - P.height)) / 2;
  // The underside rides the style's own floor line (`floorY`: its rideHeight, or its stations where the floor rises to a nose or a tail).
  const lifted = (z: number): number => floorY(z, style) - P.rideHeight;
  const underside = PLATFORM_UNDERSIDE.map(([x, z, h]): V3 => {
    const at = z + dzOf(w, z);
    return [x + dxOf(w, x), at, h + lifted(at)];
  });
  const pan = panOf(underside);
  return {
    rig: rigOf(style, w, wheels),
    wheels,
    wx: Float64Array.from(wheels, (p) => p[0]),
    wz: Float64Array.from(wheels, (p) => p[2]),
    halfBase: d.wheelbase / 2,
    halfTrack: d.track / 2,
    half,
    footHalfL: PLATFORM_FOOT_HALF_L + grow,
    comY,
    centre: new THREE.Vector3(0, comY, 0),
    invI: new THREE.Vector3(3 / (half.y ** 2 + half.z ** 2), 3 / (half.x ** 2 + half.z ** 2), 3 / (half.x ** 2 + half.y ** 2)),
    underside,
    sill: PLATFORM_SILL.map((h, i) => h + lifted(wheels[i]![2])),
    pan,
    belly: bellyOf(w, underside, pan),
    hullUnder: Float64Array.from([...underside.flat(), ...[-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => [sx * half.x, sz * half.z, BUMPER_UNDER + lifted(sz * half.z)]))]),
    lattice: { x: PLATFORM_LATTICE.x + Math.max(0, half.x - PLATFORM_HALF.x), z: PLATFORM_LATTICE.z + Math.max(0, half.z - PLATFORM_HALF.z) },
  };
}

const frames = new WeakMap<BodyStyle, CarFrame>();

export function carFrame(style: BodyStyle): CarFrame {
  let f = frames.get(style);
  if (!f) frames.set(style, (f = buildFrame(style)));
  return f;
}

/** The largest body box (half extents, m) and plan half length of any style: spacing that must clear whichever car stands there. */
export const FLEET_HALF = (() => {
  const out = { x: 0, y: 0, z: 0, footHalfL: 0 };
  for (const id of CAR_STYLE_IDS) {
    const f = carFrame(CAR_STYLES[id]);
    out.x = Math.max(out.x, f.half.x);
    out.y = Math.max(out.y, f.half.y);
    out.z = Math.max(out.z, f.half.z);
    out.footHalfL = Math.max(out.footHalfL, f.footHalfL);
  }
  return out;
})();
