import { describe, expect, it, vi } from "vitest";
import { Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { benchPlan } from "./engine-bench-plan.ts";
import { advance, asksOptions, autoReloadAsked, benchRouteSearch, BIGGEST_COURSE, cycleOf, driveLoop, entryHref, isBenchPage, loopProgress, loopSettings, newSession, optionsOf, parseRun, runFromPage, shareHashOf, startRun, stepHref, stepOf, ULTRA_AVAILABLE, withOptions, type BenchRun } from "./bench-loop.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { must } from "../kernel/must.test-util.ts";

const RUN: BenchRun = { session: "k3x9q2", loop: 1, step: 0, ultra: false, keep: false, auto: false, ultraNext: false, extended: true, epi: true };

describe("given the race courses of the game", () => {
  it("when their roads are measured, then the course the benchmark loop calls the biggest has the longest road", () => {
    const roads = TRACKS.map((raw) => {
      const t = new Track(raw);
      return { id: t.id, length: t.length };
    }).sort((a, b) => b.length - a.length);
    expect(roads[0]!.id, roads.map((r) => `${r.id} ${Math.round(r.length)} m`).join(", ")).toBe(BIGGEST_COURSE);
    expect(BIGGEST_COURSE).toBe("dam-spine");
  });
});

describe("given one cycle of the benchmark loop", () => {
  it("when the cycle is listed, then it runs the strip, the city, the biggest course and the National Mall, in that order, each map twice: the epicenter activation off, then on", () => {
    expect(cycleOf(false).map((s) => s.id).join(" ")).toBe("strip strip:epi city city:epi dam-spine dam-spine:epi national-mall national-mall:epi");
  });

  it("when the second cycle is listed, then each pair runs on then off, the same eight steps, and the step the loop is at follows the cycle", () => {
    expect(cycleOf(false, 2).map((s) => s.id).join(" ")).toBe("strip:epi strip city:epi city dam-spine:epi dam-spine national-mall:epi national-mall");
    expect(cycleOf(false, 3).map((s) => s.id).join(" ")).toBe(cycleOf(false, 1).map((s) => s.id).join(" "));
    const run = { ...startRun("k3x9q2", true), loop: 2, step: 0 };
    expect(stepOf(run).id).toBe("strip:epi");
  });

  it("when the two steps of a map are read as benches, then they differ in the activation alone", () => {
    const steps = cycleOf(false);
    for (let i = 0; i < steps.length; i += 2) {
      const off = benchPlan(`?${steps[i]!.query}`)!;
      const on = benchPlan(`?${steps[i + 1]!.query}`)!;
      expect(JSON.stringify({ ...off, epicenter: true }), steps[i]!.id).toBe(JSON.stringify(on));
      expect(off.epicenter, steps[i]!.id).toBe(false);
    }
  });

  it("when each step's page query is read as a bench, then every step is a bench the game knows, on the course its name says", () => {
    const plans = cycleOf(false).map((s) => benchPlan(`?${s.query}`)?.id);
    expect(plans.join(" ")).toBe("bench bench city city dam-spine dam-spine national-mall national-mall");
  });

  it("when a bench is asked for a course that does not exist, then it benches the city instead", () => {
    expect(benchPlan("?bench=city&course=nowhere")?.id).toBe("city");
    expect(benchPlan("?bench=city&course=../../etc")?.id).toBe("city");
  });

  it("when Ultra is included, then the cycle has the same eight steps and no Ultra twin: each step's page runs its Ultra arm if this build has Ultra", () => {
    const steps = cycleOf(true);
    expect(steps.map((s) => s.id).join(" ")).toBe("strip strip:epi city city:epi dam-spine dam-spine:epi national-mall national-mall:epi");
    expect(!steps.some((s) => s.id.includes("+")), "no twin step").toBe(true);
    for (const s of steps) expect(benchPlan(`?${s.query}`)!.ultra, s.id).toBe(ULTRA_AVAILABLE);
  });

  it("when Ultra is not included, then no step's page runs an Ultra arm", () => {
    for (const s of cycleOf(false)) expect(benchPlan(`?${s.query}`)!.ultra, s.id).toBe(false);
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
      expect(next?.loop ?? null, "cycle count").toBe(testCase.expectedLoop);
      expect(next?.step ?? null, "step").toBe(testCase.expectedStep);
      expect(next?.session ?? RUN.session, "session").toBe(RUN.session);
    });
  }

  it("when the loop runs three cycles from the start, then each submission's loop counter counts the cycle from 1 and the session never changes", () => {
    const seen: string[] = [];
    for (let run: BenchRun | null = { ...startRun("k3x9q2", true), ultra: false, ultraNext: false }; run !== null && run.loop <= 3; run = advance(run)) {
      const s = loopSettings(run, stepOf(run));
      seen.push(`${s.session} ${s.loop} ${s.step}`);
    }
    expect(seen.length).toBe(24);
    expect(seen.slice(0, 9).join(" | ")).toBe("k3x9q2 1 strip | k3x9q2 1 strip:epi | k3x9q2 1 city | k3x9q2 1 city:epi | k3x9q2 1 dam-spine | k3x9q2 1 dam-spine:epi | k3x9q2 1 national-mall | k3x9q2 1 national-mall:epi | k3x9q2 2 strip:epi");
    expect(new Set(seen.map((s) => s.split(" ")[0])).size).toBe(1);
  });

  it("when a step of a loop is submitted, then its settings carry the options the run was started with (Loop, Epicenter, Ultra), every value a scalar the server takes", () => {
    const run: BenchRun = { ...startRun("k3x9q2"), keep: true, epi: false, ultra: false, ultraNext: false };
    const s = loopSettings(run, stepOf(run));
    expect(firstMismatch([s["options.loop"], s["options.epi"], s["options.ultra"]], [true, false, false])).toBeUndefined();
    for (const [name, value] of Object.entries(s)) expect(typeof value, name).not.toBe("object");
    const options = optionsOf(run);
    expect(options.loop, "the card's run.options loop").toBe(true);
    expect(options.epi, "the card's run.options epi").toBe(false);
    expect(options.ultra, "the card's run.options ultra").toBe(false);
  });

  it("when a new extended loop is started, then it keeps benching and reloads onto new builds, with Ultra if this build has it", () => {
    const run = startRun("k3x9q2", true);
    expect(run.keep, "keep").toBe(true);
    expect(run.auto, "auto").toBe(true);
    expect(run.ultra, "this cycle's Ultra").toBe(ULTRA_AVAILABLE);
    expect(run.ultraNext, "the next cycle's Ultra").toBe(ULTRA_AVAILABLE);
  });
});

