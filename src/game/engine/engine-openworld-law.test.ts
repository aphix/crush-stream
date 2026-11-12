import { describe, expect, it } from "vitest";
import { buildFixtureMap } from "../ai/civilians/civilian-graph.test-util.ts";
import { FRAME_SECONDS } from "../ai/civilians/civilian-crowd.test-util.ts";
import { BODY_GAP } from "../ai/civilians/civilian-crowd-constants.ts";
import { EVENT_KIND, RESIDENT_INT, RESIDENT_INT_STRIDE, SPECIES } from "../ai/civilians/civilian-constants.ts";
import type { CivilianCrowd } from "../ai/civilians/civilian-crowd.ts";
import { hypot2 } from "../kernel/physics-core.js";
import { FakeField } from "../ai/openworld-traffic/traffic-world.test-util.ts";
import { IDLE_FOOT_ARREST } from "../ai/openworld-crime/crime-fixture.test-util.ts";
import { OpenWorldDirector, type OpenWorldPorts } from "./engine-openworld.ts";
import { idleOpenWorldPorts } from "./openworld-cull-ports.test-util.ts";
import { CASE_PHASE, SUBJECT_MODE } from "../ai/openworld-crime/case-table.ts";
import { FOOT_COP_COUNT } from "../ai/openworld-crime/crime-constants.ts";
import { blankStrike, stood } from "../scenes/figure-strike.ts";

const map = buildFixtureMap();

/** The traffic's host ports over the traffic tests' fake field of cars, with nothing drawn and nobody to drive the lobby's cars. */
function idleTrafficPorts(): NonNullable<OpenWorldPorts["traffic"]> {
  const field = new FakeField();
  return { ...field.ports, setFreeDrivers: () => {}, makeLights: () => ({ update: () => {}, dispose: () => {} }) };
}

