/**
 * A body style's sim frame: its rig (`StreamedDeformation`'s cages, sensors, masses and tyre), where its wheels stand, its body box,
 * centre of mass and inertia, and the underside its rigid step rests on. One frame per style, built once from its spec (`BodyStyle.dims`).
 */
import * as THREE from "three";
import { CAGES, MASS_SPECS, SENSORS, type CageSpec, type MassSpec, type SensorSpec } from "../kernel/rig-spec.ts";
import type { RigTables } from "../deform/deform-rig.ts";
import { CAR_STYLE_IDS, CAR_STYLES, type BodyStyle } from "./car-variants.ts";

type V3 = readonly [number, number, number];

/** The platform's body box (half extents, m) every table below was tuned on. */
const PLATFORM_HALF = { x: 0.88, y: 0.68, z: 2.22 } as const;
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
/** The underside's height (m) at each hub's plan position (a front hub's is the bumper corner's, a rear hub's the tail's). */
const PLATFORM_SILL = [0.084, 0.084, 0.157, 0.157] as const;
/** The pan's half width and half length (m). */
const PAN_HALF = 0.35;
/** A bumper's bottom corner over the tyre plane (m): `hullUnder`'s corner rows. */
const BUMPER_UNDER = 0.35;

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
   * The belly (car-local x, height, z): the underside's keel and rockers, the belly between them 0.5 m either side of the keel (its
   * height interpolated), so a car on another's flat roof rests on its width, not balanced on the keel line, and the pan last.
   */
  readonly belly: readonly V3[];
  /** What the body bottoms out on: the underside's samples and the bumpers' bottom corners, rows of x, z, height. */
  readonly hullUnder: Float64Array;
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

function bellyOf(underside: readonly V3[], pan: readonly V3[]): V3[] {
  let rockerX = 0;
  for (const p of underside) rockerX = Math.max(rockerX, p[0]);
  return [
    ...underside.map(([x, z, h]): V3 => [x, h, z]),
    ...[2, 1, 0, -2].flatMap((z) => {
      const keel = underside.find((p) => p[0] === 0 && p[1] === z)![2];
      const rocker = underside.find((p) => p[0] === rockerX && p[1] === z)![2];
      return [-0.5, 0.5].map((x): V3 => [x, keel + (rocker - keel) * 0.625, z]);
    }),
    ...pan,
  ];
}

function rigOf(style: BodyStyle, wheels: readonly V3[]): RigTables {
  const { cages, sensors } = style.rig;
  const hubs = new Map(["hubFL", "hubFR", "hubRL", "hubRR"].map((name, i) => [name, wheels[i]!]));
  return {
    cages: CAGES.map((base): CageSpec => {
      const box = cages?.[base.name];
      return box ? { ...base, ...box } : base;
    }),
    sensors: SENSORS.map((base, i): SensorSpec => {
      const rest = sensors?.[i];
      return rest ? { ...base, rest } : base;
    }),
    masses: MASS_SPECS.map((spec): MassSpec => {
      const hub = hubs.get(spec.name);
      return hub ? { ...spec, rest: [hub[0], hub[1], hub[2]] } : spec;
    }),
    tyre: { r: style.dims.wheel.radius, halfW: style.dims.wheel.width / 2 },
  };
}

function buildFrame(style: BodyStyle): CarFrame {
  const { wheelbase, track, wheel } = style.dims;
  const halfBase = wheelbase / 2;
  const halfTrack = track / 2;
  const wheels: V3[] = [
    [-halfTrack, wheel.radius, halfBase],
    [halfTrack, wheel.radius, halfBase],
    [-halfTrack, wheel.radius, -halfBase],
    [halfTrack, wheel.radius, -halfBase],
  ];
  const half = PLATFORM_HALF;
  const underside = PLATFORM_UNDERSIDE;
  const pan = panOf(underside);
  return {
    rig: rigOf(style, wheels),
    wheels,
    wx: Float64Array.from(wheels, (p) => p[0]),
    wz: Float64Array.from(wheels, (p) => p[2]),
    halfBase,
    halfTrack,
    half,
    footHalfL: PLATFORM_FOOT_HALF_L,
    comY: PLATFORM_COM_Y,
    centre: new THREE.Vector3(0, PLATFORM_COM_Y, 0),
    invI: new THREE.Vector3(3 / (half.y ** 2 + half.z ** 2), 3 / (half.x ** 2 + half.z ** 2), 3 / (half.x ** 2 + half.y ** 2)),
    underside,
    sill: PLATFORM_SILL,
    pan,
    belly: bellyOf(underside, pan),
    hullUnder: Float64Array.from([
      ...underside.flat(),
      ...[-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => [sx * half.x, sz * half.z, BUMPER_UNDER])),
    ]),
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
