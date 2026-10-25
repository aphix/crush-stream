import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { GameAudio } from "./game-audio.ts";

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

const bus = () => ({ gain: { value: 0, setTargetAtTime() {} } });

/** The audio as `unlock` leaves it, audio on, its player swapped for the stub. */
function unlocked(): { audio: GameAudio; player: PlayerStub } {
  (globalThis as { document?: unknown }).document ??= { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  const audio = new GameAudio(new THREE.PerspectiveCamera(), true);
  const player = new PlayerStub();
  Object.assign(audio as unknown as Record<string, unknown>, { context: { currentTime: 0 }, musicBus: bus(), engineBus: bus(), music: player, on: true });
  return { audio, player };
}

describe("given the audio on, with a music player", () => {
  const testCases = [
    { it: "when the music slider goes to 0, then the player pauses (no streaming, the playlist holds its place)", from: 0.4, to: 0, expectedPlays: 0, expectedPauses: 1 },
    { it: "when the music slider comes back up from 0, then the player plays again", from: 0, to: 0.4, expectedPlays: 1, expectedPauses: 0 },
  ] as const;
  for (const c of testCases) {
    it(c.it, () => {
      const { audio, player } = unlocked();
      (audio as unknown as { musicLevel: number }).musicLevel = c.from;
      audio.setVolumes(c.to, 0.25);
      assert.equal(player.plays, c.expectedPlays, "plays");
      assert.equal(player.pauses, c.expectedPauses, "pauses");
    });
  }
});
