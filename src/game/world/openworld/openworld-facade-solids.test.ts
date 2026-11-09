import { describe, expect, it } from "vitest";
import { detCos, detSin } from "../../kernel/physics-core.js";
import { BAY, DOOR, facadeSolidProps, facadeSolidsOf, HOME_HEIGHT, HOME_LEVELS, homeFrontages, LOT_WIDTH, STOOP, stoopStepRange, type Frontage } from "./openworld-facade-solids.ts";
import { layOutLots } from "./openworld-lots.ts";
import { HOME_STYLES } from "./openworld-programme.ts";
import { PLACE_KIND } from "./walk-graph.ts";

const lots = layOutLots();
const playable = lots.places.slice(0, lots.backdropStart);
const homes = playable.filter((place) => place.kind === PLACE_KIND.home);
const frontages = homeFrontages(playable);

/** The interior's floor and the door sill stand this high over the sidewalk (m): the interior kit's number. */
const INTERIOR_FLOOR_Y = 0.9;
/** The tallest riser and the least tread (m) a walker takes as a step. */
const WALKER_RISE_MAX = 0.22;
const WALKER_TREAD_MIN = 0.28;
/** The door hole the facade art cuts, half its width (m). */
const DOOR_HOLE_HALF_WIDTH = 0.5;
/** A bay projects 0.6 to 0.9 m over the sidewalk (m). */
const BAY_OUT_RANGE = [0.6, 0.9] as const;
const EPSILON = 1e-9;

/** A world point against a frontage: out along the building's front direction and across it. */
function against(frontage: Frontage, x: number, z: number): { out: number; across: number } {
  const dx = x - frontage.x;
  const dz = z - frontage.z;
  return { out: dx * detCos(frontage.yaw) - dz * detSin(frontage.yaw), across: dx * detSin(frontage.yaw) + dz * detCos(frontage.yaw) };
}

describe("given the rowhomes of the open world's layout", () => {
  it("when the homes inside the walls are counted, then every one has a frontage and there are many", () => {
    expect(homes.length, "homes inside the walls").toBeGreaterThan(100);
    expect(frontages.length, "frontages").toBe(homes.length);
  });

  // mutation: sed -i 's/return Math.imul(Math.round(x \* 8) ^ Math.imul(Math.round(z \* 8), 0x9e3779b1), 0x85ebca6b) >>> 0;/return 0;/' src/game/world/openworld/openworld-facade-solids.ts
  it("when the houses' accents are picked, then the same lot gets the same one every time and neighbours differ", () => {
    const again = homeFrontages(playable);
    expect(again.every((frontage, at) => frontage.variant === frontages[at]!.variant), "same variants on a second call").toBe(true);
    const accents = new Set(frontages.map((frontage) => frontage.variant % 6));
    expect(accents.size, "accents among the houses").toBeGreaterThanOrEqual(5);
  });

  // mutation: sed -i 's/const PARAPET = 0.9;/const PARAPET = 1.2;/' src/game/world/openworld/openworld-lots.ts
  it("when the homes' buildings are measured, then each is one lot wide and as tall as the bay stack and cornice are cut for", () => {
    const buildings = lots.buildings.filter((building) => HOME_STYLES.includes(building.style));
    expect(buildings.length, "home buildings").toBeGreaterThan(50);
    const heights = buildings.map((building) => building.height);
    expect(Math.max(...heights), "tallest home (m)").toBeCloseTo(HOME_HEIGHT, 6);
    expect(Math.min(...heights), "lowest home (m)").toBeCloseTo(HOME_HEIGHT, 6);
    expect(HOME_LEVELS.storeys, "storeys the layout builds").toBe(playable.find((place) => place.kind === PLACE_KIND.home)!.storeys);
    expect(Math.max(...homes.map((place) => Math.abs(place.width - LOT_WIDTH))), "widest miss of a home's width to the lot width (m)").toBeLessThan(EPSILON);
  });

  // mutation: sed -i 's/doorX: lot.x, doorZ: lot.frontZ, yaw: lot.yaw, x: lot.x/doorX: lot.x + 1.75, doorZ: lot.frontZ, yaw: lot.yaw, x: lot.x/' src/game/world/openworld/openworld-lots.ts
  it("when each home's door point is read against its stoop, then the door is on the stoop's landing between its cheeks", () => {
    const misses = homes.filter((place, at) => {
      const { out, across } = against(frontages[at]!, place.doorX, place.doorZ);
      return Math.abs(across) > STOOP.width / 2 - DOOR_HOLE_HALF_WIDTH || Math.abs(out) > STOOP.landing;
    });
    expect(homes.length, "doors read").toBeGreaterThan(100);
    expect(misses.length, "homes whose door is off its stoop").toBe(0);
  });
});

