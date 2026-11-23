import { describe, expect, it } from "vitest";
import { LookRay } from "../ai/civilians/civilian-look.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { hypot3 } from "../kernel/physics-core.js";
import { ACT, Act } from "../net/act-codec.ts";
import { WEAPONS } from "./engine-onfoot-arms.ts";
import { type ActorPlace, OpenWorldActs, PlayerBlows } from "./engine-openworld-acts.ts";

const HOST = 0;
const GUEST = 1;
const VICTIM = 2;
const PISTOL_SLOT = 1;
const SHOTGUN_SLOT = 2;
/** The guest's torso, level and facing +z. */
const GUEST_AT: ActorPlace = { x: 10, y: 1, z: 20, heading: 0 };
const SHOT_FROM_EYE = { x: 10, y: 2.3, z: 20 };

type Punch = { actor: number; x: number; z: number; dirX: number; dirZ: number };
type Shot = { actor: number; ray: LookRay };
type Sent = { kind: number; arg: number; eyeX: number; dirZ: number };

/** The host's acts over a stub director: who stands where, the clock, and what the director was asked to resolve and the guest sent. */
function rig(guest = false) {
  const places = new Map<number, ActorPlace>([[GUEST, GUEST_AT]]);
  const clock = { now: 100 };
  const punches: Punch[] = [];
  const shots: Shot[] = [];
  const sent: Sent[] = [];
  const fired = { count: 0 };
  /** The car each seated actor sits in, and the get-ins and get-outs the seats were asked to carry out. */
  const seated = new Map<number, number>();
  const getIns: { actor: number; car: number }[] = [];
  const getOuts: number[] = [];
  const acts = new OpenWorldActs(
    {
      actorPlace: (actor, out) => {
        const place = places.get(actor);
        if (place) Object.assign(out, place);
        return place !== undefined;
      },
      now: () => clock.now,
      self: () => (guest ? GUEST : HOST),
      guest: () => guest,
      sendAct: (kind, arg, eye, dir) => void sent.push({ kind, arg, eyeX: eye.x, dirZ: dir.z }),
      seatedCar: (actor) => seated.get(actor) ?? -1,
      getIn: (actor, car) => {
        getIns.push({ actor, car });
        return 0;
      },
      getOut: (actor) => {
        getOuts.push(actor);
        return 0;
      },
    },
    {
      punch: (actor, x, z, dirX, dirZ) => void punches.push({ actor, x, z, dirX, dirZ }),
      shoot: (actor, ray) => {
        shots.push({ actor, ray: Object.assign(new LookRay(), ray) });
        return 7;
      },
      shotFired: () => void fired.count++,
    },
  );
  return { acts, places, clock, punches, shots, sent, fired, seated, getIns, getOuts };
}

/** An act of `kind` whose eye is `away` m east of the guest's torso (and 1.3 m up for a shot), along `dir`. */
function actAt(kind: number, arg: number, away: number, dir = { x: 0, y: 0, z: 1 }): Act {
  const act = new Act();
  act.kind = kind;
  act.arg = arg;
  act.eyeX = SHOT_FROM_EYE.x + away;
  act.eyeY = SHOT_FROM_EYE.y;
  act.eyeZ = SHOT_FROM_EYE.z;
  act.dirX = dir.x;
  act.dirY = dir.y;
  act.dirZ = dir.z;
  return act;
}

