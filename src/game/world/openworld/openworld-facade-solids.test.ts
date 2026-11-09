import { describe, expect, it } from "vitest";
import { detCos, detSin } from "../../kernel/physics-core.js";
import { PREFAB } from "../constants.ts";
import { NO_FLOOR } from "../ground.ts";
import { propColliders } from "../placements.ts";
import { flightHeightAt, flightsOf } from "../stairs.ts";
import { planBlocks } from "./openworld-blocks.ts";
import { FACING } from "./openworld-constants.ts";
import { BAY, BAY_FLOORS, bayOutline, DOOR, drawnHalf, facadeSolidProps, facadeSolidsOf, HOME_HEIGHT, HOME_LEVELS, homeDoorPoint, homeFrontages, LOT_WIDTH, STOOP, stoopStepRange, type Frontage } from "./openworld-facade-solids.ts";
import { LEVELS, ROWHOME_FLOOR_Y, STREET_SKIN } from "./interior-kinds.ts";
import { interiorDoor, interiorSolids } from "./interior-plan.ts";
import { layOutLots } from "./openworld-lots.ts";
import { HOME_STYLES } from "./openworld-programme.ts";
import { PLACE_KIND } from "./walk-graph.ts";

const lots = layOutLots();
const playable = lots.places.slice(0, lots.backdropStart);
const homes = playable.filter((place) => place.kind === PLACE_KIND.home);
const frontages = homeFrontages(playable);
const lotPlans = planBlocks(lots.geometry).playable.flatMap((plan) => plan.lots);

/** The tallest riser and the least tread (m) a walker takes as a step. */
const WALKER_RISE_MAX = 0.22;
const WALKER_TREAD_MIN = 0.28;
/** The door hole the facade art cuts (m): half its width, and where its middle stands across the lot (u). */
const DOOR_HOLE_HALF_WIDTH = 0.5;
const DOOR_HOLE_ACROSS = 1.8;
/** A bay projects 0.6 to 0.9 m over the sidewalk (m). */
const BAY_OUT_RANGE = [0.6, 0.9] as const;
/** The door the kit and the interior name may differ by no more than this (m). */
const DOOR_MATCH = 1e-6;
/** Lots per face the door comparison must have covered. */
const DOORS_PER_FACE_MIN = 50;
/** The open world's house depth (m), and how far inside a drawn wall an interior's outer wall may end (its skin and its thickness, m). */
const HOUSE_DEPTH = 15;
const SHELL_DEPTH_MAX = 0.4;
/** The least a window's sill stands over its storey's floor (m): a seated person's knee and a table's edge are below it. */
const SILL_ABOVE_FLOOR_MIN = 0.5;
/** Boxes per rowhome the course may hold. */
const SOLIDS_PER_HOME_MAX = 3;
const EPSILON = 1e-9;

