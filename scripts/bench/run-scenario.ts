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
import { DeformFreeze } from "../../src/game/deform/deform-freeze.ts";
import { DeformContact } from "../../src/game/deform/deform-contact.ts";
import * as THREE from "three";
import { DeformableCar } from "../../src/game/vehicle/car.ts";
import { PHASE_NAMES, WORK_NAMES } from "../../src/game/engine/sim-phases.ts";
import { SCENARIO_INFO } from "./scenario-info.ts";
import { SCENARIOS } from "./scenarios.ts";
import { LoneCensus } from "./census.ts";

const name = process.env["BENCH_SCENARIO"] ?? "";
const scenario = SCENARIOS[name];
const info = SCENARIO_INFO[name];
if (!scenario || !info) throw new Error(`BENCH_SCENARIO=${name}: not one of ${Object.keys(SCENARIOS).join(", ")}`);
const knobs: Record<string, number> = JSON.parse(process.env["BENCH_KNOBS"] ?? "{}");
const warmS = Number(process.env["BENCH_WARM"] ?? info.warmS);
const windowS = Number(process.env["BENCH_WINDOW"] ?? info.windowS);

/** Which function called `thaw`, counted: the stack's third frame names it. */
const sites = new Map<string, number>();
const clampSites = new Map<string, number>();
const offSites = new Map<string, number>();
const feedBins = new Map<string, number>();
const wakeSites = new Map<string, number>();
const speedBins = new Map<string, number>();
const bakeBins = new Map<string, { n: number; ms: number }>();
if (process.env["BENCH_THAW_SITES"] === "1") {
  const thaw = DeformRig.prototype.thaw;
  DeformRig.prototype.thaw = function (this: DeformRig): void {
    if (this.frozen) {
      const frame = new Error().stack?.split("\n")[2]?.trim().replace(/^at /, "").split(" ")[0] ?? "?";
      sites.set(frame, (sites.get(frame) ?? 0) + 1);
    }
    thaw.call(this);
  };
  // What feeds a frozen car: closing speed x overlap of each `feedOverlap` call (the gate `epi.feedMin` has to be placed against these).
  const feed = DeformContact.prototype.feedOverlap;
  DeformContact.prototype.feedOverlap = function (this: DeformContact, ...args: Parameters<typeof feed>): number {
    if (this.frozen) {
      const [, , overlap, closing] = args;
      const c = closing < 0.01 ? "closing under 1 cm/s" : closing < 0.1 ? "closing under 10 cm/s" : closing < 1 ? "closing under 1 m/s" : "closing 1 m/s and over";
      const o = overlap < 0.001 ? "overlap under 1 mm" : overlap < 0.01 ? "under 1 cm" : overlap < 0.1 ? "under 10 cm" : "10 cm and over";
      const key = `${c}, ${o}`;
      feedBins.set(key, (feedBins.get(key) ?? 0) + 1);
    }
    return feed.apply(this, args);
  };
  // How fast the wrecks that take a rigid step are (translation and spin together): the share that stand still but are stepped anyway is what a rest skip could take.
  const integrate = DeformableCar.prototype.integrate;
  DeformableCar.prototype.integrate = function (this: DeformableCar, dt: number): void {
    if (this.deform.massActive && !this.asleep) {
      const v = Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z) + this.angular.length();
      const bin = v < 1e-9 ? "under 1e-9" : v < 1e-6 ? "under 1e-6" : v < 1e-3 ? "under 1e-3" : v < 0.16 ? "under rest speed 0.16" : v < 1 ? "under 1 m/s" : "1 m/s and over";
      const key = `${bin}${this.deform.frozen ? ", frozen" : ", not frozen"}, ${this.driverOut ? "driver out" : "driver in"}, ${this.deform.drivetrainAlive ? "drivetrain alive" : "drivetrain dead"}`;
      speedBins.set(key, (speedBins.get(key) ?? 0) + 1);
    }
    integrate.call(this, dt);
  };
  // What `bakeBetweenSlices` is called for and what it costs, by car state: a frozen wreck, a wreck in its crush window, an intact car (the call returns at once for those without masses).
  const bake = DeformableCar.prototype.bakeBetweenSlices;
  DeformableCar.prototype.bakeBetweenSlices = function (this: DeformableCar, h: number): void {
    const state = !this.deform.massActive ? "intact (no masses)" : this.deform.frozen ? "frozen wreck" : this.deform.crushing ? "wreck crushing" : "wreck in no crush";
    const t0 = performance.now();
    bake.call(this, h);
    const row = bakeBins.get(state) ?? { n: 0, ms: 0 };
    row.n++;
    row.ms += performance.now() - t0;
    bakeBins.set(state, row);
  };
  // Who wakes a crashed car, or resets its rest timer (`wake` does both): a wreck that is woken every slice never sleeps.
  const wake = DeformableCar.prototype.wake;
  DeformableCar.prototype.wake = function (this: DeformableCar): void {
    if (this.deform.massActive) {
      const frame = new Error().stack?.split("\n")[2]?.trim().replace(/^at /, "").replace(/\(?file:\/\/\/.*\/src\//, "(") ?? "?";
      const key = `${frame}${this.asleep ? " (asleep)" : " (awake: rest timer reset)"}`;
      wakeSites.set(key, (wakeSites.get(key) ?? 0) + 1);
    }
    wake.call(this);
  };
  // And who re-measured (`syncPose`: a `clampLocal`) a frozen car whose centre is cached: the freeze's invariant says nobody may (`DeformFreeze.settleFreeze`).
  const syncPose = DeformableCar.prototype.syncPose;
  DeformableCar.prototype.syncPose = function (this: DeformableCar, dt: number): void {
    if (this.deform.frozenReady) {
      const frame = new Error().stack?.split("\n")[2]?.trim().replace(/^at /, "").replace(/\(?file:\/\/\/.*\/src\//, "(") ?? "?";
      clampSites.set(frame, (clampSites.get(frame) ?? 0) + 1);
    }
    syncPose.call(this, dt);
  };
  // And when a frozen car's mass stands off its frame at a frozen step, which moved since the previous frozen step: the frame (the group's pose) or the mass (its world place).
  const stepFrozen = DeformFreeze.prototype.stepFrozen;
  const last = new WeakMap<object, { pos: THREE.Vector3; quat: THREE.Quaternion; world: THREE.Vector3[]; mw: number[]; local: THREE.Vector3[] }>();
  const _p = new THREE.Vector3();
  DeformFreeze.prototype.stepFrozen = function (this: DeformFreeze, dt: number, group: THREE.Object3D): void {
    group.updateWorldMatrix(false, false);
    const before = last.get(this);
    let worst = 0;
    let at = -1;
    for (const [i, m] of this.masses.entries()) {
      const d = _p.copy(m.local).applyMatrix4(group.matrixWorld).distanceTo(m.world);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > 1e-4 && before) {
      const turn = (2 * Math.acos(Math.min(1, Math.abs(before.quat.dot(group.quaternion)))) * 180) / Math.PI;
      const slide = before.pos.distanceTo(group.position);
      const mass = before.world[at]!.distanceTo(this.masses[at]!.world);
      const m = this.masses[at]!;
      const mwDelta = Math.max(...before.mw.map((v, k) => Math.abs(v - group.matrixWorld.elements[k]!)));
      const localDelta = before.local[at]!.distanceTo(m.local);
      const yes = (v: number, eps: number): string => (v > eps ? "MOVED" : "still");
      const car = sim.cars.find((c) => c.deform === this);
      const key = `${m.name}: frame ${yes(slide, 1e-4)}/${yes(turn, 1e-3)} matrix ${yes(mwDelta, 1e-9)} mass ${yes(mass, 1e-4)} local ${yes(localDelta, 1e-4)}; car asleep ${car?.asleep} parked ${car?.parked} drivetrain ${this.drivetrainAlive} ready ${this.frozenReady} speed ${car ? car.velocity.length().toFixed(1) : "?"}`;
      offSites.set(key, (offSites.get(key) ?? 0) + 1);
    }
    last.set(this, { pos: group.position.clone(), quat: group.quaternion.clone(), world: this.masses.map((m) => m.world.clone()), mw: Array.from(group.matrixWorld.elements), local: this.masses.map((m) => m.local.clone()) });
    stepFrozen.call(this, dt, group);
  };
}

// Staged with every knob at its off value, so both arms start from the same state; the arm's knobs apply after.
loadEpicenter(EPICENTER_AT_LOAD);
const sim = await scenario.build();
const label = scenario.label(sim);
for (const [id, value] of Object.entries(knobs)) {
  // `nudge` (m) is not a knob: the sensitivity control, every mass of car 2 moved that far in x before the run (the sim's own response to a micrometre, with every knob off).
  if (id === "nudge") {
    sim.cars[2]!.deform.translateMasses(value, 0, 0, 0);
    continue;
  }
  // `lone=0` is not a knob either: the world never reads `lone` as true (an accessor the engine's per-slice `w.lone = race.active` cannot overwrite), so every car of a multi-slice step runs every slice: the behaviour before the lone-car cut (REPLAY 110).
  if (id === "lone") {
    if (value === 0) Object.defineProperty(sim.world, "lone", { get: () => false, set: () => undefined, configurable: true });
    continue;
  }
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
clampSites.clear();
offSites.clear();
feedBins.clear();
wakeSites.clear();
speedBins.clear();
bakeBins.clear();

/** `BENCH_CENSUS=1` (bench `--census`): the window runs step by step through the lone-car census (`census.ts`). */
const census = process.env["BENCH_CENSUS"] === "1" ? new LoneCensus(sim) : null;
const phases = sim.world.phases;
phases.on = true;
const ms0 = phases.ms.slice();
const work0 = phases.work.slice();
const loadStart = loadavg()[0]!;
const t0 = performance.now();
const clock0 = sim.t;
if (census) for (let i = 0, n = Math.round(windowS / sim.stepS); i < n; i++) census.step();
else advance(windowS);
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
const breachKinds = { clock: 0, moved: 0, off: 0 };
let worstOff = { m: 0, name: "" };
for (const car of sim.cars) {
  breaches += car.deform.frozenBreaches;
  breachKinds.clock += car.deform.breachClock;
  breachKinds.moved += car.deform.breachMoved;
  breachKinds.off += car.deform.breachOff;
  if (car.deform.breachOffMax > worstOff.m) worstOff = { m: car.deform.breachOffMax, name: car.deform.breachOffName };
}

console.log(
  `BENCH_ARM ${JSON.stringify({
    scenario: name,
    label,
    lone: info.lone,
    race: info.race ?? false,
    cars: sim.cars.length,
    knobs,
    warmS,
    windowS: simS,
    wallMsPerS: wallMs / simS,
    msPerS,
    workPerS,
    digest: hash.digest("hex"),
    poses,
    frozenBreaches: breaches,
    breachKinds,
    breachOff: worstOff,
    trace: traceDt > 0 ? { dt: traceDt, cars: sim.cars.length, masses: sim.cars.map((c) => c.deform.masses.length), rows: trace } : null,
    census: census ? census.result(simS) : null,
    thawSites: Object.fromEntries([...sites].sort((a, b) => b[1] - a[1])),
    clampSites: Object.fromEntries([...clampSites].sort((a, b) => b[1] - a[1])),
    offSites: Object.fromEntries([...offSites].sort((a, b) => b[1] - a[1]).slice(0, 12)),
    feedBins: Object.fromEntries([...feedBins].sort((a, b) => b[1] - a[1]).slice(0, 12)),
    wakeSites: Object.fromEntries([...wakeSites].sort((a, b) => b[1] - a[1]).slice(0, 10)),
    speedBins: Object.fromEntries([...speedBins].sort((a, b) => b[1] - a[1])),
    bakeBins: Object.fromEntries([...bakeBins]),
    loadStart,
    loadEnd: loadavg()[0]!,
  })}`,
);
