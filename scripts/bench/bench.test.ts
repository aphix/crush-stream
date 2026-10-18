import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CONTACT_REACH, LONE_MARGIN } from "../../src/game/engine/world-step.ts";
import { EPICENTER_KNOBS } from "../../src/game/deform/epicenter.ts";
import { armSequence, DEFAULT_ARMS, main, parseArm, summarize, table } from "./bench.mjs";
import { SCENARIO_INFO } from "./scenario-info.ts";
import { SCENARIOS } from "./scenarios.ts";
import { compareSlices } from "./slice-log.ts";

const run = (arm: string, n: number, ms: number, digest: string, extra: Record<string, number> = {}) => ({
  arm,
  n,
  scenario: "x",
  label: "8 wrecks",
  cars: 8,
  knobs: {},
  wallMsPerS: ms,
  msPerS: { drive: 1, plan: 1, integrate: 10, wreck: ms - 20, pairs: 4, structure: 4, course: 0, bake: 0, rules: 0, settle: 0 },
  workPerS: { slices: 240, liveCarSlices: 0, wreckCarSlices: 1000, asleepCarSlices: 0, pairTests: 0, pairContacts: 0, partContacts: 0, nodesLoose: 0, nodesLocked: 0, frozenCarSlices: 0, freezes: 0, thaws: 0, ...extra },
  digest,
  poses: [1, 2, 3],
  frozenBreaches: 0,
  thawSites: {},
  loadStart: 0.5,
  loadEnd: 0.9,
});

describe("given the scenario bench's arms", () => {
  it("when arms are written name:knob=v,knob=v, then they parse to a name and numeric knobs, and a malformed one is refused", () => {
    assert.deepEqual(parseArm("cut:epi.on=1,epi.nearPrune=1"), { name: "cut", knobs: { "epi.on": 1, "epi.nearPrune": 1 } });
    assert.deepEqual(parseArm("base:"), { name: "base", knobs: {} });
    assert.throws(() => parseArm(":epi.on=1"), /no name/);
    assert.throws(() => parseArm("a:epi.on"), /knob=number/);
    assert.throws(() => parseArm("a:epi.on=x"), /knob=number/);
  });

  it("when the default arms are listed, then they are off and on (epi.on) and every knob a user may name is one the epicenter group has", () => {
    assert.deepEqual(DEFAULT_ARMS.map((a: { name: string }) => a.name), ["off", "on"]);
    const ids = new Set(EPICENTER_KNOBS.map((k) => k.id));
    for (const arm of DEFAULT_ARMS) for (const id of Object.keys(arm.knobs)) assert.ok(ids.has(id as never), id);
  });

  it("when two arms are ordered, then ABBA runs there and back, BAAB back and there, both one after the other; three arms run A B C C B A", () => {
    const names = (order: string, arms = DEFAULT_ARMS) => armSequence(arms, order).map((a: { name: string }) => a.name).join("");
    assert.equal(names("abba"), "offononoff");
    assert.equal(names("baab"), "onoffoffon");
    assert.equal(names("both"), "offononoffonoffoffon");
    const three = [{ name: "a", knobs: {} }, { name: "b", knobs: {} }, { name: "c", knobs: {} }];
    assert.equal(names("abba", three), "abccba");
    assert.throws(() => armSequence(DEFAULT_ARMS, "sideways"), /abba, baab or both/);
  });
});

