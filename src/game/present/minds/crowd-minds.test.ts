import { afterEach, describe, expect, it, vi } from "vitest";
import { TICKS_PER_GAME_HOUR } from "../../ai/civilians/civilian-constants.ts";
import { FRAME_HZ } from "../../kernel/constants.ts";
import { STIMULUS } from "../civilian-gaze.ts";
import { KIND_LIFE } from "../civilian-gaze-constants.ts";
import { CrowdMinds } from "./crowd-minds.ts";
import { mindsWorld, putStimulus, StandInWorker } from "./minds.test-util.ts";
import { VERDICT } from "./thought-tools.ts";

const FRAME = 1 / FRAME_HZ;

/** Minds over the staged world, with a counter of the workers they make (each a stand-in). */
function minds() {
  const { world, resident, gaze } = mindsWorld();
  const workers: StandInWorker[] = [];
  const crowd = new CrowdMinds(world.state!.capacity, world, () => {
    const worker = new StandInWorker();
    workers.push(worker);
    return worker;
  });
  return { crowd, world, resident, gaze, workers };
}

/** Minds that are on, asked about `resident`, with their worker loaded and its ask in hand: the line the fallback gave, and the worker. */
function asked() {
  const made = minds();
  made.crowd.setOn(true);
  const fallback = made.crowd.lookAt(made.resident);
  const worker = made.workers[0]!;
  worker.reply({ kind: "ready", loadMs: 30, cached: true });
  return { ...made, fallback, worker };
}

afterEach(() => vi.restoreAllMocks());

