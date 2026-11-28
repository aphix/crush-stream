import { firstMismatch } from "../../kernel/compare-arrays.test-util.ts";
import { describe, expect, it } from "vitest";
import { ACTIVITY } from "./civilian-activity.ts";
import { tickAt } from "./civilian-clock.ts";
import { RESIDENT_INT } from "./civilian-constants.ts";
import { CHEST_HEIGHT, LOOK_REACH } from "./civilian-crowd-constants.ts";
import type { CivilianCrowd } from "./civilian-crowd.ts";
import { buildFixtureMap } from "./civilian-graph.test-util.ts";
import { lookAtOf, LookRay, placeMet } from "./civilian-look.ts";
import { createCrowdPoses } from "./crowd-poses.ts";
import { historyLines, residentNameText } from "./civilian-mood.ts";
import { FRAME_SECONDS, newCrowd, shownResident, stepUntilShown } from "./civilian-crowd.test-util.ts";
import { detCos, detSin, hypot3 } from "../../kernel/physics-core.js";
import { allocatedBytes, untilQuiet } from "../../kernel/alloc-sample.test-util.ts";
import { buildOpenWorldMap } from "../../world/openworld/openworld-map.ts";
import { layOutLots } from "../../world/openworld/openworld-lots.ts";
import { BAY_WIDTH } from "../../world/openworld/interior-kinds.ts";
import { DOOR } from "../../world/openworld/openworld-facade-solids.ts";

const map = buildFixtureMap();
const EYE_HEIGHT = 1.5;
/** Ground with no building on it, and a ray that climbs this many metres over this many along: it is above a house's roof where it would meet the house's face. */
const OPEN_GROUND = 1000;
const ROOF_RUN = 10;
const ROOF_RISE = 30;
/** Metres the eye stands back from what it looks at. */
const STAND_BACK = 8;
/** A unit vector from the eye towards the point (x, y, z). */
function aimedAt(ray: LookRay, x: number, y: number, z: number): LookRay {
  const length = hypot3(x - ray.eyeX, y - ray.eyeY, z - ray.eyeZ);
  ray.dirX = (x - ray.eyeX) / length;
  ray.dirY = (y - ray.eyeY) / length;
  ray.dirZ = (z - ray.eyeZ) / length;
  return ray;
}

function eyeAt(x: number, z: number): LookRay {
  const ray = new LookRay();
  ray.eyeX = x;
  ray.eyeY = EYE_HEIGHT;
  ray.eyeZ = z;
  return ray;
}

/** The eye `STAND_BACK` m behind civilian `resident`, along the way they walk, looking at their chest. */
function behind(crowd: CivilianCrowd, resident: number): LookRay {
  const { x, z, yaw } = crowd.poses;
  const ray = eyeAt(x[resident]! - detSin(yaw[resident]!) * STAND_BACK, z[resident]! - detCos(yaw[resident]!) * STAND_BACK);
  return aimedAt(ray, x[resident]!, CHEST_HEIGHT, z[resident]!);
}

/** A crowd stepped to the first civilian shown, then on until they are in no clip (the first moments of a walk are the door they came out of). */
function crowdWithWalker(): { crowd: CivilianCrowd; resident: number; tick: number } {
  const crowd = newCrowd(map);
  let seconds = stepUntilShown(crowd);
  const resident = shownResident(crowd);
  while (crowd.poses.activity[resident] !== ACTIVITY.none) {
    seconds += FRAME_SECONDS;
    crowd.step(seconds, [], true);
  }
  return { crowd, resident, tick: tickAt(seconds) };
}

describe("given a crowd with a civilian walking on the street", () => {
  const { crowd, resident, tick } = crowdWithWalker();

  it("when the eye looks at them, then the panel is titled with their name and lists their life log", () => {
    const text = lookAtOf(crowd.state, crowd.poses, tick, behind(crowd, resident));
    expect(text?.title.startsWith(residentNameText(crowd.state, resident)), `title ${text?.title}`).toBe(true);
    expect(firstMismatch(text?.lines, historyLines(crowd.state, resident)), "life log").toBeUndefined();
  });

  it("when the one looked at is doing something the line does not say, then the panel says it first, above the life log", () => {
    const was = crowd.poses.activity[resident]!;
    crowd.poses.activity[resident] = ACTIVITY.phoneCall;
    const text = lookAtOf(crowd.state, crowd.poses, tick, behind(crowd, resident));
    crowd.poses.activity[resident] = was;
    expect(text?.lines[0], "what they are doing").toBe("phoning for an ambulance");
    expect(firstMismatch(text?.lines.slice(1), historyLines(crowd.state, resident)), "then the life log").toBeUndefined();
  });

  it("when the eye looks past them, or at the sky, then the panel is empty", () => {
    const ray = behind(crowd, resident);
    ray.dirX = -ray.dirX;
    ray.dirZ = -ray.dirZ;
    expect(lookAtOf(crowd.state, crowd.poses, tick, ray), "looking away").toBeNull();
    expect(lookAtOf(crowd.state, crowd.poses, tick, aimedAt(eyeAt(crowd.poses.x[resident]!, crowd.poses.z[resident]!), crowd.poses.x[resident]!, 100, crowd.poses.z[resident]!)), "looking up").toBeNull();
  });

});

