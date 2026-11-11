import { describe, expect, it } from "vitest";
import { hasStoop } from "../world/openworld/openworld-facade-solids.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { buildOpenWorldMap } from "../world/openworld/openworld-map.ts";
import { FRAME_SECONDS } from "../ai/civilians/civilian-crowd.test-util.ts";
import { OpenWorldDirector } from "./engine-openworld.ts";
import { idleOpenWorldPorts } from "./openworld-cull-ports.test-util.ts";

const map = buildOpenWorldMap(layOutLots());

describe("given the open world's director started on the real map", () => {
  // mutation: sed -i 's/    crowd.stoops = new Stoops(homeFrontages(stooped), Array.from(stooped, (place) => place.doorNode));/    crowd.stoops = null;/' src/game/engine/engine-openworld.ts
  it("when it starts, then its crowd lifts the walk out of a rowhome's door and none out of another place's", () => {
    const director = new OpenWorldDirector(idleOpenWorldPorts());
    director.startOpenWorld(map);
    director.frame(FRAME_SECONDS);
    const stoops = director["crowd"]!.stoops;
    expect(stoops, "the crowd's stoops").not.toBeNull();
    const doors = map.places.filter((place) => place.doorNode >= 0);
    expect(doors.filter(hasStoop).length, "rowhomes with a door").toBeGreaterThan(10);
    expect(doors.filter((place) => !hasStoop(place)).length, "places with a door and no stoop").toBeGreaterThan(10);
    for (const place of doors) expect(stoops!.leadsToDoor(place.doorNode, place.doorNode), place.name).toBe(hasStoop(place));
  });
});

describe("given the open world's director whose ports make an art that draws feet", () => {
  // mutation: sed -i 's/^    if (this.art !== null) this.art.stoops = crowd.stoops;$/    void 0;/' src/game/engine/engine-openworld.ts
  it("when it starts, then the crowd's art is given the crowd's stoops", () => {
    const arts: { stoops?: unknown; dispose(): void }[] = [];
    const director = new OpenWorldDirector({
      ...idleOpenWorldPorts(),
      makeArt: () => {
        const art = { update: () => {}, dispose: () => {} };
        arts.push(art);
        return art;
      },
    });
    director.startOpenWorld(map);
    expect(arts[0]!.stoops, "the first art made is the crowd's").toBe(director["crowd"]!.stoops);
    expect(arts[0]!.stoops, "and they are there").not.toBeNull();
  });
});
