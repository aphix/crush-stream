import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../world/placements.ts";
import { LOOK } from "./civilian-crowd-constants.ts";
import { CROWD_RESIDENTS, CROWD_SEED, newCrowd, stepUntilShown } from "./civilian-crowd.test-util.ts";
import { buildFixtureMap } from "./civilian-graph.test-util.ts";
import { residentNeuroticism, neuroticismOf } from "./civilian-temperament.ts";
import { RESIDENT_INT_STRIDE } from "./civilian-constants.ts";
import { lookOf } from "./civilian-look-word.ts";

const LOOKS = 4000;
const TAIL = 0.5;

/** Look words as the crowd makes them: a who-hash of 29 bits, the woman bit, the species bits (person). */
function looks(): number[] {
  const draw = mulberry32(CROWD_SEED);
  return Array.from({ length: LOOKS }, () => ((Math.floor(draw() * (LOOK.hashMask + 1)) & LOOK.hashMask) | (draw() < 0.5 ? 1 << LOOK.womanShift : 0)) >>> 0);
}

describe("given four thousand look words", () => {
  const values = looks().map((look) => neuroticismOf(look));

  it("when their neuroticism is read, then each is a unit, most are calm to middling, and a few are very jumpy", () => {
    expect(Math.min(...values), "least").toBeGreaterThanOrEqual(0);
    expect(Math.max(...values), "most").toBeLessThan(1);
    expect(values.filter((value) => value < TAIL).length / LOOKS, "share under a half").toBeGreaterThan(0.65);
    expect(values.reduce((sum, value) => sum + value, 0) / LOOKS, "mean").toBeGreaterThan(0.28);
    expect(values.reduce((sum, value) => sum + value, 0) / LOOKS, "mean").toBeLessThan(0.4);
    expect(values.filter((value) => value > 0.8).length, "very jumpy people").toBeGreaterThan(0);
  });

  it("when the same look is read twice, or with another gender or species, then it reads the same: it is the who-hash's alone", () => {
    const look = looks()[0]!;
    expect(neuroticismOf(look), "read twice").toBe(neuroticismOf(look));
    expect(neuroticismOf(look | (1 << LOOK.womanShift)), "with the woman bit").toBe(neuroticismOf(look & ~(1 << LOOK.womanShift)));
    expect(neuroticismOf(look | (1 << LOOK.speciesShift)), "as another species").toBe(neuroticismOf(look & ~(1 << LOOK.speciesShift)));
  });

  it("when two looks differ in one bit, then their neuroticism differs: it is scrambled, not read off the bits", () => {
    const first = looks()[1]!;
    expect(neuroticismOf(first ^ 1), "with the first bit turned").not.toBe(neuroticismOf(first));
  });
});

describe("given a crowd with a civilian shown", () => {
  it("when the drawing's look word and the brain's are read, then both give the same neuroticism", () => {
    const crowd = newCrowd(buildFixtureMap(), CROWD_RESIDENTS);
    stepUntilShown(crowd);
    let shown = 0;
    for (let resident = 0; resident < crowd.poses.count; resident++) {
      if (crowd.poses.shown[resident] === 0) continue;
      shown++;
      expect(neuroticismOf(crowd.poses.look[resident]!), `neuroticism of resident ${resident} from the drawing's look`).toBe(residentNeuroticism(crowd.state, resident));
      expect(lookOf(crowd.state.seed, crowd.state.ints, resident * RESIDENT_INT_STRIDE), `the brain's look word of resident ${resident}`).toBe(crowd.poses.look[resident]);
    }
    expect(shown, "civilians checked").toBeGreaterThan(0);
  });
});
