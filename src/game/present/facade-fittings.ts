import windowData from "../world/openworld/facade-windows.json" with { type: "json" };
import { PREFABS } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import { BAY, drawnHalf, HOME_HEIGHT, LOT_WIDTH } from "../world/openworld/openworld-facade-solids.ts";
import { streetStoreys } from "./facade-mesh.ts";
import { FACADE_LAYERS, isFacadeStyle } from "./facades.ts";

/**
 * What hangs on a rowhome's street face where its picture shows a window: shutters either side of the upper windows, an air-conditioning unit in one. The windows are the packer's table
 * (`facade-windows.json`: each window of a style's layers, as it measured them from the picture the glow mask is cut from), placed on the face the way the facade mesh lays the picture
 * (`streetStoreys`), so a fitting stands where the picture's window is. Across the lot is u, along the building's local z, the way the kit and the interior measure it.
 */

/** A window of the packed picture: [u0, v0, u1, v1] of its layer, v up. */
type Rect = readonly number[];
type StyleWindows = { windows: { floor: readonly Rect[]; ground: readonly Rect[] } };
const table: Readonly<Record<string, StyleWindows>> = windowData;

/** One window of the street face: its middle and width across the lot (u), its sill and head over the sidewalk (m), and the interior storey it lights (0 the raised ground storey). */
type StreetWindow = { across: number; width: number; sill: number; head: number; storey: number };

/** A window rect of a layer, the layer's bottom at `bottom` m and `tall` m tall, as a window of the street face. */
function windowOf(rect: Rect, bottom: number, tall: number, storey: number, faceWidth: number): StreetWindow {
  const [u0, v0, u1, v1] = [rect[0]!, rect[1]!, rect[2]!, rect[3]!];
  // A face's u runs to the viewer's right, the plan's -across.
  const low = (0.5 - u1) * faceWidth;
  const high = (0.5 - u0) * faceWidth;
  return { across: (low + high) / 2, width: high - low, sill: bottom + v0 * tall, head: bottom + v1 * tall, storey };
}

/** Every window the picture of `style` shows on the street face, the ones the bay stack covers included; none for a style without a table. */
export function streetWindowsOf(style: string): StreetWindow[] {
  if (!isFacadeStyle(style) || !Object.hasOwn(table, style)) return [];
  const { windows } = table[style]!;
  const { start, height, storeys } = streetStoreys(style);
  const toHome = HOME_HEIGHT / PREFABS[PREFAB.building].size[1];
  const faceWidth = 2 * drawnHalf(LOT_WIDTH);
  const out: StreetWindow[] = windows.ground.map((rect) => windowOf(rect, 0, FACADE_LAYERS[style].metres.ground * toHome, 0, faceWidth));
  for (let storey = 0; storey < storeys; storey++) {
    for (const rect of windows.floor) out.push(windowOf(rect, (start + storey * height) * toHome, height * toHome, storey + 1, faceWidth));
  }
  return out;
}

/** The windows the bay stack does not stand in front of. */
export function visibleWindowsOf(style: string): StreetWindow[] {
  const bayLow = BAY.across - BAY.width / 2;
  const bayHigh = BAY.across + BAY.width / 2;
  return streetWindowsOf(style).filter((window) => window.across + window.width / 2 < bayLow || window.across - window.width / 2 > bayHigh);
}

/** A shutter: its middle across the lot, its width, and its sill and height over the sidewalk (m). */
type Shutter = { across: number; width: number; sill: number; height: number };

/** A pair is half the window's width each, so closed they meet; narrower than this a shutter reads as a trim strip, and none is hung. */
const SHUTTER_SHARE = 0.5;
const SHUTTER_MIN_WIDTH = 0.3;
/** Past the bay's wall corner the belts' lips reach 0.085 m; and past the window the drawn face ends at the party wall. */
const SHUTTER_BAY_CLEARANCE = 0.1;
const SHUTTER_EDGE_CLEARANCE = 0.05;

/** Shutters either side of each upper window that has the room, a pair of one width: the narrower side the bay and the party wall leave. */
export function shuttersOf(style: string): Shutter[] {
  const out: Shutter[] = [];
  const bayEdge = BAY.across + BAY.width / 2 + SHUTTER_BAY_CLEARANCE;
  const faceEdge = drawnHalf(LOT_WIDTH) - SHUTTER_EDGE_CLEARANCE;
  for (const window of visibleWindowsOf(style)) {
    if (window.storey === 0) continue;
    const low = window.across - window.width / 2;
    const high = window.across + window.width / 2;
    const width = Math.min(window.width * SHUTTER_SHARE, low - bayEdge, faceEdge - high);
    if (width < SHUTTER_MIN_WIDTH) continue;
    const height = window.head - window.sill;
    out.push({ across: low - width / 2, width, sill: window.sill, height }, { across: high + width / 2, width, sill: window.sill, height });
  }
  return out;
}

/** The windows an air-conditioning unit may sit in: the upper ones the bay does not cover. */
export function airconWindowsOf(style: string): StreetWindow[] {
  return visibleWindowsOf(style).filter((window) => window.storey > 0);
}
