import type { BodyStyle } from "../car-variants.ts";
import { SEDAN } from "./sedan.ts";
import { POLICE_DETAILS } from "./sedan-details.ts";

/** Black body and trim, white doors: the cop's two-tone; `present/cop-livery.ts` paints the white roof, pillars and door lettering in it. */
export const COP_LIVERY = { body: 0x0c0d0f, doors: 0xeef0f2, accent: 0x16171a } as const;

/**
 * Sedan shell in black-and-white with a roof light bar. The roof cage reaches over the bar, so the
 * bar skins with the roof (`skinPanel`) instead of clamping flat at the cage top.
 */
export const POLICE: BodyStyle = {
  ...SEDAN,
  id: "police",
  livery: COP_LIVERY,
  lightBar: true,
  pushBar: true,
  details: POLICE_DETAILS,
  rig: { cages: { roof: { min: [-0.58, 1.02, -0.7], max: [0.58, 1.52, 0.56] } } },
};
