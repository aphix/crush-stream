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
    const units = work.liveCarSlices + work.wreckCarSlices;
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
      load: { start: Math.min(...list.map((r) => r.loadStart)), startMax: Math.max(...list.map((r) => r.loadStart)), end: Math.max(...list.map((r) => r.loadEnd)) },
      flagged: list.some((r) => r.flagged),
    });
  }
  return out;
}

const f1 = (v) => v.toFixed(1);
const f2 = (v) => v.toFixed(2);
const pct = (a, b) => (a > 0 ? `${b >= a ? "+" : ""}${f1((100 * (b - a)) / a)}%` : "");

/** The text of a summary: one block per scenario. `first` is the scenario's config (`about`, `sizes`, `lone`, `label`). */
export function table(name, first, arms) {
  const lines = [`== ${name}: ${first.about}`, `   sizes: ${first.sizes}`, `   lone-car schedule ${first.lone ? "ON (the race's: World.lone)" : "off (the Fleet's)"}; ${first.label}; window ${f1(first.windowS)} s after ${first.warmS} s warm-up`];
  const w = Math.max(...arms.map((a) => a.name.length), 6);
  const head = ["", ...arms.map((a) => a.name.padStart(Math.max(9, w)))];
  if (arms.length === 2) head.push("change".padStart(8));
  const row = (label, vals, change = true) => {
    const cells = vals.map((v) => v.padStart(Math.max(9, w)));
    const tail = change && arms.length === 2 ? [pct(Number(vals[0]), Number(vals[1])).padStart(8)] : [];
    return `   ${label.padEnd(26)}${cells.join(" ")}${tail.length ? " " + tail[0] : ""}`;
  };
  lines.push(`   ${"".padEnd(26)}${head.slice(1).join(" ")}`);
  lines.push(row("runs", arms.map((a) => String(a.runs)), false));
  lines.push(row("load at start (min..max)", arms.map((a) => `${f1(a.load.start)}..${f1(a.load.startMax)}`), false));
  lines.push(row("load at end (max)", arms.map((a) => f1(a.load.end)), false));
  lines.push(row("ms/sim-s, wall (runs)", arms.map((a) => f1(mean(a.wall))), true));
  lines.push(row("ms/sim-s, phases total", arms.map((a) => f1(a.total))));
  for (const p of PHASES) if (arms.some((a) => a.phase[p] >= 0.05)) lines.push(row(`  ${p}`, arms.map((a) => f2(a.phase[p]))));
  lines.push(row("us per car-slice, all", arms.map((a) => f2(a.perUnitTotal))));
  for (const p of PHASES) if (arms.some((a) => a.perUnit[p] >= 0.05)) lines.push(row(`  ${p}`, arms.map((a) => f2(a.perUnit[p]))));
  for (const c of COUNTERS) if (arms.some((a) => a.work[c] > 0)) lines.push(row(`${c}/s`, arms.map((a) => String(Math.round(a.work[c])))));
  const wreck = arms.map((a) => a.work.wreckCarSlices);
  lines.push(row("frozen / wreck car-slices", arms.map((a, i) => (wreck[i] > 0 ? f2(a.work.frozenCarSlices / wreck[i]) : "-")), false));
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
  if (command !== "run") throw new Error("usage: bench.mjs list | run <scenario>... [--arm name:knob=v,...]... [--order abba|baab|both] [--warm s] [--window s] [--max-load 2] [--force] [--thaw-sites] [--out dir]");
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
