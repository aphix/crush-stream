import { describe, expect, it } from "vitest";
import { driverCarApplies } from "./driver-pick.ts";

const bootPickCases = [
  { it: "when no car is named by the link, then the stored pick applies at boot", linkNamesCar: false, expected: true },
  { it: "when the link names a car, then the link's car wins over the stored pick at boot", linkNamesCar: true, expected: false },
] as const;

describe("given a stored car pick and a share link that may name a car", () => {
  for (const testCase of bootPickCases) {
    it(testCase.it, () => {
      expect(driverCarApplies(null, "monster", testCase.linkNamesCar)).toBe(testCase.expected);
    });
  }

  it("when the player switches from the monster truck to the truck after boot, then the new pick applies whether or not the link named a car", () => {
    expect(driverCarApplies("monster", "truck", true)).toBe(true);
    expect(driverCarApplies("monster", "truck", false)).toBe(true);
  });

  it("when the pick is unchanged (only the driver's name was edited), then it never re-applies, so it cannot undo a car chosen in the HUD since", () => {
    expect(driverCarApplies("monster", "monster", false)).toBe(false);
    expect(driverCarApplies("monster", "monster", true)).toBe(false);
  });
});
