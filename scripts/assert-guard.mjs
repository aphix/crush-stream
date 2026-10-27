/**
 * Imported first by every test process. A failing node:assert comparison prints both sides whole and diffs them; the
 * diff's trace lives off the V8 heap, so no heap cap stops it (two differing 4096² textures took the VM down). Sides too
 * big for that fail with a bounded print; everything else, `t.assert` included, is Node's own, message and all.
 */
import assert from "node:assert";
import { syncBuiltinESMExports } from "node:module";
import { inspect, isDeepStrictEqual } from "node:util";

/** Lines Node's diff may print for both sides together; its trace costs up to 8 bytes × lines², so 32 MB at this many. */
const MAX_DIFF_LINES = 2000;
/** String characters counted as one printed line when sizing a value. */
const CHARS_PER_LINE = 64;
/** Characters of each side kept in the bounded print. */
const MAX_PRINT_CHARS = 2000;
const PRINT = { depth: 4, maxArrayLength: 20, maxStringLength: 200, breakLength: 120, sorted: true };

/** @param {unknown} value @param {number} left lines still allowed @returns {number} lines left after printing `value` (negative: too big) */
function linesLeft(value, left) {
  const seen = new Set();
  const stack = [value];
  while (stack.length > 0 && left >= 0) {
    const v = stack.pop();
    left--;
    if (typeof v === "string") left -= Math.floor(v.length / CHARS_PER_LINE);
    if (v === null || typeof v !== "object" || seen.has(v)) continue;
    seen.add(v);
    if (ArrayBuffer.isView(v)) left -= "length" in v ? Number(v.length) : v.byteLength;
    else if (v instanceof ArrayBuffer) left -= v.byteLength;
    else if (v instanceof Map || v instanceof Set) {
      left -= v.size;
      if (left >= 0) for (const entry of v) stack.push(entry);
    } else {
      const keys = Object.keys(v);
      left -= keys.length;
      if (left >= 0) for (const key of keys) stack.push(/** @type {Record<string, unknown>} */ (v)[key]);
    }
  }
  return left;
}

/** @param {unknown} actual @param {unknown} expected */
const tooBigToDiff = (actual, expected) => linesLeft(expected, linesLeft(actual, MAX_DIFF_LINES)) < 0;

/** @param {unknown} value */
function print(value) {
  const text = inspect(value, PRINT);
  return text.length > MAX_PRINT_CHARS ? `${text.slice(0, MAX_PRINT_CHARS)}...` : text;
}

/**
 * @param {Function} startFn the frame the stack starts above
 * @param {string} operator @param {unknown} actual @param {unknown} expected @param {unknown} message
 */
function boundedFailure(startFn, operator, actual, expected, message) {
  const head = message === undefined ? `${operator} failed (sides too big for Node's diff; printed bounded)` : String(message);
  const err = new assert.AssertionError({ message: `${head}\n\nactual: ${print(actual)}\n\nexpected: ${print(expected)}\n`, stackStartFn: startFn });
  Object.assign(err, { actual: print(actual), expected: print(expected), operator, generatedMessage: message === undefined });
  return err;
}

/**
 * Restarts a Node AssertionError's stack above the guard's frame, as if the test had called Node directly.
 * @param {unknown} err @param {Function} startFn
 */
function fromCaller(err, startFn) {
  if (!(err instanceof assert.AssertionError)) return err;
  const name = err.name;
  err.name = "AssertionError [ERR_ASSERTION]";
  Error.captureStackTrace(err, startFn);
  void err.stack;
  err.name = name;
  return err;
}

/** @param {Function} original @param {(actual: unknown, expected: unknown) => boolean} fails */
function guardComparison(original, fails) {
  /** @type {(this: unknown, actual: unknown, expected: unknown, message?: unknown) => void} */
  const guarded = function (actual, expected, message) {
    if (arguments.length < 2 || message instanceof Error) return original.apply(this, arguments);
    if (!fails(actual, expected)) return;
    if (tooBigToDiff(actual, expected)) throw boundedFailure(guarded, original.name, actual, expected, message);
    try {
      original.apply(this, arguments);
    } catch (err) {
      throw fromCaller(err, guarded);
    }
  };
  Object.defineProperty(guarded, "name", { value: original.name });
  return guarded;
}

/** @type {Map<Function, Function>} */
const guards = new Map([
  [assert.strictEqual, guardComparison(assert.strictEqual, (a, b) => !Object.is(a, b))],
  [assert.deepStrictEqual, guardComparison(assert.deepStrictEqual, (a, b) => !isDeepStrictEqual(a, b))],
]);
for (const target of [assert, assert.strict]) {
  for (const [key, value] of Object.entries(target)) {
    const guarded = guards.get(value);
    if (guarded) Object.assign(target, { [key]: guarded });
  }
}
syncBuiltinESMExports();
