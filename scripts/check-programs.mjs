#!/usr/bin/env node
/**
 * Program warm-up guard. A GPU program linked mid-play stalls its frame 50–800 ms, so the engine links every
 * program it can reach before its loop starts (`CrashEngine.ready`) and warms new scene content (a race
 * course, new cars) in the menu that loads it. This boots the game in headless Chromium, waits for that
 * warm-up, then plays through everything that can need a new program: a fast fleet crash (sparks, debris,
 * smoke, cracked glass, tyre marks), a boost launch and handbrake drift, night and wet, every FX tier, every
 * scene (derby, pistons fired, door ram, compactor, barrier, balls), the debug views, a race on every course (8 cars,
 * the city's traffic), and Auto's mid-race tier steps in a sprayed field (`SPRAYED_STEPS`). A program is its id with
 * its key, so one freed and linked again counts. It fails if a program links after the warm-up in the sandbox play, or
 * between a race's green light and its end of play, if a tier switch links a program or draws one for the first time
 * inside a frame, or if a finish program exists for the canvas. Counts, not timings, so it is deterministic; it prints
 * the programs held per tier, the finish programs by key, and the switches' frame times.
 *
 *   node scripts/check-programs.mjs [--url http://127.0.0.1:8080/]
 *
 * Needs a running dev or preview server. CHROME_PATH picks the browser; on Linux it renders through ANGLE/GL
 * like scripts/bench-browser.mjs.
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const urlArg = process.argv.indexOf("--url");
const url = urlArg > 0 ? process.argv[urlArg + 1] : "http://127.0.0.1:8080/";

/** Playwright's own build if installed, else the newest cached Chromium (revision mismatch after upgrades). */
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (existsSync(chromium.executablePath())) return undefined;
  const cache = join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(cache)) return undefined;
  const dirs = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
  return dirs.map((d) => join(cache, d, "chrome-linux64", "chrome")).find(existsSync);
}

const args = ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--mute-audio"];
if (process.platform === "linux") args.push("--use-gl=angle", "--use-angle=gl");
const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

const run = (body) => page.evaluate((b) => new Function("e", b)(window.__crush), body);
const wait = (s) => page.waitForTimeout(s * 1000);
/** Every program the renderer holds, with the material type that built it. */
const programs = () =>
  page.evaluate(() => (window.__crush.renderer.info.programs ?? []).map((p) => ({ id: p.id, type: p.type, key: String(p.cacheKey) })));
/** A program as one linked object, its id with its key: one freed and linked again under the same key is a new link. */
const programId = (p) => `${p.id} ${p.key}`;
/** The newest program count at each FX tier, taken after each switch to it. */
const perTier = new Map();
/** A program key's output colour space: "srgb" draws to the canvas, "srgb-linear" into a render target (three keys it after the precision). */
const outputOf = (key) => /,(?:high|medium|low)p,(srgb(?:-linear)?),/.exec(key)?.[1] ?? "unknown";
/** What the car finish adds to a program key (`applyFinish`). */
const FINISH_KEY_MARK = "|finish-";
/** Frames timed after a tier switch, and how long the switch is watched for first draws (s: its warm-up runs async). */
const SWITCH_FRAMES = 3;
const SWITCH_WATCH_S = 1.5;

/**
 * From here on, counts every program drawn for the first time inside a frame (three fetches a program's uniform locations on its
 * first draw, a synchronous GPU round trip) and, while `watch` frames are left, times each frame's draw (`Cinematics.render`) and
 * when it started after `since` (the switch: what the switch's warm-up does between frames shows as a late start).
 */
const watchDraws = () =>
  page.evaluate(() => {
    const e = window.__crush;
    const gl = e.renderer.getContext();
    const probe = { inFrame: false, firstDraws: 0, watch: 0, since: 0, frameMs: [], startMs: [] };
    window.__drawProbe = probe;
    const getUniformLocation = gl.getUniformLocation.bind(gl);
    gl.getUniformLocation = (program, name) => {
      if (probe.inFrame) probe.firstDraws++;
      return getUniformLocation(program, name);
    };
    const render = e.cine.render.bind(e.cine);
    e.cine.render = (...args) => {
      const t0 = performance.now();
      probe.inFrame = true;
      try {
        render(...args);
      } finally {
        probe.inFrame = false;
        if (probe.watch > 0) {
          probe.watch--;
          probe.frameMs.push(performance.now() - t0);
          probe.startMs.push(t0 - probe.since);
        }
      }
    };
  });

