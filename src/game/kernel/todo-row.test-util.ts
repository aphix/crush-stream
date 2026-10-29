import { it, type TestContext } from "vitest";

/** `RUN_TODOS=1` (`npm run test:todos`) runs the todo rows' bodies; otherwise they are only listed. */
const RUN_TODOS = process.env.RUN_TODOS === "1";

type Row = (t: TestContext) => unknown;

/**
 * A row that states an open problem (`reason`, or `true` for none) instead of passing. Registered as a todo that carries its reason
 * and costs nothing; under `RUN_TODOS=1` its body runs and the row reports green, or skipped with whatever the body threw (a failed
 * assertion, a `must` guard, a TypeError), never failing the run. A falsy `reason` makes it an ordinary row.
 */
export function todoRow(name: string, reason: string | boolean | undefined, fn: Row): void {
  if (!reason) {
    it(name, fn);
    return;
  }
  const note = reason === true ? "todo" : `todo: ${reason}`;
  if (!RUN_TODOS) {
    it.todo(`${name} [${note}]`);
    return;
  }
  it(name, async (t) => {
    try {
      await fn(t);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      t.skip(`${note} (red: ${msg.split("\n")[0]})`);
    }
  });
}
