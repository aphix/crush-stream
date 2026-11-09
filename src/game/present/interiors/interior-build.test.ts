import { describe, expect, it } from "vitest";
import { MAX_STOREYS, MIN_STOREYS } from "../../world/openworld/interior-kinds.ts";
import { planInterior } from "../../world/openworld/interior-plan.ts";
import { layOutLots } from "../../world/openworld/openworld-lots.ts";
import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";
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
  // mutation: sed -i 's/        \[upright(plan, from, to, alcove.floorY + SKIRTING_HEIGHT, alcove.sill), look.wall\],/        [upright(plan, from, to, alcove.floorY + SKIRTING_HEIGHT, alcove.head), look.wall],/' src/game/present/interiors/interior-build.ts
  it("when its pieces are read, then no wall of it stands higher than the sill, and a sill board lies flat at the sill's height on each of its three sides", () => {
    for (const storeys of STOREY_COUNTS) {
      const place = { ...standing, storeys };
      const plan = planInterior(place);
      const pieces = [...trianglesOf(buildShell(plan, place).solid), ...(buildDetail(plan, place).solid === null ? [] : trianglesOf(buildDetail(plan, place).solid!))];
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
    const geometry = buildShell(plan, standing).solid;
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
});
