import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { detAtan2, detCos, detSin } from "../kernel/physics-core.js";
import { driverLook } from "../present/driver-look.ts";
import { WALK_SPEED } from "../present/walker-locomotion.ts";
import { activeGround, setGround } from "../world/ground.ts";
import { DOOR, homeFrontages, STOOP } from "../world/openworld/openworld-facade-solids.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, runSeconds, stubBrowser } from "./engine-headless.test-util.ts";

/** He starts this far (m) out from the facade, on the door's line: past the stoop's foot, on the sidewalk. */
const START_OUT_M = STOOP.run + 1.4;
/** The walk to the door: the stoop is 3 m of stairs and the pace over steps is 0.5 m/s. */
const WALK_S = 14;
/** He stands a moment on the landing before he is read (s). */
const SETTLE_S = 1;
/** A standing torso's centre is at least this high (m) over the floor. */
const STANDING_MIN_M = 0.95;
/** The door's landing is this deep (m) at the wall: he ends within it, and not past the facade. */
const WALL_SLACK_M = 0.2;

let engine: CrashEngine;

beforeAll(async () => {
  stubBrowser();
  globalThis.location.hash = "#scene=openworld&seed=beef";
  engine = await bootEngine({ pacer: true });
  engine.autoSlomo = false;
  await engine["ragdolls"].preload();
  runSeconds(engine, 0.5);
});

afterAll(() => {
  engine.dispose();
  setGround(null);
});

describe("given a rowhome of the open world's course on the real engine", () => {
  it("when the player on foot walks at its door from the sidewalk, then he climbs the stoop's treads and stands on the landing at the door's sill", () => {
    const lots = layOutLots();
    const frontage = homeFrontages(lots.places.slice(0, lots.backdropStart))[0]!;
    const cos = detCos(frontage.yaw);
    const sin = detSin(frontage.yaw);
    const outOf = (x: number, z: number) => (x - frontage.x) * cos - (z - frontage.z) * sin;
    const start = new THREE.Vector3(frontage.x + cos * START_OUT_M + sin * DOOR.across, 0, frontage.z - sin * START_OUT_M + cos * DOOR.across);
    start.y = activeGround().heightAt(start.x, start.z);
    const toward = detAtan2(-cos, sin);
    const ragdolls = engine["ragdolls"];
    expect(ragdolls.startWalker(start, toward, { cop: false, look: driverLook(0, 0) }), "he is out").toBeGreaterThanOrEqual(0);
    runSeconds(engine, 1);
    ragdolls.walker.heading = toward;
    const here = new THREE.Vector3();
    for (let t = 0; t < WALK_S; t += 0.5) {
      ragdolls.walkerTorso(here);
      // The door opens to whoever stands at it, and a walker who goes on is in its doorway: he is stopped as he reaches the landing, which is what the row is about.
      ragdolls.walker.command = outOf(here.x, here.z) < STOOP.landing + WALL_SLACK_M ? 0 : WALK_SPEED;
      ragdolls.walker.ask();
      runSeconds(engine, 0.5);
    }
    runSeconds(engine, SETTLE_S);
    const end = new THREE.Vector3();
    expect(ragdolls.walkerTorso(end), "he is still out").toBe(true);
    expect(ragdolls.walker.state, "on his feet").toBe("stand");
    expect(outOf(end.x, end.z), `on the landing, out ${outOf(end.x, end.z).toFixed(2)} m from the facade`).toBeLessThan(STOOP.landing + WALL_SLACK_M);
    expect(end.y - start.y - STOOP.sill, `standing over the sill: ${(end.y - start.y - STOOP.sill).toFixed(2)} m`).toBeGreaterThan(STANDING_MIN_M);
  });
});
