/**
 * One arm of one scenario in one process (`bench.mjs` starts it): build the scenario with every knob off, apply the arm's knobs, warm up, then run the window with the
 * phase clock on, and print one line, `BENCH_ARM {json}`: ms per sim-second by phase, the work counters per sim-second, the end state's digest and poses, the load.
 *
 *   BENCH_SCENARIO=<name> BENCH_KNOBS='{"epi.on":1}' [BENCH_WARM=<s>] [BENCH_WINDOW=<s>] [BENCH_THAW_SITES=1] node --import scripts/test-setup.mjs scripts/bench/run-scenario.ts
 *
 * `BENCH_THAW_SITES=1` counts which call thawed how often (a stack sample per thaw: slower, so a run for counts, never for ms).
 */
import { createHash } from "node:crypto";
import { loadavg } from "node:os";
import { EPICENTER_KNOBS, loadEpicenter } from "../../src/game/deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../../src/game/deform/epicenter.test-util.ts";
import { DeformRig } from "../../src/game/deform/deform-rig.ts";
import { PHASE_NAMES, WORK_NAMES } from "../../src/game/engine/sim-phases.ts";
import { SCENARIO_INFO } from "./scenario-info.ts";
import { SCENARIOS } from "./scenarios.ts";

const name = process.env["BENCH_SCENARIO"] ?? "";
const scenario = SCENARIOS[name];
const info = SCENARIO_INFO[name];
if (!scenario || !info) throw new Error(`BENCH_SCENARIO=${name}: not one of ${Object.keys(SCENARIOS).join(", ")}`);
const knobs: Record<string, number> = JSON.parse(process.env["BENCH_KNOBS"] ?? "{}");
const warmS = Number(process.env["BENCH_WARM"] ?? info.warmS);
const windowS = Number(process.env["BENCH_WINDOW"] ?? info.windowS);

/** Which function called `thaw`, counted: the stack's third frame names it. */
const sites = new Map<string, number>();
if (process.env["BENCH_THAW_SITES"] === "1") {
  const thaw = DeformRig.prototype.thaw;
  DeformRig.prototype.thaw = function (this: DeformRig): void {
    if (this.frozen) {
      const frame = new Error().stack?.split("\n")[2]?.trim().replace(/^at /, "").split(" ")[0] ?? "?";
      sites.set(frame, (sites.get(frame) ?? 0) + 1);
    }
    thaw.call(this);
  };
}

// Staged with every knob at its off value, so both arms start from the same state; the arm's knobs apply after.
loadEpicenter(EPICENTER_AT_LOAD);
const sim = scenario.build();
const label = scenario.label(sim);
for (const [id, value] of Object.entries(knobs)) {
  const knob = EPICENTER_KNOBS.find((k) => k.id === id);
  if (!knob) throw new Error(`knob ${id}: not one of ${EPICENTER_KNOBS.map((k) => k.id).join(", ")}`);
  knob.set(value);
}
/**
 * `BENCH_TRACE=<dt>`: every `dt` sim seconds from the start of the warm-up, each car's pose (position, quaternion), velocity and every mass's world position, so the arms of an A/B can
 * be compared over time (`bench.mjs` prints the divergence: how far, of what, and when). The recording costs time: a run for the divergence, never for ms.
 */
const traceDt = Number(process.env["BENCH_TRACE"] ?? 0);
const trace: number[][] = [];
const record = (): void => {
  const row: number[] = [sim.t];
  for (const car of sim.cars) {
    const p = car.group.position;
    const q = car.group.quaternion;
    row.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w, car.velocity.x, car.velocity.y, car.velocity.z);
    for (const m of car.deform.masses) row.push(m.world.x, m.world.y, m.world.z);
  }
  trace.push(row);
};
const advance = (seconds: number): void => {
  if (traceDt <= 0) return sim.run(seconds);
  for (let left = seconds; left > 1e-9; left -= traceDt) {
    if (trace.length === 0) record();
    sim.run(Math.min(traceDt, left));
    record();
  }
};
advance(warmS);
sites.clear();

const phases = sim.world.phases;
phases.on = true;
const ms0 = phases.ms.slice();
const work0 = phases.work.slice();
const loadStart = loadavg()[0]!;
const t0 = performance.now();
const clock0 = sim.t;
advance(windowS);
const wallMs = performance.now() - t0;
const simS = sim.t - clock0;
phases.on = false;

const msPerS: Record<string, number> = {};
for (const [i, n] of PHASE_NAMES.entries()) msPerS[n] = (phases.ms[i]! - ms0[i]!) / simS;
const workPerS: Record<string, number> = {};
for (const [i, n] of WORK_NAMES.entries()) workPerS[n] = (phases.work[i]! - work0[i]!) / simS;

const hash = createHash("sha1");
const poses: number[] = [];
for (const car of sim.cars) {
  const p = car.group.position;
  const q = car.group.quaternion;
  const row = [p.x, p.y, p.z, q.x, q.y, q.z, q.w, car.velocity.x, car.velocity.y, car.velocity.z];
  poses.push(...row);
  const nums = new Float64Array(row);
  hash.update(new Uint8Array(nums.buffer));
  for (const m of car.deform.masses) hash.update(new Uint8Array(new Float64Array([m.world.x, m.world.y, m.world.z, m.vel.x, m.vel.y, m.vel.z, m.local.x, m.local.y, m.local.z]).buffer));
}
let breaches = 0;
for (const car of sim.cars) breaches += car.deform.frozenBreaches;

console.log(
  `BENCH_ARM ${JSON.stringify({
    scenario: name,
    label,
    lone: info.lone,
    knobs,
    warmS,
    windowS: simS,
    wallMsPerS: wallMs / simS,
    msPerS,
    workPerS,
    digest: hash.digest("hex"),
    poses,
    frozenBreaches: breaches,
    trace: traceDt > 0 ? { dt: traceDt, cars: sim.cars.length, masses: sim.cars.map((c) => c.deform.masses.length), rows: trace } : null,
    thawSites: Object.fromEntries([...sites].sort((a, b) => b[1] - a[1])),
    loadStart,
    loadEnd: loadavg()[0]!,
  })}`,
);