/**
 * Switch the FX tier and watch the frames after: programs linked, programs first drawn inside a frame, and the draw ms of the first
 * `SWITCH_FRAMES` frames. The warm-up the switch queues must have linked and drawn everything already: a failure goes into `late`.
 */
async function tierSwitch(label, tier, late) {
  const before = new Set((await programs()).map(programId));
  await page.evaluate(
    ([t, frames]) => {
      Object.assign(window.__drawProbe, { firstDraws: 0, watch: frames, since: performance.now(), frameMs: [], startMs: [] });
      window.__crush.setFxTier(t);
    },
    [tier, SWITCH_FRAMES],
  );
  await wait(SWITCH_WATCH_S);
  const now = await programs();
  const linked = now.filter((p) => !before.has(programId(p)));
  perTier.set(tier, now.length);
  const { firstDraws, frameMs, startMs } = await page.evaluate(() => window.__drawProbe);
  const ms = (list) => list.map((t) => t.toFixed(1)).join(" / ");
  console.log(`- ${label}: ${linked.length} programs linked (${now.length} held), ${firstDraws} uniform fetches of first draws inside frames`);
  console.log(`  first ${SWITCH_FRAMES} frames: draw ${ms(frameMs)} ms, started ${ms(startMs)} ms after the switch`);
  for (const p of linked) console.log(`  linked after the switch: ${p.type} …${p.key.slice(-80).replace(/\s+/g, " ")}`);
  late.push(...linked);
  if (firstDraws > 0) late.push({ type: "first draw inside a frame", key: label });
}

/** Load `href` and wait for the boot warm-up; scene switches cut, not fade. */
async function boot(href) {
  await page.goto(href, { waitUntil: "load", timeout: 120_000 });
  await page.waitForFunction(() => Boolean(window.__crush), null, { timeout: 120_000 });
  await page.evaluate(() => window.__crush.ready);
  // Rapier loads after boot and its purse pool warms in the background: that warm is part of the boot's, not a mid-play link.
  await page.evaluate(() => window.__crush.ragdolls.preload());
  await page.waitForFunction(() => window.__crush.warmsInFlight === 0, null, { timeout: 60_000 });
  await page.evaluate(() => (window.__crush.fadeScenes = false));
  await watchDraws();
}

/**
 * Auto's mid-race steps, one tier at a time, in a sprayed field (the city race's rivals) dressed at the boot tier: booted at High it steps
 * down to Minimal and back up, booted at Low it climbs to High and drops back. The finish and the rivals' bitmap size change on the way.
 */
const SPRAYED_STEPS = [
  ["high", ["low", "minimal", "low", "high"]],
  ["low", ["high", "low"]],
];

async function sprayedSwitches(late) {
  for (const [from, steps] of SPRAYED_STEPS) {
    const at = new URL(url);
    at.searchParams.set("fx", from);
    await boot(at.href);
    await run("e.toggleRace()");
    await run(`e.raceCommand({ type: "options", options: { trackId: "city", aiCount: 7, laps: 9 } }); e.raceCommand({ type: "start" })`);
    await page.waitForFunction(() => window.__crush.race.hud().phase === "racing", null, { timeout: 60_000 });
    await wait(3);
    let tier = from;
    for (const to of steps) {
      await tierSwitch(`booted at ${from}, race city, ${tier} → ${to}`, to, late);
      tier = to;
    }
  }
}

/** A program key's last field: the material's own key (`customProgramCacheKey`), e.g. "car-paint-primer|finish-paint|spray-car". */
const customKey = (key) => key.slice(key.lastIndexOf(",") + 1);

