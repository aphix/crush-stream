import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { FRAME, frame, makeWorld, type World } from "./race-world.test-util.ts";
import { TRACK_ID } from "./constants.ts";
import { leaveSurvival } from "./survival-run.test-util.ts";
import { Track } from "./track.ts";
import { TRACKS } from "./tracks/index.ts";
import { placeProps } from "./placements.ts";
import { PREFABS } from "./catalog.ts";

/**
 * The National Mall's WWII Memorial basin is the round basin prefab stretched to 320 x 96 m (an ellipse, 160 x 48 m half axes). Its solid was a circle of 160 m (the larger scale), so a 0.5 m wall stood
 * 112 m past the drawn edge on the north and south sides: an owner\u0027s survival run ended at (-1152.6, 1.5), 72 m from the drawn basin, on empty road (receipt Q12Y-5EVK).
 */
const mall = new Track(TRACKS.find((j) => new Track(j).id === TRACK_ID.nationalMall)!);
const basin = placeProps(mall).find((p) => p.prefab === "basin" && p.sx !== p.sz)!;
/** The drawn basin\u0027s half axes (m): the prefab\u0027s radius at the placement\u0027s scales. */
const SEMI_X = PREFABS.basin.size[0] * 0.5 * basin.sx;
const SEMI_Z = PREFABS.basin.size[2] * 0.5 * basin.sz;
/** The owner\u0027s hit, and where the drive starts west of it on the same line (m). */
const HIT_X = -1152.6;
const HIT_Z = 1.48;
const START_X = HIT_X - 12;
const SPEED = 30;
const PASS_X = HIT_X + 3;
/** A drive into the drawn basin edge starts this far (m) short of it. */
const RUN_UP = 24;
const SECONDS = 4;

function mallWorld(): World {
  const w = makeWorld();
  w.race.reseed(1);
  w.race.enter(true, false, true);
  w.race.command({ type: "survivalCourse", id: TRACK_ID.nationalMall });
  w.race.command({ type: "start" });
  const state = { acc: 0 };
  for (let n = 0; n * FRAME < 8 && w.race.phase !== "racing"; n++) frame(w, state);
  for (let i = 1; i < w.live().length; i++) w.cars[i]!.group.visible = false;
  return w;
}

/** The courses\u0027 contact on car 0 over the drive: how far the course changed its speed, the most it did in one step, and where it ended. */
function drive(w: World, x: number, z: number, yaw: number, seconds: number): { crashed: boolean; x: number; z: number; shove: number } {
  const car = w.cars[0]!;
  car.spawnFacing(x, z, yaw, SPEED);
  const collide = w.step.collide!;
  let shove = 0;
  w.step.collide = (c, i, h) => {
    const before = c.velocity.clone();
    collide(c, i, h);
    if (i === 0) shove = Math.max(shove, c.velocity.clone().sub(before).length());
  };
  const state = { acc: 0 };
  for (let n = 0; n * FRAME < seconds; n++) frame(w, state);
  return { crashed: car.crashed, x: car.group.position.x, z: car.group.position.z, shove };
}

describe("given the National Mall's basin, stretched to 320 x 96 m", () => {
  it("when a car crosses the owner's hit point (-1152.6, 1.48) at 30 m/s, 72 m from the drawn basin, then the course touches nothing of it", () => {
    const w = mallWorld();
    try {
      const out = drive(w, START_X, HIT_Z, Math.PI / 2, 1);
      assert.ok(out.x > PASS_X, `the car stopped at x ${out.x.toFixed(1)}, short of ${PASS_X}`);
      assert.ok(!out.crashed, "the car crashed on open road");
      assert.ok(out.shove < 0.2, `the course shoved the car ${out.shove.toFixed(2)} m/s in one step`);
    } finally {
      leaveSurvival(w);
    }
  });

  it("when a car drives at 30 m/s into the drawn basin's edge from the south, then it stops short of it", () => {
    const w = mallWorld();
    try {
      const edge = basin.z - SEMI_Z;
      const out = drive(w, basin.x, edge - RUN_UP, 0, SECONDS);
      assert.ok(out.shove > 0.5, `the drawn edge at z ${edge.toFixed(1)} touched the car by only ${out.shove.toFixed(2)} m/s`);
      assert.ok(out.z < edge + 1, `the car got to z ${out.z.toFixed(1)}, past the drawn edge at ${edge.toFixed(1)}`);
    } finally {
      leaveSurvival(w);
    }
  });

  it("when the basin's ellipse is read, then it is 320 m across the Mall and 96 m deep, so the rows above stand where they were measured", () => {
    assert.ok(Math.abs(SEMI_X - 160) < 1 && Math.abs(SEMI_Z - 48) < 1, `half axes ${SEMI_X.toFixed(1)} x ${SEMI_Z.toFixed(1)}`);
  });
});
