import { describe, expect, it } from "vitest";
import { MAX_STOREYS, MIN_STOREYS } from "../../world/openworld/interior-kinds.ts";
import { planInterior } from "../../world/openworld/interior-plan.ts";
import { BAY } from "../../world/openworld/openworld-facade-solids.ts";
import { layOutLots } from "../../world/openworld/openworld-lots.ts";
import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";
import { painted } from "../prefab-pieces.ts";
import { buildDetail, buildShell } from "./interior-build.ts";

const EPSILON = 1e-6;
/** A triangle's normal reads as vertical (a wall) when its y is under this, and as a floor or a sill's top when it is over the other. */
const WALL_NORMAL_Y = 0.1;
const FLAT_NORMAL_Y = 0.9;
/** How far into the room (m) the sill board must reach for the apron to read as a wall with a sill. */
const SILL_REACH_MIN = 0.05;
/** The storey counts houses are built with. */
const STOREY_COUNTS = Array.from({ length: MAX_STOREYS - MIN_STOREYS + 1 }, (_, at) => MIN_STOREYS + at);

const lots = layOutLots();
const home = lots.places.slice(0, lots.backdropStart).find((place) => place.kind === PLACE_KIND.home && place.interior === "rowhome")!;
/** The home at the origin, facing +x: the building's frame and the world's are one. */
const standing = { ...home, x: 0, z: 0, yaw: 0 };

type Triangle = { y: [number, number, number]; x: number; z: number; normalY: number };

/** The triangles of a non-indexed geometry: their heights, middle in plan and the y of their normal. */
function trianglesOf(geometry: { getAttribute(name: string): { getX(at: number): number; getY(at: number): number; getZ(at: number): number; count: number } }): Triangle[] {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const out: Triangle[] = [];
  for (let at = 0; at + 2 < position.count; at += 3) {
    out.push({
      y: [position.getY(at), position.getY(at + 1), position.getY(at + 2)],
      x: (position.getX(at) + position.getX(at + 1) + position.getX(at + 2)) / 3,
      z: (position.getZ(at) + position.getZ(at + 1) + position.getZ(at + 2)) / 3,
      normalY: normal.getY(at),
    });
  }
  return out;
}

describe("given the bay alcove of a rowhome's rooms", () => {
  // mutation: sed -i 's/        \[upright(plan, from, to, alcove.floorY + SKIRTING_HEIGHT, alcove.sill), look.wood\],/        [upright(plan, from, to, alcove.floorY + SKIRTING_HEIGHT, alcove.head), look.wood],/' src/game/present/interiors/interior-build.ts
  it("when its pieces are read, then no wall of it stands higher than the sill, and a sill board lies flat at the sill's height on each of its three sides", () => {
    for (const storeys of STOREY_COUNTS) {
      const place = { ...standing, storeys };
      const plan = planInterior(place);
      const pieces = [...trianglesOf(painted(buildShell(plan).solid)), ...trianglesOf(painted(buildDetail(plan).solid))];
      for (const alcove of plan.alcoves) {
        const outside = pieces.filter((triangle) => triangle.x > plan.depth / 2 && triangle.y.every((y) => y >= alcove.floorY - EPSILON && y <= alcove.head + EPSILON));
        const walls = outside.filter((triangle) => Math.abs(triangle.normalY) < WALL_NORMAL_Y);
        expect(walls.length, `${storeys} storeys, level ${alcove.level}: wall triangles of the alcove`).toBeGreaterThan(0);
        expect(Math.max(...walls.flatMap((triangle) => triangle.y)), `${storeys} storeys, level ${alcove.level}: highest wall of the alcove (m)`).toBeLessThanOrEqual(alcove.sill + EPSILON);
        const boards = outside.filter((triangle) => Math.abs(triangle.normalY) > FLAT_NORMAL_Y && triangle.y.every((y) => Math.abs(y - alcove.sill) < EPSILON));
        expect(boards.length, `${storeys} storeys, level ${alcove.level}: triangles of the sill boards`).toBe(2 * (alcove.corners.length - 1));
      }
    }
  });

  // mutation: sed -i 's/const SILL_DEPTH = 0.12;/const SILL_DEPTH = 0.01;/' src/game/present/interiors/interior-build.ts
  it("when the sill board is measured against the glass's front pane, then it stands on the line of the pane and reaches back into the room from it", () => {
    const plan = planInterior(standing);
    const alcove = plan.alcoves.find((candidate) => candidate.level === 0)!;
    const frontCorners = [alcove.corners[1]!, alcove.corners[2]!];
    const frontX = plan.depth / 2 - frontCorners[0]![0];
    const [acrossLow, acrossHigh] = [Math.min(frontCorners[0]![1], frontCorners[1]![1]), Math.max(frontCorners[0]![1], frontCorners[1]![1])];
    const geometry = painted(buildShell(plan).solid);
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const onFront: number[] = [];
    for (let at = 0; at < position.count; at++) {
      const flat = Math.abs(normal.getY(at)) > FLAT_NORMAL_Y && Math.abs(position.getY(at) - alcove.sill) < EPSILON;
      if (flat && position.getX(at) > plan.depth / 2 && position.getZ(at) >= acrossLow - EPSILON && position.getZ(at) <= acrossHigh + EPSILON) onFront.push(position.getX(at));
    }
    expect(onFront.length, "vertices of the sill board along the front pane").toBeGreaterThan(0);
    expect(Math.max(...onFront), "the board's outer edge: the line of the front pane").toBeCloseTo(frontX, 6);
    expect(Math.min(...onFront), "the board's inner edge, back into the room (m)").toBeLessThanOrEqual(frontX - SILL_REACH_MIN);
  });

  // mutation: sed -i 's/(corner\[0\] === 0 ? \[STREET_SKIN + PLATE_LIFT, corner\[1\]\] : corner)/(corner)/' src/game/present/interiors/interior-build.ts
  it("when its floor and ceiling plates are read, then each reaches past the wall plane into the room on every storey: no slot at the bay's mouth", () => {
    for (const storeys of STOREY_COUNTS) {
      const plan = planInterior({ ...standing, storeys });
      let read = 0;
      for (const solid of [buildShell(plan).solid, buildDetail(plan).solid]) {
        const g = painted(solid);
        const p = g.getAttribute("position");
        const n = g.getAttribute("normal");
        for (const alcove of plan.alcoves) {
          for (const y of [alcove.floorY + 0.004, alcove.head - 0.004]) {
            const xs: number[] = [];
            for (let at = 0; at < p.count; at++) {
              if (Math.abs(n.getY(at)) > FLAT_NORMAL_Y && Math.abs(p.getY(at) - y) < EPSILON && Math.abs(p.getZ(at) - alcove.corners[0]![1]) < EPSILON) xs.push(p.getX(at));
            }
            if (xs.length === 0) continue;
            read++;
            expect(Math.min(...xs), `${storeys} storeys, level ${alcove.level}: the plate at y ${y} reaches into the room`).toBeLessThanOrEqual(plan.depth / 2 - 0.02 + EPSILON);
          }
        }
      }
      expect(read, `${storeys} storeys: plates read`).toBeGreaterThan(0);
    }
  });
});

