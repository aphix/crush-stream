import type { BodyStyle } from "./car-variants.ts";
import { REAR_GLASS_BOW, roofDrip, WINDSHIELD_BOW } from "./car-lines.ts";
import { cantX, roofTopY } from "./car-mesh.ts";

/**
 * A drawn roof end that bows in plan: its station z, its bow (m) at the centre line, the glass top's half-width, `inward` (+1 the
 * front, −1 the rear: the roof lies behind its front end and ahead of its rear), `run`: its roll's length (m) when the style rolls it
 * (`roofEnds`), and the front's `paneTop`, the windshield's top row (z, bow), which the roof never stands behind.
 */
export type RoofEnd = { z: number; bow: number; half: number; inward: 1 | -1; run?: number; paneTop?: { z: number; bow: number } };

/** The drawn roof's ends that bow in plan past the default bow (`WINDSHIELD_BOW`, `REAR_GLASS_BOW`) its flat ends already cover, or with the glass's whole bow (`roofEnds.glassBow`); the front always, held to its pane's top row so no slit lies ahead of the glass. */
export function roofEndBows(style: BodyStyle): RoofEnd[] {
  const whole = style.roofEnds?.glassBow;
  const { bow = WINDSHIELD_BOW, wTop } = style.windshield;
  const ends: RoofEnd[] = [
    { z: style.roofZ[1], bow: bow.top - (whole?.front ? 0 : WINDSHIELD_BOW.top), half: wTop / 2, inward: 1, run: style.roofEnds?.front, paneTop: { z: style.windshieldTop[1], bow: bow.top } },
    { z: style.roofZ[0], bow: (style.rearGlass.bow ?? REAR_GLASS_BOW).top - (whole?.rear ? 0 : REAR_GLASS_BOW.top), half: style.rearGlass.wTop / 2, inward: -1, run: style.roofEnds?.rear },
  ];
  return ends.filter((end) => end.bow !== 0 || end.paneTop !== undefined);
}

/** How much of `end`'s bow reaches car `x`: all of it on the centre line, none at its glass top's corners. */
export function roofEndAcross(end: RoofEnd, x: number): number {
  const xn = Math.min(1, Math.abs(x) / end.half);
  return 1 - xn * xn;
}

/** Where (z) `end`'s ring stands at car `x`: its bow there, held to the pane's top row so no slit lies ahead of the glass. */
export function roofEndHeldZ(end: RoofEnd, x: number): number {
  const across = roofEndAcross(end, x);
  const bowed = end.z + end.bow * across;
  return end.paneTop === undefined ? bowed : Math.max(bowed, end.paneTop.z + end.paneTop.bow * across);
}

/** The share (0..1) of `end`'s move a drawn roof station `z` takes: 1 at the end, fading linearly to 0 at its roll run's start, so every ring of the roll moves with the end and keeps its slope; with no run, the end ring alone. */
export function roofEndWeight(end: RoofEnd, z: number): number {
  const d = Math.abs(z - end.z);
  if (end.run === undefined) return d < 1e-6 ? 1 : 0;
  return d < end.run ? 1 - d / end.run : 0;
}

/**
 * Height of the drawn roof's top at (`x`, `z`): `roofTopY` at the station its rolled ends moved to `z`. Each end's move is linear in z
 * over its run, so it inverts in closed form. A side vertex the pane's top row carried forward past the side lip is held on that lip
 * (`bowRoofEnds`) at its own cant's height. Drawn parts that stand on the roof read this; the cage and the glass read `roofTopY`.
 */
export function drawnRoofTopY(x: number, z: number, style: BodyStyle): number {
  for (const end of roofEndBows(style)) {
    if (end.run === undefined) continue;
    const start = end.z - end.inward * end.run;
    const along = end.inward * (z - start);
    if (along <= 0) continue;
    const held = roofEndHeldZ(end, x);
    const reach = end.run + end.inward * (held - end.z);
    const from = start + (end.inward * Math.min(along, reach) * end.run) / reach;
    const drip = roofDrip(style);
    const onLip = held > end.z + end.bow * roofEndAcross(end, x) && Math.abs(x) >= cantX(z, style) + drip - 1e-9;
    return roofTopY(onLip ? Math.max(Math.abs(x), cantX(from, style) + drip) : x, from, style);
  }
  return roofTopY(x, z, style);
}
