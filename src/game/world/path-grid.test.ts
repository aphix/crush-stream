import { describe, expect, it } from "vitest";
import { nearestOnPath, PATH_POINT } from "./path-grid.ts";

type Path = { count: number; closed: boolean; length: number; x: Float64Array; z: Float64Array };
type Hit = { k: number; s: number; lateral: number; dist2: number; cx: number; cz: number };

/** A wavy road of `count` samples 5 m apart along x. */
function road(count: number, bend: number): Path {
  const x = Float64Array.from({ length: count }, (_, k) => k * 5);
  const z = Float64Array.from({ length: count }, (_, k) => bend * Math.sin(k / 6));
  return { count, closed: false, length: (count - 1) * 5, x, z };
}

const blank = (): Hit => ({ k: -1, s: 0, lateral: 0, dist2: Infinity, cx: 0, cz: 0 });

function ask(path: Path, x: number, z: number): Hit {
  PATH_POINT[0] = x;
  PATH_POINT[1] = z;
  const out = blank();
  nearestOnPath(path, out);
  return out;
}

/** The plain scan: the lowest distance of every segment, the lowest segment of equals. */
function scan(path: Path, x: number, z: number): Hit {
  const out = blank();
  for (let k = 0; k + 1 < path.count; k++) {
    const ex = path.x[k + 1]! - path.x[k]!;
    const ez = path.z[k + 1]! - path.z[k]!;
    const len2 = ex * ex + ez * ez;
    const num = (x - path.x[k]!) * ex + (z - path.z[k]!) * ez;
    const f = num <= 0 ? 0 : num >= len2 ? 1 : num / len2;
    const cx = path.x[k]! + ex * f;
    const cz = path.z[k]! + ez * f;
    const d2 = (x - cx) ** 2 + (z - cz) ** 2;
    if (d2 >= out.dist2) continue;
    Object.assign(out, { k, dist2: d2, cx, cz });
  }
  return out;
}

describe("given a road and points asked about more than once", () => {
  it("when 100 points, more than the memo holds, are each asked twice, then every answer is the plain scan's nearest segment and the second equals the first", () => {
    const path = road(200, 20);
    for (let n = 0; n < 100; n++) {
      const x = (n * 37) % 900;
      const z = ((n * 53) % 200) - 100;
      const first = ask(path, x, z);
      const again = ask(path, x, z);
      const plain = scan(path, x, z);
      expect([first.k, first.dist2, first.cx, first.cz], `point ${n}: the plain scan's`).toEqual([plain.k, plain.dist2, plain.cx, plain.cz]);
      expect([again.k, again.s, again.lateral, again.dist2, again.cx, again.cz], `point ${n} asked again`).toEqual([first.k, first.s, first.lateral, first.dist2, first.cx, first.cz]);
    }
  });

  // mutation: sed -i 's/^  for (let m = 0; m < MEMO; m++) {/  for (let m = 0; m < 0; m++) {/' src/game/world/path-grid.ts
  it("when a point is asked again after the road's samples moved, then the answer is the one kept for that point, and a new point is found on the moved road (paths are built once: this is how a kept answer shows)", () => {
    const path = road(120, 10);
    const kept = ask(path, 77.5, 60);
    path.z.fill(0);
    const again = ask(path, 77.5, 60);
    expect(again.dist2, "the kept answer").toBe(kept.dist2);
    const fresh = ask(path, 77.5, 61);
    expect(fresh.dist2, "a point not asked before is found on the road as it now stands").toBeCloseTo(61 ** 2, 6);
  });

  // mutation: sed -i 's/ || memoPath\[m\] !== path) continue;/) continue;/' src/game/world/path-grid.ts
  it("when two roads are asked about the same point, then each answers from its own samples", () => {
    const flat = road(120, 0);
    const bent = road(120, 40);
    const a = ask(flat, 150.2, 55);
    const b = ask(bent, 150.2, 55);
    expect(a.dist2, "the flat road is 55 m off").toBeCloseTo(55 ** 2, 6);
    expect(b.dist2, "the bent road is not").not.toBeCloseTo(a.dist2, 3);
    expect(ask(flat, 150.2, 55).dist2, "the flat road asked again").toBe(a.dist2);
  });

  it("when the hit given in carries a finite distance, then the scan runs from it as it always did and keeps nothing (guard)", () => {
    const path = road(100, 15);
    PATH_POINT[0] = 200;
    PATH_POINT[1] = 90;
    const out: Hit = { ...blank(), dist2: 1e-6, k: 7 };
    nearestOnPath(path, out);
    expect([out.k, out.dist2], "nothing nearer than the seed").toEqual([7, 1e-6]);
    expect(ask(path, 200, 90).dist2, "the same point asked with no seed").toBeCloseTo(scan(path, 200, 90).dist2, 9);
  });
});
