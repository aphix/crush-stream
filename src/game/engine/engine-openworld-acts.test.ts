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
const RIFLE_SLOT = 3;
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
  return { acts, places, clock, punches, shots, sent, fired };
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
    { it: "when the guest's punch names an eye 2 m from his torso, then the host throws it as car 1's from his torso along the act's direction", away: 2, expected: 1 },
    { it: "when the guest's punch names an eye 10 m from his torso, then nothing is thrown", away: 10, expected: 0 },
  ] as const;
  for (const testCase of eyeCases) {
    it(testCase.it, () => {
      const r = rig();
      r.acts.hear(GUEST, actAt(ACT.punch, 0, testCase.away));
      expect(r.punches.length, "punches thrown").toBe(testCase.expected);
      if (testCase.expected === 0) return;
      const first = r.punches[0]!;
      expect(first.actor, "the actor").toBe(GUEST);
      expect([first.x, first.z, first.dirX, first.dirZ], "from his torso along the act's direction").toEqual([10, 20, 0, 1]);
    });
  }

  const rayCases = [
    { it: "when the guest's shot comes from an eye 30 m behind him along his aim, then it is carried out, from the point on that line nearest his torso", behind: 30, aside: 0, expected: 1 },
    { it: "when the same ray is moved 10 m sideways, then nothing is fired", behind: 30, aside: 10, expected: 0 },
    { it: "when the guest's shot passes 0.5 m from his torso, then it is carried out", behind: 0, aside: 0.5, expected: 1 },
  ] as const;
  for (const testCase of rayCases) {
    it(testCase.it, () => {
      const r = rig();
      const act = actAt(ACT.shot, PISTOL_SLOT, testCase.aside);
      act.eyeZ -= testCase.behind;
      r.acts.hear(GUEST, act);
      expect(r.shots.length, "rays fired").toBe(testCase.expected);
      expect(r.fired.count, "shots the law heard").toBe(testCase.expected);
      if (testCase.expected === 0) return;
      const ray = r.shots[0]!.ray;
      expect(ray.eyeZ, "the ray starts level with his torso, not at the far eye").toBeCloseTo(GUEST_AT.z, 6);
      expect(ray.eyeX, "and on the aim line").toBeCloseTo(act.eyeX, 6);
    });
  }

  it("when the shot comes from a far eye, then the distance the host reports runs from that eye, so the guest's tracer ends where the ray did", () => {
    const r = rig();
    r.places.set(HOST, GUEST_AT);
    const aim = Object.assign(new LookRay(), { eyeX: 10, eyeY: 1.3, eyeZ: -10, dirZ: 1 });
    expect(r.acts.shootBy(HOST, aim, WEAPONS.pistol), "metres from the eye to where the ray ended").toBeCloseTo(30 + 7, 6);
  });

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
    { it: "when two punches come 0.3 s apart, then one is thrown", gap: 0.3, expected: 1 },
    { it: "when two punches come 0.6 s apart, then both are thrown", gap: 0.6, expected: 2 },
  ] as const;
  for (const testCase of cooldownCases) {
    it(testCase.it, () => {
      const r = rig();
      r.acts.hear(GUEST, actAt(ACT.punch, 0, 0));
      r.clock.now += testCase.gap;
      r.acts.hear(GUEST, actAt(ACT.punch, 0, 0));
      expect(r.punches.length, "punches thrown").toBe(testCase.expected);
    });
  }

  const gunGapCases = [
    { it: "when two shotgun shots come 0.1 s apart, then one is fired", slot: SHOTGUN_SLOT, gap: 0.1, expected: 1 },
    { it: "when two shotgun shots come 0.9 s apart, then both are fired", slot: SHOTGUN_SLOT, gap: 0.9, expected: 2 },
  ] as const;
  for (const testCase of gunGapCases) {
    it(testCase.it, () => {
      const r = rig();
      r.acts.hear(GUEST, actAt(ACT.shot, testCase.slot, 0));
      r.clock.now += testCase.gap;
      r.acts.hear(GUEST, actAt(ACT.shot, testCase.slot, 0));
      expect(r.fired.count, "shots fired").toBe(testCase.expected);
    });
  }

  it("when five rifle acts are delivered in one instant after a 0.5 s gap, then all five are carried out; twenty in one instant are cut to the 0.5 s allowance", () => {
    const bunch = (acts: number): number => {
      const r = rig();
      r.clock.now += 0.5;
      for (let at = 0; at < acts; at++) r.acts.hear(GUEST, actAt(ACT.shot, RIFLE_SLOT, 0));
      return r.fired.count;
    };
    expect(bunch(5), "rifle shots carried out of five").toBe(5);
    expect(bunch(20), "rifle shots carried out of twenty").toBe(5);
  });

  it("when rifle acts keep coming twice as fast as the gun fires for two seconds, then about half are carried out, and at the gun's own rate all are", () => {
    const stream = (every: number): number => {
      const r = rig();
      for (let at = 0; at * every < 2; at++) {
        r.acts.hear(GUEST, actAt(ACT.shot, RIFLE_SLOT, 0));
        r.clock.now += every;
      }
      return r.fired.count;
    };
    const fast = stream(0.05);
    expect(fast, "shots carried out of forty sent").toBeGreaterThan(15);
    expect(fast, "shots carried out of forty sent").toBeLessThanOrEqual(24);
    expect(stream(0.12), "shots carried out at the gun's own rate").toBe(17);
  });

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
    expect(far, "how far the farthest ray went from the eye at the origin: 2 m to his torso, then the ray's 7 m").toBe(9);
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