describe("given a loop whose state is in the address of its bench page", () => {
  const base = "https://game.test/crush/";
  const searchOf = (href: string): string => new URL(href).search;

  it("when the address's loopultra is turned on during a cycle, then that cycle's benches run unchanged and the next cycle's benches each run their Ultra arm, as the same eight steps", { skip: !ULTRA_AVAILABLE }, () => {
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
    expect(ran.join(" | ")).toBe([...["strip", "city", "dam-spine", "national-mall"].flatMap((m) => [`1 ${m} plain`, `1 ${m}:epi plain`]), ...["strip", "city", "dam-spine", "national-mall"].flatMap((m) => [`2 ${m}:epi ultra`, `2 ${m} ultra`])].join(" | "));
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
        for (const [name, value] of Object.entries(shape)) expect(q.get(name), `${run.loop} ${stepOf(run).id}: ${name}`).toBe(value);
        expect(benchPlan(searchOf(href))!.racers, `${run.loop} ${stepOf(run).id}: racers`).toBe(4);
        seen.push(stepOf(run).id);
      }
      run = advance(run);
    }
    expect(seen.length, "the strip step ran in both cycles").toBeGreaterThanOrEqual(2);
    expect(wanted.racers).toBe(4);
  });

  it("when a loop starts from ?bench=city&draw=max&scale=2&shadow=high, then every step's address keeps the three quality arms", () => {
    const custom = "?bench=city&draw=max&scale=2&shadow=high&extended=1";
    let href = new URL(custom, base).toString();
    const seen: string[] = [];
    const loops = new Set<number>();
    for (let run = runFromPage(custom, "k3x9q2"); run !== null && run.loop <= 2; run = advance(run)) {
      href = stepHref(href, run);
      const q = new URLSearchParams(searchOf(href));
      expect(`${q.get("draw")} ${q.get("scale")} ${q.get("shadow")}`, `${run.loop} ${stepOf(run).id}`).toBe("max 2 high");
      seen.push(stepOf(run).id);
      loops.add(run.loop);
    }
    expect(seen.length, `the steps of both cycles ran (${seen.length} steps)`).toBeGreaterThan(8);
    expect([...loops].join(","), "both cycles ran").toBe("1,2");
  });

  it("when keep is turned off (keep=0) in the address on the second step, then the loop goes on to the last step and ends there", () => {
    const second = new URL(stepHref(base, { ...RUN, step: 1, keep: true }));
    second.searchParams.set("keep", "0");
    const secondRun = parseRun(second.search);
    expect(secondRun?.keep, "the edited address reads as keep off").toBe(false);
    let last = advance(secondRun!);
    expect(last?.step, "the step after the edit still runs").toBe(2);
    while (last!.step < 7) last = advance(last!);
    expect(last?.step, "the cycle's last step still runs").toBe(7);
    expect(last?.loop, "the cycle after the edit").toBe(1);
    expect(advance(last!), "the loop ends at the cycle's end").toBe(null);
  });

  it("when auto is put into the address of a step, then that step and every step after it carry it", () => {
    const first = new URL(stepHref(base, RUN));
    first.searchParams.set("auto", "1");
    const firstRun = parseRun(first.search);
    expect(firstRun?.auto, "the edited address reads as auto on").toBe(true);
    const secondHref = stepHref(base, advance(firstRun!)!);
    expect(new URL(secondHref).searchParams.get("auto"), "the next step's address").toBe("1");
    expect(parseRun(searchOf(secondHref))?.auto, "the next step reads it back").toBe(true);
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
      expect(stepHref(testCase.from, testCase.run)).toBe(testCase.expected);
    });
  }

  it("when a step's address is read back, then it is the run it was built from", () => {
    const run: BenchRun = { session: "k3x9q2", loop: 7, step: 1, ultra: true, keep: true, auto: false, ultraNext: true, extended: true, epi: false };
    const back = parseRun(searchOf(stepHref(base, run)));
    expect(back?.session, "session").toBe(run.session);
    expect(back?.loop, "cycle count").toBe(run.loop);
    expect(back?.step, "step").toBe(run.step);
    expect(back?.ultra, "this cycle's Ultra").toBe(run.ultra);
    expect(back?.keep, "keep").toBe(run.keep);
    expect(back?.auto, "auto").toBe(run.auto);
    expect(back?.ultraNext, "the next cycle's Ultra").toBe(run.ultraNext);
    expect(back?.epi, "the epicenter option").toBe(run.epi);
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
      expect(read).toBe(testCase.expected);
    });
  }
});

