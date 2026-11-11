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
      // mutation: sed -i '/^  resetVisual/,/^  }$/s/^    this.invYaw = 0;$/    \/\/ invYaw kept/' src/game/vehicle/car.ts  (the wrecks: the yaw inertia of the last wreck step kept)
      // mutation: sed -i 's/^    if (this.cageRig?.cage.reset()) this.cageChanged = true;$/    \/\/ cage kept/' src/game/vehicle/car.ts  (the wrecks: the crushed cage kept until the next refit)
      // mutation: sed -i 's/^    this.last.fill(0);$/    \/\/ last kept/' src/game/vehicle/car-cage.ts  (the wrecks: the last fit's inputs kept in the solver state)
      // mutation: sed -i 's/^    this.motion.fill(0);$/    this.sampleMotion();/' src/game/vehicle/car-parts.ts  (the moving cars: the velocity they had kept as the door motion sample)
      // mutation: sed -i 's/^    this.swingDrive.fill(0);$/    \/\/ swingDrive kept/' src/game/vehicle/car-parts.ts  (the car with a door loose: the door's drive kept)
      it(`when it was ${life.name} and is put back, then every number it holds is the new car's, before either steps`, () => {
        const back = respawn(life.live(cls));
        expect(stateDifference(back, freshCar(cls)), "first differing number").toBe("");
      });

      // mutation: sed -i '/^  resetVisual/,/^  }$/s/^    this.invYaw = 0;$/    \/\/ invYaw kept/' src/game/vehicle/car.ts  (the wrecks: the first wreck step turns the spin by the stale inertia, 0.9998 of it for a sedan)
      it(`when it was ${life.name}, is put back with a door ajar, spun and hit on the nose before it steps, then it holds the new car's numbers after every stretch`, () => {
        const back = respawn(life.live(cls));
        expect(aftermathDifference(back, freshCar(cls)), "first differing number").toBe("");
      });
    }
  });
}
