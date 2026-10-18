import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fetchSubmissions } from "./fetch-submissions.mjs";
import { roundCard } from "../src/game/engine/bench-card.ts";

const TOKEN = "owner-token-".padEnd(40, "x");
const ROWS = [
  { id: "BBBB-2222", kind: "flag", receivedAt: "2026-10-07T10:05:00Z", sha: "3295bad", size: 900 },
  { id: "AAAA-1111", kind: "bench", receivedAt: "2026-10-07T10:00:00Z", sha: "3295bad", size: 1200 },
];

/** A server that answers the way `submissions.server.ts` does: a list, and one submission by receipt. `refuse429` first answers that many requests with 429. */
function server(rows = ROWS, refuse429 = 0) {
  const calls = [];
  let refused = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), auth: init.headers.authorization });
    if (refused < refuse429) {
      refused++;
      return new Response('{"error":"rate limited"}', { status: 429 });
    }
    if (init.headers.authorization !== `Bearer ${TOKEN}`) return new Response('{"error":"unauthorized"}', { status: 401 });
    const u = new URL(url);
    const id = u.searchParams.get("id");
    if (id === null) return Response.json({ submissions: rows });
    const row = rows.find((r) => r.id === id);
    return row ? Response.json({ ...row, submission: row.submission ?? { kind: row.kind } }) : new Response('{"error":"not found"}', { status: 404 });
  };
  return { fetchImpl, calls };
}

const tempDir = () => mkdtemp(path.join(os.tmpdir(), "submissions-"));
const noPause = async () => {};

describe("given an owner pulling submissions from the server", () => {
  it("when it fetches a list of two, then each is saved as its receipt id's JSON file, with the owner token as a bearer header", async () => {
    const out = await tempDir();
    const { fetchImpl, calls } = server();
    const result = await fetchSubmissions({ base: "https://game.test/crush", token: TOKEN, out, fetchImpl, pause: noPause });
    assert.deepEqual(result, { saved: ["AAAA-1111", "BBBB-2222"], skipped: [] });
    assert.deepEqual((await readdir(out)).sort(), ["AAAA-1111.json", "BBBB-2222.json"]);
    assert.equal(JSON.parse(await readFile(path.join(out, "AAAA-1111.json"), "utf8")).submission.kind, "bench");
    assert.deepEqual(calls.map((c) => c.url), [
      "https://game.test/crush/api/submissions?limit=50",
      "https://game.test/crush/api/submissions?id=AAAA-1111",
      "https://game.test/crush/api/submissions?id=BBBB-2222",
    ]);
    assert.equal(new Set(calls.map((c) => c.auth)).size, 1);
  });

  it("when it is run again, then the submissions already saved are not fetched again", async () => {
    const out = await tempDir();
    await fetchSubmissions({ base: "https://game.test/crush/", token: TOKEN, out, fetchImpl: server().fetchImpl, pause: noPause });
    const { fetchImpl, calls } = server();
    const result = await fetchSubmissions({ base: "https://game.test/crush/", token: TOKEN, out, fetchImpl, pause: noPause });
    assert.deepEqual(result, { saved: [], skipped: ["AAAA-1111", "BBBB-2222"] });
    assert.equal(calls.length, 1, "only the list was asked for");
  });

  it("when a kind and a limit are given, then the list request carries them", async () => {
    const { fetchImpl, calls } = server([]);
    await fetchSubmissions({ base: "https://game.test/crush/", token: TOKEN, out: await tempDir(), kind: "flag", limit: 5, fetchImpl, pause: noPause });
    assert.equal(calls[0].url, "https://game.test/crush/api/submissions?limit=5&kind=flag");
  });

  it("when one receipt is asked for, then only that one is fetched, with no list request", async () => {
    const { fetchImpl, calls } = server();
    await fetchSubmissions({ base: "https://game.test/crush/", token: TOKEN, out: await tempDir(), id: "BBBB-2222", fetchImpl, pause: noPause });
    assert.deepEqual(calls.map((c) => c.url), ["https://game.test/crush/api/submissions?id=BBBB-2222"]);
  });

  it("when the server rate-limits the first requests, then the script waits and carries on instead of failing", async () => {
    const pauses = [];
    const { fetchImpl } = server(ROWS, 2);
    const result = await fetchSubmissions({ base: "https://game.test/crush/", token: TOKEN, out: await tempDir(), fetchImpl, pause: async (ms) => void pauses.push(ms) });
    assert.equal(result.saved.length, 2);
    assert.equal(pauses.length, 2);
  });
});

