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
const ARG_HOLD = 6;
const MAX_VOICES = 24;
const MAX_SCRAPES = 6;
/** A scrape slot's `scrapeId` when it is unused, and when its loop is fading out. */
const SCRAPE_FREE = -1;
const SCRAPE_DYING = -2;
/** A contact's new kind of loop starts once it has been asked for this many frames running, and the old loop fades with this time constant (s) and stops this long (s) after. */
const KIND_HOLD_FRAMES = 3;
const KIND_FADE_TAU_S = 0.003;
const KIND_FADE_STOP_S = 0.015;
/** Variations of each bank buffer on a phone: a third less memory and render time. */
const PHONE_VARIATIONS = 2;
/** `frame` renders bank buffers until this much time (ms) has gone, at least one a frame. */
const BUILD_BUDGET_MS = 2;
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
/** A voice taken from another fades over about 2 ms (time constant) and the new sound starts 10 ms in, so the cut does not click. */
const STEAL_TAU_S = 0.0007;
const STEAL_HOLD_S = 0.01;
const DEFLAM_SLOTS = 16;
const DEFLAM_S = 0.04;
const DEFLAM_GROWTH = 1.25;
const DEFLAM_CELL_M = 1.5;
const SCRAPE_FULL_SPEED = 15;
const SCRAPE_FADE_S = 0.25;
const SCRAPE_TAU_S = 0.03;
const SCRAPE_CHANGE = 0.05;
const SCRAPE_RATE_MIN = 0.6;
const SCRAPE_RATE_SPAN = 1;
const SQUARES = SOUND_MATS.length * SOUND_MATS.length;
const SCRAPE_STEPS = SCRAPE_KINDS * SCRAPE_VARIATIONS;

/**
 * Impact and scrape sound by material pair, size and place. The bank of mono buffers is rendered a little each `frame` after construction (hits whose
 * buffer is not ready yet are skipped); a hit picks one by pair, size and a seeded hash and plays it detuned, delayed by distance and filtered by it.
 * Voices are a fixed pool ranked by peak times the share of the sound left; a scrape is a looping buffer per contact whose level and brightness follow speed and force (0-1).
 */
export class HitSound {
  private readonly ctx: SoundContext;
  private readonly variations: number;
  private readonly rowStride: number;
  private readonly bank: (SoundBuffer | null)[] = [];
  private readonly scrapeBank: (SoundBuffer | null)[] = [];
  /** The material pairs that have a row of buffers, and per (a, b) pair its row and scrape loop kind. */
  private readonly rowKeys: (readonly [SoundMat, SoundMat])[] = [];
  private readonly rowOf = new Int32Array(SQUARES);
  private readonly kindOf = new Uint8Array(SQUARES);
  private readonly total: number;
  private built = 0;
  private bytes = 0;
  private renderMs = 0;
  private readonly voiceGain: SoundGain[] = [];
  private readonly voiceFilter: SoundFilter[] = [];
  private readonly voiceSource: (SoundSource | null)[] = [];
  private readonly voiceStart = new Float64Array(MAX_VOICES);
  private readonly voiceEnd = new Float64Array(MAX_VOICES);
  private readonly voicePriority = new Float64Array(MAX_VOICES);
  private readonly scrapeId = new Int32Array(MAX_SCRAPES).fill(SCRAPE_FREE);
  private readonly scrapeKindOf = new Uint8Array(MAX_SCRAPES);
  /** The kind a contact has been asking for instead of its loop's, and for how many frames running. */
  private readonly scrapePending = new Uint8Array(MAX_SCRAPES);
  private readonly scrapeHeld = new Uint8Array(MAX_SCRAPES);
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
  private readonly args = new Float64Array(7);
  private serial = 0;
  private listenerX = 0;
  private listenerY = 0;
  private listenerZ = 0;

