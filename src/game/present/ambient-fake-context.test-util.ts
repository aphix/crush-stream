/** A recording stand-in for an AudioContext: nodes keep the values written to them and count their starts; nothing is heard. */
export class FakeNode {
  gain = { value: 1 };
  frequency = { value: 350 };
  pan = { value: 0 };
  type = "";
  loop = false;
  buffer: { length: number; sampleRate: number } | null = null;
  started = 0;
  stopped = 0;
  onended: (() => void) | null = null;

  connect<T>(to: T): T {
    return to;
  }

  disconnect(): void {}

  start(): void {
    this.started++;
  }

  stop(): void {
    this.stopped++;
  }
}

export class FakeContext {
  readonly nodes: FakeNode[] = [];
  /** The audio buffers made, with their lengths: what the audio holds resident. */
  readonly buffers: { length: number; sampleRate: number }[] = [];

  private make(): FakeNode {
    const node = new FakeNode();
    this.nodes.push(node);
    return node;
  }

  createGain = (): FakeNode => this.make();
  createBiquadFilter = (): FakeNode => this.make();
  createBufferSource = (): FakeNode => this.make();
  createStereoPanner = (): FakeNode => this.make();

  createBuffer(_channels: number, length: number, sampleRate: number): { length: number; sampleRate: number; copyToChannel: () => void } {
    const buffer = { length, sampleRate, copyToChannel: () => {} };
    this.buffers.push(buffer);
    return buffer;
  }

  /** Bytes of audio buffers held (32-bit mono samples). */
  residentBytes(): number {
    return this.buffers.reduce((sum, buffer) => sum + buffer.length * 4, 0);
  }

  /** The one-shots started: sources that do not loop. */
  shotsStarted(): number {
    return this.nodes.filter((node) => node.buffer !== null && !node.loop && node.started > 0).length;
  }

  /** Looping sources started. */
  loopsStarted(): number {
    return this.nodes.filter((node) => node.loop && node.started > 0).length;
  }
}

/** A fake context and output as the audio classes take them; the one place the stand-in is cast to the Web Audio types, since only the calls the classes make are modelled. */
export function fakeAudio(): { fake: FakeContext; ctx: BaseAudioContext; out: AudioNode; sink: FakeNode } {
  const fake = new FakeContext();
  const sink = new FakeNode();
  return { fake, sink, ctx: fake as unknown as BaseAudioContext, out: sink as unknown as AudioNode };
}
