#!/usr/bin/env node
/**
 * The scenario bench: named, fixed scenarios (`scenarios.ts`) run as A/B arms, each arm its own process (`run-scenario.ts`), in ABBA order, behind a load gate.
 *
 *   node scripts/bench/bench.mjs list
 *   flock -x <lock> node scripts/bench/bench.mjs run <scenario>... [--arm name:knob=v,knob=v]... [--order abba|baab|both] [--warm s] [--window s] [--seed n]
 *                                                          [--max-load 2] [--force] [--thaw-sites] [--out dir]
 *
 * With no `--arm` the arms are `off` (every knob at its default) and `on` (`epi.on=1`). Any knob of the epicenter group (`epi.*`, `src/game/deform/epicenter.ts`) can go in
 * an arm: `--arm base: --arm cut:epi.on=1,epi.nearPrune=1`. Order `abba` runs the arms there and back (A B B A; with three arms A B C C B A), `baab` the reverse, `both` the two
 * one after the other (a drift across the batch lands on both arms alike). One run's load is read before it starts: above `--max-load` (default 2, the repo's timing rule)
 * the batch stops (exit 2) unless `--force`, which runs on and flags the row `LOAD`. Take the lock outside (`flock -x`): the tool never times two things at once.
 * Output: per scenario its config line, then per arm the mean of its runs per phase (ms per sim-second), per unit (us per car-slice), the work counters and the checks (digest, max pose delta of
 * the first runs, frozen share, thaws); every run's raw JSON goes to `--out` (default `.bench/scenarios/<stamp>/`, which git ignores). The numbers of an A/B are valid for the whole sim
 * only where the arms did the same work (the work counters beside them say); otherwise quote the per-unit rows. `docs/PERF_BENCH.md` has the protocol.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const PHASES = ["drive", "plan", "integrate", "wreck", "pairs", "structure", "course", "bake", "rules", "settle"];
const COUNTERS = ["slices", "liveCarSlices", "wreckCarSlices", "asleepCarSlices", "pairTests", "pairContacts", "partContacts", "nodesLoose", "nodesLocked", "frozenCarSlices", "freezes", "thaws", "crossingsSkipped"];
export const DEFAULT_ARMS = [
  { name: "off", knobs: {} },
  { name: "on", knobs: { "epi.on": 1 } },
];

/** `name:knob=v,knob=v` as an arm; throws on a malformed one. */
export function parseArm(text) {
  const [name, rest = ""] = text.split(":");
  if (!name) throw new Error(`--arm ${text}: no name before the colon`);
  const knobs = {};
  for (const pair of rest.split(",").filter(Boolean)) {
    const [id, value] = pair.split("=");
    if (!id || value === undefined || !Number.isFinite(Number(value))) throw new Error(`--arm ${text}: "${pair}" is not knob=number`);
    knobs[id] = Number(value);
  }
  return { name, knobs };
}