describe("given a host that hears a guest's acts while the guest stands on foot at (10, 1, 20)", () => {
  const eyeCases = [
    { it: "when the guest's punch names an eye 2 m from his torso, then the host throws it as car 1's from his torso along the act's direction", kind: ACT.punch, arg: 0, away: 2, expected: 1 },
    { it: "when the guest's punch names an eye 10 m from his torso, then nothing is thrown", kind: ACT.punch, arg: 0, away: 10, expected: 0 },
    { it: "when the guest's shot names an eye 2 m from his torso, then the host fires it", kind: ACT.shot, arg: PISTOL_SLOT, away: 2, expected: 1 },
    { it: "when the guest's shot names an eye 10 m from his torso, then nothing is fired", kind: ACT.shot, arg: PISTOL_SLOT, away: 10, expected: 0 },
  ] as const;
  for (const testCase of eyeCases) {
    it(testCase.it, () => {
      const r = rig();
      r.acts.hear(GUEST, actAt(testCase.kind, testCase.arg, testCase.away));
      const resolved = testCase.kind === ACT.punch ? r.punches : r.shots;
      expect(resolved.length, "acts carried out").toBe(testCase.expected);
      if (testCase.expected === 0) return;
      const first = testCase.kind === ACT.punch ? r.punches[0]! : r.shots[0]!;
      expect(first.actor, "the actor").toBe(GUEST);
      if ("x" in first) expect([first.x, first.z, first.dirX, first.dirZ], "from his torso along the act's direction").toEqual([10, 20, 0, 1]);
    });
  }

  it("when the guest is not on foot, then his punch and his shot do nothing; on foot again they do", () => {
    const r = rig();
    r.places.delete(GUEST);
    r.acts.hear(GUEST, actAt(ACT.punch, 0, 0));
    r.acts.hear(GUEST, actAt(ACT.shot, PISTOL_SLOT, 0));
    expect([r.punches.length, r.shots.length, r.fired.count], "carried out while he is in his car").toEqual([0, 0, 0]);
    r.places.set(GUEST, GUEST_AT);
    r.acts.hear(GUEST, actAt(ACT.punch, 0, 0));
    r.clock.now += 1;
    r.acts.hear(GUEST, actAt(ACT.shot, PISTOL_SLOT, 0));
    expect([r.punches.length, r.shots.length, r.fired.count], "carried out once he stands").toEqual([1, 1, 1]);
  });

  const cooldownCases = [
    { it: "when two pistol shots come 0.1 s apart, then one is fired", kind: ACT.shot, arg: PISTOL_SLOT, gap: 0.1, expected: 1 },
    { it: "when two pistol shots come 0.3 s apart, then both are fired", kind: ACT.shot, arg: PISTOL_SLOT, gap: 0.3, expected: 2 },
    { it: "when two punches come 0.3 s apart, then one is thrown", kind: ACT.punch, arg: 0, gap: 0.3, expected: 1 },
    { it: "when two punches come 0.6 s apart, then both are thrown", kind: ACT.punch, arg: 0, gap: 0.6, expected: 2 },
  ] as const;
  for (const testCase of cooldownCases) {
    it(testCase.it, () => {
      const r = rig();
      r.acts.hear(GUEST, actAt(testCase.kind, testCase.arg, 0));
      r.clock.now += testCase.gap;
      r.acts.hear(GUEST, actAt(testCase.kind, testCase.arg, 0));
      expect(testCase.kind === ACT.punch ? r.punches.length : r.fired.count, "acts carried out").toBe(testCase.expected);
    });
  }

  it("when the act is another family's, or its weapon is not a gun, then the host does nothing; a pistol shot beside them is fired", () => {
    const r = rig();
    for (const kind of [ACT.hookFire, ACT.hookCut, ACT.hookReelOn, ACT.hookReelOff, ACT.getIn, ACT.getOut]) r.acts.hear(GUEST, actAt(kind, 0, 0));
    for (const arg of [0, 4, 9]) r.acts.hear(GUEST, actAt(ACT.shot, arg, 0));
    expect([r.punches.length, r.shots.length], "carried out").toEqual([0, 0]);
    r.acts.hear(GUEST, actAt(ACT.shot, PISTOL_SLOT, 0));
    expect(r.shots.length, "the pistol shot").toBe(1);
  });

  it("when the direction is not a unit vector, then nothing is carried out", () => {
    const r = rig();
    r.acts.hear(GUEST, actAt(ACT.punch, 0, 0, { x: 0, y: 0, z: 0 }));
    r.acts.hear(GUEST, actAt(ACT.shot, PISTOL_SLOT, 0, { x: 0, y: 0, z: 3 }));
    expect([r.punches.length, r.shots.length], "carried out").toEqual([0, 0]);
  });
});

/** The angle (rad) between two unit rays. */
function angleBetween(a: LookRay, b: LookRay): number {
  return Math.acos(Math.min(1, a.dirX * b.dirX + a.dirY * b.dirY + a.dirZ * b.dirZ));
}

describe("given a guest's shotgun shot heard by the host", () => {
  const aim = actAt(ACT.shot, SHOTGUN_SLOT, 0, { x: 0, y: 0, z: 1 });
  const sight = Object.assign(new LookRay(), { eyeX: aim.eyeX, eyeY: aim.eyeY, eyeZ: aim.eyeZ, dirX: 0, dirY: 0, dirZ: 1 });

  it("when it is carried out, then eight rays leave the eye, each inside the gun's cone of the sight line and not all the same, and the law hears one shot", () => {
    const r = rig();
    r.acts.hear(GUEST, aim);
    expect(r.shots.length, "rays").toBe(WEAPONS.shotgun.rays);
    expect(r.fired.count, "shots the law heard").toBe(1);
    for (const shot of r.shots) {
      expect(angleBetween(shot.ray, sight), "ray off the sight line (rad)").toBeLessThanOrEqual(WEAPONS.shotgun.cone + 1e-9);
      expect(hypot3(shot.ray.eyeX - aim.eyeX, shot.ray.eyeY - aim.eyeY, shot.ray.eyeZ - aim.eyeZ), "ray from the eye (m)").toBeLessThan(1e-9);
    }
    expect(new Set(r.shots.map((shot) => shot.ray.dirX)).size, "distinct rays").toBeGreaterThan(1);
  });

  it("when the same act is heard again after its cooldown, then its rays fall elsewhere; a fresh host given the same acts draws the same rays", () => {
    const first = rig();
    first.acts.hear(GUEST, aim);
    first.clock.now += 1;
    first.acts.hear(GUEST, aim);
    const second = rig();
    second.acts.hear(GUEST, aim);
    const sameAsFirst = first.shots.slice(0, 8).every((shot, at) => shot.ray.dirX === second.shots[at]!.ray.dirX);
    const repeated = first.shots.slice(8).every((shot, at) => shot.ray.dirX === first.shots[at]!.ray.dirX);
    expect(sameAsFirst, "a fresh host's first shot").toBe(true);
    expect(repeated, "the replayed shot's rays equal the first's").toBe(false);
  });
});

