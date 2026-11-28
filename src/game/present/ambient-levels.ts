import { LAYER, LAYERS, LOOP_RMS, type Layer } from "./ambient-loops.ts";
import { EMITTERS } from "./ambient-shots.ts";

/** Where the ambient bed is: what the player is listening to the background of. */
export type AmbientPlace = "city" | "track" | "dirt" | "arena" | "openworld";
const PLACES: readonly AmbientPlace[] = ["city", "track", "dirt", "arena", "openworld"];

/** What `bedLevels` writes: a gain per `LAYERS` entry (0..6), then the wind low-pass (Hz) and the whole bed's low-pass (Hz) and gain. */
export const LEVEL = { windHz: 7, bedHz: 8, bedGain: 9 } as const;
export const LEVEL_COUNT = 10;

/** A layer's contribution (RMS, against loops rendered at `LOOP_RMS`) by day and by night, per place. A place's trafficky rumble follows the hour's `activity` on top. */
const MIX: Record<AmbientPlace, Partial<Record<Layer, readonly [number, number]>>> = {
  city: { rumble: [0.04, 0.04], hum: [0.01, 0.013], wind: [0.006, 0.008], insects: [0, 0.002] },
  openworld: { rumble: [0.034, 0.034], hum: [0.009, 0.009], wind: [0.006, 0.008], insects: [0.002, 0.014] },
  track: { rumble: [0.01, 0.01], murmur: [0.03, 0.03], wind: [0.012, 0.012], insects: [0.002, 0.01] },
  dirt: { wind: [0.02, 0.014], insects: [0.008, 0.022] },
  arena: { rumble: [0.006, 0.006], hum: [0.006, 0.006], wind: [0.003, 0.003], murmur: [0.015, 0.015], roar: [0.05, 0.05] },
};
/** Places whose rumble is city traffic, which swells at rush hour and thins at night. */
const TRAFFIC: readonly AmbientPlace[] = ["city", "openworld"];
/** What a crowd's cheer adds: its own layer, and a swell of the roar. */
const CHEER_RMS = 0.08;
const CHEER_SWELL_RMS = 0.025;
/** Wind: the speed (m/s) that is a full rush, the RMS a full rush adds, and the low-pass (Hz) at a stand and at a rush. */
const RUSH_SPEED = 60;
const RUSH_RMS = 0.07;
const WIND_CALM_HZ = 1200;
const WIND_RUSH_HZ = 7000;
/** Indoors or in a tunnel: the low-pass (Hz) and the gain left. */
const INDOORS_HZ = 650;
const INDOORS_GAIN = 0.55;
const OUTDOORS_HZ = 16000;

const mixOf = new Float32Array(PLACES.length * LAYERS.length * 2);
for (let p = 0; p < PLACES.length; p++) {
  for (let l = 0; l < LAYERS.length; l++) {
    const pair = MIX[PLACES[p]!][LAYERS[l]!] ?? [0, 0];
    mixOf[(p * LAYERS.length + l) * 2] = pair[0];
    mixOf[(p * LAYERS.length + l) * 2 + 1] = pair[1];
  }
}

/** Events per minute by day and by night, per place and emitter. */
const RATES: Record<AmbientPlace, Partial<Record<(typeof EMITTERS)[number], readonly [number, number]>>> = {
  city: { horn: [3, 1], siren: [1.5, 1], dog: [0, 0.2], bird: [0.5, 0] },
  openworld: { horn: [2.5, 0.4], siren: [1, 0.6], dog: [0.3, 1.5], bird: [4, 0] },
  track: { siren: [0.2, 0.2], bird: [1.5, 0], pa: [1.5, 1.5] },
  dirt: { dog: [0.3, 0.6], bird: [6, 0.2] },
  arena: { pa: [2.5, 2.5] },
};
const rateOf = new Float32Array(PLACES.length * EMITTERS.length * 2);
for (let p = 0; p < PLACES.length; p++) {
  for (let k = 0; k < EMITTERS.length; k++) {
    const pair = RATES[PLACES[p]!][EMITTERS[k]!] ?? [0, 0];
    rateOf[(p * EMITTERS.length + k) * 2] = pair[0];
    rateOf[(p * EMITTERS.length + k) * 2 + 1] = pair[1];
  }
}

