import { describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { buildFixtureMap } from "../ai/civilians/civilian-graph.test-util.ts";
import { FRAME_SECONDS } from "../ai/civilians/civilian-crowd.test-util.ts";
import { actorOfCopSubject, copOfCopSubject, EVENT_KIND, EVENT_TRIPLE } from "../ai/civilians/civilian-constants.ts";
import type { CivilianCrowd } from "../ai/civilians/civilian-crowd.ts";
import type { FootArrestPorts } from "../ai/openworld-crime/offence-source.ts";
import { OpenWorldDirector } from "./engine-openworld.ts";
import { idleOpenWorldPorts } from "./openworld-cull-ports.test-util.ts";

/** The guest walks this fast (m/s), more than the hold allows, for this many frames: well inside the chase's give-up time. */
const GUEST_WALK_MPS = 3;
const WALKING_FRAMES = 60 * 20;
const map = buildFixtureMap();
/** The host's own player, and the guest whose walker the host's law is told of. */
const OWN = 0;
const GUEST = 1;
/** The resident the guest shoves, and how far from her the host's own player stands (m). */
const VICTIM = 0;
const FAR_M = 400;
/** The frames a hold and a few metres of street take, with room to spare. */
const MAX_ARREST_FRAMES = 60 * 40;
/** A cop stands this far (m) from the guest. */
const COP_GAP_M = 5;

const strip = () => ({ cops: 0, hold: 0, left: 0 });

/** What the host's own engine is told of its own player's arrest. */
function recordingArrest(heard: { calls: number }): FootArrestPorts {
  const heardOne = (): void => void heard.calls++;
  return { busted: heardOne, led: heardOne, taken: heardOne, delivered: heardOne };
}

/** A solo host with two players on foot, the guest standing where the victim is drawn and a foot cop five metres from him; the crowd stepped once so its log can take a shove. `clearSpot`: whether a clear spot is found for a released player's car; `resets` takes each car sent back to its spawn. */
function hostWithTwoOnFoot(heard: { calls: number }, clearSpot = true, resets: number[] = []) {
  const places = { guestX: 0, guestZ: 0, guestVelocityX: 0 };
  const director = new OpenWorldDirector({
    ...idleOpenWorldPorts(),
    makeArt: () => ({ update: () => {}, dispose: () => {} }),
    ownActor: () => OWN,
    actorPlace: (actor, out) => {
      out.x = actor === OWN ? FAR_M : places.guestX;
      out.z = actor === OWN ? FAR_M : places.guestZ;
      out.velocityX = actor === OWN ? 0 : places.guestVelocityX;
      out.velocityZ = 0;
      return actor <= GUEST;
    },
    placeCarNear: () => clearSpot,
    law: { solids: () => null, playerBusted: (car) => void resets.push(car), sirens: () => {}, lineOfSight: () => true, footArrest: recordingArrest(heard) },
  });
  director.startOpenWorld(map);
  director.frame(FRAME_SECONDS);
  director.step(FRAME_SECONDS);
  const crowd = director["crowd"]!;
  places.guestX = crowd.poses.x[VICTIM]!;
  places.guestZ = crowd.poses.z[VICTIM]!;
  const scene = director["law"]!["scene"];
  scene.foot.walkers.place(0, places.guestX - COP_GAP_M, places.guestZ);
  director.step(FRAME_SECONDS);
  return { director, crowd, scene, places };
}

/** The players the crowd's log names as chased (`footChase`) or arrested (`footArrest`), in the order it holds them. */
function playersNamed(crowd: CivilianCrowd, kind: number): number[] {
  const log = crowd.eventLog();
  const named: number[] = [];
  for (let at = 0; at + EVENT_TRIPLE <= log.length; at += EVENT_TRIPLE) if (log[at] === kind) named.push(actorOfCopSubject(log[at + 1]!));
  return named;
}

function guestShovesVictim(crowd: CivilianCrowd): void {
  crowd.raiseEvent(EVENT_KIND.push, VICTIM);
  crowd.raiseEvent(EVENT_KIND.walker, 3);
}

describe("given a solo host in the open world with its own player and a guest both on foot and a foot cop beside the guest", () => {
  it("when the crowd's log tells of a civilian shoved where the guest stands, then the cops are after the guest, not the host's player, and the log names the guest", () => {
    const { director, crowd, scene } = hostWithTwoOnFoot({ calls: 0 });
    guestShovesVictim(crowd);
    director.step(FRAME_SECONDS);
    expect(scene.footChaseOf(strip(), GUEST), "a chase of the guest").toBe(true);
    expect(scene.footChaseOf(strip(), OWN), "a chase of the host's player").toBe(false);
    expect(firstMismatch(playersNamed(crowd, EVENT_KIND.footChase), [GUEST]), "the players the log names as chased").toBeUndefined();
  });

  it("when the log names a chase, then it names the cop who answers it first", () => {
    const { director, crowd } = hostWithTwoOnFoot({ calls: 0 });
    guestShovesVictim(crowd);
    director.step(FRAME_SECONDS);
    const log = crowd.eventLog();
    const at = log.findIndex((entry, index) => index % EVENT_TRIPLE === 0 && entry === EVENT_KIND.footChase);
    expect(at, "the chase is in the log").toBeGreaterThanOrEqual(0);
    expect(copOfCopSubject(log[at + 1]!), "the cop beside the guest").toBe(0);
  });

  it("when a cop holds the guest the whole hold, then the log names the guest's arrest and the host's own engine is told nothing of it", () => {
    const heard = { calls: 0 };
    const { director, crowd } = hostWithTwoOnFoot(heard);
    guestShovesVictim(crowd);
    for (let frame = 0; frame < MAX_ARREST_FRAMES && playersNamed(crowd, EVENT_KIND.footArrest).length === 0; frame++) director.step(FRAME_SECONDS);
    expect(firstMismatch(playersNamed(crowd, EVENT_KIND.footArrest), [GUEST]), "the players the log names as arrested").toBeUndefined();
    expect(heard.calls, "calls to the host's own engine about its own player's arrest").toBe(0);
  });

  it("when the guest keeps walking at 3 m/s with the cop behind him, then the hold never fills: the chase stays open and no arrest is told", () => {
    const { director, crowd, scene, places } = hostWithTwoOnFoot({ calls: 0 });
    guestShovesVictim(crowd);
    places.guestVelocityX = GUEST_WALK_MPS;
    for (let frame = 0; frame < WALKING_FRAMES; frame++) {
      places.guestX += GUEST_WALK_MPS * FRAME_SECONDS;
      director.step(FRAME_SECONDS);
    }
    expect(scene.footChaseOf(strip(), GUEST), "the cops are still after him").toBe(true);
    expect(playersNamed(crowd, EVENT_KIND.footArrest), "arrests told").toHaveLength(0);
  });

  it("when the guest fires a gun, then the cops are after the guest and not the host's player", () => {
    const { director, scene } = hostWithTwoOnFoot({ calls: 0 });
    director.shotFired(GUEST);
    director.step(FRAME_SECONDS);
    expect(scene.footChaseOf(strip(), GUEST), "a chase of the guest").toBe(true);
    expect(scene.footChaseOf(strip(), OWN), "a chase of the host's player").toBe(false);
  });

  it("when the guest punches the cop beside him, then the cops are after the guest and not the host's player", () => {
    const { director, scene, places } = hostWithTwoOnFoot({ calls: 0 });
    scene.foot.walkers.place(0, places.guestX - 1, places.guestZ);
    director.punch(GUEST, places.guestX, places.guestZ, -1, 0);
    director.step(FRAME_SECONDS);
    expect(scene.footChaseOf(strip(), GUEST), "a chase of the guest").toBe(true);
    expect(scene.footChaseOf(strip(), OWN), "a chase of the host's player").toBe(false);
  });

  const releaseCases = [
    { it: "when the guest is released at the station and a clear spot is found for his car there, then his car is not sent back to its spawn", clearSpot: true, expected: [] },
    { it: "when the guest is released at the station and no clear spot is found for his car, then his car is sent back to its spawn", clearSpot: false, expected: [GUEST] },
  ] as const;
  for (const testCase of releaseCases) {
    it(testCase.it, () => {
      const resets: number[] = [];
      const { scene } = hostWithTwoOnFoot({ calls: 0 }, testCase.clearSpot, resets);
      scene.foot.placeCarOf(GUEST, 0, 0, 0);
      expect(resets, "cars sent back to their spawn").toEqual(testCase.expected);
    });
  }
});
