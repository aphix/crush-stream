import { Session, type HeapProfiler } from "node:inspector";

/** Mean gap (B) between the sampling heap profiler's samples: a read of a few hundred KB is good to a few percent. */
const SAMPLE_B = 64;

/** The function whose callees' allocation a read keeps: its name and the end of its file's URL. */
export interface Within {
  fn: string;
  file: string;
}

/** Bytes sampled as allocated under `node`; with `within`, only those made under a call of it. */
function sampled(node: HeapProfiler.SamplingHeapProfileNode, within: Within | undefined, inside: boolean): number {
  const here = inside || within === undefined || (node.callFrame.functionName === within.fn && node.callFrame.url.endsWith(within.file));
  let bytes = here ? node.selfSize : 0;
  for (const child of node.children) bytes += sampled(child, within, here);
  return bytes;
}

/**
 * Bytes `run` allocates: V8's sampling heap profiler counts every object made, dead by the end or not, so neither where a scavenge
 * falls nor how big the heap is moves the read (a `heapUsed` delta moves with both). What it does not see is whether V8 has
 * optimized the code yet: cold code boxes every double, and the optimizing compile lands late on a loaded box (`untilQuiet`).
 * A loop that calls the measured code is part of the read: a second callee at its call site costs the first its inlining.
 */
export function allocatedBytes(run: () => void, within?: Within): number {
  const session = new Session();
  session.connect();
  session.post("HeapProfiler.startSampling", { samplingInterval: SAMPLE_B, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  run();
  let bytes = NaN;
  session.post("HeapProfiler.stopSampling", (err, result) => {
    if (err) throw err;
    bytes = sampled(result.profile.head, within, false);
  });
  session.disconnect();
  return bytes;
}

/** Wall seconds a row waits for its code to be optimized: only a real allocation (never quiet) spends them all. */
export const COMPILE_WAIT_S = 120;

/** `read` (given the attempt's number) again, until a reading is at most `bound` or `COMPILE_WAIT_S` have passed; the last reading. A real allocation never goes quiet, cold code does. */
export function untilQuiet(read: (attempt: number) => number, bound: number): number {
  const until = performance.now() + COMPILE_WAIT_S * 1000;
  let reading = read(0);
  for (let attempt = 1; reading > bound && performance.now() < until; attempt++) reading = read(attempt);
  return reading;
}

// The first reads of a process pay for the inspector's own cold code (up to hundreds of KB): taken here, before any row's.
for (let primed = 0; primed < 3; primed++) allocatedBytes(() => {});
