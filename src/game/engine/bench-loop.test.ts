import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { benchPlan } from "./engine-bench-plan.ts";
import { advance, asksOptions, autoReloadAsked, benchRouteSearch, BIGGEST_COURSE, cycleOf, driveLoop, entryHref, isBenchPage, loopProgress, loopSettings, newSession, optionsOf, parseRun, runFromPage, shareHashOf, startRun, stepHref, stepOf, ULTRA_AVAILABLE, withOptions, type BenchRun } from "./bench-loop.ts";

const RUN: BenchRun = { session: "k3x9q2", loop: 1, step: 0, ultra: false, keep: false, auto: false, ultraNext: false, extended: true, epi: true };

describe("given the race courses of the game", () => {
  it("when their roads are measured, then the course the benchmark loop calls the biggest has the longest road", () => {
    const roads = TRACKS.map((raw) => {
      const t = new Track(raw);
      return { id: t.id, length: t.length };
    }).sort((a, b) => b.length - a.length);
    assert.equal(roads[0]!.id, BIGGEST_COURSE, roads.map((r) => `${r.id} ${Math.round(r.length)} m`).join(", "));
    assert.equal(BIGGEST_COURSE, "dam-spine");
  });
});

describe("given one cycle of the benchmark loop", () => {
  it("when the cycle is listed, then it runs the strip, the city, the biggest course and the National Mall, in that order, each map twice: the epicenter activation off, then on", () => {
    assert.equal(cycleOf(false).map((s) => s.id).join(" "), "strip strip:epi city city:epi dam-spine dam-spine:epi national-mall national-mall:epi");
  });

  it("when the second cycle is listed, then each pair runs on then off, the same eight steps, and stepOf follows the cycle", () => {
    assert.equal(cycleOf(false, 2).map((s) => s.id).join(" "), "strip:epi strip city:epi city dam-spine:epi dam-spine national-mall:epi national-mall");
    assert.equal(cycleOf(false, 3).map((s) => s.id).join(" "), cycleOf(false, 1).map((s) => s.id).join(" "));
    const run = { ...startRun("k3x9q2", true), loop: 2, step: 0 };
    assert.equal(stepOf(run).id, "strip:epi");
  });

  it("when the two steps of a map are read as benches, then they differ in the activation alone", () => {
    const steps = cycleOf(false);
    for (let i = 0; i < steps.length; i += 2) {
      const off = benchPlan(`?${steps[i]!.query}`)!;
      const on = benchPlan(`?${steps[i + 1]!.query}`)!;
      assert.equal(JSON.stringify({ ...off, epicenter: true }), JSON.stringify(on), steps[i]!.id);
      assert.equal(off.epicenter, false, steps[i]!.id);
    }
  });

  it("when each step's page query is read as a bench, then every step is a bench the game knows, on the course its name says", () => {
    const plans = cycleOf(false).map((s) => benchPlan(`?${s.query}`)?.id);
    assert.equal(plans.join(" "), "bench bench city city dam-spine dam-spine national-mall national-mall");
  });

  it("when a bench is asked for a course that does not exist, then it benches the city instead", () => {
    assert.equal(benchPlan("?bench=city&course=nowhere")?.id, "city");
    assert.equal(benchPlan("?bench=city&course=../../etc")?.id, "city");
  });

  it("when Ultra is included, then the cycle has the same eight steps and no Ultra twin: each step's page runs its Ultra arm if this build has Ultra", () => {
    const steps = cycleOf(true);
    assert.equal(steps.map((s) => s.id).join(" "), "strip strip:epi city city:epi dam-spine dam-spine:epi national-mall national-mall:epi");
    assert.ok(!steps.some((s) => s.id.includes("+")), "no twin step");
    for (const s of steps) assert.equal(benchPlan(`?${s.query}`)!.ultra, ULTRA_AVAILABLE, s.id);
  });

  it("when Ultra is not included, then no step's page runs an Ultra arm", () => {
    for (const s of cycleOf(false)) assert.equal(benchPlan(`?${s.query}`)!.ultra, false, s.id);
  });
});

