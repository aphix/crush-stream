import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { setGround } from "../world/ground.ts";
import { planBlocks } from "../world/openworld/openworld-blocks.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, pressKey, runSeconds, stubBrowser } from "./engine-headless.test-util.ts";

const CLIMB_OUT_S = 0.9;
/** Seconds he lies after the knock, then holds a walking control to get up, and the longest he is given to stand again. */
const LIE_S = 2;
const GET_UP_LIMIT_S = 12;
/** The run about the park: keys re-chosen every burst (s) from a fixed sequence, for this long (sim s). */
const BURST_S = 0.4;
const RUN_S = 60;
const KEY_SETS: readonly (readonly string[])[] = [["KeyW"], ["KeyW", "ShiftLeft"], ["KeyW", "KeyA"], ["KeyW", "KeyD", "ShiftLeft"], ["KeyS"]];
const LCG_MUL = 1103515245;
const LCG_ADD = 12345;

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

describe("given the player out of his car in the open world's park", () => {
  it("when he is knocked down and gets up, then he stands again and no step of the dummies' world throws", () => {
    const lawn = planBlocks(layOutLots().geometry).playable.find((block) => block.park)!.lawn!;
    const car = engine["live"]()[0]!;
    car.spawnFacing((lawn.x0 + lawn.x1) / 2, (lawn.z0 + lawn.z1) / 2, 0, 0);
    car.group.visible = true;
    runSeconds(engine, 0.3);
    pressKey(engine, "Enter");
    runSeconds(engine, CLIMB_OUT_S);
    expect(engine["onFoot"].flow.phase, "he is out").toBe("onFoot");
    const walker = engine["ragdolls"].walker;
    runSeconds(engine, 1);
    walker.struck();
    runSeconds(engine, LIE_S);
    engine["keys"].add("KeyW");
    for (let t = 0; t < GET_UP_LIMIT_S && walker.state !== "stand"; t += BURST_S) runSeconds(engine, BURST_S);
    engine["keys"].clear();
    expect(walker.state, "he is up again").toBe("stand");
  });

  it("when he then runs about the park for a minute, then no step of the dummies' world throws", () => {
    const keys = engine["keys"];
    let pick = 1;
    for (let t = 0; t < RUN_S; t += BURST_S) {
      pick = (Math.imul(pick, LCG_MUL) + LCG_ADD) >>> 0;
      keys.clear();
      for (const code of KEY_SETS[(pick >>> 8) % KEY_SETS.length]!) keys.add(code);
      runSeconds(engine, BURST_S);
    }
    keys.clear();
    expect(engine["ragdolls"].walker.active, "he is still out").toBe(true);
  });
});
