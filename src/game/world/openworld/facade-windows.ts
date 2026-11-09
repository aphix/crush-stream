import { PREFABS } from "../catalog.ts";
import { PREFAB, ROOFLINE } from "../constants.ts";
import table from "./facade-windows.json" with { type: "json" };
import { BAY_WIDTH, ceilingOver, LEVELS, SHOPFRONT, BACK_DOOR } from "./interior-kinds.ts";
import { BAY, drawnHalf } from "./openworld-facade-solids.ts";
import { LAYOUT } from "./openworld-constants.ts";
import { HOUSE_STOREYS } from "./openworld-programme.ts";
import type { InteriorKind, Place } from "./walk-graph.ts";

/**
 * The window table: where every window of a facade with an interior behind it stands, from the windows its packed picture shows (`facade-windows.json`, written by `scripts/pack-facades.mjs` from the
 * same masks that light them) and the bands each face is drawn in (`faceBands`, which `present/facade-mesh.ts` draws those styles with). The interior cuts its openings from the same windows, so the two cannot drift.
 */

/** The building prefab's own height (m): a building's own height stretches it. */
const BLOCK_HEIGHT = PREFABS[PREFAB.building].size[1];

/** Storey heights (m): ground 3.6 (parlour 3.0-3.7), shop ground 4.0, floor to floor 3.2 (2.7-3.4), cornice and parapet 0.9. */
const GROUND_STOREY = 3.6;
const SHOP_GROUND_STOREY = 4;
const STOREY = 3.2;
const PARAPET = 0.9;

/** A building's height (m) of `storeys` storeys over a house's or a shop's ground storey, with its parapet. */
export function buildingHeight(storeys: number, shopGround: boolean): number {
  return (shopGround ? SHOP_GROUND_STOREY : GROUND_STOREY) + (storeys - 1) * STOREY + PARAPET;
}

/** The facade strips' layers, in the packer's order. */
const BAND_LAYER = { cornice: 0, floor: 1, ground: 2 } as const;
/** A side or back face's plinth reads this bottom share of a storey layer: below every window's sill. */
const PLINTH_V = 0.12;
/** A window this little past its band's edge (in the band's v) is still in it. */
const V_TOLERANCE = 1e-6;
/** Over a doorway the facade's surround (transom, hood) runs this high (m): a window there is part of the door, not a room's. */
const DOOR_SURROUND = 0.6;
/** A window at most this far (m) short of its ceiling's underside is clamped to it. */
const CEILING_TOLERANCE = 1e-3;

/** The faces of a building, in the order `facade-mesh.ts` turns them: the side on the plan's +across, the street, the side on its -across, the back. */
export const FACADE_FACE = { plusAcross: 0, street: 1, minusAcross: 2, back: 3 } as const;
type FacadeFace = (typeof FACADE_FACE)[keyof typeof FACADE_FACE];

/** `Place.openSides` bits: a side with no building against it. */
export const OPEN_SIDE = { plusAcross: 1, minusAcross: 2 } as const;

type OpenStyle = keyof typeof table;
const STYLE_INTERIOR = { rowbrick: "rowhome", rowpainted: "rowhome", coffee: "coffee", bar: "bar", office: "office", cornerstore: "store" } as const satisfies Record<OpenStyle, InteriorKind>;
/** Lots each open style's building spans: what its side faces' bays are counted against. */
const STYLE_LOTS = { rowbrick: 1, rowpainted: 1, coffee: 1, bar: 2, office: 2, cornerstore: 2 } as const satisfies Record<OpenStyle, number>;

export const isOpenStyle = (style: string): style is OpenStyle => Object.hasOwn(table, style);

/** The height (m) every building of an open style stands at: a house's, or a shop's over its taller ground storey. */
function styleHeight(style: OpenStyle): number {
  return buildingHeight(HOUSE_STOREYS, STYLE_INTERIOR[style] !== "rowhome");
}

/** A band of a face in block metres: its heights, the layer it reads and that layer's v over it (a storey's layer repeats once per whole v). */
type FaceBand = { y0: number; y1: number; layer: number; v0: number; v1: number };

