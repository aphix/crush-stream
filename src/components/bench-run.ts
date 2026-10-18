/**
 * The benchmark loop's browser side (rules: `game/engine/bench-loop.ts`): the bench page itself (`?bench=…`, fetched only when asked
 * for), the whole loop run in it (no navigation between steps: the page keeps its fullscreen, and holds a screen wake lock from the first step to the
 * last), and the one move to a newer build. The loop's state lives in the page's address, nothing is stored.
 */
import type { CrashEngine } from "@/game/engine/engine";
import type { CrashHudState } from "@/game/hud/hud-store";
import type { runBench } from "@/game/engine/engine-bench";
import { driveLoop, loopProgress, loopSettings, newSession, parseRun, runFromPage, startRun, stepHref, stepOf, type BenchRun } from "@/game/engine/bench-loop";
import { WakeHold } from "@/game/engine/bench-wake";
import { BENCH_QUERY } from "@/game/engine/constants";
import { fetchDeployedSha, newerBuild, reloadTarget } from "@/lib/deploy/update-check";
import { KIND } from "@/lib/submissions/kinds";
import { sendSubmission } from "@/lib/submissions/status";

/** A bench's card and receipt stay on screen this long before the next bench of the loop begins. */
const PAUSE_MS = 4_000;

/** The Benchmark entry: a new loop from its first step. */
export function startBenchLoop(): void {
  location.assign(stepHref(location.href, startRun(newSession())));
}

/**
 * A `?bench=` page: run its bench, post the card, and carry the loop on in this page. A page opened by its address alone is a loop from there with
 * every option on (`runFromPage`), exactly as the Benchmark entry starts one, and its address is rewritten to say so; a bench the
 * cycle doesn't run (the lab, another course) runs once and posts. With `auto` set and a newer build deployed, the next step is a reload onto it (`?v=`,
 * held back by the backoff if earlier reloads did not land): the loop's one navigation, which drops fullscreen and the wake lock with the page.
 */
export async function runBenchPage(engine: CrashEngine, hud: () => CrashHudState): Promise<void> {
  const search = location.search;
  const first = parseRun(search) ?? runFromPage(search, newSession());
  if (first !== null) history.replaceState(history.state, "", stepHref(location.href, first));
  // Dynamic on purpose: the bench's code is its own chunk, fetched only by a page that asks for a bench (as before the loop).
  const bench: { runBench: typeof runBench } = await import("@/game/engine/engine-bench");
  const wake = new WakeHold();
  await wake.acquire();
  let stepsRun = 0;
  const runStep = async (run: BenchRun | null, query: string): Promise<boolean> => {
    const result = await bench.runBench(engine, hud, query, {
      auto: true,
      stepOfPage: stepsRun++,
      keep: run?.keep ?? null,
      loopProgress: run === null ? null : loopProgress(run),
      wake,
      submit: (payload) =>
        sendSubmission(KIND.bench, async () => {
          const { scene, settings } = engine.submitContext();
          const loop = run === null ? {} : loopSettings(run, stepOf(run));
          return { context: { scene, settings: { ...settings, bench: new URLSearchParams(query).get(BENCH_QUERY), ...loop } }, payload };
        }),
    });
    return result !== null;
  };
  try {
    // A page that asks for no bench the game knows is a broken loop: it ends there rather than cycle on forever.
    if (first === null) await runStep(null, search);
    else {
      await driveLoop(first, {
        show: (run) => {
          history.replaceState(history.state, "", stepHref(location.href, run));
          return location.search;
        },
        runStep,
        pause: () => new Promise<void>((resolve) => window.setTimeout(resolve, PAUSE_MS)),
        reload: async (run) => {
          const deployed = run.auto ? newerBuild(__BUILD_SHA__, await fetchDeployedSha()) : null;
          const to = deployed !== null ? reloadTarget(stepHref(location.href, run), deployed) : null;
          if (to === null) return false;
          await new Promise<void>((resolve) => window.setTimeout(resolve, PAUSE_MS));
          location.assign(to);
          return true;
        },
      });
    }
  } finally {
    await wake.release();
  }
}
