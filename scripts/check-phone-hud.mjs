#!/usr/bin/env node
/**
 * Phone HUD guard. The touch HUD must never cover the road, put a driving control under a panel, hide a control behind the
 * notch, or leave a control smaller than a fingertip. This opens the game in headless Chromium as a phone (Playwright's device
 * descriptors, touch on, the safe-area insets of a notch phone through CDP), walks every place a phone player goes, and checks
 * each screen against the numbers below. Then it drives with real multi-touch (CDP touch points) through a two-thumb script per
 * control scheme (gas + steer, brake + steer, e-brake mid-steer, a drift, Boost as a tap), and tilts the emulated phone.
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

/** The smallest hit target: Apple's 44 pt, in CSS px (the probe allows 0.5 px of rounding). */
const MIN_TARGET = 44;
/** The road: the middle half of the width, 15 % to 70 % of the height. Nothing persistent may cover more than this share of it while driving. */
const ROAD_ZONE = { left: 0.25, right: 0.75, top: 0.15, bottom: 0.7 };
/** Landscape allows 8: on a 340 px phone the speed dial at the bottom centre reaches 20 px into the zone. */
const ROAD_MAX_COVERED_PCT = { landscape: 8, portrait: 8 };
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
  // The smallest phone the controls must fit (360 x 740) and a tablet, upright and on its side.
  { id: "small-360", descriptor: "Pixel 5", viewport: { width: 360, height: 740 }, orientation: "portrait" },
  { id: "small-360-landscape", descriptor: "Pixel 5 landscape", viewport: { width: 740, height: 360 }, orientation: "landscape" },
  { id: "ipad-mini", descriptor: "iPad Mini", orientation: "portrait" },
  { id: "ipad-mini-landscape", descriptor: "iPad Mini landscape", orientation: "landscape" },
].filter((device) => !flags.devices || flags.devices.split(",").includes(device.id));

/** The system's edge gestures (Android back, iOS edge swipe) begin in the first 20 px of the screen: a thumb control of the two-thumb schemes keeps clear of them. */
const GESTURE_EDGE = 20;
const THUMB_CONTROLS = ["steer", "pedal-strip", "brake", "boost", "handbrake", "onfoot"];

