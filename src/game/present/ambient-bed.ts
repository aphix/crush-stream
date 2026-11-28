import { nextDraw } from "./ambient-dsp.ts";
import type { RenderJob } from "./ambient-jobs.ts";
import { bedLevels, emitterRate, LEVEL_COUNT, placeEmitters, placeLayers, SCHEDULE_SEED, SHOT_GAIN, SHOT_GAP_S, SHOT_PAN, type AmbientPlace } from "./ambient-levels.ts";
import { LAYER, LAYER_RATE, LAYERS } from "./ambient-loops.ts";
import { EMITTERS, SHOT_RATE, SHOT_VARIANTS } from "./ambient-shots.ts";
import { renderOffThread, type RenderHandle } from "./audio-render-remote.ts";

/** Seconds a level takes to close 63 % of the way to its target: the hour and the place change slowly, speed follows within a second. */
const LEVEL_TAU_S = 0.8;
/** A layer's sources run while its target is over this, and stop once its level has fallen to half of it. */
const START_LEVEL = 0.002;
/** A level is sent to its audio parameter once it has moved this far from what was sent. */
const SEND_STEP = 1e-3;
/** The two ears of a layer are panned this far apart (0..1). */
const EAR_PAN = 0.85;
/** The longest step (s) the schedule and the smoothing are advanced by: a stall does not fire a burst of one-shots. */
const MAX_STEP_S = 0.25;
/** A cheer fades with this time constant (s). */
const CHEER_TAU_S = 2.5;

/**
 * The continuous background of a place: seamless noise loops (one pair of ears per layer, unequal lengths so the pair does not repeat within minutes), a sparse seeded schedule
 * of one-shots, one low-pass for indoors and tunnels, and the wind opened by speed (m/s). Entering a place has a worker render its loops and one-shots (`renderOffThread`);
 * a layer starts when its two ears have arrived and stops when it has faded out, and only the current place's sound is kept.
 * graph: layer gain -> (wind low-pass) -> bed low-pass -> bed gain -> out
 */
