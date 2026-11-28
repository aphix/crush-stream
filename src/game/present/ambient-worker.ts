import { type FromAudioWorker, runJob, type ToAudioWorker } from "./ambient-jobs.ts";

/** The audio renderer in a Web Worker: it renders each posted job (`AmbientBed` and `UiSound` ask through `renderOffThread`) and hands the samples back, so no sound is rendered on the game's frames. */
function post(message: FromAudioWorker): void {
  const transfer = "data" in message && message.data.buffer instanceof ArrayBuffer ? [message.data.buffer] : [];
  self.postMessage(message, { transfer });
}

self.onmessage = (event: MessageEvent<ToAudioWorker>) => {
  for (const { id, job } of event.data) {
    try {
      post({ id, data: runJob(job) });
    } catch (err) {
      post({ id, failed: err instanceof Error ? (err.stack ?? err.message) : String(err) });
    }
  }
};