describe("given one rowhome's stoop", () => {
  // mutation: sed -i 's/const STOOP_STEPS = 5;/const STOOP_STEPS = 4;/' src/game/world/openworld/openworld-facade-solids.ts
  it("when its top step is read, then it meets the interior's floor at the door sill", () => {
    expect(stoopStepRange(STOOP.steps).top, "top step (m)").toBeCloseTo(INTERIOR_FLOOR_Y, 9);
    expect(STOOP.sill, "stoop sill (m)").toBeCloseTo(INTERIOR_FLOOR_Y, 9);
    expect(DOOR.sill, "door sill (m)").toBeCloseTo(INTERIOR_FLOOR_Y, 9);
  });

  // mutation: sed -i 's/const STOOP_TREAD = 0.28;/const STOOP_TREAD = 0.2;/' src/game/world/openworld/openworld-facade-solids.ts
  it("when its steps are read, then every riser and tread is a walker's step and no step overhangs another", () => {
    let previousNear = Infinity;
    for (let step = 1; step <= STOOP.steps; step++) {
      const { near, far, top } = stoopStepRange(step);
      const lower = step === 1 ? 0 : stoopStepRange(step - 1).top;
      expect(top - lower, `riser to step ${step} (m)`).toBeLessThanOrEqual(WALKER_RISE_MAX + EPSILON);
      if (step < STOOP.steps) expect(far - near, `tread of step ${step} (m)`).toBeGreaterThanOrEqual(WALKER_TREAD_MIN - EPSILON);
      expect(far, `step ${step} reaches no further than the one below starts`).toBeLessThanOrEqual(previousNear === Infinity ? STOOP.run + EPSILON : previousNear + EPSILON);
      previousNear = near;
    }
    expect(previousNear, "the landing starts at the wall").toBeCloseTo(0, 9);
  });

  // mutation: sed -i 's/solids.push(boxOn(frontage, (near + far) \/ 2, 0, \[far - near, top, STOOP.width\]));/solids.push(boxOn(frontage, (near + far) \/ 2, 0, [far - near, top + 0.5, STOOP.width]));/' src/game/world/openworld/openworld-facade-solids.ts
  it("when its colliders are read, then each step is a prism on the ground as high as its tread and the bay's flanks stand either side of the stoop", () => {
    const frontage = frontages[0]!;
    const solids = facadeSolidsOf(frontage);
    expect(solids.length, "prisms of one rowhome").toBe(STOOP.steps + 2);
    for (let step = 1; step <= STOOP.steps; step++) {
      const { near, far, top } = stoopStepRange(step);
      const solid = solids[step - 1]!;
      const { out, across } = against(frontage, solid.x, solid.z);
      expect(solid.size[1], `height of step ${step}`).toBeCloseTo(top, 9);
      expect(solid.size[0], `depth of step ${step}`).toBeCloseTo(far - near, 9);
      expect(out, `middle of step ${step} out from the facade`).toBeCloseTo((near + far) / 2, 9);
      expect(across, `step ${step} off the door's line`).toBeCloseTo(0, 9);
    }
    for (const flank of solids.slice(STOOP.steps)) {
      const { out, across } = against(frontage, flank.x, flank.z);
      expect(flank.size[1], "flank height reaches the stack's top").toBeCloseTo(BAY.top, 9);
      expect(out - flank.size[0] / 2, "flank starts at the facade").toBeCloseTo(0, 9);
      expect(Math.abs(across) - flank.size[2] / 2, "flank clear of the stoop").toBeGreaterThanOrEqual(STOOP.width / 2 - EPSILON);
      expect(Math.abs(across) + flank.size[2] / 2, "flank ends with the bay").toBeCloseTo(BAY.width / 2, 9);
    }
  });
});

describe("given the course's rowhome colliders", () => {
  // mutation: sed -i 's/for (const side of \[-1, 1\]) solids.push(boxOn/for (const side of [1]) solids.push(boxOn/' src/game/world/openworld/openworld-facade-solids.ts
  it("when the layout's colliders are counted, then every home inside the walls has its steps and flanks and no solid lies behind its facade", () => {
    const solids = facadeSolidProps(lots);
    expect(solids.length, "colliders for the layout").toBe(frontages.length * (STOOP.steps + 2));
    const behind = solids.filter((solid, at) => against(frontages[Math.floor(at / (STOOP.steps + 2))]!, solid.x, solid.z).out - solid.size[0] / 2 < -EPSILON);
    expect(behind.length, "colliders reaching behind the facade").toBe(0);
  });

  // mutation: sed -i 's/const BAY_OUT = 0.75;/const BAY_OUT = 1.2;/' src/game/world/openworld/openworld-facade-solids.ts
  it("when the bay stack is read, then it projects as a rowhome bay does, hangs over the door's head and ends under the cornice", () => {
    expect(BAY.out, "bay projection (m)").toBeGreaterThanOrEqual(BAY_OUT_RANGE[0]);
    expect(BAY.out, "bay projection (m)").toBeLessThanOrEqual(BAY_OUT_RANGE[1]);
    expect(BAY.bottom, "stack starts at the door's head (m)").toBeGreaterThanOrEqual(DOOR.head - EPSILON);
    expect(BAY.top, "stack ends under the cornice (m)").toBeLessThan(HOME_HEIGHT - HOME_LEVELS.parapet);
    expect(BAY.width / 2, "stack stays inside the lot (m)").toBeLessThan(LOT_WIDTH / 2);
  });
});