describe("given this machine's own player", () => {
  it("when the host's player punches and fires, then it is the host's own punchBy and shootBy for car 0 that carry them out", () => {
    const r = rig();
    r.places.set(HOST, { x: 1, y: 1, z: 2, heading: 0 });
    r.acts.punchLanded(0, 1);
    const far = r.acts.shootLocal(Object.assign(new LookRay(), { dirZ: 1 }), WEAPONS.pistol);
    expect(r.punches.length, "punches").toBe(1);
    expect(firstMismatch([r.punches[0]!.actor, r.punches[0]!.x, r.punches[0]!.z], [HOST, 1, 2]), "the punch's actor and place").toBeUndefined();
    expect(firstMismatch(r.shots.map((shot) => shot.actor), [HOST]), "the actors the rays were fired for").toBeUndefined();
    expect(far, "how far the farthest ray went").toBe(7);
    expect(r.sent.length, "nothing is sent by the host").toBe(0);
  });

  it("when a guest's player punches and fires, then both are sent to the host as acts and nothing is carried out on his machine", () => {
    const r = rig(true);
    r.acts.punchLanded(0, 1);
    const aim = Object.assign(new LookRay(), { eyeX: 3, dirZ: 1 });
    const far = r.acts.shootLocal(aim, WEAPONS.shotgun);
    expect(r.sent.length, "acts sent").toBe(2);
    expect(firstMismatch(r.sent.flatMap((act) => [act.kind, act.arg, act.eyeX, act.dirZ]), [ACT.punch, 0, 10, 1, ACT.shot, SHOTGUN_SLOT, 3, 1]), "kind, arg, eye x and direction z of each act").toBeUndefined();
    expect(far, "the tracer's length (m)").toBeGreaterThan(10);
    expect([r.punches.length, r.shots.length], "carried out locally").toEqual([0, 0]);
  });
});

/** Three players on foot at the points `places` names; punches on them noted. */
function crowdOfPlayers() {
  const places = new Map<number, ActorPlace>([[HOST, { x: 0, y: 1, z: 0, heading: 0 }], [VICTIM, { x: 0, y: 1, z: 1, heading: 0 }]]);
  const struck: { victim: number; knockedOut: boolean }[] = [];
  const blows = new PlayerBlows({
    actorPlace: (actor, out) => {
      const place = places.get(actor);
      if (place) Object.assign(out, place);
      return place !== undefined;
    },
    cars: () => [0, 1, 2],
    strikeActor: (victim, _dirX, _dirZ, knockedOut) => void struck.push({ victim, knockedOut }),
  });
  return { places, struck, blows };
}

describe("given another player on foot a metre ahead of a puncher", () => {
  it("when the puncher punches him three times inside ten seconds, then he is staggered by the first two and knocked out by the third", () => {
    const { struck, blows } = crowdOfPlayers();
    for (const now of [0, 1, 2]) expect(blows.punch(HOST, 0, 0, 0, 1, now), `punch at ${now} s`).toBe(true);
    expect(struck.length, "blows landed").toBe(3);
    expect(firstMismatch(struck.map((blow) => (blow.victim === VICTIM && blow.knockedOut ? 1 : 0)), [0, 0, 1]), "which blows knocked him out").toBeUndefined();
  });

  it("when the punches are more than ten seconds apart, then none knocks him out", () => {
    const { struck, blows } = crowdOfPlayers();
    for (const now of [0, 11, 22]) blows.punch(HOST, 0, 0, 0, 1, now);
    expect(struck.length, "blows landed").toBe(3);
    expect(struck.some((blow) => blow.knockedOut), "a knock-out").toBe(false);
  });

  it("when he stands behind the puncher or out of reach, or is the puncher, then no player takes the punch", () => {
    const { places, struck, blows } = crowdOfPlayers();
    expect(blows.punch(HOST, 0, 0, 0, -1, 0), "punching away from him").toBe(false);
    places.set(VICTIM, { x: 0, y: 1, z: 3, heading: 0 });
    expect(blows.punch(HOST, 0, 0, 0, 1, 0), "punching past reach").toBe(false);
    places.delete(VICTIM);
    expect(blows.punch(HOST, 0, 0, 0, 1, 0), "punching only himself").toBe(false);
    expect(struck.length, "blows landed").toBe(0);
  });
});
