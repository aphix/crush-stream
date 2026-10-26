/**
 * The ejection census: one bench scenario (`scenarios.ts`) in one process, every judgement of `EjectionWatch` counted, and one line printed, `EJECT_CENSUS {json}`: for each judged hit its peak
 * closing speed over the threshold it met, binned by what decided it (a dead drivetrain, a block packed to the realistic kill with the drivetrain alive, a fresh hit on a running car: "slam") and whether it threw the driver.
 *
 *   EJECT_SCENARIO=city-race|dam-spine-race|national-mall-race|strip|derby-8-s3 EJECT_SEED=<n> [EJECT_S=<sim seconds>] node --import ./scripts/test-setup.mjs scripts/bench/eject-census.ts
 *
 * The seed is the bench seed of an engine field. A scripted mini-game throw (`throwDriverNow`) never reaches a judgement and is not counted.
 */
import { BENCH } from "../../src/game/engine/bench-measure.ts";
import { ejectThreshold, EjectionWatch } from "../../src/game/vehicle/ejection.ts";
import type { DeformableCar } from "../../src/game/vehicle/car.ts";
import { SCENARIOS } from "./scenarios.ts";

const scenario = process.env["EJECT_SCENARIO"] ?? "";
const seed = Number(process.env["EJECT_SEED"] ?? 1);
const windowS = Number(process.env["EJECT_S"] ?? 150);

type Cause = "dead" | "packed" | "slam";

/** One car's one hit as the watch judged it step after step: the peak closing it reached, the threshold then, and whether it threw the driver. */
interface Episode {
  cause: Cause;
  since: number;
  closing: number;
  threshold: number;
  threw: boolean;
}

const episodes: Episode[] = [];
const open = new Map<DeformableCar, Episode>();
const watch = EjectionWatch.prototype as unknown as {
  judge(cars: readonly DeformableCar[], i: number, killed: boolean): void;
  peakClosing(cars: readonly DeformableCar[], i: number, killed: boolean): number;
};
let lastClosing = NaN;
const peak = watch.peakClosing;
watch.peakClosing = function (this: EjectionWatch, ...args: Parameters<typeof peak>): number {
  lastClosing = peak.apply(this, args);
  return lastClosing;
};
const judge = watch.judge;
watch.judge = function (this: EjectionWatch, cars: readonly DeformableCar[], i: number, killed: boolean): void {
  const car = cars[i]!;
  const cause: Cause = !killed ? "slam" : car.deform.drivetrainAlive ? "packed" : "dead";
  const threshold = ejectThreshold(car, this.minigame, this.ctx === "derby" && !killed);
  lastClosing = NaN;
  judge.call(this, cars, i, killed);
  if (Number.isNaN(lastClosing)) return;
  const since = car.deform.sinceHit();
  let e = open.get(car);
  if (!e || e.cause !== cause || since < e.since) {
    e = { cause, since, closing: -Infinity, threshold, threw: false };
    open.set(car, e);
    episodes.push(e);
  }
  e.since = since;
  if (lastClosing > e.closing) Object.assign(e, { closing: lastClosing, threshold });
  if (car.driverOut !== null) e.threw = true;
};

const scenarioDef = SCENARIOS[scenario];
if (!scenarioDef) throw new Error(`EJECT_SCENARIO=${scenario}: not one of ${Object.keys(SCENARIOS).join(", ")}`);
Object.assign(BENCH, { seed });
const sim = await scenarioDef.build();
// The derby sim has no watch of its own: arm one in the derby's context.
if (!sim.world.ejection) {
  sim.world.ejection = new EjectionWatch();
  sim.world.ejection.ctx = "derby";
}
const crashed = new Set<DeformableCar>();
const t0 = sim.t;
while (sim.t - t0 < windowS) {
  const before = sim.t;
  sim.run(sim.stepS);
  if (sim.t === before) break;
  for (const c of sim.cars) if (c.crashed) crashed.add(c);
}

/** The lower bounds of the closing-over-threshold buckets; below the first is the first bucket. */
const RATIO_EDGES = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];
const bins = (cause: Cause, threw: boolean): number[] => {
  const out = new Array<number>(RATIO_EDGES.length + 1).fill(0);
  for (const e of episodes) {
    if (e.cause !== cause || e.threw !== threw) continue;
    out[RATIO_EDGES.filter((edge) => e.closing / e.threshold >= edge).length]!++;
  }
  return out;
};
console.log(
  `EJECT_CENSUS ${JSON.stringify({
    scenario,
    seed,
    simS: sim.t - t0,
    cars: sim.cars.length,
    crashedCars: crashed.size,
    ratioEdges: RATIO_EDGES,
    threw: { dead: bins("dead", true), packed: bins("packed", true), slam: bins("slam", true) },
    stayed: { dead: bins("dead", false), packed: bins("packed", false), slam: bins("slam", false) },
  })}`,
);
process.exit(0);