describe("given a loop that has just finished a step", () => {
  const cases = [
    { it: "it is on the first step", loop: 1, step: 0, keep: false, expectedLoop: 1, expectedStep: 1 },
    { it: "it is on the second step", loop: 1, step: 1, keep: true, expectedLoop: 1, expectedStep: 2 },
    { it: "it is on the third step", loop: 1, step: 2, keep: true, expectedLoop: 1, expectedStep: 3 },
    { it: "it is on the last step and keep is set", loop: 1, step: 7, keep: true, expectedLoop: 2, expectedStep: 0 },
    { it: "it is on the last step of the third cycle and keep is set", loop: 3, step: 7, keep: true, expectedLoop: 4, expectedStep: 0 },
    { it: "it is on the last step and keep is not set", loop: 1, step: 7, keep: false, expectedLoop: null, expectedStep: null },
  ];
  for (const testCase of cases) {
    it(`when ${testCase.it}, then the loop goes on to ${testCase.expectedLoop ? `cycle ${testCase.expectedLoop} step ${testCase.expectedStep}` : "nothing: it is over"}`, () => {
      const next = advance({ ...RUN, loop: testCase.loop, step: testCase.step, keep: testCase.keep });
      assert.equal(next?.loop ?? null, testCase.expectedLoop, "cycle count");
      assert.equal(next?.step ?? null, testCase.expectedStep, "step");
      assert.equal(next?.session ?? RUN.session, RUN.session, "session");
    });
  }

  it("when the loop runs three cycles from the start, then each submission's loop counter counts the cycle from 1 and the session never changes", () => {
    const seen: string[] = [];
    for (let run: BenchRun | null = { ...startRun("k3x9q2", true), ultra: false, ultraNext: false }; run !== null && run.loop <= 3; run = advance(run)) {
      const s = loopSettings(run, stepOf(run));
      seen.push(`${s.session} ${s.loop} ${s.step}`);
    }
    assert.equal(seen.length, 24);
    assert.equal(seen.slice(0, 9).join(" | "), "k3x9q2 1 strip | k3x9q2 1 strip:epi | k3x9q2 1 city | k3x9q2 1 city:epi | k3x9q2 1 dam-spine | k3x9q2 1 dam-spine:epi | k3x9q2 1 national-mall | k3x9q2 1 national-mall:epi | k3x9q2 2 strip:epi");
    assert.equal(new Set(seen.map((s) => s.split(" ")[0])).size, 1);
  });

  it("when a step of a loop is submitted, then its settings carry the options the run was started with (Loop, Epicenter, Ultra), every value a scalar the server takes", () => {
    const run: BenchRun = { ...startRun("k3x9q2"), keep: true, epi: false, ultra: false, ultraNext: false };
    const s = loopSettings(run, stepOf(run));
    assert.deepEqual([s["options.loop"], s["options.epi"], s["options.ultra"]], [true, false, false]);
    for (const [name, value] of Object.entries(s)) assert.notEqual(typeof value, "object", name);
    assert.deepEqual(optionsOf(run), { loop: true, epi: false, ultra: false }, "the card's run.options");
  });

  it("when a new extended loop is started, then it keeps benching and reloads onto new builds, with Ultra if this build has it", () => {
    const run = startRun("k3x9q2", true);
    assert.equal(run.keep, true, "keep");
    assert.equal(run.auto, true, "auto");
    assert.equal(run.ultra, ULTRA_AVAILABLE, "this cycle's Ultra");
    assert.equal(run.ultraNext, ULTRA_AVAILABLE, "the next cycle's Ultra");
  });
});

