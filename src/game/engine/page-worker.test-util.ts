import { resolveObjectURL } from "node:buffer";
import { Worker as Thread } from "node:worker_threads";

/** What a page worker's script sees: `self`, `postMessage` and its message listeners, carried by the thread's parent port. */
const SCOPE = `
const { parentPort } = require("node:worker_threads");
const listeners = [];
globalThis.self = globalThis;
globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, Array.isArray(transfer) ? transfer : transfer?.transfer);
globalThis.addEventListener = (type, listener) => void (type === "message" && listeners.push(listener));
parentPort.on("message", (data) => {
  const event = { data };
  globalThis.onmessage?.(event);
  for (const listener of listeners) listener(event);
});
`;

type Listener = (event: { data?: unknown; message?: string }) => void;

/**
 * The page's `Worker` in node, on a worker thread: a module script by URL (`hdr-worker.ts`) or a classic one from a blob URL (three's
 * KTX2 transcoder). headless-frame and the tests that load what a page decodes in a worker set it as `globalThis.Worker`.
 */
export class PageWorker {
  onmessage: Listener | null = null;
  onerror: Listener | null = null;
  private readonly listeners = new Map<string, Listener[]>();
  private readonly thread: Promise<Thread>;

  constructor(url: string | URL) {
    this.thread = PageWorker.start(String(url)).then((thread) => {
      thread.on("message", (data: unknown) => this.fire("message", { data }));
      thread.on("error", (err: Error) => this.fire("error", { message: err.message }));
      return thread;
    });
  }

  private static async start(url: string): Promise<Thread> {
    const blob = url.startsWith("blob:") ? resolveObjectURL(url) : undefined;
    const script = blob === undefined ? `import(${JSON.stringify(url)});` : await blob.text();
    return new Thread(SCOPE + script, { eval: true });
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  postMessage(message: unknown, transfer?: ArrayBuffer[] | { transfer?: ArrayBuffer[] }): void {
    const list = Array.isArray(transfer) ? transfer : transfer?.transfer;
    void this.thread.then((thread) => thread.postMessage(message, list));
  }

  terminate(): void {
    void this.thread.then((thread) => thread.terminate());
  }

  private fire(type: "message" | "error", event: { data?: unknown; message?: string }): void {
    (type === "message" ? this.onmessage : this.onerror)?.(event);
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