try {
  await boot(url);
  const warm = await programs();
  const late = [];

  console.log("- fast fleet crash");
  await run("e.setSpeedRange(30, 45); e.setCarCount(12)");
  await wait(12);
  const broken = await run("return e.cars.flatMap((c) => c.snapshot().glass).filter((s) => s !== 'intact').length");
  console.log(`  ${broken} panes cracked or shattered (0 = the cracked-glass variant went unexercised)`);
  console.log("- drive: boost launch, handbrake drift");
  await run("e.setCarCount(4); e.seat.focus(0)");
  await wait(1);
  for (const keys of [["KeyW", "ShiftLeft"], ["KeyW", "KeyA", "Space"]]) {
    for (const k of keys) await page.keyboard.down(k);
    await wait(2.5);
    for (const k of keys) await page.keyboard.up(k);
  }
  const more = [
    ["leave the car", "e.seat.esc(); e.seat.esc()", 0.5],
    ["night", "e.setNight(true)", 1.5],
    ["wet", "e.setWet(true)", 1.5],
    ["day, dry", "e.setNight(false); e.setWet(false)", 1],
    ...["low", "off", "high", "minimal"].map((t) => [`fx ${t}`, `e.setFxTier("${t}")`, 1.5]),
    ["derby", "e.toggleDerby()", 6],
    ["derby off", "e.toggleDerby()", 1],
    ["pistons, fire all", "e.togglePistons(); e.firePiston(8)", 4],
    ["pistons off", "e.togglePistons()", 1],
    ["door ram", "e.toggleDoors(); e.fireDoorRam('shut')", 3],
    ["doors off", "e.toggleDoors()", 1],
    ["compactor", "e.toggleCompactor()", 8],
    ["compactor off", "e.toggleCompactor()", 1],
    ["barrier", "e.toggleBarrier()", 6],
    ["barrier off", "e.toggleBarrier()", 1],
    ["balls", "e.toggleBalls()", 6],
    ["balls off", "e.toggleBalls()", 1],
    ["debug views", "e.toggleRig(); e.toggleParticles()", 1],
    ["debug views off", "e.toggleRig(); e.toggleParticles()", 0.5],
  ];
  for (const [label, body, s] of more) {
    const tier = /^fx (\w+)$/.exec(label)?.[1];
    if (tier) {
      await tierSwitch(label, tier, late);
      continue;
    }
    console.log(`- ${label}`);
    await run(body);
    await wait(s);
  }
  const after = await programs();
  const known = new Set(warm.map(programId));
  const played = after.filter((p) => !known.has(programId(p)));
  console.log(`programs after warm-up: ${warm.length}, after play: ${after.length}`);
  for (const p of played) console.log(`  linked mid-play: ${p.type} …${p.key.slice(-80).replace(/\s+/g, " ")}`);
  late.push(...played);
  // The finish draws only at the post tiers, into the HDR target: a canvas program for it is a link that never draws.
  const finishOutputs = after.filter((p) => p.key.includes(FINISH_KEY_MARK)).map((p) => outputOf(p.key));
  const twins = finishOutputs.filter((o) => o !== "srgb-linear").length;
  console.log(`finish programs: ${finishOutputs.length - twins} for the HDR target, ${twins} for the canvas or unknown`);
  if (twins > 0) late.push({ type: "finish canvas twin", key: `${twins} programs` });

  // Race: each course loads in the setup menu (its warm-up runs there and in the countdown); nothing may link once racing.
  await run("e.toggleRace()");
  for (const id of await run("return e.race.courses.map((c) => c.id)")) {
    await run(`e.raceCommand({ type: "options", options: { trackId: "${id}", aiCount: 7, laps: 9 } }); e.raceCommand({ type: "start" })`);
    await page.waitForFunction(() => window.__crush.race.hud().phase === "racing", null, { timeout: 60_000 });
    const green = new Set((await programs()).map(programId));
    // The player car rides the AI's racing line (out of drive mode the brain steers it) for 12 s.
    for (let t = 0; t < 12; t++) {
      await run("if (e.seat.mode === 'drive') e.seat.mode = 'follow'");
      await wait(1);
    }
    const raced = (await programs()).filter((p) => !green.has(programId(p)));
    console.log(`- race ${id}: ${green.size} programs at the green light, ${raced.length} linked while racing`);
    for (const p of raced) console.log(`  linked mid-race: ${p.type} …${p.key.slice(-80).replace(/\s+/g, " ")}`);
    late.push(...raced);
    await run(`e.raceCommand({ type: "end" }); e.raceCommand({ type: "quit" })`);
  }
  await run("e.toggleRace()");

  await sprayedSwitches(late);
  console.log(`programs per tier: ${[...perTier].map(([t, n]) => `${t} ${n}`).join(", ")}`);
  const finishKinds = new Map();
  for (const p of await programs()) if (p.key.includes(FINISH_KEY_MARK)) finishKinds.set(customKey(p.key), (finishKinds.get(customKey(p.key)) ?? 0) + 1);
  console.log(`finish programs by key: ${[...finishKinds].map(([k, n]) => `${k} ×${n}`).join(", ")}`);

  if (errors.length) console.log(`console errors:\n  ${errors.slice(0, 8).join("\n  ")}`);
  process.exitCode = late.length || errors.length ? 1 : 0;
} finally {
  await browser.close();
}
