import { hypot3 } from "../kernel/physics-core.js";
import { MAT, MATERIALS } from "../kernel/material-ids.ts";
import { clamp01 } from "../kernel/scalar.ts";
import {
  bankKey,
  BANK_RATE,
  distanceCutoff,
  distanceGain,
  hash32,
  HIT_SIZE_LIST,
  HIT_VARIATIONS,
  hitGain,
  hitSamples,
  hitSize,
  MAT_INDEX,
  MIN_IMPULSE,
  renderHit,
  renderScrapeLoop,
  SCRAPE_KINDS,
  SCRAPE_VARIATIONS,
  scrapeCutoff,
  scrapeGain,
  scrapeKind,
  scrapeSamples,
  SOUND_MATS,
  type HitSize,
  type SoundMat,
} from "./hit-synth.ts";

export type { SoundMat } from "./hit-synth.ts";

/** The slice of the Web Audio API a `HitSound` calls: a real `BaseAudioContext` and its nodes satisfy it, and so does a recording stand-in in node. */
interface SoundParam {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  setTargetAtTime(value: number, time: number, tau: number): unknown;
}
interface SoundNode {
  connect(to: SoundNode): SoundNode;
  disconnect(): void;
}
interface SoundGain extends SoundNode {
  gain: SoundParam;
}
interface SoundFilter extends SoundNode {
  frequency: SoundParam;
}
interface SoundBuffer {
  length: number;
  duration: number;
  getChannelData(channel: number): Float32Array;
}
interface SoundSource extends SoundNode {
  buffer: SoundBuffer | null;
  loop: boolean;
  playbackRate: SoundParam;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}
interface SoundContext {
  currentTime: number;
  listener: { positionX?: { value: number }; positionY?: { value: number }; positionZ?: { value: number } };
  createBuffer(channels: number, length: number, sampleRate: number): SoundBuffer;
  createGain(): SoundGain;
  createBiquadFilter(): SoundFilter;
  createBufferSource(): SoundSource;
}

/** One contact: its closing speed (m/s), where it happened, and what met what. */
export interface HitEvent {
  impulse: number;
  x: number;
  y: number;
  z: number;
  a: SoundMat;
  b: SoundMat;
}

/** What each material role of the catalog sounds like. */
const ROLE_MAT: Record<string, SoundMat> = {
  none: "plastic",
  "sheet-metal": "steel",
  metal: "steel",
  "cast-metal": "steel",
  chrome: "steel",
  plastic: "plastic",
  foam: "hay",
  paper: "plastic",
  paint: "concrete",
  soft: "hay",
  fabric: "hay",
  rubber: "rubber",
  leather: "rubber",
  skin: "rubber",
  hair: "rubber",
  glass: "glass",
  ceramic: "glass",
  concrete: "concrete",
  stone: "stone",
  cobble: "stone",
  asphalt: "asphalt",
  dirt: "dirt",
  gravel: "gravel",
  grass: "grass",
  sand: "sand",
  wood: "wood",
  foliage: "foliage",
  water: "water",
  liquid: "water",
};

const SURFACE_MAT: Record<string, SoundMat> = { asphalt: "asphalt", concrete: "concrete", cobble: "stone", dirt: "dirt", gravel: "gravel", grass: "grass", sand: "sand", mud: "mud" };

/** The sound of a catalog material by its `MAT` name; an unknown name sounds like plastic. */
export function propSoundMat(material: string): SoundMat {
  const id = MAT[material as keyof typeof MAT];
  if (id === undefined) return "plastic";
  return material.includes("MUD") ? "mud" : (ROLE_MAT[MATERIALS[id]![2]] ?? "plastic");
}

/** The sound of a ground surface by its id; an unknown surface sounds like dirt. */
export function surfaceSoundMat(surfaceId: string): SoundMat {
  return SURFACE_MAT[surfaceId] ?? "dirt";
}

