/** Plain data: an object made by a literal (or by `Object.create(null)`), not a class instance, a typed array, a Map or a function. */
function isPlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * `next` with every part that holds what `previous`'s holds kept as `previous`'s own: a change anywhere reaches the root only along its own path, the rest of the tree is the same objects as before, and a `next` with no
 * change at all comes back as `previous` itself. Plain objects and arrays are walked; anything else (a class instance, a typed array) is the same only when it is the very same thing. `next` is rewritten in place:
 * it is the caller's fresh snapshot, not state kept between calls (an object the caller goes on mutating in place must not be in it: it would read as unchanged).
 */
export function reconcile<T>(previous: T, next: T): T {
  return keepSame(previous, next) as T;
}

function keepSame(previous: unknown, next: unknown): unknown {
  if (Object.is(previous, next)) return previous;
  if (Array.isArray(previous) && Array.isArray(next)) {
    let same = previous.length === next.length;
    for (let at = 0; at < next.length; at++) {
      const kept = at < previous.length ? keepSame(previous[at], next[at]) : next[at];
      next[at] = kept;
      if (!Object.is(kept, previous[at])) same = false;
    }
    return same ? previous : next;
  }
  if (isPlain(previous) && isPlain(next)) {
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(previous).length;
    for (const key of keys) {
      const kept = key in previous ? keepSame(previous[key], next[key]) : next[key];
      next[key] = kept;
      if (!(key in previous) || !Object.is(kept, previous[key])) same = false;
    }
    return same ? previous : next;
  }
  return next;
}
