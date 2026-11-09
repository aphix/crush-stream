import { describe, expect, it } from "vitest";
import { LEVELS, SLAB_THICK } from "../world/openworld/interior-kinds.ts";
import { FACADE_FACE, roomPlaceOf, roomWindows } from "../world/openworld/facade-windows.ts";
import { BAY, DOOR, drawnHalf, LOT_WIDTH } from "../world/openworld/openworld-facade-solids.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { HOME_STYLES } from "../world/openworld/openworld-programme.ts";
import { PLACE_KIND } from "../world/openworld/walk-graph.ts";
import { airconWindowsOf, shuttersOf, streetWindowsOf, visibleWindowsOf } from "./facade-fittings.ts";

const EPSILON = 1e-9;
/** The least a window's sill stands over its storey's interior floor (m): a seated person's knee and a table's edge are below it. */
const SILL_ABOVE_FLOOR_MIN = 0.5;
/** A shutter narrower than this reads as a trim strip (m), and the most clear the bay's belts and the party wall must leave it (m). */
const SHUTTER_WIDTH_MIN = 0.3;
const SHUTTER_CLEAR_MIN = 0.08;
/** How far (m) the door's transom in the picture may stand off the door the kit and the interior cut. */
const TRANSOM_OFF_DOOR_MAX = 0.2;
/** The windows a rowbrick picture shows on its street face: the ground band's two (the big one and the door's transom) and two storeys of two. */
const ROWBRICK_WINDOWS = 6;