const ARG_GAIN = 0;
const ARG_RATE = 1;
const ARG_START = 2;
const ARG_DISTANCE = 3;
const ARG_PRIORITY = 4;
const ARG_NOW = 5;
const MAX_VOICES = 24;
const MAX_SCRAPES = 6;
/** Below this peak (after distance) a hit is not worth a voice. */
const AUDIBLE = 0.004;
const HEARD_M = 400;
const SPEED_OF_SOUND = 343;
const MAX_DELAY_S = 0.6;
const MAX_JITTER_S = 0.008;
const DETUNE = [0.1, 0.07, 0.05] as const;
const GAIN_SPREAD = 0.3;
const SECOND_LAYER_GAIN = 0.45;
const SECOND_LAYER_PITCH = 0.8;
const SECOND_LAYER_DELAY_S = 0.03;
const SECOND_LAYER_SPREAD_S = 0.09;
const SECOND_LAYER_PRIORITY = 0.4;
const DEFLAM_SLOTS = 16;
const DEFLAM_S = 0.04;
const DEFLAM_GROWTH = 1.25;
const DEFLAM_CELL_M = 1.5;
const SCRAPE_FULL_SPEED = 15;
/** Normal force (N) at which a scrape is at full level: a 1.2 t car on its side is ~12 kN. */
const SCRAPE_FULL_FORCE = 6000;
const SCRAPE_FADE_S = 0.25;
const SCRAPE_TAU_S = 0.03;
const SCRAPE_CHANGE = 0.05;
const SCRAPE_RATE_MIN = 0.6;
const SCRAPE_RATE_SPAN = 1;
const SQUARES = SOUND_MATS.length * SOUND_MATS.length;

/**
 * Impact and scrape sound by material pair, size and place. Every bank pair is rendered once at construction into mono buffers; a hit
 * picks one by pair, size and a seeded hash and plays it detuned, delayed by distance and filtered by it. Voices are a fixed pool with the
 * loudest kept; a scrape is a looping buffer per contact whose level and brightness follow speed and force.
 */
export class HitSound {
  /** Bytes of rendered buffers held, and the milliseconds that took. */
  readonly bankBytes: number;
  readonly bankMs: number;
  private readonly ctx: SoundContext;
  private readonly bank: SoundBuffer[] = [];
  private readonly scrapeBank: SoundBuffer[] = [];
  /** Per (a, b) material pair, the first buffer of its bank row, and its scrape loop kind. */
  private readonly rowOf = new Int32Array(SQUARES);
  private readonly kindOf = new Uint8Array(SQUARES);
  private readonly voiceGain: SoundGain[] = [];
  private readonly voiceFilter: SoundFilter[] = [];
  private readonly voiceSource: (SoundSource | null)[] = [];
  private readonly voiceEnd = new Float64Array(MAX_VOICES);
  private readonly voicePriority = new Float64Array(MAX_VOICES);
  private readonly scrapeId = new Int32Array(MAX_SCRAPES).fill(-1);
  private readonly scrapeTouched = new Uint8Array(MAX_SCRAPES);
  private readonly scrapeIdle = new Float64Array(MAX_SCRAPES);
  private readonly scrapeLevel = new Float64Array(MAX_SCRAPES);
  private readonly scrapeRate = new Float64Array(MAX_SCRAPES);
  private readonly scrapeCut = new Float64Array(MAX_SCRAPES);
  private readonly scrapeSoundGain: SoundGain[] = [];
  private readonly scrapeFilter: SoundFilter[] = [];
  private readonly scrapeSource: (SoundSource | null)[] = [];
  private readonly deflamKey = new Int32Array(DEFLAM_SLOTS);
  private readonly deflamAt = new Float64Array(DEFLAM_SLOTS).fill(-Infinity);
  private readonly deflamImpulse = new Float64Array(DEFLAM_SLOTS);
  private deflamNext = 0;
  /** The sound a hit hands to `play` and `claim`: doubles kept in an array are not boxed to cross each call. */
  private readonly args = new Float64Array(6);
  private serial = 0;
  private listenerX = 0;
  private listenerY = 0;
  private listenerZ = 0;

  constructor(ctx: SoundContext, out: SoundNode) {
    this.ctx = ctx;
    const started = performance.now();
    this.bankBytes = this.renderHitBank() + this.renderScrapeBank();
    this.bankMs = performance.now() - started;
    for (let voice = 0; voice < MAX_VOICES; voice++) {
      this.voiceGain.push(this.chain(out, this.voiceFilter));
      this.voiceSource.push(null);
    }
    for (let slot = 0; slot < MAX_SCRAPES; slot++) {
      const gain = this.chain(out, this.scrapeFilter);
      gain.gain.value = 0;
      this.scrapeSoundGain.push(gain);
      this.scrapeSource.push(null);
    }
  }

  /** A gain into a lowpass into `out`: the filter is pushed on `filters`, the gain returned. */
  private chain(out: SoundNode, filters: SoundFilter[]): SoundGain {
    const gain = this.ctx.createGain();
    // A biquad is a lowpass until told otherwise.
    const filter = this.ctx.createBiquadFilter();
    gain.connect(filter).connect(out);
    filters.push(filter);
    return gain;
  }