describe("given the bay alcove of a rowhome's ground floor", () => {
  // mutation: sed -i 's/ ...jambPieces(plan, lookOf(plan, 0), 0)\]/]/; s/, ...jambPieces(plan, lookOf(plan, 0), 0)\]/]/' src/game/present/interiors/interior-build.ts (the wedge between the glass and the wall's opening is open)
  it("when its pieces are read, then a return of the wall closes the strip between the glass's end and the opening's edge, floor to head, on each side", () => {
    const plan = planInterior({ ...standing, storeys: 2 });
    const alcove = plan.alcoves.find((candidate) => candidate.level === 0)!;
    const wallPlaneX = plan.depth / 2;
    const built = buildShell(plan);
    const returns = [...built.solid, ...built.glass]
      .map((piece) => piece[0])
      .filter((geometry) => geometry.getAttribute("position").count === 4)
      .map((geometry) => {
        const position = geometry.getAttribute("position");
        const ys = [0, 1, 2, 3].map((at) => position.getY(at));
        const zs = [0, 1, 2, 3].map((at) => position.getZ(at));
        const flat = [0, 1, 2, 3].every((at) => Math.abs(position.getX(at) - wallPlaneX) < EPSILON);
        return { flat, y0: Math.min(...ys), y1: Math.max(...ys), z0: Math.min(...zs), z1: Math.max(...zs) };
      })
      .filter((quad) => quad.flat && Math.abs(quad.y0 - alcove.floorY) < EPSILON && Math.abs(quad.y1 - alcove.head) < EPSILON);
    expect(returns.length, "returns of the wall in the plane the glass meets").toBe(2);
    const mouthEdges = [BAY.across - BAY.width / 2, BAY.across + BAY.width / 2];
    const glassEnds = [alcove.corners[0]![1], alcove.corners[alcove.corners.length - 1]![1]];
    for (const quad of returns) {
      expect(mouthEdges.some((edge) => Math.abs(edge - quad.z0) < EPSILON || Math.abs(edge - quad.z1) < EPSILON), "one end on the opening's edge").toBe(true);
      expect(glassEnds.some((end) => Math.abs(end - quad.z0) < EPSILON || Math.abs(end - quad.z1) < EPSILON), "the other on the glass's end").toBe(true);
    }
  });
});