export class AmbientBed {
  private readonly ctx: BaseAudioContext;
  private readonly bed: GainNode;
  private readonly bedFilter: BiquadFilterNode;
  private readonly windFilter: BiquadFilterNode;
  private readonly layers: GainNode[] = [];
  /** The audio parameter each `bedLevels` output drives (layer gains, then the `LEVEL` entries). */
  private readonly params: AudioParam[] = [];
  /** Per (layer, ear): the loop once it has arrived, and its source while the layer plays. */
  private readonly ears: (AudioBuffer | null)[] = [];
  private readonly sources: (AudioBufferSourceNode | null)[] = [];
  private readonly shotBuffers: (AudioBuffer | null)[] = [];
  private readonly target = new Float32Array(LEVEL_COUNT);
  private readonly level = new Float32Array(LEVEL_COUNT);
  private readonly sent = new Float32Array(LEVEL_COUNT).fill(-1);
  private readonly sinceShot = new Float32Array(EMITTERS.length).fill(Infinity);
  private readonly rng = Uint32Array.of(SCHEDULE_SEED);
  private place: AmbientPlace = "city";
  private loaded: AmbientPlace | null = null;
  private loading: RenderHandle | null = null;
  private waiting = 0;
  private hour = 12;
  private speed = 0;
  private indoors = false;
  private cheerLevel = 0;
  private primed = false;

  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.bed = ctx.createGain();
    this.bedFilter = ctx.createBiquadFilter();
    this.windFilter = ctx.createBiquadFilter();
    // A BiquadFilterNode is born a low-pass.
    this.bedFilter.connect(this.bed).connect(out);
    this.windFilter.connect(this.bedFilter);
    for (let l = 0; l < LAYERS.length; l++) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(l === LAYER.wind ? this.windFilter : this.bedFilter);
      this.layers.push(gain);
      this.params.push(gain.gain);
    }
    this.params.push(this.windFilter.frequency, this.bedFilter.frequency, this.bed.gain);
    this.ears.length = LAYERS.length * 2;
    this.ears.fill(null);
    this.sources.length = LAYERS.length * 2;
    this.sources.fill(null);
    this.shotBuffers.length = EMITTERS.length * SHOT_VARIANTS;
    this.shotBuffers.fill(null);
  }

  /** Sounds still being rendered for the current place. */
  get pending(): number {
    return this.waiting;
  }

  /** Where the listener is: the place and the hour (0-24) pick the mix, `speed` (m/s) opens the wind, `indoors` (a room or a tunnel) muffles it all. */
  set(place: AmbientPlace, hour: number, speed: number, indoors: boolean): void {
    this.place = place;
    this.hour = hour;
    this.speed = speed;
    this.indoors = indoors;
  }

  /** A crowd roars: `amount` (0..1) is added to the cheer, which swells the crowd layers and fades over a few seconds. */
  cheer(amount: number): void {
    this.cheerLevel = Math.min(1, this.cheerLevel + amount);
  }

  /** Once a frame: levels glide to the mix, layers start and stop, the schedule may fire a one-shot. Nothing is rendered here. */
  frame(dt: number): void {
    if (this.place !== this.loaded) this.loadPlace();
    const step = Math.min(dt, MAX_STEP_S);
    bedLevels(this.place, this.hour, this.speed, this.indoors, this.cheerLevel, this.target);
    const glide = this.primed ? 1 - Math.exp(-step / LEVEL_TAU_S) : 1;
    this.primed = true;
    for (let i = 0; i < LEVEL_COUNT; i++) this.level[i] = this.level[i]! + (this.target[i]! - this.level[i]!) * glide;
    this.cheerLevel *= Math.exp(-step / CHEER_TAU_S);
    for (let l = 0; l < LAYERS.length; l++) {
      const playing = this.sources[l * 2] !== null;
      if (this.target[l]! > START_LEVEL) {
        if (!playing && this.ears[l * 2] !== null && this.ears[l * 2 + 1] !== null) this.startLayer(l);
      } else if (playing && this.level[l]! < START_LEVEL / 2) this.stopLayer(l);
    }
    this.sendLevels();
    for (let k = 0; k < EMITTERS.length; k++) {
      this.sinceShot[k] = this.sinceShot[k]! + step;
      if (this.sinceShot[k]! < SHOT_GAP_S[k]!) continue;
      if (nextDraw(this.rng) >= (emitterRate(this.place, k, this.hour) * step) / 60) continue;
      this.sinceShot[k] = 0;
      this.shoot(k);
    }
  }

  dispose(): void {
    this.loading?.cancel();
    for (let l = 0; l < LAYERS.length; l++) this.stopLayer(l);
    this.bed.disconnect();
    this.bedFilter.disconnect();
    this.windFilter.disconnect();
    for (const gain of this.layers) gain.disconnect();
  }

  private sendLevels(): void {
    for (let i = 0; i < LEVEL_COUNT; i++) {
      if (Math.abs(this.level[i]! - this.sent[i]!) < SEND_STEP) continue;
      this.sent[i] = this.level[i]!;
      this.params[i]!.value = this.level[i]!;
    }
  }

  /** Enters `place`: what this place does not use is dropped (its playing layers fade out and stop in `frame`), and the rest is asked of the worker. */
  private loadPlace(): void {
    this.loading?.cancel();
    this.loaded = this.place;
    const layers = placeLayers(this.place);
    const emitters = placeEmitters(this.place);
    const jobs: RenderJob[] = [];
    for (let l = 0; l < LAYERS.length; l++) {
      const used = layers.includes(l);
      for (const ear of [0, 1] as const) {
        if (!used) this.ears[l * 2 + ear] = null;
        else if (this.ears[l * 2 + ear] === null) jobs.push({ kind: "loop", layer: LAYERS[l]!, ear });
      }
    }
    for (let k = 0; k < EMITTERS.length; k++) {
      for (let variant = 0; variant < SHOT_VARIANTS; variant++) {
        const slot = k * SHOT_VARIANTS + variant;
        if (!emitters.includes(k)) this.shotBuffers[slot] = null;
        else if (this.shotBuffers[slot] === null) jobs.push({ kind: "shot", emitter: EMITTERS[k]!, variant });
      }
    }
    this.waiting = jobs.length;
    this.loading = renderOffThread(jobs, (job, data) => this.receive(job, data));
  }

  /** A rendered sound arrives (null: its render failed and the sound stays missing): it becomes an audio buffer and the samples are let go. */
  private receive(job: RenderJob, data: Float32Array | null): void {
    this.waiting--;
    if (data === null || job.kind === "ui") return;
    const buffer = this.ctx.createBuffer(1, data.length, job.kind === "loop" ? LAYER_RATE[job.layer] : SHOT_RATE);
    buffer.getChannelData(0).set(data);
    if (job.kind === "loop") this.ears[LAYER[job.layer] * 2 + job.ear] = buffer;
    else this.shotBuffers[EMITTERS.indexOf(job.emitter) * SHOT_VARIANTS + job.variant] = buffer;
  }

  /** Starts both ears of layer `l` from their kept buffers. */
  private startLayer(l: number): void {
    for (let ear = 0; ear < 2; ear++) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.ears[l * 2 + ear]!;
      source.loop = true;
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = ear === 0 ? -EAR_PAN : EAR_PAN;
      source.connect(pan).connect(this.layers[l]!);
      source.onended = () => pan.disconnect();
      source.start();
      this.sources[l * 2 + ear] = source;
    }
  }

  private stopLayer(l: number): void {
    for (let ear = 0; ear < 2; ear++) {
      this.sources[l * 2 + ear]?.stop();
      this.sources[l * 2 + ear] = null;
    }
  }

  /** One one-shot of emitter `kind`, a seeded variant at a seeded pan and level; nothing if that sound has not arrived yet. */
  private shoot(kind: number): void {
    const variant = Math.floor(nextDraw(this.rng) * SHOT_VARIANTS);
    const panned = (nextDraw(this.rng) * 2 - 1) * SHOT_PAN;
    const level = SHOT_GAIN[kind]! * (0.5 + 0.5 * nextDraw(this.rng));
    const buffer = this.shotBuffers[kind * SHOT_VARIANTS + variant];
    if (buffer === null || buffer === undefined) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = panned;
    const gain = this.ctx.createGain();
    gain.gain.value = level;
    source.connect(pan).connect(gain).connect(this.bedFilter);
    source.onended = () => gain.disconnect();
    source.start();
  }
}
