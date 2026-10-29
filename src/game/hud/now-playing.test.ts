import { describe, expect, it } from "vitest";
import { nowPlayingCorner, type NowPlayingContext } from "./now-playing.ts";

const IDLE: NowPlayingContext = { raceLive: false, menuOpen: false, reel: false, narrow: false };

describe("given what is on screen when a song starts", () => {
  const testCases = [
    { name: "the results reel", context: { ...IDLE, raceLive: true, reel: true }, expected: "top-center" },
    { name: "the reel with a menu open (rule 1 wins)", context: { ...IDLE, raceLive: true, reel: true, menuOpen: true }, expected: "top-center" },
    { name: "the reel on a phone", context: { ...IDLE, raceLive: true, reel: true, narrow: true }, expected: "top-center" },
    { name: "a race sheet on a wide screen", context: { ...IDLE, raceLive: true, menuOpen: true }, expected: "bottom-left" },
    { name: "a race sheet on a narrow screen", context: { ...IDLE, raceLive: true, menuOpen: true, narrow: true }, expected: "top-center" },
    { name: "racing on a wide screen", context: { ...IDLE, raceLive: true }, expected: "top-center" },
    { name: "racing on a phone", context: { ...IDLE, raceLive: true, narrow: true }, expected: "top-center" },
    { name: "the sandbox on a wide screen", context: IDLE, expected: "top-center" },
    { name: "the sandbox on a phone", context: { ...IDLE, narrow: true }, expected: "top-right" },
  ];
  for (const c of testCases) {
    it(`when ${c.name} shows, then the toast takes ${c.expected}`, () => {
      expect(nowPlayingCorner(c.context)).toBe(c.expected);
    });
  }
});
