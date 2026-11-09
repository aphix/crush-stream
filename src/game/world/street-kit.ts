import { detCos, detSin } from "../kernel/physics-core.js";
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
  newsBox: [0.5, 0.95, 0.6],
  streetSign: [0.95, 3, 0.95],
  bollard: [0.3, 0.95, 0.3],
  cellarDoor: [1, 0.2, 1.1],
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
  /** A fire hydrant, as drawn: the plan its outlets reach (a circle holds them, up to `outletTop`), its barrel's radius and top, its bonnet's radius at the foot, the radius of its cap and its top. */
  hydrant: { reach: 0.17, outletTop: 0.48, barrelRadius: 0.12, barrelTop: 0.56, bonnetRadius: 0.14, bonnetTop: 0.68, capRadius: 0.05, top: 0.76 },
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

/**
 * A section of the park's hoop fence (`hoop-fence`): a knockable prop that holds a light touch and breaks loose from a hard one. `knockSpeed` (m/s) is the closing speed at or under
 * which a car meets it as a solid (a nudge at parking pace, 3 m/s being 11 km/h; the rig's lamp posts fold at 3.5), over which it flies like a cone; `massKg` is a 4 m run of 8 mm
 * steel tube and two rails, what a thrown section weighs.
 */
export const HOOP_FENCE = { knockSpeed: 3, massKg: 8, halfThickness: 0.03, halfLength: 2, height: 0.45 } as const;

/**
 * The furniture a car knocks over, each what it weighs (kg) and the closing speed (m/s) at or under which a car meets it as a solid: a bin or a news box a nudge does not move, a bench
 * or a bolted rack with its bicycle holds a little harder. Above its speed the piece breaks loose and tumbles like a cone.
 */
export const KNOCKABLE = {
  litterBin: { massKg: 20, knockSpeed: 3 },
  bench: { massKg: 45, knockSpeed: 4 },
  newsBox: { massKg: 35, knockSpeed: 3.5 },
  bikeRack: { massKg: 30, knockSpeed: 4 },
} as const;

/** The pavilion (m), as drawn and as a car meets it: a 16-sided floor and fascia, the eight posts on a ring, the roof's cone over the fascia and a finial. */
export const PAVILION = {
  sides: 16,
  posts: 8,
  postRing: 2.35,
  postHalf: 0.06,
  floorRadius: 2.6,
  floorHeight: 0.25,
  fasciaRadius: 2.9,
  fasciaBottom: 2.85,
  fasciaTop: 3,
  coneRadius: 2.8,
  coneTop: 3.85,
  finialRadius: 0.08,
  top: 4.1,
} as const;

/** A circle collider of radius `r` from `y0` to `y1` (m). */
function circlePiece(r: number, y0: number, y1: number): Collider {
  return { kind: "circle", r, y0, y1 };
}

/** A box collider of half sizes (`halfAlong` front to back, `halfAcross`) centred (`x`, `z`) from `y0` to `y1` (m). */
function boxPiece(halfAlong: number, halfAcross: number, x: number, z: number, y0: number, y1: number): Collider {
  return { kind: "box", hx: halfAlong, hz: halfAcross, x, z, y0, y1 };
}

/** A hydrant's circles: the outlets' round (to the height they reach), the barrel, the bonnet (as wide as its foot) and the cap. */
export function hydrantPlan(): Collider[] {
  const { reach, outletTop, barrelRadius, barrelTop, bonnetRadius, bonnetTop, capRadius, top } = POSTS.hydrant;
  return [circlePiece(reach, 0, outletTop), circlePiece(barrelRadius, outletTop, barrelTop), circlePiece(bonnetRadius, barrelTop, bonnetTop), circlePiece(capRadius, bonnetTop, top)];
}

/** A bin's circles: its body, and its lid a little wider. */
export function binPlan(): Collider[] {
  return [circlePiece(0.23, 0, 0.82), circlePiece(0.25, 0.82, 0.9)];
}

/** A bench's boxes, as it is drawn: the seat, the back, a leg frame at each end and the back's two supports. */
export function benchPlan(): Collider[] {
  const plan = [boxPiece(0.225, 0.8, 0.02, 0, 0.42, 0.48), boxPiece(0.025, 0.8, -0.2, 0, 0.5, 0.9)];
  for (const z of [-0.72, 0.72]) plan.push(boxPiece(0.25, 0.03, 0, z, 0, 0.42), boxPiece(0.03, 0.03, -0.2, z, 0.42, 0.9));
  return plan;
}

/** A news box's two boxes: its body and its wider cap. */
export function newsBoxPlan(): Collider[] {
  return [boxPiece(0.23, 0.28, 0, 0, 0, 0.85), boxPiece(0.25, 0.3, 0, 0, 0.85, 0.95)];
}

/** A bike rack's boxes: the staple's rail and two legs, then each wheel as a slab the width of its tyre and the frame's plane between them (the bicycle is what the staple holds). */
export function bikeRackPlan(): Collider[] {
  const plan = [boxPiece(0.025, 0.575, -0.2, 0, 0.775, 0.825)];
  for (const z of [-0.55, 0.55]) plan.push(boxPiece(0.025, 0.025, -0.2, z, 0, 0.8));
  for (const z of [-0.52, 0.52]) plan.push(boxPiece(0.022, 0.332, 0.1, z, 0.008, 0.672));
  plan.push(boxPiece(0.03, 0.45, 0.1, 0, 0.2, 0.9));
  return plan;
}

/** The pavilion's solids: the floor, the posts, the fascia, the roof's cone and the finial. */
export function pavilionPlan(): Collider[] {
  const { posts, postRing, postHalf, floorRadius, floorHeight, fasciaRadius, fasciaBottom, fasciaTop, coneRadius, coneTop, finialRadius, top } = PAVILION;
  const plan = [circlePiece(floorRadius, 0, floorHeight)];
  for (let post = 0; post < posts; post++) {
    const angle = ((post + 0.5) * 2 * Math.PI) / posts;
    plan.push(boxPiece(postHalf, postHalf, postRing * detCos(angle), postRing * detSin(angle), floorHeight, fasciaBottom));
  }
  plan.push(circlePiece(fasciaRadius, fasciaBottom, fasciaTop), circlePiece(coneRadius, fasciaTop, coneTop), circlePiece(finialRadius, coneTop, top));
  return plan;
}

/** The acorn lamp's circles: plinth, post, collar, globe and cap, each as wide as it is drawn. */
export function acornPlan(): Collider[] {
  const { plinthRadius, plinthHeight, postRadius, collarRadius, collarBottom, collarTop, globeRadius, capRadius, capBottom, height } = ACORN_LAMP;
  return [circlePiece(plinthRadius, 0, plinthHeight), circlePiece(postRadius, plinthHeight, collarBottom), circlePiece(collarRadius, collarBottom, collarTop), circlePiece(globeRadius, collarTop, capBottom), circlePiece(capRadius, capBottom, height)];
}
