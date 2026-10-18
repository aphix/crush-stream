/**
 * The window's own CPU profile (`BENCH_PROF=1`, bench `--prof`): the V8 sampler runs over the measured window only (a whole-process `--cpu-prof` carries the scene's boot, the
 * raster build and the module load into every row), and the result is per function the self ms and the inclusive ms per sim-second (a function counted once per sample however
 * often it is on the stack). The sampler slows the sim a few percent: a run for where the time goes, never for the ms of the phases.
 */
import { Session, type Profiler } from "node:inspector";

export interface ProfRow {
  fn: string;
  selfMsPerS: number;
  /** The function's self time by source line (the sampler's position ticks, shared out by the node's self ms), the heaviest first: [line, ms per sim-second]. */
  lines: [number, number][];
  inclMsPerS: number;
}

const SAMPLE_US = 100;

/** Lines kept per function. */
const LINES = 6;

export function startProfile(): Session {
  const session = new Session();
  session.connect();
  session.post("Profiler.enable");
  session.post("Profiler.setSamplingInterval", { interval: SAMPLE_US });
  session.post("Profiler.start");
  return session;
}

/** Stops the sampler: every function with its self and inclusive time per sim-second over `simS`, the most inclusive first. */
export function stopProfile(session: Session, simS: number): ProfRow[] {
  const out: { profile?: Profiler.Profile } = {};
  session.post("Profiler.stop", (err, result) => {
    if (err) throw err;
    out.profile = result.profile;
  });
  session.disconnect();
  if (out.profile === undefined) throw new Error("the profiler gave no profile");
  const { nodes, samples = [], timeDeltas = [] } = out.profile;
  const byId = new Map<number, Profiler.ProfileNode>();
  const parent = new Map<number, number>();
  for (const n of nodes) {
    byId.set(n.id, n);
    for (const c of n.children ?? []) parent.set(c, n.id);
  }
  const name = (n: Profiler.ProfileNode): string => `${n.callFrame.functionName || "(anonymous)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}`;
  const self = new Map<string, number>();
  const incl = new Map<string, number>();
  const lines = new Map<string, Map<number, number>>();
  const nodeMs = new Map<number, number>();
  for (let i = 0; i < samples.length; i++) {
    // The delta after a sample is its own duration, as DevTools reads it.
    const ms = (timeDeltas[i + 1] ?? timeDeltas[i]!) / 1000;
    nodeMs.set(samples[i]!, (nodeMs.get(samples[i]!) ?? 0) + ms);
    const seen = new Set<string>();
    for (let id: number | undefined = samples[i]!; id !== undefined; id = parent.get(id)) {
      const fn = name(byId.get(id)!);
      if (id === samples[i]) self.set(fn, (self.get(fn) ?? 0) + ms);
      if (!seen.has(fn)) {
        seen.add(fn);
        incl.set(fn, (incl.get(fn) ?? 0) + ms);
      }
    }
  }
  for (const [id, ms] of nodeMs) {
    const node = byId.get(id)!;
    const ticks = node.positionTicks ?? [];
    const total = ticks.reduce((s, t) => s + t.ticks, 0);
    if (total === 0) continue;
    const fn = name(node);
    const byLine = lines.get(fn) ?? new Map<number, number>();
    for (const t of ticks) byLine.set(t.line, (byLine.get(t.line) ?? 0) + (ms * t.ticks) / total);
    lines.set(fn, byLine);
  }
  return [...incl]
    .map(([fn, ms]) => ({ fn, inclMsPerS: ms / simS, selfMsPerS: (self.get(fn) ?? 0) / simS, lines: [...(lines.get(fn) ?? [])].map(([l, m]): [number, number] => [l, m / simS]).sort((a, b) => b[1] - a[1]).slice(0, LINES) }))
    .sort((a, b) => b.inclMsPerS - a.inclMsPerS);
}
