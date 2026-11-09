import { describe, expect, it } from "vitest";
import { MAT } from "../kernel/material-ids.ts";
import { PREFAB, SCENERY_ARM } from "../world/constants.ts";
import { MAX_STOREYS, MIN_STOREYS } from "../world/openworld/interior-kinds.ts";
import { openWorldCourse } from "../world/openworld/openworld-course.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { placeProps } from "../world/placements.ts";
import { Track } from "../world/track.ts";
import { partyBuildingsOf } from "./building-sides.ts";
import { buildingPieces } from "./facade-mesh.ts";
import { FACADE_LAYERS, facadeSkin, LAYER, splitFacadeSkin, type FacadeStyle } from "./facades.ts";

const EPSILON = 1e-9;
/** A geometry holds its uv in 32 bits: the plain patch is read back to this many decimals. */
const UV_DIGITS = 6;
/** The facade styles of the houses. */
const HOME_FACADES: readonly FacadeStyle[] = ["rowbrick", "rowpainted"];
/** The storey counts houses are built with. */
const STOREY_COUNTS = Array.from({ length: MAX_STOREYS - MIN_STOREYS + 1 }, (_, at) => MIN_STOREYS + at);
/** The least number of buildings in the layout with a neighbour either side. */
const PARTY_BUILDINGS_MIN = 150;

const lots = layOutLots();
const places = lots.places.slice(0, lots.backdropStart).filter((place) => place.interior !== undefined);
const placed = placeProps(new Track(openWorldCourse(lots)), SCENERY_ARM.off);
const party = partyBuildingsOf(placed);

describe("given the open world's buildings and what stands against their sides", () => {
  // mutation: sed -i 's/(halfWidth + SIDE_PROBE)/(halfWidth - SIDE_PROBE)/g' src/game/present/building-sides.ts
  it("when each place with an interior is compared with its building, then the building has bare side walls exactly where the place has no open side", () => {
    const wrong: string[] = [];
    let bare = 0;
    for (const place of places) {
      const building = placed.find((candidate) => (candidate.prefab === PREFAB.building || candidate.prefab === PREFAB.buildingShell) && Math.abs(candidate.x - place.x) < EPSILON * 1e6 && Math.abs(candidate.z - place.z) < EPSILON * 1e6);
      if (building === undefined) {
        wrong.push(`${place.name}: no building`);
        continue;
      }
      const closed = (place.openSides ?? 0) === 0;
      if (party.has(building)) bare++;
      if (party.has(building) !== closed) wrong.push(`${place.name}: ${closed ? "closed but drawn with windows" : "open but drawn bare"}`);
    }
    expect(wrong.slice(0, 3).join("; "), "buildings whose sides disagree with their place's").toBe("");
    expect(bare, "buildings with bare sides").toBeGreaterThanOrEqual(PARTY_BUILDINGS_MIN);
    expect(bare, "buildings with bare sides").toBeLessThan(places.length);
  });
});

describe("given a building skin with party walls", () => {
  // mutation: sed -i 's/  if (storeys === DEFAULT_STOREYS) return party ? `${style}${PARTY_MARK}` : style;/  if (storeys === DEFAULT_STOREYS) return style;/' src/game/present/facades.ts
  it("when a skin is made and split for every style, storey count and party wall, then it names them again and no two skins are the same", () => {
    const seen = new Set<string>();
    const styles: readonly FacadeStyle[] = ["rowbrick", "rowpainted", "cornerstore"];
    for (const style of styles) {
      for (const storeys of STOREY_COUNTS) {
        for (const wall of [false, true]) {
          const skin = facadeSkin(style, storeys, wall);
          const split = splitFacadeSkin(skin);
          expect(split.style, `${skin}: style`).toBe(style);
          expect(split.storeys, `${skin}: storeys`).toBe(storeys);
          expect(split.party, `${skin}: party wall`).toBe(wall);
          seen.add(skin);
        }
      }
    }
    expect(seen.size, "distinct skins").toBe(styles.length * STOREY_COUNTS.length * 2);
  });
});

describe("given a house drawn with party walls", () => {
  /** The first vertex's normal of each piece, the piece's uv extent (the least and greatest u and v) and its layer. */
  function pieceFaces(style: FacadeStyle, storeys: number, wall: boolean): { normal: [number, number, number]; uv: [number, number, number, number]; layer: number }[] {
    return buildingPieces(style, MAT.BUILDING_WALL, false, storeys, wall).map(([geometry, , , region]) => {
      const normal = geometry.getAttribute("normal");
      const uv = geometry.getAttribute("uv");
      const extent: [number, number, number, number] = [Infinity, -Infinity, Infinity, -Infinity];
      for (let at = 0; at < uv.count; at++) {
        extent[0] = Math.min(extent[0], uv.getX(at));
        extent[1] = Math.max(extent[1], uv.getX(at));
        extent[2] = Math.min(extent[2], uv.getY(at));
        extent[3] = Math.max(extent[3], uv.getY(at));
      }
      return { normal: [normal.getX(0), normal.getY(0), normal.getZ(0)], uv: extent, layer: region?.[0] ?? LAYER.floor };
    });
  }
  const isSide = (face: { normal: [number, number, number] }): boolean => Math.abs(face.normal[2]) > 0.9;
  const isFlat = (uv: [number, number, number, number]): boolean => uv[1] - uv[0] < EPSILON && uv[3] - uv[2] < EPSILON;

  // mutation: sed -i 's/const bare = party \&\& SIDE_FACES.includes(index) \&\& !cornice;/const bare = false;/' src/game/present/facade-mesh.ts
  it("when its pieces are read, then every band of a side wall but the cornice reads the plain patch of wall, and the street, the back and the cornice are as they were", () => {
    for (const style of HOME_FACADES) {
      const [plainU, plainV] = FACADE_LAYERS[style].plain as readonly [number, number];
      for (const storeys of STOREY_COUNTS) {
        const bare = pieceFaces(style, storeys, true);
        const open = pieceFaces(style, storeys, false);
        expect(bare.length, `${style} of ${storeys} storeys: pieces`).toBe(open.length);
        let sides = 0;
        for (const [at, face] of bare.entries()) {
          const label = `${style} of ${storeys} storeys, piece ${at}`;
          if (isSide(face) && face.layer !== LAYER.cornice) {
            sides++;
            expect(isFlat(face.uv), `${label}: bare`).toBe(true);
            expect(face.uv[0], `${label}: plain patch u`).toBeCloseTo(plainU, UV_DIGITS);
            expect(face.uv[2], `${label}: plain patch v`).toBeCloseTo(plainV, UV_DIGITS);
          } else {
            expect(face.uv.every((value, k) => Math.abs(value - open[at]!.uv[k]!) < EPSILON), `${label}: unchanged`).toBe(true);
          }
        }
        expect(sides, `${style} of ${storeys} storeys: bare side bands`).toBeGreaterThan(0);
      }
    }
  });
});