describe("given a loop whose state is in the address of its bench page", () => {
  const base = "https://game.test/crush/";
  const searchOf = (href: string): string => new URL(href).search;

  it("when the address's loopultra is turned on during a cycle, then that cycle's benches run unchanged and the next cycle's benches each run their Ultra arm, as the same eight steps", { skip: !ULTRA_AVAILABLE && "this build has no Ultra" }, () => {
    const ran: string[] = [];
    let href = stepHref(base, { ...RUN, keep: true });
    for (let run = parseRun(searchOf(href)); run !== null && run.loop <= 2; run = parseRun(searchOf(href))) {
      ran.push(`${run.loop} ${stepOf(run).id} ${benchPlan(`?${stepOf(run).query}`)!.ultra ? "ultra" : "plain"}`);
      const next = advance(run);
      if (next === null) break;
      href = stepHref(base, next);
      if (ran.length === 1) {
        const edited = new URL(href);
        edited.searchParams.set("loopultra", "1");
        href = edited.toString();
      }
    }
    assert.equal(ran.join(" | "), [...["strip", "city", "dam-spine", "national-mall"].flatMap((m) => [`1 ${m} plain`, `1 ${m}:epi plain`]), ...["strip", "city", "dam-spine", "national-mall"].flatMap((m) => [`2 ${m}:epi ultra`, `2 ${m} ultra`])].join(" | "));
  });

  it("when a loop starts from a custom strip address (len, cars, props), then every strip step of every cycle builds the same strip", () => {
    const custom = "?bench=strip&len=2500&cars=4&props=rock:7&same=off&traffic=off&extended=1";
    const wanted = benchPlan(custom)!;
    const shape = { len: "2500", cars: "4", props: "rock:7", same: "off", traffic: "off" } as const;
    let href = new URL(custom, base).toString();
    const seen: string[] = [];
    for (let run = runFromPage(custom, "k3x9q2"); run !== null && run.loop <= 2; ) {
      href = stepHref(href, run);
      if (stepOf(run).id.startsWith("strip")) {
        const q = new URLSearchParams(searchOf(href));
        for (const [name, value] of Object.entries(shape)) assert.equal(q.get(name), value, `${run.loop} ${stepOf(run).id}: ${name}`);
        assert.equal(benchPlan(searchOf(href))!.racers, 4, `${run.loop} ${stepOf(run).id}: racers`);
        seen.push(stepOf(run).id);
      }
      run = advance(run);
    }
    assert.ok(seen.length >= 2, "the strip step ran in both cycles");
    assert.equal(wanted.racers, 4);
  });

  it("when keep is turned off (keep=0) in the address on the second step, then the loop goes on to the last step and ends there", () => {
    const second = new URL(stepHref(base, { ...RUN, step: 1, keep: true }));
    second.searchParams.set("keep", "0");
    const secondRun = parseRun(second.search);
    assert.equal(secondRun?.keep, false, "the edited address reads as keep off");
    let last = advance(secondRun!);
    assert.equal(last?.step, 2, "the step after the edit still runs");
    while (last!.step < 7) last = advance(last!);
    assert.equal(last?.step, 7, "the cycle's last step still runs");
    assert.equal(last?.loop, 1, "the cycle after the edit");
    assert.equal(advance(last!), null, "the loop ends at the cycle's end");
  });

  it("when auto is put into the address of a step, then that step and every step after it carry it", () => {
    const first = new URL(stepHref(base, RUN));
    first.searchParams.set("auto", "1");
    const firstRun = parseRun(first.search);
    assert.equal(firstRun?.auto, true, "the edited address reads as auto on");
    const secondHref = stepHref(base, advance(firstRun!)!);
    assert.equal(new URL(secondHref).searchParams.get("auto"), "1", "the next step's address");
    assert.equal(parseRun(searchOf(secondHref))?.auto, true, "the next step reads it back");
  });

  const hrefCases = [
    { it: "the address has a share fragment and a leftover v", from: `${base}?v=old#seed=7`, run: { ...RUN, step: 4 }, expected: `${base}?bench=city&course=dam-spine&loop=k3x9q2&cycle=1&step=4&keep=0&auto=0&loopultra=0&cycleultra=0&extended=1&loopepi=1` },
    {
      it: "every option is on",
      from: base,
      run: { ...RUN, loop: 3, step: 0, keep: true, auto: true, ultra: true, ultraNext: true },
      expected: `${base}?bench=strip${ULTRA_AVAILABLE ? "&ultra=1" : ""}&loop=k3x9q2&cycle=3&step=0&keep=1&auto=1&loopultra=1&cycleultra=1&extended=1&loopepi=1`,
    },
  ];
  for (const testCase of hrefCases) {
    it(`when a step's address is built and ${testCase.it}, then it names the step's bench, the session, the cycle, the step and every option on or off`, () => {
      assert.equal(stepHref(testCase.from, testCase.run), testCase.expected);
    });
  }

  it("when a step's address is read back, then it is the run it was built from", () => {
    const run: BenchRun = { session: "k3x9q2", loop: 7, step: 1, ultra: true, keep: true, auto: false, ultraNext: true, extended: true, epi: false };
    const back = parseRun(searchOf(stepHref(base, run)));
    assert.equal(back?.session, run.session, "session");
    assert.equal(back?.loop, run.loop, "cycle count");
    assert.equal(back?.step, run.step, "step");
    assert.equal(back?.ultra, run.ultra, "this cycle's Ultra");
    assert.equal(back?.keep, run.keep, "keep");
    assert.equal(back?.auto, run.auto, "auto");
    assert.equal(back?.ultraNext, run.ultraNext, "the next cycle's Ultra");
    assert.equal(back?.epi, run.epi, "the epicenter option");
  });

  const parseCases = [
    { it: "it names every part of a loop", search: "?bench=city&loop=k3x9q2&cycle=2&step=1&keep=1&auto=1&loopultra=1&cycleultra=1", expected: "k3x9q2 2 1 keep auto ultra ultraNext" },
    { it: "it names only a session, a bench opened by hand that becomes a loop from there", search: "?bench=strip&loop=k3x9q2", expected: ULTRA_AVAILABLE ? "k3x9q2 1 0 keep auto ultraNext" : "k3x9q2 1 0 keep auto" },
    { it: "options are written as 0", search: "?bench=city&loop=k3x9q2&keep=0&auto=0&loopultra=0", expected: "k3x9q2 1 0" },
    { it: "it asks for a bench and names no session", search: "?bench=city", expected: "none" },
    { it: "it names a session but asks for no bench", search: "?loop=k3x9q2", expected: "none" },
    { it: "the session holds a path", search: "?bench=city&loop=../x", expected: "none" },
    { it: "the step is not a whole number", search: "?bench=city&loop=k3x9q2&step=x", expected: "none" },
    { it: "the cycle count is zero", search: "?bench=city&loop=k3x9q2&cycle=0", expected: "none" },
  ];
  for (const testCase of parseCases) {
    it(`when the page's address is read and ${testCase.it}, then the loop read is ${testCase.expected}`, () => {
      const run = parseRun(testCase.search);
      const flags = [run?.keep && "keep", run?.auto && "auto", run?.ultra && "ultra", run?.ultraNext && "ultraNext"].filter(Boolean);
      const read = run === null ? "none" : [`${run.session} ${run.loop} ${run.step}`, ...flags].join(" ");
      assert.equal(read, testCase.expected);
    });
  }
});

