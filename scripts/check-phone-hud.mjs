#!/usr/bin/env node
/**
 * Phone HUD guard. The touch HUD must never cover the road, put a driving control under a panel, hide a control behind the
 * notch, or leave a control smaller than a fingertip. This opens the game in headless Chromium as a phone (Playwright's device
 * descriptors, touch on, the safe-area insets of a notch phone through CDP), walks every place a phone player goes, and checks
 * each screen against the numbers below. Then it drives with real multi-touch (CDP touch points: steer with one finger while
 * another holds Brake or Gas), switches schemes, and tilts the emulated phone.
 *
 *   node scripts/check-phone-hud.mjs [--url http://127.0.0.1:8109/] [--out DIR] [--only screen,screen] [--devices pixel-7-landscape,...]
 *
 * Needs a running dev or preview server (docs/DEPLOY.md). CHROME_PATH picks the browser. Shots go to --out (default: nowhere).
 */
import { chromium, devices } from "playwright";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: flags } = parseArgs({ options: { url: { type: "string" }, out: { type: "string" }, only: { type: "string" }, devices: { type: "string" } } });
const BASE = (flags.url ?? "http://127.0.0.1:8081/").replace(/\/?$/, "/");
const OUT = flags.out ?? null;
if (OUT) mkdirSync(OUT, { recursive: true });

/** The smallest hit target: Apple's 44 pt, in CSS px (0.5 of rounding slack). */
const MIN_TARGET = 44;
const TARGET_SLACK = 0.5;
/** The road: the middle half of the width, 15 % to 70 % of the height. Nothing persistent may cover more than this share of it while driving. */
const ROAD_ZONE = { left: 0.25, right: 0.75, top: 0.15, bottom: 0.7 };
const ROAD_MAX_COVERED_PCT = { landscape: 5, portrait: 8 };
const GRID_CELL = 4;
const LOAD_MS = 120_000;
const SETTLE_MS = 1500;
/** What a notch phone on its side takes from each edge (CSS px): the camera cut-out side, the home-indicator bar. */
const NOTCH_INSETS = { top: 0, left: 47, bottom: 21, right: 47 };

const DEVICES = [
  { id: "pixel-7-landscape", descriptor: "Pixel 7 landscape", orientation: "landscape" },
  { id: "pixel-7", descriptor: "Pixel 7", orientation: "portrait" },
  { id: "iphone-14-landscape", descriptor: "iPhone 14 landscape", orientation: "landscape", insets: NOTCH_INSETS },
  { id: "iphone-14", descriptor: "iPhone 14", orientation: "portrait", insets: { top: 47, left: 0, bottom: 34, right: 0 } },
].filter((device) => !flags.devices || flags.devices.split(",").includes(device.id));

const evaluate = (page, fn, arg) => page.evaluate(fn, arg);
const settle = (page, ms) => page.waitForTimeout(ms);
const holdGas = (page) => evaluate(page, () => window.__crush.keys.add("KeyW"));
const startRace = async (page) => {
  await evaluate(page, () => window.__crush.race.reseed(1));
  await evaluate(page, () => window.__crush.raceCommand({ type: "options", options: { trackId: "city", aiCount: 7 } }));
  await evaluate(page, () => window.__crush.raceCommand({ type: "start" }));
};
const driveRace = async (page) => {
  await startRace(page);
  await settle(page, 9000);
};

/**
 * Screens: `driving` screens must keep the road clear and hold the driving controls; `sheet` screens are menus and only get the
 * target, overlap and clip checks. `setup` runs after load.
 */
