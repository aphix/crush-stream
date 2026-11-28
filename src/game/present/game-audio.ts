import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { AmbientBed } from "./ambient-bed.ts";
import { BUS, ceilingCurve, CrashDuck, DUCK, duckGain, engineBusGain, engineDuck, GLUE_TRIM, HitMix, MASTER_GLUE, MASTER_LIMITER, musicGain, REVERB, reverbImpulse, SEND, SHOT, slowmoCutoff, VOICES, VoiceBudget } from "./audio-mix.ts";
import { type HitEvent, HitSound, type SoundMat } from "./hit-sound.ts";
import { bandpass, lowpass, MotorSound } from "./motor-sound.ts";
import { MusicPlayer } from "./music.ts";
import { DEFAULT_STATION, musicBase, type StationId } from "./music-manifest.ts";
import { TyreSound } from "./tyre-sound.ts";
import { UiSound } from "./ui-sound.ts";

/** "playback" over "interactive": a larger output buffer, so a busy frame never starves the device. Network and Bluetooth outputs (Sonos) crackled
 *  under the game's load with the smallest buffer; the engine and crash sounds lose nothing a player hears. */
const LATENCY_HINT = "playback";
/** Time constant of the master gain ramp when audio is toggled. */
const MASTER_TAU_S = 0.05;
/** Time constant (s) of the engine bus's pause fade and of the slow-mo lowpass following the time rate. */
const BUS_TAU_S = 0.08;
/** The music's duck follows the engine fast enough to feel the throttle. */
const DUCK_TAU_S = 0.1;
/** The ambient bed under a pause: the world goes quiet, it does not stop. */
const PAUSED_AMBIENT = 0.35;
/** The duck's gains are re-sent only after the level moved this far: a duck is a few events a second, not one a frame. */
const DUCK_STEP = 0.01;
/** A UI sound books its voice this long (s). */
const UI_LIFE_S = 0.5;
/** `?voices=N` (0-8) overrides the engine voice count: the bench knob; 0 is no engine audio. */
const VOICES_PARAM = "voices";
const MAX_VOICES = 8;
/** Engine voices without the override: each is up to 38 waveguides of simple per-sample maths. The phone figure is calibrated (docs/TOOLCHAIN.md). */
const DESKTOP_VOICES = 6;
const PHONE_VOICES = 3;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/** Where the player is, for the ambient bed: the engine fills one of these each frame. */
export type AmbientScene = { place: Parameters<AmbientBed["set"]>[0]; hour: number; speed: number; indoors: boolean };
/** A UI sound's name. */
export type UiName = Parameters<UiSound["play"]>[0];

/** The engine voice count: the `?voices=` override, else by device (the same desktop flag as the lamp pool). */
function voiceSlots(desktop: boolean): number {
  const asked = Number.parseInt(new URLSearchParams(window.location.search).get(VOICES_PARAM) ?? "", 10);
  if (Number.isNaN(asked)) return desktop ? DESKTOP_VOICES : PHONE_VOICES;
  return Math.min(MAX_VOICES, Math.max(0, asked));
}

/** A noise burst's samples: seeded, so every context gets the same one. */
function fillNoise(data: Float32Array): void {
  let s = 0x9e3779b9;
  for (let i = 0; i < data.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    data[i] = (s / 2147483648 - 1) * (1 - i / data.length);
  }
}

/** A bus as the mix sets it: its gain follows a target. */
type GainBus = { gain: Pick<AudioParam, "setTargetAtTime"> };

/**
 * The one audio façade: a single AudioContext, the three listener on the camera, and the buses
 *
 *   engines (voices, tyres) -> engineBus -> slowmoFilter -> master            music -> musicBus -> master
 *   HitSound -> hitBus -> master          AmbientBed -> ambientBus -> master          UiSound -> uiBus -> master
 *   hitBus, ambientBus, uiBus -> their sends -> one convolver (the shared reverb) -> wet -> master
 *   master -> glue -> trim -> limiter -> ceiling (-1 dBFS) -> destination
 *
 * A crash ducks the music and the ambient bed (`CrashDuck`); each of the hit and UI buses admits a bounded number of voices (`VoiceBudget`).
 * Nothing is built until `unlock()` runs inside a user gesture. Audio is presentation: it reads the game, never writes it.
 */
