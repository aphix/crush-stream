import { type Layer, renderLoop } from "./ambient-loops.ts";
import { type Emitter, renderShot } from "./ambient-shots.ts";
import { renderUi, type UiName } from "./ui-render.ts";

/** One sound to render: a loop of the ambient bed, a one-shot of it, or a UI sound. */
export type RenderJob = { kind: "loop"; layer: Layer; ear: 0 | 1 } | { kind: "shot"; emitter: Emitter; variant: number } | { kind: "ui"; name: UiName };

/** What the main thread posts to the audio worker: jobs, each with its number. */
export type ToAudioWorker = { id: number; job: RenderJob }[];
/** What the worker posts back: a job's samples (handed over, not copied) or the reason it failed. */
export type FromAudioWorker = { id: number; data: Float32Array } | { id: number; failed: string };

/** The samples of `job`: mono; loops at `LAYER_RATE`, one-shots at `SHOT_RATE`, UI sounds at `UI_RATE`. */
export function runJob(job: RenderJob): Float32Array {
  if (job.kind === "loop") return renderLoop(job.layer, job.ear);
  if (job.kind === "shot") return renderShot(job.emitter, job.variant);
  return renderUi(job.name);
}
