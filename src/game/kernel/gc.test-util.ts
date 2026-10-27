import { constants, PerformanceObserver } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

/** A full collection on demand (`gc`, exposed for this call only), so garbage left by earlier rows is gone before a counted window. */
export function forceCollect(): void {
  setFlagsFromString("--expose-gc");
  (runInNewContext("gc") as () => void)();
}

/** Wall time (ms) the collector's queued entries get to reach the observer: a short run ends before a pending collection is reported, so one turn of the loop is not enough. */
const DRAIN_MS = 100;

/**
 * The minor collections (scavenges) while `body` runs, after a full collection clears what came before. Allocating per call shows here; a major
 * collection on a long run (Node's memory reducer, timed by the wall clock, so a loaded machine meets it) is no allocation of the body's.
 */
export async function scavengesDuring(body: () => void | Promise<void>): Promise<number> {
  forceCollect();
  await delay(DRAIN_MS);
  let minor = 0;
  const count = (entries: readonly PerformanceEntry[]): void => {
    for (const e of entries) if ((e as PerformanceEntry & { detail?: { kind?: number } }).detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR) minor++;
  };
  const observer = new PerformanceObserver((list) => count(list.getEntries()));
  observer.observe({ entryTypes: ["gc"] });
  await body();
  await delay(DRAIN_MS);
  count(observer.takeRecords());
  observer.disconnect();
  return minor;
}