describe("given one civilian out on open ground, far from every building", () => {
  const crowd = newCrowd(map);
  const resident = 0;

  /** The panel's title with the eye `metres` short of the civilian, looking straight at their chest. */
  function titleAt(metres: number): string | undefined {
    const count = crowd.poses.count;
    const poses = createCrowdPoses(count);
    poses.shown[resident] = 1;
    poses.x[resident] = OPEN_GROUND;
    poses.z[resident] = metres;
    return lookAtOf(crowd.state, poses, 0, aimedAt(eyeAt(OPEN_GROUND, 0), OPEN_GROUND, CHEST_HEIGHT, metres))?.title;
  }

  it("when they are inside the look reach, then the panel names them, and when they are beyond it, then it does not", () => {
    expect(titleAt(LOOK_REACH - 1)?.startsWith(residentNameText(crowd.state, resident)), "inside the reach").toBe(true);
    expect(titleAt(LOOK_REACH + 1), "beyond the reach").toBeUndefined();
  });

  it("when one stands on a stoop's step behind another on the street and the eye is on the one on the step's chest, then the panel names the one on the step", () => {
    const STEP_UP = 0.9;
    const onStep = 1;
    const onStreet = 2;
    const metres = LOOK_REACH - 4;
    const poses = createCrowdPoses(crowd.poses.count);
    for (const civilian of [onStep, onStreet]) {
      poses.shown[civilian] = 1;
      poses.x[civilian] = OPEN_GROUND;
    }
    poses.z[onStep] = metres;
    poses.feetY[onStep] = STEP_UP;
    poses.z[onStreet] = metres - 2;
    const title = lookAtOf(crowd.state, poses, 0, aimedAt(eyeAt(OPEN_GROUND, 0), OPEN_GROUND, CHEST_HEIGHT + STEP_UP, metres))?.title;
    expect(title?.startsWith(residentNameText(crowd.state, onStep))).toBe(true);
  });
});

describe("given a crowd and the eye aimed at the door of a home", () => {
  it("when the ray meets the building, then the panel is its name and says who lives there", () => {
    const crowd = newCrowd(map);
    const home = crowd.state.ints[RESIDENT_INT.home]!;
    const house = map.places[home]!;
    const eye = eyeAt(house.x - house.depth / 2 - 3, house.z);
    const text = lookAtOf(crowd.state, crowd.poses, 0, aimedAt(eye, house.x, EYE_HEIGHT, house.z));
    expect(text?.title, "title").toBe(house.name);
    expect(text?.lines.some((line) => line.startsWith("lives here:") && line.includes(residentNameText(crowd.state, 0))), `lines ${text?.lines}`).toBe(true);
  });

  it("when the ray runs over the roof, or the eye is behind the ray, then the panel is empty", () => {
    const crowd = newCrowd(map);
    const house = map.places[crowd.state.ints[RESIDENT_INT.home]!]!;
    const eye = eyeAt(house.x - house.depth / 2 - 3, house.z);
    expect(lookAtOf(crowd.state, crowd.poses, 0, aimedAt(eye, eye.eyeX + ROOF_RUN, EYE_HEIGHT + ROOF_RISE, eye.eyeZ)), "over the roof").toBeNull();
    const away = aimedAt(eyeAt(house.x - house.depth / 2 - 3, house.z), house.x - 50, EYE_HEIGHT, house.z);
    expect(lookAtOf(crowd.state, crowd.poses, 0, away), "looking away").toBeNull();
  });
});

