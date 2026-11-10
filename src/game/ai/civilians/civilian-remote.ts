import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import { PLAN_LEAD_TICKS } from "./civilian-constants.ts";
import { queueEvents } from "./civilian-events.ts";
import type { CityState } from "./civilian-state.ts";
import { computeTick } from "./civilian-tick.ts";
import { answerBuffers, applyAnswer, type FromCivilianWorker, type TickAnswer, type ToCivilianWorker } from "./civilian-wire.ts";
import { openWorldSignals } from "./civilian-signals.ts";
import { createCityState } from "./society.ts";

/** What the main thread posted to the worker and heard from it so far, in messages and the bytes of the typed arrays handed over, and the answers that came after the main thread had computed the tick itself. */
interface CivilianTraffic {
  postedMessages: number;
  postedBytes: number;
  heardMessages: number;
  heardBytes: number;
  lateAnswers: number;
}

/** What a post carries when nothing was heard. */
const NO_EVENTS: readonly number[] = [];

/** A copy of the map whose typed arrays can be handed to the worker without detaching the main thread's own. */
function mapForWorker(map: OpenWorldMap): { map: OpenWorldMap; buffers: ArrayBuffer[] } {
  const { graph } = map;
  const copy: OpenWorldMap = {
    ...map,
    graph: { nodeX: graph.nodeX.slice(), nodeZ: graph.nodeZ.slice(), edgeStart: graph.edgeStart.slice(), edgeTo: graph.edgeTo.slice(), edgeLength: graph.edgeLength.slice(), edgeCrossing: graph.edgeCrossing.slice() },
    portals: map.portals.slice(),
  };
  const buffers = [copy.graph.nodeX, copy.graph.nodeZ, copy.graph.edgeStart, copy.graph.edgeTo, copy.graph.edgeLength, copy.graph.edgeCrossing, copy.portals]
    .map((array) => array.buffer)
    .filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);
  return { map: copy, buffers };
}

/**
 * The city's brain (`civilian-worker.ts`) as the main thread talks to it. The main thread keeps a mirror of the city's state (`state`), applies the worker's answer for each tick, and when a tick's answer has
 * not come back by the time it is due computes it itself with the same pure step, so a slow, dead or missing worker changes nothing the crowd shows.
 */
export class CivilianRemote {
  readonly traffic: CivilianTraffic;
  private worker: Worker | null;
  private readonly onFail: (err: Error) => void;
  private mirror: CityState | null = null;
  /** Answers heard and not yet applied, by tick. */
  private readonly heard = new Map<number, TickAnswer>();
  /** The newest tick posted. */
  private postedThrough = -1;

  private constructor(worker: Worker | null, onFail: (err: Error) => void, traffic: CivilianTraffic) {
    this.worker = worker;
    this.onFail = onFail;
    this.traffic = traffic;
    if (worker === null) return;
    worker.onmessage = (event: MessageEvent<FromCivilianWorker>) => this.hear(event.data);
    worker.onerror = (event) => this.fail(new Error(event.message || "worker error"));
    worker.onmessageerror = () => this.fail(new Error("worker message could not be read"));
  }

  /** The brain with its worker, or computing in the main thread alone where the browser has none (or it would not start: logged). Its traffic counts into `traffic`. */
  static open(onFail: (err: Error) => void, traffic: CivilianTraffic = { postedMessages: 0, postedBytes: 0, heardMessages: 0, heardBytes: 0, lateAnswers: 0 }): CivilianRemote {
    if (typeof Worker === "undefined") return new CivilianRemote(null, onFail, traffic);
    try {
      return new CivilianRemote(new Worker(new URL("./civilian-worker.ts", import.meta.url), { type: "module" }), onFail, traffic);
    } catch (err) {
      console.error("Crush Stream civilian worker did not start", err);
      return new CivilianRemote(null, onFail, traffic);
    }
  }

  /** The main thread's own copy of the city, the same as the worker's after each tick taken. */
  get state(): CityState {
    if (this.mirror === null) throw new Error("civilian brain not started: call init first");
    return this.mirror;
  }

  /** True while the worker is the one doing the work. */
  get usingWorker(): boolean {
    return this.worker !== null;
  }

  /** Starts the city: builds the mirror and has the worker build its own from the same seed and map. */
  init(seed: number, map: OpenWorldMap, playableResidents: number, signals = false): void {
    this.mirror = createCityState(seed, map, playableResidents, signals ? openWorldSignals() : null);
    this.heard.clear();
    if (this.worker === null) return;
    const wire = mapForWorker(map);
    this.send({ kind: "init", seed, playableResidents, map: wire.map, signals }, wire.buffers);
  }

  /** The events of the crowd time up to tick `tick` (kind, subject, seconds triples) and the order to plan it. Ticks are posted in order, each at least the next to take. */
  post(tick: number, events: ArrayLike<number>): void {
    const mirror = this.state;
    if (tick < mirror.nextTick) throw new Error(`civilian tick ${tick} posted after tick ${mirror.nextTick - 1} was taken`);
    queueEvents(mirror, tick, events);
    this.postedThrough = Math.max(this.postedThrough, tick);
    const sent = Float64Array.from(events);
    this.send({ kind: "plan", tick, events: sent }, [sent.buffer]);
  }

  /** One tick of the crowd's frame loop: plans are asked for `PLAN_LEAD_TICKS` ahead of `tick` (every tick up to it is posted once, the events heard since with the first of them), then `tick` is taken. */
  advance(tick: number, events: ArrayLike<number>): TickAnswer {
    const through = tick + PLAN_LEAD_TICKS;
    if (events.length > 0 && through <= this.postedThrough) throw new Error(`civilian events heard for tick ${tick}, whose plan was posted already`);
    let heardWith = events;
    for (let next = this.postedThrough + 1; next <= through; next++) {
      this.post(next, heardWith);
      heardWith = NO_EVENTS;
    }
    return this.take(tick);
  }

  /** The answer for tick `tick`, applied to `state`: the worker's if it has come, else computed here by the same step. Ticks before it that were not taken are taken first. */
  take(tick: number): TickAnswer {
    const mirror = this.state;
    if (tick < mirror.nextTick) throw new Error(`civilian tick ${tick} already taken`);
    let answer: TickAnswer | undefined;
    while (mirror.nextTick <= tick) {
      const next = mirror.nextTick;
      answer = this.heard.get(next);
      if (answer === undefined) answer = computeTick(mirror, next);
      else {
        this.heard.delete(next);
        applyAnswer(mirror, answer);
      }
    }
    if (answer === undefined) throw new Error("civilian answer missing");
    return answer;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private hear(message: FromCivilianWorker): void {
    this.traffic.heardMessages++;
    if (message.kind === "failed") {
      this.fail(new Error(message.message));
      return;
    }
    this.traffic.heardBytes += answerBuffers(message.answer).reduce((bytes, buffer) => bytes + buffer.byteLength, 0);
    if (message.answer.tick < this.state.nextTick) this.traffic.lateAnswers++;
    else this.heard.set(message.answer.tick, message.answer);
  }

  /** The worker is gone for good: everything is computed here from now on. */
  private fail(err: Error): void {
    if (this.worker === null) return;
    this.worker.terminate();
    this.worker = null;
    this.onFail(err);
  }

  private send(message: ToCivilianWorker, transfer: ArrayBuffer[]): void {
    if (this.worker === null) return;
    this.traffic.postedMessages++;
    for (const buffer of transfer) this.traffic.postedBytes += buffer.byteLength;
    this.worker.postMessage(message, transfer);
  }
}