/**
 * The bands an open style's face is drawn in, from the ground up, and its bays across. The street face: the ground band, its storeys, the cornice. A side or back face: a plinth up to the
 * interior's ground floor, then a storey band per storey on the street face's storey lines (the ground storey from the raised floor), then the cornice; so every window sits over its floor.
 * A side face is counted in the street bays' width: as many as its depth holds.
 */
export function faceBands(style: OpenStyle, face: number): { bays: number; bands: FaceBand[] } {
  const { bays, metres } = table[style];
  const top = ROOFLINE - metres.cornice;
  const storeys = Math.max(1, Math.round((top - metres.ground) / metres.floor));
  const cornice: FaceBand = { y0: top, y1: ROOFLINE, layer: BAND_LAYER.cornice, v0: 0, v1: 1 };
  if (face === FACADE_FACE.street) {
    return { bays, bands: [{ y0: 0, y1: metres.ground, layer: BAND_LAYER.ground, v0: 0, v1: 1 }, { y0: metres.ground, y1: top, layer: BAND_LAYER.floor, v0: 0, v1: storeys }, cornice] };
  }
  const plinth = (LEVELS[STYLE_INTERIOR[style]].floors[0]! * BLOCK_HEIGHT) / styleHeight(style);
  const lines = [plinth, metres.ground, ...Array.from({ length: storeys }, (_, storey) => metres.ground + ((storey + 1) * (top - metres.ground)) / storeys)];
  const bands: FaceBand[] = [{ y0: 0, y1: plinth, layer: BAND_LAYER.floor, v0: 0, v1: PLINTH_V }];
  for (let line = 0; line + 1 < lines.length; line++) bands.push({ y0: lines[line]!, y1: lines[line + 1]!, layer: BAND_LAYER.floor, v0: 0, v1: 1 });
  bands.push(cornice);
  const sideBays = Math.max(1, Math.round((LAYOUT.houseDepth * bays) / (STYLE_LOTS[style] * LAYOUT.lotFrontage)));
  return { bays: face === FACADE_FACE.back ? bays : sideBays, bands };
}

/** A window on a face in plan metres: along the face (the plan's across on the street and the back, its deep on a side) and up from the ground. */
type FacadeWindow = { face: FacadeFace; along0: number; along1: number; y0: number; y1: number };

/** The footprint a place's windows are measured on: half its drawn width and its drawn depth (m). */
type DrawnFootprint = { halfWidth: number; depth: number };

/** A share `f` of a face's width (0 where its picture starts, u growing to the viewer's right) as a plan coordinate along it. */
function alongOf(face: FacadeFace, f: number, foot: DrawnFootprint): number {
  if (face === FACADE_FACE.street) return foot.halfWidth - 2 * f * foot.halfWidth;
  if (face === FACADE_FACE.back) return -foot.halfWidth + 2 * f * foot.halfWidth;
  return face === FACADE_FACE.plusAcross ? foot.depth * (1 - f) : foot.depth * f;
}

/** The faces a place shows: its street and back faces, and each side the neighbours leave open. */
function facesOf(openSides: number): FacadeFace[] {
  return [FACADE_FACE.street, FACADE_FACE.back, ...(openSides & OPEN_SIDE.plusAcross ? [FACADE_FACE.plusAcross] : []), ...(openSides & OPEN_SIDE.minusAcross ? [FACADE_FACE.minusAcross] : [])];
}

/** Height (m) at `v` of a band's layer, the band in block metres and `scale` the building's metres per block metre. */
function bandHeight(band: FaceBand, v: number, scale: number): number {
  return (band.y0 + ((v - band.v0) / (band.v1 - band.v0)) * (band.y1 - band.y0)) * scale;
}

/** What the table needs of a place: its facade style, which sides are open, and its drawn footprint. */
type WindowedPlace = { style: string; openSides: number; foot: DrawnFootprint };