describe("given a bench page opened by its address alone, with no loop in it", () => {
  for (const step of cycleOf(ULTRA_AVAILABLE)) {
    it(`when the page is ${step.query} with extended=1, then it runs as an extended loop with every option on, at the step that runs that same bench, and moves on after it`, () => {
      const run = runFromPage(`?${step.query}&extended=1`, "k3x9q2");
      assert.ok(run !== null, "a cycle bench becomes a loop");
      assert.equal(stepOf(run).id, step.id);
      assert.equal(run.keep && run.auto, true, "keep benching and auto-reload on");
      assert.notEqual(advance(run), null, "the loop moves on after this bench");
    });
  }
  for (const search of ["?bench=lab", "?bench=city&course=four-count"]) {
    it(`when the page is ${search}, a bench the cycle doesn't run, then it runs once and is no loop`, () => {
      assert.equal(runFromPage(search, "k3x9q2"), null);
    });
  }
  it("when the page is a strip without ultra=1 and Ultra is on in the loop, then it is the strip step all the same (the arm is the page's own choice) and the steps after it run their Ultra arm", () => {
    const run = runFromPage("?bench=strip", "k3x9q2");
    assert.ok(run !== null);
    assert.equal(stepOf(run).id, "strip:epi");
    assert.equal(benchPlan("?bench=strip")!.ultra, false, "this page runs no Ultra arm");
    assert.equal(benchPlan(`?${stepOf(advance(run)!).query}`)!.ultra, ULTRA_AVAILABLE, "the next step's page does");
  });
  it("when the page is the strip with keep, auto and loopultra turned off, then the loop it starts has them off and the address it rewrites keeps them off", () => {
    const run = runFromPage("?bench=strip&keep=0&auto=0&loopultra=0", "k3x9q2");
    assert.ok(run !== null);
    assert.equal(run.keep, false, "keep");
    assert.equal(run.auto, false, "auto");
    assert.equal(run.ultraNext, false, "loopultra");
    const back = parseRun(new URL(stepHref("https://game.test/crush/", run)).search);
    assert.ok(back !== null && back.session === "k3x9q2" && back.step === run.step && !back.keep && !back.auto && !back.ultraNext, "the rewritten address keeps them off");
  });
  it("when the page is the strip with only keep turned off, then the options it leaves out are on", () => {
    const run = runFromPage("?bench=strip&keep=0", "k3x9q2");
    assert.ok(run !== null);
    assert.equal(run.keep, false, "keep");
    assert.equal(run.auto, true, "auto");
    assert.equal(run.ultraNext, ULTRA_AVAILABLE, "loopultra");
  });
});

