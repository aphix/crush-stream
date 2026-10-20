#!/usr/bin/env node
/**
 * Pull what players sent from the game (benchmark cards, JSON captures, flagged replay clips) down from the server.
 *
 *   SUBMISSIONS_OWNER_TOKEN=<token> node scripts/fetch-submissions.mjs <app url> [--kind bench|capture|flag] [--limit 50] [--id XXXX-XXXX] [--out dir] [--phases] [--series] [--frames] [--ab]
 *
 * `<app url>` is where the game is served, e.g. https://example.org/crush/ . Each submission is saved as `<out>/<receipt id>.json` (default
 * `.bench/submissions`, which git ignores); one already saved is not fetched again. The token is read from the environment only, so it
 * never appears in a process list or a shell history line. `--phases` prints each bench card's sim phase table (ms per sim-second by phase, the work
 * counts, long tasks and battery) under its line, for cards already saved too. `--frames` prints each card's frame stats in full: the percentiles and lows from every frame of its window, every listed spike with what the sim was doing in it, and the window in 200 ms buckets. `--series` prints the window's per-second phases and work counters, a row a second. `--ab` prints, for each loop cycle and map, the two cards the loop ran (epicenter off, then on) side by side. A flag's line ends with its FX tier, whether Auto picked it, and the WebGL errors read since the page loaded. Exit 0 when every request went; 1 otherwise.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The names of the sim's phases in the order the card's frame columns carry them (`PHASE_NAMES`). */
const PHASE_NAMES = ["drive", "plan", "integrate", "wreck", "pairs", "structure", "course", "bake", "rules", "settle"];

const RECEIPT = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const KINDS = ["bench", "capture", "flag"];
/** The server paces reads per address (a burst of 30, then one a second): a 429 is waited out, not an error. */
const RETRY_429_MS = 1_500;
const RETRY_429_MAX = 20;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const f1 = (v) => v.toFixed(1);

/** A flag's look when it was sent, for the end of its line: "" for another kind, and a flag from before the GL count says so. */
function flagLook(one) {
  const s = one.submission?.settings;
  if (one.kind !== "flag" || !s) return "";
  const auto = typeof s.fxAuto === "boolean" ? (s.fxAuto ? " (Auto)" : " (picked)") : "";
  if (typeof s.glErrors !== "number") return `  fx ${s.fxTier}${auto}, GL errors not recorded`;
  return `  fx ${s.fxTier}${auto}, GL errors ${s.glErrors}${s.glErrors > 0 ? ` (last 0x${s.glError.toString(16)})` : ""}`;
}

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
    `    ${result.course}${armLabel(result)} ${f1(result.simMsPerSimS)} ms/sim-s${result.simSpreadPct === undefined ? "" : ` (spread ${f1(result.simSpreadPct)} %)`} = ${phases}  unattributed ${f1(p.unattributedMsPerSimS)}`,
    `    per sim-s: ${work}`,
    ...(p.unitUs ? [`    per unit (us): ${Object.entries(p.unitUs).map(([name, us]) => `${name} ${f1(us)}`).join("  ")}`] : []),
    ...(result.frameStats ? frameTable(one) : []),
    ...(result.pageState ? [`    page: step ${result.pageState.stepOfPage} of the page, keep ${result.pageState.keep}, heap ${result.pageState.heapUsedMB ?? "n/a"} of ${result.pageState.heapLimitMB ?? "n/a"} MiB, ragdoll ${result.pageState.ragdollHost}`] : []),
    `    ${tasks}; battery ${battery ? `${level(battery.start)} -> ${level(battery.end)}` : "n/a"}`,
  ];
}

/** The columns of a card's `{ cols, data }` table as records (one per row). */
function columnRecords(table) {
  return Array.from({ length: table?.n ?? 0 }, (_, i) => Object.fromEntries(table.cols.map((name, k) => [name, table.data[k][i]])));
}

/** The activity columns the card's spike summary names, in the order it prints them. */
const SPIKE_ACTIVITY = ["crashed", "wreckCarSlices", "pairContacts", "freezes", "ragdollMessages"];

/**
 * The window's frames as the device summarised them (`frameStats`): the percentiles and lows, what the sim was doing in the spike frames against the others, and (`full`) every listed spike
 * with its activity and the `BUCKET_MS` series. A card from before the frame stats says so.
 */