/** A world point against a frontage: out along the building's front direction and across along its local z (u). */
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

  // mutation: sed -i 's/  const door = interiorDoor(place.interior, place.width, place.depth, place.x, place.z, place.yaw);/  const door = { x: place.doorX, z: place.doorZ };/' src/game/world/openworld/openworld-lots.ts
  it("when each home's door point is read against its stoop, then the door stands 1.8 m across the lot, on the stoop's landing between its cheeks", () => {
    const misses = homes.filter((place, at) => {
      const { out, across } = against(frontages[at]!, place.doorX, place.doorZ);
      return Math.abs(across - DOOR_HOLE_ACROSS) > STOOP.width / 2 - DOOR_HOLE_HALF_WIDTH || Math.abs(out) > STOOP.landing;
    });
    expect(homes.length, "doors read").toBeGreaterThan(100);
    expect(misses.length, "homes whose door is off its stoop").toBe(0);
  });

  // mutation: sed -i 's/+ DOOR_ACROSS \* detSin(yaw), z: frontZ + inset \* detSin(yaw) + DOOR_ACROSS \* detCos(yaw) };/- DOOR_ACROSS * detSin(yaw), z: frontZ + inset * detSin(yaw) - DOOR_ACROSS * detCos(yaw) };/' src/game/world/openworld/openworld-facade-solids.ts
  it("when the door point of a lot facing north and of one facing south are made, then each is 1.8 m along the building's local z from the lot's middle, on the drawn front wall", () => {
    for (const yaw of [FACING.north, FACING.south]) {
      const door = homeDoorPoint(10, 20, yaw, HOUSE_DEPTH);
      const middle = { x: 10, z: 20, yaw, variant: 0 };
      expect(against(middle, door.x, door.z).across, `door across the lot facing ${yaw}`).toBeCloseTo(DOOR.across, 9);
      expect(against(middle, door.x, door.z).out, `door behind the front line facing ${yaw} (m)`).toBeCloseTo(drawnHalf(HOUSE_DEPTH) - HOUSE_DEPTH / 2, 9);
    }
    expect(DOOR.across, "door across (u)").toBe(DOOR_HOLE_ACROSS);
  });

  // mutation: sed -i 's/const ROWHOME_DOOR_OFFSET = 1.8;/const ROWHOME_DOOR_OFFSET = 1.9;/' src/game/world/openworld/interior-kinds.ts (or sed -i 's/const front = drawnHalf(this.place.depth) - deep;/const front = this.place.depth \/ 2 - deep;/' src/game/world/openworld/interior-plan.ts: the interior door 0.125 m out of the wall)
  it("when the door the facade kit stands at and the door the rowhome interior gives are compared for the lots of each face, then they are the same point, on the drawn front wall", () => {
    const compared = { north: 0, south: 0 };
    const apart: string[] = [];
    for (const lot of lotPlans) {
      const middleZ = (lot.house.z0 + lot.house.z1) / 2;
      const home = homes.find((place) => Math.abs(place.x - lot.x) < DOOR_MATCH && Math.abs(place.z - middleZ) < DOOR_MATCH);
      if (home === undefined) continue;
      const kit = homeDoorPoint(lot.x, lot.frontZ, lot.yaw, home.depth);
      const interior = interiorDoor("rowhome", home.width, home.depth, home.x, home.z, home.yaw);
      const offFace = against(frontages[homes.indexOf(home)]!, interior.x, interior.z).out;
      compared[lot.face]++;
      if (Math.abs(offFace) > DOOR_MATCH) apart.push(`${home.name} (${lot.face}): interior door ${offFace.toFixed(3)} m off the drawn front wall`);
      if (Math.abs(kit.x - interior.x) > DOOR_MATCH || Math.abs(kit.z - interior.z) > DOOR_MATCH) apart.push(`${home.name} (${lot.face}): kit ${kit.x.toFixed(3)}, ${kit.z.toFixed(3)} interior ${interior.x.toFixed(3)}, ${interior.z.toFixed(3)}`);
    }
    expect(compared.north, "north-face lots compared").toBeGreaterThanOrEqual(DOORS_PER_FACE_MIN);
    expect(compared.south, "south-face lots compared").toBeGreaterThanOrEqual(DOORS_PER_FACE_MIN);
    expect(apart.slice(0, 3).join("; "), "doors the kit and the interior place apart").toBe("");
  });
});

