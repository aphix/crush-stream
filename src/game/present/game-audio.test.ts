import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { BUS, DUCK, duckGain, engineBusGain, musicGain, VOICES } from "./audio-mix.ts";
import { GameAudio, type AmbientScene, type UiName } from "./game-audio.ts";
import type { HitEvent } from "./hit-sound.ts";

/** A player standing in for `MusicPlayer`: counts what the audio asks of it. */
class PlayerStub {
  plays = 0;
  pauses = 0;
  play(): void {
    this.plays++;
  }
  pause(): void {
    this.pauses++;
  }
}

/** A bus that keeps the last target its gain was sent to. */
function bus() {
  const sent = { last: NaN, count: 0 };
  return { sent, gain: { setTargetAtTime: (value: number) => void ((sent.last = value), sent.count++) } };
}

const SCENE: AmbientScene = { place: "track", hour: 13, speed: 0, indoors: false };
const FRAME = 1 / FRAME_HZ;

/** The audio as `unlock` leaves it, audio on, its voices swapped for stubs that count what they are asked. */
function unlocked(desktop = true) {
  (globalThis as { document?: unknown }).document ??= { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  const camera = new THREE.PerspectiveCamera();
  const audio = new GameAudio(camera, desktop);
  const player = new PlayerStub();
  const now = { t: 0 };
  const buses = { music: bus(), engine: bus(), ambient: bus() };
  const heard: { e: HitEvent; at: number[] }[] = [];
  const ui: UiName[] = [];
  const motor = { update: () => false, playerLevel: 0, releaseVoices() {}, dispose() {} };
  Object.assign(audio, {
    context: { get currentTime() { return now.t; } },
    musicBus: buses.music,
    engineBus: buses.engine,
    ambientBus: buses.ambient,
    slowmoFilter: { frequency: { setTargetAtTime() {} } },
    music: player,
    motor,
    hits: { hit: (e: HitEvent, lx: number, ly: number, lz: number) => void heard.push({ e: { ...e }, at: [lx, ly, lz] }), scrape() {}, frame() {}, dispose() {} },
    ambient: { set() {}, frame() {}, dispose() {} },
    ui: { play: (name: UiName) => void ui.push(name), dispose() {} },
    on: true,
  });
  return { audio, player, now, buses, heard, ui, camera };
}

/** A hit of `impulse` at the listener (the camera stands at the origin), or `away` m along x. */
const hit = (impulse: number, away = 0): HitEvent => ({ impulse, x: away, y: 0, z: 0, a: "steel", b: "steel" });

describe("given the audio on, with a music player", () => {
  const testCases = [
    { it: "when the music slider goes to 0, then the player pauses (no streaming, the playlist holds its place)", from: 0.4, to: 0, expectedPlays: 0, expectedPauses: 1 },
    { it: "when the music slider comes back up from 0, then the player plays again", from: 0, to: 0.4, expectedPlays: 1, expectedPauses: 0 },
  ] as const;
  for (const c of testCases) {
    it(c.it, () => {
      const { audio, player } = unlocked();
      Object.assign(audio, { musicLevel: c.from });
      audio.setVolumes(c.to, 0.25);
      expect(player.plays, "plays").toBe(c.expectedPlays);
      expect(player.pauses, "pauses").toBe(c.expectedPauses);
    });
  }
});

describe("given the volume sliders", () => {
  it("when they move, then the music and engine buses follow their own slider and the ambient bus does not move", () => {
    const { audio, buses } = unlocked();
    audio.setVolumes(0.4, 0.5);
    expect(buses.music.sent.last).toBe(musicGain(0.4, 1, 1));
    expect(buses.engine.sent.last).toBe(engineBusGain(0.5));
    expect(buses.ambient.sent.count, "ambient untouched").toBe(0);
    audio.setVolumes(0.2, 1);
    expect(buses.music.sent.last, "music halves").toBe(musicGain(0.2, 1, 1));
    expect(buses.engine.sent.last, "engines up").toBe(engineBusGain(1));
  });
});

describe("given a big hit, then a quiet stretch", () => {
  it("when a 40 m/s hit lands, then the music is pulled 6 dB and the ambience 4.5 dB at once, and both are back to full within 4 s", () => {
    const { audio, buses } = unlocked();
    audio.setVolumes(0.4, 0.5);
    audio.hit(hit(40));
    expect(buses.music.sent.last, "music ducked").toBeCloseTo(musicGain(0.4, 1, duckGain(1, DUCK.musicDb)), 9);
    expect(buses.ambient.sent.last, "ambience ducked").toBeCloseTo(BUS.ambient * duckGain(1, DUCK.ambientDb), 9);
    for (let f = 0; f < 240; f++) audio.frame(FRAME, [], null, 1, true, SCENE);
    expect(buses.music.sent.last, "music back").toBeCloseTo(musicGain(0.4, 1, 1), 9);
    expect(buses.ambient.sent.last, "ambience back").toBeCloseTo(BUS.ambient, 9);
  });

  it("when a 10 m/s hit lands, then the duck is shallower than a 40 m/s one's", () => {
    const small = unlocked();
    small.audio.hit(hit(10));
    const big = unlocked();
    big.audio.hit(hit(40));
    expect(small.buses.ambient.sent.last).toBeGreaterThan(big.buses.ambient.sent.last);
  });

  it("when a touch of 2 m/s lands, then it is heard and ducks nothing", () => {
    const { audio, buses, heard } = unlocked();
    audio.hit(hit(2));
    expect(heard.length).toBe(1);
    expect(buses.ambient.sent.last).toBe(BUS.ambient);
  });

  it("when a 40 m/s hit lands 500 m away, then it is dropped: not played, no duck", () => {
    const { audio, buses, heard } = unlocked();
    audio.hit(hit(40, 500));
    expect(heard.length).toBe(0);
    expect(buses.ambient.sent.count).toBe(0);
  });

  it("when the same 40 m/s hit lands 60 m away, then it ducks by what is heard there: shallower than beside the listener", () => {
    const near = unlocked();
    near.audio.hit(hit(40));
    const far = unlocked();
    far.audio.hit(hit(40, 60));
    expect(far.heard.length, "still played").toBe(1);
    expect(far.buses.ambient.sent.last).toBeGreaterThan(near.buses.ambient.sent.last);
  });

  it("when the game pauses with no engine voice ticking, then the ambient bed dims at once, and comes back when it runs again", () => {
    const { audio, buses } = unlocked();
    audio.frame(FRAME, [], null, 1, false, SCENE);
    expect(buses.ambient.sent.last).toBeCloseTo(BUS.ambient * 0.35, 9);
    audio.frame(FRAME, [], null, 1, true, SCENE);
    expect(buses.ambient.sent.last).toBeCloseTo(BUS.ambient, 9);
  });
});

describe("given the hit bus's voice budget", () => {
  it("when twelve equal hits land in a tenth of a second, then ten reach the hit voices on a desktop and six on a phone; a much harder one is let in", () => {
    const desktop = unlocked(true);
    for (let k = 0; k < 12; k++) desktop.audio.hit(hit(10));
    expect(desktop.heard.length).toBe(VOICES.hitsDesktop);
    desktop.audio.hit(hit(40));
    expect(desktop.heard.length, "a harder hit displaces the weakest").toBe(VOICES.hitsDesktop + 1);
    const phone = unlocked(false);
    for (let k = 0; k < 12; k++) phone.audio.hit(hit(10));
    expect(phone.heard.length).toBe(VOICES.hitsPhone);
  });

  it("when they have ended, then the budget is free again", () => {
    const { audio, heard, now } = unlocked(false);
    for (let k = 0; k < 8; k++) audio.hit(hit(10));
    now.t = 2;
    for (let k = 0; k < 8; k++) audio.hit(hit(10));
    expect(heard.length).toBe(2 * VOICES.hitsPhone);
  });

  it("when a hit is heard, then it is given the listener's place", () => {
    const { audio, heard, camera } = unlocked();
    camera.position.set(7, 8, 9);
    camera.updateMatrixWorld();
    audio.hit(hit(10));
    expect(heard[0]!.at).toEqual([7, 8, 9]);
  });
});

describe("given the UI bus", () => {
  it("when three cues come at once, then two sound; a third a second later does", () => {
    const { audio, ui, now } = unlocked();
    audio.playUi("select");
    audio.playUi("confirm");
    audio.playUi("back");
    expect(ui).toEqual(["select", "confirm"]);
    now.t = 1;
    audio.playUi("back");
    expect(ui).toEqual(["select", "confirm", "back"]);
  });
});
