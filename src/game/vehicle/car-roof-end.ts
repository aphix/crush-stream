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

/**
 * A rolled end whose run is shorter than this many times its move at the centre line can't share the move along the run (its roll's
 * slope drops by run/(run + move) at the centre and not at the corners): its whole roll moves instead. The hatch's rear (1.27) folds
 * its headliner at 13.8°; the coupe's front (1.82) shares it at 7.9°, where moving its whole roll reads 9.5°.
 */
const SHORT_RUN_MOVES = 1.5;
/** Such an end's move fades out over this much (m) of the dome behind its roll. */
const ROOF_BOW_FADE = 0.15;

/**
 * How a rolled end's move spreads over the drawn roof's stations: whole for `hold` (m) from the end, then fading linearly to 0 over
 * `fade`. A run long against its move fades over the run itself; a short one holds the whole move over the run and fades over the dome.
 */
function roofEndSpread(end: RoofEnd, run: number): { hold: number; fade: number } {
  return run < SHORT_RUN_MOVES * Math.abs(roofEndHeldZ(end, 0) - end.z) ? { hold: run, fade: ROOF_BOW_FADE } : { hold: 0, fade: run };
}

/** The share (0..1) of `end`'s move a drawn roof station `z` takes (`roofEndSpread`), so every ring of the roll moves with the end and keeps its slope; with no run, the end ring alone. */
export function roofEndWeight(end: RoofEnd, z: number): number {
  const d = Math.abs(z - end.z);
  if (end.run === undefined) return d < 1e-6 ? 1 : 0;
  const { hold, fade } = roofEndSpread(end, end.run);
  if (d <= hold) return 1;
  return d < hold + fade ? 1 - (d - hold) / fade : 0;
}

/** The rolled end whose moved stations reach `z` in the drawn roof, or undefined. */
function runEndAt(z: number, style: BodyStyle): RoofEnd | undefined {
  return roofEndBows(style).find((end) => {
    if (end.run === undefined) return false;
    const { hold, fade } = roofEndSpread(end, end.run);
    return end.inward * (z - end.z) > -(hold + fade);
  });
}

/**
 * The drawn roof station a point at car (`x`, `z`) lies on: each rolled end's move is linear in z over its fade and whole over its
 * hold, so it inverts in closed form; past the moved end the station runs on past the roof's end by the same shift, so a point ahead
 * of the roof stays off it. Drawn parts that stand on or under the roof read through this; the cage and the glass read the unmoved stations.
 */
export function roofSourceZ(x: number, z: number, style: BodyStyle): number {
  const end = runEndAt(z, style);
  if (end?.run === undefined) return z;
  const { hold, fade } = roofEndSpread(end, end.run);
  const move = end.inward * (roofEndHeldZ(end, x) - end.z);
  const start = end.z - end.inward * (hold + fade);
  const along = end.inward * (z - start);
  const source = along <= fade + move ? (along * fade) / (fade + move) : along - move;
  return start + end.inward * source;
}

/**
 * Height of the drawn roof's top at (`x`, `z`): `roofTopY` at its station (`roofSourceZ`). A side vertex the pane's top row carried
 * forward past the side lip is held on that lip (`bowRoofEnds`) at its own cant's height.
 */
export function drawnRoofTopY(x: number, z: number, style: BodyStyle): number {
  const from = roofSourceZ(x, z, style);
  const end = runEndAt(z, style);
  const drip = roofDrip(style);
  const onLip = end !== undefined && roofEndHeldZ(end, x) > end.z + end.bow * roofEndAcross(end, x) && Math.abs(x) >= cantX(z, style) + drip - 1e-9;
  return roofTopY(onLip ? Math.max(Math.abs(x), cantX(from, style) + drip) : x, from, style);
}