/** Every window the facade shows on every face it shows: none for a style with no interior. */
function facadeWindows(place: WindowedPlace): FacadeWindow[] {
  if (!isOpenStyle(place.style)) return [];
  const style = place.style;
  const scale = styleHeight(style) / BLOCK_HEIGHT;
  const out: FacadeWindow[] = [];
  for (const face of facesOf(place.openSides)) {
    const { bays, bands } = faceBands(style, face);
    for (const band of bands) {
      if (band.layer === BAND_LAYER.cornice) continue;
      const rects = band.layer === BAND_LAYER.ground ? table[style].windows.ground : table[style].windows.floor;
      for (let repeat = Math.floor(band.v0); repeat < Math.ceil(band.v1); repeat++) {
        for (const [u0, v0, u1, v1] of rects) {
          const low = repeat + v0!;
          const high = repeat + v1!;
          if (low < band.v0 - V_TOLERANCE || high > band.v1 + V_TOLERANCE) continue;
          for (let bay = 0; bay < bays; bay++) {
            const a = alongOf(face, (bay + u0!) / bays, place.foot);
            const b = alongOf(face, (bay + u1!) / bays, place.foot);
            out.push({ face, along0: Math.min(a, b), along1: Math.max(a, b), y0: bandHeight(band, low, scale), y1: bandHeight(band, high, scale) });
          }
        }
      }
    }
  }
  return out;
}

/** The doorways of a face (plan across, and their head over the ground) a window beside or over them belongs to. */
function doorwaysOf(kind: InteriorKind, width: number, face: FacadeFace, floorY: number): { centre: number; half: number; head: number }[] {
  if (face === FACADE_FACE.back) return kind === "rowhome" ? [{ centre: BACK_DOOR.centre, half: BACK_DOOR.width / 2, head: floorY + BACK_DOOR.top }] : [];
  if (face !== FACADE_FACE.street) return [];
  const bays = Math.round(width / BAY_WIDTH);
  const out: { centre: number; half: number; head: number }[] = [];
  for (let bay = 0; bay < bays; bay++) {
    for (const opening of SHOPFRONT[kind]) out.push({ centre: opening.centre + (bay - (bays - 1) / 2) * BAY_WIDTH, half: opening.width / 2, head: floorY + opening.top });
  }
  return out;
}

/** A window a room looks out of: the facade's, on the interior's floor `level`. */
export type RoomWindow = FacadeWindow & { level: number };

/** What the room windows need of a place. */
type RoomPlace = WindowedPlace & { interior: InteriorKind; width: number };

/**
 * The windows a room looks out of: the facade's windows within the interior's storeys (each on the floor it stands over), less those behind a rowhome's bay stack (its alcove is the room's window
 * there), those over or beside a doorway (its transom and surround), and those that do not fit under the ceiling of their floor.
 */
export function roomWindows(place: RoomPlace): RoomWindow[] {
  const { floors, topCeiling } = LEVELS[place.interior];
  const floorY = floors[0]!;
  const bayFrom = BAY.across - BAY.width / 2;
  const bayTo = BAY.across + BAY.width / 2;
  const out: RoomWindow[] = [];
  for (const window of facadeWindows(place)) {
    if (window.y0 < floorY || window.y1 > topCeiling) continue;
    if (place.interior === "rowhome" && window.face === FACADE_FACE.street && window.along1 > bayFrom && window.along0 < bayTo && window.y0 < BAY.top) continue;
    if (doorwaysOf(place.interior, place.width, window.face, floorY).some((door) => window.along1 > door.centre - door.half && window.along0 < door.centre + door.half && window.y0 < door.head + DOOR_SURROUND)) continue;
    const level = floors.reduce((found, floor, at) => (window.y0 >= floor ? at : found), 0);
    if (window.y1 > ceilingOver(floors, topCeiling, level) + CEILING_TOLERANCE) continue;
    out.push({ ...window, level });
  }
  return out;
}

/** The footprint of the walls a place's building draws: half its drawn width and its drawn depth (m). */
function drawnFootprintOf(place: Pick<Place, "width" | "depth">): DrawnFootprint {
  return { halfWidth: drawnHalf(place.width), depth: 2 * drawnHalf(place.depth) };
}

/** What `roomWindows` takes of a place, or null where it has no interior. */
export function roomPlaceOf(place: Pick<Place, "interior" | "style" | "width" | "depth" | "openSides">): RoomPlace | null {
  if (place.interior === undefined) return null;
  return { interior: place.interior, style: place.style, width: place.width, openSides: place.openSides ?? 0, foot: drawnFootprintOf(place) };
}