describe("given a loop address that leaves out its options (a loop carried over from an older build)", () => {
  it("when it is read, then keep benching and auto-reload are on, so the loop goes on past its cycle's last bench", () => {
    const run = parseRun("?bench=city&course=dam-spine&loop=af3fa60e&cycle=1&step=2");
    assert.ok(run !== null && run.keep && run.auto);
    assert.notEqual(advance(run), null, "the loop starts its next cycle");
  });
  it("when an option is turned off with =0, then it is off and the address it writes keeps it off", () => {
    const run = parseRun("?bench=strip&loop=af3fa60e&keep=0");
    assert.ok(run !== null && !run.keep);
    assert.equal(parseRun(new URL(stepHref("https://game.test/crush/", run)).search)!.keep, false);
  });
});

describe("given the address of a page", () => {
  const pageCases = [
    { it: "it asks for a bench", search: "?bench=city", expectedBench: true, expectedAuto: false },
    { it: "it asks for a bench and for reloading onto new builds", search: "?bench=strip&auto=1", expectedBench: true, expectedAuto: true },
    { it: "it is the plain game", search: "", expectedBench: false, expectedAuto: false },
    { it: "it only asks for reloading onto new builds", search: "?auto=1", expectedBench: false, expectedAuto: true },
  ];
  for (const testCase of pageCases) {
    it(`when ${testCase.it}, then it ${testCase.expectedBench ? "is" : "is not"} a bench page and it ${testCase.expectedAuto ? "asks" : "does not ask"} for reloading`, () => {
      assert.equal(isBenchPage(testCase.search), testCase.expectedBench, "bench page");
      assert.equal(autoReloadAsked(testCase.search), testCase.expectedAuto, "auto reload");
    });
  }

  it("when a loop is at the second step of its second cycle, then the bench card reads where it is", () => {
    assert.equal(loopProgress({ ...RUN, loop: 2, step: 1 }), "loop 2, step 2/8");
  });
});

describe("given a page whose address carries a share # (a stale one, or one pasted with the bench's query)", () => {
  const hash = "#scene=garage&night=1";
  it("when the page is the bench of the biggest course, then it follows no # at all, so the garage never replaces the bench's own course", () => {
    assert.equal(shareHashOf("?bench=city&course=dam-spine", hash), null);
  });
  it("when the page is a strip bench that a loop sent it to, then it follows no # at all", () => {
    assert.equal(shareHashOf("?bench=strip&loop=af3fa60e&cycle=1&step=0", hash), null);
  });
  it("when the page is the plain game, then it follows its # as it is", () => {
    assert.equal(shareHashOf("", hash), hash);
  });
});

