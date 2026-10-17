#!/usr/bin/env node
/**
 * The scenario bench: named, fixed scenarios (`scenarios.ts`) run as A/B arms, each arm its own process (`run-scenario.ts`), in ABBA order, behind a load gate.
 *
 *   node scripts/bench/bench.mjs list
 *   flock -x <lock> node scripts/bench/bench.mjs run <scenario>... [--arm name:knob=v,knob=v]... [--order abba|baab|both] [--warm s] [--window s]
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
import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const PHASES = ["drive", "plan", "integrate", "wreck", "pairs", "structure", "course", "bake", "rules", "settle"];
const COUNTERS = ["slices", "liveCarSlices", "wreckCarSlices", "asleepCarSlices", "pairTests", "pairContacts", "partContacts", "nodesLoose", "nodesLocked", "frozenCarSlices", "freezes", "thaws"];
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
      digestsEqual: list.every((r) => r.digest === list[0].digest),
      poses: list[0].poses,
      breaches: Math.max(...list.map((r) => r.frozenBreaches)),
      thawSites: list[0].thawSites,
      trace: list[0].trace ?? null,
      load: { start: Math.min(...list.map((r) => r.loadStart)), startMax: Math.max(...list.map((r) => r.loadStart)), end: Math.max(...list.map((r) => r.loadEnd)) },
      flagged: list.some((r) => r.flagged),
    });
  }
  return out;
}

const f1 = (v) => v.toFixed(1);
const f2 = (v) => v.toFixed(2);
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
  const lines = [`== ${name}: ${first.about}`, `   sizes: ${first.sizes}`, `   lone-car schedule ${first.lone ? "ON (the race's: World.lone)" : "off (the Fleet's)"}; ${first.label}; window ${f1(first.windowS)} s after ${first.warmS} s warm-up`];
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
  const wreck = arms.map((a) => a.work.wreckCarSlices + a.work.asleepCarSlices);
  lines.push(row("frozen / (wreck+asleep) slices", arms.map((a, i) => (wreck[i] > 0 ? f2(a.work.frozenCarSlices / wreck[i]) : "-")), false));
  lines.push(row("frozen-state breaches", arms.map((a) => String(a.breaches)), false));
  lines.push(row("digest (first run)", arms.map((a) => a.digest.slice(0, 8)), false));
  lines.push(row("digest same in every run", arms.map((a) => (a.digestsEqual ? "yes" : "NO")), false));
  if (arms.length >= 2 && arms[0].poses.length === arms[1].poses.length) {
    let delta = 0;
    for (let i = 0; i < arms[0].poses.length; i++) delta = Math.max(delta, Math.abs(arms[0].poses[i] - arms[1].poses[i]));
    lines.push(`   max |pose or velocity difference|, ${arms[0].name} vs ${arms[1].name} first runs: ${delta.toExponential(2)}${arms[0].digest === arms[1].digest ? " (digests equal: bit-identical arms)" : ""}`);
  }
  for (const a of arms) if (Object.keys(a.thawSites).length) lines.push(`   thaw call sites, ${a.name}: ${Object.entries(a.thawSites).map(([k, v]) => `${k} ${v}`).join(", ")}`);
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
    else if (a === "--max-load") args.maxLoad = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--force") args.force = true;
    else if (a === "--thaw-sites") args.thawSites = true;
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

/** List the scenarios, or run `scenarios` as A/B arms. Returns the exit code. */
export async function main(argv, log = console.log) {
  const [command, ...rest] = argv;
  const { SCENARIO_INFO: SCENARIOS } = await import("./scenario-info.ts");
  if (command === "list") {
    for (const [name, s] of Object.entries(SCENARIOS)) log(`${name}\n   ${s.about}\n   sizes: ${s.sizes}\n   lone ${s.lone ? "on" : "off"}, warm ${s.warmS} s, window ${s.windowS} s`);
    return 0;
  }
  if (command !== "run") throw new Error("usage: bench.mjs list | run <scenario>... [--arm name:knob=v,...]... [--order abba|baab|both] [--warm s] [--window s] [--max-load 2] [--force] [--thaw-sites] [--trace dt] [--out dir]");
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
      if (args.thawSites) env.BENCH_THAW_SITES = "1";
      if (args.trace) env.BENCH_TRACE = args.trace;
      const run = { ...child(env), arm: arm.name, flagged, n: n + 1 };
      writeFileSync(path.join(out, `${name}-${n + 1}-${arm.name}.json`), JSON.stringify(run));
      runs.push(run);
    }
    const summary = summarize(runs);
    const sc = SCENARIOS[name];
    const text = table(name, { about: sc.about, sizes: sc.sizes, lone: runs[0].lone, label: runs[0].label, windowS: runs[0].windowS, warmS: runs[0].warmS }, summary);
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
