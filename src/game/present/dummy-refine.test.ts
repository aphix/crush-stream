import { describe, expect, it } from "vitest";
import { BODY_VERTICES, bodyIndex, bodyPositions } from "./dummy-bodies.ts";

/** The baked mesh's vertices: every one after these was added by the refinement over her bust. */
const BAKED_VERTICES = 4547;
/** A midpoint matches its edge's ends' mean within the Int16 bake's quantum (m). */
const QUANTUM = 1e-4;

describe("given the shared body mesh refined over her bust", () => {
  it("when each added vertex is checked on every shape, then it is the midpoint of an edge it sits on, so no shape's surface moved", () => {
    const index = bodyIndex();
    const neighbours = Array.from({ length: BODY_VERTICES }, (): number[] => []);
    for (let t = 0; t < index.length; t += 3) for (let e = 0; e < 3; e++) neighbours[index[t + e]!]!.push(index[t + ((e + 1) % 3)]!, index[t + ((e + 2) % 3)]!);
    const shapes = [bodyPositions("slenderMan"), bodyPositions("slenderWoman"), bodyPositions("obeseMan")];
    expect(BODY_VERTICES, "the bust region was refined").toBeGreaterThan(BAKED_VERTICES);
    for (let v = BAKED_VERTICES; v < BODY_VERTICES; v++) {
      const ends = neighbours[v]!.filter((n) => n < BAKED_VERTICES);
      const between = ends.some((a) => ends.some((b) => b !== a && shapes.every((p) => [0, 1, 2].every((k) => Math.abs(p[v * 3 + k]! - (p[a * 3 + k]! + p[b * 3 + k]!) / 2) < QUANTUM))));
      expect(between, `vertex ${v} is not the midpoint of an edge between baked vertices`).toBeTruthy();
    }
  });
});
