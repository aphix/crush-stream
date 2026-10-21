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
const PROBE = "assert-guard probe";

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

/**
 * Whether Node's own `fn` fails on these values, asked with a message so Node builds no diff (true of every comparison
 * outside strictEqual / deepStrictEqual / partialDeepStrictEqual, whose diff runs even under a message).
 * @param {Function} fn @param {unknown} actual @param {unknown} expected
 */
function failsQuietly(fn, actual, expected) {
  try {
    fn(actual, expected, PROBE);
    return false;
  } catch (err) {
    if (err instanceof assert.AssertionError && err.message === PROBE) return true;
    throw err;
  }
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

/** @param {unknown} expected */
const isValidationObject = (expected) => typeof expected === "object" && expected !== null && !(expected instanceof RegExp);

/**
 * throws / rejects with a validation object: Node diffs each failing key of the thrown value against it. The object
 * becomes a validator that hands small values back to Node and fails big ones bounded, by Node's key rules.
 * @param {Function} original throws or rejects, whose frame the stack starts above
 * @param {object} expected @param {unknown[]} rest
 */
function validatorFor(original, expected, rest) {
  const validation = /** @type {Record<string, unknown>} */ (expected);
  const keys = Object.keys(validation);
  if (validation instanceof Error) keys.push("name", "message");
  /** @param {unknown} actual */
  const validate = (actual) => {
    if (keys.length > 0 && tooBigToDiff(actual, expected)) {
      if (typeof actual !== "object" || actual === null) throw boundedFailure(original, original.name, actual, expected, rest[0]);
      const thrown = /** @type {Record<string, unknown>} */ (actual);
      for (const key of keys) {
        const want = validation[key];
        if (typeof thrown[key] === "string" && want instanceof RegExp && want.test(/** @type {string} */ (thrown[key]))) continue;
        if (!(key in thrown) || !isDeepStrictEqual(thrown[key], want)) throw boundedFailure(original, original.name, thrown[key], want, rest[0] ?? `the thrown value's "${key}" differs`);
      }
      return true;
    }
    try {
      throwsOriginal(() => { throw actual; }, expected, ...rest);
    } catch (err) {
      if (err instanceof assert.AssertionError && err.operator === "throws") err.operator = original.name;
      throw fromCaller(err, original);
    }
    return true;
  };
  // Node names the expected error by `.name` in "Missing expected exception (<name>)".
  Object.defineProperty(validate, "name", { value: validation.name || "" });
  return validate;
}

/**
 * Puts the caller's validation object back where Node reports the validator ("Missing expected exception"), and drops the
 * guard's own frames, so the stack reads as Node's: it starts at the test's line.
 * @param {unknown} err @param {Function} validate @param {unknown} expected
 */
function asNodes(err, validate, expected) {
  if (!(err instanceof assert.AssertionError)) return err;
  if (err.expected === validate) err.expected = expected;
  err.stack = err.stack?.split("\n").filter((line) => !line.includes(import.meta.url)).join("\n");
  return err;
}

const throwsOriginal = assert.throws;
/** @type {(this: unknown, fn: unknown, expected?: unknown, ...rest: unknown[]) => void} */
const throwsGuarded = function throws(fn, expected, ...rest) {
  if (!isValidationObject(expected)) return throwsOriginal.apply(this, arguments);
  const validate = validatorFor(throwsOriginal, /** @type {object} */ (expected), rest);
  try {
    throwsOriginal.call(this, fn, validate, ...rest);
  } catch (err) {
    throw fromCaller(asNodes(err, validate, expected), throwsGuarded);
  }
};
const rejectsOriginal = assert.rejects;
/** @type {(this: unknown, fn: unknown, expected?: unknown, ...rest: unknown[]) => Promise<void>} */
const rejectsGuarded = async function rejects(fn, expected, ...rest) {
  if (!isValidationObject(expected)) return rejectsOriginal.apply(this, arguments);
  const validate = validatorFor(rejectsOriginal, /** @type {object} */ (expected), rest);
  try {
    await rejectsOriginal.call(this, fn, validate, ...rest);
  } catch (err) {
    throw asNodes(err, validate, expected);
  }
};
/** @type {Map<Function, Function>} */
const guards = new Map([
  [assert.strictEqual, guardComparison(assert.strictEqual, (a, b) => !Object.is(a, b))],
  [assert.deepStrictEqual, guardComparison(assert.deepStrictEqual, (a, b) => !isDeepStrictEqual(a, b))],
  ...[assert.equal, assert.notEqual, assert.deepEqual, assert.notDeepEqual, assert.notStrictEqual, assert.notDeepStrictEqual].map(
    (fn) => /** @type {[Function, Function]} */ ([fn, guardComparison(fn, (a, b) => failsQuietly(fn, a, b))]),
  ),
  [throwsOriginal, throwsGuarded],
  [rejectsOriginal, rejectsGuarded],
]);
for (const target of [assert, assert.strict]) {
  for (const [key, value] of Object.entries(target)) {
    const guarded = guards.get(value);
    if (guarded) Object.assign(target, { [key]: guarded });
  }
}
syncBuiltinESMExports();
