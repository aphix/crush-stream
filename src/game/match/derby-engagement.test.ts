import { describe, expect, it } from "vitest";
import { DerbyBrain, DEFAULT_DERBY_AGGRESSION, DERBY_RULES, type AiCar } from "../ai/derby-ai.ts";
import { fieldAggression } from "../ai/ai-aggression.ts";
import { makeCar, runWall } from "../contact/crash-scenarios.test-util.ts";
import { aiCar, decide } from "../vehicle/test-support.ts";
import { snapshotAiCar } from "./derby.ts";

/**
 * What keeps AI cars hitting each other: a driver goes in for a hit while its mood (`mood`: its roll, both cars' damage as `snapshotAiCar` reads them) is above 0 and keeps clear while it is below,
 * until its hit clock runs low (`due`, a share of `DERBY_RULES.hitClock` that shrinks with its roll). So a car engaged at the start stays engaged as long as the damage it reads stays small, and one the damage
 * has quieted comes back once the clock runs. The 20 s six-car derby of `derby-matches.ai-long-run.ts` reads 14 to 17 accepted hits across correct variants of the sim, so it cannot pin this; these rows do.
 */

/** The roll of the first derby's (seed 1) second driver: the one of the long-run's seed-7 match that quieted when a squeezed wreck's set ratcheted. */
const ROLL = fieldAggression(DEFAULT_DERBY_AGGRESSION, 1, 1);
/** The hardest wall a car is hit at here (km/h), tail first: a fresh car's rear then reads half its 0.28 spent as damage. */
const WALL_KPH = 80;
/** A tail crushed to 0.91 spent (damage 0.46): what a squeezed wreck's ratcheting set read, far past a fresh car's worst. */
const RATCHET_TAIL = { rear: 0.91, damage: 0.455 } as const;

/** The driver at the origin (the damage read from `me`), a parked equal rival 8 m behind its tail and two more across the bowl: it decides for the first time at hit-clock reading `idle`. */
function tacticAt(me: Partial<AiCar>, idle: number): string {
  const brain = new DerbyBrain();
  brain.setAggression(0, ROLL);
  const cars = [
    aiCar(0, { vz: 0, idle, ...me }),
    aiCar(1, { z: -8, vz: 0 }),
    aiCar(2, { x: 12, z: 6, vz: 0 }),
    aiCar(3, { x: -12, z: 6, vz: 0 }),
  ];
  decide(brain, cars[0]!, cars);
  return brain.tacticOf(0);
}

describe("given a derby driver on its roll in the first derby, an equal parked rival 8 m behind it and two more across the bowl", () => {
  it(`when its tail has taken a ${WALL_KPH} km/h wall (the hardest a fresh car's hit gives it), then it still goes in for a hit`, () => {
    const car = makeCar("shape", 0.4, 0.45);
    runWall(WALL_KPH, 1, "rear", { car });
    const read = snapshotAiCar(aiCar(0), 0, car, car.deform.drivetrainAlive);
    expect(read.damage, `the wall left the tail reading damage ${read.damage.toFixed(3)}: the row proves nothing`).toBeGreaterThan(0.1);
    expect(tacticAt({ front: read.front, rear: read.rear, damage: read.damage }, 0), `a driver with damage ${read.damage.toFixed(3)} kept clear`).not.toBe("layback");
  });

  it("when its tail is crushed to 0.91 spent, then it keeps clear of the equal rival until its hit clock has run down to the share its roll sets, and then goes in", () => {
    const due = DERBY_RULES.hitClock * (0.5 - 0.3 * ROLL);
    expect(tacticAt(RATCHET_TAIL, 0), "it started in").toBe("layback");
    expect(tacticAt(RATCHET_TAIL, due - 1), "it came back before its clock ran").toBe("layback");
    expect(tacticAt(RATCHET_TAIL, due + 1), "it kept clear after its clock ran").not.toBe("layback");
  });
});
