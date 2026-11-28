import { UI_RATE, uiBuffer, type UiName } from "./ui-render.ts";

/** The game's UI sounds: each a pre-rendered buffer, played as a one-shot into `out`. */
export class UiSound {
  private readonly ctx: BaseAudioContext;
  private readonly out: AudioNode;
  private readonly buffers = new Map<UiName, AudioBuffer>();

  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.out = out;
  }

  play(name: UiName): void {
    let buffer = this.buffers.get(name);
    if (buffer === undefined) {
      const data = uiBuffer(name);
      buffer = this.ctx.createBuffer(1, data.length, UI_RATE);
      buffer.getChannelData(0).set(data);
      this.buffers.set(name, buffer);
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.out);
    source.onended = () => source.disconnect();
    source.start();
  }

  dispose(): void {
    this.buffers.clear();
  }
}
