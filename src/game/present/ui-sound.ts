import type { RenderJob } from "./ambient-jobs.ts";
import { renderOffThread, type RenderHandle } from "./audio-render-remote.ts";
import { UI_NAMES, UI_RATE, type UiName } from "./ui-render.ts";

/** The game's UI sounds: all rendered off the frames when this is made (`renderOffThread`), each kept as an audio buffer, played as a one-shot into `out`. */
export class UiSound {
  private readonly ctx: BaseAudioContext;
  private readonly out: AudioNode;
  private readonly buffers = new Map<UiName, AudioBuffer>();
  private readonly loading: RenderHandle;

  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.out = out;
    this.loading = renderOffThread(
      UI_NAMES.map((name): RenderJob => ({ kind: "ui", name })),
      (job, data) => {
        if (job.kind !== "ui") return;
        const buffer = ctx.createBuffer(1, data.length, UI_RATE);
        buffer.copyToChannel(data, 0);
        this.buffers.set(job.name, buffer);
      },
    );
  }

  /** Sounds not yet rendered. */
  get pending(): number {
    return UI_NAMES.length - this.buffers.size;
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