export class GameAudio {
  readonly desktop: boolean;
  private readonly camera: THREE.PerspectiveCamera;
  private context: AudioContext | null = null;
  private listener: THREE.AudioListener | null = null;
  private master: GainNode | null = null;
  private engineBus: GainBus | null = null;
  private slowmoFilter: { frequency: Pick<AudioParam, "setTargetAtTime"> } | null = null;
  private hitBus: GainNode | null = null;
  private ambientBus: GainBus | null = null;
  private uiBus: GainNode | null = null;
  private musicBus: GainBus | null = null;
  private hits: Pick<HitSound, "hit" | "scrape" | "frame" | "dispose"> | null = null;
  private ambient: Pick<AmbientBed, "set" | "frame" | "dispose"> | null = null;
  private ui: Pick<UiSound, "play" | "dispose"> | null = null;
  private motor: Pick<MotorSound, "update" | "playerLevel" | "releaseVoices" | "dispose"> | null = null;
  private tyres: TyreSound | null = null;
  private music: MusicPlayer | null = null;
  /** The gunshots' decaying noise burst, filled once per context. */
  private noise: AudioBuffer | null = null;
  private on = false;
  private station: StationId = DEFAULT_STATION;
  /** Whether the game is running (not paused or held): a pause fades the engines out, the music plays on. */
  private live = true;
  /** Slider levels; the engine pushes the real ones with `setVolumes` right after construction. */
  private musicLevel = 0;
  private engineLevel = 0;
  /** The music's duck under the player's engine, from the last voice tick. */
  private enginesDuck = 1;
  /** Crashes duck the music and the ambient bed; `sentDuck` is the level their gains were last set for. */
  private readonly duck: CrashDuck;
  private sentDuck = 0;
  private readonly hitMix: HitMix;
  private readonly uiBudget = new VoiceBudget(VOICES.ui);
  private readonly onVisibility = (): void => {
    const context = this.context;
    if (!context) return;
    if (document.visibilityState === "hidden") {
      void context.suspend();
      this.music?.pause();
    } else if (this.on) {
      void context.resume();
      if (this.musicLevel > 0) this.music?.play();
    }
  };

