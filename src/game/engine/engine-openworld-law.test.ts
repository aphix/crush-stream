import { describe, expect, it } from "vitest";
import { buildFixtureMap } from "../ai/civilians/civilian-graph.test-util.ts";
import { FRAME_SECONDS } from "../ai/civilians/civilian-crowd.test-util.ts";
import { BODY_GAP } from "../ai/civilians/civilian-crowd-constants.ts";
import { RESIDENT_INT, RESIDENT_INT_STRIDE, SPECIES } from "../ai/civilians/civilian-constants.ts";
import type { CivilianCrowd } from "../ai/civilians/civilian-crowd.ts";
import { hypot2 } from "../kernel/physics-core.js";
import { FakeField } from "../ai/openworld-traffic/traffic-world.test-util.ts";
import { OpenWorldDirector, type OpenWorldPorts } from "./engine-openworld.ts";
import { idleOpenWorldPorts } from "./openworld-cull-ports.test-util.ts";

const map = buildFixtureMap();

/** The traffic's host ports over the traffic tests' fake field of cars, with nothing drawn and nobody to drive the lobby's cars. */
function idleTrafficPorts(): NonNullable<OpenWorldPorts["traffic"]> {
  const field = new FakeField();
  return { ...field.ports, setFreeDrivers: () => {}, makeLights: () => ({ update: () => {}, dispose: () => {} }) };
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
    expect(directorWith({ law: idleLawPorts() }).arts.made - arts.made, "the cops' drawing is one more").toBe(1);
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

describe("given patrol cars chasing the player's car", () => {
  const CAR = 3;

  /** The director with its law's strip numbers set by the row: `figures.next` is what the law reports for the car. */
  function stripDirector() {
    const { director } = directorWith({ law: idleLawPorts() });
    const figures: { next: { cops: number; hold: number; left: number } | null } = { next: null };
    director["law"]!.chaseOf = (carIndex, out) => {
      if (figures.next === null || carIndex !== CAR) return false;
      Object.assign(out, figures.next);
      return true;
    };
    return { director, figures };
  }

  // mutation: in src/game/engine/engine-openworld.ts bustOf(), change `if (this.law === null || !this.law.chaseOf(carIndex, this.bustScratch)) {` to `if (this.law === null) {`
  it("when none chases the car, then there is no strip; when one does, then the strip carries its numbers", () => {
    const { director, figures } = stripDirector();
    expect(director.bustOf(CAR), "none chasing").toBeNull();
    figures.next = { cops: 2, hold: 0.5, left: 6 };
    const strip = director.bustOf(CAR);
    expect(strip?.cops).toBe(2);
    expect(strip?.hold).toBe(0.5);
    expect(strip?.left).toBe(6);
    figures.next = null;
    expect(director.bustOf(CAR), "escaped").toBeNull();
  });

  // mutation: in src/game/engine/engine-openworld.ts bustOf(), change `if (kept !== null && kept.cops === next.cops && kept.left === left && kept.hold === hold) return kept;` to `if (false) return kept;`
  it("when the figures change by less than the strip shows, then the HUD is handed the same object, and a changed second gives a new one", () => {
    const { director, figures } = stripDirector();
    figures.next = { cops: 1, hold: 0.5, left: 6 };
    const first = director.bustOf(CAR);
    figures.next = { cops: 1, hold: 0.5004, left: 6.004 };
    expect(director.bustOf(CAR), "the same to the strip's precision").toBe(first);
    figures.next = { cops: 1, hold: 0.58, left: 5.04 };
    const next = director.bustOf(CAR);
    expect(next, "a new second").not.toBe(first);
    expect(next?.left).toBe(5);
  });
});
