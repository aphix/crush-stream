import { expect, it } from "vitest";

const FLOATS = 75_000;
const floats = (/** @type {number} */ seed) => Float32Array.from({ length: FLOATS }, (_, i) => Math.sin(i * seed));

/** Fails on purpose, and only when `diff-cap.test.mjs` runs it in a child process. */
it.skipIf(process.env.DIFF_CAP_FIXTURE !== "1")("when two 75k-float arrays differ everywhere, then the compare fails", () => {
  expect(floats(1.1), "bulk").toEqual(floats(1.2));
});
