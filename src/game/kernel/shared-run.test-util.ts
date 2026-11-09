// Mutation: `sed 's|const key = args.join("/");|const key = "";|'` turns engine-record-scale's strictly rising sweep red (every speed reads the first run).
/** `run`'s result for these arguments, made once per file: for plain-number results that rows only read. */
export function memoRun<A extends readonly (string | number | boolean | undefined)[], R>(run: (...args: A) => R): (...args: A) => R {
  const kept = new Map<string, { out: R }>();
  return (...args) => {
    const key = args.join("/");
    const held = kept.get(key) ?? { out: run(...args) };
    kept.set(key, held);
    return held.out;
  };
}

/** A run that two rows read in turn: the first `keep`s it and the second `take`s it (running it itself when none is kept, as when it runs alone), so the cars it holds are not kept past the second row. */
export class Handoff<R> {
  private readonly held = new Map<string, { run: R }>();

  keep(key: string, run: R): R {
    this.held.set(key, { run });
    return run;
  }

  take(key: string, make: () => R): R {
    const held = this.held.get(key);
    this.held.delete(key);
    return held ? held.run : make();
  }
}