describe("given a bench page opened by its address alone, with no loop in it", () => {
  for (const step of cycleOf(ULTRA_AVAILABLE)) {
    it(`when the page is ${step.query} with extended=1, then it runs as an extended loop with every option on, at the step that runs that same bench, and moves on after it`, () => {
      const run = runFromPage(`?${step.query}&extended=1`, "k3x9q2");
      must(run !== null, "a cycle bench becomes a loop");
      expect(stepOf(run).id).toBe(step.id);
      must(run.keep && run.auto, "keep benching and auto-reload on");
      expect(advance(run), "the loop moves on after this bench").not.toBe(null);
    });
  }
  for (const search of ["?bench=lab", "?bench=city&course=four-count"]) {
    it(`when the page is ${search}, a bench the cycle doesn't run, then it runs once and is no loop`, () => {
      expect(runFromPage(search, "k3x9q2")).toBe(null);
    });
  }
  it("when the page is a strip without ultra=1 and Ultra is on in the loop, then it is the strip step all the same (the arm is the page's own choice) and the steps after it run their Ultra arm", () => {
    const run = runFromPage("?bench=strip", "k3x9q2");
    must(run !== null, "run !== null");
    expect(stepOf(run).id).toBe("strip:epi");
    expect(benchPlan("?bench=strip")!.ultra, "this page runs no Ultra arm").toBe(false);
    expect(benchPlan(`?${stepOf(advance(run)!).query}`)!.ultra, "the next step's page does").toBe(ULTRA_AVAILABLE);
  });
  it("when the page is the strip with keep, auto and loopultra turned off, then the loop it starts has them off and the address it rewrites keeps them off", () => {
    const run = runFromPage("?bench=strip&keep=0&auto=0&loopultra=0", "k3x9q2");
    must(run !== null, "run !== null");
    must(run.keep === false, "keep");
    must(run.auto === false, "auto");
    must(run.ultraNext === false, "loopultra");
    const back = parseRun(new URL(stepHref("https://game.test/crush/", run)).search);
    expect(back !== null && back.session === "k3x9q2" && back.step === run.step && !back.keep && !back.auto && !back.ultraNext, "the rewritten address keeps them off").toBeTruthy();
  });
  it("when the page is the strip with only keep turned off, then the options it leaves out are on", () => {
    const run = runFromPage("?bench=strip&keep=0", "k3x9q2");
    must(run !== null, "run !== null");
    must(run.keep === false, "keep");
    must(run.auto, "auto");
    expect(run.ultraNext, "loopultra").toBe(ULTRA_AVAILABLE);
  });
});