describe("given the interiors of the homes", () => {
  // mutation: sed -i 's/const draft = new Draft(kind, 2 \* (drawnHalf(width) - STREET_SKIN), 2 \* drawnHalf(depth));/const draft = new Draft(kind, width, depth);/' src/game/world/openworld/interior-plan.ts
  it("when every solid of each home's interior is read in its building's frame, then none reaches the drawn walls: no interior wall stands in front of the facade's picture", () => {
    let solidsRead = 0;
    let deepest = { out: -Infinity, across: -Infinity };
    const through: string[] = [];
    for (const home of homes) {
      const outLimit = drawnHalf(home.depth) - STREET_SKIN;
      const acrossLimit = drawnHalf(home.width) - STREET_SKIN;
      for (const solid of interiorSolids(home)) {
        solidsRead++;
        for (const x of [solid.x0, solid.x1]) {
          for (const z of [solid.z0, solid.z1]) {
            const { out, across } = against({ x: home.x, z: home.z, yaw: home.yaw, variant: 0 }, x, z);
            deepest = { out: Math.max(deepest.out, Math.abs(out)), across: Math.max(deepest.across, Math.abs(across)) };
            if (Math.abs(out) > outLimit + DOOR_MATCH || Math.abs(across) > acrossLimit + DOOR_MATCH) through.push(`${home.name}: corner ${out.toFixed(3)} out, ${across.toFixed(3)} across`);
          }
        }
      }
    }
    expect(solidsRead, "interior solids read").toBeGreaterThan(homes.length * 10);
    expect(deepest.out, "furthest an interior solid reaches out of a home's middle (m)").toBeGreaterThan(drawnHalf(HOUSE_DEPTH) - 2 * SHELL_DEPTH_MAX);
    expect(through.slice(0, 3).join("; "), "interior solids reaching the drawn walls").toBe("");
  });
});

