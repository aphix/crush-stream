import { describe, expect, it } from "vitest";
import { LookRay } from "../ai/civilians/civilian-look.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { hypot3 } from "../kernel/physics-core.js";
import { ACT, Act, NAMED } from "../net/act-codec.ts";
import { WEAPONS } from "./engine-onfoot-arms.ts";
import { OpenWorldActs } from "./engine-openworld-acts.ts";
import type { ActorPlace } from "./engine-openworld-law.ts";

const GUEST = 1;
const PISTOL_SLOT = 1;
const SHOTGUN_SLOT = 2;
/** The guest's torso, and his eye 0.3 m over it, aiming along +z. */
const TORSO: ActorPlace = { x: 10, y: 1, z: 20, heading: 0, velocityX: 0, velocityZ: 0 };
const PERSON_ID = 7;
const CAR_ID = 2;

type Point = { x: number; y: number; z: number };

/** The host's acts over a stub director that puts every named thing at `stands` (null: nowhere) and has a wall wherever `wallZ` says. */
function rig() {
  const clock = { now: 100 };
  const stands = { at: null as Point | null, speed: 0 };
  const wallZ: number[] = [];
  const asked: number[][] = [];
  const shots: LookRay[] = [];
  const hooks: { ray: LookRay; sawPerson: boolean }[] = [];
  const acts = new OpenWorldActs(
    {
      actorPlace: (_actor, out) => (Object.assign(out, TORSO), true),
      now: () => (clock.now += 1),
      self: () => 0,
      guest: () => false,
      face: () => {},
      layGun: () => false,
      sendAct: () => {},
      seatedCar: () => -1,
      getIn: () => 0,
      getOut: () => 0,
      hookFire: (_actor, ray, sawPerson) => void hooks.push({ ray: Object.assign(new LookRay(), ray), sawPerson }),
      hookCut: () => {},
      hookReel: () => {},
    },
    {
      punch: () => {},
      shoot: (_actor, ray) => (shots.push(Object.assign(new LookRay(), ray)), 7),
      meet: () => 0,
      wallBetween: (_ax, _ay, az, _bx, _by, bz) => wallZ.some((wall) => (az - wall) * (bz - wall) < 0),
      placeNamed: (kind, id, ox, oy, oz, out) => {
        asked.push([kind, id, ox, oy, oz]);
        if (stands.at === null) return false;
        Object.assign(out, stands.at, { speed: stands.speed });
        return true;
      },
      shotFired: () => {},
    },
  );
  return { acts, stands, wallZ, asked, shots, hooks };
}

/** A shot (or a hook fire) from the guest's eye along +z that names thing `kind` `id` hit at (0, 1, 0) from its origin. */
function actNaming(kind: number, named: number, id: number, offset: Point = { x: 0, y: 1, z: 0 }, arg = PISTOL_SLOT): Act {
  const act = new Act();
  act.kind = kind;
  act.arg = arg;
  act.eyeX = TORSO.x;
  act.eyeY = TORSO.y + 0.3;
  act.eyeZ = TORSO.z;
  act.dirZ = 1;
  act.named.kind = named;
  act.named.id = id;
  act.named.x = offset.x;
  act.named.y = offset.y;
  act.named.z = offset.z;
  return act;
}

/** The unit direction from the eye of `actNaming` to `at`. */
function toward(at: Point): number[] {
  const dx = at.x - TORSO.x;
  const dy = at.y - (TORSO.y + 0.3);
  const dz = at.z - TORSO.z;
  const length = hypot3(dx, dy, dz);
  return [dx / length, dy / length, dz / length];
}

const dirOf = (ray: LookRay): number[] => [ray.dirX, ray.dirY, ray.dirZ];
const STRAIGHT = [0, 0, 1];
/** The pistol scatters each ray inside its cone: a direction is "along a line" within it. */
const AIM_TOLERANCE = WEAPONS.pistol.cone + 1e-6;

