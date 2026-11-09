import { beforeAll, describe, expect, it } from "vitest";
import { stubBrowser } from "../../engine/engine-headless.test-util.ts";
import { detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import { must } from "../../kernel/must.test-util.ts";
import { humanSlot } from "../../match/survival.ts";
import { makePrefabMaterials, prefabParts, raceTextures } from "../../present/prefabs.ts";
import { PARKED_PREFABS, PREFABS } from "../catalog.ts";
import { PREFAB } from "../constants.ts";
import { placeCourse } from "../placements.ts";
import { Track, blankProjection, projectPath } from "../track.ts";
import { parseTrack } from "../track-schema.ts";
import { LAMP_FROM_CURB, LAYOUT } from "./openworld-constants.ts";
import { OPENWORLD_ID, openWorldCourse } from "./openworld-course.ts";
import { fixtureLots } from "./openworld-lots.test-util.ts";
import { buildOpenWorldMap } from "./openworld-map.ts";

/** A car is 2 m wide: a wall gap wider than this lets one through. */
const CAR_WIDTH = 2;
/** The street furniture rules held from outside the constants table: lamps every 32 m, trees every 9 m and 1.5 m from a lamp. */
const LAMP_SPACING_M = 32;
const TREE_SPACING_M = 9;
const TREE_LAMP_CLEARANCE_M = 1.5;

/** The walls stand on the outer streets' far property line, or on their far curb. */
const WALL_CASES = [
  { it: "walls on the outer streets' far property line", wallReach: LAYOUT.wallReach },
  { it: "walls on the outer streets' far curb", wallReach: LAYOUT.carriageway / 2 },
] as const;

for (const wallCase of WALL_CASES) {
  describe(`given the course of a layout with ${wallCase.it}`, () => {
    const lots = fixtureLots(wallCase.wallReach);
    const geometry = lots.geometry;
    const course = parseTrack(openWorldCourse(lots));
    const track = new Track(openWorldCourse(lots));
    const map = buildOpenWorldMap(lots);
    const buildings = course.props.filter((prop) => prop.prefab === PREFAB.building);
    const walls = course.props.filter((prop) => prop.prefab === PREFAB.invisibleWall);
    const furniture = course.props.filter((prop) => prop.prefab !== PREFAB.building && prop.prefab !== PREFAB.invisibleWall);
    const projection = blankProjection();

    type Prop = (typeof course.props)[number];

    /** The smallest margin (m) by which (x, z) is off every road: negative where it is on one. */
    const roadClearance = (x: number, z: number): number => {
      let clearance = Infinity;
      for (const path of track.paths()) {
        projectPath(path, x, z, -1, projection);
        clearance = Math.min(clearance, Math.sqrt(projection.dist2) - path.half[projection.k]!);
      }
      return clearance;
    };
    /** The four corners and the middle of a building prop's footprint. */
    const footprintPoints = (prop: Prop): [number, number][] => {
      const [depth, , width] = prop.size!;
      const points: [number, number][] = [[0, 0]];
      for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) points.push([(sideX * depth) / 2, (sideZ * width) / 2]);
      return points.map(([localX, localZ]) => [prop.x + localX * detCos(prop.yaw) + localZ * detSin(prop.yaw), prop.z - localX * detSin(prop.yaw) + localZ * detCos(prop.yaw)]);
    };
    const insideFootprint = (prop: Prop, x: number, z: number): boolean => {
      const [depth, , width] = prop.size!;
      const dx = x - prop.x;
      const dz = z - prop.z;
      return Math.abs(dx * detCos(prop.yaw) - dz * detSin(prop.yaw)) <= depth / 2 && Math.abs(dx * detSin(prop.yaw) + dz * detCos(prop.yaw)) <= width / 2;
    };

    // mutation: sed -i 's/geometry.streetX.slice(1, -1).map((x, index) => route(/geometry.streetX.slice(1, 1).map((x, index) => route(/' src/game/world/openworld/openworld-course.ts
    it("when it is parsed and built as a track, then it is the course named openworld, a closed loop with the interior streets as car-free routes", () => {
      expect(course.id, "course id").toBe(OPENWORLD_ID);
      expect(OPENWORLD_ID, "the id the scene asks for").toBe("openworld");
      expect(track.length, "loop length (m)").toBeGreaterThan(500);
      expect(track.routes.length, "interior streets").toBe(geometry.columns - 1 + (geometry.rows - 1));
      expect(
        track.routes.every((route) => route.count === 0),
        "no cars on the streets",
      ).toBe(true);
    });

    // mutation: sed -i 's/style: building.style }/style: "other" }/' src/game/world/openworld/openworld-course.ts
    it("when each building's door is looked at from the street, then a building prop of its style stands behind it, and every prop is some place's", () => {
      const wrong: string[] = [];
      const sheltering = new Set<Prop>();
      const withBuildings = map.places.filter((place) => place.doorNode >= 0 && place.style !== "");
      for (const place of withBuildings) {
        const behind = buildings.find((prop) => insideFootprint(prop, place.doorX - 0.5 * detCos(place.yaw), place.doorZ + 0.5 * detSin(place.yaw)));
        if (!behind || behind.style !== place.style) wrong.push(`${place.name} (${place.style}) behind ${behind?.style}`);
        else sheltering.add(behind);
      }
      expect(withBuildings.length, "places with a building").toBeGreaterThan(100);
      expect(wrong.slice(0, 3).join("; "), "doors without their building").toBe("");
      expect(buildings.filter((prop) => !sheltering.has(prop)).length, "building props no place's door is in front of").toBe(0);
    });

    // mutation: sed -i 's/size: \[building.depth, building.height, building.width\]/size: [building.depth * 3, building.height, building.width]/' src/game/world/openworld/openworld-course.ts
    it("when the buildings and the walk graph are laid against the roads, then no building corner and no walk node is on a carriageway", () => {
      const onRoad = buildings.filter((prop) => footprintPoints(prop).some(([x, z]) => roadClearance(x, z) < 0));
      const graph = map.graph;
      let nodesOnRoad = 0;
      for (let node = 0; node < graph.nodeX.length; node++) if (roadClearance(graph.nodeX[node]!, graph.nodeZ[node]!) < 0) nodesOnRoad++;
      expect(roadClearance(geometry.streetX[1]!, 0), "a street's middle is on the road").toBeLessThan(0);
      expect(roadClearance(0, 0), "the middle of the middle block is off every road").toBeGreaterThan(0);
      expect(onRoad.length, "building props with a corner on a road").toBe(0);
      expect(nodesOnRoad, "walk nodes on a road").toBe(0);
    });

    // mutation: sed -i 's/Array.from({ length: count }, (_, index) => {/Array.from({ length: count - 1 }, (_, index) => {/' src/game/world/openworld/openworld-course.ts
    it("when the invisible walls are laid along each edge of the play area, then no gap is wider than a car, none opens at a corner and each stands on the line the layout gives", () => {
      const thickness = walls[0]!.size![0];
      const edges = [
        { name: "north", alongX: true, fixed: -(geometry.halfZ + thickness / 2), half: geometry.halfX },
        { name: "south", alongX: true, fixed: geometry.halfZ + thickness / 2, half: geometry.halfX },
        { name: "west", alongX: false, fixed: -(geometry.halfX + thickness / 2), half: geometry.halfZ },
        { name: "east", alongX: false, fixed: geometry.halfX + thickness / 2, half: geometry.halfZ },
      ];
      for (const edge of edges) {
        const spans = walls
          .filter((piece) => Math.abs((edge.alongX ? piece.z : piece.x) - edge.fixed) < 1e-6)
          .map((piece) => {
            const along = edge.alongX ? piece.x : piece.z;
            return { from: along - piece.size![2] / 2, to: along + piece.size![2] / 2 };
          })
          .sort((a, b) => a.from - b.from);
        expect(spans.length, `${edge.name} wall pieces`).toBeGreaterThan(1);
        let widestGap = Math.max(spans[0]!.from + edge.half, edge.half - spans[spans.length - 1]!.to);
        for (let index = 1; index < spans.length; index++) widestGap = Math.max(widestGap, spans[index]!.from - spans[index - 1]!.to);
        expect(widestGap, `widest gap in the ${edge.name} wall (m)`).toBeLessThan(CAR_WIDTH);
        expect(widestGap, `widest gap in the ${edge.name} wall (m)`).toBeLessThan(0.01);
      }
    });

    // mutation: sed -i 's/geometry.sidewalk - LAMP_FROM_CURB/geometry.sidewalk - 1.6/' src/game/world/openworld/openworld-course.ts
    it("when every placed prop's footprint is laid against each block's sidewalk, then none stands in the clear path", () => {
      const low = geometry.sidewalkFrontage;
      const high = geometry.sidewalkFrontage + geometry.sidewalkClear;
      const inPath: string[] = [];
      for (const prop of furniture) {
        // A prop stands lengthways along its side: what the path sees is its width across, not the bounding circle that reaches along the street.
        const radius = Math.min(PREFABS[prop.prefab].foot, PREFABS[prop.prefab].size[0] / 2) * prop.scale;
        for (const block of lots.blocks) {
          const beyondX = Math.abs(prop.x - block.centreX) - geometry.blockLength / 2;
          const beyondZ = Math.abs(prop.z - block.centreZ) - geometry.blockDepth / 2;
          const outward = beyondX > 0 && beyondZ > 0 ? hypot2(beyondX, beyondZ) : Math.max(beyondX, beyondZ);
          if (outward + radius > low && outward - radius < high) inPath.push(`${prop.prefab} at ${prop.x.toFixed(1)}, ${prop.z.toFixed(1)}`);
        }
      }
      expect(furniture.length, "props measured").toBeGreaterThan(200);
      expect(inPath.slice(0, 3).join("; "), "props in a clear path").toBe("");
    });

    // mutation: sed -i 's/export const TREE_SPACING = 9;/export const TREE_SPACING = 4;/' src/game/world/openworld/openworld-constants.ts
    it("when a block's north face is read, then lamps stand about 32 m apart, trees about 9 m apart and no tree within 1.5 m of a lamp", () => {
      const block = lots.blocks[0]!;
      const lineZ = block.centreZ - geometry.blockDepth / 2;
      const along = (prefab: string, distance: number): number[] =>
        furniture
          .filter((prop) => prop.prefab === prefab && Math.abs(prop.z - (lineZ - distance)) < 0.01 && Math.abs(prop.x - block.centreX) < geometry.blockLength / 2)
          .map((prop) => prop.x)
          .sort((a, b) => a - b);
      const lamps = along(PREFAB.acornLamp, geometry.sidewalk - LAMP_FROM_CURB);
      const trees = along(PREFAB.tree, geometry.sidewalk - geometry.sidewalkFurniture / 2);
      const gaps = (xs: number[]): number[] => xs.slice(1).map((x, index) => x - xs[index]!);
      expect(lamps.length, "lamps on the face").toBeGreaterThanOrEqual(2);
      expect(trees.length, "trees on the face").toBeGreaterThanOrEqual(4);
      for (const gap of gaps(lamps)) {
        expect(gap, "lamp spacing (m)").toBeGreaterThan(LAMP_SPACING_M * 0.8);
        expect(gap, "lamp spacing (m)").toBeLessThan(LAMP_SPACING_M * 1.2);
      }
      for (const gap of gaps(trees)) expect(gap, "tree spacing (m)").toBeGreaterThan(TREE_SPACING_M * 0.8);
      for (const tree of trees) for (const lamp of lamps) expect(Math.abs(tree - lamp), "tree to lamp (m)").toBeGreaterThanOrEqual(TREE_LAMP_CLEARANCE_M);
    });

    // mutation: git checkout ow-merge -- src/game/world/openworld/openworld-course.ts (the instanced parked cars come back; the file's other rows go red with it)
    it("when the whole course is placed, then no parked-car instance stands or is drawn inside the walls", () => {
      const placed = placeCourse(track);
      const everything = [...placed.placed, ...placed.drawn];
      const parked = everything.filter((prop) => PARKED_PREFABS.has(prop.prefab) && Math.abs(prop.x) <= geometry.halfX && Math.abs(prop.z) <= geometry.halfZ);
      expect(everything.filter((prop) => prop.prefab === PREFAB.acornLamp).length, "lamps placed (the sweep reads the street)").toBeGreaterThan(40);
      expect(everything.filter((prop) => prop.prefab === PREFAB.lamp).length, "arm lamps (the open world stands acorn lamps)").toBe(0);
      expect(parked.length, "parked cars inside the walls").toBe(0);
    });

    // mutation: sed -i 's/const z = geometry.streetZ\[1\]! + SPAWN_LATERAL_SHIFT;/const z = geometry.streetZ[0]! + SPAWN_LATERAL_SHIFT;/' src/game/world/openworld/openworld-course.ts
    it("when four drivers are seated abreast, then each stands in the first interior east-west street's width and not inside a building", () => {
      must(course.survival, "the course has spawn anchors");
      const spawn = course.survival;
      for (let slot = 0; slot < 4; slot++) {
        const seat = humanSlot(spawn.start, slot);
        expect(Math.abs(seat.z - geometry.streetZ[1]!), `seat ${slot} off the street's middle (m)`).toBeLessThan(geometry.faceToFace / 2);
        expect(
          buildings.some((prop) => insideFootprint(prop, seat.x, seat.z)),
          `seat ${slot} inside a building`,
        ).toBe(false);
      }
      expect(spawn.formation.length, "cop slots").toBeGreaterThanOrEqual(4);
    });

    // mutation: sed -i 's/prefab: dressing.prefab, x: dressing.x, z: dressing.z/prefab: PREFAB.cone, x: dressing.x, z: dressing.z/' src/game/world/openworld/openworld-course.ts
    it("when the layout's dressing and painted ground are read, then the course stands each prop and paints each area", () => {
      const standing = course.props.filter((prop) => prop.prefab === PREFAB.dumpster);
      expect(lots.dressing.length, "props the layout dresses").toBeGreaterThan(0);
      expect(standing.length, "dumpsters in the course").toBe(lots.dressing.filter((dressing) => dressing.prefab === PREFAB.dumpster).length);
      expect(course.environment.paint.length, "areas painted").toBe(lots.areas.length);
    });
  });
}

describe("given the invisible wall's prefab", () => {
  beforeAll(() => stubBrowser());

  // mutation: sed -i '/case PREFAB.invisibleWall:/{n;s/return \[\];/return one(wall(), mats.plain);/}' src/game/present/prefabs.ts
  it("when the invisible wall is drawn, then nothing is, and when a car meets it, then it is solid", () => {
    expect(prefabParts(PREFAB.invisibleWall, makePrefabMaterials(raceTextures())), "drawn parts").toHaveLength(0);
    expect(PREFABS[PREFAB.invisibleWall].body, "what a car meets").toBe("solid");
  });
});
