import { afterEach, describe, expect, it } from "vitest";
import { PageWorker } from "../../engine/page-worker.test-util.ts";
import { firstMismatch } from "../../kernel/compare-arrays.test-util.ts";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { EVENT_KIND } from "./civilian-constants.ts";
import { buildFixtureMap, placeNamed } from "./civilian-graph.test-util.ts";
import { CivilianRemote } from "./civilian-remote.ts";
import { answerDigest, stateDigest } from "./civilian-run.test-util.ts";
import { queueEvents } from "./civilian-events.ts";
import { computeTick } from "./civilian-tick.ts";
import { answerBuffers, type FromCivilianWorker, type TickAnswer, type ToCivilianWorker } from "./civilian-wire.ts";
import { createCityState } from "./society.ts";

const map = buildFixtureMap();
const SEED = 17;
const RESIDENTS = 60;
const TICKS = 3200;
/** What the host tells the brain: a knock on one resident, a wreck at the bodega and one at the pizza place, by crowd second. */
const HOST_EVENTS = new Map<number, number[]>([
  [1500, [EVENT_KIND.knock, 21, 750]],
  [1300, [EVENT_KIND.wreck, placeNamed(map, PLACE_NAMES.bodega), 650]],
  [2200, [EVENT_KIND.wreck, placeNamed(map, "Moore Street Pizza"), 1100]],
]);

function eventsAt(tick: number): number[] {
  return HOST_EVENTS.get(tick) ?? [];
}

function noFailure(err: Error): never {
  throw err;
}

/** A worker thread (the page's `Worker` in node) that remembers what was posted to it and lets a test wait for its answers by event, not by time. */
class SpyWorker extends PageWorker {
  static last: SpyWorker;
  readonly posted: ToCivilianWorker[] = [];
  private answers = 0;
  private waiting: { count: number; resolve: () => void; reject: (err: Error) => void } | null = null;

  constructor(url: string | URL) {
    super(url);
    SpyWorker.last = this;
    this.addEventListener("message", (event) => {
      this.answers++;
      if (this.waiting !== null && this.answers >= this.waiting.count) this.waiting.resolve();
    });
    this.addEventListener("error", (event) => this.waiting?.reject(new Error(event.message ?? "worker thread failed")));
  }

  override postMessage(message: ToCivilianWorker, transfer?: ArrayBuffer[] | { transfer?: ArrayBuffer[] }): void {
    this.posted.push(message);
    super.postMessage(message, transfer);
  }

  /** Resolves when the worker has sent `count` messages. */
  whenAnswered(count: number): Promise<void> {
    if (this.answers >= count) return Promise.resolve();
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    this.waiting = { count, resolve, reject };
    return promise;
  }
}