describe("given a host that hears a guest's shot naming a person, the guest aiming along +z from (10, 1.3, 20)", () => {
  it("when she now stands 1.5 m off the sent line, 15 m ahead, then the rays leave from his eye along the line to where she stands, not along the sent line", () => {
    const r = rig();
    const at = { x: 11.5, y: 1.3, z: 35 };
    r.stands.at = at;
    r.acts.hear(GUEST, actNaming(ACT.shot, NAMED.civilian, PERSON_ID));
    expect(r.shots.length, "rays fired").toBe(1);
    expect(firstMismatch(dirOf(r.shots[0]!), toward(at), AIM_TOLERANCE), "the ray's direction").toBeUndefined();
  });

  it("when the act names civilian 7 hit 0.3 m right of and 1.1 m over her origin, then the host asks where she stands with that kind, index and offset", () => {
    const r = rig();
    r.acts.hear(GUEST, actNaming(ACT.shot, NAMED.civilian, PERSON_ID, { x: 0.3, y: 1.1, z: 0 }));
    expect(firstMismatch(r.asked[0] ?? [], [NAMED.civilian, PERSON_ID, 0.3, 1.1, 0], 0.01), "what the host asked").toBeUndefined();
  });

  const keepsTheLine = [
    { it: "when she now stands 6 m off the sent line, farther than a sprint can have moved since the oldest view, then the shot goes along the sent line", at: { x: 16, y: 1.3, z: 35 } },
    { it: "when she is beyond the pistol's range from his eye, then the shot goes along the sent line", at: { x: 10.5, y: 1.3, z: 20 + WEAPONS.pistol.range + 5 } },
  ] as const;
  for (const testCase of keepsTheLine) {
    it(testCase.it, () => {
      const r = rig();
      r.stands.at = testCase.at;
      r.acts.hear(GUEST, actNaming(ACT.shot, NAMED.civilian, PERSON_ID));
      expect(r.shots.length, "rays fired").toBe(1);
      expect(firstMismatch(dirOf(r.shots[0]!), STRAIGHT, AIM_TOLERANCE), "the ray's direction").toBeUndefined();
    });
  }

  it("when a wall stands between his eye and where she stands now, then the shot goes along the sent line and not through the wall to her", () => {
    const r = rig();
    r.stands.at = { x: 11.5, y: 1.3, z: 35 };
    r.wallZ.push(28);
    r.acts.hear(GUEST, actNaming(ACT.shot, NAMED.civilian, PERSON_ID));
    expect(firstMismatch(dirOf(r.shots[0]!), STRAIGHT, AIM_TOLERANCE), "the ray's direction").toBeUndefined();
  });

  it("when she is not there (the host knows no such person), or the offset is larger than a person, then the shot goes along the sent line and an offset past a person is never asked about", () => {
    const r = rig();
    r.acts.hear(GUEST, actNaming(ACT.shot, NAMED.civilian, PERSON_ID));
    expect(firstMismatch(dirOf(r.shots[0]!), STRAIGHT, AIM_TOLERANCE), "no such person: the ray's direction").toBeUndefined();
    r.stands.at = { x: 11.5, y: 1.3, z: 35 };
    r.asked.length = 0;
    r.acts.hear(GUEST, actNaming(ACT.shot, NAMED.civilian, PERSON_ID, { x: 5, y: 1, z: 0 }, PISTOL_SLOT));
    expect(r.asked.length, "asked about an offset of 5 m").toBe(0);
    expect(firstMismatch(dirOf(r.shots[1]!), STRAIGHT, AIM_TOLERANCE), "a person 5 m wide: the ray's direction").toBeUndefined();
  });

  it("when the act names nothing, then the host never asks and the shot goes along the sent line", () => {
    const r = rig();
    r.stands.at = { x: 11.5, y: 1.3, z: 35 };
    r.acts.hear(GUEST, actNaming(ACT.shot, NAMED.nothing, 0));
    expect(r.asked.length, "questions asked").toBe(0);
    expect(firstMismatch(dirOf(r.shots[0]!), STRAIGHT, AIM_TOLERANCE), "the ray's direction").toBeUndefined();
  });
});

