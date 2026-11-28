import { describe, expect, it } from "vitest";
import { aftermathDifference, freshCar, LIVES, respawn, stateDifference } from "./respawn-identity.test-util.ts";
import type { VehicleClassId } from "./vehicle-classes.ts";

/**
 * A car the game puts back (`spawnFacing`: a race or derby respawn, the disc, the recover key) is a new car: whatever it held of the life
 * before, the numbers a keyframe stores and the sim reads, are the ones a car built new and placed the same holds.
 */
const CLASSES: readonly VehicleClassId[] = ["sedan", "monster"];

for (const cls of CLASSES) {
  describe(`given a ${cls} that lived a life and the game's respawn, and a ${cls} built new and placed the same`, () => {
    for (const life of LIVES) {
      it(`when it was ${life.name} and is put back, then every number it holds is the new car's, before either steps`, () => {
        const back = respawn(life.live(cls));
        expect(stateDifference(back, freshCar(cls)), "first differing number").toBe("");
      });

      it(`when it was ${life.name}, is put back with a door ajar, spun and hit on the nose before it steps, then it holds the new car's numbers after every stretch`, () => {
        const back = respawn(life.live(cls));
        expect(aftermathDifference(back, freshCar(cls)), "first differing number").toBe("");
      });
    }
  });
}
