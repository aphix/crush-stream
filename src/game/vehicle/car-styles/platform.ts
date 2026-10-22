import { PLATFORM_TYRE } from "../../kernel/rig-spec.ts";
import { detCos, detSin } from "../../kernel/physics-core.js";
import type { BodyStyle, ProfileStation } from "../car-variants.ts";

export function st(z: number, hw: number, yBelt: number, yRoof = yBelt, cabinHw = 0.5, cabin = 0): ProfileStation {
  return { z, hw, yBelt, yRoof, cabinHw, cabin };
}

/** The cabin's open floor [zRear, zFront, floorY] behind the glass. */
export const CABIN_TUB = [-0.7, 0.7, 0.3] as const;

/** The one tyre the sim's hub contact is sized to today (`PLATFORM_TYRE`). */
export const PLATFORM_WHEEL = { radius: PLATFORM_TYRE.r, width: 2 * PLATFORM_TYRE.halfW } as const;

/** The cameras every style had before it seated its own (playtest): the hood eye over the platform bonnet, the chase framing a 4.2 m sedan. */
export const PLATFORM_CAMERA = {
  hood: [1.02, 1.15],
  third: { dist: 6.2, height: 2.0, aimUp: 1.0 },
  far: { dist: 10, height: 3.3, aimUp: 1.15 },
} as const satisfies NonNullable<BodyStyle["camera"]>;

/** The body every rig table was tuned on (the first sedan's dims): the rig carries its tables onto a car by that car's dims' offsets from these (`carFrame`). */
export const PLATFORM_DIMS = {
  wheelbase: 2.68,
  overhang: { front: 0.81, rear: 0.81 },
  track: 1.48,
  width: 1.813,
  height: 1.366,
  rideHeight: 0.145,
  wheel: PLATFORM_WHEEL,
} as const satisfies BodyStyle["dims"];

/** The cabin the rig's roof, glass and boot cages were fitted to (the first sedan's): a car's cages move by its own cabin's offsets from these. */
export const PLATFORM_CABIN = {
  roofZ: [-0.82, 0.58],
  windshieldTop: [1.26, 0.49],
  rearGlass: { base: [0.81, -1.16], top: [1.23, -0.76] },
  boot: { z0: -0.66, z1: -1.98, origin: [0.74, -0.72] },
} as const;

/** Bumper fascia section about its seat, top to bottom, [y, out] (m): rounded top, intake recess, splitter lip. */
const PLATFORM_FASCIA = [
  [0.1, -0.07],
  [0.1, 0.02],
  [0.088, 0.062],
  [0.05, 0.08],
  [0.018, 0.074],
  [-0.012, 0.062],
  [-0.05, 0.064],
  [-0.07, 0.088],
  [-0.1, 0.075],
  [-0.1, -0.07],
] as const;

/** The bumper both ends wear: seated 0.05 inside the end stations' 2.11. */
const PLATFORM_BUMPER = { seat: { y: 0.33, z: 2.06 }, fascia: PLATFORM_FASCIA, span: 0.77, wrap: { from: 0.58, back: 0.1235 } } as const;

/** The hardpoints the first bodies shared on one platform: a table spreads these and overrides what its car changes. */
export const PLATFORM_HARDPOINTS = {
  windshield: { base: [0.78, 1.03], wBase: 1.3, wTop: 0.96 },
  bPillar: { rear: -0.13, front: -0.03 },
  belt: { x: 0.85, y: [[0, 0.83]] },
  rocker: { y: 0.2 },
  arch: { radius: 0.38 },
  hood: { z0: 0.76, z1: 1.98, origin: [0.7, 0.74] },
  bumpers: { front: PLATFORM_BUMPER, rear: PLATFORM_BUMPER },
  door: { hingeX: 0.86, hingeY: 0.54, hingeZ: 0.55, length: 0.57, halfHeight: 0.31, mirrorY: 0.32, mirrorReach: 0.21, mirrorHalfDepth: 0.08, aperture: [0, 0.54] },
  aPillarFoot: 0.76,
  seats: { front: [0.36, 0.44, 0.08], rear: [0.46, -0.47] },
} as const satisfies Pick<BodyStyle, "windshield" | "bPillar" | "belt" | "rocker" | "arch" | "hood" | "bumpers" | "door" | "aPillarFoot" | "seats">;

type Details = NonNullable<BodyStyle["details"]>;

/** A pull handle's pocket: recessed this deep (m) over a rim this wide, half dark (the references' slim handles sit in a shadowed dish). */
const HANDLE_POCKET = { depth: -0.004, rim: 0.004, cavity: 0.45 } as const;
/** Its bar: a rounded bead standing this proud (m), this share of the pocket's height wide. */
const HANDLE_BAR = { depth: 0.004, share: 0.45 } as const;
/** Points per rounded end of the pocket's outline. */
const HANDLE_END_POINTS = 6;

/**
 * A slim pull handle in a car's side `details`, as the references draw them (not a box outline): a pill-shaped pocket from z `z0` to
 * `z1` (m), `height` (m) tall, centred at `y`, recessed and darkened, and a raised rounded bar along its middle. Spread its `lines`
 * and `patches` into the style's own.
 */
export function pullHandle(z0: number, z1: number, y: number, height: number): Details {
  const r = height / 2;
  const [front, rear] = [Math.max(z0, z1) - r, Math.min(z0, z1) + r];
  const outline: [number, number][] = [];
  for (let k = 0; k <= HANDLE_END_POINTS; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / HANDLE_END_POINTS;
    outline.push([front + r * detCos(a), y + r * detSin(a)]);
  }
  for (let k = 0; k <= HANDLE_END_POINTS; k++) {
    const a = Math.PI / 2 + (Math.PI * k) / HANDLE_END_POINTS;
    outline.push([rear + r * detCos(a), y + r * detSin(a)]);
  }
  return {
    patches: [{ view: "side", points: outline, ...HANDLE_POCKET }],
    lines: [{ view: "side", points: [[rear, y], [front, y]], width: Math.max(0.006, HANDLE_BAR.share * height), depth: HANDLE_BAR.depth, profile: "u", cavity: 0 }],
  };
}
