import type { BodyStyle } from "../car-variants.ts";
import { SEDAN, SEDAN_MIRROR } from "./sedan.ts";
import { POLICE_DETAILS } from "./sedan-details.ts";

/** Black body and trim, white doors: the cop's two-tone; `present/cop-livery.ts` paints the white roof, pillars and door lettering in it. */
export const COP_LIVERY = { body: 0x0c0d0f, doors: 0xeef0f2, accent: 0x16171a } as const;

/** The sedan as a black-and-white cruiser: livery, roof light bar, push bar and its own grille and lamp details. */
export const POLICE: BodyStyle = {
  ...SEDAN,
  id: "police",
  livery: COP_LIVERY,
  lightBar: true,
  pushBar: true,
  details: POLICE_DETAILS,
  /** The cruiser's mirrors are black plastic: a body-colour cap would take the white door paint. */
  door: { ...SEDAN.door, mirror: { ...SEDAN_MIRROR, finish: "black" } },
  /** The cruiser's bumpers are black plastic, front and rear (both references). */
  bumpers: { front: { ...SEDAN.bumpers.front, trim: "black" }, rear: { ...SEDAN.bumpers.rear, trim: "black" } },
  /** The cruiser's two small round tips under the black bumper, one each side (rear iso: |x| ~0.5; inboard 0.4 on the sedan body's narrower tail floor). */
  exhaust: { tips: 2, x: 0.4, y: 0.3, size: [0.06, 0.06], shape: "round" },
};
