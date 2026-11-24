import { describe, expect, it } from "vitest";
import { ARREST } from "../ai/civilians/civilian-activity.ts";
import { CASE_PHASE, SUBJECT_MODE } from "../ai/openworld-crime/case-table.ts";
import { detCos, detSin } from "../kernel/physics-core.js";
import { hasStoop, homeFrontages, STOOP } from "../world/openworld/openworld-facade-solids.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { buildOpenWorldMap } from "../world/openworld/openworld-map.ts";
import { FRAME_SECONDS } from "../ai/civilians/civilian-crowd.test-util.ts";
import { createCrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { FOOT_COP_COUNT } from "../ai/openworld-crime/crime-constants.ts";
import { IDLE_FOOT_ARREST } from "../ai/openworld-crime/crime-fixture.test-util.ts";
import { BODY_KIND, makeBodyFrame } from "../net/body-codec.ts";
import { OpenWorldDirector, type OpenWorldPorts } from "./engine-openworld.ts";
import { idleOpenWorldPorts } from "./openworld-cull-ports.test-util.ts";
import { writePoseRows } from "./openworld-shared.ts";

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
    director.frame(FRAME_SECONDS);
    expect(arts[0]!.stoops, "the first art made is the crowd's").toBe(director["crowd"]!.stoops);
    expect(arts[0]!.stoops, "and they are there").not.toBeNull();
  });
});

/** A director on the real map with the police's engine ports: no course solids, nobody to bust, no light bars. */
function lawDirector(extra: Partial<OpenWorldPorts>): OpenWorldDirector {
  const director = new OpenWorldDirector({ ...idleOpenWorldPorts(), law: { solids: () => null, playerBusted: () => {}, sirens: () => {}, lineOfSight: () => true, footArrest: IDLE_FOOT_ARREST }, ...extra });
  director.startOpenWorld(map);
  // A client has no crowd until the host's clock is heard.
  if (extra.isClient?.() === true) director.hear(1, 0, 0, new Float64Array(0));
  director.frame(FRAME_SECONDS);
  return director;
}

describe("given a foot cop at a rowhome's door in the open world", () => {
  /** The first rowhome of the map with a stoop: its door node is on the landing. */
  const house = map.places.find((place) => place.doorNode >= 0 && hasStoop(place))!;

  it("when the host's own law draws him standing there, then he is at the door sill's height", () => {
    const director = lawDirector({});
    const scene = director["law"]!["scene"];
    scene.foot.walkers.place(0, house.doorX, house.doorZ);
    director.step(FRAME_SECONDS);
    director.step(FRAME_SECONDS);
    expect(scene.copPoses.feetY[0], "his feet (m)").toBeGreaterThan(STOOP.sill - 0.1);
  });

  it("when a guest draws him from the host's record of him at the door, then he is at the sill's height there too", () => {
    const director = lawDirector({ isClient: () => true });
    const host = createCrowdPoses(FOOT_COP_COUNT);
    host.shown[0] = 1;
    host.x[0] = house.doorX;
    host.z[0] = house.doorZ;
    const frame = makeBodyFrame();
    writePoseRows(frame, BODY_KIND.cop, host, null, 0);
    director.hearBodies(frame);
    director.frame(FRAME_SECONDS);
    director.frame(FRAME_SECONDS);
    const cops = director["law"]!.copPoses;
    expect(cops.shown[0], "control: the record draws him").toBe(1);
    expect(cops.feetY[0], "his feet (m)").toBeGreaterThan(STOOP.sill - 0.1);
  });
});

describe("given a cop leading a suspect past a rowhome on the real map's sidewalk ring", () => {
  it("when he is level with its stoop with the facade on his right, then neither he nor she is lifted onto its steps", () => {
    const director = lawDirector({});
    const crowd = director["crowd"]!;
    const foot = director["law"]!["scene"].foot;
    const house = map.places.find((place) => place.doorNode >= 0 && hasStoop(place))!;
    const front = homeFrontages([house])[0]!;
    const { graph } = map;
    const ring = graph.edgeTo[graph.edgeStart[house.doorNode]!]!;
    const outX = detCos(front.yaw);
    const outZ = -detSin(front.yaw);
    const ringOut = (graph.nodeX[ring]! - front.x) * outX + (graph.nodeZ[ring]! - front.z) * outZ;
    expect(ringOut, "control: the ring's node on the door's line is clear of the bottom tread (m out)").toBeGreaterThan(STOOP.run + 0.3);
    let civilian = -1;
    for (let frame = 0; frame < 4096 && civilian < 0; frame++) {
      director.step(FRAME_SECONDS);
      for (let resident = 0; resident < crowd.poses.count && civilian < 0; resident++) if (crowd.poses.shown[resident] === 1) civilian = resident;
    }
    expect(civilian, "a civilian is drawn").toBeGreaterThanOrEqual(0);
    const caseIndex = foot.table.freeCase();
    const slot = foot.table.slotOf(caseIndex, 0);
    foot.table.phase[caseIndex] = CASE_PHASE.open;
    foot.table.take(slot, civilian, foot.seconds, graph.nodeX[ring]!, graph.nodeZ[ring]!);
    foot.table.mode[slot] = SUBJECT_MODE.escorted;
    foot.table.holder[slot] = 0;
    foot.table.setCop(caseIndex, 0, 0);
    // His yaw is the house's: his right is the facade's way, and she walks 0.38 m toward it.
    foot.walkers.place(0, graph.nodeX[ring]!, graph.nodeZ[ring]!);
    foot.walkers.place(FOOT_COP_COUNT + slot, graph.nodeX[ring]! - outX * ARREST.escortAcross, graph.nodeZ[ring]! - outZ * ARREST.escortAcross);
    foot.walkers.yaw[0] = front.yaw;
    foot.cops.grip(0);
    director.step(FRAME_SECONDS);
    const copPoses = director["law"]!.copPoses;
    expect(foot.table.mode[slot], "control: she is still being led").toBe(SUBJECT_MODE.escorted);
    expect(crowd.poses.shown[civilian], "control: she is drawn").toBe(1);
    const herOut = (crowd.poses.x[civilian]! - front.x) * outX + (crowd.poses.z[civilian]! - front.z) * outZ;
    expect(herOut, "control: she walks toward the facade of him by about her arm's reach (m)").toBeCloseTo(ringOut - ARREST.escortAcross, 1);
    expect(copPoses.feetY[0], "his feet (m)").toBe(0);
    expect(crowd.poses.feetY[civilian], "her feet (m)").toBe(0);
  });
});