const PHASED = {
  id: "CCCC-3333",
  kind: "bench",
  receivedAt: "2026-10-17T10:00:00Z",
  sha: "3e214dff",
  size: 20000,
  submission: {
    kind: "bench",
    payload: {
      result: {
        course: "city",
        simMsPerSimS: 215.5,
        phases: { msPerSimS: { drive: 30.25, wreck: 80 }, unattributedMsPerSimS: 5, workPerSimS: { steps: 240, skins: 479.6 } },
        longTasks: { count: 4, totalMs: 312.5, maxMs: 120 },
        device: { battery: { start: { charging: false, level: 0.83 }, end: { charging: true, level: 0.81 } } },
      },
    },
  },
};
const OLD_CARD = { id: "DDDD-4444", kind: "bench", receivedAt: "2026-10-01T10:00:00Z", sha: "3295bad", size: 11000, submission: { kind: "bench", payload: { result: { course: "city", simMsPerSimS: 212 } } } };

describe("given the owner asks for each bench card's phase table (--phases)", () => {
  it("when a card carries phases and another is from before them, then each prints its table or says it has none, a flag clip prints nothing, and a card already saved prints too", async () => {
    const out = await tempDir();
    const rows = [ROWS[0], OLD_CARD, PHASED];
    const lines = [];
    await fetchSubmissions({ base: "https://game.test/crush/", token: TOKEN, out, fetchImpl: server(rows).fetchImpl, pause: noPause, phases: true, log: (l) => lines.push(l) });
    const table = lines.filter((l) => l.startsWith("    "));
    assert.deepEqual(table, [
      "    city 215.5 ms/sim-s = drive 30.3  wreck 80.0  unattributed 5.0",
      "    per sim-s: steps 240  skins 480",
      "    4 long tasks, 312.5 ms; battery 83 % -> 81 % charging",
      "    phases: none (a card from before the phase timing)",
    ]);
    const again = [];
    await fetchSubmissions({ base: "https://game.test/crush/", token: TOKEN, out, fetchImpl: server(rows).fetchImpl, pause: noPause, phases: true, log: (l) => again.push(l) });
    assert.deepEqual(again, table, "the saved cards print their tables without a fetch");
    const quiet = [];
    await fetchSubmissions({ base: "https://game.test/crush/", token: TOKEN, out, fetchImpl: server(rows).fetchImpl, pause: noPause, log: (l) => quiet.push(l) });
    assert.deepEqual(quiet, [], "no flag, no table");
  });
});

describe("given the owner asks for a card's per-second series and its page and unit-cost lines", () => {
  const rich = {
    ...PHASED,
    id: "EEEE-5555",
    submission: {
      kind: "bench",
      payload: {
        result: {
          ...PHASED.submission.payload.result,
          wallS: 2,
          simSpreadPct: 12.34,
          pageState: { stepOfPage: 2, keep: true, heapUsedMB: 118, heapLimitMB: 4096, ragdollHost: "remote" },
          phases: {
            msPerSimS: { drive: 30.25, wreck: 80 },
            unattributedMsPerSimS: 5,
            workPerSimS: { steps: 240, skins: 479.6 },
            unitUs: { "wreck us/wreck slice": 42.1, "integrate us/live slice": 9.5 },
            perSecond: { wallS: [1, 1.04], clockS: [1, 0.98], msPerSimS: { drive: [30, 30.5], wreck: [70, 90] }, workPerSimS: { steps: [240, 235], skins: [480, 479] } },
          },
        },
      },
    },
  };

  it("when --phases is given, then the headline carries the window's spread and the card adds its unit costs and its page's state", async () => {
    const lines = [];
    await fetchSubmissions({ base: "https://game.test/crush/", token: TOKEN, out: await tempDir(), fetchImpl: server([rich]).fetchImpl, pause: noPause, phases: true, log: (l) => lines.push(l) });
    assert.deepEqual(lines.filter((l) => l.startsWith("    ")), [
      "    city 215.5 ms/sim-s (spread 12.3 %) = drive 30.3  wreck 80.0  unattributed 5.0",
      "    per sim-s: steps 240  skins 480",
      "    per unit (us): wreck us/wreck slice 42.1  integrate us/live slice 9.5",
      "    page: step 2 of the page, keep true, heap 118 of 4096 MiB, ragdoll remote",
      "    4 long tasks, 312.5 ms; battery 83 % -> 81 % charging",
    ]);
  });

  it("when --series is given, then each second of the window is a row of its wall span, sim seconds, phases and counters, and a card from before the series says so", async () => {
    const lines = [];
    await fetchSubmissions({ base: "https://game.test/crush/", token: TOKEN, out: await tempDir(), fetchImpl: server([rich, PHASED]).fetchImpl, pause: noPause, series: true, log: (l) => lines.push(l) });
    const table = lines.filter((l) => l.startsWith("    ")).map((l) => l.trim().split(/\s+/).join(" "));
    assert.deepEqual(table, [
      "per-second series: none (a card from before the series)",
      "city per-second series (the window: 2.0 s, 215.5 ms/sim-s, spread 12.3 %)",
      "s wall s sim s drive wreck",
      "1 1.00 1.00 30.0 70.0",
      "2 1.04 0.98 30.5 90.0",
      "s steps skins",
      "1 240 480",
      "2 235 479",
    ]);
  });
});

