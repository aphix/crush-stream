import { expect } from "vitest";
import type { FxTier } from "./engine-post.ts";

/** The governor's switches, each [second it happened, tier], against the expected list: count first, then every switch field by field. */
export function expectMoves(moves: readonly (readonly [number, FxTier])[], expected: readonly (readonly [number, FxTier])[], what: string): void {
  expect(moves, `${what}: number of switches`).toHaveLength(expected.length);
  for (const [i, [at, tier]] of expected.entries()) {
    expect(moves[i]?.[0], `${what}: switch ${i} second`).toBe(at);
    expect(moves[i]?.[1], `${what}: switch ${i} tier`).toBe(tier);
  }
}
