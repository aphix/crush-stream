/** Throws `message` unless `value` is truthy; TypeScript then narrows `value` below it, which `expect` does not: `must(found, "a spot was found")`. */
export function must(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