describe("given the bench loop ran a map twice, the epicenter activation off and then on (--ab)", () => {
  /** A card as the server stores it: the loop's settings at `submission.settings`, the arm in the result's own settings. */
  const arm = (id, step, on, ms, wreck, frozen, extra = {}) => ({
    id, kind: "bench", receivedAt: "2026-10-17T10:00:00Z", sha: "3e214dff", size: 20000,
    submission: {
      kind: "bench",
      settings: { session: "k3x9q2", loop: 1, step },
      payload: {
        url: `https://game.test/crush/?bench=city${on ? "&epi=1" : ""}&loop=k3x9q2&cycle=1`,
        result: {
          course: "city",
          simMsPerSimS: ms,
          tierPct: { high: 100 },
          settings: { epicenter: on },
          pageEvents: [{ phase: "window", atS: 0, visible: true, focused: true, fullscreen: true }],
          phases: { msPerSimS: { integrate: 100, wreck, structure: ms - wreck }, unattributedMsPerSimS: 0, workPerSimS: { liveCarSlices: 5000, wreckCarSlices: 4000, asleepCarSlices: 1000, frozenCarSlices: frozen } },
          ...extra,
        },
      },
    },
  });
  const fetchLines = async (rows) => {
    const lines = [];
    await fetchSubmissions({ base: "https://game.test/crush/", token: TOKEN, out: await tempDir(), fetchImpl: server(rows).fetchImpl, pause: noPause, phases: true, ab: true, log: (l) => lines.push(l) });
    return lines;
  };
  const squash = (lines) => lines.map((l) => l.trim().split(/\s+/).join(" "));

  it("when the two cards of a map are fetched, then each carries its arm and one block puts off and on side by side with the change and the cost per unit of work; a card without its twin prints no block", async () => {
    const lines = await fetchLines([arm("AAAA-1111", "city", false, 600, 300, 0), arm("BBBB-2222", "city:epi", true, 540, 270, 3500), arm("CCCC-3333", "strip", false, 100, 40, 0)]);
    assert.ok(lines.some((l) => l.includes("city, epicenter off 600.0")), "the off card says so");
    assert.ok(lines.some((l) => l.includes("city, epicenter ON 540.0")), "the on card says so");
    const block = lines.slice(lines.findIndex((l) => l.startsWith("k3x9q2 cycle 1 city")));
    assert.deepEqual(squash(block), [
      "k3x9q2 cycle 1 city: epicenter off | on",
      "sim ms/sim-s 600.0 540.0 -10.0 %",
      "integrate 100.0 100.0 +0.0 %",
      "wreck 300.0 270.0 -10.0 %",
      "structure 300.0 270.0 -10.0 %",
      "wreckCarSlices 4000.0 4000.0 +0.0 %",
      "frozenCarSlices 0.0 3500.0",
      "liveCarSlices 5000.0 5000.0 +0.0 %",
      "integrate us/live slice 20.0 20.0 +0.0 %",
      "wreck us/wreck slice 75.0 67.5 -10.0 %",
      "structure us/wreck slice 75.0 67.5 -10.0 %",
      "frozen % of wreck+asleep 0.0 70.0",
    ]);
  });

  it("when one arm's window was unfocused and out of fullscreen on a desktop and the arms ran different FX tiers, then the block flags only the tiers and says the focus and fullscreen as a note", async () => {
    const unfocused = { pageEvents: [{ phase: "warm", atS: 0, visible: true, focused: true, fullscreen: true }, { phase: "window", atS: 0, visible: true, focused: false, fullscreen: false }], tierPct: { ultra: 100 } };
    const lines = await fetchLines([arm("AAAA-1111", "city", false, 600, 300, 0), arm("BBBB-2222", "city:epi", true, 540, 270, 3500, unfocused)]);
    assert.deepEqual(squash(lines.filter((l) => l.includes("FLAG"))), ["FLAG the arms ran different FX tiers: off high, on ultra"]);
    assert.deepEqual(squash(lines.filter((l) => l.includes("note epicenter"))), ["note epicenter on: not fullscreen (desktop); unfocused (visible)"]);
  });

  const PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/149.0.0.0 Mobile Safari/537.36";

  it("when the same window is a phone's, then the loss of fullscreen is a FLAG, and a window that stayed fullscreen has none", async () => {
    const out = { pageEvents: [{ phase: "window", atS: 0, visible: true, focused: true, fullscreen: false }], device: { userAgent: PHONE } };
    const kept = { pageEvents: [{ phase: "window", atS: 0, visible: true, focused: true, fullscreen: true }], device: { userAgent: PHONE } };
    const lines = await fetchLines([arm("AAAA-1111", "city", false, 600, 300, 0, kept), arm("BBBB-2222", "city:epi", true, 540, 270, 3500, out)]);
    assert.deepEqual(squash(lines.filter((l) => l.includes("FLAG"))), ["FLAG epicenter on: the window ran not fullscreen"]);
  });

  it("when a phone's card carries the per-second series with two window seconds out of fullscreen, then they are a FLAG with their count, and the same seconds on a desktop are only a note", async () => {
    const series = { pageSeconds: { flags: "ffbb", phases: "1111" } };
    const phone = await fetchLines([arm("AAAA-1111", "city", false, 600, 300, 0), arm("BBBB-2222", "city:epi", true, 540, 270, 3500, { ...series, device: { userAgent: PHONE } })]);
    assert.deepEqual(squash(phone.filter((l) => l.includes("FLAG"))), ["FLAG epicenter on: the window ran not fullscreen 2 of 4 s"]);
    const desktop = await fetchLines([arm("AAAA-1111", "city", false, 600, 300, 0), arm("BBBB-2222", "city:epi", true, 540, 270, 3500, series)]);
    assert.deepEqual(desktop.filter((l) => l.includes("FLAG")), []);
  });

  it("when a card carries the per-second series, then hidden and screen-not-held seconds are FLAGs with their counts, and the unfocused and (desktop) out-of-fullscreen seconds are a note", async () => {
    // Six seconds: warm (stretch 0) f; window seconds (stretch 1): f, d (shown, fullscreen, awake: unfocused), 5 (shown, fullscreen: unfocused, no wake lock), 0 (hidden), f.
    const series = { pageSeconds: { flags: "ffd50" + "f", phases: "0011" + "11" } };
    const lines = await fetchLines([arm("AAAA-1111", "city", false, 600, 300, 0), arm("BBBB-2222", "city:epi", true, 540, 270, 3500, series)]);
    assert.deepEqual(squash(lines.filter((l) => l.includes("FLAG"))), ["FLAG epicenter on: the window ran hidden 1 of 4 s, screen not held 2 of 4 s"]);
    assert.deepEqual(squash(lines.filter((l) => l.includes("note epicenter"))), ["note epicenter on: not fullscreen 1 of 4 s (desktop); unfocused 2 of 4 s (visible)"]);
  });

  it("when the epicenter knob read on in the last warm second and off in the window's first, then it is a FLAG; read the same, there is none", async () => {
    const changed = { pageSeconds: { flags: "ffff", phases: "0011", epi: "1100" } };
    const kept = { pageSeconds: { flags: "ffff", phases: "0011", epi: "1111" } };
    const flagged = await fetchLines([arm("AAAA-1111", "city", false, 600, 300, 0, kept), arm("BBBB-2222", "city:epi", true, 540, 270, 3500, changed)]);
    assert.deepEqual(squash(flagged.filter((l) => l.includes("FLAG"))), ["FLAG epicenter on: the window ran the epicenter knob changed between the warm-up's last second and the window's first"]);
  });

  describe("and the window's frame time in its focused and unfocused seconds", () => {
    /** Ten window seconds: the first four focused, then six visible but unfocused (the owner typed elsewhere); `fps` is each second's frame rate. */
    const focusWindow = (fps) => ({
      pageEvents: [
        { phase: "window", atS: 0, visible: true, focused: true, fullscreen: true },
        { phase: "window", atS: 4, visible: true, focused: false, fullscreen: true },
      ],
      fpsPerSecond: fps,
    });
    const flags = (lines) => squash(lines.filter((l) => l.includes("FLAG")));
    const notes = (lines) => squash(lines.filter((l) => l.includes("note epicenter on")));

    it("when the unfocused seconds ran at the same frame time, then there is no FLAG for focus, and the note gives both frame times and says no cost", async () => {
      const lines = await fetchLines([arm("AAAA-1111", "city", false, 600, 300, 0), arm("BBBB-2222", "city:epi", true, 540, 270, 3500, focusWindow([60, 59, 61, 60, 60, 61, 59, 60, 60, 61]))]);
      assert.deepEqual(flags(lines), []);
      assert.equal(notes(lines).length, 1);
      assert.ok(notes(lines)[0].includes("unfocused (visible)") && notes(lines)[0].includes("frame time 16.6 ms unfocused (6 s) against 16.7 ms focused (4 s)") && notes(lines)[0].endsWith(": no cost"), notes(lines)[0]);
    });

    it("when the unfocused seconds ran at half the frame rate, then focus loss is a FLAG with the two frame times and the window's own spread", async () => {
      const lines = await fetchLines([arm("AAAA-1111", "city", false, 600, 300, 0), arm("BBBB-2222", "city:epi", true, 540, 270, 3500, focusWindow([60, 60, 60, 60, 30, 30, 30, 30, 30, 30]))]);
      assert.equal(flags(lines).length, 1);
      assert.ok(flags(lines)[0].startsWith("FLAG epicenter on: losing focus cost frame time: frame time 33.3 ms unfocused (6 s) against 16.7 ms focused (4 s): 100.0 % apart, the window's own spread"), flags(lines)[0]);
    });

    it("when the frame time differs by less than the window's own spread (a noisy window), then there is no FLAG", async () => {
      const lines = await fetchLines([arm("AAAA-1111", "city", false, 600, 300, 0), arm("BBBB-2222", "city:epi", true, 540, 270, 3500, focusWindow([50, 70, 45, 75, 52, 68, 47, 73, 50, 70]))]);
      assert.deepEqual(flags(lines), []);
    });

    it("when the frame rate falls to 1 fps for two window seconds, then they are throttled seconds and a FLAG, in a window that was never unfocused", async () => {
      const lines = await fetchLines([arm("AAAA-1111", "city", false, 600, 300, 0), arm("BBBB-2222", "city:epi", true, 540, 270, 3500, { fpsPerSecond: [60, 60, 1, 1, 60, 60] })]);
      assert.deepEqual(flags(lines), ["FLAG epicenter on: the window ran frame rate throttled (2 fps or less) 2 of 6 s"]);
    });

    it("when a window second was hidden, then it is a FLAG whatever the frame time was", async () => {
      const hidden = { pageSeconds: { flags: "ffff", phases: "1111" }, fpsPerSecond: [60, 60, 60, 60] };
      hidden.pageSeconds.flags = "f0ff";
      const lines = await fetchLines([arm("AAAA-1111", "city", false, 600, 300, 0), arm("BBBB-2222", "city:epi", true, 540, 270, 3500, hidden)]);
      assert.deepEqual(flags(lines), ["FLAG epicenter on: the window ran hidden 1 of 4 s, screen not held 1 of 4 s"]);
    });
  });

  it("when a card pinned the sky to the full strip and one window second drew it loading, then the flag counts that second, and a window that drew the strip all through says nothing of the sky", async () => {
    const drift = { settings: { epicenter: true, sky: "full" }, pageSeconds: { flags: "ffff", phases: "1111", sky: "3343" } };
    const steady = { settings: { epicenter: false, sky: "full" }, pageSeconds: { flags: "ffff", phases: "1111", sky: "3333" } };
    const lines = await fetchLines([arm("AAAA-1111", "city", false, 600, 300, 0, steady), arm("BBBB-2222", "city:epi", true, 540, 270, 3500, drift)]);
    assert.deepEqual(squash(lines.filter((l) => l.includes("FLAG"))), ["FLAG epicenter on: the window ran sky not as pinned 1 of 4 s"]);
  });

  it("when a window's cost swung over 25 % a second and the page had not settled when it opened, then the block gives the window spread of both arms and flags each", async () => {
    const swung = { simSpreadPct: 40, switches: [{ stretch: "window", arm: "start", round: 1, settled: false, settleS: 6, longestMs: 812 }] };
    const lines = await fetchLines([arm("AAAA-1111", "city", false, 600, 300, 0, { simSpreadPct: 5 }), arm("BBBB-2222", "city:epi", true, 540, 270, 3500, swung)]);
    assert.deepEqual(squash(lines.filter((l) => l.includes("FLAG"))), [
      "FLAG epicenter on: the window's sim cost swung 40.0 % second to second (over 25 %): its mean says little, read the per-second series (--series)",
      "FLAG epicenter on: the page never settled before the window opened (6.0 s watched, longest frame 812 ms)",
    ]);
    assert.ok(squash(lines).includes("window spread % 5.0 40.0 +700.0 %"), "the spread row");
  });

  it("when both cards carry the cost per unit of work by class, then a class the block does not already print gets its own row", async () => {
    const unit = (us) => ({ phases: { msPerSimS: { integrate: 100, wreck: 300, structure: 300 }, unattributedMsPerSimS: 0, workPerSimS: { liveCarSlices: 5000, wreckCarSlices: 4000, asleepCarSlices: 1000, frozenCarSlices: 0 }, unitUs: { "pairs us/pair test": us, "wreck us/wreck slice": 75 } } });
    const lines = await fetchLines([arm("AAAA-1111", "city", false, 600, 300, 0, unit(2)), arm("BBBB-2222", "city:epi", true, 540, 270, 3500, unit(3))]);
    assert.ok(squash(lines).includes("pairs us/pair test 2.0 3.0 +50.0 %"), "the new class's row");
    assert.equal(squash(lines).filter((l) => l.startsWith("wreck us/wreck slice")).length, 1, "a class the block prints already is not printed twice");
  });

  it("when a pair of cards as the owner's phone sent them (the arm only in the step and the url, the card's settings one level up) is fetched, then it pairs by session, cycle and map", async () => {
    const phone = (id, step, on) => {
      const card = arm(id, step, on, 3000, 1200, 0);
      delete card.submission.payload.result.settings;
      return card;
    };
    const lines = await fetchLines([phone("PPPP-1111", "strip", false), phone("QQQQ-2222", "strip:epi", true)]);
    assert.ok(lines.includes("k3x9q2 cycle 1 strip: epicenter off | on"), "the pair is printed");
  });
});

