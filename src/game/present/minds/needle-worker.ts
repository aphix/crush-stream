import init, { NeedleV2Wasm } from "needle-rs";
import { MAX_NEW_TOKENS, WEIGHTS_CACHE, type FromNeedle, type ToNeedle } from "./minds-protocol.ts";
import { loadWeights } from "./needle-weights.ts";

/**
 * Needle 2 (needle-rs, single-threaded WASM) in its own module worker, off the frame loop: loads once, then answers one ask at a time, greedy and
 * constrained. A call cannot be interrupted inside WASM; the main thread drops a late answer, or ends the worker when it runs past its budget.
 */
const model: { engine: NeedleV2Wasm | null } = { engine: null };

function post(message: FromNeedle): void {
  self.postMessage(message);
}

async function load(url: string, sha256: string): Promise<void> {
  await init();
  const bytes = await loadWeights({ fetch: (at) => fetch(at), caches, digest: (data) => crypto.subtle.digest("SHA-256", data) }, WEIGHTS_CACHE, url, sha256);
  const engine = NeedleV2Wasm.load(bytes);
  if (engine === undefined) throw new Error("Needle weights did not load as a Needle 2 model");
  model.engine = engine;
  post({ kind: "ready" });
}

function ask(id: number, query: string, tools: string): void {
  const { engine } = model;
  if (engine === null) throw new Error("Needle asked before it loaded");
  post({ kind: "answer", id, text: engine.generate(query, tools, MAX_NEW_TOKENS, 0, 0, true) });
}

async function hear(message: ToNeedle): Promise<void> {
  try {
    if (message.kind === "load") await load(message.url, message.sha256);
    else ask(message.id, message.query, message.tools);
  } catch (err) {
    post({ kind: "failed", message: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  }
}

self.onmessage = (event: MessageEvent<ToNeedle>) => void hear(event.data);