/** The run order of `arms`: there and back (ABBA), back and there (BAAB), or both one after the other. */
export function armSequence(arms, order) {
  const there = [...arms, ...arms.toReversed()];
  const back = [...arms.toReversed(), ...arms];
  if (order === "abba") return there;
  if (order === "baab") return back;
  if (order === "both") return [...there, ...back];
  throw new Error(`--order is abba, baab or both, not ${order}`);
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** What one scenario's runs say: per arm the mean phases, counters and per-unit costs, and the checks between the arms. `runs` are the arm processes' JSON, in run order. */
export function summarize(runs) {
  const arms = new Map();
  for (const run of runs) {
    const key = run.arm;
    if (!arms.has(key)) arms.set(key, []);
    arms.get(key).push(run);
  }
  const out = [];
  for (const [name, list] of arms) {
    const phase = Object.fromEntries(PHASES.map((p) => [p, mean(list.map((r) => r.msPerS[p]))]));
    const work = Object.fromEntries(COUNTERS.map((c) => [c, mean(list.map((r) => r.workPerS[c]))]));
    const total = PHASES.reduce((s, p) => s + phase[p], 0);
    const units = work.liveCarSlices + work.wreckCarSlices + work.asleepCarSlices;
    const perUnit = Object.fromEntries(PHASES.map((p) => [p, units > 0 ? (phase[p] * 1000) / units : 0]));
    out.push({
      name,
      runs: list.length,
      knobs: list[0].knobs,
      wall: list.map((r) => r.wallMsPerS),
      phase,
      total,
      work,
      units,
      perUnit,
      perUnitTotal: units > 0 ? (total * 1000) / units : 0,
      digest: list[0].digest,
      digestLive: list[0].digestLive ?? "",
      cars: list[0].cars,
      digestsEqual: list.every((r) => r.digest === list[0].digest),
      poses: list[0].poses,
      breaches: Math.max(...list.map((r) => r.frozenBreaches)),
      thawSites: list[0].thawSites,
      clampSites: list[0].clampSites ?? {},
      breachKinds: list[0].breachKinds ?? null,
      breachOff: list[0].breachOff ?? null,
      hubsOff: list[0].hubsOff ?? null,
      offSites: list[0].offSites ?? {},
      feedBins: list[0].feedBins ?? {},
      wakeSites: list[0].wakeSites ?? {},
      speedBins: list[0].speedBins ?? {},
      bakeBins: list[0].bakeBins ?? {},
      drawn: list[0].drawn ? { frames: mean(list.map((r) => r.drawn.frames)), ms: mean(list.map((r) => r.drawn.ms)), slices: mean(list.map((r) => r.drawn.slices)), stepMs: mean(list.map((r) => r.drawn.stepMs)), posePart: mean(list.map((r) => r.drawn.posePart)), followGlass: mean(list.map((r) => r.drawn.followGlass)) } : null,
      trace: list[0].trace ?? null,
      census: list[0].census ?? null,
      ground: groundOf(list),
      verify: verifyOf(list),
      prof: profOf(list),
      matrix: list.every((r) => r.matrix) ? matrixOf(list) : null,
      freezeRecord: list[0].freezeRecord ?? null,
      wreckTops: list.every((r) => r.wreckTops) ? Object.fromEntries(["skipped", "wouldRow", "wouldNear", "wreckTop"].map((k) => [k, list.reduce((s, r) => s + r.wreckTops[k], 0)])) : null,
      overhead: list.every((r) => r.overhead) ? { ...Object.fromEntries(["skipped", "wouldRow", "wouldNear", "wreckTop", "probed"].map((k) => [k, list.reduce((s, r) => s + r.overhead[k], 0)])), minSlack: Math.min(...list.map((r) => r.overhead.minSlack)) } : null,
      allClear: list.every((r) => r.allClear) ? Object.fromEntries(["slices", "wreckSlices", "rowSlices", "rows", "wreckRowSlices"].map((k) => [k, list.reduce((s, r) => s + r.allClear[k], 0)])) : null,
      preClear: list.every((r) => r.preClear) ? { cleared: list.reduce((s, r) => s + r.preClear.cleared, 0), minSlack: Math.min(...list.map((r) => r.preClear.minSlack)), wrong: list.reduce((s, r) => s + r.preClear.wrong, 0) } : null,
      load: { start: Math.min(...list.map((r) => r.loadStart)), startMax: Math.max(...list.map((r) => r.loadStart)), end: Math.max(...list.map((r) => r.loadEnd)) },
      flagged: list.some((r) => r.flagged),
    });
  }
  return out;
}

/** The window profiles (`--prof`) as the mean of the runs: per function self and inclusive ms per sim-second and its heaviest source lines, the most inclusive first. */
function profOf(list) {
  if (!list.every((r) => r.prof)) return null;
  const sums = new Map();
  for (const r of list) {
    for (const row of r.prof) {
      const s = sums.get(row.fn) ?? { fn: row.fn, self: 0, incl: 0, lines: new Map() };
      s.self += row.selfMsPerS / list.length;
      s.incl += row.inclMsPerS / list.length;
      for (const [line, ms] of row.lines) s.lines.set(line, (s.lines.get(line) ?? 0) + ms / list.length);
      sums.set(row.fn, s);
    }
  }
  return [...sums.values()].sort((a, b) => b.incl - a.incl);
}

/** The matrix census (`--matrix`) as per-sim-second means of the runs. */
function matrixOf(list) {
  const m = (f) => mean(list.map(f));
  return {
    depth: list[0].matrix.depth.map((_, i) => ({ calls: m((r) => r.matrix.depth[i].calls / r.windowS), repeats: m((r) => r.matrix.depth[i].repeats / r.windowS) })),
    boxCalls: m((r) => r.matrix.boxCalls / r.windowS),
    boxNodes: m((r) => r.matrix.boxNodes / r.windowS),
  };
}

/** Functions the profile table lists per arm by inclusive time, and by self time with their heaviest lines. */
const PROF_LINES = 45;
const PROF_SELF = 25;

/** The ground queries' sections (`--ground`) as the mean of the runs: per section ms and calls per sim-second, and the outermost calls the clock read twice for; `clockNs` what one of those costs the clock. */
function groundOf(list) {
  if (!list.every((r) => r.ground && r.ground.clockNs > 0)) return null;
  const names = Object.keys(list[0].ground.sections);
  return {
    clockNs: mean(list.map((r) => r.ground.clockNs)),
    sections: Object.fromEntries(names.map((n) => [n, Object.fromEntries(["msPerS", "callsPerS", "outerPerS"].map((k) => [k, mean(list.map((r) => r.ground.sections[n][k]))]))])),
    cells: Object.fromEntries(["seeks", "plain", "shared", "creased", "creasedShared", "distinct", "epochs"].map((k) => [k, list.reduce((s, r) => s + (r.ground.cells?.[k] ?? 0), 0)])),
  };
}

/** The baked-against-live check (`--verify`) summed over the runs: answers compared and mismatches per query kind, the far answers, the first mismatch. */
function verifyOf(list) {
  if (!list.every((r) => r.ground && r.ground.verify)) return null;
  const sum = (k) => list[0].ground.verify[k].map((_, i) => list.reduce((s, r) => s + r.ground.verify[k][i], 0));
  return { compared: sum("compared"), mismatches: sum("mismatches"), far: list.reduce((s, r) => s + r.ground.verify.far, 0), first: list.map((r) => r.ground.verify.first).find((t) => t !== "") ?? "" };
}

const f1 = (v) => v.toFixed(1);
const f2 = (v) => v.toFixed(2);
const f3 = (v) => v.toFixed(3);
const pct = (a, b) => (a > 0 ? `${b >= a ? "+" : ""}${f1((100 * (b - a)) / a)}%` : "");

/** A body this far off (m) or turned this far (degrees) from where the other arm has it: a difference a player watching the car may see (a judgement, printed beside the numbers, not a measured limit). */
export const VISIBLE_M = 0.02;
export const VISIBLE_DEG = 1;

/**
 * How far two arms' traces (`--trace`: per `dt` sim seconds each car's pose and every mass's world position) drift apart, and in what: per checkpoint the worst car's body position, body
 * turn and worst hull point (crush shape and place together), with the car.
 */
export function divergence(a, b) {
  const out = [];
  const { cars, masses } = a.trace;
  const offsets = [];
  let at = 1;
  for (let c = 0; c < cars; c++) {
    offsets.push(at);
    at += 10 + 3 * masses[c];
  }
  for (let k = 0; k < Math.min(a.trace.rows.length, b.trace.rows.length); k++) {
    const ra = a.trace.rows[k];
    const rb = b.trace.rows[k];
    let body = 0;
    let turn = 0;
    let hull = 0;
    let bodyCar = -1;
    let turnCar = -1;
    let hullCar = -1;
    for (let c = 0; c < cars; c++) {
      const o = offsets[c];
      const d = Math.hypot(ra[o] - rb[o], ra[o + 1] - rb[o + 1], ra[o + 2] - rb[o + 2]);
      if (d > body) {
        body = d;
        bodyCar = c;
      }
      const dot = Math.min(1, Math.abs(ra[o + 3] * rb[o + 3] + ra[o + 4] * rb[o + 4] + ra[o + 5] * rb[o + 5] + ra[o + 6] * rb[o + 6]));
      const deg = (2 * Math.acos(dot) * 180) / Math.PI;
      if (deg > turn) {
        turn = deg;
        turnCar = c;
      }
      for (let m = 0; m < masses[c]; m++) {
        const p = o + 10 + 3 * m;
        const h = Math.hypot(ra[p] - rb[p], ra[p + 1] - rb[p + 1], ra[p + 2] - rb[p + 2]);
        if (h > hull) {
          hull = h;
          hullCar = c;
        }
      }
    }
    out.push({ t: ra[0], body, bodyCar, turn, turnCar, hull, hullCar });
  }
  return out;
}

const divergenceRow = (r) => `   ${f2(r.t).padStart(7)} | ${f1(100 * r.body).padStart(6)} (${r.bodyCar}) | ${f2(r.turn).padStart(6)} (${r.turnCar}) | ${f1(100 * r.hull).padStart(6)} (${r.hullCar})`;

/** The text of `divergence`: about twelve checkpoints, the first time each measure passes the visible guide, and the worst of the run. */
export function divergenceLines(a, b) {
  const rows = divergence(a, b);
  const lines = [`   divergence ${a.name} vs ${b.name} (guide: body > ${VISIBLE_M * 100} cm, turn > ${VISIBLE_DEG} deg, hull point > ${VISIBLE_M * 100} cm): t s | body cm (car) | turn deg (car) | hull cm (car)`];
  const step = Math.max(1, Math.ceil(rows.length / 12));
  for (let k = 0; k < rows.length; k += step) lines.push(divergenceRow(rows[k]));
  if ((rows.length - 1) % step !== 0) lines.push(divergenceRow(rows[rows.length - 1]));
  const first = (key, limit) => rows.find((r) => r[key] > limit);
  const when = (r) => (r ? `${f2(r.t)} s` : "never");
  lines.push(`   first past the guide: body ${when(first("body", VISIBLE_M))}, turn ${when(first("turn", VISIBLE_DEG))}, hull ${when(first("hull", VISIBLE_M))}; worst over the run: body ${f1(100 * Math.max(...rows.map((r) => r.body)))} cm, turn ${f2(Math.max(...rows.map((r) => r.turn)))} deg, hull ${f1(100 * Math.max(...rows.map((r) => r.hull)))} cm`);
  return lines;
}

/** The text of a summary: one block per scenario. `first` is the scenario's config (`about`, `sizes`, `lone`, `label`). */
export function table(name, first, arms) {
  const lines = [`== ${name}: ${first.about}`, `   sizes: ${first.sizes}`, `   step schedule: ${first.race ? "race (1/80 s steps, cut to 1/240 s slices in contact)" : "fine (1/240 s, one slice a step: the lone-car cut has nothing to skip)"}; lone-car cut ${first.lone ? "ON" : "off"} (World.lone: on in a race, off in the Fleet); ${first.label}; window ${f1(first.windowS)} s after ${first.warmS} s warm-up`];
  const w = Math.max(...arms.map((a) => a.name.length), 6);
  const head = ["", ...arms.map((a) => a.name.padStart(Math.max(9, w)))];
  if (arms.length === 2) head.push("change".padStart(8));
  const row = (label, vals, change = true) => {
    const cells = vals.map((v) => v.padStart(Math.max(9, w)));
    const tail = change && arms.length === 2 ? [pct(Number(vals[0]), Number(vals[1])).padStart(8)] : [];
    return `   ${label.padEnd(36)}${cells.join(" ")}${tail.length ? " " + tail[0] : ""}`;
  };
  lines.push(`   ${"".padEnd(36)}${head.slice(1).join(" ")}`);
  lines.push(row("runs", arms.map((a) => String(a.runs)), false));
  lines.push(row("load at start (min..max)", arms.map((a) => `${f1(a.load.start)}..${f1(a.load.startMax)}`), false));
  lines.push(row("load at end (max)", arms.map((a) => f1(a.load.end)), false));
  lines.push(row("ms/sim-s, wall (runs)", arms.map((a) => f1(mean(a.wall))), true));
  lines.push(row("ms/sim-s, phases total", arms.map((a) => f1(a.total))));
  for (const p of PHASES) if (arms.some((a) => a.phase[p] >= 0.05)) lines.push(row(`  ${p}`, arms.map((a) => f2(a.phase[p]))));
  lines.push(row("us per car-slice, all (live+wreck+asleep)", arms.map((a) => f2(a.perUnitTotal))));
  for (const p of PHASES) if (arms.some((a) => a.perUnit[p] >= 0.05)) lines.push(row(`  ${p}`, arms.map((a) => f2(a.perUnit[p]))));
  for (const c of COUNTERS) if (arms.some((a) => a.work[c] > 0)) lines.push(row(`${c}/s`, arms.map((a) => String(Math.round(a.work[c])))));
  lines.push(row("car-slices per car per sim-s", arms.map((a) => f1(a.units / a.cars)), false));
  const wreck = arms.map((a) => a.work.wreckCarSlices + a.work.asleepCarSlices);
  lines.push(row("frozen / (wreck+asleep) slices", arms.map((a, i) => (wreck[i] > 0 ? f2(a.work.frozenCarSlices / wreck[i]) : "-")), false));
  lines.push(row("frozen-state breaches", arms.map((a) => String(a.breaches)), false));
  if (arms.some((a) => a.hubsOff)) {
    lines.push(row("frozen wrecks' hubs off their frame, worst (m)", arms.map((a) => (a.hubsOff ? f2(a.hubsOff.worst) : "-")), false));
    for (const a of arms) if (a.hubsOff && a.hubsOff.over > 0) lines.push(`   FLAG: ${a.name}: ${a.hubsOff.over} of ${a.hubsOff.checks} hub checks of a frozen wreck found a hub more than 0.5 m off its place in the car frame (the drawn wheel sits there): the freeze froze a wreck with its hubs off the frame`);
  }
  if (arms.every((a) => a.ground)) {
    lines.push(`   ground queries (calls per car-slice for every query; us per car-slice and share of the phases' total for the timed sections: inclusive, a query inside another counts for the outer one only, net of the clock's own ${arms.map((a) => f1(a.ground.clockNs)).join("/")} ns per timed call; the clock inflates every phase: read shares, never the phases' ms)`);
    for (const n of Object.keys(arms[0].ground.sections)) {
      if (!arms.some((a) => a.ground.sections[n].callsPerS > 0)) continue;
      lines.push(row(`  ${n}: calls per car-slice`, arms.map((a) => f1(a.units > 0 ? a.ground.sections[n].callsPerS / a.units : 0)), false));
      if (!arms.some((a) => a.ground.sections[n].outerPerS > 0)) continue;
      const net = (a) => (a.units > 0 ? ((a.ground.sections[n].msPerS - (a.ground.sections[n].outerPerS * a.ground.clockNs) / 1e6) * 1000) / a.units : 0);
      lines.push(row(`    us per car-slice`, arms.map((a) => f2(net(a)))));
      lines.push(row(`    share of the phases' total`, arms.map((a) => `${f1((100 * net(a) * a.units) / 1000 / a.total)}%`), false));
    }
    for (const a of arms) {
      const c = a.ground.cells;
      if (!c || c.seeks === 0) continue;
      const p = (x, of) => (of > 0 ? `${f1((100 * x) / of)}%` : "-");
      lines.push(`   cell sharing, ${a.name} (seeks inside a car's rigid step: ${f1(c.seeks / c.epochs)} per step; plain cell ${p(c.plain, c.seeks)} of seeks, creased ${p(c.creased, c.seeks)}; seeks on a cell an earlier seek of the same car-step already read: ${p(c.shared, c.seeks)} of all seeks (${p(c.creasedShared, c.seeks)} on the crease); distinct cells ${f1(c.distinct / c.epochs)} per step)`);
    }
  }
  for (const a of arms) {
    if (!a.verify) continue;
    const [all, held, near, wheel] = a.verify.compared;
    const bad = a.verify.mismatches.reduce((s, v) => s + v, 0);
    lines.push(`   baked-vs-live check, ${a.name}: answers compared bit for bit: point ${all} + held ${held} + near ${near}, wheel contacts ${wheel}, of the point ones ${a.verify.far} far answers (C_H, C_OWNER, C_ARG and the travel proof only); MISMATCHES ${bad}${bad > 0 ? `: ${a.verify.first}` : ""}`);
  }
  for (const a of arms) {
    if (!a.matrix) continue;
    const per = (x) => (a.units > 0 ? f1(x / a.units) : "-");
    const names = ["scene", "car group", "depth 2", "depth 3+"];
    lines.push(`   three.js matrix census, ${a.name} (composes per car-slice, of which repeats: the node's position, quaternion and scale are the bits of its last compose, so the compose is dedupable exactly): ${a.matrix.depth.map((d, i) => `${names[i]} ${per(d.calls)} (${per(d.repeats)} repeats)`).join("; ")}; total ${per(a.matrix.depth.reduce((s, d) => s + d.calls, 0))} (${per(a.matrix.depth.reduce((s, d) => s + d.repeats, 0))} repeats); Box3.expandByObject calls ${per(a.matrix.boxCalls)} walking ${per(a.matrix.boxNodes)} nodes`);
  }
  for (const a of arms) {
    if (!a.prof) continue;
    lines.push(`   window CPU profile, ${a.name} (ms per sim-s, the sampler on: inclusive / self; the phases' total ${f1(a.total)}):`);
    for (const r of a.prof.slice(0, PROF_LINES)) lines.push(`     ${f2(r.incl).padStart(8)} / ${f2(r.self).padStart(7)}  ${r.fn}`);
    lines.push(`   window CPU profile by self time, ${a.name} (self ms per sim-s; the function's heaviest lines: line ms):`);
    for (const r of a.prof.toSorted((x, y) => y.self - x.self).slice(0, PROF_SELF)) lines.push(`     ${f2(r.self).padStart(7)}  ${r.fn}   ${[...r.lines].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([l, m]) => `${l}:${f2(m)}`).join(" ")}`);
  }
  lines.push(row("digest (first run)", arms.map((a) => a.digest.slice(0, 8)), false));
  lines.push(row("digest same in every run", arms.map((a) => (a.digestsEqual ? "yes" : "NO")), false));
  lines.push(row("digest of the cars not put away", arms.map((a) => a.digestLive.slice(0, 8)), false));
  if (arms.length >= 2 && arms[0].poses.length === arms[1].poses.length) {
    let delta = 0;
    for (let i = 0; i < arms[0].poses.length; i++) delta = Math.max(delta, Math.abs(arms[0].poses[i] - arms[1].poses[i]));
    lines.push(`   max |pose or velocity difference|, ${arms[0].name} vs ${arms[1].name} first runs: ${delta.toExponential(2)}${arms[0].digest === arms[1].digest ? " (digests equal: bit-identical arms)" : ""}`);
  }
  for (const a of arms) if (a.breachKinds && a.breaches > 0) lines.push(`   frozen-state breaches by kind, ${a.name}: contact clock restarted ${a.breachKinds.clock}, a mass's frame place moved ${a.breachKinds.moved}, a mass off its frame ${a.breachKinds.off}${a.breachOff && a.breachOff.m > 0 ? ` (worst: ${a.breachOff.name} ${f1(a.breachOff.m * 1000)} mm)` : ""}`);
  for (const a of arms) if (Object.keys(a.thawSites).length) lines.push(`   thaws per sim-s by call site, ${a.name}: ${Object.entries(a.thawSites).map(([k, v]) => `${k} ${f1(v / first.windowS)}`).join(", ")}`);
  for (const a of arms) if (a.clampSites && Object.keys(a.clampSites).length) lines.push(`   re-measures (syncPose) of a cached frozen car per sim-s by caller (the freeze's invariant: none), ${a.name}: ${Object.entries(a.clampSites).map(([k, v]) => `${k} ${f1(v / first.windowS)}`).join(", ")}`);
  for (const a of arms) if (a.offSites && Object.keys(a.offSites).length) lines.push(`   frozen steps with a mass off its frame, ${a.name} (count in the window): ${Object.entries(a.offSites).map(([k, v]) => `[${k}] ${v}`).join("; ")}`);
  for (const a of arms) if (a.feedBins && Object.keys(a.feedBins).length) lines.push(`   feedOverlap calls into a frozen car per sim-s by closing speed and overlap, ${a.name}: ${Object.entries(a.feedBins).map(([k, v]) => `[${k}] ${f1(v / first.windowS)}`).join("; ")}`);
  for (const a of arms) if (a.wakeSites && Object.keys(a.wakeSites).length) lines.push(`   wake / rest-timer resets of crashed cars per sim-s by caller, ${a.name}: ${Object.entries(a.wakeSites).map(([k, v]) => `${k} ${f1(v / first.windowS)}`).join("; ")}`);
  for (const a of arms) if (a.speedBins && Object.keys(a.speedBins).length) lines.push(`   rigid steps of awake wrecks per sim-s by speed (|v| + |w|), ${a.name}: ${Object.entries(a.speedBins).map(([k, v]) => `[${k}] ${f1(v / first.windowS)}`).join("; ")}`);
  for (const a of arms) if (a.bakeBins && Object.keys(a.bakeBins).length) lines.push(`   bakeBetweenSlices by car state, ${a.name} (calls per sim-s, ms per sim-s, us per call; the timer adds its own cost): ${Object.entries(a.bakeBins).map(([k, v]) => `${k} ${f1(v.n / first.windowS)} calls, ${f2(v.ms / first.windowS)} ms, ${f2((1000 * v.ms) / Math.max(1, v.n))} us`).join("; ")}`);
  if (arms.some((a) => a.drawn)) {
    lines.push(row("drawn frames/s", arms.map((a) => (a.drawn ? f1(a.drawn.frames / first.windowS) : ""))));
    lines.push(row("posePart calls per drawn frame", arms.map((a) => (a.drawn ? f2(a.drawn.posePart / Math.max(1, a.drawn.frames)) : ""))));
    lines.push(row("followGlass calls per drawn frame", arms.map((a) => (a.drawn ? f2(a.drawn.followGlass / Math.max(1, a.drawn.frames)) : ""))));
    lines.push(row("us per drawn frame (updateSkin of every car + blend present + restore)", arms.map((a) => (a.drawn ? f2((1000 * a.drawn.ms) / Math.max(1, a.drawn.frames)) : ""))));
    lines.push(row("us per slice (PoseBlend begin + end)", arms.map((a) => (a.drawn ? f2((1000 * a.drawn.stepMs) / Math.max(1, a.drawn.slices)) : ""))));
  }
  for (const a of arms) {
    const w = a.wreckTops;
    if (!w) continue;
    lines.push(`   wreckTops check, ${a.name} (summed over runs): points skipped ${w.skipped}; of those the old path would have made a contact row ${w.wouldRow} (DISAGREEMENTS: must be 0), answered a wreck's top (dropped) ${w.wreckTop}, set nearing ${w.wouldNear} (only \`hardTouch\`, which nothing of a wreck reads: the slice log says whether anything physical followed)`);
  }
  for (const a of arms) {
    const w = a.overhead;
    if (!w) continue;
    lines.push(`   hill bound check, ${a.name} (summed over runs): cage points only the tighter hill bound cleared (the bound before it, every hill's whole height, was not under them) ${w.skipped}; of those the old path would have made a contact row ${w.wouldRow} (DISAGREEMENTS: must be 0), set nearing ${w.wouldNear} (must be 0), answered a wreck's top (dropped, as the old path) ${w.wreckTop}; the static bound over a point's box less the ground's height at the point, least over ${w.probed} probed points: ${w.minSlack.toExponential(2)} m (must be >= 0)`);
  }
  for (const a of arms) {
    const c = a.allClear;
    if (!c) continue;
    lines.push(`   whole-body gate check, ${a.name} (summed over runs): slices where allClear skipped every point ${c.slices} (wrecks ${c.wreckSlices}); reading the points anyway made contact rows in ${c.rowSlices} of them (wrecks ${c.wreckRowSlices}), ${c.rows} rows in all`);
  }
  for (const a of arms) {
    const p = a.preClear;
    if (!p || p.cleared === 0) continue;
    lines.push(`   preClear check, ${a.name}: points cleared from the axes ${p.cleared}; least margin of the point's own low over the cheap bound ${(p.minSlack * 1e6).toFixed(3)} um (CLEAR_ROUND, 1 um, is in it: must be >= 0); points the point's own test would not have cleared (must be 0): ${p.wrong}`);
  }
  for (const a of arms) {
    const r = a.freezeRecord;
    if (!r) continue;
    const share = (v) => `${f1((100 * v) / Math.max(1, r.slices))}%`;
    lines.push(`   freeze recorder, ${a.name} (first run): ${r.slices} car-slices; ${Object.entries(r.byState).map(([k, v]) => `${k} ${share(v.slices)} at ${f2(v.usPerSlice)} us (incl. the timer)`).join("; ")}`);
    lines.push(`   thaws by cause (count; mean integrate rows at the thaw), ${a.name}: ${Object.entries(r.thawsByCause).map(([k, v]) => `${k} ${v} (${f1(r.contactsAtThaw[k])} rows)`).join("; ")}`);
    lines.push(`   how long a car stayed frozen before each thaw, slices of 1/240 s [${r.binLabels.join(" | ")}], ${a.name}:`);
    for (const [k, h] of Object.entries(r.frozenHoldBySecondsBins)) lines.push(`      ${k.padEnd(16)} ${r.binLabels.map((l) => String(h[l]).padStart(5)).join(" ")}`);
    lines.push(`   how long a thawed car ran whole before it froze again, ${a.name}: ${r.binLabels.map((l) => `${l}: ${r.refreezeGapBins[l]}`).join("  ")}`);
    lines.push(`   cars with the most thaws, ${a.name}: ${[...r.cars].sort((x, y) => y.thaws - x.thaws).slice(0, 6).map((c) => `slot ${c.slot}: ${c.thaws} thaws, ${c.freezes} freezes, ${f1(100 * c.frozenShare)}% frozen`).join("; ")}`);
    for (const t of r.timelines.slice(0, 2)) lines.push(`   slot ${t.slot} timeline (. whole, F frozen cached, R frozen re-cache slice, - not a wreck; state x slices): ${t.runs.slice(0, 60).map(([s, n]) => `${s === "wreck whole" ? "." : s === "wreck frozen (cached)" ? "F" : s === "wreck frozen (re-cache slice)" ? "R" : "-"}${n}`).join(" ")}`);
  }
  for (const a of arms) {
    const c = a.census;
    if (!c) continue;
    const pct = (v) => (c.carStepsPerS > 0 ? `${f1((100 * v) / c.carStepsPerS)}%` : "-");
    lines.push(
      `   lone-car census, ${a.name} (per sim-s; hull gap = separating-axis gap of the car boxes less the pair's relative travel over the step, closing within ${c.closeM} m): steps ${f1(c.stepsPerS)}, of which one slice ${f1(c.singleSliceStepsPerS)} (${f1(c.quietCollapsesPerS)} cut steps collapsed to the quiet step: every car lone); in the multi-slice steps car-steps ${Math.round(c.carStepsPerS)}: lone ${Math.round(c.loneCarStepsPerS)} (${pct(c.loneCarStepsPerS)}), near-and-not-lone ${Math.round(c.nearCarStepsPerS)} (${pct(c.nearCarStepsPerS)}) = closing ${Math.round(c.closingPerS)} + not closing ${Math.round(c.notClosingPerS)} (${pct(c.notClosingPerS)}, of which ${Math.round(c.nearNotLoneIneligiblePerS)} are cars the hull test cannot describe: wreck, in the air, door ajar, part off, leaning, asleep); not-closing steps followed by a hull gap under ${c.closeM} m and a contact: ${f1(c.notClosingThenContactPerS)}/s; slices ${f1(c.slicesPerS)}/s, fineCuts ${f1(c.fineCutsPerS)}/s`,
    );
    lines.push(
      `   lone/sliced flips, ${a.name}: ${f2(c.flipsPerCarPerS)} per car per sim-s, of which flickers (a change within 4 steps of the last) ${f2(c.flickersPerCarPerS)}; pair overlap (cage outlines, end of each step), all: ${f1(c.cageOverlapPairStepsPerS)} pair-steps/s, deepest ${f3(c.cageOverlapMaxM)} m, p95 ${f3(c.cageOverlapP95M)} m; with a lone car: ${f1(c.overlapLoneStepsPerS)}/s, deepest ${f3(c.overlapLoneMaxM)} m; between two intact cars: ${f1(c.overlapIntactStepsPerS)}/s, deepest ${f3(c.overlapIntactMaxM)} m, p95 ${f3(c.overlapIntactP95M)} m`,
    );
    lines.push(
      `   first contacts (a pair clear at a step's start, overlapping at its end), ${a.name}: ${f2(c.firstContactsPerS)}/s, depth deepest ${f3(c.firstContactMaxM)} m, p95 ${f3(c.firstContactP95M)} m; with a lone car: ${f2(c.firstContactLonePerS)}/s, deepest ${f3(c.firstContactLoneMaxM)} m; between two intact cars: ${f2(c.firstContactIntactPerS)}/s, deepest ${f3(c.firstContactIntactMaxM)} m, p95 ${f3(c.firstContactIntactP95M)} m`,
    );
    lines.push(`   car-box overlap at the end of a step, ${a.name} (box-vs-box minimum translation, a lower bound for deformed wrecks; per sim-s): pair-steps over 5 cm ${f1(c.overlapPairStepsPerS)}, over 30 cm ${f1(c.deepOverlapPairStepsPerS)}, deepest ${f2(c.maxOverlapM)} m`);
    lines.push(`   overlap over 5 cm by pair class, ${a.name} (pair-steps over 5 cm per sim-s / over 30 cm / deepest m): ${Object.entries(c.overlapBy ?? {}).map(([k, v]) => `${k} ${f1(v.overPerS)} / ${f1(v.deepPerS)} / ${f2(v.maxM)}`).join("; ") || "none"}; over 30 cm by relative speed: ${Object.entries(c.deepBySpeed ?? {}).map(([k, v]) => `${k} ${f1(v)}`).join("; ") || "none"}`);
  }
  if (arms.some((a) => a.flagged)) lines.push("   LOAD: a run started above the load limit (--force): the ms are not timing");
  for (const other of arms.slice(1)) if (arms[0].trace && other.trace) lines.push(...divergenceLines(arms[0], other));
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = { arms: [], order: "abba", maxLoad: 2, force: false, thawSites: false, scenarios: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--arm") args.arms.push(parseArm(argv[++i]));
    else if (a === "--order") args.order = argv[++i];
    else if (a === "--warm") args.warm = argv[++i];
    else if (a === "--window") args.window = argv[++i];
    else if (a === "--seed") args.seed = argv[++i];
    else if (a === "--max-load") args.maxLoad = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--force") args.force = true;
    else if (a === "--thaw-sites") args.thawSites = true;
    else if (a === "--census") args.census = true;
    else if (a === "--ground") args.ground = true;
    else if (a === "--verify") args.verify = true;
    else if (a === "--prof") args.prof = true;
    else if (a === "--matrix") args.matrix = true;
    else if (a === "--record") args.record = true;
    else if (a === "--slices") args.slices = true;
    else if (a === "--trace") args.trace = argv[++i];
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else args.scenarios.push(a);
  }
  if (!args.arms.length) args.arms = DEFAULT_ARMS;
  return args;
}

function child(env) {
  const r = spawnSync("node", ["--disable-warning=ExperimentalWarning", `--import=${path.join(ROOT, "scripts/test-setup.mjs")}`, path.join(HERE, "run-scenario.ts")], { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 1 << 28 });
  const line = r.stdout.split("\n").find((l) => l.startsWith("BENCH_ARM "));
  if (!line) throw new Error(`the arm process printed no result (exit ${r.status}):\n${r.stderr.slice(-2000)}${r.stdout.slice(-500)}`);
  return JSON.parse(line.slice("BENCH_ARM ".length));
}

/**
 * `--slices`: the first run of every arm logged each car's rigid step (`slice-log.ts`); the first arm's log is compared with each other arm's: the first slice that differs in anything physical
 * (contact rows, velocity, spin, pose) or none (the arms did the same physics, to the bit, for the whole run, warm-up included; `hardTouch` alone is counted apart).
 */
async function sliceComparison(name, runs, out) {
  const { compareSlices } = await import("./slice-log.ts");
  const firsts = new Map();
  for (const r of runs) if (!firsts.has(r.arm)) firsts.set(r.arm, r);
  const read = (r) => {
    const buf = readFileSync(path.join(out, `${name}-${r.n}-${r.arm}.slices`));
    return new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
  };
  const [base, ...others] = [...firsts.values()];
  const lines = [];
  for (const o of others) {
    const c = compareSlices(read(base), read(o));
    lines.push(`   slice-by-slice, ${base.arm} vs ${o.arm}: ${c.records[0]} / ${c.records[1]} car-slices logged; ${c.first < 0 ? `IDENTICAL in every physical field (hardTouch alone differs in ${c.hardOnly})` : `FIRST DIFFERENCE at record ${c.first}: ${c.fields.join(", ")} (hardTouch alone differed before it in ${c.hardOnly})`}`);
  }
  return lines.join("\n");
}

/** List the scenarios, or run `scenarios` as A/B arms. Returns the exit code. */
export async function main(argv, log = console.log) {
  const [command, ...rest] = argv;
  const { SCENARIO_INFO: SCENARIOS } = await import("./scenario-info.ts");
  if (command === "list") {
    for (const [name, s] of Object.entries(SCENARIOS)) log(`${name}\n   ${s.about}\n   sizes: ${s.sizes}\n   lone ${s.lone ? "on" : "off"}, warm ${s.warmS} s, window ${s.windowS} s`);
    return 0;
  }
  if (command !== "run") throw new Error("usage: bench.mjs list | run <scenario>... [--arm name:knob=v,...]... [--order abba|baab|both] [--warm s] [--window s] [--max-load 2] [--force] [--thaw-sites] [--trace dt] [--census] [--ground] [--prof] [--verify] [--out dir]");
  const args = parseArgs(rest);
  if (!args.scenarios.length) throw new Error(`run which scenario? ${Object.keys(SCENARIOS).join(", ")}`);
  const sequence = armSequence(args.arms, args.order);
  const out = args.out ?? path.join(ROOT, ".bench/scenarios", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(out, { recursive: true });
  for (const name of args.scenarios) {
    if (!SCENARIOS[name]) throw new Error(`${name}: not a scenario (${Object.keys(SCENARIOS).join(", ")})`);
    const runs = [];
    for (const [n, arm] of sequence.entries()) {
      const load = loadavg()[0];
      const flagged = load > args.maxLoad;
      if (flagged && !args.force) {
        log(`load ${f2(load)} is above ${args.maxLoad}: not timing (run later, or --force to run and flag it)`);
        return 2;
      }
      const env = { BENCH_SCENARIO: name, BENCH_KNOBS: JSON.stringify(arm.knobs) };
      if (args.warm) env.BENCH_WARM = args.warm;
      if (args.window) env.BENCH_WINDOW = args.window;
      if (args.seed) env.BENCH_SEED = args.seed;
      if (args.thawSites) env.BENCH_THAW_SITES = "1";
      if (args.trace) env.BENCH_TRACE = args.trace;
      if (args.census) env.BENCH_CENSUS = "1";
      if (args.ground) env.BENCH_GROUND = "1";
      if (args.verify) env.BENCH_VERIFY = "1";
      if (args.prof) env.BENCH_PROF = "1";
      if (args.matrix) env.BENCH_MATRIX = "1";
      if (args.record) env.BENCH_RECORD = "1";
      if (args.slices) env.BENCH_SLICES = path.join(out, `${name}-${n + 1}-${arm.name}.slices`);
      const run = { ...child(env), arm: arm.name, flagged, n: n + 1 };
      writeFileSync(path.join(out, `${name}-${n + 1}-${arm.name}.json`), JSON.stringify(run));
      runs.push(run);
    }
    const summary = summarize(runs);
    const sc = SCENARIOS[name];
    let text = table(name, { about: sc.about, sizes: sc.sizes, lone: runs[0].lone, race: runs[0].race, label: runs[0].label, windowS: runs[0].windowS, warmS: runs[0].warmS }, summary);
    if (args.slices) text += `\n${await sliceComparison(name, runs, out)}`;
    writeFileSync(path.join(out, `${name}.txt`), `${text}\n`);
    log(text);
  }
  log(`raw runs in ${out}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