export function frameTable(one, full = false) {
  const result = one.submission?.payload?.result;
  if (one.kind !== "bench" || !result) return [];
  const f = result.frameStats;
  if (!f) return ["    frames: none (a card from before the frame stats)"];
  const sp = f.spikes;
  const at = (name) => sp.activity.cols.indexOf(name);
  const lines = [
    `    ${result.course}${armLabel(result)} frames: ${f.n}, median ${f1(f.medianMs)} ms, p95 ${f1(f.p95Ms)}, p99 ${f1(f.p99Ms)}, p99.9 ${f1(f.p999Ms)}, max ${f1(f.maxMs)}; lows: 1 % ${f1(f.fpsLow1)} fps, 0.1 % ${f1(f.fpsLow01)} fps`,
  ];
  if (sp.count === 0) lines.push(`    no frame over ${sp.factor}x the median (${f1(sp.thresholdMs)} ms)`);
  else {
    const said = SPIKE_ACTIVITY.filter((name) => at(name) >= 0).map((name) => `${name} ${f1(sp.activity.inSpikes[at(name)])} vs ${f1(sp.activity.otherwise[at(name)])} (r ${sp.activity.correlation[at(name)].toFixed(2)})`);
    const top = sp.dominantPhase.indexOf(Math.max(...sp.dominantPhase));
    lines.push(`    ${sp.count} spikes over ${sp.factor}x the median (${f1(sp.thresholdMs)} ms); in a spike against elsewhere: ${said.join(", ")}; phase ${PHASE_NAMES[top] ?? top} largest in ${sp.dominantPhase[top]}`);
  }
  if (!full) return lines;
  const cell = (v, w = 9) => String(v).padStart(w);
  const spikeRows = columnRecords(sp.rows);
  if (spikeRows.length) {
    lines.push(`    ${"at s".padStart(7)}${cell("ms")}${cell("sim ms")}${cell("draw ms")}${cell("steps")}${cell("wrecks")}${cell("wreck sl")}${cell("contacts")}${cell("freeze")}${cell("thaw")}${cell("ragdoll")}  largest phase`);
    for (const r of spikeRows) {
      const phases = PHASE_NAMES.map((name) => [name, r[`${name}Ms`] ?? 0]);
      const top = phases.reduce((best, p) => (p[1] > best[1] ? p : best), phases[0]);
      lines.push(`    ${f1(r.atS).padStart(7)}${cell(f1(r.intervalMs))}${cell(f1(r.simMs))}${cell(f1(r.drawMs))}${cell(r.steps)}${cell(r.crashed)}${cell(r.wreckCarSlices)}${cell(r.pairContacts)}${cell(r.freezes)}${cell(r.thaws)}${cell(r.ragdollMessages)}  ${top[0]} ${f1(top[1])} ms`);
    }
  }
  lines.push(`    ${"at s".padStart(7)}${cell("frames")}${cell("mean ms")}${cell("max ms")}${cell("sim ms")}${cell("wrecks")}${cell("wreck sl")}${cell("contacts")}${cell("freeze")}${cell("thaw")}${cell("ragdoll")}  (${f.series.n} buckets)`);
  for (const r of columnRecords(f.series)) lines.push(`    ${f1(r.atS).padStart(7)}${cell(r.frames)}${cell(f1(r.meanMs))}${cell(f1(r.maxMs))}${cell(f1(r.simMs))}${cell(r.crashed)}${cell(r.wreckCarSlices)}${cell(r.pairContacts)}${cell(r.freezes)}${cell(r.thaws)}${cell(r.ragdollMessages)}`);
  return lines;
}

/**
 * The per-second series of a bench card's window (`phases.perSecond`): one row a second with its wall span and sim seconds, then each phase's ms per sim-second and
 * each work counter's count per sim-second; a card from before the series says so. The page's per-second state (`pageSeconds`) is the first column's hex digit.
 */
export function seriesTable(one) {
  const result = one.submission?.payload?.result;
  if (one.kind !== "bench" || !result) return [];
  const s = result.phases?.perSecond;
  if (!s) return ["    per-second series: none (a card from before the series)"];
  const names = (record) => Object.keys(record);
  const row = (cells) => `    ${cells.map((c, i) => String(c).padStart(i === 0 ? 4 : 9)).join("")}`;
  const lines = [`    ${result.course}${armLabel(result)} per-second series (the window: ${f1(result.wallS)} s, ${f1(result.simMsPerSimS)} ms/sim-s, spread ${f1(result.simSpreadPct ?? 0)} %)`];
  lines.push(row(["s", "wall s", "sim s", ...names(s.msPerSimS)]));
  for (let i = 0; i < s.wallS.length; i++) lines.push(row([i + 1, s.wallS[i].toFixed(2), s.clockS[i].toFixed(2), ...names(s.msPerSimS).map((n) => f1(s.msPerSimS[n][i]))]));
  lines.push(row(["s", "", "", ...names(s.workPerSimS)]));
  for (let i = 0; i < s.wallS.length; i++) lines.push(row([i + 1, "", "", ...names(s.workPerSimS).map((n) => Math.round(s.workPerSimS[n][i]))]));
  return lines;
}

