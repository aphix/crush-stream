import { afterEach, describe, expect, it } from "vitest";
import { PageWorker } from "../../engine/page-worker.test-util.ts";
import { tickAt } from "./civilian-clock.ts";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { EVENT_KIND, FLAG, NEVER_TICK, RESIDENT_INT, RESIDENT_INT_STRIDE } from "./civilian-constants.ts";
import type { CivilianCrowd } from "./civilian-crowd.ts";
import { buildFixtureMap, placeNamed } from "./civilian-graph.test-util.ts";
import { CivilianRemote } from "./civilian-remote.ts";
import { stateDigest } from "./civilian-run.test-util.ts";
import { queueEvents } from "./civilian-events.ts";
import { computeTick } from "./civilian-tick.ts";
import type { FromCivilianWorker, TickAnswer, ToCivilianWorker } from "./civilian-wire.ts";
import { createCityState } from "./society.ts";
import type { CityState } from "./civilian-state.ts";
import { CROWD_RESIDENTS, CROWD_SEED, newCrowd, posesDigest, shownResident } from "./civilian-crowd.test-util.ts";

const map = buildFixtureMap();
const bodega = placeNamed(map, PLACE_NAMES.bodega);
/** Frames of a sixteenth of a crowd second (a power of two: the clock sums exactly), five minutes of them; the host's knock and wreck land at these. */
const FRAME_SECONDS = 1 / 16;
const FRAMES = 300 * 16;
const KNOCK_FRAME = 100 * 16;
const FIGHT_FRAME = 120 * 16;
const BUST_FRAME = 130 * 16;
const WRECK_FRAME = 150 * 16;
/** Two generated residents the host raises a fight between, then a bust of the first. */
const FIGHTER_OFFSETS = [20, 21] as const;

function noFailure(err: Error): never {
  throw err;
}

/** A worker thread (the page's `Worker` in node) that lets a test wait for its answers by count, not by time. */
class CountingWorker extends PageWorker {
  static last: CountingWorker;
  private answers = 0;
  private waiting: { count: number; resolve: () => void } | null = null;

  constructor(url: string | URL) {
    super(url);
    CountingWorker.last = this;
    this.addEventListener("message", () => {
      this.answers++;
      if (this.waiting !== null && this.answers >= this.waiting.count) this.waiting.resolve();
    });
  }

  whenAnswered(count: number): Promise<void> {
    if (this.answers >= count) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiting = { count, resolve };
    });
  }
}