describe("given a bench card from before the card was shortened and the same card as it is sent now", () => {
  const fixture = JSON.parse(readFileSync(new URL("../src/game/engine/bench-card.fixture.json", import.meta.url), "utf8"));
  const phases = { msPerSimS: { drive: 30.2512, wreck: 80.0444 }, unattributedMsPerSimS: 5.0321, workPerSimS: { steps: 240.4, skins: 479.6 } };
  const longTasks = { count: 4, totalMs: 312.5, maxMs: 120 };
  const card = (result, hud) => ({ id: "EEEE-5555", kind: "bench", receivedAt: "2026-10-17T10:00:00Z", sha: "519348d", size: 1, submission: { kind: "bench", payload: { hud, result } } });
  const old = card({ ...fixture.result, phases, longTasks }, fixture.hud);
  const now = card(roundCard({ ...fixture.result, phases, longTasks }), {});

  it("when each is pulled with --phases, then both print the same table", async () => {
    const tables = [];
    for (const row of [old, now]) {
      const lines = [];
      await fetchSubmissions({ base: "https://game.test/crush/", token: TOKEN, out: await tempDir(), fetchImpl: server([row]).fetchImpl, pause: noPause, phases: true, log: (l) => lines.push(l) });
      tables.push(lines.filter((l) => l.startsWith("    ")));
    }
    assert.equal(tables[0].length, 3, tables[0].join("\n"));
    assert.deepEqual(tables[1], tables[0]);
  });
});