describe("given the eye aimed at the door of a home, asked as a bullet asks", () => {
  /** Calls a read makes: a call that made one small object would read far above the bound. */
  const CALLS = 2000;
  /** The sampling profiler's own cost is 4-5 KB of a read. */
  const BOUND_BYTES = 8192;

  it("when the building the ray meets is asked for 2000 times, then each answer names the home and all of them together allocate under 8 KB", () => {
    const crowd = newCrowd(map);
    const home = crowd.state.ints[RESIDENT_INT.home]!;
    const house = map.places[home]!;
    const ray = aimedAt(eyeAt(house.x - house.depth / 2 - 3, house.z), house.x, EYE_HEIGHT, house.z);
    const met = { index: -1, along: Infinity };
    const ask = (): void => {
      for (let call = 0; call < CALLS; call++) placeMet(map, ray, LOOK_REACH, met);
    };
    const bytes = untilQuiet(() => allocatedBytes(ask), BOUND_BYTES);
    expect(met.index, "the building met").toBe(home);
    expect(bytes, "bytes allocated by 2000 asks").toBeLessThanOrEqual(BOUND_BYTES);
  });
});

describe("given the city's own map, its 310 buildings inside the walls", () => {
  const city = buildOpenWorldMap(layOutLots());
  /** Calls a read makes, and the read's bound: the sampling profiler's own cost is 4-5 KB of a read. */
  const CALLS = 2000;
  const BOUND_BYTES = 8192;

  it("when the eye 3 m before a building asks 2000 times which building it meets, then each answer names that building and all of them together allocate under 8 KB", () => {
    const house = city.places.find((place) => place.doorNode >= 0)!;
    const ray = aimedAt(eyeAt(house.x - house.depth / 2 - 3, house.z), house.x, EYE_HEIGHT, house.z);
    const met = { index: -1, along: Infinity };
    const ask = (): void => {
      for (let call = 0; call < CALLS; call++) placeMet(city, ray, LOOK_REACH, met);
    };
    const bytes = untilQuiet(() => allocatedBytes(ask), BOUND_BYTES);
    expect(met.index, "the building met").toBe(city.places.indexOf(house));
    expect(bytes, "bytes allocated by 2000 asks").toBeLessThanOrEqual(BOUND_BYTES);
  });

  it("when the panel is asked 2000 times what the eye rests on and it rests on nothing, then the panel is empty and all of the asks together allocate under 8 KB", () => {
    const crowd = newCrowd(map);
    const ray = aimedAt(eyeAt(OPEN_GROUND, 0), OPEN_GROUND, EYE_HEIGHT + ROOF_RISE, ROOF_RUN);
    let empty = 0;
    const ask = (): void => {
      for (let call = 0; call < CALLS; call++) if (lookAtOf(crowd.state, crowd.poses, 0, ray) === null) empty++;
    };
    const bytes = untilQuiet(() => allocatedBytes(ask), BOUND_BYTES);
    expect(empty, "empty panels").toBeGreaterThan(0);
    expect(bytes, "bytes allocated by 2000 asks").toBeLessThanOrEqual(BOUND_BYTES);
  });

  /** A shop of the city: its index, the line across its street face its door stands on (m, in its own frame), and a ray whose eye is at (deep, across) of that frame (deep +: toward the street face) aimed level at (toDeep, toAcross). */
  const shopIndex = city.places.findIndex((place) => place.interior === "store");
  const shop = city.places[shopIndex]!;
  const doorAcross = (shop.doorX - shop.x) * detSin(shop.yaw) + (shop.doorZ - shop.z) * detCos(shop.yaw);
  /** Metres beside the door: a point of the street wall well clear of the door's opening. */
  const BESIDE_DOOR = 2;
  /** Metres out in the street, before the shop's face. */
  const IN_STREET = 3;
  function shopRay(deep: number, across: number, toDeep: number, toAcross: number): LookRay {
    const cos = detCos(shop.yaw);
    const sin = detSin(shop.yaw);
    const ray = eyeAt(shop.x + deep * cos + across * sin, shop.z - deep * sin + across * cos);
    return aimedAt(ray, shop.x + toDeep * cos + toAcross * sin, EYE_HEIGHT, shop.z - toDeep * sin + toAcross * cos);
  }

  it("when a bullet's ray starts in the middle of a shop aimed at its street wall beside the door, then it meets that shop's wall half the shop's depth on, and a look's ray from there passes out of the shop", () => {
    const ray = shopRay(0, doorAcross + BESIDE_DOOR, shop.depth, doorAcross + BESIDE_DOOR);
    const bullet = placeMet(city, ray, LOOK_REACH, { index: -1, along: Infinity }, true);
    expect(bullet.index, "the building the bullet meets").toBe(shopIndex);
    expect(bullet.along, "how far on (m)").toBeCloseTo(shop.depth / 2, 3);
    expect(placeMet(city, ray, LOOK_REACH, { index: -1, along: Infinity }).index, "the building the look meets").not.toBe(shopIndex);
  });

  it("when a bullet's ray starts in a shop aimed out through its street door, then it meets no wall of the shop", () => {
    const ray = shopRay(0, doorAcross, shop.depth, doorAcross);
    expect(placeMet(city, ray, LOOK_REACH, { index: -1, along: Infinity }, true).index, "the building the bullet meets").not.toBe(shopIndex);
  });

  it("when a bullet's ray from the street goes in through a shop's street door, then it meets the shop's back wall, and one beside the door meets the street face", () => {
    const through = placeMet(city, shopRay(shop.depth / 2 + IN_STREET, doorAcross, -shop.depth, doorAcross), LOOK_REACH, { index: -1, along: Infinity }, true);
    expect(through.index, "through the door: the building met").toBe(shopIndex);
    expect(through.along, "through the door: how far on (m)").toBeCloseTo(IN_STREET + shop.depth, 3);
    const beside = placeMet(city, shopRay(shop.depth / 2 + IN_STREET, doorAcross + BESIDE_DOOR, -shop.depth, doorAcross + BESIDE_DOOR), LOOK_REACH, { index: -1, along: Infinity }, true);
    expect(beside.index, "beside the door: the building met").toBe(shopIndex);
    expect(beside.along, "beside the door: how far on (m)").toBeCloseTo(IN_STREET, 3);
  });

  /** The building a bullet meets when fired level from the middle of place `index`, `across` m along its face from its middle, `up` m over the ground, toward its street face. */
  function shotOutOf(index: number, across: number, up: number): { index: number; along: number } {
    const place = city.places[index]!;
    const cos = detCos(place.yaw);
    const sin = detSin(place.yaw);
    const ray = new LookRay();
    ray.eyeX = place.x + across * sin;
    ray.eyeY = up;
    ray.eyeZ = place.z + across * cos;
    ray.dirX = cos;
    ray.dirY = 0;
    ray.dirZ = -sin;
    return placeMet(city, ray, LOOK_REACH, { index: -1, along: Infinity }, true);
  }
  /** Where place `index`'s door node stands across its face (m from its middle). */
  const doorLineOf = (index: number): number => {
    const place = city.places[index]!;
    return (place.doorX - place.x) * detSin(place.yaw) + (place.doorZ - place.z) * detCos(place.yaw);
  };
  /** A chest's height over a room's floor (m). */
  const CHEST_UP = 1;

  for (const kind of ["rowhome", "coffee", "bar", "office", "store"] as const) {
    it(`when a bullet's ray leaves a ${kind} along its door's line at chest height over its floor, then it meets no wall of it, and ${BESIDE_DOOR} m to the side it meets the street wall`, () => {
      const index = city.places.findIndex((place) => place.interior === kind);
      const up = (kind === "rowhome" ? DOOR.sill : 0) + CHEST_UP;
      expect(shotOutOf(index, doorLineOf(index), up).index, "through the door: the building met").not.toBe(index);
      // A rowhome's door stands near its right party wall: the wall beside it is to the left.
      const beside = shotOutOf(index, doorLineOf(index) - BESIDE_DOOR, up);
      expect(beside.index, "beside the door: the building met").toBe(index);
      expect(beside.along, "beside the door: how far on (m)").toBeCloseTo(city.places[index]!.depth / 2, 3);
    });
  }

  it("when a bullet's ray leaves an office 0.7 m off its door's line, then it passes (an office's door is 1.5 m wide), and 0.9 m off it meets the wall", () => {
    const index = city.places.findIndex((place) => place.interior === "office");
    expect(shotOutOf(index, doorLineOf(index) + 0.7, CHEST_UP).index, "0.7 m off: the building met").not.toBe(index);
    expect(shotOutOf(index, doorLineOf(index) + 0.9, CHEST_UP).index, "0.9 m off: the building met").toBe(index);
  });

  it("when a bullet's ray leaves a shop two bays wide along its second bay's door line, then it passes: every bay has its doorway", () => {
    expect(Math.round(shop.width / BAY_WIDTH), "control: the shop's bays").toBe(2);
    expect(shotOutOf(shopIndex, doorAcross + BAY_WIDTH, CHEST_UP).index, "the building met").not.toBe(shopIndex);
  });

  it("when a bullet's ray leaves a bar over its door's top, then it meets the wall", () => {
    const index = city.places.findIndex((place) => place.interior === "bar");
    expect(shotOutOf(index, doorLineOf(index), 2.5).index, "the building met").toBe(index);
  });
});
