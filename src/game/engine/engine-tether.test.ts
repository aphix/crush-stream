import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import "../kernel/rapier-node.test-util.ts";
import { setGround } from "../world/ground.ts";
import { WORLD } from "../contact/tether.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, pressKey, runSeconds, stubBrowser } from "./engine-headless.test-util.ts";
import { TETHER_KEYS } from "./engine-keys.ts";

const FRAME = 1 / FRAME_HZ;
const PLAYER = 0;
const NEAR_CAR = 1;

describe("given the real engine in the fleet with the player at the wheel of car 0, facing +z, and car 1 ahead of it", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  const tethers = () => engine["world"].tethers;
  /** The player's car at (0, -10) facing +z at the wheel, the other at (0, z), both at rest and drawn, the camera and the drawn poses settled, then a frame of `seconds`. */
  const stage = (otherZ: number): void => {
    engine["setCarCount"](2);
    engine["fadeScenes"] = false;
    engine["seat"].focus(PLAYER);
    engine["seat"].mode = "drive";
    for (const [i, z] of [-10, otherZ].entries()) {
      const car = engine["live"]()[i]!;
      car.spawnFacing(0, z, 0, 0);
      car.group.visible = true;
    }
    engine.autoSlomo = false;
    tethers().clear();
    engine.tether.cut();
    runSeconds(engine, 1);
    engine["scene"].updateMatrixWorld(true);
  };
  const press = (code: string): void => {
    pressKey(engine, code);
    engine["keys"].delete(code);
    engine.advance(FRAME, { frameDt: FRAME });
    engine["scene"].updateMatrixWorld(true);
  };
  before(async () => {
    stubBrowser();
    engine = await bootEngine({ pacer: true });
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  it("when fire is pressed with the car 30 m ahead in the sight line, then a cable ties that car to the player's", () => {
    stage(20);
    press(TETHER_KEYS.fire);
    assert.equal(tethers().count, 1, "cables out");
    assert.equal(tethers().endCar(0, 0), NEAR_CAR, "the first end is the target");
    assert.equal(tethers().endCar(0, 1), PLAYER, "the second end is the player's car");
    assert.ok(tethers().length(0) > 25 && tethers().length(0) < 35, `cable ${tethers().length(0).toFixed(1)} m`);
  });

  it("when fire is pressed again at the ground ahead, then the player's end moves to the ground point and the cable runs from the car to it", () => {
    stage(20);
    press(TETHER_KEYS.fire);
    engine["live"]()[NEAR_CAR]!.group.position.x = 40;
    press(TETHER_KEYS.fire);
    assert.equal(tethers().count, 1, "cables out");
    assert.equal(tethers().endCar(0, 0), NEAR_CAR, "the first end stays on the target");
    assert.equal(tethers().endCar(0, 1), WORLD, "the second end is a world point");
  });

  it("when the target is out of reach and fire is pressed, then no cable is made", () => {
    stage(45);
    engine["live"]()[PLAYER]!.group.position.z = -45;
    runSeconds(engine, 1);
    engine["scene"].updateMatrixWorld(true);
    press(TETHER_KEYS.fire);
    assert.equal(tethers().count, 0, "cables out");
  });

  it("when a cable is out and the cut key is pressed, then no cable is left", () => {
    stage(20);
    press(TETHER_KEYS.fire);
    assert.equal(tethers().count, 1, "cables out before the cut");
    press(TETHER_KEYS.cut);
    assert.equal(tethers().count, 0, "cables out after the cut");
  });

  it("when the retract key is held, then the cables reel, and when it is let go, they stop", () => {
    stage(20);
    press(TETHER_KEYS.fire);
    engine["keys"].add(TETHER_KEYS.retract);
    engine.advance(FRAME, { frameDt: FRAME });
    assert.equal(tethers().reeling, true, "reeling while held");
    engine["keys"].delete(TETHER_KEYS.retract);
    engine.advance(FRAME, { frameDt: FRAME });
    assert.equal(tethers().reeling, false, "reeling after the release");
  });
});
