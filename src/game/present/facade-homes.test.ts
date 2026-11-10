import { describe, expect, it } from "vitest";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { buildOpenWorldMap } from "../world/openworld/openworld-map.ts";
import { PLACE_KIND } from "../world/openworld/walk-graph.ts";
import { FACADE_HOMES, FACADE_HOMES_FRAME, HOME_CELL_METRES, HOME_FADE_PER_MINUTE, HOME_SHARE_BY_AWAKE, HomeLights, homeCell, texelOfShare } from "./facade-homes.ts";
import { shareOfTexel } from "./facade-homes.test-util.ts";

const map = buildOpenWorldMap(layOutLots());
const homes = map.places.flatMap((place, index) => (place.kind === PLACE_KIND.home ? [{ place: index, x: place.x, z: place.z }] : []));
/** Homes the real map has, at the least. */
const HOMES_MIN = 100;
const EPSILON = 1e-9;
/** A place this near a home's centre is on the home's building (m). */
const ON_A_HOME_M = 1;

/** The awake counts of a map, `people` in every home. */
const awakeEverywhere = (people: number): Uint8Array => new Uint8Array(map.places.length).fill(people);

describe("given the open world's homes on the texel grid", () => {
  // mutation: sed -i 's/export const HOME_CELL_METRES = 4;/export const HOME_CELL_METRES = 12;/' src/game/present/facade-homes.ts
  it("when every home of the map is put on the grid, then each has a texel of its own and no building that is no home shares one", () => {
    expect(homes.length, "homes in the map").toBeGreaterThan(HOMES_MIN);
    const lights = new HomeLights(homes);
    const cells = new Set<number>();
    const across = FACADE_HOMES_FRAME.value.z;
    const [originX, originZ] = [FACADE_HOMES_FRAME.value.x, FACADE_HOMES_FRAME.value.y];
    for (const home of homes) {
      const cell = homeCell(home.x, home.z, originX, originZ);
      expect(cell.column >= 0 && cell.column < across && cell.row >= 0 && cell.row < FACADE_HOMES_FRAME.value.w, `home at ${home.x}, ${home.z} on the grid`).toBe(true);
      cells.add(cell.row * across + cell.column);
    }
    expect(cells.size, "distinct texels for the homes").toBe(homes.length);
    // A roof place (a deck, a pigeon coop) stands on its home's own building: no building of its own to read a texel.
    const others = map.places.filter((place) => place.kind !== PLACE_KIND.home && !homes.some((home) => Math.abs(home.x - place.x) < ON_A_HOME_M && Math.abs(home.z - place.z) < ON_A_HOME_M));
    const taken = others.filter((place) => cells.has(homeCell(place.x, place.z, originX, originZ).row * across + homeCell(place.x, place.z, originX, originZ).column));
    expect(taken.map((place) => place.name).join(", "), "buildings that are no home but stand in a home's texel").toBe("");
    lights.dispose();
  });

  // mutation: sed -i 's/  return { column: Math.floor(f32(f32(f32(x) - f32(originX)) \* f32(perMetre))), row/  return { column: Math.round(f32(f32(f32(x) - f32(originX)) * f32(perMetre))), row/' src/game/present/facade-homes.ts
  it("when a home's texel is looked up the way the shader does, then it is the one written: the grid's origin, the cell width and the 32-bit translation agree", () => {
    const lights = new HomeLights(homes);
    const f32 = Math.fround;
    const frame = FACADE_HOMES_FRAME.value;
    for (const [at, home] of homes.entries()) {
      const column = Math.floor(f32(f32(f32(home.x) - frame.x) * (1 / HOME_CELL_METRES)));
      const row = Math.floor(f32(f32(f32(home.z) - frame.y) * (1 / HOME_CELL_METRES)));
      expect(lights.data[row * frame.z + column], `home ${at} read at the shader's cell`).toBe(lights.texelOf(at));
    }
    lights.dispose();
  });

  // mutation: sed -i 's/=> 1 + Math.round(share \* SHARE_STEPS)/=> 0 + Math.round(share * SHARE_STEPS)/' src/game/present/facade-homes.ts
  it("when the first step is taken with nobody awake, then every home's texel is the dark one, not the empty one, so the shader does not fall back to the fixed share", () => {
    const lights = new HomeLights(homes);
    lights.step(awakeEverywhere(0));
    for (const [at] of homes.entries()) expect(lights.texelOf(at), `home ${at}`).toBe(texelOfShare(0));
    expect(shareOfTexel(texelOfShare(0)), "dark").toBe(0);
    expect(texelOfShare(0), "dark is not empty").toBeGreaterThan(0);
    expect(lights.data.filter((texel) => texel === 0).length, "texels with no home").toBeGreaterThan(0);
    lights.dispose();
  });
});

