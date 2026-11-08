import { afterEach, describe, expect, it } from "vitest";
import { TIME_OF_DAY, type TimeOfDay } from "../match/types.ts";
import { restoreFrame, rig } from "./bench-frame.test-util.ts";
import { timeAb, type TimeEngine } from "./bench-time-ab.ts";
import { benchPlan } from "./engine-bench-plan.ts";
import type { PageWatch } from "./engine-bench-page.ts";
import { PHASE_AB_TIME } from "./engine-bench-report.ts";
import { must } from "../kernel/must.test-util.ts";

afterEach(restoreFrame);

/** A page watch that notes the stretches entered. */
function pageWatch(phases: number[]): PageWatch {
  return { phase: (index) => void phases.push(index), stop: () => [], changedWithin: () => false, tick() {}, seconds: () => ({ flags: "", phases: "", sky: "", epi: "" }) };
}

/** The time A/B on `search`'s plan, with an engine that notes each time of day it is asked for (`null` is the race's own). */
async function runTimeAb(search: string) {
  const { engine, parts, t, beat } = rig();
  const calls: (TimeOfDay | null)[] = [];
  const phases: number[] = [];
  const timeEngine: TimeEngine = { ...engine, setBenchTime: (time) => void calls.push(time) };
  const plan = benchPlan(search);
  must(plan, `${search} is a bench`);
  const run = await timeAb(timeEngine, parts, plan, t, beat, pageWatch(phases), { set() {} });
  return { calls, phases, run };
}

describe("given the time-of-day A/B on a race bench", () => {
  // mutation: sed -i '/^  engine.setBenchTime(null);$/d' src/game/engine/bench-time-ab.ts  (the last call is night: the race keeps the night light through the replay)
  // mutation: sed -i 's/const run = await alternate(engine, parts, t, beat, ui, "time", Object.entries(TIME_OF_DAY)/const run = await alternate(engine, parts, t, beat, ui, "time", Object.entries(TIME_OF_DAY).reverse()/' src/game/engine/bench-time-ab.ts  (the arms come in another order)
  it("when it runs, then the race's light is day, sunset, night in turn and the race's own again last, and the stretch is the time-of-day one", async () => {
    const { calls, phases, run } = await runTimeAb("?bench=city&extended=1");
    expect(calls.map((c) => c ?? "own").join(" ")).toBe([TIME_OF_DAY.day, TIME_OF_DAY.sunset, TIME_OF_DAY.night, "own"].join(" "));
    expect(calls.at(-1), "the last call hands the light back").toBe(null);
    expect(phases.join(), "the stretch entered").toBe(String(PHASE_AB_TIME));
    expect([...(run?.accs.keys() ?? [])].join(" "), "the arms scored").toBe("day sunset night");
  });
});

describe("given the time-of-day A/B on the Lab bench, which has no race and so no time of day", () => {
  // mutation: sed -i '/^  if (plan.lab) return null;$/d' src/game/engine/bench-time-ab.ts  (the Lab's stage is set to the race's light: its own Night setting is lost)
  it("when it runs, then the engine is never asked for a time of day, nothing is scored, and the stretch is entered all the same", async () => {
    const { calls, phases, run } = await runTimeAb("?bench=lab&extended=1");
    expect(calls.length, `calls made: ${calls.join()}`).toBe(0);
    expect(run, "no arms").toBe(null);
    expect(phases.join(), "the stretch entered").toBe(String(PHASE_AB_TIME));
  });
});