describe("given the runs of one scenario", () => {
  const runs = [run("off", 1, 100, "aa"), run("on", 2, 80, "bb", { frozenCarSlices: 1000 }), run("on", 3, 84, "bb", { frozenCarSlices: 1000 }), run("off", 4, 104, "aa")];
  it("when they are summarised, then each arm's mean, per-unit cost and frozen share are those of its runs", () => {
    const [off, on] = summarize(runs);
    assert.equal(off.name, "off");
    assert.equal(off.runs, 2);
    assert.equal(Math.round(off.perUnitTotal * 100) / 100, 102);
    assert.equal(on.work.frozenCarSlices, 1000);
    assert.equal(on.digestsEqual, true);
    const text = table("x", { about: "about", sizes: "sizes", lone: true, label: "8 wrecks", windowS: 12, warmS: 2 }, [off, on]);
    assert.match(text, /frozen \/ \(wreck\+asleep\) slices\s+0\.00\s+1\.00/);
    assert.match(text, /lone-car cut ON/);
    assert.match(text, /digest same in every run\s+yes\s+yes/);
    assert.match(text, /max \|pose or velocity difference\|, off vs on/);
  });

  it("when one run of an arm gives another digest, then the table says so", () => {
    const text = table("x", { about: "a", sizes: "s", lone: false, label: "l", windowS: 1, warmS: 1 }, summarize([run("off", 1, 100, "aa"), run("off", 2, 100, "zz"), run("on", 3, 100, "aa")]));
    assert.match(text, /digest same in every run\s+NO\s+yes/);
    assert.match(text, /lone-car cut off/);
  });
});

describe("given the scenarios", () => {
  it("when the info and the builders are listed, then every scenario has both, and the convoy rows sit inside the lone reach", () => {
    const names = "city city-race dam-spine dam-spine-race derby-8-s3 derby-8-s8 fleet-ramps havana-race intact-alone intact-alone-race intact-convoy intact-convoy-mixed intact-convoy-race mall national-mall-race present-asleep present-stopped sideswipe-15-race sideswipe-30-race strip strip-crash wreck-dead-apart wreck-dead-piled wreck-driving-apart wreck-driving-apart-race wreck-pile-pushed wreck-stopped-apart";
    assert.equal(Object.keys(SCENARIO_INFO).sort().join(" "), names);
    assert.equal(Object.keys(SCENARIOS).sort().join(" "), names);
    assert.equal(CONTACT_REACH + LONE_MARGIN, 6.3, "the reach the convoy rows' text names");
    assert.match(SCENARIO_INFO["intact-convoy"]!.about, /5 m nose to tail and 3\.5 m across/);
    assert.ok(Math.hypot(5, 3.5) < CONTACT_REACH + LONE_MARGIN, "the diagonal neighbour is inside the reach");
  });

  it("when the batch starts above the load limit and is not forced, then it stops before running anything", async () => {
    const lines: string[] = [];
    const code = await main(["run", "intact-alone", "--max-load", "0", "--out", mkdtempSync(path.join(tmpdir(), "bench-"))], (l: string) => lines.push(l));
    assert.equal(code, 2);
    assert.match(lines.join("\n"), /is above 0: not timing/);
  });

  it("when the intact control runs off and on, then the two arms are bit-identical (epicenter changes nothing without a wreck) and a wreck row freezes its wrecks under on", async () => {
    const out = mkdtempSync(path.join(tmpdir(), "bench-"));
    const lines: string[] = [];
    const code = await main(["run", "intact-alone", "wreck-stopped-apart", "--warm", "2", "--window", "1", "--order", "abba", "--max-load", "1000", "--out", out], (l: string) => lines.push(l));
    assert.equal(code, 0);
    const text = lines.join("\n");
    const [control, wreck] = text.split("== wreck-stopped-apart");
    assert.match(control!, /digests equal: bit-identical arms/);
    assert.match(wreck!, /frozen \/ \(wreck\+asleep\) slices\s+0\.00\s+1\.00/);
    assert.match(wreck!, /frozen-state breaches\s+0\s+0/);
  });

  it("when 8 wrecks stand still with the brake held, then none ever sleeps (the held brake restarts every rest timer each slice), and with epi.holdWakes every one sleeps from the first slice of the window", async () => {
    const out = mkdtempSync(path.join(tmpdir(), "bench-"));
    const lines: string[] = [];
    const code = await main(["run", "wreck-stopped-apart", "--arm", "today:", "--arm", "hold:epi.holdWakes=1", "--warm", "3", "--window", "1", "--order", "abba", "--max-load", "1000", "--out", out], (l: string) => lines.push(l));
    assert.equal(code, 0);
    const text = lines.join("\n");
    assert.match(text, /asleepCarSlices\/s\s+0\s+\d{3}/, "no wreck slept today, every one did with the knob");
    assert.match(text, /wreckCarSlices\/s\s+\d{3}\s+0/, "the awake wreck slices of today are the asleep ones of the knob");
  });

  it("when a pile of wrecks is pushed in every slice, then epicenter on and off drift apart no further than 2.5 times what the sim does to a 1 micrometre nudge with every knob off (the pile is chaotic: whole against whole nudged 1 um is centimetres)", async () => {
    const out = mkdtempSync(path.join(tmpdir(), "bench-"));
    const lines: string[] = [];
    const arms = ["--arm", "off:", "--arm", "on:epi.on=1", "--arm", "nudge1um:nudge=1e-6", "--arm", "nudge10um:nudge=1e-5"];
    const code = await main(["run", "wreck-pile-pushed", ...arms, "--warm", "0.25", "--window", "1.5", "--trace", "0.0416667", "--order", "abba", "--max-load", "1000", "--out", out], (l: string) => lines.push(l));
    assert.equal(code, 0);
    const worst = lines.join("\n").match(/worst over the run: body ([0-9.]+) cm/g)!.map((l) => Number(l.replace(/[^0-9.]/g, "").replace(/^0*/, "") || 0));
    const [on, nudge1, nudge10] = worst as [number, number, number];
    assert.ok(nudge1 > 1, `a 1 um nudge moved a body ${nudge1} cm: the pile is not the chaotic row it was`);
    assert.ok(on <= 2.5 * nudge1, `epicenter on drifted ${on} cm from whole; a 1 um nudge (${nudge1} cm, 10 um: ${nudge10} cm) allows ${2.5 * nudge1}`);
  });
});