/** The police's engine ports with no course solids, nobody to bust and no light bars. */
function idleLawPorts(): NonNullable<OpenWorldPorts["law"]> {
  return { solids: () => null, playerBusted: () => {}, sirens: () => {}, lineOfSight: () => true, footArrest: IDLE_FOOT_ARREST };
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
    expect(director["law"]!["rides"], "it has the traffic's own, none to hear").toBeNull();
  });

  // mutation: in src/game/engine/engine-openworld.ts makeLaw(), change `traffic: () => this.traffic,` to `traffic: () => null,`
  // mutation: sed -i 's/this.rides = traffic === null ? new ArrestRides/this.rides = traffic !== null ? new ArrestRides/' src/game/engine/engine-openworld-law.ts
  it("when there is no traffic (a client's director, or a harness without cars), then the police are on foot until a ride is heard", () => {
    const { director } = directorWith({ law: idleLawPorts() });
    expect(director["law"], "the law is made").not.toBeNull();
    expect(director["law"]!.patrolling, "with no cars to patrol in").toBe(false);
    expect(director["law"]!["rides"], "the host's cars are its to hear").not.toBeNull();
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

  // mutation: sed -i '/^    this.scene.foot.spare(strike.guard);/d' src/game/engine/engine-openworld-law.ts
  it("when the crowd runs down a suspect a cop holds, then the law lets her go at once and draws her in his hands no more, so a car on her spot does not run her down again every step", () => {
    const { director } = directorWith({ law: idleLawPorts() });
    const crowd: CivilianCrowd = director["crowd"]!;
    let civilian = walkingCivilian(crowd);
    for (let frame = 0; frame < 4096 && civilian < 0; frame++) {
      director.step(FRAME_SECONDS);
      civilian = walkingCivilian(crowd);
    }
    expect(civilian, "a civilian walks").toBeGreaterThanOrEqual(0);
    const foot = director["law"]!["scene"].foot;
    const x = crowd.poses.x[civilian]!;
    const z = crowd.poses.z[civilian]!;
    const caseIndex = foot.table.freeCase();
    const slot = foot.table.slotOf(caseIndex, 0);
    foot.table.phase[caseIndex] = CASE_PHASE.open;
    foot.table.take(slot, civilian, foot.seconds, x, z);
    foot.table.mode[slot] = SUBJECT_MODE.gripped;
    foot.table.holder[slot] = 0;
    foot.table.setCop(caseIndex, 0, 0);
    foot.walkers.place(FOOT_COP_COUNT + slot, x, z);
    foot.walkers.place(0, x + 0.6, z);
    foot.cops.grip(0);
    director.step(FRAME_SECONDS);
    expect(crowd.poses.shown[civilian], "control: the law draws her in his hands").toBe(1);
    crowd["knockDown"](civilian, crowd.crowdSeconds, stood(-1, civilian, x, 0, z, 0, 1, blankStrike()));
    director.step(FRAME_SECONDS);
    director.step(FRAME_SECONDS);
    expect(foot.table.mode[slot], "let go").toBe(SUBJECT_MODE.free);
    expect(crowd.poses.shown[civilian], "not drawn standing where she was run down").toBe(0);
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

describe("given the player on foot in the open world", () => {
  const PLAYER_AT = 120;
  /** The frames a hold and a few metres of street take: the bust hold (12 s), the cop's run to him and the lead away, at 60 frames a second, with room to spare. */
  const MAX_ARREST_FRAMES = 60 * 40;

  /** A solo host with the player standing at `PLAYER_AT` along x, a foot cop standing five metres from him, and the crowd stepped once so its log can take a shove; `footArrest` hears his arrest. */
  function playerWithCop(footArrest = IDLE_FOOT_ARREST) {
    const { director } = directorWith({
      law: { ...idleLawPorts(), footArrest },
      foot: (out) => {
        out.x = PLAYER_AT;
        out.z = PLAYER_AT;
        out.velocityX = 0;
        out.velocityZ = 0;
        return true;
      },
    });
    director.step(FRAME_SECONDS);
    const scene = director["law"]!["scene"];
    scene.foot.walkers.place(0, PLAYER_AT - 5, PLAYER_AT);
    return { director, crowd: director["crowd"]!, scene };
  }

  // mutation: in src/game/engine/engine-openworld-law.ts hearShoves(), delete the line `if (authority) this.scene.playerShoved(this.shoveSeconds);`
  it("when he shoves a civilian where a cop stands, then the crowd's log of it sends the cops after him and the pursuit strip counts them", () => {
    const { director, crowd, scene } = playerWithCop();
    const strip = { cops: 0, hold: 0, left: 0 };
    expect(scene.footChaseOf(strip), "nobody after him yet").toBe(false);
    crowd.raiseEvent(EVENT_KIND.walker, 3);
    director.step(FRAME_SECONDS);
    expect(scene.footChaseOf(strip), "the shove was seen").toBe(true);
    const shown = director.bustOf(0);
    expect(shown?.cops, "the strip shows the cops after him").toBeGreaterThanOrEqual(1);
    expect(shown?.hold, "no hold yet").toBe(0);
  });

  // mutation: sed -i 's/footArrest: extra.footArrest/footArrest: { busted: () => {}, led: () => {}, taken: () => {}, delivered: () => {} }/' src/game/engine/engine-openworld.ts
  // mutation: sed -i 's/footArrest: ports.footArrest,/footArrest: { busted: () => {}, led: () => {}, taken: () => {}, delivered: () => {} },/' src/game/engine/engine-openworld-law.ts
  it("when a cop holds him the whole hold, then the engine's ports hear the arrest, his cop leading him, and where he is set down", () => {
    const heard = { busted: 0, led: 0, delivered: 0 };
    const { director, crowd } = playerWithCop({
      busted: () => void heard.busted++,
      led: () => void heard.led++,
      taken: () => {},
      delivered: () => void heard.delivered++,
    });
    crowd.raiseEvent(EVENT_KIND.walker, 3);
    for (let frame = 0; frame < MAX_ARREST_FRAMES && heard.delivered === 0; frame++) director.step(FRAME_SECONDS);
    expect(heard.busted, "his arrest").toBe(1);
    expect(heard.led, "the cop led him on the way").toBeGreaterThan(0);
    expect(heard.delivered, "set down, on a map with no station a few metres on").toBe(1);
  });

  // mutation: in src/game/engine/engine-openworld-law.ts feedFoot(), change `this.scene.setFoot(there, ` to `this.scene.setFoot(false, `
  it("when he is in a car, then the law has no walker to judge", () => {
    const { director } = directorWith({ law: idleLawPorts() });
    director.step(FRAME_SECONDS);
    director["crowd"]!.raiseEvent(EVENT_KIND.walker, 3);
    director.step(FRAME_SECONDS);
    expect(director["law"]!["scene"].footChaseOf({ cops: 0, hold: 0, left: 0 }), "nobody on foot").toBe(false);
  });
});