describe("given a loop address that leaves out its options (a loop carried over from an older build)", () => {
  it("when it is read, then keep benching and auto-reload are on, so the loop goes on past its cycle's last bench", () => {
    const run = parseRun("?bench=city&course=dam-spine&loop=af3fa60e&cycle=1&step=2");
    must(run !== null && run.keep && run.auto, "run !== null && run.keep && run.auto");
    expect(advance(run), "the loop starts its next cycle").not.toBe(null);
  });
  it("when an option is turned off with =0, then it is off and the address it writes keeps it off", () => {
    const run = parseRun("?bench=strip&loop=af3fa60e&keep=0");
    must(run !== null && !run.keep, "run !== null && !run.keep");
    expect(parseRun(new URL(stepHref("https://game.test/crush/", run)).search)!.keep).toBe(false);
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
      expect(isBenchPage(testCase.search), "bench page").toBe(testCase.expectedBench);
      expect(autoReloadAsked(testCase.search), "auto reload").toBe(testCase.expectedAuto);
    });
  }

  it("when a loop is at the second step of its second cycle, then the bench card reads where it is", () => {
    expect(loopProgress({ ...RUN, loop: 2, step: 1 })).toBe("loop 2, step 2/8");
  });
});

describe("given a page whose address carries a share # (a stale one, or one pasted with the bench's query)", () => {
  const hash = "#scene=garage&night=1";
  it("when the page is the bench of the biggest course, then it follows no # at all, so the garage never replaces the bench's own course", () => {
    expect(shareHashOf("?bench=city&course=dam-spine", hash)).toBe(null);
  });
  it("when the page is a strip bench that a loop sent it to, then it follows no # at all", () => {
    expect(shareHashOf("?bench=strip&loop=af3fa60e&cycle=1&step=0", hash)).toBe(null);
  });
  it("when the page is the plain game, then it follows its # as it is", () => {
    expect(shareHashOf("", hash)).toBe(hash);
  });
});