describe("given the windows of the packed pictures on the street face", () => {
  // mutation: sed -i 's/const bottom = street ? ground : 0;/const bottom = street ? ground * 0.8 : 0;/' src/game/present/facade-mesh.ts
  it("when the windows the bay leaves visible are read against the interior's floors, then every sill stands well over its storey's floor and every head under the floor above", () => {
    const floors = LEVELS.rowhome.floors;
    for (const style of HOME_STYLES) {
      const windows = visibleWindowsOf(style);
      expect(windows.length, `${style}: visible windows`).toBeGreaterThanOrEqual(3);
      for (const window of windows) {
        const label = `${style} storey ${window.storey} window at ${window.across.toFixed(2)}`;
        expect(window.sill - floors[window.storey]!, `${label}: sill over its floor (m)`).toBeGreaterThanOrEqual(SILL_ABOVE_FLOOR_MIN);
        const ceiling = (floors[window.storey + 1] ?? LEVELS.rowhome.topCeiling + SLAB_THICK) - SLAB_THICK;
        expect(window.head, `${label}: head under the ceiling (m)`).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  // mutation: sed -i 's/const BAY_ACROSS = -0.9;/const BAY_ACROSS = 0.9;/' src/game/world/openworld/openworld-facade-solids.ts
  it("when the windows are split by the bay stack, then it hides exactly the ones on its half of the picture and the door's half is whole", () => {
    const all = streetWindowsOf("rowbrick");
    const visible = visibleWindowsOf("rowbrick");
    expect(all.length, "windows of the rowbrick picture's street face").toBe(ROWBRICK_WINDOWS);
    for (const window of all) {
      const label = `window at ${window.across.toFixed(2)}, storey ${window.storey}`;
      expect(visible.includes(window), `${label} visible`).toBe(window.across > 0);
    }
  });

  // mutation: sed -i 's/const high = (0.5 - u0) \* faceWidth;/const high = (0.5 - u0) * faceWidth + 2;/' src/game/present/facade-fittings.ts
  it("when the windows are laid on the face, then each is inside it and the door's transom stands in the door's column, its head over the door's", () => {
    const half = drawnHalf(LOT_WIDTH);
    for (const style of HOME_STYLES) {
      for (const window of streetWindowsOf(style)) {
        expect(window.across - window.width / 2, `${style}: window's low edge over the face (m)`).toBeGreaterThanOrEqual(-half);
        expect(window.across + window.width / 2, `${style}: window's high edge under the face (m)`).toBeLessThanOrEqual(half);
        expect(window.width, `${style}: window width (m)`).toBeGreaterThan(0.3);
        expect(window.head - window.sill, `${style}: window height (m)`).toBeGreaterThan(0.3);
      }
    }
    const transom = streetWindowsOf("rowbrick").find((window) => window.storey === 0 && window.across > 0)!;
    expect(Math.abs(transom.across - DOOR.across), "the transom's middle off the door's (m)").toBeLessThan(TRANSOM_OFF_DOOR_MAX);
    expect(transom.head, "the transom's head over the door's (m)").toBeGreaterThan(DOOR.head);
  });
});

describe("given the shutters and air-conditioners hung from the table", () => {
  // mutation: sed -i 's/const low = window.across - window.width \/ 2;/const low = window.across - window.width;/' src/game/present/facade-fittings.ts
  it("when each shutter is read against the windows, then it stands beside an upper window at its sill and height, clear of the bay and the face's edge, no narrower than a shutter", () => {
    const bayEdge = BAY.across + BAY.width / 2;
    const faceEdge = drawnHalf(LOT_WIDTH);
    const hung = shuttersOf("rowbrick");
    expect(hung.length, "rowbrick shutters").toBeGreaterThanOrEqual(4);
    expect(hung.length % 2, "shutters come in pairs").toBe(0);
    for (const style of HOME_STYLES) {
      const windows = visibleWindowsOf(style).filter((window) => window.storey > 0);
      for (const shutter of shuttersOf(style)) {
        const beside = windows.some((window) => {
          const edge = shutter.across < window.across ? window.across - window.width / 2 : window.across + window.width / 2;
          const near = shutter.across < window.across ? shutter.across + shutter.width / 2 : shutter.across - shutter.width / 2;
          return Math.abs(edge - near) < EPSILON && Math.abs(window.sill - shutter.sill) < EPSILON && Math.abs(window.head - window.sill - shutter.height) < EPSILON;
        });
        expect(beside, `${style}: a shutter at ${shutter.across.toFixed(2)} beside a window`).toBe(true);
        expect(shutter.width, `${style}: shutter width (m)`).toBeGreaterThanOrEqual(SHUTTER_WIDTH_MIN);
        expect(shutter.across - shutter.width / 2 - bayEdge, `${style}: shutter's clearance from the bay (m)`).toBeGreaterThanOrEqual(SHUTTER_CLEAR_MIN);
        expect(faceEdge - (shutter.across + shutter.width / 2), `${style}: shutter's clearance from the face's edge (m)`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  // mutation: sed -i 's/return visibleWindowsOf(style).filter((window) => window.storey > 0);/return visibleWindowsOf(style);/' src/game/present/facade-fittings.ts
  it("when the windows an air-conditioner may sit in are read, then they are upper windows the bay does not cover", () => {
    const candidates = airconWindowsOf("rowbrick");
    expect(candidates.length, "upper visible windows").toBe(2);
    expect(candidates.every((window) => window.storey > 0 && window.across > 0), "all upper and on the door's half").toBe(true);
  });

  it("when a style the table does not hold is asked, then it has no windows and no fittings", () => {
    expect(streetWindowsOf("fixture-row").length, "windows of a style without a table").toBe(0);
    expect(shuttersOf("fixture-row").length, "shutters of a style without a table").toBe(0);
  });
});

describe("given the windows the rooms look out of, from the same table", () => {
  const lots = layOutLots();
  const places = lots.places.slice(0, lots.backdropStart);

  // mutation: sed -i 's/return { across: (low + high) \/ 2, width: high - low, sill: bottom + v0 \* tall, head: bottom + v1 \* tall, storey };/return { across: (low + high) \/ 2, width: high - low, sill: bottom + v0 * tall + 0.05, head: bottom + v1 * tall, storey };/' src/game/present/facade-fittings.ts
  it("when a rowhome's upper windows are compared with the street windows its room looks out of, then each is the same window: the same middle, sill and head", () => {
    for (const style of HOME_STYLES) {
      const home = places.find((place) => place.kind === PLACE_KIND.home && place.style === style);
      const roomPlace = home === undefined ? null : roomPlaceOf(home);
      expect(roomPlace, `${style}: a home with a room`).not.toBeNull();
      const room = roomWindows(roomPlace!).filter((window) => window.face === FACADE_FACE.street && window.level > 0);
      const hung = airconWindowsOf(style);
      expect(room.length, `${style}: street windows the room looks out of above the ground`).toBe(hung.length);
      for (const window of hung) {
        const same = room.some((seen) => seen.level === window.storey && Math.abs((seen.along0 + seen.along1) / 2 - window.across) < EPSILON * 1e3 && Math.abs(seen.y0 - window.sill) < EPSILON * 1e3 && Math.abs(seen.y1 - window.head) < EPSILON * 1e3);
        expect(same, `${style}: storey ${window.storey} window at ${window.across.toFixed(2)} in the room's table`).toBe(true);
      }
    }
  });
});
