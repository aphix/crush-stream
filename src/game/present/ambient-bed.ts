import { bedLevels, emitterRate, LEVEL, LEVEL_COUNT, nextDraw, SCHEDULE_SEED, SHOT_GAIN, SHOT_GAP_S, SHOT_PAN, type AmbientPlace } from "./ambient-levels.ts";
import { LAYER, LAYER_RATE, LAYERS, layerLoop } from "./ambient-loops.ts";
import { EMITTERS, SHOT_RATE, SHOT_VARIANTS, shotOf } from "./ambient-shots.ts";

/** Seconds a level takes to close 63 % of the way to its target: the hour and the place change slowly, speed follows within a second. */
const LEVEL_TAU_S = 0.8;
/** A layer is rendered and started once its target passes this. */
const START_LEVEL = 0.002;
/** The two ears of a layer are panned this far apart (0..1). */
const EAR_PAN = 0.85;
/** The longest step (s) the schedule and the smoothing are advanced by: a stall does not fire a burst of one-shots. */
const MAX_STEP_S = 0.25;
/** A cheer fades with this time constant (s). */
const CHEER_TAU_S = 2.5;

/**
 * The continuous background of a place: seamless noise loops (one pair of ears per layer, unequal lengths so the pair does not repeat within minutes), a sparse seeded schedule
 * of one-shots, one low-pass for indoors and tunnels, and the wind opened by speed (m/s). Loops are rendered on first use, one ear a frame.
 * graph: layer gain -> (wind low-pass) -> bed low-pass -> bed gain -> out
 */
export class AmbientBed {
  private readonly ctx: BaseAudioContext;
  private readonly bed: GainNode;
  private readonly bedFilter: BiquadFilterNode;
  private readonly windFilter: BiquadFilterNode;
  private readonly layers: GainNode[] = [];
  private readonly sources: AudioBufferSourceNode[] = [];
  private readonly shotBuffers: (AudioBuffer | null)[] = [];
  /** 1 for each (layer, ear) loop not yet built. */
  private readonly unbuilt = new Uint8Array(LAYERS.length * 2).fill(1);
  private readonly target = new Float32Array(LEVEL_COUNT);
  private readonly level = new Float32Array(LEVEL_COUNT);
  private readonly sent = new Float32Array(LEVEL_COUNT).fill(-1);
  private readonly sinceShot = new Float32Array(EMITTERS.length).fill(Infinity);
  private readonly rng = Uint32Array.of(SCHEDULE_SEED);
  private place: AmbientPlace = "city";
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
    }
    this.shotBuffers.length = EMITTERS.length * SHOT_VARIANTS;
    this.shotBuffers.fill(null);
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

  /** Once a frame: levels glide to the mix, the next loop is built if one is wanted, the schedule may fire a one-shot. */
  frame(dt: number): void {
    const step = Math.min(dt, MAX_STEP_S);
    bedLevels(this.place, this.hour, this.speed, this.indoors, this.cheerLevel, this.target);
    const glide = this.primed ? 1 - Math.exp(-step / LEVEL_TAU_S) : 1;
    this.primed = true;
    for (let i = 0; i < LEVEL_COUNT; i++) this.level[i] = this.level[i]! + (this.target[i]! - this.level[i]!) * glide;
    this.cheerLevel *= Math.exp(-step / CHEER_TAU_S);
    for (let l = 0; l < LAYERS.length; l++) {
      if (this.target[l]! > START_LEVEL && this.buildEar(l)) break;
    }
    this.sendLayers();
    this.windFilter.frequency.value = this.level[LEVEL.windHz]!;
    this.bedFilter.frequency.value = this.level[LEVEL.bedHz]!;
    this.bed.gain.value = this.level[LEVEL.bedGain]!;
    for (let k = 0; k < EMITTERS.length; k++) {
      this.sinceShot[k] = this.sinceShot[k]! + step;
      if (this.sinceShot[k]! < SHOT_GAP_S[k]!) continue;
      if (nextDraw(this.rng) >= (emitterRate(this.place, k, this.hour) * step) / 60) continue;
      this.sinceShot[k] = 0;
      this.shoot(k);
    }
  }

  dispose(): void {
    for (const source of this.sources) source.stop();
    this.bed.disconnect();
    this.bedFilter.disconnect();
    this.windFilter.disconnect();
    for (const gain of this.layers) gain.disconnect();
  }

  private sendLayers(): void {
    for (let l = 0; l < LAYERS.length; l++) {
      if (Math.abs(this.level[l]! - this.sent[l]!) < 1e-4) continue;
      this.sent[l] = this.level[l]!;
      this.layers[l]!.gain.value = this.level[l]!;
    }
  }

  /** Builds and starts the first unbuilt ear of `layer`; false when both are up. */
  private buildEar(layer: number): boolean {
    for (let ear = 0; ear < 2; ear++) {
      if (this.unbuilt[layer * 2 + ear] === 0) continue;
      this.unbuilt[layer * 2 + ear] = 0;
      const data = layerLoop(LAYERS[layer]!, ear as 0 | 1);
      const buffer = this.ctx.createBuffer(1, data.length, LAYER_RATE[LAYERS[layer]!]);
      buffer.getChannelData(0).set(data);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = ear === 0 ? -EAR_PAN : EAR_PAN;
      source.connect(pan).connect(this.layers[layer]!);
      source.start();
      this.sources.push(source);
      return true;
    }
    return false;
  }

  /** One one-shot of emitter `kind`, a seeded variant at a seeded pan and level. */
  private shoot(kind: number): void {
    const variant = Math.floor(nextDraw(this.rng) * SHOT_VARIANTS);
    const slot = kind * SHOT_VARIANTS + variant;
    let buffer = this.shotBuffers[slot];
    if (buffer === null || buffer === undefined) {
      const data = shotOf(EMITTERS[kind]!, variant);
      buffer = this.ctx.createBuffer(1, data.length, SHOT_RATE);
      buffer.getChannelData(0).set(data);
      this.shotBuffers[slot] = buffer;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = (nextDraw(this.rng) * 2 - 1) * SHOT_PAN;
    const gain = this.ctx.createGain();
    gain.gain.value = SHOT_GAIN[kind]! * (0.5 + 0.5 * nextDraw(this.rng));
    source.connect(pan).connect(gain).connect(this.bedFilter);
    source.onended = () => gain.disconnect();
    source.start();
  }
}
