import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/bench` (and `/bench/`): the Benchmark loop from its first bench. A `?bench=strip` page with no loop yet opens on the options chooser and starts
 * the loop from there, exactly as the Benchmark entry does (`components/bench-run.ts` `runBenchPage`), so this address only points there.
 */
export const Route = createFileRoute("/bench")({
  beforeLoad: () => {
    throw redirect({ to: "/", search: { bench: "strip" } as never });
  },
});