const SCREENS = {
  "race-drive": { hash: "scene=race", driving: true, setup: driveRace, expect: ["steer", "pause", "view"] },
  // Survival says "Chased by N cops" all run long, the one thing it must always say: it may take a little more of the road's top edge.
  "survival-drive": { hash: "scene=survival", driving: true, roadAllowancePct: 5, setup: async (page) => { await evaluate(page, () => window.__crush.raceCommand({ type: "start" })); await settle(page, 8000); }, expect: ["steer", "pause"] },
  "fleet-drive": { hash: "", driving: true, setup: async (page) => { await evaluate(page, () => window.__crush.seat.focus(0)); await settle(page, 2500); }, expect: ["steer", "view"] },
  "mini-longjump": { hash: "scene=range", driving: true, setup: async (page) => { await evaluate(page, () => window.__crush.startMinigame("longJump")); await settle(page, 3500); }, expect: ["steer", "boost"] },
  "derby-drive": { hash: "scene=derby&cars=14&seed=7", driving: true, setup: async (page) => { await settle(page, 6000); }, expect: [] },
  "race-pause": { hash: "scene=race", sheet: true, setup: async (page) => { await startRace(page); await settle(page, 5000); await page.locator("[data-touch-control=pause]").tap(); await settle(page, 900); } },
  "race-results": { hash: "scene=race", sheet: true, setup: async (page) => { await startRace(page); await settle(page, 5000); await evaluate(page, () => window.__crush.raceCommand({ type: "end" })); await settle(page, 2500); } },
  "race-setup": { hash: "scene=race", sheet: true },
  "garage": { hash: "scene=garage", sheet: true },
  "home": { hash: "", sheet: true, setup: async (page) => { await page.getByRole("button", { name: /^menu$/i }).first().tap(); await settle(page, 700); } },
};

/** Browser-side measurement of everything visible: controls, painted surfaces and text runs, as rects. */
const PROBE = ([cell, zone]) => {
  const vw = innerWidth;
  const vh = innerHeight;
  const live = (el) => {
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) < 0.05) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh ? r : null;
  };
  // A dialog (a sheet, a race menu) owns the screen: what sits under it is not what the player sees, so only its own content is checked.
  const modal = [...document.querySelectorAll("[role=dialog]")].find((el) => live(el));
  const inScope = (el) => !modal || modal.contains(el);
  /** The part of `rect` that shows through every scrolling or clipping ancestor of `el`; null when under half of it does (scrolled away). */
  const shown = (el, rect) => {
    let [left, top, right, bottom] = [rect.left, rect.top, rect.right, rect.bottom];
    for (let ancestor = el.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (!/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
      const box = ancestor.getBoundingClientRect();
      [left, top, right, bottom] = [Math.max(left, box.left), Math.max(top, box.top), Math.min(right, box.right), Math.min(bottom, box.bottom)];
    }
    const area = Math.max(0, right - left) * Math.max(0, bottom - top);
    return area >= 0.5 * rect.width * rect.height ? { left, top, right, bottom } : null;
  };
  const label = (el) => (el.getAttribute("data-touch-control") || el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 32);
  const controls = [...document.querySelectorAll("button,a[href],input,select,[role=slider],[data-touch-control]")]
    .filter((el) => !el.closest("[inert]") && inScope(el))
    .map((el) => {
      const r = live(el);
      return { el, r, v: r ? shown(el, r) : null };
    })
    .filter((c) => c.r && c.v);
  const painted = (el, style) => el.tagName === "svg" || (style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent") || style.backgroundImage !== "none" || style.boxShadow !== "none";
  const surfaces = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (el.tagName === "CANVAS" || el.closest("#boot-loader,[inert]") || el instanceof HTMLScriptElement || el instanceof HTMLStyleElement) continue;
    const r = live(el);
    if (!r || (el.tagName !== "svg" && el instanceof SVGElement)) continue;
    if (painted(el, getComputedStyle(el)) && r.width * r.height < vw * vh * 0.85) surfaces.push(r);
  }
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!node.textContent.trim() || !parent || parent.closest("#boot-loader,script,style,canvas,[inert]") || !live(parent) || !inScope(parent)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      const v = r.width > 0 && r.height > 0 ? shown(parent, r) : null;
      if (v) texts.push({ r: v, parent, words: node.textContent.trim().slice(0, 24) });
    }
  }
  const covered = new Set();
  const mark = (r) => {
    for (let x = Math.max(0, Math.floor(r.left / cell)); x < Math.min(vw, r.right) / cell; x++) for (let y = Math.max(0, Math.floor(r.top / cell)); y < Math.min(vh, r.bottom) / cell; y++) covered.add(`${x},${y}`);
  };
  for (const r of [...surfaces, ...texts.map((t) => t.r), ...controls.map((c) => c.r)]) mark(r);
  let cells = 0;
  let hit = 0;
  for (let x = Math.floor((zone.left * vw) / cell); x < (zone.right * vw) / cell; x++) {
    for (let y = Math.floor((zone.top * vh) / cell); y < (zone.bottom * vh) / cell; y++) {
      cells++;
      if (covered.has(`${x},${y}`)) hit++;
    }
  }
  const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
  const crossings = [];
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i];
      const b = controls[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (overlap(a.v, b.v)) crossings.push(`${label(a.el)} x ${label(b.el)}`);
    }
    for (const text of texts) {
      if (controls[i].el.contains(text.parent) || text.parent.contains(controls[i].el)) continue;
      // The dial's numerals and its bottle are one cluster: the bottle's tap target is meant to sit on the dial's face.
      if (controls[i].el.closest(".drive-cluster") && controls[i].el.closest(".drive-cluster") === text.parent.closest(".drive-cluster")) continue;
      if (overlap(controls[i].v, text.r)) crossings.push(`${label(controls[i].el)} x text "${text.words}"`);
    }
  }
  return {
    viewport: [vw, vh],
    roadCoveredPct: Math.round((hit / cells) * 1000) / 10,
    names: controls.map((c) => c.el.getAttribute("data-touch-control")).filter(Boolean),
    small: controls.filter((c) => Math.min(c.r.width, c.r.height) < 44 - 0.5 && !c.el.closest("[data-target-exempt]")).map((c) => `${label(c.el)} ${Math.round(c.r.width)}x${Math.round(c.r.height)}`),
    clipped: controls.filter((c) => c.v.left < -1 || c.v.top < -1 || c.v.right > vw + 1 || c.v.bottom > vh + 1).map((c) => label(c.el)),
    rects: controls.map((c) => ({ name: label(c.el), left: c.v.left, top: c.v.top, right: c.v.right, bottom: c.v.bottom })),
    crossings,
  };
};

