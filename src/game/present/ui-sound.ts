import type { RenderJob } from "./ambient-jobs.ts";
import { renderOffThread, type RenderHandle } from "./audio-render-remote.ts";
import { UI_NAMES, UI_RATE, type UiName } from "./ui-render.ts";

/** The game's UI sounds: all rendered off the frames when this is made (`renderOffThread`), each kept as an audio buffer, played as a one-shot into `out`. */
export class UiSound {
  private readonly ctx: BaseAudioContext;
  private readonly out: AudioNode;
  private readonly buffers = new Map<UiName, AudioBuffer>();
  private readonly loading: RenderHandle;
  private waiting = UI_NAMES.length;

  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.out = out;
    this.loading = renderOffThread(
      UI_NAMES.map((name): RenderJob => ({ kind: "ui", name })),
      (job, data) => {
        this.waiting--;
        if (data === null || job.kind !== "ui") return;
        const buffer = ctx.createBuffer(1, data.length, UI_RATE);
        buffer.getChannelData(0).set(data);
        this.buffers.set(job.name, buffer);
      },
    );
  }

  /** Sounds not yet rendered (one that failed is not counted: it stays missing). */
  get pending(): number {
    return this.waiting;
  }

  /** Plays `name`; a sound still being rendered (the first moments after the game starts) is skipped. */
  play(name: UiName): void {
    const buffer = this.buffers.get(name);
    if (buffer === undefined) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.out);
    source.onended = () => source.disconnect();
    source.start();
  }

  dispose(): void {
    this.loading.cancel();
    this.buffers.clear();
  }
}