describe("given the people awake in homes changing", () => {
  // mutation: sed -i 's/const HOME_SHARE_BY_AWAKE = \[0, 0.35, 0.6, 0.75, 0.85\] as const;/const HOME_SHARE_BY_AWAKE = [0, 0.35, 0.35, 0.35, 0.35] as const;/' src/game/present/facade-homes.ts
  it("when homes have none, one, two, three and many people awake, then the first step sets each to a larger share of its windows", () => {
    const shares = HOME_SHARE_BY_AWAKE.map((_, people) => {
      const lights = new HomeLights(homes);
      lights.step(awakeEverywhere(people));
      const share = shareOfTexel(lights.texelOf(0));
      lights.dispose();
      return share;
    });
    expect(shares[0], "nobody awake").toBe(0);
    for (let people = 1; people < shares.length; people++) expect(shares[people]!, `${people} awake against ${people - 1}`).toBeGreaterThan(shares[people - 1]!);
    expect(Math.abs(shares[1]! - HOME_SHARE_BY_AWAKE[1]!), "one awake").toBeLessThan(1 / 254 + EPSILON);
    const lights = new HomeLights(homes);
    lights.step(awakeEverywhere(200));
    expect(shareOfTexel(lights.texelOf(0)), "a crowd is the top share").toBeCloseTo(HOME_SHARE_BY_AWAKE.at(-1)!, 2);
    lights.dispose();
  });

  // mutation: sed -i 's/Math.max(-HOME_FADE_PER_MINUTE, Math.min(HOME_FADE_PER_MINUTE, target - level))/(target - level)/' src/game/present/facade-homes.ts
  it("when someone wakes in a dark home and later goes to bed, then its share rises and falls a step a minute, never more than the fade, and reaches the share at last", () => {
    const lights = new HomeLights(homes);
    lights.step(awakeEverywhere(0));
    const awake = awakeEverywhere(0);
    awake[homes[0]!.place] = 3;
    let previous = shareOfTexel(lights.texelOf(0));
    let steps = 0;
    while (steps < 100 && Math.abs(previous - HOME_SHARE_BY_AWAKE[3]!) > 1 / 254) {
      lights.step(awake);
      const now = shareOfTexel(lights.texelOf(0));
      expect(now - previous, `rise at step ${steps}`).toBeLessThanOrEqual(HOME_FADE_PER_MINUTE + 1 / 254);
      expect(now, `rise at step ${steps}`).toBeGreaterThan(previous);
      previous = now;
      steps++;
    }
    expect(steps, "minutes to reach three awake's share").toBeGreaterThanOrEqual(Math.floor(HOME_SHARE_BY_AWAKE[3]! / HOME_FADE_PER_MINUTE));
    expect(steps, "minutes to reach three awake's share").toBeLessThan(20);
    awake[homes[0]!.place] = 0;
    let falls = 0;
    while (falls < 100 && shareOfTexel(lights.texelOf(0)) > 0) {
      lights.step(awake);
      const now = shareOfTexel(lights.texelOf(0));
      expect(previous - now, `fall at step ${falls}`).toBeLessThanOrEqual(HOME_FADE_PER_MINUTE + 1 / 254);
      previous = now;
      falls++;
    }
    expect(falls, "minutes to go dark").toBeGreaterThan(3);
    expect(shareOfTexel(lights.texelOf(0)), "dark again").toBe(0);
    expect(shareOfTexel(lights.texelOf(1)), "another home was never lit").toBe(0);
    lights.dispose();
  });

  // mutation: sed -i 's/const next = this.placed && !settles ? /const next = this.placed ? /' src/game/present/facade-homes.ts
  it("when the clock is skipped and the step settles, then a dark home goes straight to its share and a lit home straight to dark, not a fade step each", () => {
    const lights = new HomeLights(homes);
    const awake = awakeEverywhere(0);
    awake[homes[0]!.place] = 3;
    lights.step(awakeEverywhere(0));
    lights.step(awake, true);
    expect(Math.abs(shareOfTexel(lights.texelOf(0)) - HOME_SHARE_BY_AWAKE[3]!), "a dark home settled to three awake's share").toBeLessThan(1 / 254 + EPSILON);
    lights.step(awakeEverywhere(0), true);
    expect(shareOfTexel(lights.texelOf(0)), "and settled dark again").toBe(0);
    lights.dispose();
  });

  // mutation: sed -i 's/    if (changed) this.texture.needsUpdate = true;/    this.texture.needsUpdate = true;/' src/game/present/facade-homes.ts
  it("when a minute changes nothing, then the texture is not sent again, and when it changes a home, it is", () => {
    const lights = new HomeLights(homes);
    const awake = awakeEverywhere(1);
    lights.step(awake);
    for (let minute = 0; minute < 5; minute++) lights.step(awake);
    const settled = FACADE_HOMES.value.version;
    lights.step(awake);
    expect(FACADE_HOMES.value.version, "a step that moved nothing").toBe(settled);
    awake[homes[0]!.place] = 4;
    lights.step(awake);
    expect(FACADE_HOMES.value.version, "a step that moved a home").toBeGreaterThan(settled);
    lights.dispose();
  });

  // mutation: sed -i 's/    if (FACADE_HOMES.value === this.texture) {/    if (false) {/' src/game/present/facade-homes.ts
  it("when the homes' lights are let go, then the shaders read the empty texture again, and a style falls back to its fixed share", () => {
    const lights = new HomeLights(homes);
    lights.step(awakeEverywhere(2));
    const mine = FACADE_HOMES.value;
    lights.dispose();
    expect(FACADE_HOMES.value, "the texture was replaced").not.toBe(mine);
    expect(FACADE_HOMES_FRAME.value.z, "an empty one-texel grid").toBe(1);
    expect(FACADE_HOMES.value.image.data![0], "no home in it").toBe(0);
  });
});