const failures = [];
const fail = (context, message) => {
  failures.push(`${context}: ${message}`);
  console.log(`  FAIL ${message}`);
};

async function open(browser, device, hash, { scheme } = {}) {
  const context = await browser.newContext({ ...devices[device.descriptor], hasTouch: true });
  if (scheme) await context.addInitScript((value) => localStorage.setItem("crush.touch.scheme", value), scheme);
  await context.addInitScript(() => localStorage.setItem("crush.home.seen", "1"));
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (device.insets) await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: device.insets });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${BASE}?fx=low#${hash}`, { waitUntil: "commit" });
  await page.waitForFunction(() => window.__crush && !window.__crush.fxLoading, null, { timeout: LOAD_MS });
  await page.waitForFunction(() => { const fade = window.__crush.sceneFade; return fade.pending === null && fade.black === 0 && fade.cel === 0; }, null, { timeout: 60_000 });
  await page.waitForFunction(() => document.getElementById("boot-loader") === null, null, { timeout: 60_000 });
  await settle(page, SETTLE_MS);
  return { context, page, cdp, errors };
}

const centre = (rect) => ({ x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 });
const rectOf = async (page, name) => {
  const box = await page.locator(`[data-touch-control=${name}]`).first().boundingBox();
  return box ? { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height } : null;
};
/** Real touch points through CDP: `points` = [{ id, x, y }]. */
const touch = (cdp, type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(({ id, x, y }) => ({ id, x, y, radiusX: 2, radiusY: 2, force: 1 })) });
const readTouch = (page) => evaluate(page, () => ({ x: window.__crush.touch.x, gas: window.__crush.touch.gas, brake: window.__crush.touch.brake, held: window.__crush.touch.held }));