  /** Renders every bank pair's buffers and maps each of the 256 material pairs to its row; bytes held. */
  private renderHitBank(): number {
    let bytes = 0;
    const rows = new Map<string, number>();
    for (let a = 0; a < SOUND_MATS.length; a++) {
      for (let b = 0; b < SOUND_MATS.length; b++) {
        const [first, second] = bankKey(SOUND_MATS[a]!, SOUND_MATS[b]!);
        const name = `${first}/${second}`;
        let row = rows.get(name);
        if (row === undefined) {
          row = this.bank.length;
          rows.set(name, row);
          for (const size of HIT_SIZE_LIST) {
            for (let variation = 0; variation < HIT_VARIATIONS; variation++) {
              const buffer = this.ctx.createBuffer(1, hitSamples(size, BANK_RATE), BANK_RATE);
              renderHit(first, second, size, variation, BANK_RATE, buffer.getChannelData(0));
              this.bank.push(buffer);
              bytes += buffer.length * 4;
            }
          }
        }
        this.rowOf[a * SOUND_MATS.length + b] = row;
        this.kindOf[a * SOUND_MATS.length + b] = scrapeKind(SOUND_MATS[a]!, SOUND_MATS[b]!);
      }
    }
    return bytes;
  }

  private renderScrapeBank(): number {
    let bytes = 0;
    for (let kind = 0; kind < SCRAPE_KINDS; kind++) {
      for (let variation = 0; variation < SCRAPE_VARIATIONS; variation++) {
        const buffer = this.ctx.createBuffer(1, scrapeSamples(BANK_RATE), BANK_RATE);
        renderScrapeLoop(kind, variation, BANK_RATE, buffer.getChannelData(0));
        this.scrapeBank.push(buffer);
        bytes += buffer.length * 4;
      }
    }
    return bytes;
  }

  /** A contact at `e` heard from (lx, ly, lz). */
  hit(e: HitEvent, lx: number, ly: number, lz: number): void {
    if (e.impulse < MIN_IMPULSE) return;
    this.listenerX = lx;
    this.listenerY = ly;
    this.listenerZ = lz;
    const distance = hypot3(e.x - lx, e.y - ly, e.z - lz);
    if (distance > HEARD_M) return;
    const peak = hitGain(e.impulse) * distanceGain(distance);
    if (peak < AUDIBLE) return;
    const args = this.args;
    args[ARG_NOW] = this.ctx.currentTime;
    const pair = MAT_INDEX[e.a] * SOUND_MATS.length + MAT_INDEX[e.b];
    if (this.deflam(pair, e)) return;
    const seed = hash32(this.serial++, hash32(((e.x * 4) | 0) ^ Math.imul((e.z * 4) | 0, 0x1f3d5b79), (e.impulse * 1024) | 0));
    const size = hitSize(e.impulse);
    const spread = ((seed >>> 8) & 255) / 255 - 0.5;
    args[ARG_DISTANCE] = distance;
    args[ARG_PRIORITY] = peak;
    args[ARG_GAIN] = peak * (1 - (((seed >>> 24) & 255) / 255) * GAIN_SPREAD);
    args[ARG_RATE] = 1 + spread * 2 * DETUNE[size];
    args[ARG_START] = args[ARG_NOW]! + Math.min(distance / SPEED_OF_SOUND, MAX_DELAY_S) + (((seed >>> 16) & 255) / 255) * MAX_JITTER_S;
    const row = this.rowOf[pair]! + size * HIT_VARIATIONS;
    if (!this.play(this.bank[row + (seed % HIT_VARIATIONS)]!) || size !== 2) return;
    args[ARG_START] = args[ARG_START]! + SECOND_LAYER_DELAY_S + (((seed >>> 12) & 127) / 127) * SECOND_LAYER_SPREAD_S;
    args[ARG_GAIN] = args[ARG_GAIN]! * SECOND_LAYER_GAIN;
    args[ARG_RATE] = SECOND_LAYER_PITCH * (1 - spread * 0.1);
    args[ARG_PRIORITY] = peak * SECOND_LAYER_PRIORITY;
    this.play(this.bank[this.rowOf[pair]! + ((seed >>> 4) % HIT_VARIATIONS)]!);
  }

