import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { setGround } from "../world/ground.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { decodeShare } from "../hud/share-url.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

const FRAME = 1 / FRAME_HZ;
/** The owner's fleet link whose blue muscle car (the fourth) came out of a car-car contact with a 134 mm lump at its front wing. */
const OWNER_LINK = "#scene=fleet&cars=5&smin=10&smax=32&real=0.25&squash=0.32&buckle=0.45&seed=638849&deform=shape&loop=0&fx=high&car=muscle";
const BLUE = 3;
/** The contact's window (sim s): its engine pair rolled 25 degrees in the car's frame in 60 ms from 0.70 s. Later the body's own sink and roll (masses that hold their world height) read as lift too. */
const HIT_FROM_S = 0.7;
const HIT_TO_S = 0.9;
/** The frames that run takes (the engine's slow motion at the hit stretches them): a guard, not a bound. */
const MAX_FRAMES = 2000;
/** Most (m) either engine mount may stand over or under its rest in the car's frame: a block that rolls with its lift caps (+137.5, -110 mm) is a rolled casting. */
const ENGINE_LIFT_MAX = 0.1;

describe("given the owner's fleet link whose blue muscle car is hit by another at 0.70 s", () => {
  let engine: CrashEngine;
  let blue: DeformableCar;

  beforeAll(async () => {
    stubBrowser();
    engine = await bootEngine({ pacer: true });
    engine["applyShare"](decodeShare(OWNER_LINK), false);
    blue = engine["live"]()[BLUE]!;
  });

  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it(`when the contact plays out (${HIT_FROM_S}-${HIT_TO_S} s), then its two engine mounts never stood more than ${ENGINE_LIFT_MAX} m over or under their rest in its frame: the pair is one casting, and does not roll to the lift caps`, () => {
    const mounts = blue.deform.masses.filter((m) => m.name === "engineL" || m.name === "engineR");
    let worst = 0;
    let at = 0;
    let measured = 0;
    let last = engine.pace.total;
    for (let frame = 0; frame < MAX_FRAMES && engine["elapsedSim"] < HIT_TO_S; frame++) {
      engine.advance(FRAME, { frameDt: FRAME });
      if (engine.pace.total === last) continue;
      last = engine.pace.total;
      if (engine["elapsedSim"] < HIT_FROM_S) continue;
      measured++;
      for (const m of mounts) {
        const lift = Math.abs(m.local.y - m.rest.y);
        if (lift > worst) {
          worst = lift;
          at = engine["elapsedSim"];
        }
      }
    }
    expect(engine["elapsedSim"], "the run never reached the end of the hit window").toBeGreaterThanOrEqual(HIT_TO_S);
    expect(measured, "no step was measured inside the hit window").toBeGreaterThan(0);
    expect(worst, `an engine mount stood ${(worst * 1000).toFixed(1)} mm off its rest in the car's frame at ${at.toFixed(3)} s`).toBeLessThanOrEqual(ENGINE_LIFT_MAX);
  });
});
