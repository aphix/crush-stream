import { Button } from "@/components/ui/button";
import { startBenchLoop } from "@/components/bench-run";
import { extendedPlanS, planText, quickPlanS } from "@/game/engine/bench-plan-time";
import { ULTRA_AVAILABLE } from "@/game/engine/bench-loop";

const BUTTON = "idle:hidden h-10 px-1 text-xs font-normal text-muted sm:h-7 sm:px-2.5";

/**
 * The scene list's Benchmark entries. Benchmark is the quick bench: the strip, the city, the biggest course and the National Mall in turn, one epicenter arm of each (the next run is the other arm),
 * the measured window alone, a card posted for each with a receipt; its planned length is on the button. Extended is the long one (the FX-tier sweep, the pacer, detail, FX and sky A/Bs and the
 * replay on every page, both arms of every map), which keeps benching and reloads onto new builds.
 */
export function BenchEntry() {
  return (
    <>
      <Button
        variant="ghost"
        className={BUTTON}
        aria-label={`Benchmark: run the four maps in turn and submit each result, ${planText(quickPlanS(ULTRA_AVAILABLE))}`}
        title={`Run the strip, city, biggest-course and National Mall benches one after another and send each result to the developer: ${planText(quickPlanS(ULTRA_AVAILABLE))}`}
        onClick={() => startBenchLoop(false)}
      >
        Benchmark · {planText(quickPlanS(ULTRA_AVAILABLE))}
      </Button>
      <Button
        variant="ghost"
        className={BUTTON}
        aria-label={`Extended benchmark: both arms of every map with the A/B blocks and the replay, ${planText(extendedPlanS(ULTRA_AVAILABLE))}`}
        title={`The long benchmark: every map under both epicenter arms, with the FX, pacer, detail and sky A/Bs and the replay: ${planText(extendedPlanS(ULTRA_AVAILABLE))}`}
        onClick={() => startBenchLoop(true)}
      >
        Extended · {planText(extendedPlanS(ULTRA_AVAILABLE))}
      </Button>
    </>
  );
}
