import { describe, expect, it } from "vitest";
import { PREFABS } from "../catalog.ts";
import { PREFAB } from "../constants.ts";
import { TREE_SCALE } from "../scenery.ts";
import { SCENERY_ASSETS } from "../scenery-assets/index.ts";
import { FACING } from "./openworld-constants.ts";
import { openWorldCourse } from "./openworld-course.ts";
import { fabricProps } from "./openworld-fabric.ts";
import { BAY, DOOR, homeFrontages, STOOP } from "./openworld-facade-solids.ts";
import { greeneryAt, stoopGreeneryProps, streetTreeOf } from "./openworld-greenery.ts";
import { inClearPath } from "./openworld-greenery.test-util.ts";
import { layOutLots } from "./openworld-lots.ts";
import { buildOpenWorldMap } from "./openworld-map.ts";
import { sidePoint, sidesOf, treeStations } from "./openworld-sides.ts";

/** A drawn turn off the street's facing, at most (rad): the form's `TURN_SPREAD`. */
const MOST_TURN = 0.15;
/** Float noise on a point's coordinates (m). */
const EPSILON = 1e-6;
const AT_LEAST_KINDS = 3;
const SIZES_OF_A_KIND = 2;
/** The share of rowhomes with a pot or a shrub must lie between these, so the street is neither bare nor planted solid. */
const SHARE_OF_HOMES = { least: 0.25, most: 0.9 } as const;
const HALF_TURN = Math.PI;

const lots = layOutLots();
const course = openWorldCourse(lots);
const courseProps = course.props ?? [];
const trees = courseProps.filter((prop) => prop.prefab === PREFAB.tree);
const frontages = homeFrontages(lots.places.slice(0, lots.backdropStart));
const fabric = fabricProps(lots, buildOpenWorldMap(lots).graph);
const cellarDoors = fabric.filter((prop) => prop.prefab === PREFAB.cellarDoor);
const greenery = stoopGreeneryProps(lots, fabric);

/** Each station's spot and its face's facing, as the course stands its trees. */
function stations(): { x: number; z: number; facing: number }[] {
  return lots.blocks.flatMap((block) =>
    sidesOf(block, lots.geometry).flatMap((side) =>
      treeStations(side).map((along) => ({ ...sidePoint(side, along, lots.geometry.sidewalk - lots.geometry.sidewalkFurniture / 2), facing: side.outwardYaw })),
    ),
  );
}

const keyOf = (x: number, z: number): string => `${x.toFixed(3)},${z.toFixed(3)}`;

function turnBetween(a: number, b: number): number {
  const turn = Math.abs(a - b) % (2 * HALF_TURN);
  return Math.min(turn, 2 * HALF_TURN - turn);
}

describe("given the open world's street trees", () => {
  it("when the course is read, then a tree stands at every station as the one solid tree prop at the same scale with no turn or size of its own, so the colliders are those the sim always had", () => {
    const expected = stations().map((station) => keyOf(station.x, station.z));
    expect(trees.length).toBe(expected.length);
    expect(trees.map((tree) => keyOf(tree.x, tree.z)).join("|")).toBe(expected.join("|"));
    for (const tree of trees) {
      expect(tree.scale, "scale").toBe(TREE_SCALE);
      expect(tree.yaw, "yaw").toBeUndefined();
      expect(tree.size, "size").toBeUndefined();
    }
    expect(PREFABS[PREFAB.tree].body).toBe("solid");
  });

  it("when the trees' styles are read, then they are of at least three kinds, a kind comes in more than one size, and each faces its own street within a small turn", () => {
    const drawn = trees.map((tree) => streetTreeOf(tree.style));
    const kinds = new Set(drawn.map((tree) => tree?.kind));
    expect(kinds.has(undefined), "every tree names a street tree").toBe(false);
    expect(kinds.size).toBeGreaterThanOrEqual(AT_LEAST_KINDS);
    for (const kind of kinds) {
      const sizes = new Set(drawn.filter((tree) => tree?.kind === kind).map((tree) => tree!.scale));
      expect(sizes.size, `sizes of ${kind}`).toBeGreaterThanOrEqual(SIZES_OF_A_KIND);
    }
    const facings = stations().map((station) => station.facing);
    for (const [index, tree] of drawn.entries()) expect(turnBetween(tree!.yaw, facings[index]!), `tree ${index}`).toBeLessThanOrEqual(MOST_TURN + EPSILON);
    expect(new Set(drawn.map((tree) => tree!.yaw.toFixed(3))).size, "turns").toBeGreaterThan(Object.keys(FACING).length);
  });

  it("when the course is made twice, then every tree has the same style: the variety is seeded by its spot", () => {
    const again = openWorldCourse(layOutLots()).props?.filter((prop) => prop.prefab === PREFAB.tree) ?? [];
    expect(again.map((tree) => tree.style).join("|")).toBe(trees.map((tree) => tree.style).join("|"));
    expect(trees.every((tree) => tree.style !== undefined)).toBe(true);
  });

  it("when a style is not a street tree's, then it names none: a tree of any other course keeps drawing as it does", () => {
    expect(streetTreeOf(undefined)).toBeNull();
    expect(streetTreeOf("rowbrick")).toBeNull();
    expect(streetTreeOf("street-tree:oak:north:0")).toBeNull();
    expect(streetTreeOf("street-tree:plane:up:0")).toBeNull();
    expect(streetTreeOf("street-tree:plane:north:99")).toBeNull();
  });
});