describe("given a page outside a secure context (a build opened over plain http on the LAN), where the browser cannot make a random id", () => {
  it("when the Benchmark entry starts a loop, then it gets a session its own bench page reads back as that loop", () => {
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new TypeError("crypto.randomUUID is not a function");
    });
    const run = startRun(newSession());
    const back = parseRun(new URL(stepHref("http://192.168.1.20:3000/", run)).search);
    expect(back !== null && back.session === run.session && back.step === run.step, "the bench page reads its own loop back").toBeTruthy();
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
    expect(log.ran.map((r) => r.split(" ")[0]).join(" ")).toBe(cycleOf(false).map((s) => s.id).join(" "));
    expect(log.ran.length, "steps: four maps, each off and on").toBe(8);
    expect(log.shown.length, "addresses shown").toBe(8);
    expect(new Set(log.shown).size, "each at its own address").toBe(8);
    expect(log.pauses, "a pause between steps, none after the last").toBe(7);
    expect(log.ran.filter((r) => r.endsWith("epi")).length, "four arms with the epicenter on").toBe(4);
  });

  it("when the loop keeps going, then the next cycle runs in the same page with its pairs the other way round", async () => {
    const { log, page } = fakePage({ noBenchAt: 11 });
    await driveLoop({ ...RUN, keep: true }, page);
    expect(log.ran.length, "the page that names no bench ends the loop at the twelfth step").toBe(12);
    expect(log.ran[8], "cycle 2 opens on the epicenter arm").toBe("strip:epi cycle 2 epi");
  });

  it("when a step names no bench the game knows, then the loop ends there", async () => {
    const { log, page } = fakePage({ noBenchAt: 2 });
    await driveLoop({ ...RUN, keep: false }, page);
    expect(log.ran.length, "steps run").toBe(3);
    expect(log.pauses, "pauses").toBe(2);
  });

  it("when a newer build is deployed after the third step, then the loop hands over to the reload there and runs no step after it", async () => {
    const { log, page } = fakePage({ reloadAt: 3 });
    await driveLoop({ ...RUN, keep: false }, page);
    expect(log.ran.length, "steps run before the reload").toBe(3);
    expect(log.reloads, "the reload was asked before the pause of each step it reached").toBe(3);
    expect(log.pauses, "the pause before the reload belongs to the reload").toBe(2);
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
    expect(idsOf(run)).toBe("strip:epi city:epi dam-spine:epi national-mall:epi");
    for (let at: BenchRun | null = run; at !== null && at.loop === 1; at = advance(at)) expect(benchPlan(loopSearch(at))!.epicenter, stepOf(at).id).toBe(true);
    expect(run.keep, "Loop is on").toBe(true);
  });

  it("when the Epicenter option is off, then the four maps run once each with no epicenter arm, and with Loop off it ends after them", () => {
    const run = runFromPage(withOptions("?bench=strip", { keep: false, epi: false, ultra: false, extended: false }), "k3x9q2")!;
    expect(idsOf(run)).toBe("strip city dam-spine national-mall");
    expect(advance({ ...run, step: 3 }), "the loop ends after the fourth map").toBe(null);
  });

  it("when a quick loop is kept, then every cycle runs the arm the run chose", () => {
    const second = advance({ ...startRun("k3x9q2"), step: 3 })!;
    expect(second.loop).toBe(2);
    expect(idsOf(second)).toBe("strip:epi city:epi dam-spine:epi national-mall:epi");
  });

  it("when a quick step's address is built and read back, then it carries the epicenter option and the bench kind, and the page's plan reads quick from it; an extended step's reads extended", () => {
    const run = { ...startRun("k3x9q2"), step: 2 };
    const back = parseRun(loopSearch(run))!;
    expect(firstMismatch([back.extended, back.epi, back.step, back.loop], [false, true, 2, 1])).toBeUndefined();
    expect(benchPlan(loopSearch(run))!.extended).toBe(false);
    expect(benchPlan(loopSearch(run))!.epicenter, "the page's own query asks for the activation").toBe(true);
    const long = startRun("k3x9q2", true);
    expect(benchPlan(loopSearch(long))!.extended).toBe(true);
    expect(parseRun(loopSearch(long))!.extended).toBe(true);
  });

  it("when a quick page is opened by hand, then the loop it starts runs from that map under the loop's epicenter option, whatever the page's own epi", () => {
    const run = runFromPage("?bench=city&epi=1", "k3x9q2")!;
    expect(firstMismatch([stepOf(run).id, stepOf(advance(run)!).id], ["city:epi", "dam-spine:epi"])).toBeUndefined();
    expect(stepOf(runFromPage("?bench=city&epi=1&loopepi=0", "k3x9q2")!).id).toBe("city");
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
    expect(ran.join(" ")).toBe("strip city dam-spine national-mall");
    expect(progress.join(" | ")).toBe("loop 1, step 1/4 | loop 1, step 2/4 | loop 1, step 3/4 | loop 1, step 4/4");
    expect(pauses).toBe(3);
  });
});

