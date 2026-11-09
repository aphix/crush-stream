import { describe, expect, it } from "vitest";
import { detCos, detSin } from "../../kernel/physics-core.js";
import { assertSameDigest } from "../../vehicle/test-support.ts";
import { PARKED_PREFABS } from "../catalog.ts";
import { PREFAB, SURFACE } from "../constants.ts";
import { propColliders } from "../placements.ts";
import { parseTrack } from "../track-schema.ts";
import { Track } from "../track.ts";
import { PARK, PARK_BLOCK } from "./openworld-constants.ts";
import { openWorldCourse } from "./openworld-course.ts";
import { fixtureLots } from "./openworld-lots.test-util.ts";
import { parkPaint, parkProps } from "./openworld-park.ts";
import { PLAZA_RADIUS } from "./openworld-plaza.ts";
import { LAYOUT } from "./openworld-constants.ts";

const lots = fixtureLots(LAYOUT.wallReach);
const geometry = lots.geometry;
const block = lots.blocks.find((candidate) => candidate.column === PARK_BLOCK.column && candidate.row === PARK_BLOCK.row)!;
const props = parkProps(lots);
const input = openWorldCourse(lots);
const track = new Track(input);

/** A path's half width (m), and a bench's distance from its path's middle: its depth 0.1 m off the edge. */
const PATH_HALF = PARK.pathWidth / 2;
const BENCH_OFF = PATH_HALF + 0.4;
/** A car is 2 m wide: the plaza's openings must pass one. */
const CAR_WIDTH = 2;
/** The probe's step (m) along and across a path. */
const PROBE_STEP = 0.25;
/** The cross paths' x, and the east-west path's z. */
const crossXs = PARK.crossPaths.map((offset) => block.centreX + offset);

/** The path (by its fixed coordinate and direction) nearest (x, z) among those a bench may stand by: the east-west one and the three north-south. */
function nearestPath(x: number, z: number): { alongX: boolean; fixed: number; across: number } {
  const candidates = [{ alongX: true, fixed: block.centreZ, across: z - block.centreZ }, ...crossXs.map((fixed) => ({ alongX: false, fixed, across: x - fixed }))];
  return candidates.reduce((best, candidate) => (Math.abs(candidate.across) < Math.abs(best.across) ? candidate : best));
}

