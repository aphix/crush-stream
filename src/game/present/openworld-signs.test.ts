import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { drawnHalf } from "../world/openworld/openworld-facade-solids.ts";
import type { Building } from "../world/openworld/openworld-layout.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { buildOpenWorldMap } from "../world/openworld/openworld-map.ts";
import { FACE_MARGIN, isBusiness, SHOP_SIGN, ShopSigns } from "./openworld-shop-signs.ts";
import { NAME, nameSpecs, OpenWorldSigns, type SignSight } from "./openworld-signs.ts";

/** A stand-in glyph's width (px): the layout only needs text to have one. */
const MEASURED_ADVANCE = 22;
/** The rowhomes' ground storey (m): a name over a door stays under it. */
const GROUND_STOREY = 3.6;
/** The lowest a name over a door may hang (m): above a door's top. */
const DOOR_TOP = 2.4;
const FAR_AWAY = 5000;
const EPSILON = 1e-9;
/** Float32 vertex positions round by about this much (m) at the city's coordinates. */
const FLOAT32_SLACK = 1e-4;
/** A point this near (m) a building's drawn street wall, past the standoff, hangs on it. */
const ON_FACE = 1e-3;
const MAX_ATLAS_BYTES = 16 * 2 ** 20;
const BYTES_PER_TEXEL = 4;

const lots = layOutLots();
const map = buildOpenWorldMap(lots);
const inside = [...map.places.entries()].filter(([, place]) => place.doorNode >= 0 && place.name !== "");
const painted: string[] = [];

/** A 2D context that measures text by its length and keeps every string drawn. */
const context: object = new Proxy(
  {},
  {
    get: (_target, key) => {
      if (key === "measureText") return (text: string) => ({ width: text.length * MEASURED_ADVANCE });
      if (key === "fillText") return (text: string) => void painted.push(text);
      return () => context;
    },
    set: () => true,
  },
);

beforeAll(() => {
  Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } });
});

/** A point's offsets (m) from a building's middle: along its street wall and out of it. */
function offsetsOn(building: Building, x: number, z: number): { along: number; out: number } {
  const normalX = Math.cos(building.yaw);
  const normalZ = -Math.sin(building.yaw);
  const dx = x - building.x;
  const dz = z - building.z;
  return { along: dx * normalZ - dz * normalX, out: dx * normalX + dz * normalZ };
}

/** The building whose drawn street wall, `standoff` m out, the point lies on. */
function buildingFacing(x: number, z: number, standoff: number): Building | undefined {
  return lots.buildings.find((building) => {
    const { along, out } = offsetsOn(building, x, z);
    return Math.abs(along) <= drawnHalf(building.width) && Math.abs(out - drawnHalf(building.depth) - standoff) < ON_FACE;
  });
}

/** Every corner of quad `first` .. `first + 3` lies `FACE_MARGIN` or more inside the ends of `building`'s drawn street wall. */
function expectInsideFace(building: Building, position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, first: number, what: string): void {
  for (let vertex = first; vertex < first + 4; vertex++) {
    expect(Math.abs(offsetsOn(building, position.getX(vertex), position.getZ(vertex)).along), what).toBeLessThanOrEqual(drawnHalf(building.width) - FACE_MARGIN + FLOAT32_SLACK);
  }
}

function signsOf(signs: OpenWorldSigns): THREE.Group {
  return signs["names"]!.group;
}

function visibleChunks(signs: OpenWorldSigns): number {
  return signsOf(signs).children.filter((chunk) => chunk.visible).length;
}