describe("given the chooser before a new loop (Extended, Loop, Epicenter, Ultra)", () => {
  it("when the Benchmark entry opens the bench page, then it names no loop yet, so the page asks for the options first, and it starts at the strip", () => {
    for (const extended of [false, true]) {
      const href = entryHref(`${LOOP_BASE}?seed=3#scene=race`, extended);
      expect(href).toBe(`${LOOP_BASE}?bench=strip${extended ? "&extended=1" : ""}&choose=1`);
      expect(asksOptions(new URL(href).search), "the entry asks for the chooser").toBe(true);
      const search = new URL(href).search;
      expect(parseRun(search), "no loop in the address").toBe(null);
      const run = runFromPage(search, "k3x9q2")!;
      expect(firstMismatch([run.step, run.keep, run.epi], [0, true, true]), "at the strip, Loop and Epicenter on").toBeUndefined();
      expect(run.extended, "the entry's bench").toBe(extended);
      expect(run.ultra, "Ultra on where the build has it").toBe(ULTRA_AVAILABLE);
    }
  });

  it("when Epicenter is turned off for the extended bench, then each map runs once without it, the extended page all the same", () => {
    const run = runFromPage(withOptions("?bench=strip&extended=1", { keep: true, epi: false, ultra: false, extended: true }), "k3x9q2")!;
    expect(idsOf(run)).toBe("strip city dam-spine national-mall");
    expect(benchPlan(loopSearch(run))!.extended).toBe(true);
  });

  it("when the options are chosen, then Ultra on runs Ultra this cycle and the next where the build has it, and off runs it in neither", () => {
    const on = runFromPage(withOptions("?bench=strip", { keep: true, epi: true, ultra: true, extended: false }), "k3x9q2")!;
    const off = runFromPage(withOptions("?bench=strip", { keep: true, epi: true, ultra: false, extended: false }), "k3x9q2")!;
    expect(on.ultra && on.ultraNext, "on: this cycle and the next, where the build has it").toBe(ULTRA_AVAILABLE);
    expect(off.ultra || off.ultraNext, "off: neither").toBe(false);
  });

  it("when an option is turned off, then every later page of the run, read back from its own address, has it off", () => {
    let at: BenchRun | null = runFromPage(withOptions("?bench=strip", { keep: true, epi: false, ultra: false, extended: false }), "k3x9q2");
    for (let pages = 0; pages < 8; pages++) {
      must(at !== null, `page ${pages}`);
      const search = loopSearch(at);
      expect(firstMismatch([at.keep, at.epi, at.ultra, at.ultraNext, benchPlan(search)!.epicenter, benchPlan(search)!.ultra], [true, false, false, false, false, false]), `page ${pages}`).toBeUndefined();
      at = advance(parseRun(search)!);
    }
  });

  it("when Extended is chosen on the quick entry, then the run is the extended cycle: every map whole, then under the epicenter, each page extended", () => {
    const run = runFromPage(withOptions("?bench=strip&choose=1", { keep: true, epi: true, ultra: false, extended: true }), "k3x9q2")!;
    expect(idsOf(run)).toBe("strip strip:epi city city:epi dam-spine dam-spine:epi national-mall national-mall:epi");
    expect(benchPlan(loopSearch(run))!.extended).toBe(true);
  });

  it("when a bench address with params but no entry mark is opened, then it asks no options and its loop starts at once under what it sets, the rest on", () => {
    const search = "?bench=strip&extended=1";
    expect(asksOptions(search)).toBe(false);
    const run = runFromPage(search, "k3x9q2")!;
    expect(firstMismatch([run.extended, run.epi, run.keep, run.auto], [true, true, true, true])).toBeUndefined();
    expect(stepOf(run).id).toBe("strip");
  });

  it("when /bench is opened bare, then it points at the entry (the chooser); with params, at that bench page with them, no chooser", () => {
    const bare = benchRouteSearch({});
    expect(Object.keys(bare), "bare: keys").toHaveLength(2);
    expect(bare.bench, "bare: bench").toBe("strip");
    expect(bare.choose, "bare: choose").toBe(1);
    const extended = benchRouteSearch({ extended: 1 });
    expect(Object.keys(extended), "extended: keys").toHaveLength(2);
    expect(extended.bench, "extended: bench").toBe("strip");
    expect(extended.extended, "extended: extended").toBe(1);
    const named = benchRouteSearch({ bench: "city", course: "dam-spine", extended: 1, keep: 0 });
    expect(Object.keys(named), "named: keys").toHaveLength(4);
    expect(named.bench, "named: bench").toBe("city");
    expect(named.course, "named: course").toBe("dam-spine");
    expect(named.extended, "named: extended").toBe(1);
    expect(named.keep, "named: keep").toBe(0);
  });
});
