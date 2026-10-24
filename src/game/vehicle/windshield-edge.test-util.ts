import type * as THREE from "three";
import { windshieldPoint, windshieldSideX } from "./car-glass.ts";
import { lerp } from "./car-mesh.ts";
import type { BodyStyle } from "./car-variants.ts";

/** The windshield's side edge is read at this many equal rises, base to top: a round top corner's arc takes a few of them. */
export const WINDSHIELD_EDGE_STEPS = 24;

/** `style`'s windshield's side edge as drawn (`side` +1 or -1), base to top in `WINDSHIELD_EDGE_STEPS` equal rises: straight, or round its top corner's arc (`windshield.round`); a fresh point each. */
export function windshieldEdge(style: BodyStyle, side: 1 | -1): THREE.Vector3[] {
  const { wBase, wTop } = style.windshield;
  return Array.from({ length: WINDSHIELD_EDGE_STEPS + 1 }, (_, j) => {
    const t = j / WINDSHIELD_EDGE_STEPS;
    return windshieldPoint(style, (side * windshieldSideX(style, t)) / (lerp(wBase, wTop, t) / 2), t);
  });
}