  /** Builds the voice pools and plans the bank; the buffers are rendered by `frame`. `desktop` false keeps a phone's bank smaller. */
  constructor(ctx: SoundContext, out: SoundNode, desktop = true) {
    this.ctx = ctx;
    this.variations = desktop ? HIT_VARIATIONS : PHONE_VARIATIONS;
    this.rowStride = HIT_SIZE_LIST.length * this.variations;
    this.planBank();
    this.total = SCRAPE_STEPS + this.rowKeys.length * this.rowStride;
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

  /** Bytes of rendered buffers held so far. */
  get bankBytes(): number {
    return this.bytes;
  }

  /** Milliseconds `frame` has spent rendering the bank so far. */
  get bankMs(): number {
    return this.renderMs;
  }

  /** Whether every buffer of the bank is rendered. */
  get bankReady(): boolean {
    return this.built >= this.total;
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

  /** Lists the bank's rows (steel first, as the first hits are steel's) and maps each of the 256 material pairs to its row and scrape kind. */
  private planBank(): void {
    const rows = new Map<string, number>();
    for (let a = 0; a < SOUND_MATS.length; a++) {
      for (let b = 0; b < SOUND_MATS.length; b++) {
        const key = bankKey(SOUND_MATS[a]!, SOUND_MATS[b]!);
        const name = `${key[0]}/${key[1]}`;
        let row = rows.get(name);
        if (row === undefined) {
          row = this.rowKeys.length;
          rows.set(name, row);
          this.rowKeys.push(key);
          for (let slot = 0; slot < this.rowStride; slot++) this.bank.push(null);
        }
        this.rowOf[a * SOUND_MATS.length + b] = row;
        this.kindOf[a * SOUND_MATS.length + b] = scrapeKind(SOUND_MATS[a]!, SOUND_MATS[b]!);
      }
    }
    for (let step = 0; step < SCRAPE_STEPS; step++) this.scrapeBank.push(null);
  }

  /** Whether the next buffer to render is a crash's, the dearest kind. */
  private nextIsCrash(): boolean {
    return this.built - SCRAPE_STEPS >= this.rowKeys.length * (this.rowStride - this.variations);
  }

  /** Renders the next buffer of the plan: the scrape loops, then every row's tick and hit buffers, then every row's crash buffers. */
  private buildNext(): void {
    const step = this.built++;
    if (step < SCRAPE_STEPS) {
      const buffer = this.ctx.createBuffer(1, scrapeSamples(BANK_RATE), BANK_RATE);
      renderScrapeLoop(Math.floor(step / SCRAPE_VARIATIONS), step % SCRAPE_VARIATIONS, BANK_RATE, buffer.getChannelData(0));
      this.scrapeBank[step] = buffer;
      this.bytes += buffer.length * 4;
      return;
    }
    const at = step - SCRAPE_STEPS;
    const small = this.rowStride - this.variations;
    const smallSteps = this.rowKeys.length * small;
    const row = at < smallSteps ? Math.floor(at / small) : Math.floor((at - smallSteps) / this.variations);
    const within = at < smallSteps ? at % small : small + ((at - smallSteps) % this.variations);
    const size = HIT_SIZE_LIST[Math.floor(within / this.variations)]!;
    const [first, second] = this.rowKeys[row]!;
    const buffer = this.ctx.createBuffer(1, hitSamples(size, BANK_RATE), BANK_RATE);
    renderHit(first, second, size, within % this.variations, BANK_RATE, buffer.getChannelData(0));
    this.bank[row * this.rowStride + within] = buffer;
    this.bytes += buffer.length * 4;
  }

  /** Renders buffers until the budget is spent; a crash buffer is rendered alone in its frame. */
  private buildSome(): void {
    const started = performance.now();
    do this.buildNext();
    while (this.built < this.total && performance.now() - started < BUILD_BUDGET_MS && !this.nextIsCrash());
    this.renderMs += performance.now() - started;
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
    const pair = MAT_INDEX[e.a] * SOUND_MATS.length + MAT_INDEX[e.b];
    let size = hitSize(e.impulse);
    let base = this.rowOf[pair]! * this.rowStride + size * this.variations;
    if (this.bank[base] === null && size === 2) {
      size = 1;
      base -= this.variations;
    }
    if (this.bank[base] === null) return;
    const args = this.args;
    args[ARG_NOW] = this.ctx.currentTime;
    if (this.deflam(pair, e)) return;
    const seed = hash32(this.serial++, hash32(((e.x * 4) | 0) ^ Math.imul((e.z * 4) | 0, 0x1f3d5b79), (e.impulse * 1024) | 0));
    const spread = ((seed >>> 8) & 255) / 255 - 0.5;
    args[ARG_DISTANCE] = distance;
    args[ARG_PRIORITY] = peak;
    args[ARG_GAIN] = peak * (1 - (((seed >>> 24) & 255) / 255) * GAIN_SPREAD);
    args[ARG_RATE] = 1 + spread * 2 * DETUNE[size];
    args[ARG_START] = args[ARG_NOW]! + Math.min(distance / SPEED_OF_SOUND, MAX_DELAY_S) + (((seed >>> 16) & 255) / 255) * MAX_JITTER_S;
    if (!this.play(this.bank[base + (seed % this.variations)] ?? this.bank[base]!) || size !== 2) return;
    const tick = this.rowOf[pair]! * this.rowStride;
    args[ARG_START] = args[ARG_START]! + SECOND_LAYER_DELAY_S + (((seed >>> 12) & 127) / 127) * SECOND_LAYER_SPREAD_S;
    args[ARG_GAIN] = args[ARG_GAIN]! * SECOND_LAYER_GAIN;
    args[ARG_RATE] = SECOND_LAYER_PITCH * (1 - spread * 0.1);
    args[ARG_PRIORITY] = peak * SECOND_LAYER_PRIORITY;
    const echo = this.bank[tick + ((seed >>> 4) % this.variations)] ?? this.bank[tick];
    if (echo) this.play(echo);
  }

  /** A sliding contact `id`, called every frame it slides; `force` is 0 (no press) to 1 (hard). */
  scrape(id: number, speed: number, force: number, x: number, y: number, z: number, a: SoundMat, b: SoundMat): void {
    if (id < 0) return;
    const distance = hypot3(x - this.listenerX, y - this.listenerY, z - this.listenerZ);
    const pair = MAT_INDEX[a] * SOUND_MATS.length + MAT_INDEX[b];
    let kind = this.kindOf[pair]!;
    const now = this.ctx.currentTime;
    let slot = -1;
    for (let at = 0; at < MAX_SCRAPES; at++) if (this.scrapeId[at] === id) slot = at;
    if (slot >= 0 && this.scrapeKindOf[slot] !== kind) {
      // The old loop plays on until the new kind has held for a few frames, so a contact flipping between two does not restart each frame.
      this.scrapeHeld[slot] = this.scrapePending[slot] === kind ? this.scrapeHeld[slot]! + 1 : 1;
      this.scrapePending[slot] = kind;
      if (this.scrapeHeld[slot]! < KIND_HOLD_FRAMES) kind = this.scrapeKindOf[slot]!;
      else {
        this.fadeScrape(slot, now);
        slot = -1;
      }
    } else if (slot >= 0) this.scrapeHeld[slot] = 0;
    const speedShare = clamp01(speed / SCRAPE_FULL_SPEED);
    const forceShare = clamp01(force);
    const level = distance > HEARD_M ? 0 : scrapeGain(kind) * distanceGain(distance) * Math.pow(speedShare, 0.8) * (0.25 + 0.75 * Math.sqrt(forceShare));
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

  /** Once a game frame, with the listener's place: renders a little of the bank until it is done, fades scrapes whose contact stopped sliding and frees their slot, releases spent hit voices. */
  frame(dt: number, lx: number, ly: number, lz: number): void {
    this.listenerX = lx;
    this.listenerY = ly;
    this.listenerZ = lz;
    if (this.built < this.total) this.buildSome();
    const now = this.ctx.currentTime;
    for (let voice = 0; voice < MAX_VOICES; voice++) if (this.voiceEnd[voice]! <= now) this.release(voice);
    for (let slot = 0; slot < MAX_SCRAPES; slot++) {
      const taken = this.scrapeId[slot]!;
      if (taken === SCRAPE_FREE) continue;
      if (taken === SCRAPE_DYING) {
        if (now >= this.scrapeIdle[slot]!) this.stopScrape(slot);
        continue;
      }
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
      if (this.scrapeId[slot] !== SCRAPE_FREE) this.stopScrape(slot);
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

  /**
   * A voice for the sound in `args`: a free one, else the one with the least peak-times-share-left if that is under the new peak, faded out over a few ms (and `ARG_HOLD` says
   * the new sound waits for it); -1 when all outrank it.
   */
  private claim(): number {
    const now = this.args[ARG_NOW]!;
    this.args[ARG_HOLD] = 0;
    let weakest = -1;
    let weakestRank = Infinity;
    for (let voice = 0; voice < MAX_VOICES; voice++) {
      const end = this.voiceEnd[voice]!;
      if (end <= now) {
        this.release(voice);
        return voice;
      }
      const rank = this.voicePriority[voice]! * Math.min(1, (end - now) / (end - this.voiceStart[voice]!));
      if (rank < weakestRank) {
        weakest = voice;
        weakestRank = rank;
      }
    }
    if (weakestRank >= this.args[ARG_PRIORITY]!) return -1;
    this.voiceSource[weakest]!.stop(now + STEAL_HOLD_S);
    this.voiceGain[weakest]!.gain.setTargetAtTime(0, now, STEAL_TAU_S);
    this.voiceSource[weakest] = null;
    this.args[ARG_HOLD] = STEAL_HOLD_S;
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
    const at = args[ARG_NOW]! + args[ARG_HOLD]!;
    this.voiceGain[voice]!.gain.setValueAtTime(args[ARG_GAIN]!, at);
    this.voiceFilter[voice]!.frequency.setValueAtTime(distanceCutoff(args[ARG_DISTANCE]!), at);
    const start = args[ARG_START]! + args[ARG_HOLD]!;
    source.start(start);
    this.voiceSource[voice] = source;
    this.voiceStart[voice] = start;
    this.voiceEnd[voice] = start + buffer.duration / args[ARG_RATE]!;
    this.voicePriority[voice] = args[ARG_PRIORITY]!;
    return true;
  }

  /** A slot for contact `id`: a free one, else the quietest if `level` beats it; starts its loop. -1 when none, or when the loop is not rendered yet. */
  private startScrape(id: number, kind: number, level: number, now: number): number {
    const buffer = this.scrapeBank[kind * SCRAPE_VARIATIONS + (id & (SCRAPE_VARIATIONS - 1))];
    if (!buffer) return -1;
    let slot = -1;
    let quietest = Infinity;
    for (let at = 0; at < MAX_SCRAPES; at++) {
      const taken = this.scrapeId[at]!;
      if (taken === SCRAPE_FREE) {
        slot = at;
        quietest = -1;
        break;
      }
      if (taken !== SCRAPE_DYING && this.scrapeLevel[at]! < quietest) {
        quietest = this.scrapeLevel[at]!;
        slot = at;
      }
    }
    if (slot < 0) return -1;
    if (this.scrapeId[slot] !== SCRAPE_FREE) {
      if (quietest >= level) return -1;
      this.stopScrape(slot);
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.scrapeSoundGain[slot]!);
    this.scrapeSoundGain[slot]!.gain.setValueAtTime(0, now);
    this.scrapeFilter[slot]!.frequency.setValueAtTime(scrapeCutoff(kind), now);
    source.start(now, (hash32(id, kind) / 4294967296) * buffer.duration);
    this.scrapeSource[slot] = source;
    this.scrapeId[slot] = id;
    this.scrapeKindOf[slot] = kind;
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
    this.scrapeId[slot] = SCRAPE_FREE;
  }

  /** Lets a loop die away without a click: its gain falls over a few ms and it stops 15 ms on (`scrapeIdle` holds when), after which `frame` frees the slot. */
  private fadeScrape(slot: number, now: number): void {
    this.scrapeSoundGain[slot]!.gain.setTargetAtTime(0, now, KIND_FADE_TAU_S);
    this.scrapeSource[slot]!.stop(now + KIND_FADE_STOP_S);
    this.scrapeId[slot] = SCRAPE_DYING;
    this.scrapeIdle[slot] = now + KIND_FADE_STOP_S;
  }
}