  /** A sliding contact `id`, called every frame it slides. */
  scrape(id: number, speed: number, force: number, x: number, y: number, z: number, a: SoundMat, b: SoundMat): void {
    const listener = this.ctx.listener;
    const distance = hypot3(x - (listener.positionX?.value ?? this.listenerX), y - (listener.positionY?.value ?? this.listenerY), z - (listener.positionZ?.value ?? this.listenerZ));
    const pair = MAT_INDEX[a] * SOUND_MATS.length + MAT_INDEX[b];
    const kind = this.kindOf[pair]!;
    const speedShare = clamp01(speed / SCRAPE_FULL_SPEED);
    const forceShare = clamp01(force / SCRAPE_FULL_FORCE);
    const level = distance > HEARD_M ? 0 : scrapeGain(kind) * distanceGain(distance) * Math.pow(speedShare, 0.8) * (0.25 + 0.75 * Math.sqrt(forceShare));
    const now = this.ctx.currentTime;
    let slot = -1;
    for (let at = 0; at < MAX_SCRAPES; at++) if (this.scrapeId[at] === id) slot = at;
    if (slot < 0) slot = this.startScrape(id, kind, level, now);
    if (slot < 0) return;
    this.scrapeTouched[slot] = 1;
    this.scrapeIdle[slot] = 0;
    const rate = SCRAPE_RATE_MIN + SCRAPE_RATE_SPAN * speedShare;
    const cutoff = Math.min(distanceCutoff(distance), scrapeCutoff(kind) * (0.25 + 0.75 * speedShare * (0.5 + 0.5 * forceShare)));
    const source = this.scrapeSource[slot]!;
    if (Math.abs(level - this.scrapeLevel[slot]!) > SCRAPE_CHANGE * Math.max(level, this.scrapeLevel[slot]!, 0.01)) {
      this.scrapeSoundGain[slot]!.gain.setTargetAtTime(level, now, SCRAPE_TAU_S);
      this.scrapeLevel[slot] = level;
    }
    if (Math.abs(rate - this.scrapeRate[slot]!) > SCRAPE_CHANGE * rate) {
      source.playbackRate.setTargetAtTime(rate, now, SCRAPE_TAU_S);
      this.scrapeRate[slot] = rate;
    }
    if (Math.abs(cutoff - this.scrapeCut[slot]!) > SCRAPE_CHANGE * cutoff) {
      this.scrapeFilter[slot]!.frequency.setTargetAtTime(cutoff, now, SCRAPE_TAU_S);
      this.scrapeCut[slot] = cutoff;
    }
  }

  /** Once a game frame: scrapes whose contact stopped sliding fade out and free their slot, spent hit voices are released. */
  frame(dt: number): void {
    const now = this.ctx.currentTime;
    for (let voice = 0; voice < MAX_VOICES; voice++) if (this.voiceEnd[voice]! <= now) this.release(voice);
    for (let slot = 0; slot < MAX_SCRAPES; slot++) {
      if (this.scrapeId[slot]! < 0) continue;
      if (this.scrapeTouched[slot] === 1) {
        this.scrapeTouched[slot] = 0;
        continue;
      }
      if (this.scrapeIdle[slot] === 0) {
        this.scrapeSoundGain[slot]!.gain.setTargetAtTime(0, now, SCRAPE_TAU_S);
        this.scrapeLevel[slot] = 0;
      }
      this.scrapeIdle[slot] = this.scrapeIdle[slot]! + dt;
      if (this.scrapeIdle[slot]! >= SCRAPE_FADE_S) this.stopScrape(slot);
    }
  }

  dispose(): void {
    for (let voice = 0; voice < MAX_VOICES; voice++) {
      this.voiceSource[voice]?.stop(this.ctx.currentTime);
      this.release(voice);
      this.voiceGain[voice]!.disconnect();
      this.voiceFilter[voice]!.disconnect();
    }
    for (let slot = 0; slot < MAX_SCRAPES; slot++) {
      if (this.scrapeId[slot]! >= 0) this.stopScrape(slot);
      this.scrapeSoundGain[slot]!.disconnect();
      this.scrapeFilter[slot]!.disconnect();
    }
  }

  /** Hit voices sounding or scheduled now. */
  activeVoices(): number {
    let count = 0;
    for (let voice = 0; voice < MAX_VOICES; voice++) if (this.voiceEnd[voice]! > this.ctx.currentTime) count++;
    return count;
  }