/** A Worker that records what is posted to it and says only what the test has it say. */
class ScriptedWorker {
  static last: ScriptedWorker;
  readonly posted: { message: ToCivilianWorker; transfer: ArrayBuffer[] }[] = [];
  onmessage: ((event: { data: FromCivilianWorker }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;

  constructor() {
    ScriptedWorker.last = this;
  }

  postMessage(message: ToCivilianWorker, transfer: ArrayBuffer[] = []): void {
    this.posted.push({ message, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  say(message: FromCivilianWorker): void {
    this.onmessage!({ data: message });
  }
}

function usePageWorker(kind: typeof SpyWorker | typeof ScriptedWorker): void {
  Object.assign(globalThis, { Worker: kind });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "Worker");
});

describe("given the brain in a worker thread and the same brain computing in the main thread alone, both told the same events", () => {
  it("when a game day and more of ticks is taken from each, then every tick's answer and the final state are the same", async () => {
    const alone = CivilianRemote.open(noFailure);
    alone.init(SEED, map, RESIDENTS);
    usePageWorker(SpyWorker);
    const threaded = CivilianRemote.open(noFailure);
    threaded.init(SEED, map, RESIDENTS);
    for (let tick = 0; tick <= TICKS; tick++) {
      alone.post(tick, eventsAt(tick));
      threaded.post(tick, eventsAt(tick));
    }
    await SpyWorker.last.whenAnswered(TICKS + 1);
    const answerRows: number[] = [];
    for (let tick = 0; tick <= TICKS; tick++) {
      const computed = alone.take(tick);
      const heard = threaded.take(tick);
      expect(answerDigest(heard), `answer of tick ${tick} from the worker against the main thread's own`).toBe(answerDigest(computed));
      answerRows.push(heard.residents.length);
    }
    expect(alone.usingWorker, "the lone brain has no worker").toBe(false);
    expect(threaded.usingWorker, "the other still uses its worker").toBe(true);
    expect(threaded.traffic.heardMessages, "answers the worker sent").toBe(TICKS + 1);
    expect(threaded.traffic.lateAnswers, "answers that came after the main thread had the tick").toBe(0);
    expect(stateDigest(threaded.state), "final state with the worker against without").toBe(stateDigest(alone.state));
    expect(Math.max(...answerRows), "most rows one tick changed").toBeGreaterThan(0);
    expect(answerRows.reduce((sum, rows) => sum + rows, 0), "rows changed over the run").toBeGreaterThan(100);
  });

  it("when events and the map are posted to the worker, then their typed arrays go by transfer: the main thread's own copies are not detached, the posted events are", async () => {
    usePageWorker(SpyWorker);
    const remote = CivilianRemote.open(noFailure);
    remote.init(SEED, map, RESIDENTS);
    remote.post(0, [EVENT_KIND.wreck, placeNamed(map, PLACE_NAMES.bodega), 0]);
    await SpyWorker.last.whenAnswered(1);
    const [init, plan] = SpyWorker.last.posted;
    expect(init!.kind, "first message").toBe("init");
    expect(plan!.kind, "second message").toBe("plan");
    if (plan!.kind === "plan") expect(plan!.events.buffer.byteLength, "bytes left in the posted events").toBe(0);
    expect(map.graph.nodeX.byteLength, "bytes left in the main thread's map").toBeGreaterThan(0);
    expect(remote.traffic.postedMessages, "messages posted").toBe(2);
    expect(remote.traffic.postedBytes, "bytes handed over").toBeGreaterThan(map.graph.nodeX.byteLength);
  });
});

/** The answers a worker would send for ticks 0..`last`, computed on a state of its own. */
function workersAnswers(last: number): TickAnswer[] {
  const state = createCityState(SEED, map, RESIDENTS);
  const answers: TickAnswer[] = [];
  for (let tick = 0; tick <= last; tick++) {
    queueEvents(state, tick, eventsAt(tick));
    answers.push(computeTick(state, tick));
  }
  return answers;
}

describe("given the main thread asks for a tick before the worker has answered it", () => {
  it("when the worker's answers come afterwards, then the tick was computed by the main thread to the same bytes, and the late answers are dropped", () => {
    usePageWorker(ScriptedWorker);
    const remote = CivilianRemote.open(noFailure);
    remote.init(SEED, map, RESIDENTS);
    for (let tick = 0; tick <= 8; tick++) remote.post(tick, eventsAt(tick));
    const taken = remote.take(5);
    const theirs = workersAnswers(8);
    for (let tick = 0; tick <= 5; tick++) ScriptedWorker.last.say({ kind: "answer", answer: theirs[tick]! });
    expect(remote.traffic.lateAnswers, "late answers dropped").toBe(6);
    expect(answerDigest(taken), "tick 5 computed here against the worker's own").toBe(answerDigest(theirs[5]!));
    ScriptedWorker.last.say({ kind: "answer", answer: theirs[6]! });
    expect(answerDigest(remote.take(6)), "tick 6 as the worker's answer was").toBe(answerDigest(theirs[6]!));
    expect(answerDigest(remote.take(8)), "tick 8, with tick 7 computed here on the way").toBe(answerDigest(theirs[8]!));
    expect(remote.traffic.lateAnswers, "late answers after those").toBe(6);
  });
});

describe("given the worker dies after its first answers", () => {
  it("when ticks are taken after that, then the main thread carries on alone to the same state, and nothing more is posted", () => {
    usePageWorker(ScriptedWorker);
    let failures = 0;
    const remote = CivilianRemote.open(() => failures++);
    remote.init(SEED, map, RESIDENTS);
    remote.post(0, []);
    ScriptedWorker.last.onerror!({ message: "worker error" });
    const postedBefore = ScriptedWorker.last.posted.length;
    for (let tick = 1; tick <= 30; tick++) remote.post(tick, eventsAt(tick));
    const answers = workersAnswers(30);
    for (let tick = 0; tick <= 30; tick++) expect(answerDigest(remote.take(tick)), `tick ${tick} computed alone`).toBe(answerDigest(answers[tick]!));
    expect(failures, "failures reported").toBe(1);
    expect(remote.usingWorker, "worker still in use").toBe(false);
    expect(ScriptedWorker.last.terminated, "worker terminated").toBe(true);
    expect(ScriptedWorker.last.posted.length, "messages posted after the failure").toBe(postedBefore);
  });
});

describe("given the worker's module loaded against a scripted scope", () => {
  type Sent = { message: FromCivilianWorker; transfer: ArrayBuffer[] };
  const sent: Sent[] = [];
  const scope: { postMessage: (message: FromCivilianWorker, options: { transfer: ArrayBuffer[] }) => void; onmessage: ((event: { data: ToCivilianWorker }) => void) | null } = {
    postMessage: (message, options) => void sent.push({ message, transfer: options.transfer }),
    onmessage: null,
  };
  Object.assign(globalThis, { self: scope });

  async function hear(message: ToCivilianWorker): Promise<void> {
    await import("./civilian-worker.ts");
    scope.onmessage!({ data: message });
  }

  it("when a plan comes before the city was told, then it says so and answers nothing", async () => {
    await hear({ kind: "plan", tick: 0, events: new Float64Array(0) });
    expect(sent.length, "messages sent").toBe(1);
    const reply = sent[0]!.message;
    expect(reply.kind, "kind of the one message").toBe("failed");
    expect(reply.kind === "failed" ? reply.message : "", "what it said").toContain("plan before init");
    sent.length = 0;
  });

  it("when it is told the city and the tick to reach, then it answers each tick in order, handing over every buffer of each answer", async () => {
    await hear({ kind: "init", seed: SEED, playableResidents: RESIDENTS, map });
    await hear({ kind: "plan", tick: 4, events: Float64Array.of(EVENT_KIND.wreck, placeNamed(map, PLACE_NAMES.bodega), 1) });
    const ticks: number[] = [];
    for (const entry of sent) {
      if (entry.message.kind !== "answer") continue;
      const { answer } = entry.message;
      ticks.push(answer.tick);
      expect(entry.transfer.length, `buffers handed over with tick ${answer.tick}`).toBe(6);
      expect(firstMismatch(entry.transfer.map((buffer) => buffer.byteLength), answerBuffers(answer).map((buffer) => buffer.byteLength)), `sizes handed over with tick ${answer.tick}`).toBeUndefined();
    }
    expect(firstMismatch(ticks, [0, 1, 2, 3, 4]), "ticks answered").toBeUndefined();
  });
});