/** The layers a place can ever want (any hour; the cheer too wherever a crowd is): loaded when the place is entered. */
export function placeLayers(place: AmbientPlace): number[] {
  const p = PLACES.indexOf(place);
  const crowd = MIX[place].murmur !== undefined || MIX[place].roar !== undefined;
  return LAYERS.map((_, l) => l).filter((l) => mixOf[(p * LAYERS.length + l) * 2]! + mixOf[(p * LAYERS.length + l) * 2 + 1]! > 0 || (crowd && l === LAYER.cheer));
}

/** The one-shots a place can ever fire (an `EMITTERS` index each): loaded when the place is entered. */
export function placeEmitters(place: AmbientPlace): number[] {
  const p = PLACES.indexOf(place);
  return EMITTERS.map((_, k) => k).filter((k) => rateOf[(p * EMITTERS.length + k) * 2]! + rateOf[(p * EMITTERS.length + k) * 2 + 1]! > 0);
}

/** One-shot peak level per emitter (`EMITTERS` order), the least seconds between two of one kind, the schedule's seed and the widest pan. */
export const SHOT_GAIN = Float32Array.of(0.2, 0.22, 0.2, 0.18, 0.2);
export const SHOT_GAP_S = Float32Array.of(4, 14, 5, 3, 8);
export const SCHEDULE_SEED = 0x5eed1234;
export const SHOT_PAN = 0.8;

/** 1 in full day, 0 in full night, easing over dawn (5:30 to 8) and dusk (18 to 20:30). */
function daylight(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const rise = Math.min(1, Math.max(0, (h - 5.5) / 2.5));
  const fall = Math.min(1, Math.max(0, (20.5 - h) / 2.5));
  const edge = Math.min(rise, fall);
  return edge * edge * (3 - 2 * edge);
}

/** City traffic through the day: a night floor, a daytime body and two rush hours, about 1 at the top. */
function activity(hour: number): number {
  const rush = Math.exp(-(((hour - 8) / 1.2) ** 2)) + Math.exp(-(((hour - 17.5) / 1.5) ** 2));
  return 0.28 + 0.47 * daylight(hour) + 0.25 * rush;
}

/** The bed's targets into `out` (see `LEVEL`): the hour crossfades each layer's day and night mix, speed opens the wind, `indoors` closes everything. No allocation. */
export function bedLevels(place: AmbientPlace, hour: number, speed: number, indoors: boolean, cheer: number, out: Float32Array): void {
  const p = PLACES.indexOf(place);
  const day = daylight(hour);
  const traffic = TRAFFIC.includes(place) ? activity(hour) : 1;
  const rush = Math.min(1, Math.max(0, speed / RUSH_SPEED));
  for (let l = 0; l < LAYERS.length; l++) {
    const at = (p * LAYERS.length + l) * 2;
    out[l] = (mixOf[at + 1]! + (mixOf[at]! - mixOf[at + 1]!) * day) / LOOP_RMS;
  }
  out[LAYER.rumble] = out[LAYER.rumble]! * traffic;
  out[LAYER.wind] = out[LAYER.wind]! + (RUSH_RMS * rush ** 1.4) / LOOP_RMS;
  out[LAYER.roar] = out[LAYER.roar]! + (CHEER_SWELL_RMS * cheer) / LOOP_RMS;
  out[LAYER.cheer] = (CHEER_RMS * cheer) / LOOP_RMS;
  out[LEVEL.windHz] = WIND_CALM_HZ + (WIND_RUSH_HZ - WIND_CALM_HZ) * rush ** 0.8;
  out[LEVEL.bedHz] = indoors ? INDOORS_HZ : OUTDOORS_HZ;
  out[LEVEL.bedGain] = indoors ? INDOORS_GAIN : 1;
}

/** Events per minute of emitter `kind` (an `EMITTERS` index) in `place` at `hour`. */
export function emitterRate(place: AmbientPlace, kind: number, hour: number): number {
  const at = (PLACES.indexOf(place) * EMITTERS.length + kind) * 2;
  return rateOf[at + 1]! + (rateOf[at]! - rateOf[at + 1]!) * daylight(hour);
}