const evaluate = (page, fn, arg) => page.evaluate(fn, arg);
const settle = (page, ms) => page.waitForTimeout(ms);
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
  // The default scheme is the driving disc (Boost and Handbrake beside the dial's corner, Out over Boost); the fullscreen toggle is one tap from every driving screen.
  "race-drive": { hash: "scene=race", driving: true, setup: driveRace, expect: ["steer", "boost", "onfoot", "pause", "view", "fullscreen"] },
  // The two-thumb schemes: the left thumb steers (and pulls down for the e-brake), the right holds the pedals; neither may overlap, leave the screen or sit in the gesture edge.
  "race-pedals": { hash: "scene=race", scheme: "pedals", driving: true, edgeGuard: true, setup: driveRace, expect: ["steer", "pedal-strip", "onfoot", "pause", "view", "fullscreen"], absent: ["boost", "handbrake"] },
  // Easy's gas is automatic: the pad's handbrake holds the car on the grid, as the other schemes' idle thumbs do, so the moving race's standings do not swamp the control measurement.
  "race-easy": { hash: "scene=race", scheme: "autogas", driving: true, edgeGuard: true, setup: async (page) => { await startRace(page); await evaluate(page, () => Object.assign(window.__crush.touch, { gas: 0, brake: 0, held: 1 << 2 })); await settle(page, 9000); }, expect: ["steer", "brake", "boost", "onfoot", "pause", "view", "fullscreen"], absent: ["pedal-strip", "handbrake"] },
  "race-tilt": { hash: "scene=race", scheme: "tilt", driving: true, edgeGuard: true, setup: driveRace, expect: ["steer", "handbrake", "pedal-strip", "onfoot", "pause", "view", "fullscreen"], absent: ["boost"] },
  // Out tapped on Easy's grid (its handbrake holding the car, as above): on foot Easy draws the Pedals strip, the walk's forward axis, and Out has become In.
  "race-onfoot": { hash: "scene=race", scheme: "autogas", driving: true, edgeGuard: true, setup: async (page) => { await startRace(page); await evaluate(page, () => Object.assign(window.__crush.touch, { gas: 0, brake: 0, held: 1 << 2 })); await settle(page, 9000); await page.locator("[data-touch-control=onfoot]").tap(); await settle(page, 2000); }, expect: ["steer", "pedal-strip", "onfoot", "pause", "fullscreen"], absent: ["brake"], onFoot: true },
  // Survival says "Chased by N cops" all run long, the one thing it must always say: it may take a little more of the road's top edge.
  "survival-drive": { hash: "scene=survival", driving: true, roadAllowancePct: 5, setup: async (page) => { await evaluate(page, () => window.__crush.raceCommand({ type: "start" })); await settle(page, 8000); }, expect: ["steer", "onfoot", "pause", "fullscreen"] },
  "fleet-drive": { hash: "", driving: true, // Following one of five cars: the cycle has somewhere to go, so Prev and Next show.
     setup: async (page) => { await evaluate(page, () => window.__crush.seat.focus(0)); await settle(page, 2500); }, expect: ["steer", "view", "fullscreen", "prev", "next"] },
  // The card with the score and the bail prompt stays up through the run, in the zone's upper left corner: it is what the player is playing for.
  "mini-longjump": { hash: "scene=range", driving: true, roadAllowancePct: 7, setup: async (page) => { await evaluate(page, () => window.__crush.startMinigame("longJump")); await settle(page, 3500); }, expect: ["steer", "boost", "fullscreen"], absent: ["prev", "next"] },
  // The folded Board header (a 44 px strip, 11 rem wide) is the one thing a derby keeps on screen; upright it reaches into the zone's left edge.
  "derby-drive": { hash: "scene=derby&cars=14&seed=7", driving: true, roadAllowancePct: 2, setup: async (page) => { await settle(page, 14000); }, expect: ["fullscreen"], absent: ["prev", "next"] },
  // Nothing is watched (the whole field in view), one car in the scene, a derby field of fourteen: no Prev / Next, and no room kept for them.
  "fleet-whole": { hash: "", absent: ["prev", "next"], expect: [] },
  "garage-alone": { hash: "scene=garage", absent: ["prev", "next"], expect: [] },
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
  const pinned = (node) => {
    for (let up = node; up && up !== document.body; up = up.parentElement) if (getComputedStyle(up).position === "sticky") return true;
    return false;
  };
  const label = (el) => (el.getAttribute("data-touch-control") || el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 32);
  const controls = [...document.querySelectorAll("button,a[href],input,select,[role=slider],[data-touch-control]")]
    .filter((el) => !el.closest("[inert]") && inScope(el))
    .map((el) => {
      const r = live(el);
      const v = r ? shown(el, r) : null;
      return { el, r, v, scrolledAt: pinned(el) || (v !== null && (v.right - v.left < r.width - 1 || v.bottom - v.top < r.height - 1)) };
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
      // Screen-reader-only text (a 1 px clipped box) is not on the screen.
      const v = r.width > 2 && r.height > 2 && parent.getBoundingClientRect().width > 2 ? shown(parent, r) : null;
      if (v) texts.push({ r: v, parent, words: node.textContent.trim().slice(0, 24), scrolledAt: pinned(parent) || v.right - v.left < r.width - 1 || v.bottom - v.top < r.height - 1 });
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
      // A row half scrolled under a pinned bar is the bar doing its job, not two controls on top of each other.
      if (a.scrolledAt || b.scrolledAt) continue;
      if (overlap(a.v, b.v)) crossings.push(`${label(a.el)} x ${label(b.el)}`);
    }
    for (const text of texts) {
      if (controls[i].el.contains(text.parent) || text.parent.contains(controls[i].el) || text.scrolledAt || controls[i].scrolledAt) continue;
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

async function open(browser, device, hash, { scheme, query = "" } = {}) {
  const context = await browser.newContext({ ...devices[device.descriptor], ...(device.viewport ? { viewport: device.viewport, screen: device.viewport } : {}), hasTouch: true });
  if (scheme) await context.addInitScript((value) => localStorage.setItem("crush.touch.scheme", value), scheme);
  await context.addInitScript(() => localStorage.setItem("crush.home.seen", "1"));
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (device.insets) await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: device.insets });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${BASE}?fx=low${query}#${hash}`, { waitUntil: "commit" });
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
const readTouch = (page) => evaluate(page, () => ({ x: window.__crush.touch.x, y: window.__crush.touch.y, gas: window.__crush.touch.gas, brake: window.__crush.touch.brake, held: window.__crush.touch.held, rt: window.__crush.pad.state.rt, lt: window.__crush.pad.state.lt, lx: window.__crush.pad.state.lx }));

async function checkScreen(browser, device, name, screen) {
  const context = `${device.id} ${name}`;
  console.log(context);
  const { context: browserContext, page, errors } = await open(browser, device, screen.hash, { scheme: screen.scheme });
  try {
    if (screen.setup) await screen.setup(page);
    if (screen.onFoot && !/back in/i.test((await page.locator("[data-touch-control=onfoot]").first().getAttribute("aria-label")) ?? "")) fail(context, "the Out tap did not get the player out (the button is not In)");
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
    for (const unwanted of screen.absent ?? []) if (probe.names.includes(unwanted)) fail(context, `control "${unwanted}" is drawn where it means nothing`);
    if (screen.edgeGuard) {
      const [vw] = probe.viewport;
      const inGesture = probe.rects.filter((rect) => THUMB_CONTROLS.includes(rect.name) && (rect.left < GESTURE_EDGE - 1 || rect.right > vw - GESTURE_EDGE + 1));
      if (inGesture.length > 0) fail(context, `thumb controls in the ${GESTURE_EDGE} px system-gesture edge (screen width ${vw}): ${inGesture.map((rect) => `${rect.name} ${Math.round(rect.left)}..${Math.round(rect.right)}`).join("; ")}`);
    }
    if (device.insets) {
      const { top, left, bottom, right } = device.insets;
      const [vw, vh] = probe.viewport;
      const inside = probe.rects.filter((rect) => rect.left < left - 1 || rect.right > vw - right + 1 || rect.top < top - 1 || rect.bottom > vh - bottom + 1);
      const covering = inside.filter((rect) => !/^(Back|Close|Done)/.test(rect.name) && rect.right - rect.left < vw * 0.8);
      if (covering.length > 0) fail(context, `controls inside the safe-area insets (screen ${vw} x ${vh}, insets ${JSON.stringify(device.insets)}): ${covering.map((rect) => `${rect.name} at ${Math.round(rect.left)},${Math.round(rect.top)} to ${Math.round(rect.right)},${Math.round(rect.bottom)}`).join("; ")}`);
    }
    if (errors.length > 0) fail(context, `page errors: ${errors.join(" | ")}`);
  } finally {
    await browserContext.close();
  }
}

/** Where a scripted finger goes: on its control's rect (the steering bar: offset from the bar's middle; the strip: a share of its height, from the foot). */
const BAR_HEIGHT = 72;
const CONTROL_NAME = { steer: "steer", strip: "pedal-strip", brake: "brake", hand: "handbrake", boost: "boost" };
const EBRAKE_BIT = 1 << 2;
const BOOST_BIT = 1 << 0;
const fingerPoint = (rects, { on, dx = 0, dy = 0, at = 0 }) => {
  const rect = rects[on];
  if (on === "strip") return { x: centre(rect).x, y: rect.bottom - 1 - at * (rect.bottom - rect.top - 2) };
  if (on === "steer") return { x: centre(rect).x + dx, y: rect.top + BAR_HEIGHT / 2 + dy };
  return centre(rect);
};

/**
 * One two-thumb script per non-disc scheme, as a BDD table: each row is every finger down at that moment (a finger carried from row to row is a drag) and
 * what the pad must read then. `x` is the wheel, `gas` and `brake` the pedals, `ebrake` and `boost` the pad's buttons; a key a row leaves out is not checked.
 */
const THUMB_SCRIPTS = {
  pedals: [
    { it: "no finger down: nothing is pressed", fingers: [], x: [-0.05, 0.05], gas: [0, 0], brake: [0, 0], ebrake: false, boost: false },
    { it: "gas on the strip while steering right on the bar", fingers: [{ id: 1, on: "steer", dx: 60 }, { id: 2, on: "strip", at: 0.6 }], x: [0.3, 1], gas: [0.3, 1], brake: [0, 0], ebrake: false },
    { it: "brake at the foot of the strip while still steering right", fingers: [{ id: 1, on: "steer", dx: 60 }, { id: 2, on: "strip", at: 0 }], x: [0.3, 1], gas: [0, 0], brake: [0.9, 1], ebrake: false },
    { it: "the coast band while steering: neither pedal", fingers: [{ id: 1, on: "steer", dx: 60 }, { id: 2, on: "strip", at: 0.34 }], x: [0.3, 1], gas: [0, 0], brake: [0, 0] },
    { it: "e-brake mid-steer: the steering thumb pulls down with gas held (a drift)", fingers: [{ id: 1, on: "steer", dx: 60, dy: 60 }, { id: 2, on: "strip", at: 0.6 }], x: [0.3, 1], gas: [0.3, 1], ebrake: true },
    { it: "the steering thumb comes back up: the e-brake lets go, the wheel and gas stay", fingers: [{ id: 1, on: "steer", dx: 60 }, { id: 2, on: "strip", at: 0.6 }], x: [0.3, 1], gas: [0.3, 1], ebrake: false },
    { it: "the strip thumb slides into the cap: full gas and a Boost press", fingers: [{ id: 1, on: "steer" }, { id: 2, on: "strip", at: 0.95 }], gas: [1, 1], boost: true },
    { it: "the thumb slides back to half gas: the Boost burst plays on (a tap, not a hold)", fingers: [{ id: 1, on: "steer" }, { id: 2, on: "strip", at: 0.6 }], gas: [0.3, 1], boost: true },
    { it: "the thumb eases to the coast band: the burst ends", fingers: [{ id: 1, on: "steer" }, { id: 2, on: "strip", at: 0.34 }], gas: [0, 0], boost: false },
    { it: "every finger up: nothing is pressed", fingers: [], x: [-0.05, 0.05], gas: [0, 0], brake: [0, 0], ebrake: false, boost: false },
  ],
  autogas: [
    { it: "no finger down: the gas is on by itself", fingers: [], gas: [1, 1], brake: [0, 0], ebrake: false },
    { it: "brake on the pad while steering right: the gas lifts", fingers: [{ id: 1, on: "steer", dx: 60 }, { id: 2, on: "brake" }], x: [0.3, 1], gas: [0, 0], brake: [1, 1] },
    { it: "brake lifts, the wheel stays: the gas is back", fingers: [{ id: 1, on: "steer", dx: 60 }], x: [0.3, 1], gas: [1, 1], brake: [0, 0] },
    { it: "e-brake mid-steer: the steering thumb pulls down under the automatic gas", fingers: [{ id: 1, on: "steer", dx: 60, dy: 60 }], x: [0.3, 1], gas: [1, 1], ebrake: true },
    { it: "every finger up: the e-brake lets go", fingers: [], ebrake: false },
    { it: "a tap on Boost: the burst is on with no finger down", fingers: [], tap: "boost", boost: true, gas: [1, 1] },
    { it: "brake on the pad: the burst ends", fingers: [{ id: 1, on: "brake" }], boost: false, brake: [1, 1] },
  ],
  tilt: [
    { it: "level phone, no finger: nothing steers, nothing is pressed", fingers: [], tilt: "level", x: [-0.05, 0.05], gas: [0, 0], brake: [0, 0], ebrake: false },
    { it: "phone turned right with gas on the strip: it steers right and pulls", fingers: [{ id: 1, on: "strip", at: 0.6 }], tilt: "right", x: [0.5, 1], gas: [0.3, 1], ebrake: false },
    { it: "the left thumb holds the e-brake pad while gas and the turn stay: a drift", fingers: [{ id: 1, on: "strip", at: 0.6 }, { id: 2, on: "hand" }], tilt: "right", x: [0.5, 1], gas: [0.3, 1], ebrake: true },
    { it: "the strip thumb drops to the foot while the phone is still turned: it brakes", fingers: [{ id: 1, on: "strip", at: 0 }], tilt: "right", x: [0.5, 1], gas: [0, 0], brake: [0.9, 1], ebrake: false },
  ],
};

const attitudeFor = (device, tilt) => {
  const landscape = device.orientation === "landscape";
  if (tilt === "level") return landscape ? { alpha: 0, beta: 0, gamma: -90 } : { alpha: 0, beta: 90, gamma: 0 };
  return landscape ? { alpha: 0, beta: 20, gamma: -90 } : { alpha: 0, beta: 70, gamma: 89.9 };
};

/** What a row expects against what the pad read: the mismatches, as text. */
const mismatches = (row, read) => {
  const found = [];
  for (const key of ["x", "gas", "brake"]) if (row[key] && !(read[key] >= row[key][0] - 1e-6 && read[key] <= row[key][1] + 1e-6)) found.push(`${key} ${read[key].toFixed(2)} not in ${row[key].join("..")}`);
  if (row.ebrake !== undefined && ((read.held & EBRAKE_BIT) !== 0) !== row.ebrake) found.push(`e-brake ${(read.held & EBRAKE_BIT) !== 0}, expected ${row.ebrake}`);
  if (row.boost !== undefined && ((read.held & BOOST_BIT) !== 0) !== row.boost) found.push(`boost ${(read.held & BOOST_BIT) !== 0}, expected ${row.boost}`);
  return found;
};

/** Sends the change from the fingers down to the fingers wanted: a new one is a touchStart, a moved one a touchMove, a gone one a touchEnd. */
async function moveFingers(cdp, down, wanted) {
  const gone = down.filter((finger) => !wanted.some((next) => next.id === finger.id));
  if (gone.length > 0) await touch(cdp, "touchEnd", gone);
  const added = wanted.filter((next) => !down.some((finger) => finger.id === next.id));
  if (added.length > 0) await touch(cdp, "touchStart", wanted);
  else if (wanted.length > 0) await touch(cdp, "touchMove", wanted);
}

/** Drives one scheme's two-thumb script with real CDP touches (and the emulated phone's tilt) and checks the pad after every row. */
async function checkSchemeTouch(browser, device, scheme) {
  const context = `${device.id} two thumbs (${scheme})`;
  console.log(context);
  const { context: browserContext, page, cdp } = await open(browser, device, "scene=race", { scheme });
  try {
    await startRace(page);
    await settle(page, 9000);
    const rects = {};
    for (const [on, name] of Object.entries(CONTROL_NAME)) rects[on] = (await page.locator(`[data-touch-control=${name}]`).count()) > 0 ? await rectOf(page, name) : null;
    let down = [];
    for (const row of THUMB_SCRIPTS[scheme]) {
      if (row.tilt) await cdp.send("DeviceOrientation.setDeviceOrientationOverride", attitudeFor(device, row.tilt));
      const wanted = row.fingers.map((finger) => ({ id: finger.id, ...fingerPoint(rects, finger) }));
      if (row.fingers.some((finger) => !rects[finger.on]) || (row.tap && !rects[row.tap])) return fail(context, `row "${row.it}" needs a control this scheme does not draw`);
      await moveFingers(cdp, down, wanted);
      down = wanted;
      if (row.tap) {
        const at = { id: 9, ...centre(rects[row.tap]) };
        await touch(cdp, "touchStart", [...wanted, at]);
        await touch(cdp, "touchEnd", [at]);
      }
      await settle(page, row.tilt ? 450 : 200);
      const found = mismatches(row, await readTouch(page));
      if (found.length > 0) fail(context, `${row.it}: ${found.join("; ")}`);
    }
    if (down.length > 0) await touch(cdp, "touchEnd", []);
  } finally {
    await browserContext.close();
  }
}

/** The default driving disc: a small push up is a little gas, a small push down a little brake, sideways a little wheel, none of them swallowed. */
async function checkDisc(browser, device) {
  const context = `${device.id} driving disc (default)`;
  console.log(context);
  const { context: browserContext, page, cdp } = await open(browser, device, "scene=race");
  try {
    await startRace(page);
    await settle(page, 9000);
    const disc = await rectOf(page, "steer");
    if (!disc) return fail(context, "no driving disc on the race screen");
    if (Math.abs(disc.right - disc.left - (disc.bottom - disc.top)) > 1) fail(context, "the default control is not a round disc");
    const at = centre(disc);
    const reads = [];
    for (const [label, dx, dy] of [["up", 0, -12], ["down", 0, 12], ["right", 12, 0], ["up-full", 0, -40]]) {
      await touch(cdp, "touchStart", [{ id: 1, x: at.x, y: at.y }]);
      await touch(cdp, "touchMove", [{ id: 1, x: at.x + dx, y: at.y + dy }]);
      await settle(page, 200);
      reads.push([label, await readTouch(page)]);
      await touch(cdp, "touchEnd", []);
      await settle(page, 150);
    }
    const read = Object.fromEntries(reads);
    console.log(`  ${reads.map(([label, value]) => `${label}: gas ${value.rt.toFixed(2)} brake ${value.lt.toFixed(2)} wheel ${value.lx.toFixed(2)}`).join("  ")}`);
    // What the car is given (the pad's triggers and stick, after the pad's own curve): a 12 px push of the 36 px throw is about a third.
    if (!(read.up.rt > 0.2 && read.up.rt < 0.5 && read.up.lt === 0 && Math.abs(read.up.lx) < 0.05)) fail(context, `a small push up: expected a little gas (rt 0.2 to 0.5), got rt ${read.up.rt} lt ${read.up.lt}`);
    if (!(read.down.lt > 0.2 && read.down.lt < 0.5 && read.down.rt === 0)) fail(context, `a small push down: expected a little brake / reverse (lt 0.2 to 0.5), got lt ${read.down.lt} rt ${read.down.rt}`);
    if (!(Math.abs(read.right.lx) > 0.2 && Math.abs(read.right.lx) < 0.5 && read.right.rt === 0)) fail(context, `a small push right: expected a little wheel, got lx ${read.right.lx}`);
    if (!(read["up-full"].rt > 0.95)) fail(context, `a full push up: expected full gas, got rt ${read["up-full"].rt}`);
    const released = await readTouch(page);
    if (Math.abs(released.x) > 0.01 || Math.abs(released.y) > 0.01) fail(context, `thumb up: expected the disc to rest at 0, got x ${released.x} y ${released.y}`);
  } finally {
    await browserContext.close();
  }
}

/** A real tap on the fullscreen control enters fullscreen and a second one leaves it, on the race screen and on a bench page. */
async function checkFullscreen(browser, device, { name, hash, query }) {
  const context = `${device.id} fullscreen (${name})`;
  console.log(context);
  const { context: browserContext, page } = await open(browser, device, hash, { query });
  try {
    // A race on the grid (no menu over the screen), as a player has it; a bench page needs none.
    if (hash === "scene=race") {
      await startRace(page);
      await settle(page, 2500);
    }
    const button = await rectOf(page, "fullscreen");
    if (!button) return fail(context, "no fullscreen control on the page");
    const at = centre(button);
    const state = () => evaluate(page, () => document.fullscreenElement !== null);
    await page.touchscreen.tap(at.x, at.y);
    await settle(page, 600);
    if (!(await state())) fail(context, "a tap on the fullscreen control did not enter fullscreen");
    // Nothing the game does between scenes may drop it: switch scenes through the engine, twice, and ask the page again.
    await evaluate(page, () => window.__crush.toggleDerby());
    await settle(page, 2500);
    await evaluate(page, () => window.__crush.toggleRange());
    await settle(page, 2500);
    if (!(await state())) fail(context, "fullscreen was lost across a scene change");
    const after = await rectOf(page, "fullscreen");
    if (after) await page.touchscreen.tap(centre(after).x, centre(after).y);
    await settle(page, 600);
    if (await state()) fail(context, "a second tap did not leave fullscreen");
  } finally {
    await browserContext.close();
  }
}

/** The race setup menu's Radio row: absent with the sound off; Sound On shows it with Calm (the default station) pressed; a tap on High Energy saves "high". */
async function checkRadio(browser, device) {
  const context = `${device.id} radio row (race setup)`;
  console.log(context);
  const { context: browserContext, page } = await open(browser, device, "scene=race");
  try {
    const row = (label) => page.getByRole("group", { name: new RegExp(`^${label}:`) });
    const sound = row("Sound");
    if ((await sound.count()) === 0) return fail(context, "no Sound row in the race setup menu (a blind probe proves nothing)");
    if ((await row("Radio").count()) > 0) fail(context, "a Radio row shows with the sound off");
    await sound.getByRole("button", { name: "On", exact: true }).tap();
    await settle(page, 400);
    const radio = row("Radio");
    if ((await radio.count()) === 0) return fail(context, "Sound On shows no Radio row");
    const calmPressed = await radio.getByRole("button", { name: "Calm", exact: true }).getAttribute("aria-pressed");
    if (calmPressed !== "true") fail(context, `the Radio row opens with Calm aria-pressed=${calmPressed}, not the default station`);
    await radio.getByRole("button", { name: "High Energy", exact: true }).tap();
    await settle(page, 300);
    const saved = await evaluate(page, () => localStorage.getItem("crush.audio.station"));
    if (saved !== "high") fail(context, `a tap on High Energy saved crush.audio.station = ${JSON.stringify(saved)}, not "high"`);
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
    if (!only || only.includes("radio")) {
      try {
        await checkRadio(browser, device);
      } catch (error) {
        fail(`${device.id} radio row`, `could not run: ${String(error).split("\n")[0]}`);
      }
    }
    if (only && !only.includes("touch")) continue;
    for (const check of [checkDisc, (b, d) => checkSchemeTouch(b, d, "pedals"), (b, d) => checkSchemeTouch(b, d, "autogas"), (b, d) => checkSchemeTouch(b, d, "tilt"), (b, d) => checkFullscreen(b, d, { name: "race", hash: "scene=race", query: "" }), (b, d) => checkFullscreen(b, d, { name: "bench page", hash: "", query: "&bench=city" })]) {
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
