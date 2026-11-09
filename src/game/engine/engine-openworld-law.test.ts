import { describe, expect, it } from "vitest";
import { buildFixtureMap } from "../ai/civilians/civilian-graph.test-util.ts";
import { FRAME_SECONDS } from "../ai/civilians/civilian-crowd.test-util.ts";
import { BODY_GAP } from "../ai/civilians/civilian-crowd-constants.ts";
import { RESIDENT_INT, RESIDENT_INT_STRIDE, SPECIES } from "../ai/civilians/civilian-constants.ts";
import type { CivilianCrowd } from "../ai/civilians/civilian-crowd.ts";
import { hypot2 } from "../kernel/physics-core.js";
import { OpenWorldDirector, type OpenWorldPorts } from "./engine-openworld.ts";
import { idleOpenWorldPorts } from "./openworld-cull-ports.test-util.ts";

const map = buildFixtureMap();

/** The traffic's host ports with no cars in the field and nothing drawn. */
function idleTrafficPorts(): NonNullable<OpenWorldPorts["traffic"]> {
  return { cars: () => [], ensureCars: () => {}, seated: () => false, place: () => {}, putAway: () => {}, markPolice: () => {},
    sirens: () => {},
    openDoor: () => {}, release: () => {}, setBody: () => {}, setFreeDrivers: () => {}, makeLights: () => ({ update: () => {}, dispose: () => {} }) };
}

/** The police's engine ports with no course solids, nobody to bust and no light bars. */
function idleLawPorts(): NonNullable<OpenWorldPorts["law"]> {
  return { solids: () => null, playerBusted: () => {}, sirens: () => {}, lineOfSight: () => true };
}

/** The first person the crowd shows walking (not standing at a place, where the crowd does not move her), or -1. */
function walkingCivilian(crowd: CivilianCrowd): number {
  for (let resident = 0; resident < crowd.poses.count; resident++) {
    if (crowd.poses.shown[resident] === 1 && crowd.separation.fixed[resident] === 0 && crowd.state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.species] === SPECIES.person) return resident;
  }
  return -1;
}

/** A solo host in the open world on the fixture map, past its first frame, with the ports `extra` adds. */
function directorWith(extra: Partial<OpenWorldPorts>): { director: OpenWorldDirector; arts: { made: number } } {
  const arts = { made: 0 };
  const director = new OpenWorldDirector({
    ...idleOpenWorldPorts(),
    makeArt: () => {
      arts.made++;
      return { update: () => {}, dispose: () => {} };
    },
    ...extra,
  });
  director.startOpenWorld(map);
  director.frame(FRAME_SECONDS);
  return { director, arts };
}

describe("given the open world's director", () => {
  // mutation: in src/game/engine/engine-openworld.ts start(), move `this.startTraffic(map, client);` to after `this.law = this.makeLaw(map, crowd, key & CROWD_SEED_MASK);`
  it("when the engine gives traffic and law ports, then the police lease their patrol cars from the traffic, which was made before them", () => {
    const { director } = directorWith({ traffic: idleTrafficPorts(), law: idleLawPorts() });
    expect(director["traffic"], "the traffic is up").not.toBeNull();
    expect(director["law"]!.patrolling, "the law has the traffic's cars").toBe(true);
  });

  // mutation: in src/game/engine/engine-openworld.ts makeLaw(), change `traffic: () => this.traffic,` to `traffic: () => null,`
  it("when there is no traffic (a client's director, or a harness without cars), then the police are on foot", () => {
    const { director } = directorWith({ law: idleLawPorts() });
    expect(director["law"], "the law is made").not.toBeNull();
    expect(director["law"]!.patrolling, "with no cars to patrol in").toBe(false);
  });

  // mutation: in src/game/engine/engine-openworld.ts makeLaw(), delete the line `if (extra === undefined) return null;`
  it("when the engine gives no law ports, then there are no police and no second drawing for their cops", () => {
    const { director, arts } = directorWith({});
    expect(director["law"], "no law").toBeNull();
    expect(arts.made, "the crowd's drawing only").toBe(1);
  });

  // mutation: in src/game/engine/engine-openworld.ts feedWalkers(), delete the line `this.law?.feedCops(crowd.walkers);`
  it("when a foot cop and a civilian stand on one spot, then the crowd steps the civilian round him as round any body", () => {
    const { director } = directorWith({ law: idleLawPorts() });
    const crowd: CivilianCrowd = director["crowd"]!;
    let civilian = walkingCivilian(crowd);
    for (let frame = 0; frame < 4096 && civilian < 0; frame++) {
      director.step(FRAME_SECONDS);
      civilian = walkingCivilian(crowd);
    }
    expect(civilian, "a civilian walks").toBeGreaterThanOrEqual(0);
    const cops = director["law"]!["scene"];
    cops.foot.walkers.place(0, crowd.separation.brainX[civilian]!, crowd.separation.brainZ[civilian]!);
    director.step(FRAME_SECONDS);
    director.step(FRAME_SECONDS);
    const apart = hypot2(crowd.poses.x[civilian]! - cops.copPoses.x[0]!, crowd.poses.z[civilian]! - cops.copPoses.z[0]!);
    expect(apart, "pushed apart toward a body's width").toBeGreaterThan(BODY_GAP * 0.75);
  });
});
