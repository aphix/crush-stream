import type { Collider } from "./landmarks.ts";

/**
 * The open world's street kit (`present/prefabs-street.ts` draws each): the box (m) each stands in, along its front (x, toward the street), up, and across (z, along the curb).
 * A shelter and a café set are shallow enough for the 1.2 m furniture strip; a bike rack holds one bicycle.
 */
export const STREET_KIT = {
  bench: [0.6, 0.9, 1.6],
  bikeRack: [0.8, 1.15, 1.8],
  litterBin: [0.52, 0.95, 0.52],
  parkingMeter: [0.24, 1.4, 0.24],
  hydrant: [0.46, 0.8, 0.46],
  cafeSet: [1.1, 2.25, 1.7],
  busShelter: [1.1, 2.6, 4.4],
  busStopSign: [0.4, 2.7, 0.4],
  streetSign: [0.95, 3, 0.95],
  bollard: [0.3, 0.95, 0.3],
  cellarDoor: [1, 0.2, 1.1],
  hoopFence: [0.06, 0.45, 4],
  pavilion: [5.8, 4.1, 5.8],
} as const satisfies Record<string, readonly [number, number, number]>;

/** A street sign's placement names its two streets in its `style`: the one its blade along x shows, then the one along z. */
const STREET_SIGN_SEPARATOR = "|";

export function streetSignStyle(alongX: string, alongZ: string): string {
  return `${alongX}${STREET_SIGN_SEPARATOR}${alongZ}`;
}

/** The two street names a street sign's `style` carries (along x, along z), null when it names no two. */
export function streetSignNames(style: string | undefined): readonly [string, string] | null {
  const names = style?.split(STREET_SIGN_SEPARATOR) ?? [];
  return names.length === 2 && names[0]! !== "" && names[1]! !== "" ? [names[0]!, names[1]!] : null;
}

/**
 * Philadelphia's acorn lamp (m): a cast-iron plinth and a slim post under a collar, an acorn-shaped globe (a sphere stretched `globeStretch` tall) and a capped finial. Its collider is the
 * same shape in circles, so what is drawn is what a car meets. The plan's box is the globe's.
 */
export const ACORN_LAMP = {
  height: 4.2,
  plinthRadius: 0.12,
  plinthHeight: 0.45,
  postRadius: 0.09,
  collarRadius: 0.13,
  collarBottom: 3.5,
  collarTop: 3.6,
  globeRadius: 0.23,
  globeStretch: 1.15,
  globeCentre: 3.82,
  capRadius: 0.15,
  capBottom: 4.08,
} as const;

/**
 * The street kit's posts (m), as drawn and as the cars meet them: a post is solid, one circle of its radius per stretch of its height, a plate or blade a thin box. The drawing
 * (`present/prefabs-street.ts`) and the colliders (`catalog.ts`) read the same numbers.
 */
export const POSTS = {
  /** A cast-iron corner bollard: its post radius, its collar's radius and where the collar stands, the cap's radius, and its top. */
  bollard: { postRadius: 0.12, collarRadius: 0.14, collarBottom: 0.62, collarTop: 0.68, capBottom: 0.82, capTopRadius: 0.11, top: 0.95 },
  /** A fire hydrant: its barrel's radius, the plan the outlets reach (a circle holds them), and its top. */
  hydrant: { reach: 0.17, top: 0.76 },
  /** A parking meter: its post's radius and top, its head's half sides (m) and where it stands over the post's top, and its cap's radius and top. */
  meter: { postRadius: 0.035, postTop: 1.05, headHalfAlong: 0.09, headHalfAcross: 0.065, headTop: 1.34, capRadius: 0.08, top: 1.4 },
  /** A street sign's pole radius (its base's: the pole narrows 0.005 m over its height) and the blades' half length and thickness, with the heights each stands over (bottom, top). */
  streetSign: { poleRadius: 0.045, bladeHalf: 0.45, bladeThickness: 0.025, alongXBlade: [2.69, 2.87], alongZBlade: [2.47, 2.65], top: 2.9 },
  /** A bus stop's pole radius and top, and its two plates: where each stands out from the pole's middle, its half width and its heights. */
  busStopSign: { poleRadius: 0.03, top: 2.6, plateAhead: 0.035, plateHalfThickness: 0.01, upperHalf: 0.17, upperBlade: [2.18, 2.52], lowerHalf: 0.14, lowerBlade: [1.84, 2.12] },
} as const;

/** A bollard's circles: post, collar, post and cap, each as wide as it is drawn. */
export function bollardPlan(): Collider[] {
  const { postRadius, collarRadius, collarBottom, collarTop, capBottom, top } = POSTS.bollard;
  return [
    { kind: "circle", r: postRadius, y1: collarBottom },
    { kind: "circle", r: collarRadius, y0: collarBottom, y1: collarTop },
    { kind: "circle", r: postRadius, y0: collarTop, y1: capBottom },
    { kind: "circle", r: postRadius, y0: capBottom, y1: top },
  ];
}

/** A parking meter's: its post, its head's box and its cap. */
export function meterPlan(): Collider[] {
  const { postRadius, postTop, headHalfAlong, headHalfAcross, headTop, capRadius, top } = POSTS.meter;
  return [
    { kind: "circle", r: postRadius, y1: postTop },
    { kind: "box", hx: headHalfAlong, hz: headHalfAcross, y0: postTop, y1: headTop },
    { kind: "circle", r: capRadius, y0: headTop, y1: top },
  ];
}

/** A street sign's: its pole and its two blades, thin boxes along x and along z. */
export function streetSignPlan(): Collider[] {
  const { poleRadius, bladeHalf, bladeThickness, alongXBlade, alongZBlade, top } = POSTS.streetSign;
  return [
    { kind: "circle", r: poleRadius, y1: top },
    { kind: "box", hx: bladeHalf, hz: bladeThickness / 2, y0: alongXBlade[0], y1: alongXBlade[1] },
    { kind: "box", hx: bladeThickness / 2, hz: bladeHalf, y0: alongZBlade[0], y1: alongZBlade[1] },
  ];
}

/** A bus stop's: its pole and its two plates on the street side of it. */
export function busStopPlan(): Collider[] {
  const { poleRadius, top, plateAhead, plateHalfThickness, upperHalf, upperBlade, lowerHalf, lowerBlade } = POSTS.busStopSign;
  return [
    { kind: "circle", r: poleRadius, y1: top },
    { kind: "box", hx: plateHalfThickness, hz: upperHalf, x: plateAhead, y0: upperBlade[0], y1: upperBlade[1] },
    { kind: "box", hx: plateHalfThickness, hz: lowerHalf, x: plateAhead, y0: lowerBlade[0], y1: lowerBlade[1] },
  ];
}
