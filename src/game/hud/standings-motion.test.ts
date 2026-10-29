import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { RaceHudRow } from "../match/types.ts";
import { GREEN_WINDOW_SECONDS, nextFlashUntil, PASS_FLASH_MS, STANDING_LI, standingsVisible, withLeavers, type StandingsVisibility } from "./standings-motion.ts";

const row = (id: number, place: number): RaceHudRow => ({ id, name: `car ${id}`, place, lap: 1, status: "racing", gap: null, bestLap: null, you: false, watched: false });

describe("given the classes a standings row carries", () => {
  it("then it slides (a transform transition), fades through opacity (a transition, not a keyframe a moved row would restart), and fades while data-fading", () => {
    assert.match(STANDING_LI, /transition-\[transform,opacity\]/);
    assert.match(STANDING_LI, /data-\[fading\]:opacity-0/);
    assert.doesNotMatch(STANDING_LI, /animate-/);
  });
});

describe("given a car that left the standings from P2 of four", () => {
  it("when the rest stand P1 to P3, then it is put back at P2, flagged leaving", () => {
    const slots = withLeavers([row(1, 1), row(3, 2), row(4, 3)], [row(2, 2)]);
    assert.deepEqual(
      slots.map((s) => [s.row.id, s.leaving]),
      [[1, false], [2, true], [3, false], [4, false]],
    );
  });
  it("when it is back in the standings, then it is not a leaver", () => {
    const slots = withLeavers([row(1, 1), row(2, 2)], [row(2, 2)]);
    assert.deepEqual(
      slots.map((s) => s.leaving),
      [false, false],
    );
  });
});

const NOW = 100_000;
const racing: StandingsVisibility = { spectating: false, phase: "racing", raceTime: 60, reel: false, flashUntil: 0, now: NOW };

describe("given a viewer whose place may change", () => {
  const cases = [
    { it: "when they pass a car (P5 to P4), then the flash runs for the pass window from now", previous: 5, place: 4, flashUntil: 0, expected: NOW + PASS_FLASH_MS },
    { it: "when a car passes them (P4 to P5), then the flash runs for the pass window from now", previous: 4, place: 5, flashUntil: 0, expected: NOW + PASS_FLASH_MS },
    { it: "when they pass again inside a running flash, then the window restarts from now", previous: 4, place: 3, flashUntil: NOW + 500, expected: NOW + PASS_FLASH_MS },
    { it: "when the place is the same, then the flash is left as it was", previous: 4, place: 4, flashUntil: NOW + 500, expected: NOW + 500 },
    { it: "when it is the first sample (no previous place), then there is no flash", previous: null, place: 4, flashUntil: 0, expected: 0 },
    { it: "when they have no place now, then the flash is left as it was", previous: 4, place: null, flashUntil: 0, expected: 0 },
  ];
  for (const { it: name, previous, place, flashUntil, expected } of cases) {
    it(name, () => {
      assert.equal(nextFlashUntil(previous, place, NOW, flashUntil), expected);
    });
  }
});

describe("given the phone standings list", () => {
  const cases = [
    { it: "when the viewer is driving mid-race with no recent pass, then it is hidden", state: racing, expected: false },
    { it: "when spectating, then it is always up", state: { ...racing, spectating: true }, expected: true },
    { it: "when the results reel plays, then it is up", state: { ...racing, phase: "finished" as const, reel: true }, expected: true },
    { it: "when the race is over, then it is up", state: { ...racing, phase: "finished" as const }, expected: true },
    { it: "when the field waits on the grid, then it is up", state: { ...racing, phase: "grid" as const, raceTime: -5 }, expected: true },
    { it: "when the countdown runs, then it is up", state: { ...racing, phase: "countdown" as const, raceTime: -2 }, expected: true },
    { it: "when green was just shown, then it is up", state: { ...racing, raceTime: GREEN_WINDOW_SECONDS - 0.1 }, expected: true },
    { it: "when the green window has ended, then it is hidden", state: { ...racing, raceTime: GREEN_WINDOW_SECONDS }, expected: false },
    { it: "when a pass flash is still running, then it is up", state: { ...racing, flashUntil: NOW + 1 }, expected: true },
    { it: "when the pass flash ends exactly now, then it is hidden", state: { ...racing, flashUntil: NOW }, expected: false },
    { it: "when there is no race phase, then it is hidden even while spectating", state: { ...racing, phase: null, spectating: true }, expected: false },
  ];
  for (const { it: name, state, expected } of cases) {
    it(name, () => {
      assert.equal(standingsVisible(state), expected);
    });
  }
});