describe("given the Minds setting off", () => {
  // mutation: sed -i 's/    if (!this.on || this.broken || /    if (this.broken || /' src/game/present/minds/crowd-minds.ts
  it("when a resident is looked at and a crash pulse lingers beside the crowd for 1000 frames, then the panel has her thought, and no worker is made and nothing is fetched", () => {
    const fetched = vi.spyOn(globalThis, "fetch");
    const { crowd, resident, gaze, workers } = minds();
    putStimulus(gaze, 0, STIMULUS.crash, 2, 0, 1, KIND_LIFE[STIMULUS.crash]!);
    expect(crowd.lookAt(resident), "her thought").toMatch(/^Thinks "/);
    for (let frame = 0; frame < 1000; frame++) crowd.frame(FRAME);
    expect(workers.length, "workers made").toBe(0);
    expect(fetched, "fetches").not.toHaveBeenCalled();
  });

  it("when it is turned on and she is looked at again in a new hour, then one worker is made and told to load (control)", () => {
    const { crowd, world, resident, workers } = minds();
    crowd.lookAt(resident);
    crowd.setOn(true);
    world.tick += TICKS_PER_GAME_HOUR;
    crowd.lookAt(resident);
    expect(workers.length, "workers made").toBe(1);
    expect(workers[0]!.sent[0]?.kind, "its first message").toBe("load");
  });
});

describe("given the Minds setting on and a resident looked at", () => {
  // mutation: sed -i '/^    this.verdicts\[verdict\]!++;/d' src/game/present/minds/crowd-minds.ts
  it("when the model answers with a tool that is not a thought, then her panel line stays the fallback's and the answer is counted as unknown", () => {
    const { crowd, resident, fallback, worker } = asked();
    worker.reply({ kind: "answer", id: worker.lastAsk(), text: '<tool_call>[{"name":"dance","arguments":{"style":"waltz"}}]', ms: 4000 });
    expect(crowd.lookAt(resident), "her line").toBe(fallback);
    expect(crowd.verdicts[VERDICT.unknownTool], "unknown answers").toBe(1);
  });

  // mutation: sed -i 's/    if (verdict !== VERDICT.taken || this.thoughtHour\[resident\] !== ask.hour) return;/    if (this.thoughtHour[resident] !== ask.hour) return;/' src/game/present/minds/crowd-minds.ts
  it("when the model answers with a look at a crash nobody saw, then her panel line stays the fallback's: the answer does not fit her moment", () => {
    const { crowd, resident, fallback, worker } = asked();
    worker.reply({ kind: "answer", id: worker.lastAsk(), text: '<tool_call>[{"name":"look_at","arguments":{"stimulus":"crash"}}]', ms: 4000 });
    expect(crowd.lookAt(resident), "her line").toBe(fallback);
    expect(crowd.verdicts[VERDICT.absent], "answers that do not fit").toBe(1);
  });

  // mutation: sed -i 's/    this.keep(resident, ask.hour, this.pick, ask.sit.purpose);/    void ask.sit;/' src/game/present/minds/crowd-minds.ts
  it("when the model answers with a thought that fits, then her panel line becomes it", () => {
    const { crowd, resident, fallback, worker } = asked();
    worker.reply({ kind: "answer", id: worker.lastAsk(), text: '<tool_call>[{"name":"ignore","arguments":{}}]', ms: 4000 });
    expect(fallback, "control: the fallback had a thought").not.toBe('Thinks "Minding my own business."');
    expect(crowd.lookAt(resident), "her line").toBe('Thinks "Minding my own business."');
    expect(crowd.verdicts[VERDICT.taken], "answers taken").toBe(1);
  });

  // mutation: sed -i 's/^const ASK_BUDGET_S = 15;/const ASK_BUDGET_S = 1e9;/' src/game/present/minds/crowd-minds.ts
  it("when the model takes longer than 15 s, then the worker is ended, the answer is late and her line stays the fallback's", () => {
    const { crowd, resident, fallback, worker } = asked();
    for (let frame = 0; frame < 16 * FRAME_HZ; frame++) crowd.frame(FRAME);
    expect(worker.terminated, "the worker ended").toBe(true);
    worker.reply({ kind: "answer", id: worker.lastAsk(), text: '<tool_call>[{"name":"ignore","arguments":{}}]', ms: 16000 });
    expect(crowd.verdicts[VERDICT.late], "late answers").toBeGreaterThanOrEqual(1);
    expect(crowd.lookAt(resident), "her line").toBe(fallback);
  });
});

describe("given a crowd standing together", () => {
  // mutation: sed -i 's/^const STAGGER_STEP_S = 0.15;/const STAGGER_STEP_S = 0;/' src/game/present/minds/crowd-minds.ts
  it("when a crash pulse appears 2 m away, then within 2.5 s a group of them turn to it one after another, not in one frame, and no worker is made", () => {
    const { crowd, gaze, workers } = minds();
    const turned: number[] = [];
    vi.spyOn(gaze, "attend").mockImplementation((index, x, _y, z) => {
      expect([x, z], `${index} turns to the crash`).toEqual([2, 0]);
      turned.push(Math.round(crowd["seconds"] * FRAME_HZ));
    });
    putStimulus(gaze, 0, STIMULUS.crash, 2, 0, 1, KIND_LIFE[STIMULUS.crash]!);
    for (let frame = 0; frame < 2.5 * FRAME_HZ; frame++) crowd.frame(FRAME);
    expect(turned.length, "heads turned").toBe(12);
    expect(new Set(turned).size, "frames they turned in").toBeGreaterThan(6);
    expect(workers.length, "workers made").toBe(0);
  });

  // mutation: sed -i 's/      if (!PULSE_KINDS.includes(kind) || table.life\[row\]! < KIND_LIFE\[kind\]! - FRESH_S || /      if (!PULSE_KINDS.includes(kind) || /' src/game/present/minds/crowd-minds.ts
  it("when the crash pulse in the table is already old, then nobody turns to it", () => {
    const { crowd, gaze } = minds();
    const attend = vi.spyOn(gaze, "attend");
    putStimulus(gaze, 0, STIMULUS.crash, 2, 0, 1, 1);
    for (let frame = 0; frame < 2.5 * FRAME_HZ; frame++) crowd.frame(FRAME);
    expect(attend, "heads turned").not.toHaveBeenCalled();
  });
});