describe("given a page outside a secure context (a build opened over plain http on the LAN), where crypto.randomUUID is missing", () => {
  it("when the Benchmark entry starts a loop, then it gets a session its own bench page reads back as that loop", (t) => {
    t.mock.method(crypto, "randomUUID", () => {
      throw new TypeError("crypto.randomUUID is not a function");
    });
    const run = startRun(newSession());
    const back = parseRun(new URL(stepHref("http://192.168.1.20:3000/", run)).search);
    assert.ok(back !== null && back.session === run.session && back.step === run.step, "the bench page reads its own loop back");
  });
});

describe("given the loop driven in one page", () => {
  /** A page that only notes what it was asked: the steps it ran with their queries, the addresses shown, the pauses and the reload asks: the driver has no other way out of the page. */
  function fakePage(options: { noBenchAt?: number; reloadAt?: number } = {}) {
    const log = { ran: [] as string[], shown: [] as string[], pauses: 0, reloads: 0 };
    return {
      log,
      page: {
        show: (run: BenchRun) => {
          const href = stepHref("http://game.test/crush/", run);
          log.shown.push(href);
          return new URL(href).search;
        },
        runStep: async (run: BenchRun, search: string) => {
          log.ran.push(`${stepOf(run).id} cycle ${run.loop} ${new URLSearchParams(search).get("epi") === "1" ? "epi" : "off"}`);
          return log.ran.length - 1 !== options.noBenchAt;
        },
        pause: async () => void log.pauses++,
        reload: async (run: BenchRun) => {
          log.reloads++;
          return run.step === options.reloadAt;
        },
      },
    };
  }

  it("when one cycle is driven, then every map and both arms run in the one page, in order, each shown at its own address, with a pause between steps (the driver has no way to navigate: only a reload hand-over leaves the page)", async () => {
    const { log, page } = fakePage();
    await driveLoop({ ...RUN, keep: false }, page);
    assert.equal(log.ran.map((r) => r.split(" ")[0]).join(" "), cycleOf(false).map((s) => s.id).join(" "));
    assert.equal(log.ran.length, 8, "steps: four maps, each off and on");
    assert.equal(log.shown.length, 8, "addresses shown");
    assert.equal(new Set(log.shown).size, 8, "each at its own address");
    assert.equal(log.pauses, 7, "a pause between steps, none after the last");
    assert.equal(log.ran.filter((r) => r.endsWith("epi")).length, 4, "four arms with the epicenter on");
  });

  it("when the loop keeps going, then the next cycle runs in the same page with its pairs the other way round", async () => {
    const { log, page } = fakePage({ noBenchAt: 11 });
    await driveLoop({ ...RUN, keep: true }, page);
    assert.equal(log.ran.length, 12, "the page that names no bench ends the loop at the twelfth step");
    assert.equal(log.ran[8], "strip:epi cycle 2 epi", "cycle 2 opens on the epicenter arm");
  });

  it("when a step names no bench the game knows, then the loop ends there", async () => {
    const { log, page } = fakePage({ noBenchAt: 2 });
    await driveLoop({ ...RUN, keep: false }, page);
    assert.equal(log.ran.length, 3, "steps run");
    assert.equal(log.pauses, 2, "pauses");
  });

  it("when a newer build is deployed after the third step, then the loop hands over to the reload there and runs no step after it", async () => {
    const { log, page } = fakePage({ reloadAt: 3 });
    await driveLoop({ ...RUN, keep: false }, page);
    assert.equal(log.ran.length, 3, "steps run before the reload");
    assert.equal(log.reloads, 3, "the reload was asked before the pause of each step it reached");
    assert.equal(log.pauses, 2, "the pause before the reload belongs to the reload");
  });
});