describe("given the open world's map", () => {
  const specs = nameSpecs(map.places);
  const fronts = specs.filter((spec) => !spec.back);

  it("when the names are laid out, then there is one label for each named place inside the walls and none for the backdrop beyond them", () => {
    expect(map.places.some((place) => place.doorNode < 0)).toBe(true);
    expect(inside.length).toBeGreaterThan(0);
    expect(fronts.map((spec) => spec.place).join(",")).toBe(inside.map(([index]) => index).join(","));
    expect(fronts.map((spec) => spec.text).join("|")).toBe(inside.map(([, place]) => place.name).join("|"));
  });

  it("when a building's name is placed, then it hangs on the street face with the door under it: a home's under the ground storey, a business's over its sign band", () => {
    const buildings = fronts.filter((spec) => map.places[spec.place]!.storeys > 0);
    expect(buildings.length).toBeGreaterThan(0);
    for (const spec of buildings) {
      const place = map.places[spec.place]!;
      const doorAlong = (place.doorX - spec.x) * spec.normalZ - (place.doorZ - spec.z) * spec.normalX;
      expect(Math.abs(doorAlong), place.name).toBeLessThanOrEqual(spec.maxWidth / 2);
      expect(Math.abs(spec.z - place.z), place.name).toBeCloseTo(drawnHalf(place.depth) + NAME.standoff, 3);
      if (isBusiness(place)) expect(spec.y, place.name).toBeGreaterThan(SHOP_SIGN.bottom + SHOP_SIGN.height);
      else {
        expect(spec.y, place.name).toBeGreaterThan(DOOR_TOP);
        expect(spec.y, place.name).toBeLessThan(GROUND_STOREY);
      }
    }
  });

  it("when two places share a door, then their names stack apart instead of overlapping", () => {
    const byDoor = new Map<string, typeof fronts>();
    for (const spec of fronts) {
      const place = map.places[spec.place]!;
      const key = `${place.doorX},${place.doorZ}`;
      byDoor.set(key, [...(byDoor.get(key) ?? []), spec]);
    }
    const shared = [...byDoor.values()].filter((group) => group.length > 1);
    expect(shared.length).toBeGreaterThan(0);
    for (const group of shared) {
      for (let low = 0; low < group.length; low++) {
        for (let high = low + 1; high < group.length; high++) {
          const reach = (NAME.plateHeightEm * (group[low]!.em + group[high]!.em)) / 2;
          expect(Math.abs(group[low]!.y - group[high]!.y)).toBeGreaterThanOrEqual(reach - EPSILON);
        }
      }
    }
  });

  it("when a place has no front of its own, then its name is also written the other way round so it reads from both sides; a building's is written once", () => {
    const backs = specs.filter((spec) => spec.back);
    expect(backs.length).toBe(fronts.filter((spec) => map.places[spec.place]!.storeys === 0).length);
    for (const back of backs) {
      const front = fronts.find((spec) => spec.place === back.place)!;
      expect(back.normalX).toBeCloseTo(-front.normalX, 9);
      expect(back.normalZ).toBeCloseTo(-front.normalZ, 9);
    }
  });
});

describe("given the signage of the open world", () => {
  const sight = (answer: boolean): SignSight => ({ seen: () => answer });

  it("when the button has never been on, then only the shop signs exist, and the names are built at the first frame it is on", () => {
    const signs = new OpenWorldSigns(map.places);
    signs.update(0, 0, false, null);
    expect(signs.group.children.length).toBe(1);
    expect(signs["names"]).toBeNull();
    signs.update(0, 0, true, null);
    expect(signs.group.children.length).toBe(2);
    expect(signs["names"]).not.toBeNull();
  });

  it("when the names are on, then every name is drawn as a plate and a quad for each letter, in few draw calls", () => {
    const signs = new OpenWorldSigns(map.places);
    signs.update(0, 0, true, null);
    const chunks = signsOf(signs).children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    let quads = 0;
    for (const chunk of chunks) quads += chunk.geometry.getIndex()!.count / 6;
    const expectedQuads = nameSpecs(map.places).reduce((sum, spec) => sum + spec.text.replaceAll(" ", "").length + 1, 0);
    expect(quads).toBe(expectedQuads);
    const chunkColumns = Math.ceil((2 * map.halfX) / NAME.chunkSize) + 1;
    const chunkRows = Math.ceil((2 * map.halfZ) / NAME.chunkSize) + 1;
    expect(chunks.length).toBeLessThanOrEqual(chunkColumns * chunkRows);
  });

  it("when the names are drawn, then every name plate on a building's drawn street wall stays FACE_MARGIN inside both ends of that wall", () => {
    const signs = new OpenWorldSigns(map.places);
    signs.update(0, 0, true, null);
    let plates = 0;
    for (const chunk of signsOf(signs).children) {
      if (!(chunk instanceof THREE.Mesh)) continue;
      const position = chunk.geometry.getAttribute("position");
      const uv = chunk.geometry.getAttribute("uv");
      for (let first = 0; first < position.count; first += 4) {
        const flatTint = uv.getX(first) === uv.getX(first + 2) && uv.getY(first) === uv.getY(first + 2);
        if (!flatTint) continue;
        const building = buildingFacing((position.getX(first) + position.getX(first + 2)) / 2, (position.getZ(first) + position.getZ(first + 2)) / 2, NAME.standoff);
        if (building === undefined) continue;
        plates++;
        expectInsideFace(building, position, first, `plate at vertex ${first}`);
      }
    }
    expect(plates).toBeGreaterThanOrEqual(nameSpecs(map.places).filter((spec) => map.places[spec.place]!.storeys > 0).length);
  });

  it("when the button goes off and on, then the names hide and show while the shop signs stay", () => {
    const signs = new OpenWorldSigns(map.places);
    signs.update(0, 0, true, null);
    signs.update(0, 0, false, null);
    expect(signsOf(signs).visible).toBe(false);
    expect(signs.group.children[0]!.visible).toBe(true);
    signs.update(0, 0, true, null);
    expect(signsOf(signs).visible).toBe(true);
  });

  it("when the eye stands in the middle of the city, then the chunks past the name range are not drawn, and with no eye near none is", () => {
    const signs = new OpenWorldSigns(map.places);
    signs.update(0, 0, true, null);
    const total = signsOf(signs).children.length;
    expect(visibleChunks(signs)).toBeGreaterThan(0);
    expect(visibleChunks(signs)).toBeLessThan(total);
    signs.update(FAR_AWAY, FAR_AWAY, true, null);
    expect(visibleChunks(signs)).toBe(0);
  });

  it("when the sight field says a chunk is unseen, then it is not drawn, and when it says seen it is drawn as with no field", () => {
    const signs = new OpenWorldSigns(map.places);
    signs.update(0, 0, true, null);
    const withoutField = visibleChunks(signs);
    signs.update(0, 0, true, sight(false));
    expect(visibleChunks(signs)).toBe(0);
    signs.update(0, 0, true, sight(true));
    expect(visibleChunks(signs)).toBe(withoutField);
  });
});