/** A card's list of records: the wire's `{ keys, rows }` table (each record an array of values in the keys' order) as records, or a list a card from before the tables carries as it is. */
export function rowsOf(table) {
  if (Array.isArray(table)) return table;
  if (!table || !Array.isArray(table.keys) || !Array.isArray(table.rows)) return [];
  return table.rows.map((row) => Object.fromEntries(table.keys.map((key, k) => [key, key === "causes" && typeof row[k] === "string" ? row[k].split("+").filter(Boolean) : row[k]])));
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

/** A window or arm whose per-second sim cost has a spread (coefficient of variation) over this share of its mean never ran steady. */
const UNSTEADY_SPREAD_PCT = 25;
/** The bits of a second's flags digit in the card's series: shown, focused, fullscreen, the screen wake lock held. */
const BIT_SHOWN = 1;
const BIT_FOCUSED = 2;
const BIT_FULLSCREEN = 4;
const BIT_AWAKE = 8;
/** The digit of the card's sky series (`SKY_DRAWN`) that each sky the bench pins draws: the procedural sky, the full strip, or nothing. A card from before `settings.skyPin` pinned its `settings.sky`. */
const SKY_PIN_DIGIT = { procedural: "5", full: "3", off: "0" };

/** A window second at or under this many frames was throttled (a browser holds a page it does not draw to about one frame a second): a phone's or a software GL's steady 10 fps is not. */
const THROTTLED_FPS = 2;
/** A device whose user agent says it is a phone or tablet: fullscreen matters there (the browser's bars and the screen timing out change the page); on a desktop a window that is not fullscreen is a note. */
const TOUCH_DEVICE = /Android|iPhone|iPad|iPod|Mobile/i;
/** Frame time in unfocused window seconds is compared with the focused ones' only above this many percent, whatever a very steady window's own spread says (a rounding difference is not a cost). */
const MIN_FOCUS_DIFF_PCT = 5;

/**
 * What was wrong with the page during the window, as faults (they spoil it: `FLAG`) and notes (they are only said). A card with the per-second series counts the window's seconds: faults
 * are hidden, not fullscreen on a phone or tablet, the screen wake lock not held, the sky not as pinned, and frame-rate throttled seconds (`fpsPerSecond`); notes are the seconds visible but
 * unfocused (a desktop with two monitors loses focus whenever its owner types elsewhere, and a visible page draws at full rate) and, on a desktop, seconds out of fullscreen. An older card
 * has only the entries of its `pageEvents` (the entry that opens the window counts) and names the same without a count.
 */
function windowReading(result) {
  const touch = TOUCH_DEVICE.test(result.device?.userAgent ?? "");
  const series = result.pageSeconds;
  const faults = [];
  const notes = [];
  if (series) {
    const counts = { hidden: 0, unfocused: 0, "not fullscreen": 0, "screen not held": 0, "sky not as pinned": 0 };
    const pinned = SKY_PIN_DIGIT[result.settings?.skyPin ?? result.settings?.sky];
    let seconds = 0;
    for (let i = 0; i < series.flags.length; i++) {
      if (series.phases[i] !== WINDOW_INDEX) continue;
      seconds++;
      const flags = Number.parseInt(series.flags[i], 16);
      if ((flags & BIT_SHOWN) === 0) counts.hidden++;
      else if ((flags & BIT_FOCUSED) === 0) counts.unfocused++;
      if ((flags & BIT_FULLSCREEN) === 0) counts["not fullscreen"]++;
      if ((flags & BIT_AWAKE) === 0) counts["screen not held"]++;
      if (pinned !== undefined && series.sky !== undefined && series.sky[i] !== pinned) counts["sky not as pinned"]++;
    }
    const say = (name) => `${name} ${counts[name]} of ${seconds} s`;
    const lastWarm = series.phases.lastIndexOf("0");
    const firstWindow = series.phases.indexOf(WINDOW_INDEX);
    if (series.epi !== undefined && lastWarm >= 0 && firstWindow >= 0 && series.epi[lastWarm] !== series.epi[firstWindow]) faults.push("the epicenter knob changed between the warm-up's last second and the window's first");
    for (const name of ["hidden", "screen not held", "sky not as pinned"]) if (counts[name] > 0) faults.push(say(name));
    if (counts["not fullscreen"] > 0) (touch ? faults : notes).push(say("not fullscreen") + (touch ? "" : " (desktop)"));
    if (counts.unfocused > 0) notes.push(`${say("unfocused")} (visible)`);
  } else {
    const seen = new Set();
    for (const e of rowsOf(result.pageEvents)) {
      if (e.phase !== PHASE_WINDOW) continue;
      if (!e.visible) seen.add("hidden");
      else if (!e.focused) seen.add("unfocused");
      if (!e.fullscreen) seen.add("not fullscreen");
    }
    if (seen.has("hidden")) faults.push("hidden");
    if (seen.has("not fullscreen")) (touch ? faults : notes).push(touch ? "not fullscreen" : "not fullscreen (desktop)");
    if (seen.has("unfocused")) notes.push("unfocused (visible)");
  }
  const fps = result.fpsPerSecond;
  if (Array.isArray(fps) && fps.length > 0) {
    const throttled = fps.filter((v) => v <= THROTTLED_FPS).length;
    if (throttled > 0) faults.push(`frame rate throttled (${THROTTLED_FPS} fps or less) ${throttled} of ${fps.length} s`);
  }
  return { faults, notes };
}

/** The window's focus state each of its seconds (true: visible and focused, false: visible and not, null: hidden), from the card's page events, which count their time from the window's start like `fpsPerSecond`. */
function focusPerSecond(events, seconds) {
  const window = events.filter((e) => e.phase === PHASE_WINDOW).sort((a, b) => a.atS - b.atS);
  const states = [];
  for (let second = 0; second < seconds; second++) {
    let at = null;
    for (const e of window) if (e.atS <= second + 0.5) at = e;
    states.push(at === null || !at.visible ? null : at.focused);
  }
  return states;
}

/**
 * Whether losing focus cost the page frame time: the mean frame time of the window's visible-but-unfocused seconds against its focused ones (1000 / `fpsPerSecond`). `flag` says so when
 * the two differ by more than the window's own spread (the coefficient of variation of its seconds' frame time) and at least `MIN_FOCUS_DIFF_PCT`; `note` gives the two numbers when
 * there are unfocused seconds to compare (at least two of each kind), either way. A card with no per-second frame rate or no page events has neither.
 */
function focusCost(result) {
  const fps = result.fpsPerSecond;
  const events = rowsOf(result.pageEvents);
  if (!Array.isArray(fps) || fps.length === 0 || events.length === 0) return {};
  const states = focusPerSecond(events, fps.length);
  const ms = fps.map((v) => (v > 0 ? 1000 / v : null));
  const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const focused = ms.filter((v, i) => v !== null && states[i] === true);
  const unfocused = ms.filter((v, i) => v !== null && states[i] === false);
  if (unfocused.length === 0) return {};
  if (focused.length < 2 || unfocused.length < 2) return { note: `frame time unfocused against focused: too few seconds to compare (${unfocused.length} unfocused, ${focused.length} focused)` };
  const all = ms.filter((v) => v !== null);
  const avg = mean(all);
  const spread = (100 * Math.sqrt(mean(all.map((v) => (v - avg) ** 2)))) / avg;
  const a = mean(focused);
  const b = mean(unfocused);
  const apart = (100 * Math.abs(b - a)) / a;
  const said = `frame time ${f1(b)} ms unfocused (${unfocused.length} s) against ${f1(a)} ms focused (${focused.length} s): ${f1(apart)} % apart, the window's own spread ${f1(spread)} %`;
  return apart > Math.max(spread, MIN_FOCUS_DIFF_PCT) ? { flag: `losing focus cost frame time: ${said}`, note: said } : { note: `${said}: no cost` };
}

/** The FX tier the most window frames ran. */
const topTier = (result) => Object.entries(result.tierPct ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "?";

/**
 * The off/on pairs of the bench loop in `ones` (submissions as `readOne` answers them: the card's loop settings are `submission.settings`): the loop runs every map twice, and
 * the cards of a pair share session, loop cycle and map (step `city`, `city:epi`). One block per pair: ms per sim-second by phase, the counters, the cost per unit
 * of work (the arms do different work once the sim diverges, so a total is not an A/B), hitches, and a FLAG line for each arm whose window was spoiled
 * (hidden, not fullscreen on a phone, the screen lock lost, the frame rate throttled, the sky off its pin, focus loss that cost frame time) and for a pair whose arms ran different FX tiers:
 * such a pair says little about the activation. Visible-but-unfocused seconds are a `note` line, not a FLAG (`windowReading`, `focusCost`).
 */
export function abTable(ones) {
  const cards = new Map();
  const queues = new Map();
  for (const one of ones) {
    const settings = one.submission?.settings;
    const result = one.submission?.payload?.result;
    if (one.kind !== "bench" || !settings?.step || !result?.phases) continue;
    const on = armOf(settings, result);
    const map = settings.step.endsWith(ARM) ? settings.step.slice(0, -ARM.length) : settings.step;
    if (result.run?.extended === false) {
      // A quick run is one arm of each map: its pair is the run of the other arm, on the same device and build, in the order the runs came.
      const queue = `quick ${result.build} ${(result.device?.userAgent ?? "").slice(0, 60)} ${map}`;
      const lists = queues.get(queue) ?? { off: [], on: [] };
      lists[on ? "on" : "off"].push(result);
      queues.set(queue, lists);
      continue;
    }
    const key = `${settings.session} cycle ${settings.loop} ${map}`;
    cards.set(key, { ...cards.get(key), [on ? "on" : "off"]: result });
  }
  const pairs = [...cards].map(([key, pair]) => ({ key, off: pair.off, on: pair.on }));
  for (const [queue, lists] of queues) for (let i = 0; i < Math.min(lists.off.length, lists.on.length); i++) pairs.push({ key: `${queue}, run ${i + 1}`, off: lists.off[i], on: lists.on[i] });
  const lines = [];
  for (const pair of pairs) {
    const { key } = pair;
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
    if (pair.off.simSpreadPct !== undefined && pair.on.simSpreadPct !== undefined) lines.push(row("window spread %", pair.off.simSpreadPct, pair.on.simSpreadPct));
    for (const name of Object.keys(pair.off.phases.unitUs ?? {})) {
      const b = pair.on.phases.unitUs?.[name];
      if (b !== undefined && !units.some(([known]) => known === name)) lines.push(row(name, pair.off.phases.unitUs[name], b));
    }
    for (const [arm, result] of [["off", pair.off], ["on", pair.on]]) {
      if (result.simSpreadPct > UNSTEADY_SPREAD_PCT) lines.push(`    FLAG epicenter ${arm}: the window's sim cost swung ${f1(result.simSpreadPct)} % second to second (over ${UNSTEADY_SPREAD_PCT} %): its mean says little, read the per-second series (--series)`);
      const opened = rowsOf(result.switches).find((s) => s.stretch === "window");
      if (opened && !opened.settled) lines.push(`    FLAG epicenter ${arm}: the page never settled before the window opened (${f1(opened.settleS)} s watched, longest frame ${Math.round(opened.longestMs)} ms)`);
    }
    for (const [arm, result] of [["off", pair.off], ["on", pair.on]]) {
      const { faults, notes } = windowReading(result);
      if (faults.length) lines.push(`    FLAG epicenter ${arm}: the window ran ${faults.join(", ")}`);
      const cost = focusCost(result);
      if (cost.flag) lines.push(`    FLAG epicenter ${arm}: ${cost.flag}`);
      if (cost.note) notes.push(cost.note);
      if (notes.length) lines.push(`    note epicenter ${arm}: ${notes.join("; ")}`);
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
  const { base, token, out, kind, limit, id, phases = false, series = false, frames = false, ab = false, fetchImpl = fetch, pause = sleep, log = () => {} } = options;
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
      if (series) for (const line of seriesTable(again)) log(line);
      if (frames) for (const line of frameTable(again, true)) log(line);
      continue;
    }
    const one = await get(`${api}?id=${receipt}`, token, fetchImpl, pause);
    await writeFile(file, `${JSON.stringify(one, null, 1)}\n`);
    saved.push(receipt);
    log(`${receipt}  ${one.kind.padEnd(7)} ${one.receivedAt}  build ${one.sha}  ${file}${flagLook(one)}`);
    seen.push(one);
    if (phases) for (const line of phaseTable(one)) log(line);
    if (series) for (const line of seriesTable(one)) log(line);
    if (frames) for (const line of frameTable(one, true)) log(line);
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
    else if (a === "--series") args.series = true;
    else if (a === "--frames") args.frames = true;
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else positional.push(a);
  }
  if (positional.length !== 1) throw new Error("usage: fetch-submissions.mjs <app url> [--kind k] [--limit n] [--id receipt] [--out dir] [--phases] [--series] [--frames] [--ab]");
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
