import { type FromAudioWorker, type RenderJob, runJob, type ToAudioWorker } from "./ambient-jobs.ts";

/** A batch of renders under way. */
export interface RenderHandle {
  /** Stops the batch: no result arrives after this. */
  cancel(): void;
}

/**
 * Renders `jobs` off the game's frames and hands each result to `onResult` as it is ready (the samples are the caller's to keep; null for a job that failed). In a worker where the browser has one; where it has none (or the worker would not start: logged),
 * one job per timer task on the main thread, so a slow render never holds more than one job's time.
 */
export function renderOffThread(jobs: readonly RenderJob[], onResult: (job: RenderJob, data: Float32Array | null) => void): RenderHandle {
  if (jobs.length === 0) return { cancel: () => {} };
  const received = new Uint8Array(jobs.length);
  let live = true;
  let worker: Worker | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let done = 0;

  /** Job `id` is over: its samples arrived, or (null) it failed and its sound stays missing. */
  const take = (id: number, data: Float32Array | null): void => {
    if (!live || received[id] === 1) return;
    received[id] = 1;
    onResult(jobs[id]!, data);
    if (++done === jobs.length) worker?.terminate();
  };
  const inline = (): void => {
    const id = received.indexOf(0);
    if (!live || id < 0) return;
    take(id, runJob(jobs[id]!));
    timer = setTimeout(inline, 0);
  };

  if (typeof Worker === "undefined") timer = setTimeout(inline, 0);
  else {
    try {
      worker = new Worker(new URL("./ambient-worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<FromAudioWorker>) => {
        if ("failed" in event.data) {
          console.error("Crush Stream audio render failed", event.data.failed);
          take(event.data.id, null);
        } else take(event.data.id, event.data.data);
      };
      worker.onerror = (event) => {
        console.error("Crush Stream audio worker failed", event.message);
        worker?.terminate();
        worker = null;
        timer = setTimeout(inline, 0);
      };
      const posted: ToAudioWorker = jobs.map((job, id) => ({ id, job }));
      worker.postMessage(posted);
    } catch (err) {
      console.error("Crush Stream audio worker did not start", err);
      worker = null;
      timer = setTimeout(inline, 0);
    }
  }
  return {
    cancel: () => {
      live = false;
      worker?.terminate();
      if (timer !== null) clearTimeout(timer);
    },
  };
}