describe("given a pull that must fail loudly", () => {
  const cases = [
    { it: "no token is set", options: { token: undefined }, error: /SUBMISSIONS_OWNER_TOKEN is not set/ },
    { it: "the token is too short to be the owner's", options: { token: "short" }, error: /SUBMISSIONS_OWNER_TOKEN is not set/ },
    { it: "the token is wrong", options: { token: `${TOKEN}y` }, error: /401 unauthorized/ },
    { it: "the kind is not a kind", options: { kind: "../x" }, error: /--kind is one of/ },
    { it: "the receipt id is not a receipt id", options: { id: "../../etc/passwd" }, error: /--id is a receipt id/ },
  ];
  for (const testCase of cases) {
    it(`when ${testCase.it}, then it stops with a message and saves nothing`, async () => {
      const out = await tempDir();
      await assert.rejects(fetchSubmissions({ base: "https://game.test/crush/", token: TOKEN, out, fetchImpl: server().fetchImpl, pause: noPause, ...testCase.options }), testCase.error);
      assert.deepEqual(await readdir(out), []);
    });
  }

  it("when the server's list names an id that is not a receipt id, then it is never written as a file name", async () => {
    const out = await tempDir();
    const rows = [{ ...ROWS[0], id: "../../evil" }, ROWS[1]];
    const result = await fetchSubmissions({ base: "https://game.test/crush/", token: TOKEN, out, fetchImpl: server(rows).fetchImpl, pause: noPause });
    assert.deepEqual(result.saved, ["AAAA-1111"]);
    assert.deepEqual(await readdir(out), ["AAAA-1111.json"]);
  });
});

