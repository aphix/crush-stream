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
import { GQ, GQ_NAMES, gqEnter, gqLeave } from "../../src/game/world/ground-clock.ts";
import { BAKE } from "../../src/game/world/surfaces.ts";
import { startProfile, stopProfile } from "./prof.ts";
import { SCENARIO_INFO } from "./scenario-info.ts";
import { SCENARIOS } from "./scenarios.ts";
import { LoneCensus } from "./census.ts";
import { FreezeRecorder } from "./freeze-record.ts";
import { recordSlices } from "./slice-log.ts";

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
      if (v < 0.16) {
        // The gates of `restOrSleep` for a wreck slow enough to sleep: contacts (>= 3), not crushing, and how long its timer has run (it sleeps at WRECK_REST_S).
        const rest = `REST candidate: contacts ${this.contacts}, ${this.deform.crushing ? "crushing" : "not crushing"}, restS ${this.restS === 0 ? "0" : this.restS < 0.25 ? "under 0.25 s" : this.restS < 0.5 ? "under 0.5 s" : "0.5 s and over"}`;
        speedBins.set(rest, (speedBins.get(rest) ?? 0) + 1);
      }
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

// How often the drawn frames pose a part and follow the glass (`present` rows: a still wreck should pose nothing once `presentSkip` has seen nothing change).
const drawCalls = { posePart: 0, followGlass: 0 };
for (const method of ["posePart", "followGlass"] as const) {
  const proto = DeformableCar.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const real = proto[method]!;
  proto[method] = function (this: DeformableCar, ...args: unknown[]): unknown {
    drawCalls[method]++;
    return real.apply(this, args);
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
  // `bake=0` is not a knob either: the ground bake off (`surfaces.ts` `BAKE`), every query on the layered path the bake replaces; the bake is exact, so the arms' digests must be equal.
  if (id === "bake") {
    BAKE.on = value !== 0;
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
/**
 * `BENCH_VERIFY=1` (bench `--verify`): from the first step of the warm-up every point query and wheel contact is answered twice, by the baked path and by the layered path the bake replaces, and compared bit for bit
 * (`world/ground-clock.ts` `GQ.check`): the counts and the first mismatch go in the result. A run for the proof, never for the ms.
 */
const verify = process.env["BENCH_VERIFY"] === "1";
GQ.on = verify;
GQ.check = verify;
/** `BENCH_SLICES=<file>` (bench `--slices`): every car's rigid step is logged (`slice-log.ts`) from the first step of the warm-up, for the slice-by-slice comparison of two arms. */
if (process.env["BENCH_SLICES"]) recordSlices(process.env["BENCH_SLICES"]);
advance(warmS);
sites.clear();
clampSites.clear();
offSites.clear();
feedBins.clear();
wakeSites.clear();
speedBins.clear();
bakeBins.clear();
drawCalls.posePart = 0;
drawCalls.followGlass = 0;
if (sim.drawn) {
  sim.drawn.frames = 0;
  sim.drawn.ms = 0;
  sim.drawn.slices = 0;
  sim.drawn.stepMs = 0;
}

/** `BENCH_CENSUS=1` (bench `--census`): the window runs step by step through the lone-car census (`census.ts`). */
const census = process.env["BENCH_CENSUS"] === "1" ? new LoneCensus(sim) : null;

/**
 * `BENCH_GROUND=1` (bench `--ground`): the window runs with the ground queries' section clock on (`world/ground-clock.ts`), which costs two clock reads per outermost query: a run for the
 * share of each query, never for the ms of the phases. What one outermost timed query costs the clock itself (ns) is measured first, so the table can subtract it.
 */
const groundOn = process.env["BENCH_GROUND"] === "1";
const CALIBRATE = 2_000_000;
const cal0 = performance.now();
if (groundOn) for (let i = 0; i < CALIBRATE; i++) gqLeave(0, gqEnter(0));
const clockNs = groundOn ? ((performance.now() - cal0) * 1e6) / CALIBRATE : 0;
GQ.ms.fill(0);
GQ.outer.fill(0);
GQ.depth = 0;
GQ.calls.fill(0);
GQ.on = groundOn || verify;
/** `BENCH_RECORD=1` (bench `--record`): the freeze/thaw recorder (`freeze-record.ts`), armed as the window starts. */
const recorder = process.env["BENCH_RECORD"] === "1" ? new FreezeRecorder(sim) : null;
recorder?.start();
const phases = sim.world.phases;
phases.on = true;
const ms0 = phases.ms.slice();
const work0 = phases.work.slice();
const loadStart = loadavg()[0]!;
const profiler = process.env["BENCH_PROF"] === "1" ? startProfile() : null;
const t0 = performance.now();
const clock0 = sim.t;
if (census) for (let i = 0, n = Math.round(windowS / sim.stepS); i < n; i++) census.step();
else if (process.env["BENCH_SECONDS"] === "1") {
  // Each sim second of the window on its own (wall ms, the phase clock's ms, freezes and thaws): a start that is slow and then settles shows as a row that falls, and a JIT or deopt storm as one that spikes.
  const fz = WORK_NAMES.indexOf("freezes");
  const th = WORK_NAMES.indexOf("thaws");
  const seconds: string[] = [];
  for (let s = 0; s < windowS; s++) {
    const w0 = performance.now();
    const p0 = phases.ms.slice();
    const k0 = [phases.work[fz]!, phases.work[th]!];
    advance(1);
    const row = PHASE_NAMES.map((n, i) => `${n} ${(phases.ms[i]! - p0[i]!).toFixed(0)}`).join(" ");
    seconds.push(`second ${s + 1}: wall ${(performance.now() - w0).toFixed(0)} ms | ${row} | freezes ${phases.work[fz]! - k0[0]!} thaws ${phases.work[th]! - k0[1]!}`);
  }
  console.log(`BENCH_SECONDS\n${seconds.join("\n")}`);
} else advance(windowS);
const wallMs = performance.now() - t0;
const simS = sim.t - clock0;
const profAll = profiler === null ? null : stopProfile(profiler, simS);
/** The rows the bench keeps of a profile: the most inclusive and the heaviest by self time (their union), the rest is the long tail. */
const prof = profAll === null ? null : [...new Set([...profAll.slice(0, 80), ...profAll.toSorted((a, b) => b.selfMsPerS - a.selfMsPerS).slice(0, 40)])];
phases.on = false;
GQ.on = false;

const msPerS: Record<string, number> = {};
for (const [i, n] of PHASE_NAMES.entries()) msPerS[n] = (phases.ms[i]! - ms0[i]!) / simS;
const workPerS: Record<string, number> = {};
for (const [i, n] of WORK_NAMES.entries()) workPerS[n] = (phases.work[i]! - work0[i]!) / simS;
const ground = {
  clockNs,
  sections: Object.fromEntries(GQ_NAMES.map((n, i) => [n, { msPerS: GQ.ms[i]! / simS, callsPerS: GQ.calls[i]! / simS, outerPerS: GQ.outer[i]! / simS }])),
  verify: verify ? { compared: [...GQ.verify.compared], mismatches: [...GQ.verify.mismatches], far: GQ.verify.far, first: GQ.verify.first } : null,
};

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
    ground,
    prof,
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
    freezeRecord: recorder ? recorder.result() : null,
    wreckTops: verify ? { ...GQ.wreckTops } : null,
    allClear: verify ? { ...GQ.allClear } : null,
    preClear: verify ? { ...GQ.preClear } : null,
    thawSites: Object.fromEntries([...sites].sort((a, b) => b[1] - a[1])),
    clampSites: Object.fromEntries([...clampSites].sort((a, b) => b[1] - a[1])),
    offSites: Object.fromEntries([...offSites].sort((a, b) => b[1] - a[1]).slice(0, 12)),
    feedBins: Object.fromEntries([...feedBins].sort((a, b) => b[1] - a[1]).slice(0, 12)),
    wakeSites: Object.fromEntries([...wakeSites].sort((a, b) => b[1] - a[1]).slice(0, 10)),
    speedBins: Object.fromEntries([...speedBins].sort((a, b) => b[1] - a[1])),
    bakeBins: Object.fromEntries([...bakeBins]),
    drawn: sim.drawn ? { frames: sim.drawn.frames, ms: sim.drawn.ms, slices: sim.drawn.slices, stepMs: sim.drawn.stepMs, posePart: drawCalls.posePart, followGlass: drawCalls.followGlass } : null,
    loadStart,
    loadEnd: loadavg()[0]!,
  })}`,
);
