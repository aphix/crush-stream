/**
 * The city bench through the real engine, for the scenario bench's end-to-end confirmation row: `benchRaceEngine` (the in-app card's `BENCH_RACE`: 15 AI racers and police on the city course,
 * the bench's seed, nothing drawn, the pacer pinned to the 1/240 s floor, one step a frame), stepped in sim seconds. One per process (a second `CrashEngine` never resolves `ready`), which is
 * how `run-scenario.ts` runs an arm anyway. The AI drives, so unlike the bare-world rows the arms may do different work: read per-unit rows and the counters, as for the in-app card.
 */
import { benchRaceEngine, FRAME_S } from "../../src/game/engine/engine-bench-headless.test-util.ts";
import type { CrashEngine } from "../../src/game/engine/engine.ts";
import type { DeformableCar } from "../../src/game/vehicle/car.ts";
import type { World } from "../../src/game/engine/world-step.ts";
import type { SimLike } from "./sim.ts";

export class EngineSim implements SimLike {
  t = 0;

  private constructor(private readonly engine: CrashEngine) {}

  static async city(): Promise<EngineSim> {
    return new EngineSim(await benchRaceEngine());
  }

  get world(): World {
    return this.engine["world"];
  }

  /** The cars the engine steps now (the race's racers and the police that spawn). */
  get cars(): readonly DeformableCar[] {
    return this.engine["live"]();
  }

  run(seconds: number): void {
    const steps = Math.round(seconds / FRAME_S);
    for (let i = 0; i < steps; i++) this.engine.advance(FRAME_S, { frameDt: FRAME_S });
    this.t += steps * FRAME_S;
  }
}