describe("given two logs of the rigid steps of a run (`--slices`)", () => {
  it("when they differ in a pose, then the first differing record and field are named, and a differing hardTouch alone is only counted", () => {
    const rec = (slot: number, hard: number, px: number): number[] => [slot, 2, hard, 0, 1, 2, 3, 0, 0, 0, px, 0, 0, 0, 0, 0, 1];
    const a = new Float64Array([...rec(0, 0, 1), ...rec(1, 0, 2), ...rec(0, 0, 3)]);
    const hardOnly = new Float64Array([...rec(0, 1, 1), ...rec(1, 0, 2), ...rec(0, 0, 3)]);
    assert.deepEqual(compareSlices(a, hardOnly), { records: [3, 3], first: -1, fields: [], hardOnly: 1 });
    const moved = new Float64Array([...rec(0, 1, 1), ...rec(1, 0, 2), ...rec(0, 0, 3.0000001)]);
    assert.deepEqual(compareSlices(a, moved), { records: [3, 3], first: 2, fields: ["px"], hardOnly: 1 });
  });

  it("when a derby heat is run with `epi.wreckTops` off and on, then every car's every rigid step is the same to the bit, points were skipped, and the old path would have made no contact row for them", async () => {
    const out = mkdtempSync(path.join(tmpdir(), "bench-"));
    const lines: string[] = [];
    const code = await main(["run", "derby-8-s3", "--arm", "off:epi.wreckTops=0", "--arm", "wt:epi.wreckTops=1", "--warm", "5", "--window", "6", "--order", "abba", "--max-load", "1000", "--slices", "--verify", "--out", out], (l) => lines.push(l));
    assert.equal(code, 0);
    const text = lines.join("\n");
    assert.match(text, /IDENTICAL in every physical field/, "the two arms ran the same physics");
    const skipped = [...text.matchAll(/wreckTops check, wt \(summed over runs\): points skipped (\d+); of those the old path would have made a contact row (\d+)/g)];
    assert.equal(skipped.length, 1);
    assert.ok(Number(skipped[0]![1]) > 0, "the knob skipped no point: the comparison proves nothing");
    assert.equal(Number(skipped[0]![2]), 0, `the old path would have made a contact row for a skipped point: ${skipped[0]![0]}`);
  });
});