async function checkScreen(browser, device, name, screen) {
  const context = `${device.id} ${name}`;
  console.log(context);
  const { context: browserContext, page, errors } = await open(browser, device, screen.hash);
  try {
    if (screen.setup) await screen.setup(page);
    const probe = await evaluate(page, PROBE, [GRID_CELL, ROAD_ZONE]);
    if (OUT) await page.screenshot({ path: join(OUT, `${name}.${device.id}.png`), scale: "css" });
    console.log(`  road ${probe.roadCoveredPct}%  controls ${probe.rects.length}  small ${probe.small.length}  crossings ${probe.crossings.length}`);
    if (probe.rects.length === 0) fail(context, "found no controls at all (a blind probe proves nothing)");
    if (probe.small.length > 0) fail(context, `targets under ${MIN_TARGET} px: ${probe.small.join("; ")}`);
    if (probe.clipped.length > 0) fail(context, `controls off the screen: ${probe.clipped.join("; ")}`);
    if (probe.crossings.length > 0) fail(context, `overlaps: ${[...new Set(probe.crossings)].join("; ")}`);
    if (screen.driving) {
      const limit = ROAD_MAX_COVERED_PCT[device.orientation] + (screen.roadAllowancePct ?? 0);
      if (probe.roadCoveredPct > limit) fail(context, `the road zone is ${probe.roadCoveredPct}% covered (limit ${limit}%)`);
      for (const expected of screen.expect) if (!probe.names.includes(expected)) fail(context, `control "${expected}" is missing`);
    }
    if (device.insets) {
      const { top, left, bottom, right } = device.insets;
      const [vw, vh] = probe.viewport;
      const inside = probe.rects.filter((rect) => rect.left < left - 1 || rect.right > vw - right + 1 || rect.top < top - 1 || rect.bottom > vh - bottom + 1);
      const covering = inside.filter((rect) => !/^(Back|Close|Done)/.test(rect.name) && rect.right - rect.left < vw * 0.8);
      if (covering.length > 0) fail(context, `controls inside the safe-area insets: ${covering.map((rect) => rect.name).join("; ")}`);
    }
    if (errors.length > 0) fail(context, `page errors: ${errors.join(" | ")}`);
  } finally {
    await browserContext.close();
  }
}

/** Steer with one finger and brake with another, at the same time, as real thumbs do. */
async function checkTwoFingers(browser, device) {
  const context = `${device.id} two fingers (Easy)`;
  console.log(context);
  const { context: browserContext, page, cdp } = await open(browser, device, "scene=race");
  try {
    await startRace(page);
    await settle(page, 9000);
    const steer = await rectOf(page, "steer");
    const brake = await rectOf(page, "brake");
    if (!steer || !brake) return fail(context, "no steer or brake control on the race screen");
    const idle = await readTouch(page);
    if (idle.gas !== 1) fail(context, `Easy drives itself: expected gas 1 with no finger down, got ${idle.gas}`);
    const steerPoint = { id: 1, x: steer.right - 12, y: centre(steer).y };
    const brakePoint = { id: 2, ...centre(brake) };
    await touch(cdp, "touchStart", [steerPoint]);
    await touch(cdp, "touchStart", [steerPoint, brakePoint]);
    await touch(cdp, "touchMove", [{ ...steerPoint, x: steerPoint.x - 1 }, brakePoint]);
    await settle(page, 200);
    const both = await readTouch(page);
    if (!(both.x > 0.3)) fail(context, `steering finger: expected x > 0.3 (right), got ${both.x}`);
    if (both.brake !== 1 || both.gas !== 0) fail(context, `brake finger while steering: expected brake 1 and gas 0, got brake ${both.brake} gas ${both.gas}`);
    await touch(cdp, "touchEnd", [steerPoint]);
    await settle(page, 200);
    const brakeOnly = await readTouch(page);
    if (!(Math.abs(brakeOnly.x) < 0.05 && brakeOnly.brake === 1)) fail(context, `steering finger up: expected x 0 and the brake still held, got x ${brakeOnly.x} brake ${brakeOnly.brake}`);
    await touch(cdp, "touchEnd", []);
    await settle(page, 200);
    const released = await readTouch(page);
    if (released.gas !== 1 || released.brake !== 0) fail(context, `all fingers up: expected gas 1 brake 0, got gas ${released.gas} brake ${released.brake}`);
    console.log(`  idle ${JSON.stringify(idle)}  both ${JSON.stringify(both)}  brake-only ${JSON.stringify(brakeOnly)}  released ${JSON.stringify(released)}`);
  } finally {
    await browserContext.close();
  }
}

