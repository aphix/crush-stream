import { createFileRoute, redirect } from "@tanstack/react-router";
import { benchRouteSearch } from "@/game/engine/bench-loop";

/** `/bench` (and `/bench/`): bare, the Benchmark entry (the chooser, then the loop); with params, that bench page, run at once (`benchRouteSearch`). */
export const Route = createFileRoute("/bench")({
  beforeLoad: ({ location }) => {
    throw redirect({ to: "/", search: benchRouteSearch(location.search) as never });
  },
});