describe("given one rowhome's stoop", () => {
  // mutation: sed -i 's/const STOOP_STEPS = 5;/const STOOP_STEPS = 4;/' src/game/world/openworld/openworld-facade-solids.ts (or sed -i 's/export const ROWHOME_FLOOR_Y = 0.9;/export const ROWHOME_FLOOR_Y = 0.95;/' src/game/world/openworld/interior-kinds.ts)
  it("when its top step is read, then it meets the rowhome interior's floor at the door sill", () => {
    expect(stoopStepRange(STOOP.steps).top, "top step (m)").toBeCloseTo(ROWHOME_FLOOR_Y, 9);
    expect(STOOP.sill, "stoop sill (m)").toBeCloseTo(ROWHOME_FLOOR_Y, 9);
    expect(DOOR.sill, "door sill (m)").toBeCloseTo(ROWHOME_FLOOR_Y, 9);
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

  // mutation: sed -i 's/{ ...boxOn(frontage, (STOOP.landing + STOOP.run) \/ 2, DOOR.across, \[STOOP.run - STOOP.landing, RAMP_TOP, STOOP.width\]), stairs: true }/boxOn(frontage, (STOOP.landing + STOOP.run) \/ 2, DOOR.across, [STOOP.run - STOOP.landing, RAMP_TOP, STOOP.width])/' src/game/world/openworld/openworld-facade-solids.ts
  it("when the stoop's ramp is read, then it is a flight of stairs of as many treads and risers as the visible steps', falling from the landing's end", () => {
    const solids = facadeSolidsOf(frontages[0]!);
    const ramp = solids[1]!;
    expect(ramp.stairs, "the ramp is stairs").toBe(true);
    expect(solids.filter((solid) => solid.stairs === true).length, "boxes that are stairs").toBe(1);
    const treads = Math.round(ramp.size[0] / WALKER_TREAD_MIN);
    expect(treads, "treads the flight cuts its length into").toBe(STOOP.steps - 1);
    expect(ramp.size[1] / treads, "riser the flight's height gives (m)").toBeCloseTo(STOOP.rise, 9);
  });

  // mutation: sed -i 's/Math.ceil(climbed \* flight.treads)/Math.floor(climbed * flight.treads)/' src/game/world/stairs.ts
  it("when the stoop's ramp is read as the course places it, then the flight stands on the drawn treads' heights and nowhere off the stoop", () => {
    const frontage = frontages[0]!;
    const ramp = facadeSolidsOf(frontage)[1]!;
    const placed = { prefab: PREFAB.invisibleWall, x: ramp.x, y: 0, z: ramp.z, yaw: ramp.yaw, sx: ramp.size[0], sy: ramp.size[1], sz: ramp.size[2], stairs: true as const };
    const flights = flightsOf(propColliders([placed]), [placed]);
    expect(flights.length, "the ramp is one flight").toBe(1);
    const at = (out: number, across: number) => ({ x: frontage.x + detCos(frontage.yaw) * out + detSin(frontage.yaw) * across, z: frontage.z - detSin(frontage.yaw) * out + detCos(frontage.yaw) * across });
    for (let step = 1; step < STOOP.steps; step++) {
      const { near, far, top } = stoopStepRange(step);
      const point = at((near + far) / 2, DOOR.across);
      expect(flightHeightAt(flights[0]!, point.x, point.z), `tread ${step}'s height (m)`).toBeCloseTo(top, 9);
    }
    const past = at(STOOP.run + 0.1, DOOR.across);
    expect(flightHeightAt(flights[0]!, past.x, past.z), "past the foot").toBe(NO_FLOOR);
    const beside = at(STOOP.run / 2, DOOR.across + STOOP.width / 2 + 0.1);
    expect(flightHeightAt(flights[0]!, beside.x, beside.z), "beside the stoop").toBe(NO_FLOOR);
  });

  // mutation: sed -i 's/boxOn(frontage, STOOP.landing \/ 2, DOOR.across, \[STOOP.landing, STOOP.sill, STOOP.width\]),/boxOn(frontage, STOOP.landing \/ 2, DOOR.across, [STOOP.landing, STOOP.sill + 0.3, STOOP.width]),/' src/game/world/openworld/openworld-facade-solids.ts
  it("when a rowhome's colliders are read, then there are three boxes: the bay stack, the stoop's ramp and its landing flush with the sill", () => {
    const frontage = frontages[0]!;
    const solids = facadeSolidsOf(frontage);
    expect(solids.length, "boxes of one rowhome").toBe(SOLIDS_PER_HOME_MAX);
    const [bay, ramp, landing] = [solids[0]!, solids[1]!, solids[2]!];
    const landingAt = against(frontage, landing.x, landing.z);
    const rampAt = against(frontage, ramp.x, ramp.z);
    expect(landing.size[1], "landing height (m)").toBeCloseTo(STOOP.sill, 9);
    expect(landingAt.out - landing.size[0] / 2, "landing starts at the wall").toBeCloseTo(0, 9);
    expect(rampAt.out - ramp.size[0] / 2, "ramp starts where the landing ends").toBeCloseTo(landingAt.out + landing.size[0] / 2, 9);
    expect(rampAt.out + ramp.size[0] / 2, "ramp ends at the stoop's foot").toBeCloseTo(STOOP.run, 9);
    expect(ramp.size[1], "ramp height (m)").toBeCloseTo(stoopStepRange(STOOP.steps - 1).top, 9);
    expect(landingAt.across, "landing on the door's line (u)").toBeCloseTo(DOOR.across, 9);
    expect(rampAt.across, "ramp on the door's line (u)").toBeCloseTo(DOOR.across, 9);
    expect(landing.size[2], "stoop width (m)").toBeCloseTo(STOOP.width, 9);
    const bayAt = against(frontage, bay.x, bay.z);
    expect(bay.size[1], "bay stack's box reaches the roof slab (m)").toBeCloseTo(BAY.top, 9);
    expect(bayAt.out - bay.size[0] / 2, "bay box starts at the facade").toBeCloseTo(0, 9);
    expect(bayAt.across, "bay box on the bay's line (u)").toBeCloseTo(BAY.across, 9);
  });
});

describe("given the course's rowhome colliders", () => {
  // mutation: sed -i 's/    boxOn(frontage, STOOP.landing \/ 2, DOOR.across, \[STOOP.landing, STOOP.sill, STOOP.width\]),//' src/game/world/openworld/openworld-facade-solids.ts
  it("when the layout's colliders are counted, then every home inside the walls has three and no solid lies behind its facade", () => {
    const solids = facadeSolidProps(lots);
    expect(solids.length, "colliders for the layout").toBe(frontages.length * SOLIDS_PER_HOME_MAX);
    const behind = solids.filter((solid, at) => against(frontages[Math.floor(at / SOLIDS_PER_HOME_MAX)]!, solid.x, solid.z).out - solid.size[0] / 2 < -EPSILON);
    expect(behind.length, "colliders reaching behind the facade").toBe(0);
  });

  // mutation: sed -i 's/const sill = floor + BAY_SILL_ABOVE_FLOOR;/const sill = floor + BAY_SILL_ABOVE_FLOOR * (1 + floor \/ 30);/' src/game/world/openworld/openworld-facade-solids.ts
  it("when each storey's bay window is read against the rowhome interior's floors, then there is one a floor, every sill the same sensible height over its floor and every head under the next floor", () => {
    const floors = LEVELS.rowhome.floors;
    expect(BAY_FLOORS.length, "bay windows").toBe(floors.length);
    const first = BAY_FLOORS[0]!.sill - floors[0]!;
    expect(first, "ground storey sill over the raised floor (m)").toBeGreaterThanOrEqual(SILL_ABOVE_FLOOR_MIN);
    for (const [storey, bay] of BAY_FLOORS.entries()) {
      expect(bay.sill - floors[storey]!, `storey ${storey} sill over its floor against the ground storey's (m)`).toBeCloseTo(first, 9);
      expect(bay.head, `storey ${storey} head under the next floor or the top ceiling (m)`).toBeLessThan(floors[storey + 1] ?? LEVELS.rowhome.topCeiling);
    }
  });

  it("when the bay's outline is read, then its wall corners span the bay's width at the facade and its front stands out by the projection, the front as wide as the bay's front", () => {
    const outline = bayOutline(0);
    const [wallLow, frontLow, frontHigh, wallHigh] = [outline[0]!, outline[1]!, outline[2]!, outline[3]!];
    expect(wallHigh.across - wallLow.across, "width at the facade (m)").toBeCloseTo(BAY.width, 9);
    expect((wallHigh.across + wallLow.across) / 2, "middle across (u)").toBeCloseTo(BAY.across, 9);
    expect(frontHigh.across - frontLow.across, "front width (m)").toBeCloseTo(BAY.front, 9);
    expect(frontLow.out, "projection (m)").toBeCloseTo(BAY.out, 9);
    expect(wallLow.out, "wall corner on the facade (m)").toBe(0);
  });

  // mutation: sed -i 's/const BAY_OUT = 0.7;/const BAY_OUT = 1.2;/' src/game/world/openworld/openworld-facade-solids.ts
  it("when the bay stack is read, then it projects as a rowhome bay does, ends under the cornice and shares the lot with the stoop and the piers", () => {
    expect(BAY.out, "bay projection (m)").toBeGreaterThanOrEqual(BAY_OUT_RANGE[0]);
    expect(BAY.out, "bay projection (m)").toBeLessThanOrEqual(BAY_OUT_RANGE[1]);
    expect(BAY.top, "stack ends under the cornice (m)").toBeLessThan(HOME_HEIGHT - HOME_LEVELS.parapet);
    expect(BAY.across - BAY.width / 2, "bay's far edge inside the lot (u)").toBeGreaterThanOrEqual(-LOT_WIDTH / 2);
    expect(DOOR.across + STOOP.width / 2, "stoop's far edge inside the lot (u)").toBeLessThanOrEqual(LOT_WIDTH / 2);
    expect(DOOR.across - STOOP.width / 2 - (BAY.across + BAY.width / 2), "clear gap from the bay to the stoop (m)").toBeGreaterThan(0.4);
  });
});
