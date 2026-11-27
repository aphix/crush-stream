import { describe, expect, it } from "vitest";
import type * as THREE from "three";
import { buildCar } from "./drawn-body.test-util.ts";
import { TyreSkin } from "./car-tyre-skin.ts";

describe("given a pickup's body skin, built into a tyre skin", () => {
  // mutation: sed -i 's/^      } else if (yb < ya) {/      } else if (false) {/' src/game/vehicle/car-tyre-skin.ts
  it("when its rest edges are read, then points are welded by exact position, ranked lowest first, and each edge that differs in height is listed once, leading upward", () => {
    const car = buildCar("pickup", "truck");
    const mesh = car["body"] as THREE.Mesh;
    const rest = car.deform.restSkin;
    const skin = new TyreSkin(car.frame, mesh, rest, true);
    const { weld, start, to } = skin["edges"] as { weld: Int32Array; start: Int32Array; to: Int32Array };
    const index = mesh.geometry.index;
    const keyOf = (v: number): string => `${rest[v * 3]},${rest[v * 3 + 1]},${rest[v * 3 + 2]}`;
    const vertices = rest.length / 3;
    const pointOf = new Map<string, number>();
    const heightOfRank: number[] = [];
    for (let v = 0; v < vertices; v++) {
      const known = pointOf.get(keyOf(v));
      if (known === undefined) {
        pointOf.set(keyOf(v), weld[v]!);
        heightOfRank[weld[v]!] = rest[v * 3 + 1]!;
      } else expect(weld[v], `vertex ${v} shares the point of the first vertex at its position`).toBe(known);
    }
    expect(new Set(pointOf.values()).size, "one rank for each distinct position").toBe(pointOf.size);
    expect(start.length - 1, "points").toBe(pointOf.size);
    for (let rank = 1; rank < heightOfRank.length; rank++) expect(heightOfRank[rank]!, `rank ${rank} is no lower than the one before`).toBeGreaterThanOrEqual(heightOfRank[rank - 1]!);
    let upward = 0;
    const corners = index ? index.count : vertices;
    for (let t = 0; t + 2 < corners; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = index ? index.getX(t + k) : t + k;
        const b = index ? index.getX(t + ((k + 1) % 3)) : t + ((k + 1) % 3);
        if (rest[a * 3 + 1] !== rest[b * 3 + 1]) upward++;
      }
    }
    expect(to.length, "edges that differ in height").toBe(upward);
    for (let rank = 0; rank + 1 < start.length; rank++) for (let e = start[rank]!; e < start[rank + 1]!; e++) expect(heightOfRank[to[e]!]!, `an edge from rank ${rank} leads up`).toBeGreaterThan(heightOfRank[rank]!);
  });
});
