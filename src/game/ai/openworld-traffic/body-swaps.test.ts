import { describe, expect, it } from "vitest";
import { BodySwaps } from "./body-swaps.ts";
import { BODY_SWAP_SECONDS } from "./traffic-constants.ts";

describe("given the swaps traffic asks of the engine", () => {
  // mutation: sed -i 's/    return seconds - this.lastAt >= BODY_SWAP_SECONDS;/    return true;/' src/game/ai/openworld-traffic/body-swaps.ts
  it("when one was done, then no other is allowed until `BODY_SWAP_SECONDS` have passed, and the first is allowed at once", () => {
    const swaps = new BodySwaps();
    expect(swaps.allows(0), "the first").toBe(true);
    swaps.note(100);
    expect(swaps.allows(100 + BODY_SWAP_SECONDS - 1), "too soon").toBe(false);
    expect(swaps.allows(100 + BODY_SWAP_SECONDS), "after the wait").toBe(true);
  });
});
