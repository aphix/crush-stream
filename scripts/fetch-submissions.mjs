#!/usr/bin/env node
/**
 * Pull what players sent from the game (benchmark cards, JSON captures, flagged replay clips) down from the server.
 *
 *   SUBMISSIONS_OWNER_TOKEN=<token> node scripts/fetch-submissions.mjs <app url> [--kind bench|capture|flag] [--limit 50] [--id XXXX-XXXX] [--out dir] [--phases] [--ab]
 *
 * `<app url>` is where the game is served, e.g. https://example.org/crush/ . Each submission is saved as `<out>/<receipt id>.json` (default
 * `.bench/submissions`, which git ignores); one already saved is not fetched again. The token is read from the environment only, so it
 * never appears in a process list or a shell history line. `--phases` prints each bench card's sim phase table (ms per sim-second by phase, the work
 * counts, long tasks and battery) under its line, for cards already saved too. `--ab` prints, for each loop cycle and map, the two cards the loop ran (epicenter off, then on) side by side. Exit 0 when every request went; 1 otherwise.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RECEIPT = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const KINDS = ["bench", "capture", "flag"];
/** The server paces reads per address (a burst of 30, then one a second): a 429 is waited out, not an error. */
const RETRY_429_MS = 1_500;
const RETRY_429_MAX = 20;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const f1 = (v) => v.toFixed(1);

/**
 * The lines of a bench card's phase table, for a submission as `readOne` answers it; none for another kind. A card from before the phase timing
 * has no `phases` and says so.
 */
export function phaseTable(one) {
  const result = one.submission?.payload?.result;
  if (one.kind !== "bench" || !result) return [];
  const p = result.phases;
  if (!p) return ["    phases: none (a card from before the phase timing)"];
  const phases = Object.entries(p.msPerSimS).map(([name, ms]) => `${name} ${f1(ms)}`).join("  ");
  const work = Object.entries(p.workPerSimS).map(([name, n]) => `${name} ${Math.round(n)}`).join("  ");
  const tasks = result.longTasks ? `${result.longTasks.count} long tasks, ${f1(result.longTasks.totalMs)} ms` : "long tasks n/a";
  const battery = result.device?.battery;
  const level = (b) => `${Math.round(100 * b.level)} %${b.charging ? " charging" : ""}`;
  return [
    `    ${result.course}${armLabel(result)} ${f1(result.simMsPerSimS)} ms/sim-s = ${phases}  unattributed ${f1(p.unattributedMsPerSimS)}`,
    `    per sim-s: ${work}`,
    `    ${tasks}; battery ${battery ? `${level(battery.start)} -> ${level(battery.end)}` : "n/a"}`,
  ];
}

/** `, epicenter ON` or `, epicenter off` for a card that says which arm it ran; empty for one from before the switch. */
function armLabel(result) {
  const on = result.settings?.epicenter;
  return typeof on === "boolean" ? `, epicenter ${on ? "ON" : "off"}` : "";
}

const ARM = ":epi";
const PHASE_WINDOW = "window";

/** The arm a bench card ran: the epicenter setting the card records, else the loop step's suffix (a card from before the field). */
function armOf(settings, result) {
  return typeof result.settings?.epicenter === "boolean" ? result.settings.epicenter : settings.step.endsWith(ARM);
}

/** `PAGE_PHASES` index of the window, as the card's per-second series writes it (one hex digit a second). */
const WINDOW_INDEX = "1";
/** The bits of a second's flags digit in the card's series: shown, focused, fullscreen, the screen wake lock held. */
const BIT_SHOWN = 1;
const BIT_FOCUSED = 2;
const BIT_FULLSCREEN = 4;
const BIT_AWAKE = 8;

/**
 * What was wrong with the page during the window. A card with the per-second series says how many of the window's seconds the page was hidden, unfocused, out of
 * fullscreen or had no screen wake lock held; an older one only has the entries of its `pageEvents` (the entry that opens the window counts), which name the fault without a count.
 */