const LOOP_BASE = "https://game.test/crush/";
const loopSearch = (run: BenchRun): string => new URL(stepHref(LOOP_BASE, run)).search;

/** The step ids of `run`'s cycle from its step on. */
function idsOf(run: BenchRun): string {
  const ids: string[] = [];
  for (let at: BenchRun | null = run; at !== null && at.loop === run.loop; at = advance(at)) ids.push(stepOf(at).id);
  return ids.join(" ");
}

describe("given the quick bench, the default: each map once, under the epicenter arm while that option is on", () => {
  it("when /bench's page (?bench=strip) starts a quick loop with every option left on, then every map runs its epicenter arm and the loop keeps going", () => {
    const run = runFromPage("?bench=strip", "k3x9q2")!;
    assert.equal(idsOf(run), "strip:epi city:epi dam-spine:epi national-mall:epi");
    for (let at: BenchRun | null = run; at !== null && at.loop === 1; at = advance(at)) assert.equal(benchPlan(loopSearch(at))!.epicenter, true, stepOf(at).id);
    assert.equal(run.keep, true, "Loop is on");
  });

  it("when the Epicenter option is off, then the four maps run once each with no epicenter arm, and with Loop off it ends after them", () => {
    const run = runFromPage(withOptions("?bench=strip", { keep: false, epi: false, ultra: false, extended: false }), "k3x9q2")!;
    assert.equal(idsOf(run), "strip city dam-spine national-mall");
    assert.equal(advance({ ...run, step: 3 }), null, "the loop ends after the fourth map");
  });

  it("when a quick loop is kept, then every cycle runs the arm the run chose", () => {
    const second = advance({ ...startRun("k3x9q2"), step: 3 })!;
    assert.equal(second.loop, 2);
    assert.equal(idsOf(second), "strip:epi city:epi dam-spine:epi national-mall:epi");
  });

  it("when a quick step's address is built and read back, then it carries the epicenter option and the bench kind, and the page's plan reads quick from it; an extended step's reads extended", () => {
    const run = { ...startRun("k3x9q2"), step: 2 };
    const back = parseRun(loopSearch(run))!;
    assert.deepEqual([back.extended, back.epi, back.step, back.loop], [false, true, 2, 1]);
    assert.equal(benchPlan(loopSearch(run))!.extended, false);
    assert.equal(benchPlan(loopSearch(run))!.epicenter, true, "the page's own query asks for the activation");
    const long = startRun("k3x9q2", true);
    assert.equal(benchPlan(loopSearch(long))!.extended, true);
    assert.equal(parseRun(loopSearch(long))!.extended, true);
  });

  it("when a quick page is opened by hand, then the loop it starts runs from that map under the loop's epicenter option, whatever the page's own epi", () => {
    const run = runFromPage("?bench=city&epi=1", "k3x9q2")!;
    assert.deepEqual([stepOf(run).id, stepOf(advance(run)!).id], ["city:epi", "dam-spine:epi"]);
    assert.equal(stepOf(runFromPage("?bench=city&epi=1&loopepi=0", "k3x9q2")!).id, "city");
  });

  it("when a quick loop is driven in one page, then the four maps run once each with no pause after the last, and the loop's progress says step n of 4", async () => {
    const ran: string[] = [];
    const progress: string[] = [];
    let pauses = 0;
    await driveLoop({ ...startRun("k3x9q2"), keep: false, epi: false }, {
      show: (run) => loopSearch(run),
      runStep: async (run) => {
        ran.push(stepOf(run).id);
        progress.push(loopProgress(run));
        return true;
      },
      pause: async () => void pauses++,
      reload: async () => false,
    });
    assert.equal(ran.join(" "), "strip city dam-spine national-mall");
    assert.equal(progress.join(" | "), "loop 1, step 1/4 | loop 1, step 2/4 | loop 1, step 3/4 | loop 1, step 4/4");
    assert.equal(pauses, 3);
  });
});