describe("given the shop signs of the open world", () => {
  const businesses = [...map.places.entries()].filter(([, place]) => isBusiness(place));

  it("when they are built, then every business has its name painted in one atlas inside a bounded texture and one mesh draws them all", () => {
    painted.length = 0;
    const shop = new ShopSigns(map.places);
    expect(businesses.length).toBeGreaterThan(0);
    for (const [, place] of businesses) expect(painted).toContain(place.name);
    expect(shop.group.children.length).toBe(1);
    expect(shop.texture.image.width * shop.texture.image.height * BYTES_PER_TEXEL).toBeLessThanOrEqual(MAX_ATLAS_BYTES);
  });

  it("when the atlas is asked for a place's sign, then a business has a rectangle inside the atlas that no other sign shares, and a home has none", () => {
    const shop = new ShopSigns(map.places);
    const rects = businesses.map(([index]) => shop.uvRect(index)!);
    for (const rect of rects) {
      expect(rect).not.toBeNull();
      for (const value of rect) expect(value).toBeGreaterThanOrEqual(0);
      for (const value of rect) expect(value).toBeLessThanOrEqual(1);
    }
    for (let low = 0; low < rects.length; low++) {
      for (let high = low + 1; high < rects.length; high++) {
        const [u0, v0, u1, v1] = rects[low]!;
        const [p0, q0, p1, q1] = rects[high]!;
        expect(u0 >= p1 || p0 >= u1 || v0 >= q1 || q0 >= v1, `signs ${low} and ${high}`).toBe(true);
      }
    }
    const homeIndex = map.places.findIndex((place) => place.doorNode >= 0 && !isBusiness(place));
    expect(shop.uvRect(homeIndex)).toBeNull();
  });

  it("when the signs are drawn, then every business's band hangs over its shop glass on its own building's drawn street wall and stays FACE_MARGIN inside both ends of that wall", () => {
    const shop = new ShopSigns(map.places);
    const panels = shop.group.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh)!;
    const position = panels.geometry.getAttribute("position");
    expect(position.count).toBe(businesses.length * 4);
    for (let sign = 0; sign < businesses.length; sign++) {
      const place = businesses[sign]![1];
      const first = sign * 4;
      const building = buildingFacing((position.getX(first) + position.getX(first + 2)) / 2, (position.getZ(first) + position.getZ(first + 2)) / 2, SHOP_SIGN.standoff);
      expect(building, place.name).toBeDefined();
      expect(Math.abs(building!.x - place.x) + Math.abs(building!.z - place.z), place.name).toBeLessThan(ON_FACE);
      expectInsideFace(building!, position, first, place.name);
      for (let vertex = first; vertex < first + 4; vertex++) {
        expect(position.getY(vertex), place.name).toBeGreaterThanOrEqual(SHOP_SIGN.bottom - FLOAT32_SLACK);
        expect(position.getY(vertex), place.name).toBeLessThanOrEqual(SHOP_SIGN.bottom + SHOP_SIGN.height + FLOAT32_SLACK);
      }
    }
  });
});