describe("given the greenery at the rowhomes' fronts", () => {
  it("when the course is read, then the pots and shrubs are collider-less greenery assets listed after every other prop, at a share of the homes", () => {
    expect(greenery.length).toBeGreaterThan(0);
    for (const prop of greenery) {
      const row = SCENERY_ASSETS.find((asset) => asset.id === prop.asset)!;
      expect(row.family, prop.asset).toBe("greenery");
      expect(PREFABS[prop.prefab].body, prop.asset).toBe("none");
    }
    const tail = courseProps.slice(courseProps.length - greenery.length);
    expect(tail.map((prop) => `${prop.asset}@${keyOf(prop.x, prop.z)}`).join("|")).toBe(greenery.map((prop) => `${prop.asset}@${keyOf(prop.x, prop.z)}`).join("|"));
    const dressed = frontages.filter((frontage) => greeneryAt(frontage, lots.geometry, fabric).length > 0).length;
    expect(dressed / frontages.length).toBeGreaterThanOrEqual(SHARE_OF_HOMES.least);
    expect(dressed / frontages.length).toBeLessThanOrEqual(SHARE_OF_HOMES.most);
  });

  it("when every pot and shrub's drawn extent is read, then none stands in the bay, on a stoop tread, inside the wall or in the sidewalk's clear path", () => {
    for (const frontage of frontages) {
      for (const prop of greeneryAt(frontage, lots.geometry, fabric)) {
        for (const [out, across, x, z] of extentOf(prop, frontage)) {
          const at = `${prop.asset} at ${keyOf(frontage.x, frontage.z)}`;
          expect(out, `${at} inside the wall`).toBeGreaterThan(-EPSILON);
          expect(inBox(out, across, 0, BAY.out, BAY.across - BAY.width / 2, BAY.across + BAY.width / 2), `${at} in the bay`).toBe(false);
          expect(inBox(out, across, 0, STOOP.run, DOOR.across - STOOP.width / 2, DOOR.across + STOOP.width / 2), `${at} on the stoop`).toBe(false);
          expect(inClearPath(lots, x, z, EPSILON), `${at} in the clear path`).toBe(false);
        }
      }
    }
  });

  it("when the street's cellar doors are read, then no pot or shrub stands on one, and without the doors the plants would", () => {
    expect(cellarDoors.length).toBeGreaterThan(0);
    const covered = (list: typeof fabric): number =>
      frontages.flatMap((frontage) => greeneryAt(frontage, lots.geometry, list)).filter((prop) => cellarDoors.some((door) => insideDoor(door, prop))).length;
    expect(covered(fabric)).toBe(0);
    expect(covered([])).toBeGreaterThan(0);
  });

  it("when two houses stand side by side, then their plants stay in their own lot's width", () => {
    const half = lots.geometry.lotFrontage / 2;
    for (const frontage of frontages) {
      for (const prop of greeneryAt(frontage, lots.geometry, fabric)) {
        for (const [, across] of extentOf(prop, frontage)) expect(Math.abs(across), prop.asset).toBeLessThan(half);
      }
    }
  });
});

/** The four ends of a cross sprite's two quads, from first principles: a quad spans its own width along one of two crossed horizontal directions, centred on the prop. As (out, across, x, z). */
function extentOf(prop: { asset: string; x: number; z: number; yaw: number; scale: number }, frontage: { x: number; z: number; yaw: number }): [number, number, number, number][] {
  const width = SCENERY_ASSETS.find((asset) => asset.id === prop.asset)!.size[0] * prop.scale;
  const ends: [number, number, number, number][] = [];
  for (const [dx, dz] of [
    [Math.sin(prop.yaw), Math.cos(prop.yaw)],
    [Math.cos(prop.yaw), -Math.sin(prop.yaw)],
  ] as const) {
    for (const sign of [-1, 1]) {
      const x = prop.x + (sign * width * dx) / 2;
      const z = prop.z + (sign * width * dz) / 2;
      const out = (x - frontage.x) * Math.cos(frontage.yaw) - (z - frontage.z) * Math.sin(frontage.yaw);
      const across = (x - frontage.x) * Math.sin(frontage.yaw) + (z - frontage.z) * Math.cos(frontage.yaw);
      ends.push([out, across, x, z]);
    }
  }
  return ends;
}

/** Whether a plant's centre lies over a cellar door's footprint (turned as its house: the first extent out of the wall, the third along it). */
function insideDoor(door: { x: number; z: number; yaw: number }, plant: { x: number; z: number }): boolean {
  const [depth, , span] = PREFABS[PREFAB.cellarDoor].size;
  const out = (plant.x - door.x) * Math.cos(door.yaw) - (plant.z - door.z) * Math.sin(door.yaw);
  const across = (plant.x - door.x) * Math.sin(door.yaw) + (plant.z - door.z) * Math.cos(door.yaw);
  return Math.abs(out) < depth / 2 && Math.abs(across) < span / 2;
}

/** Whether (out, across) lies strictly inside the box, by more than float noise. */
function inBox(out: number, across: number, nearOut: number, farOut: number, nearAcross: number, farAcross: number): boolean {
  return out > nearOut + EPSILON && out < farOut - EPSILON && across > nearAcross + EPSILON && across < farAcross - EPSILON;
}
