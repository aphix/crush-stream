import { afterEach, describe, expect, it } from "vitest";
import { todoRow } from "../kernel/todo-row.test-util.ts";
import * as THREE from "three";
import { setGround } from "./ground.ts";
import { TRACKS } from "./tracks/index.ts";
import { parseTrack } from "./track-schema.ts";
import { Track } from "./track.ts";
import { FRAME, makeWorld, frame, type World } from "./race-world.test-util.ts";
import { makeCarFrame } from "../net/codec.ts";
import { carLayout } from "../net/car-pose.ts";
import { RESPAWN_REQUEST_DELAY } from "../match/session.ts";

/** How many parts are torn off the car, and how many wheels are off it. */
function lost(w: World): { parts: number; wheels: number; massActive: boolean } {
  const car = w.live()[0]!;
  const f = makeCarFrame(carLayout(car));
  car.readPartNetState(f.parts);
  return { parts: f.parts.flags.filter((x) => x & 1).length, wheels: f.parts.wheelLoose, massActive: car.deform.massActive };
}

/**
 * The player's car racing on the oval `seconds` in, with a mirror torn off and a hit taken. Flat out from the grid the car meets the
 * oval's first wall (a 40° glance) at 10.1 s, 38 m/s, closing 24.8 m/s.
 */
function damaged(seconds: number): { w: World; state: { acc: number } } {
  const w = makeWorld();
  const track = new Track(TRACKS.find((j) => parseTrack(j).id === "oval"));
  w.race.enter();
  w.race.command({ type: "quit" });
  w.race.command({ type: "options", options: { trackId: track.id, laps: 3, aiCount: 2, noReset: false, aggression: 0.3 } });
  w.race.command({ type: "start" });
  const state = { acc: 0 };
  w.seat.mode = "drive";
  w.seat.carIndex = 0;
  w.seat.intent.analogGas = true;
  for (let n = 0; n * FRAME < seconds; n++) {
    w.seat.intent.gas = w.race.hud().phase === "racing" ? 1 : 0;
    frame(w, state);
  }
  const car = w.live()[0]!;
  car.breakMirror(1, new THREE.Vector3(0, 0, 1));
  car.applyImpact(car.group.position.clone().addScaledVector(car.forward, 2), car.forward.clone().negate(), 6, 6);
  for (let n = 0; n < 30; n++) frame(w, state);
  return { w, state };
}

/** Hold the reset, then tap it: held keeps the damage and puts the car back at rest on the road, tapped repairs after the pause. */
function holdThenTap(seconds: number): void {
  const { w, state } = damaged(seconds);
  const before = lost(w);
  expect(before.parts, "a part is off").toBeGreaterThanOrEqual(1);
  expect(before.massActive, "the crash started").toBeTruthy();
  w.race.holdReset();
  for (let n = 0; n < 5; n++) frame(w, state);
  const held = lost(w);
  expect(held.parts, "the torn parts stay torn").toBe(before.parts);
  expect(held.wheels, "the wheels off stay off").toBe(before.wheels);
  expect(held.massActive, "the wreck state is kept").toBe(true);
  expect(w.live()[0]!.velocity.length(), `the car starts again from rest (${w.live()[0]!.velocity.length().toFixed(1)} m/s)`).toBeLessThan(3);
  expect(w.race.hud().you!.status).toBe("racing");
  w.race.requestRespawn();
  for (let n = 0; n < (RESPAWN_REQUEST_DELAY + 0.5) / FRAME; n++) frame(w, state);
  const whole = lost(w);
  expect(whole.parts, "a tap repairs").toBe(0);
  expect(whole.massActive).toBe(false);
}

describe("given the player's car in a respawn race with a mirror torn off and a crash taken", () => {
  afterEach(() => setGround(null));
  it("when the reset is held, then the car is back on the road at once at rest with the torn mirror still gone and the wreck state kept, and when it is tapped, then it comes back whole after the pause", () => {
    // 8 s in the car is on the straight, 2 s short of the wall: the crash is the one the test takes itself.
    holdThenTap(8);
  });

  todoRow("when the car has run flat out into the oval's first wall and the reset is held, then it is back on the road at once with the wreck state kept", "after the plan: calibrate the crush feed's reach to the cage's corner: the oval's first wall glance packs the engine 0.162 m, 12 mm past the 0.15 m kill, so the driver is thrown out and the run reads respawning (main 0.053 m, Stage 4 items 1-4 (rigs and strikers) alone 0.107 m, Stage 3 alone 0.025 m); the feed's reach was calibrated on the hulls' contact point, now the cage's corner", () => {
    holdThenTap(12);
  });
});
