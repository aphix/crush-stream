import type { RaceCommand } from "../match/types.ts";
import type { CarStyleId } from "../vehicle/car-variants.ts";
import { KNOB_DEFAULTS, KNOBS, type KnobId } from "../hud/knobs.ts";
import { BENCH, type BenchParts } from "./bench-measure.ts";
import type { BenchPlan } from "./engine-bench-plan.ts";

/** What a bench's scene setup drives on the engine. */
export interface SceneEngine {
  readonly showLab: boolean;
  toggleRace(): void;
  raceCommand(cmd: RaceCommand): void;
  toggleLab(): void;
  /** The HUD's time scale: a fixed one, or null for the automatic slow-mo. */
  setTimeScale(value: number | null): void;
  /** The Debug slider `id` to `value`. */
  setKnob(id: KnobId, value: number): void;
  useOneBody(style: CarStyleId | null): void;
}

/** Wall ms the race's options and its start took, for the card's `load:` line. */
interface SetupMs {
  options: number;
  start: number;
}

/**
 * The scene a bench runs in, from whatever the page was in: the scene a bench before it left (a toggle of the scene in play goes back to the
 * fleet) is left first, every Debug knob goes back to its default (a page that ran the epicenter arm would carry it into the next), then the Lab
 * or the race is entered. The Lab bench throws on the Lab's own sets at 1x: the slow-mo would stretch each hit over a different share of each
 * block. A race bench enters the race scene (no slow-mo in a race), builds the strip and hands it to the race field as an off-menu course,
 * dresses every non-police car in the one body asked for, starts the race on the bench's seed with the follow camera, and turns the epicenter
 * activation on once the race is up when the plan asks for it.
 */
export function enterBenchScene(engine: SceneEngine, parts: BenchParts, plan: BenchPlan): SetupMs {
  if (parts.race.active) engine.toggleRace();
  if (engine.showLab) engine.toggleLab();
  for (const knob of KNOBS) engine.setKnob(knob.id, KNOB_DEFAULTS[knob.id]);
  if (plan.lab) {
    engine.toggleLab();
    engine.setTimeScale(1);
  } else engine.toggleRace();
  if (plan.course) parts.race.loadBenchCourse(plan.course);
  engine.useOneBody(plan.body);
  const setupMs = { options: 0, start: 0 };
  if (!plan.race) return setupMs;
  const t0 = performance.now();
  engine.raceCommand(plan.race);
  const t1 = performance.now();
  parts.race.reseed(BENCH.seed);
  engine.raceCommand({ type: "start" });
  engine.setKnob("epi.on", plan.epicenter ? 1 : 0);
  setupMs.options = t1 - t0;
  setupMs.start = performance.now() - t1;
  parts.seat.mode = "follow";
  return setupMs;
}
