// Offline render of the whole mix: a scripted 20 s figure-8 race with crashes, through the buses, ducks, shared reverb and master chain (no browser).
// Engines are the shipped motor worklet; hits, scrapes, ambience, UI and music are stand-ins until HitSound, AmbientBed and UiSound land.
// node --disable-warning=ExperimentalWarning --import ./scripts/test-setup.mjs scripts/render-audio-mix.mjs <out dir>
import { mkdirSync } from "node:fs";
import { VOICES } from "../src/game/present/audio-mix.ts";
import { renderEngine } from "../src/game/present/mix-engine.test-util.ts";
import { admitHits, BUS_NAMES, bandpass, level, mixAt, mixDown, noise, SAMPLE_RATE, standInHit, writeWav } from "../src/game/present/mix-render.test-util.ts";

const OUT = process.argv[2] ?? "/home/aphix/crash-wt/audio-renders/AudioMix";
const SECONDS = 20;
const N = SECONDS * SAMPLE_RATE;
mkdirSync(OUT, { recursive: true });

const tone = (hz, seconds, gain, decay = 4) => Float32Array.from({ length: Math.round(seconds * SAMPLE_RATE) }, (_, i) => gain * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE) * Math.exp((-decay * i) / SAMPLE_RATE));
const ramp = (t, points) => {
  for (let k = 1; k < points.length; k++) if (t < points[k][0]) return points[k - 1][1] + ((points[k][1] - points[k - 1][1]) * (t - points[k - 1][0])) / (points[k][0] - points[k - 1][0]);
  return points[points.length - 1][1];
};

// Engines: the player's sedan and two rivals, the rivals further off.
const player = await renderEngine("sedan", "healthy", SECONDS, (t) =>
  ramp(t, [[0, 0.25], [3, 0.25], [3.4, 0.55], [6.5, 0.9], [7, 0.4], [7.6, 0.85], [11.9, 0.95], [12.2, 0.3], [16, 0.3], [16.5, 0.6], [19, 0.9]]),
);
const rivalA = await renderEngine("muscle", "healthy", SECONDS, (t) => ramp(t, [[0, 0.25], [3, 0.25], [3.6, 0.6], [9, 0.9], [12.1, 0.2], [20, 0.2]]));
const rivalB = await renderEngine("truck", "healthy", SECONDS, (t) => ramp(t, [[0, 0.25], [3, 0.25], [4, 0.7], [11, 0.85], [12.3, 0.3], [20, 0.5]]));
const engines = new Float32Array(N);
for (let i = 0; i < N; i++) engines[i] = (player[i] ?? 0) + 0.45 * (rivalA[i] ?? 0) + 0.35 * (rivalB[i] ?? 0);

// Hits the feed reports: [time, impulse]; and the contacts that slide: [from, to, force, hz].
const hits = [
  [6.1, 7], [8.3, 5], [9.6, 16], [12.0, 42], [12.02, 38], [12.05, 16], [12.08, 25], [12.12, 30], [12.15, 28], [12.18, 22], [12.2, 18], [12.23, 26], [12.26, 33], [12.3, 15], [12.34, 20], [12.4, 12], [16.5, 6], [17.5, 9], [18.5, 20],
].map(([t, impulse]) => ({ t, impulse }));
const slides = [[8.3, 9.0, 0.4, 1800], [9.6, 10.6, 0.7, 900], [13.0, 15.2, 0.6, 1300]];

const { admitted, duck } = admitHits(hits, SECONDS, VOICES.hitsDesktop);
const hitStem = new Float32Array(N);
for (const h of admitted) mixAt(hitStem, h.t, standInHit(h.impulse));
const rasp = noise(99);
for (const [from, to, force, hz] of slides) {
  const raw = Float32Array.from({ length: Math.round((to - from) * SAMPLE_RATE) }, () => rasp());
  const band = bandpass(raw, hz, 2.5);
  for (let i = 0; i < band.length; i++) band[i] *= 0.5 * force * Math.min(1, i / 2000) * Math.min(1, (band.length - i) / 4000);
  mixAt(hitStem, from, band);
}

// Ambience (wind, a distant crowd, a low hum), UI cues and a pad for the music: stand-ins.
const hiss = noise(5);
const ambient = bandpass(Float32Array.from({ length: N }, () => hiss()), 600, 0.5);
const hum = tone(55, SECONDS, 0.08, 0);
for (let i = 0; i < N; i++) ambient[i] = ambient[i] * 0.5 + hum[i];
const ui = new Float32Array(N);
for (const t of [0, 1, 2]) mixAt(ui, t, tone(880, 0.25, 0.5, 14));
mixAt(ui, 3, tone(1320, 0.6, 0.6, 5));
mixAt(ui, 12.2, tone(180, 0.7, 0.6, 5));
mixAt(ui, 19, tone(1568, 0.9, 0.5, 3));
const music = new Float32Array(N);
for (let bar = 0; bar < SECONDS / 2.5; bar++) for (const hz of [[220, 277, 330], [196, 247, 294], [175, 220, 262], [196, 247, 294]][bar % 4]) mixAt(music, bar * 2.5, tone(hz, 3.2, 0.2, 0.9));

// NCS masters run near -8 dBFS RMS: the stand-in pad is brought there.
const padRms = Math.sqrt(music.reduce((sum, v) => sum + v * v, 0) / N);
for (let i = 0; i < N; i++) music[i] *= 0.4 / padRms;
const levels = { musicVolume: 0.15, engineVolume: 0.25, playerEngineLevel: 0.8, hitVoices: VOICES.hitsDesktop };
const render = mixDown({ engines, hits: hitStem, ambient, ui, music }, hits, levels);

writeWav(`${OUT}/figure8-mix.wav`, [render.left, render.right]);
const from = Math.round(11.5 * SAMPLE_RATE);
const to = Math.round(14.5 * SAMPLE_RATE);
writeWav(`${OUT}/figure8-crash-window.wav`, [render.left.slice(from, to), render.right.slice(from, to)]);
for (const name of BUS_NAMES) writeWav(`${OUT}/bus-${name}.wav`, [render.buses[name]]);

const db = (x) => `${x.toFixed(1)}`;
const crash = [Math.round(11.9 * SAMPLE_RATE), Math.round(13 * SAMPLE_RATE)];
console.log(`hits asked ${hits.length}, admitted by the hit bus ${admitted.length} (voices ${VOICES.hitsDesktop})`);
console.log("bus (sliders: music 0.15, engines 0.25) | whole 20 s: peak / rms dBFS | crash window 11.9-13.0 s: peak / rms");
for (const name of BUS_NAMES) {
  const all = level(render.buses[name]);
  const win = level(render.buses[name], ...crash);
  console.log(`${name.padEnd(8)} | ${db(all.peakDb).padStart(6)} / ${db(all.rmsDb).padStart(6)} | ${db(win.peakDb).padStart(6)} / ${db(win.rmsDb).padStart(6)}`);
}
const master = level(render.left);
const masterCrash = level(render.left, ...crash);
console.log(`master L | ${db(master.peakDb).padStart(6)} / ${db(master.rmsDb).padStart(6)} | ${db(masterCrash.peakDb).padStart(6)} / ${db(masterCrash.rmsDb).padStart(6)}`);
console.log(`peak ahead of the -1 dBFS ceiling ${db(20 * Math.log10(render.preCeilingPeak))} dBFS; deepest crash duck ${Math.max(...duck).toFixed(2)}`);
console.log(`wrote ${OUT}`);