describe("given the chooser before a new loop (Extended, Loop, Epicenter, Ultra)", () => {
  it("when the Benchmark entry opens the bench page, then it names no loop yet, so the page asks for the options first, and it starts at the strip", () => {
    for (const extended of [false, true]) {
      const href = entryHref(`${LOOP_BASE}?seed=3#scene=race`, extended);
      assert.equal(href, `${LOOP_BASE}?bench=strip${extended ? "&extended=1" : ""}&choose=1`);
      assert.equal(asksOptions(new URL(href).search), true, "the entry asks for the chooser");
      const search = new URL(href).search;
      assert.equal(parseRun(search), null, "no loop in the address");
      const run = runFromPage(search, "k3x9q2")!;
      assert.deepEqual([run.step, run.keep, run.epi], [0, true, true], "at the strip, Loop and Epicenter on");
      assert.equal(run.extended, extended, "the entry's bench");
      assert.equal(run.ultra, ULTRA_AVAILABLE, "Ultra on where the build has it");
    }
  });

  it("when Epicenter is turned off for the extended bench, then each map runs once without it, the extended page all the same", () => {
    const run = runFromPage(withOptions("?bench=strip&extended=1", { keep: true, epi: false, ultra: false, extended: true }), "k3x9q2")!;
    assert.equal(idsOf(run), "strip city dam-spine national-mall");
    assert.equal(benchPlan(loopSearch(run))!.extended, true);
  });

  it("when the options are chosen, then Ultra on runs Ultra this cycle and the next where the build has it, and off runs it in neither", () => {
    const on = runFromPage(withOptions("?bench=strip", { keep: true, epi: true, ultra: true, extended: false }), "k3x9q2")!;
    const off = runFromPage(withOptions("?bench=strip", { keep: true, epi: true, ultra: false, extended: false }), "k3x9q2")!;
    assert.equal(on.ultra && on.ultraNext, ULTRA_AVAILABLE, "on: this cycle and the next, where the build has it");
    assert.equal(off.ultra || off.ultraNext, false, "off: neither");
  });

  it("when an option is turned off, then every later page of the run, read back from its own address, has it off", () => {
    let at: BenchRun | null = runFromPage(withOptions("?bench=strip", { keep: true, epi: false, ultra: false, extended: false }), "k3x9q2");
    for (let pages = 0; pages < 8; pages++) {
      assert.ok(at !== null, `page ${pages}`);
      const search = loopSearch(at);
      assert.deepEqual([at.keep, at.epi, at.ultra, at.ultraNext, benchPlan(search)!.epicenter, benchPlan(search)!.ultra], [true, false, false, false, false, false], `page ${pages}`);
      at = advance(parseRun(search)!);
    }
  });

  it("when Extended is chosen on the quick entry, then the run is the extended cycle: every map whole, then under the epicenter, each page extended", () => {
    const run = runFromPage(withOptions("?bench=strip&choose=1", { keep: true, epi: true, ultra: false, extended: true }), "k3x9q2")!;
    assert.equal(idsOf(run), "strip strip:epi city city:epi dam-spine dam-spine:epi national-mall national-mall:epi");
    assert.equal(benchPlan(loopSearch(run))!.extended, true);
  });

  it("when a bench address with params but no entry mark is opened, then it asks no options and its loop starts at once under what it sets, the rest on", () => {
    const search = "?bench=strip&extended=1";
    assert.equal(asksOptions(search), false);
    const run = runFromPage(search, "k3x9q2")!;
    assert.deepEqual([run.extended, run.epi, run.keep, run.auto], [true, true, true, true]);
    assert.equal(stepOf(run).id, "strip");
  });

  it("when /bench is opened bare, then it points at the entry (the chooser); with params, at that bench page with them, no chooser", () => {
    assert.deepEqual(benchRouteSearch({}), { bench: "strip", choose: 1 });
    assert.deepEqual(benchRouteSearch({ extended: 1 }), { bench: "strip", extended: 1 });
    assert.deepEqual(benchRouteSearch({ bench: "city", course: "dam-spine", extended: 1, keep: 0 }), { bench: "city", course: "dam-spine", extended: 1, keep: 0 });
  });
});