describe("given a host that hears a guest's shot naming a car, and then a shotgun's pellets", () => {
  it("when a car moving at 20 m/s now stands 10 m off the sent line, then the shot is aimed at it; the same 10 m for a person standing still is refused", () => {
    const r = rig();
    const at = { x: 20, y: 1.3, z: 35 };
    r.stands.at = at;
    r.stands.speed = 20;
    r.acts.hear(GUEST, actNaming(ACT.shot, NAMED.car, CAR_ID));
    expect(firstMismatch(dirOf(r.shots[0]!), toward(at), AIM_TOLERANCE), "the car: the ray's direction").toBeUndefined();
    r.stands.speed = 0;
    r.acts.hear(GUEST, actNaming(ACT.shot, NAMED.player, PERSON_ID));
    expect(firstMismatch(dirOf(r.shots[1]!), STRAIGHT, AIM_TOLERANCE), "a player: the ray's direction").toBeUndefined();
  });

  it("when a car moving at 60 m/s, a boosted player car, now stands 30 m off the sent line, then the shot is aimed at it; a parked car 20 m off the line is refused", () => {
    const r = rig();
    const fast = { x: 40, y: 1.3, z: 35 };
    r.stands.at = fast;
    r.stands.speed = 60;
    r.acts.hear(GUEST, actNaming(ACT.shot, NAMED.car, CAR_ID));
    expect(firstMismatch(dirOf(r.shots[0]!), toward(fast), AIM_TOLERANCE), "the fast car: the ray's direction").toBeUndefined();
    r.stands.at = { x: 30, y: 1.3, z: 35 };
    r.stands.speed = 0;
    r.acts.hear(GUEST, actNaming(ACT.shot, NAMED.car, CAR_ID));
    expect(firstMismatch(dirOf(r.shots[1]!), STRAIGHT, AIM_TOLERANCE), "the parked car: the ray's direction").toBeUndefined();
  });

  it("when a civilian standing still is named 3.9 m off the sent line, then the shot goes along the sent line", () => {
    const r = rig();
    r.stands.at = { x: 13.9, y: 1.3, z: 35 };
    r.acts.hear(GUEST, actNaming(ACT.shot, NAMED.civilian, PERSON_ID));
    expect(firstMismatch(dirOf(r.shots[0]!), STRAIGHT, AIM_TOLERANCE), "the ray's direction").toBeUndefined();
  });

  it("when a shotgun shot names a person, then every pellet stays within the shotgun's cone of the line to her", () => {
    const r = rig();
    const at = { x: 11.5, y: 1.3, z: 35 };
    r.stands.at = at;
    r.acts.hear(GUEST, actNaming(ACT.shot, NAMED.civilian, PERSON_ID, { x: 0, y: 1, z: 0 }, SHOTGUN_SLOT));
    const line = toward(at);
    expect(r.shots.length, "pellets").toBe(WEAPONS.shotgun.rays);
    for (const pellet of r.shots) expect(Math.acos(Math.min(1, pellet.dirX * line[0]! + pellet.dirY * line[1]! + pellet.dirZ * line[2]!)), "angle from the line to her (rad)").toBeLessThanOrEqual(WEAPONS.shotgun.cone + 1e-6);
  });
});

describe("given a host that hears a guest's hook fire naming the person his reticle lit", () => {
  it("when she now stands 1.5 m off the line, then the hook is fired along the line to her, knowing a person was lit", () => {
    const r = rig();
    const at = { x: 11.5, y: 1.3, z: 35 };
    r.stands.at = at;
    r.acts.hear(GUEST, actNaming(ACT.hookFire, NAMED.civilian, PERSON_ID));
    expect(r.hooks.length, "hook fires").toBe(1);
    expect(firstMismatch(dirOf(r.hooks[0]!.ray), toward(at), AIM_TOLERANCE), "the hook's direction").toBeUndefined();
    expect(r.hooks[0]!.sawPerson, "a person was lit").toBe(true);
  });

  const keepsTheLine = [
    { it: "when she stands 6 m off the line, then the hook goes along the sent line and still knows a person was lit", at: { x: 16, y: 1.3, z: 35 }, wall: 0 },
    { it: "when a wall stands between his torso and where she stands, then the hook goes along the sent line", at: { x: 11.5, y: 1.3, z: 35 }, wall: 28 },
  ] as const;
  for (const testCase of keepsTheLine) {
    it(testCase.it, () => {
      const r = rig();
      r.stands.at = testCase.at;
      if (testCase.wall > 0) r.wallZ.push(testCase.wall);
      r.acts.hear(GUEST, actNaming(ACT.hookFire, NAMED.civilian, PERSON_ID));
      expect(firstMismatch(dirOf(r.hooks[0]!.ray), STRAIGHT, AIM_TOLERANCE), "the hook's direction").toBeUndefined();
      expect(r.hooks[0]!.sawPerson, "a person was lit").toBe(true);
    });
  }

  it("when the act names nothing, then the hook goes along the sent line and knows no person was lit; a car named is no person", () => {
    const r = rig();
    r.stands.at = { x: 11.5, y: 1.3, z: 35 };
    r.acts.hear(GUEST, actNaming(ACT.hookFire, NAMED.nothing, 0));
    r.acts.hear(GUEST, actNaming(ACT.hookFire, NAMED.car, CAR_ID));
    expect(r.hooks.map((fire) => fire.sawPerson), "persons lit").toEqual([false, false]);
    expect(firstMismatch(dirOf(r.hooks[1]!.ray), STRAIGHT, AIM_TOLERANCE), "a car named: the hook's direction").toBeUndefined();
  });
});