describe("given a card whose frames the device summarised, and the card as the wire carries its lists", () => {
  const FRAME_STATS = {
    n: 2700,
    medianMs: 11.1,
    p95Ms: 14.2,
    p99Ms: 31.4,
    p999Ms: 88.8,
    maxMs: 120.5,
    fpsLow1: 28.6,
    fpsLow01: 11.3,
    series: { cols: ["atS", "frames", "meanMs", "maxMs", "simMs", "crashed", "wreckCarSlices", "pairContacts", "freezes", "thaws", "ragdollMessages"], dp: [], n: 2, data: [[0, 0.2], [18, 17], [11.1, 12.5], [14.1, 31.2], [3.1, 4.4], [1, 5], [20, 61], [9, 70], [0, 2], [0, 1], [0, 6]] },
    spikes: {
      count: 12,
      factor: 3,
      minMs: 25,
      thresholdMs: 33.3,
      rows: { cols: ["atS", "intervalMs", "simMs", "drawMs", "steps", "crashed", "wreckCarSlices", "pairContacts", "freezes", "thaws", "ragdollMessages", "wreckMs", "pairsMs"], dp: [], n: 1, data: [[3.2], [88.8], [60.5], [10.2], [4], [6], [40], [44], [1], [0], [3], [41.25], [9.5]] },
      activity: { cols: ["crashed", "ragdollMessages", "wreckCarSlices", "asleepCarSlices", "frozenCarSlices", "pairContacts", "partContacts", "freezes", "thaws", "steps"], inSpikes: [6, 4, 31, 2, 8, 44, 12, 1.5, 0.5, 3], otherwise: [3, 0.5, 11, 1, 3, 9, 2, 0.1, 0.1, 2.7], correlation: [0.41, 0.2, 0.55, 0.1, 0.3, 0.72, 0.4, 0.2, 0.1, 0.3] },
      dominantPhase: [0, 0, 1, 9, 1, 1, 0, 0, 0, 0],
    },
  };
  const card = (extra = {}) => ({ id: "FFFF-6666", kind: "bench", receivedAt: "2026-10-18T10:00:00Z", sha: "d2c53024", size: 90000, submission: { kind: "bench", payload: { result: { course: "city", simMsPerSimS: 215.5, settings: { epicenter: false }, phases: { msPerSimS: { drive: 30 }, unattributedMsPerSimS: 5, workPerSimS: { steps: 240 } }, frameStats: FRAME_STATS, ...extra } } } });

  it("when --phases is given, then the card's line has the percentiles and lows and the next line says what the sim was doing in the spikes against elsewhere", async () => {
    const lines = [];
    await fetchSubmissions({ base: "https://game.test/crush/", token: TOKEN, out: await tempDir(), fetchImpl: server([card()]).fetchImpl, pause: noPause, phases: true, log: (l) => lines.push(l) });
    const said = lines.map((l) => l.trim());
    assert.ok(said.includes("city, epicenter off frames: 2700, median 11.1 ms, p95 14.2, p99 31.4, p99.9 88.8, max 120.5; lows: 1 % 28.6 fps, 0.1 % 11.3 fps"), said.join("\n"));
    assert.ok(said.includes("12 spikes over 3x the median (33.3 ms); in a spike against elsewhere: crashed 6.0 vs 3.0 (r 0.41), wreckCarSlices 31.0 vs 11.0 (r 0.55), pairContacts 44.0 vs 9.0 (r 0.72), freezes 1.5 vs 0.1 (r 0.20), ragdollMessages 4.0 vs 0.5 (r 0.20); phase wreck largest in 9"));
  });

  it("when --frames is given, then every listed spike is a row with its activity and its largest phase, and the window's buckets follow", async () => {
    const lines = [];
    await fetchSubmissions({ base: "https://game.test/crush/", token: TOKEN, out: await tempDir(), fetchImpl: server([card()]).fetchImpl, pause: noPause, frames: true, log: (l) => lines.push(l) });
    const said = lines.map((l) => l.trim().split(/\s+/).join(" "));
    assert.ok(said.includes("3.2 88.8 60.5 10.2 4 6 40 44 1 0 3 wreck 41.3 ms"), said.join("\n"));
    assert.ok(said.includes("0.2 17 12.5 31.2 4.4 5 61 70 2 1 6"), "the second bucket's row");
    assert.ok(said.some((l) => l.endsWith("(2 buckets)")));
  });

  it("when a card from before the frame stats is printed with --frames, then it says so", async () => {
    const lines = [];
    await fetchSubmissions({ base: "https://game.test/crush/", token: TOKEN, out: await tempDir(), fetchImpl: server([PHASED]).fetchImpl, pause: noPause, frames: true, log: (l) => lines.push(l) });
    assert.ok(lines.includes("    frames: none (a card from before the frame stats)"));
  });

  it("when a card carries its switches and page entries as the wire's tables, then --ab reads them as it reads the old lists: a window that never settled is flagged", async () => {
    const wire = { switches: { keys: ["stretch", "arm", "round", "settled", "settleS", "longestMs"], rows: [["window", "start", 1, false, 6, 812]] }, pageEvents: { keys: ["phase", "atS", "visible", "focused", "fullscreen"], rows: [["window", 0, true, true, true]] } };
    const arm = (id, step, on, extra) => ({ id, kind: "bench", receivedAt: "2026-10-18T10:00:00Z", sha: "d2c53024", size: 9000, submission: { kind: "bench", settings: { session: "k3x9q2", loop: 1, step }, payload: { result: { course: "city", simMsPerSimS: 500, tierPct: { high: 100 }, settings: { epicenter: on }, phases: { msPerSimS: { integrate: 100 }, unattributedMsPerSimS: 0, workPerSimS: { liveCarSlices: 1000 } }, ...extra } } } });
    const lines = [];
    await fetchSubmissions({ base: "https://game.test/crush/", token: TOKEN, out: await tempDir(), fetchImpl: server([arm("AAAA-1111", "city", false, {}), arm("BBBB-2222", "city:epi", true, wire)]).fetchImpl, pause: noPause, ab: true, log: (l) => lines.push(l) });
    assert.ok(lines.some((l) => l.trim() === "FLAG epicenter on: the page never settled before the window opened (6.0 s watched, longest frame 812 ms)"), lines.join("\n"));
  });
});