/** A worker that computes each plan at once as the real one does but says nothing until told, and then only of ticks the main thread has taken already: every answer of it is late. */
class LateWorker {
  static last: LateWorker;
  onmessage: ((event: { data: FromCivilianWorker }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  private brain: CityState | null = null;
  private readonly unsent: TickAnswer[] = [];

  constructor() {
    LateWorker.last = this;
  }

  postMessage(message: ToCivilianWorker): void {
    if (message.kind === "init") {
      this.brain = createCityState(message.seed, message.map, message.playableResidents);
      return;
    }
    queueEvents(this.brain!, message.tick, message.events);
    while (this.brain!.nextTick <= message.tick) this.unsent.push(computeTick(this.brain!, this.brain!.nextTick));
  }

  terminate(): void {}

  say(throughTick: number): void {
    while (this.unsent.length > 0 && this.unsent[0]!.tick <= throughTick) this.onmessage!({ data: { kind: "answer", answer: this.unsent.shift()! } });
  }
}

type Run = { label: string; crowd: CivilianCrowd; remote: CivilianRemote };

/** A crowd whose brain is the kind of `Worker` installed while it opens (none: the main thread's own). */
function openRun(label: string, worker?: typeof CountingWorker | typeof LateWorker): Run {
  if (worker === undefined) Reflect.deleteProperty(globalThis, "Worker");
  else Object.assign(globalThis, { Worker: worker });
  const remote = CivilianRemote.open(noFailure);
  return { label, crowd: newCrowd(map, CROWD_RESIDENTS, CROWD_SEED, remote), remote };
}

/** The host's log as it was heard by `frame`: the knock, a fight of two residents, the bust of one of them and the wreck, each from its own frame on. */
function logAt(frame: number, knocked: number, fighters: readonly number[]): Float64Array {
  const fightSeconds = FIGHT_FRAME * FRAME_SECONDS;
  const heard: readonly { from: number; triples: readonly number[] }[] = [
    { from: KNOCK_FRAME, triples: [EVENT_KIND.knock, knocked, KNOCK_FRAME * FRAME_SECONDS] },
    { from: FIGHT_FRAME, triples: [EVENT_KIND.fight, fighters[0]!, fightSeconds, EVENT_KIND.alongside, fighters[1]!, fightSeconds] },
    { from: BUST_FRAME, triples: [EVENT_KIND.bust, fighters[0]!, BUST_FRAME * FRAME_SECONDS] },
    { from: WRECK_FRAME, triples: [EVENT_KIND.wreck, bodega, WRECK_FRAME * FRAME_SECONDS] },
  ];
  return Float64Array.from(heard.filter((event) => frame >= event.from).flatMap((event) => event.triples));
}

/** What a run shows and holds at this frame: its poses and its society's rows. */
function look(run: Run): string {
  return `${posesDigest(run.crowd.poses)}/${stateDigest(run.crowd.state)}`;
}

/** Every frame's step of all runs in lockstep, as a client's: the real worker's answers awaited by count before the tick that needs them, the late worker's said after the step. Returns the frames at which a run differed from the first. */
async function runAll(runs: readonly Run[], plain: Run, knocked: { resident: number }, fighters: readonly number[]): Promise<string[]> {
  const apart: string[] = [];
  let lastTick = -1;
  for (let frame = 1; frame <= FRAMES; frame++) {
    const seconds = frame * FRAME_SECONDS;
    const tick = tickAt(seconds);
    if (frame === KNOCK_FRAME) knocked.resident = shownResident(runs[0]!.crowd);
    if (lastTick >= 0 && tick > lastTick) await CountingWorker.last.whenAnswered(tick + 1);
    for (const run of runs) {
      run.crowd.hear(logAt(frame, knocked.resident, fighters));
      run.crowd.step(seconds, [], false);
    }
    plain.crowd.step(seconds, [], false);
    LateWorker.last.say(tick);
    lastTick = tick;
    for (const run of runs.slice(1)) if (look(run) !== look(runs[0]!)) apart.push(`${run.label} at frame ${frame}`);
  }
  return apart;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "Worker");
});

describe("given the same crowd stepped five minutes with the real worker, with none, and with a worker whose answers come late, a knock and a wreck heard at fixed frames", () => {
  it("when every frame's poses and society rows are compared, then the three are bit for bit the same, and the events changed the crowd", async () => {
    const alone = openRun("alone");
    const threaded = openRun("worker", CountingWorker);
    const late = openRun("late worker", LateWorker);
    const plain = openRun("no events");
    const knocked = { resident: -1 };
    const fighters = FIGHTER_OFFSETS.map((offset) => alone.crowd.state.cast.length + offset);
    const apart = await runAll([alone, threaded, late], plain, knocked, fighters);
    expect(apart.slice(0, 5), "frames at which a run differed from the main thread's own").toEqual([]);
    expect(alone.remote.usingWorker, "the lone run has no worker").toBe(false);
    expect(threaded.remote.usingWorker, "the worker run still uses it").toBe(true);
    expect(threaded.remote.traffic.heardMessages, "answers the worker sent").toBeGreaterThan(300);
    expect(threaded.remote.traffic.lateAnswers, "answers that came after their tick was taken: only the first tick").toBeLessThanOrEqual(1);
    expect(late.remote.traffic.lateAnswers, "answers that came late").toBeGreaterThan(300);
    expect(alone.crowd.state.ints[knocked.resident * RESIDENT_INT_STRIDE + RESIDENT_INT.flags]! & FLAG.hurt, "the knocked is hurt").toBe(FLAG.hurt);
    expect(alone.crowd.state.closedUntilTick[bodega]!, "the bodega is shut").toBeGreaterThan(tickAt(FRAMES * FRAME_SECONDS));
    expect(alone.crowd.state.ints[fighters[0]! * RESIDENT_INT_STRIDE + RESIDENT_INT.flags]! & FLAG.custody, "the busted fighter is in custody").toBe(FLAG.custody);
    expect(alone.crowd.state.ints[fighters[1]! * RESIDENT_INT_STRIDE + RESIDENT_INT.fightTick], "the other fighter's fight ended or was ended").toBe(NEVER_TICK);
    expect(look(plain), "control: a crowd that heard nothing is another crowd").not.toBe(look(alone));
  }, 120_000);
});
