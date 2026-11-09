/**
 * The failures of a loop of millions of cases: `expect` with an eagerly built message costs more than the case it checks, so the loop
 * notes only a case that fails (its message is built then) and one `expect` after the loop reads the count and the first message.
 */
export class Misses {
  count = 0;
  /** The first failing case's message: later ones are usually the same fault. */
  first = "";

  note(message: string): void {
    if (this.count++ === 0) this.first = message;
  }

  /** The message for `expect(misses.count, misses.report(what)).toBe(0)`. */
  report(what: string): string {
    return this.count === 0 ? what : `${what}: ${this.count} cases failed, the first: ${this.first}`;
  }
}