function windowFaults(result) {
  const series = result.pageSeconds;
  if (series) {
    const counts = { hidden: 0, unfocused: 0, "not fullscreen": 0, "screen not held": 0 };
    let seconds = 0;
    for (let i = 0; i < series.flags.length; i++) {
      if (series.phases[i] !== WINDOW_INDEX) continue;
      seconds++;
      const flags = Number.parseInt(series.flags[i], 16);
      if ((flags & BIT_SHOWN) === 0) counts.hidden++;
      else if ((flags & BIT_FOCUSED) === 0) counts.unfocused++;
      if ((flags & BIT_FULLSCREEN) === 0) counts["not fullscreen"]++;
      if ((flags & BIT_AWAKE) === 0) counts["screen not held"]++;
    }
    return Object.entries(counts).filter(([, n]) => n > 0).map(([name, n]) => `${name} ${n} of ${seconds} s`);
  }
  const faults = new Set();
  for (const e of result.pageEvents ?? []) {
    if (e.phase !== PHASE_WINDOW) continue;
    if (!e.visible) faults.add("hidden");
    else if (!e.focused) faults.add("unfocused");
    if (!e.fullscreen) faults.add("not fullscreen");
  }
  return [...faults];
}

/** The FX tier the most window frames ran. */
const topTier = (result) => Object.entries(result.tierPct ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "?";

/**
 * The off/on pairs of the bench loop in `ones` (submissions as `readOne` answers them: the card's loop settings are `submission.settings`): the loop runs every map twice, and
 * the cards of a pair share session, loop cycle and map (step `city`, `city:epi`). One block per pair: ms per sim-second by phase, the counters, the cost per unit
 * of work (the arms do different work once the sim diverges, so a total is not an A/B), hitches, and a FLAG line for each arm whose window lost focus,
 * was hidden or left fullscreen, and for a pair whose arms ran different FX tiers: such a pair says little about the activation.
 */
export function abTable(ones) {
  const cards = new Map();
  for (const one of ones) {
    const settings = one.submission?.settings;
    const result = one.submission?.payload?.result;
    if (one.kind !== "bench" || !settings?.step || !result?.phases) continue;
    const on = armOf(settings, result);
    const key = `${settings.session} cycle ${settings.loop} ${settings.step.endsWith(ARM) ? settings.step.slice(0, -ARM.length) : settings.step}`;
    cards.set(key, { ...cards.get(key), [on ? "on" : "off"]: result });
  }
  const lines = [];
  for (const [key, pair] of cards) {
    if (!pair.off || !pair.on) continue;
    const change = (a, b) => (a > 0 ? `${b >= a ? "+" : ""}${f1((100 * (b - a)) / a)} %` : "");
    const row = (name, a, b) => `    ${name.padEnd(22)} ${f1(a).padStart(9)} ${f1(b).padStart(9)} ${change(a, b).padStart(9)}`;
    const perUnit = (result, phase, units) => {
      const per = result.phases.workPerSimS;
      const n = units.reduce((sum, name) => sum + (per[name] ?? 0), 0);
      return n > 0 ? (1000 * result.phases.msPerSimS[phase]) / n : null;
    };
    const share = (result) => {
      const per = result.phases.workPerSimS;
      const wrecks = (per.wreckCarSlices ?? 0) + (per.asleepCarSlices ?? 0);
      return wrecks > 0 ? (100 * (per.frozenCarSlices ?? 0)) / wrecks : null;
    };
    lines.push(`${key}: epicenter off | on`, row("sim ms/sim-s", pair.off.simMsPerSimS, pair.on.simMsPerSimS));
    for (const name of Object.keys(pair.off.phases.msPerSimS)) lines.push(row(name, pair.off.phases.msPerSimS[name], pair.on.phases.msPerSimS[name] ?? 0));
    for (const name of ["wreckCarSlices", "frozenCarSlices", "freezes", "thaws", "liveCarSlices"]) {
      const a = pair.off.phases.workPerSimS[name];
      const b = pair.on.phases.workPerSimS[name];
      if (a !== undefined || b !== undefined) lines.push(row(name, a ?? 0, b ?? 0));
    }
    const units = [
      ["integrate us/live slice", (r) => perUnit(r, "integrate", ["liveCarSlices"])],
      ["wreck us/wreck slice", (r) => perUnit(r, "wreck", ["wreckCarSlices"])],
      ["structure us/wreck slice", (r) => perUnit(r, "structure", ["wreckCarSlices"])],
      ["frozen % of wreck+asleep", share],
    ];
    for (const [name, of] of units) {
      const a = of(pair.off);
      const b = of(pair.on);
      if (a !== null && b !== null) lines.push(row(name, a, b));
    }
    if (pair.off.hitches && pair.on.hitches) lines.push(row("hitched frames", pair.off.hitches.count, pair.on.hitches.count), row("hitch ms over median", pair.off.hitches.excessMs, pair.on.hitches.excessMs));
    for (const [arm, result] of [["off", pair.off], ["on", pair.on]]) {
      const faults = windowFaults(result);
      if (faults.length) lines.push(`    FLAG epicenter ${arm}: the window ran ${faults.join(", ")}`);
    }
    if (topTier(pair.off) !== topTier(pair.on)) lines.push(`    FLAG the arms ran different FX tiers: off ${topTier(pair.off)}, on ${topTier(pair.on)}`);
  }
  return lines;
}

/** GET `url` with the bearer token, waiting out 429s. Resolves to the JSON body; throws with the status and the server's words otherwise. */
async function get(url, token, fetchImpl, pause) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    if (res.status === 429 && attempt < RETRY_429_MAX) {
      await pause(RETRY_429_MS);
      continue;
    }
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${url}: ${res.status}, not JSON`);
    }
    if (!res.ok) throw new Error(`${url}: ${res.status} ${body?.error ?? ""}`.trim());
    return body;
  }
}

/**
 * Save the submissions of `options.base` into `options.out`. Resolves to `{ saved, skipped }`, the receipt ids written and the ones
 * already there; rejects on the first request the server refuses.
 */
export async function fetchSubmissions(options) {
  const { base, token, out, kind, limit, id, phases = false, ab = false, fetchImpl = fetch, pause = sleep, log = () => {} } = options;
  if (!token || token.length < 24) throw new Error("SUBMISSIONS_OWNER_TOKEN is not set (24 characters or more)");
  if (kind !== undefined && !KINDS.includes(kind)) throw new Error(`--kind is one of ${KINDS.join(", ")}`);
  if (id !== undefined && !RECEIPT.test(id)) throw new Error("--id is a receipt id like K7QM-2XWD");
  const api = new URL("api/submissions", base.endsWith("/") ? base : `${base}/`);
  await mkdir(out, { recursive: true });

  let ids;
  if (id !== undefined) ids = [id];
  else {
    const query = new URLSearchParams({ limit: String(limit ?? 50) });
    if (kind !== undefined) query.set("kind", kind);
    const listed = await get(`${api}?${query}`, token, fetchImpl, pause);
    // A receipt id becomes a file name here: only the receipt format gets through, whatever the server answers.
    ids = listed.submissions.map((s) => s.id).filter((s) => RECEIPT.test(s));
  }
  const saved = [];
  const skipped = [];
  const seen = [];
  for (const receipt of ids.toReversed()) {
    const file = path.join(out, `${receipt}.json`);
    if (existsSync(file)) {
      skipped.push(receipt);
      const again = JSON.parse(await readFile(file, "utf8"));
      seen.push(again);
      if (phases) for (const line of phaseTable(again)) log(line);
      continue;
    }
    const one = await get(`${api}?id=${receipt}`, token, fetchImpl, pause);
    await writeFile(file, `${JSON.stringify(one, null, 1)}\n`);
    saved.push(receipt);
    log(`${receipt}  ${one.kind.padEnd(7)} ${one.receivedAt}  build ${one.sha}  ${file}`);
    seen.push(one);
    if (phases) for (const line of phaseTable(one)) log(line);
  }
  if (ab) for (const line of abTable(seen)) log(line);
  return { saved, skipped };
}

function parseArgs(argv) {
  const args = { out: ".bench/submissions" };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--kind") args.kind = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--id") args.id = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--phases") args.phases = true;
    else if (a === "--ab") args.ab = true;
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else positional.push(a);
  }
  if (positional.length !== 1) throw new Error("usage: fetch-submissions.mjs <app url> [--kind k] [--limit n] [--id receipt] [--out dir] [--phases] [--ab]");
  return { ...args, base: positional[0] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { saved, skipped } = await fetchSubmissions({ ...args, token: process.env.SUBMISSIONS_OWNER_TOKEN, log: console.log });
    console.log(`${saved.length} saved, ${skipped.length} already in ${args.out}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