describe("given the quick bench's cards, one arm of each map a run, the other arm in the next run", () => {
  const quick = (id, session, step, on, ms) => ({
    id, kind: "bench", receivedAt: "2026-10-18T10:00:00Z", sha: "d2c53024", size: 9000,
    submission: {
      kind: "bench",
      settings: { session, loop: 1, step },
      payload: { result: { course: "city", build: "d2c53024", simMsPerSimS: ms, tierPct: { high: 100 }, run: { extended: false, staged: true }, device: { userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }, settings: { epicenter: on }, phases: { msPerSimS: { integrate: 100, wreck: ms - 100 }, unattributedMsPerSimS: 0, workPerSimS: { liveCarSlices: 1000, wreckCarSlices: 500 } } } },
    },
  });
  const lines = async (rows) => {
    const out = [];
    await fetchSubmissions({ base: "https://game.test/crush/", token: TOKEN, out: await tempDir(), fetchImpl: server(rows).fetchImpl, pause: noPause, ab: true, log: (l) => out.push(l) });
    return out.map((l) => l.trim().split(/\s+/).join(" "));
  };

  it("when the off run and the on run are two sessions of one device and build, then the map's cards pair across them in the order the runs came, and a run with no partner prints no block", async () => {
    // The server lists the newest first (the fetch walks them oldest first): run 3, then 2, then 1.
    const said = await lines([
      quick("CCCC-3333", "run3", "city", false, 580),
      quick("BBBB-2222", "run2", "city:epi", true, 540),
      quick("AAAA-1111", "run1", "city", false, 600),
    ]);
    const heads = said.filter((l) => l.endsWith("epicenter off | on"));
    assert.deepEqual(heads, ["quick d2c53024 Mozilla/5.0 (X11; Linux x86_64) city, run 1: epicenter off | on"]);
    assert.ok(said.includes("sim ms/sim-s 600.0 540.0 -10.0 %"), said.join("\n"));
  });

  it("when two devices ran the quick bench, then their cards are never paired with each other's", async () => {
    const phone = quick("DDDD-4444", "run9", "city:epi", true, 900);
    phone.submission.payload.result.device.userAgent = "Mozilla/5.0 (Android 17; Mobile)";
    const said = await lines([quick("AAAA-1111", "run1", "city", false, 600), phone]);
    assert.deepEqual(said.filter((l) => l.endsWith("epicenter off | on")), []);
  });
});