async function checkPedalsScheme(browser, device) {
  const context = `${device.id} Pedals scheme`;
  console.log(context);
  const { context: browserContext, page, cdp } = await open(browser, device, "scene=race", { scheme: "pedals" });
  try {
    await startRace(page);
    await settle(page, 9000);
    const gas = await rectOf(page, "gas");
    const steer = await rectOf(page, "steer");
    if (!gas || !steer) return fail(context, "no gas or steer control in the Pedals scheme");
    const idle = await readTouch(page);
    if (idle.gas !== 0) fail(context, `no finger on Gas: expected gas 0, got ${idle.gas}`);
    const gasPoint = { id: 1, ...centre(gas) };
    const steerPoint = { id: 2, x: steer.left + 12, y: centre(steer).y };
    await touch(cdp, "touchStart", [gasPoint]);
    await touch(cdp, "touchStart", [gasPoint, steerPoint]);
    await settle(page, 200);
    const both = await readTouch(page);
    if (both.gas !== 1 || !(both.x < -0.3)) fail(context, `Gas + steering left: expected gas 1 and x < -0.3, got gas ${both.gas} x ${both.x}`);
    await touch(cdp, "touchEnd", []);
    console.log(`  idle ${JSON.stringify(idle)}  both ${JSON.stringify(both)}`);
  } finally {
    await browserContext.close();
  }
}

async function checkTilt(browser, device) {
  const context = `${device.id} Tilt scheme`;
  console.log(context);
  const { context: browserContext, page, cdp } = await open(browser, device, "scene=race", { scheme: "tilt" });
  try {
    await startRace(page);
    await settle(page, 9000);
    // The attitudes are the ones the unit tests derive: level, then a clockwise turn of the wheel by 20 degrees (landscape, top of the phone to the left).
    const level = device.orientation === "landscape" ? { alpha: 0, beta: 0, gamma: -90 } : { alpha: 0, beta: 90, gamma: 0 };
    const turned = device.orientation === "landscape" ? { alpha: 0, beta: 20, gamma: -90 } : { alpha: 0, beta: 70, gamma: 90 };
    await cdp.send("DeviceOrientation.setDeviceOrientationOverride", level);
    await settle(page, 400);
    const centred = await readTouch(page);
    await cdp.send("DeviceOrientation.setDeviceOrientationOverride", turned);
    await settle(page, 400);
    const right = await readTouch(page);
    console.log(`  level ${JSON.stringify(centred)}  turned ${JSON.stringify(right)}`);
    if (Math.abs(centred.x) > 0.05) fail(context, `level phone: expected x 0, got ${centred.x}`);
    if (!(right.x > 0.5)) fail(context, `phone turned 20 degrees clockwise: expected x > 0.5, got ${right.x}`);
    if (right.gas !== 1) fail(context, `Tilt drives itself: expected gas 1, got ${right.gas}`);
  } finally {
    await browserContext.close();
  }
}

process.env.GALLIUM_DRIVER ??= "d3d12";
const chromePath = process.env.CHROME_PATH ?? newestChromium();
function newestChromium() {
  if (existsSync(chromium.executablePath())) return undefined;
  const cache = join(homedir(), ".cache", "ms-playwright");
  const dirs = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
  return dirs.map((d) => join(cache, d, "chrome-linux64", "chrome")).find(existsSync);
}
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--ignore-gpu-blocklist", "--enable-gpu", "--mute-audio", "--use-gl=angle", "--use-angle=gl"] });
try {
  const only = flags.only?.split(",");
  for (const device of DEVICES) {
    for (const [name, screen] of Object.entries(SCREENS)) {
      if (only && !only.includes(name)) continue;
      try {
        await checkScreen(browser, device, name, screen);
      } catch (error) {
        fail(`${device.id} ${name}`, `could not run: ${String(error).split("\n")[0]}`);
      }
    }
    if (only && !only.includes("touch")) continue;
    for (const check of [checkTwoFingers, checkPedalsScheme, checkTilt]) {
      try {
        await check(browser, device);
      } catch (error) {
        fail(`${device.id} ${check.name}`, `could not run: ${String(error).split("\n")[0]}`);
      }
    }
  }
} finally {
  await browser.close();
}
if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s):\n${failures.map((line) => `- ${line}`).join("\n")}`);
  process.exit(1);
}
console.log("\nphone HUD guard: all screens clean");