describe("given the park's dressing", () => {
  const benches = props.filter((prop) => prop.prefab === PREFAB.bench);

  // mutation: sed -i 's/  return side > 0 ? FACING.north : FACING.south;/  return side > 0 ? FACING.south : FACING.north;/' src/game/world/openworld/openworld-park.ts
  it("when the benches are read, then each stands beside a path, its front turned to the path's middle", () => {
    expect(benches.length, "benches").toBeGreaterThan(8);
    for (const bench of benches) {
      const path = nearestPath(bench.x, bench.z);
      expect(Math.abs(path.across), `the bench at ${bench.x.toFixed(1)}, ${bench.z.toFixed(1)} from its path's middle (m)`).toBeCloseTo(BENCH_OFF, 6);
      // The bench's front is its local +x, (cos yaw, -sin yaw); the path lies along -across.
      const toPath = path.alongX ? -Math.sign(path.across) * -detSin(bench.yaw) : -Math.sign(path.across) * detCos(bench.yaw);
      expect(toPath, `the bench at ${bench.x.toFixed(1)}, ${bench.z.toFixed(1)} faces its path`).toBeCloseTo(1, 6);
    }
  });

  // mutation: sed -i 's/const EDGE_CLEAR = 2.5;/const EDGE_CLEAR = 0;/' src/game/world/openworld/openworld-park.ts
  it("when every prop is read, then none stands on a path, in the plaza's ring, on the court or on the park's edge strip, and all stand in the park's block", () => {
    const court = { x0: block.centreX + PARK.courtOffsetX - PARK.courtLength / 2, x1: block.centreX + PARK.courtOffsetX + PARK.courtLength / 2, z0: block.centreZ + PARK.courtOffsetZ - PARK.courtWidth / 2, z1: block.centreZ + PARK.courtOffsetZ + PARK.courtWidth / 2 };
    const wrong: string[] = [];
    for (const prop of props) {
      if (prop.prefab === PREFAB.plaza) continue;
      const where = `${prop.prefab} at ${prop.x.toFixed(1)}, ${prop.z.toFixed(1)}`;
      if (Math.abs(prop.x - block.centreX) > geometry.blockLength / 2 || Math.abs(prop.z - block.centreZ) > geometry.blockDepth / 2) wrong.push(`${where} outside the block`);
      if (Math.hypot(prop.x - block.centreX, prop.z - block.centreZ) < PLAZA_RADIUS) wrong.push(`${where} inside the plaza`);
      if (prop.x > court.x0 && prop.x < court.x1 && prop.z > court.z0 && prop.z < court.z1) wrong.push(`${where} on the court`);
      if (prop.prefab === PREFAB.bench || prop.prefab === PREFAB.litterBin || prop.prefab === PREFAB.acornLamp || prop.prefab === PREFAB.hoopFence) {
        const onPath = Math.abs(prop.z - block.centreZ) < PATH_HALF || crossXs.some((x) => Math.abs(prop.x - x) < PATH_HALF);
        if (onPath) wrong.push(`${where} on a path`);
      }
    }
    expect(wrong.slice(0, 3).join("; "), "props out of place").toBe("");
  });

  // mutation: sed -i 's/  const props: ParkProp\[\] = \[{ prefab: PREFAB.plaza, x: park.block.centreX, z: park.block.centreZ, yaw: 0 }\];/  const props: ParkProp[] = [];/' src/game/world/openworld/openworld-park.ts
  it("when the props are read, then the plaza stands at the block's middle with a pavilion, lamps, bins and fences about the paths", () => {
    const plaza = props.filter((prop) => prop.prefab === PREFAB.plaza);
    expect(plaza.length, "plazas").toBe(1);
    expect([plaza[0]!.x, plaza[0]!.z].join(), "the plaza's place").toBe([block.centreX, block.centreZ].join());
    for (const prefab of [PREFAB.pavilion, PREFAB.acornLamp, PREFAB.litterBin, PREFAB.hoopFence]) expect(props.filter((prop) => prop.prefab === prefab).length, prefab).toBeGreaterThan(0);
  });

  // mutation: sed -i 's/  opening: PARK.pathWidth + 0.8,/  opening: 0,/' src/game/world/openworld/openworld-plaza.ts
  it("when the plaza's stone is read along the east-west and the north-south path through it, then a car's width stays clear of every piece", () => {
    const pieces = propColliders([{ prefab: PREFAB.plaza, x: block.centreX, y: 0, z: block.centreZ, yaw: 0, sx: 1, sy: 1, sz: 1 }]);
    expect(pieces.length, "plaza pieces").toBeGreaterThan(50);
    const inside = (piece: (typeof pieces)[number], x: number, z: number): boolean => {
      const dx = x - piece.x;
      const dz = z - piece.z;
      return Math.abs(dx * detCos(piece.yaw) - dz * detSin(piece.yaw)) <= piece.hx && Math.abs(dx * detSin(piece.yaw) + dz * detCos(piece.yaw)) <= piece.hz;
    };
    const hits: string[] = [];
    for (let along = -PLAZA_RADIUS - 1; along <= PLAZA_RADIUS + 1; along += PROBE_STEP) {
      for (let across = -CAR_WIDTH / 2; across <= CAR_WIDTH / 2; across += PROBE_STEP) {
        for (const [index, piece] of pieces.entries()) {
          if (inside(piece, block.centreX + along, block.centreZ + across)) hits.push(`east-west path at ${along.toFixed(2)}, ${across.toFixed(2)} in piece ${index}`);
          if (inside(piece, block.centreX + across, block.centreZ + along)) hits.push(`north-south path at ${across.toFixed(2)}, ${along.toFixed(2)} in piece ${index}`);
        }
      }
    }
    expect(hits.slice(0, 3).join("; "), "stone on a path through the plaza").toBe("");
  });

  // mutation: sed -i 's/  return \[{ surface: PAVERS, poly: plaza }, ...park.paths.map/  return [...park.paths.map/' src/game/world/openworld/openworld-park.ts
  it("when the course's ground is read, then the plaza and every path are paved and the lawn beside them is grass", () => {
    const ground = track.ground();
    expect(ground.surfaceAt(block.centreX, block.centreZ), "the plaza's middle").toBe(SURFACE.cobble);
    expect(ground.surfaceAt(block.centreX + PLAZA_RADIUS - 0.2, block.centreZ + PLAZA_RADIUS - 0.2 - 1.5), "inside the plaza's edge").toBe(SURFACE.cobble);
    expect(ground.surfaceAt(block.centreX + 12, block.centreZ), "the east-west path").toBe(SURFACE.cobble);
    for (const x of crossXs) expect(ground.surfaceAt(x, block.centreZ - 14), `the north-south path at x ${x.toFixed(1)}`).toBe(SURFACE.cobble);
    expect(ground.surfaceAt(block.centreX + 12, block.centreZ - 10), "the lawn").toBe(SURFACE.grass);
    expect(parkPaint(lots).length, "painted pieces: plaza, five paths").toBe(PARK.crossPaths.length + 3);
  });

  // mutation: sed -i 's/const FABRIC_SEED = 0x0fab51;/const FABRIC_SEED = 0x0fab51;\nvoid Math.random();/' src/game/world/openworld/openworld-fabric-constants.ts
  it("when the park is dressed twice, then both are the same park, and none of its props is a parked car", () => {
    assertSameDigest(parkProps(lots), parkProps(lots), "park props");
    expect(props.filter((prop) => PARKED_PREFABS.has(prop.prefab)).length, "parked cars").toBe(0);
  });
});

describe("given the course's props", () => {
  it("when it is parsed, then it carries the park's props and its pavers", () => {
    const course = parseTrack(input);
    expect(course.props.filter((prop) => prop.prefab === PREFAB.plaza).length, "plazas").toBe(1);
    expect(course.environment.paint.filter((paint) => paint.surface === SURFACE.cobble).length, "paver pieces").toBe(PARK.crossPaths.length + 3);
  });
});
