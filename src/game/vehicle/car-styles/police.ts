import type { BodyStyle } from "../car-variants.ts";
import { SEDAN } from "./sedan.ts";

/**
 * Sedan shell in black-and-white with a roof light bar. The roof cage reaches over the bar, so the
 * bar skins with the roof (`skinPanel`) instead of clamping flat at the cage top.
 */
export const POLICE: BodyStyle = {
  ...SEDAN,
  id: "police",
  livery: { body: 0x0c0d0f, doors: 0xeef0f2, accent: 0x16171a },
  lightBar: true,
  pushBar: true,
};
