import { describe, expect, it } from "vitest";
import { formatSpeed, speedUnitFor } from "./speed-units.ts";

const testCases = [
  { it: "when the locale is en-US, then the readout is in mph", tag: "en-US", unit: "mph" },
  { it: "when the locale is en-GB, then the readout is in km/h", tag: "en-GB", unit: "km/h" },
  { it: "when the locale is de-DE, then the readout is in km/h", tag: "de-DE", unit: "km/h" },
  { it: "when the locale is fr-CA, then the readout is in km/h", tag: "fr-CA", unit: "km/h" },
] as const;

describe("given the speed readout's unit, chosen from the browser's language tags", () => {
  for (const testCase of testCases) {
    it(testCase.it, () => {
      expect(speedUnitFor([testCase.tag])).toBe(testCase.unit);
    });
  }

  it("when several tags are given, then the first tag that names a region decides, and a bare language says nothing", () => {
    expect(speedUnitFor(["en", "en-US"])).toBe("mph");
    expect(speedUnitFor(["fr-CA", "en-US"])).toBe("km/h");
    expect(speedUnitFor(["en"])).toBe("km/h");
  });

  it("when a 200 km/h top speed (55.56 m/s) is formatted, then it reads 200 in km/h and 124 in mph", () => {
    expect(formatSpeed(200 / 3.6, "km/h")).toBe("200");
    expect(formatSpeed(200 / 3.6, "mph")).toBe("124");
  });
});