  constructor(camera: THREE.PerspectiveCamera, desktop: boolean) {
    this.camera = camera;
    this.desktop = desktop;
    this.hitMix = new HitMix(desktop ? VOICES.hitsDesktop : VOICES.hitsPhone);
    this.duck = this.hitMix.duck;
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  get unlocked(): boolean {
    return this.context !== null;
  }

  /** Songs started so far (0 before the first) and the current one's "Artist – Title": the engine publishes both to the HUD's now-playing toast. */
  get trackSerial(): number {
    return this.music?.serial ?? 0;
  }

  get nowPlaying(): string {
    return this.music?.nowPlaying ?? "";
  }

  /** Builds the context and graph on the first call (a user gesture); later calls resume it. */
  unlock(): void {
    if (this.context) {
      void this.context.resume();
      return;
    }
    const Ctor = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
    if (!Ctor) return;
    const context = new Ctor({ latencyHint: LATENCY_HINT });
    THREE.AudioContext.setContext(context);
    const listener = new THREE.AudioListener();
    this.camera.add(listener);

    const ceiling = context.createWaveShaper();
    ceiling.curve = ceilingCurve(4097);
    ceiling.oversample = "4x";
    ceiling.connect(context.destination);
    const limiter = dynamics(context, MASTER_LIMITER);
    limiter.connect(ceiling);
    const trim = context.createGain();
    trim.gain.value = GLUE_TRIM;
    trim.connect(limiter);
    const glue = dynamics(context, MASTER_GLUE);
    glue.connect(trim);
    const master = context.createGain();
    master.gain.value = this.on ? 1 : 0;
    master.connect(glue);

    const slowmoFilter = lowpass(context, slowmoCutoff(1));
    slowmoFilter.connect(master);
    const engineBus = context.createGain();
    engineBus.gain.value = this.live ? engineBusGain(this.engineLevel) : 0;
    engineBus.connect(slowmoFilter);
    listener.gain.disconnect();
    listener.gain.connect(engineBus);
    const reverbIn = context.createGain();
    const room = context.createConvolver();
    const [left, right] = reverbImpulse(context.sampleRate, REVERB.seconds, REVERB.seed);
    const impulse = context.createBuffer(2, left.length, context.sampleRate);
    impulse.copyToChannel(left, 0);
    impulse.copyToChannel(right, 1);
    room.normalize = false;
    room.buffer = impulse;
    const roomWet = context.createGain();
    roomWet.gain.value = REVERB.wet;
    reverbIn.connect(room).connect(roomWet).connect(master);
    const sent = (bus: GainNode, send: number): GainNode => {
      bus.connect(master);
      const tap = context.createGain();
      tap.gain.value = send;
      bus.connect(tap).connect(reverbIn);
      return bus;
    };
    const hitBus = sent(context.createGain(), SEND.hits);
    hitBus.gain.value = BUS.hits;
    const ambientBus = sent(context.createGain(), SEND.ambient);
    ambientBus.gain.value = BUS.ambient;
    const uiBus = sent(context.createGain(), SEND.ui);
    uiBus.gain.value = BUS.ui;
    const musicBus = context.createGain();
    musicBus.gain.value = this.musicTarget();
    musicBus.connect(master);

    this.context = context;
    this.listener = listener;
    this.master = master;
    this.engineBus = engineBus;
    this.slowmoFilter = slowmoFilter;
    this.hitBus = hitBus;
    this.ambientBus = ambientBus;
    this.uiBus = uiBus;
    this.musicBus = musicBus;
    const motor = new MotorSound(voiceSlots(this.desktop));
    this.motor = motor;
    this.tyres = new TyreSound(context, engineBus);
    this.hits = new HitSound(context, hitBus);
    this.ambient = new AmbientBed(context, ambientBus);
    this.ui = new UiSound(context, uiBus);
    motor.load(context, listener).catch((reason: Error) => console.warn("motor sound: unavailable", reason));
    this.music = new MusicPlayer(context, musicBus, musicBase(import.meta.env), this.station);
    if (this.on && this.musicLevel > 0) this.music.play();
    void context.resume();
  }

  /** Audio on ramps the master up and resumes the context; off ramps it down and suspends. */
  setOn(on: boolean): void {
    this.on = on;
    const context = this.context;
    if (!context || !this.master) return;
    this.master.gain.setTargetAtTime(on ? 1 : 0, context.currentTime, MASTER_TAU_S);
    if (on) {
      void context.resume();
      if (this.musicLevel > 0) this.music?.play();
    } else {
      void context.suspend();
      this.music?.pause();
    }
  }

  /** The radio station the music plays (a MusicPlayer is built on the first `unlock()` with the one set by then); a change starts a fresh track on it. */
  setStation(station: StationId): void {
    this.station = station;
    this.music?.setStation(station);
  }

  /** The slider levels: the music bus (capped by `musicGain`) and the engine bus. The engine pushes them at construction and on every change. */
  setVolumes(music: number, engine: number): void {
    this.musicLevel = music;
    this.engineLevel = engine;
    const context = this.context;
    if (!context || !this.musicBus || !this.engineBus) return;
    this.musicBus.gain.setTargetAtTime(this.musicTarget(), context.currentTime, MASTER_TAU_S);
    this.engineBus.gain.setTargetAtTime(this.live ? engineBusGain(engine) : 0, context.currentTime, MASTER_TAU_S);
    // Music at 0 is off, not silent: the element stops streaming and decoding, and the playlist holds its place instead of moving on unheard.
    if (music <= 0) this.music?.pause();
    else if (this.on && document.visibilityState !== "hidden") this.music?.play();
  }

  /** The music bus gain: the slider under the player's engine and the crash duck. */
  private musicTarget(): number {
    return musicGain(this.musicLevel, this.enginesDuck, duckGain(this.duck.level, DUCK.musicDb));
  }

  /** Sets the duck-driven buses (music, ambient) for the duck's level now; `tauS` is how fast they follow. */
  private sendDuck(now: number, tauS: number): void {
    this.sentDuck = this.duck.level;
    this.musicBus?.gain.setTargetAtTime(this.musicTarget(), now, tauS);
    this.ambientBus?.gain.setTargetAtTime(BUS.ambient * duckGain(this.duck.level, DUCK.ambientDb) * (this.live ? 1 : PAUSED_AMBIENT), now, tauS);
  }

  /**
   * The per-frame seam (the engine calls it with audio on): moves the engine voices, the hit voices and the ambient bed, and on each voice tick sets the engine
   * bus (silent while `live` is false), the slow-mo lowpass from `rate`, and the music's duck under the player's engine; the crash duck follows its own level.
   * `cars` are the ones drawn (the reel's, while it plays); `priority` is the car that always has a voice, and the one whose tyres squeal and land.
   */
  frame(dt: number, cars: readonly DeformableCar[], priority: DeformableCar | null, rate: number, live: boolean, scene: AmbientScene): void {
    const context = this.context;
    const motor = this.motor;
    if (!context || !motor || !this.engineBus || !this.slowmoFilter || !this.musicBus) return;
    this.live = live;
    this.duck.step(dt);
    this.tyres?.frame(dt, priority);
    this.hits?.frame(dt);
    this.ambient?.set(scene.place, scene.hour, scene.speed, scene.indoors);
    this.ambient?.frame(dt);
    const now = context.currentTime;
    if (motor.update(dt, cars, this.camera, priority, rate, this.engineLevel === 0)) {
      this.engineBus.gain.setTargetAtTime(live ? engineBusGain(this.engineLevel) : 0, now, BUS_TAU_S);
      this.slowmoFilter.frequency.setTargetAtTime(slowmoCutoff(rate), now, BUS_TAU_S);
      this.enginesDuck = engineDuck(motor.playerLevel);
      this.sendDuck(now, DUCK_TAU_S);
    } else if (Math.abs(this.duck.level - this.sentDuck) > DUCK_STEP || (this.duck.level === 0 && this.sentDuck !== 0)) this.sendDuck(now, DUCK_TAU_S);
  }

  /** A scene reset: every engine voice fades out and frees its slot. */
  releaseVoices(): void {
    this.motor?.releaseVoices();
  }

  /** A hit: it takes a hit voice if the budget has one (a harder hit may displace the weakest running one), ducks the music and ambience by its impulse, and plays at its place. */
  hit(e: HitEvent): void {
    const context = this.context;
    if (!context || !this.hits) return;
    const now = context.currentTime;
    if (!this.hitMix.admit(now, e.impulse)) return;
    this.sendDuck(now, DUCK.attackTauS);
    const at = this.camera.matrixWorld.elements;
    this.hits.hit(e, at[12]!, at[13]!, at[14]!);
  }

  /** A contact `id` is sliding this frame at `speed` m/s under `force`; call it every frame it slides, a contact that stops being called fades out. */
  scrape(id: number, speed: number, force: number, x: number, y: number, z: number, a: SoundMat, b: SoundMat): void {
    this.hits?.scrape(id, speed, force, x, y, z, a, b);
  }

  /** A menu, HUD or event cue; the UI bus admits `VOICES.ui` at once. */
  playUi(name: UiName): void {
    const context = this.context;
    if (!context || !this.ui || !this.uiBudget.take(context.currentTime, 1, UI_LIFE_S)) return;
    this.ui.play(name);
  }

  /** A gunshot: one short noise burst through a band-pass. */
  shot(kind: keyof typeof SHOT.hz): void {
    const context = this.context;
    if (!context || !this.hitBus) return;
    const t = context.currentTime;
    const noise = context.createBufferSource();
    noise.buffer = this.noiseBuffer(context);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(SHOT.gain, t + SHOT.attackS);
    gain.gain.exponentialRampToValueAtTime(0.001, t + SHOT.s);
    noise.connect(bandpass(context, SHOT.hz[kind], SHOT.q)).connect(gain).connect(this.hitBus);
    noise.start(t);
    noise.stop(t + SHOT.s);
  }

  private noiseBuffer(context: AudioContext): AudioBuffer {
    if (!this.noise) {
      this.noise = context.createBuffer(1, Math.round(context.sampleRate * SHOT.noiseS), context.sampleRate);
      fillNoise(this.noise.getChannelData(0));
    }
    return this.noise;
  }

  dispose(): void {
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.listener) this.camera.remove(this.listener);
    this.motor?.dispose();
    this.hits?.dispose();
    this.ambient?.dispose();
    this.ui?.dispose();
    this.music?.dispose();
    void this.context?.close();
    this.context = null;
    this.listener = null;
    this.master = null;
    this.engineBus = null;
    this.slowmoFilter = null;
    this.hitBus = null;
    this.ambientBus = null;
    this.uiBus = null;
    this.musicBus = null;
    this.motor = null;
    this.tyres = null;
    this.hits = null;
    this.ambient = null;
    this.ui = null;
    this.music = null;
    this.on = false;
    this.duck.level = 0;
  }
}

/** A DynamicsCompressor set from one of the `audio-mix` presets. */
function dynamics(context: AudioContext, p: { threshold: number; knee: number; ratio: number; attack: number; release: number }): DynamicsCompressorNode {
  const node = context.createDynamicsCompressor();
  node.threshold.value = p.threshold;
  node.knee.value = p.knee;
  node.ratio.value = p.ratio;
  node.attack.value = p.attack;
  node.release.value = p.release;
  return node;
}
