/**
 * The city bench through the real engine, for the scenario bench's end-to-end confirmation rows: `benchRaceEngine` (the in-app card's `BENCH_RACE`: 15 AI racers and police on the city course,
 * the bench's seed, nothing drawn), stepped in sim seconds, either at the fine floor (`pace.pin` false: 1/240 s a frame, one slice a step, so the lone-car cut has nothing to skip) or on the race's
 * schedule (`pace.pin` true: 1/80 s steps, cut to 1/240 s slices in contact, lone cars once a step: what a phone that keeps up runs). One per process (a second `CrashEngine` never resolves `ready`),
 * which is how `run-scenario.ts` runs an arm anyway. The AI drives, so unlike the bare-world rows the arms may do different work: read per-unit rows and the counters, as for the in-app card.
 */
import { benchPlanEngine, benchRaceEngine, FRAME_S } from "../../src/game/engine/engine-bench-headless.test-util.ts";
import type { CrashEngine } from "../../src/game/engine/engine.ts";
import { QUIET_HZ } from "../../src/game/kernel/constants.ts";
import type { DeformableCar } from "../../src/game/vehicle/car.ts";
import type { World } from "../../src/game/engine/world-step.ts";
import type { SimLike } from "./sim.ts";

export class EngineSim implements SimLike {
  t = 0;
  readonly stepS: number;
  private readonly engine: CrashEngine;

  private constructor(engine: CrashEngine, race: boolean) {
    this.engine = engine;
    this.stepS = race ? 1 / QUIET_HZ : FRAME_S;
    engine.pace.pin = race;
  }

  static async city(race: boolean): Promise<EngineSim> {
    return new EngineSim(await benchRaceEngine(), race);
  }

  /** The city bench's field (15 AI racers and police, the bench's seed) on another course (`id`: a campaign course or the off-menu Havana) on the race's step schedule: the ground proof's rows for each course's static ground. */
  static async course(id: string): Promise<EngineSim> {
    return new EngineSim(await benchRaceEngine(id), true);
  }

  /** A bench page of the in-app card through the real engine on the race's step schedule (`?bench=strip`: 16 racers and traffic on the 6 km straight, one sedan body; `?bench=city&course=national-mall`: the mall), the bench's seed, nothing drawn: the headless twin of the owner's off/on cards. */
  static async plan(search: string): Promise<EngineSim> {
    return new EngineSim(await benchPlanEngine(search), true);
  }

  get world(): World {
    return this.engine["world"];
  }

  /** The cars the engine steps now (the race's racers and the police that spawn). */
  get cars(): readonly DeformableCar[] {
    return this.engine["live"]();
  }

  run(seconds: number): void {
    const steps = Math.round(seconds / this.stepS);
    for (let i = 0; i < steps; i++) this.engine.advance(this.stepS, { frameDt: this.stepS });
    this.t += steps * this.stepS;
  }
}
