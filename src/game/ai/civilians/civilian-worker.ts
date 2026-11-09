import { queueEvents } from "./civilian-events.ts";
import type { CityState } from "./civilian-state.ts";
import { computeTick } from "./civilian-tick.ts";
import { answerBuffers, type FromCivilianWorker, type ToCivilianWorker } from "./civilian-wire.ts";
import { createCityState } from "./society.ts";

/**
 * The city's collective brain in a Web Worker: the society and every resident's needs, decisions and walks (`civilian-tick.ts`). The main thread posts the map and seed once, then each tick's events (`CivilianRemote`);
 * this steps every tick up to the one posted and answers each with the rows it changed. It draws and walks nothing.
 */
const brain: { state: CityState | null } = { state: null };

function post(message: FromCivilianWorker, transfer: ArrayBuffer[] = []): void {
  self.postMessage(message, { transfer });
}

function hear(message: ToCivilianWorker): void {
  try {
    if (message.kind === "init") {
      brain.state = createCityState(message.seed, message.map, message.playableResidents);
      return;
    }
    const { state } = brain;
    if (state === null) throw new Error("plan before init");
    queueEvents(state, message.tick, message.events);
    while (state.nextTick <= message.tick) {
      const answer = computeTick(state, state.nextTick);
      post({ kind: "answer", answer }, answerBuffers(answer));
    }
  } catch (err) {
    post({ kind: "failed", message: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  }
}

self.onmessage = (event: MessageEvent<ToCivilianWorker>) => hear(event.data);