  /** Whether a hit at this pair and place already sounded within `DEFLAM_S` at about this strength: a held contact calls every step. */
  private deflam(pair: number, e: HitEvent): boolean {
    const now = this.args[ARG_NOW]!;
    const key = hash32(pair, hash32(Math.floor(e.x / DEFLAM_CELL_M), Math.floor(e.z / DEFLAM_CELL_M))) | 0;
    for (let slot = 0; slot < DEFLAM_SLOTS; slot++) {
      if (this.deflamKey[slot] !== key || now - this.deflamAt[slot]! >= DEFLAM_S) continue;
      if (e.impulse < this.deflamImpulse[slot]! * DEFLAM_GROWTH) return true;
      this.deflamAt[slot] = now;
      this.deflamImpulse[slot] = e.impulse;
      return false;
    }
    const slot = this.deflamNext;
    this.deflamNext = (slot + 1) % DEFLAM_SLOTS;
    this.deflamKey[slot] = key;
    this.deflamAt[slot] = now;
    this.deflamImpulse[slot] = e.impulse;
    return false;
  }

  private release(voice: number): void {
    const old = this.voiceSource[voice]!;
    if (old === null) return;
    old.disconnect();
    this.voiceSource[voice] = null;
  }

  /** A voice for the sound in `args`: a free one, else the weakest sounding one if it is weaker; -1 when all outrank it. */
  private claim(): number {
    const now = this.args[ARG_NOW]!;
    let weakest = -1;
    let weakestPriority = Infinity;
    for (let voice = 0; voice < MAX_VOICES; voice++) {
      if (this.voiceEnd[voice]! <= now) {
        this.release(voice);
        return voice;
      }
      if (this.voicePriority[voice]! < weakestPriority) {
        weakest = voice;
        weakestPriority = this.voicePriority[voice]!;
      }
    }
    if (weakestPriority >= this.args[ARG_PRIORITY]!) return -1;
    this.voiceSource[weakest]!.stop(now);
    this.release(weakest);
    return weakest;
  }

  /** Plays `buffer` on a voice with the sound `hit` left in `args`. */
  private play(buffer: SoundBuffer): boolean {
    const args = this.args;
    const voice = this.claim();
    if (voice < 0) return false;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = args[ARG_RATE]!;
    source.connect(this.voiceGain[voice]!);
    this.voiceGain[voice]!.gain.setValueAtTime(args[ARG_GAIN]!, args[ARG_NOW]!);
    this.voiceFilter[voice]!.frequency.setValueAtTime(distanceCutoff(args[ARG_DISTANCE]!), args[ARG_NOW]!);
    source.start(args[ARG_START]!);
    this.voiceSource[voice] = source;
    this.voiceEnd[voice] = args[ARG_START]! + buffer.duration / args[ARG_RATE]!;
    this.voicePriority[voice] = args[ARG_PRIORITY]!;
    return true;
  }

  /** A slot for contact `id`: a free one, else the quietest if `level` beats it; starts its loop. -1 when none. */
  private startScrape(id: number, kind: number, level: number, now: number): number {
    let slot = -1;
    let quietest = Infinity;
    for (let at = 0; at < MAX_SCRAPES; at++) {
      if (this.scrapeId[at]! < 0) {
        slot = at;
        break;
      }
      if (this.scrapeLevel[at]! < quietest) {
        quietest = this.scrapeLevel[at]!;
        slot = at;
      }
    }
    if (this.scrapeId[slot]! >= 0) {
      if (quietest >= level) return -1;
      this.stopScrape(slot);
    }
    const buffer = this.scrapeBank[kind * SCRAPE_VARIATIONS + (id & (SCRAPE_VARIATIONS - 1))]!;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.scrapeSoundGain[slot]!);
    this.scrapeSoundGain[slot]!.gain.setValueAtTime(0, now);
    this.scrapeFilter[slot]!.frequency.setValueAtTime(scrapeCutoff(kind), now);
    source.start(now, (hash32(id, kind) / 4294967296) * buffer.duration);
    this.scrapeSource[slot] = source;
    this.scrapeId[slot] = id;
    this.scrapeLevel[slot] = 0;
    this.scrapeRate[slot] = 1;
    this.scrapeCut[slot] = scrapeCutoff(kind);
    this.scrapeTouched[slot] = 0;
    this.scrapeIdle[slot] = 0;
    return slot;
  }

  private stopScrape(slot: number): void {
    const source = this.scrapeSource[slot]!;
    source.stop(this.ctx.currentTime);
    source.disconnect();
    this.scrapeSource[slot] = null;
    this.scrapeId[slot] = -1;
  }
}
