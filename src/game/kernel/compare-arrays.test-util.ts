/** Where two arrays first differ: `index` -1 means the lengths differ (`actual` and `expected` are then the lengths). */
export interface Mismatch {
  index: number;
  actual: unknown;
  expected: unknown;
}

/**
 * The first element of `actual` that differs from `expected` (numbers within `tolerance`, anything else by `Object.is`), or
 * undefined when the arrays agree. Length is checked before anything is walked, and a failure carries three values, never the
 * arrays: `expect(firstMismatch(a, b), "first mismatch").toBeUndefined()`. A missing `actual` is a mismatch, not a throw.
 */
export function firstMismatch(actual: ArrayLike<unknown> | null | undefined, expected: ArrayLike<unknown>, tolerance = 0): Mismatch | undefined {
  if (!actual) return { index: -1, actual, expected: expected.length };
  if (actual.length !== expected.length) return { index: -1, actual: actual.length, expected: expected.length };
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i];
    const e = expected[i];
    if (Object.is(a, e)) continue;
    if (typeof a === "number" && typeof e === "number" && Math.abs(a - e) <= tolerance) continue;
    return { index: i, actual: a, expected: e };
  }
  return undefined;
}
