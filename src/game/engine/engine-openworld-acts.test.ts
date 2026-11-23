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
type Sent = { kind: number; arg: number; eyeX: number; eyeY: number; eyeZ: number; dirX: number; dirY: number; dirZ: number };
type Looked = { ray: LookRay; range: number };

/** The host's acts over a stub director: who stands where, the clock, and what the director was asked to resolve and the guest sent. */
function rig(guest = false) {
  const places = new Map<number, ActorPlace>([[GUEST, GUEST_AT]]);
  const clock = { now: 100 };
  const punches: Punch[] = [];
  const shots: Shot[] = [];
  const sent: Sent[] = [];
  const fired = { count: 0 };
  const looks: Looked[] = [];
  const met = { along: null as number | null };
  const turned: { dx: number; dz: number }[] = [];
  const gun = { muzzle: null as { x: number; y: number; z: number } | null };
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
      face: (dx, dz) => void turned.push({ dx, dz }),
      muzzle: (out) => {
        if (gun.muzzle !== null) Object.assign(out, gun.muzzle);
        return gun.muzzle !== null;
      },
      sendAct: (kind, arg, eye, dir) => void sent.push({ kind, arg, eyeX: eye.x, eyeY: eye.y, eyeZ: eye.z, dirX: dir.x, dirY: dir.y, dirZ: dir.z }),
    },
    {
      punch: (actor, x, z, dirX, dirZ) => void punches.push({ actor, x, z, dirX, dirZ }),
      shoot: (actor, ray) => {
        shots.push({ actor, ray: Object.assign(new LookRay(), ray) });
        return 7;
      },
      meet: (_actor, ray, range) => {
        looks.push({ ray: Object.assign(new LookRay(), ray), range });
        return met.along ?? range;
      },
      shotFired: () => void fired.count++,
    },
  );
  return { acts, places, clock, punches, shots, sent, fired, looks, met, turned, gun };
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

  it("when rifle acts keep coming twice as fast as the gun fires for two seconds, then they are cut to the gun's count plus the 0.5 s backlog, and at the gun's own rate all are carried out", () => {
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
    expect(fast, "no more than two seconds of the gun's fire and a half second's backlog").toBeLessThanOrEqual(Math.ceil((2 + 0.5) / WEAPONS.rifle.every));
    expect(stream(0.12), "shots carried out at the gun's own rate").toBe(17);
  });

  it("when rifle acts arrive at the gun's own rate with 0.05 s of jitter either way, then every one is carried out", () => {
    const r = rig();
    let sent = 0;
    for (let at = 0; at * WEAPONS.rifle.every < 2; at++) {
      r.acts.hear(GUEST, actAt(ACT.shot, RIFLE_SLOT, 0));
      sent++;
      r.clock.now += WEAPONS.rifle.every + (at % 2 === 0 ? -0.05 : 0.05);
    }
    expect(r.fired.count, `shots carried out of ${sent} sent`).toBe(sent);
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
    expect(far, "how far the farthest ray went from the muzzle, which with no gun shown is his torso: the shot now leaves it (m)").toBe(7);
    expect(r.sent.length, "nothing is sent by the host").toBe(0);
  });

  it("when a guest's player punches and fires, then both are sent to the host as acts and nothing is carried out on his machine", () => {
    const r = rig(true);
    r.acts.punchLanded(0, 1);
    const aim = Object.assign(new LookRay(), { eyeX: 10, eyeY: 1.3, dirZ: 1 });
    const far = r.acts.shootLocal(aim, WEAPONS.shotgun);
    expect(r.sent.length, "acts sent").toBe(2);
    expect(firstMismatch(r.sent.flatMap((act) => [act.kind, act.arg, act.eyeX, act.dirZ]), [ACT.punch, 0, 10, 1, ACT.shot, SHOTGUN_SLOT, 10, 1], 1e-3), "kind, arg, eye x and direction z of each act").toBeUndefined();
    expect(far, "the tracer's length (m)").toBeGreaterThan(10);
    expect([r.punches.length, r.shots.length], "carried out locally").toEqual([0, 0]);
  });
});

/** A cursor ray from a camera 20 m behind and 20 m aside of the torso at (10, 1, 20), toward a point 5 m off its side; it passes the torso far outside the shot's reach. */
function cursorRay(): LookRay {
  const aim = new LookRay();
  aim.eyeX = 30;
  aim.eyeY = 3;
  aim.eyeZ = 0;
  const length = hypot3(20 - 30, 1.3 - 3, 25 - 0);
  aim.dirX = -10 / length;
  aim.dirY = (1.3 - 3) / length;
  aim.dirZ = 25 / length;
  return aim;
}

/** Where a shot at the point `along` m down `aim` from its point nearest the torso leaves from and goes: that nearest point, the unit direction from the torso to the meeting point and its distance (m) from the torso. */
function towardMeeting(aim: LookRay, along: number): { nearest: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number }; length: number } {
  const behind = (GUEST_AT.x - aim.eyeX) * aim.dirX + (GUEST_AT.y - aim.eyeY) * aim.dirY + (GUEST_AT.z - aim.eyeZ) * aim.dirZ;
  const nearest = { x: aim.eyeX + aim.dirX * behind, y: aim.eyeY + aim.dirY * behind, z: aim.eyeZ + aim.dirZ * behind };
  const x = nearest.x + aim.dirX * along - GUEST_AT.x;
  const y = nearest.y + aim.dirY * along - GUEST_AT.y;
  const z = nearest.z + aim.dirZ * along - GUEST_AT.z;
  const length = hypot3(x, y, z);
  return { nearest, dir: { x: x / length, y: y / length, z: z / length }, length };
}

describe("given a player whose cursor ray passes 11 m from his torso, the camera pulled back", () => {
  const meeting = 12.5;

  it("when the host's own player fires and the ray meets something, then the shot leaves his torso toward that point, and the aim is rewritten to it", () => {
    const r = rig();
    r.places.set(HOST, GUEST_AT);
    r.met.along = meeting;
    const aim = cursorRay();
    const expected = towardMeeting(cursorRay(), meeting);
    r.acts.shootLocal(aim, WEAPONS.pistol);
    expect(r.looks.length, "looks along the cursor ray").toBe(1);
    expect(r.looks[0]!.range, "within the gun's range (m)").toBe(WEAPONS.pistol.range);
    expect(hypot3(r.looks[0]!.ray.eyeX - expected.nearest.x, r.looks[0]!.ray.eyeY - expected.nearest.y, r.looks[0]!.ray.eyeZ - expected.nearest.z), "the look starts at the ray's point nearest his torso (m)").toBeLessThan(1e-9);
    expect(r.shots.length, "rays fired").toBe(1);
    expect(hypot3(r.shots[0]!.ray.eyeX - GUEST_AT.x, r.shots[0]!.ray.eyeY - GUEST_AT.y, r.shots[0]!.ray.eyeZ - GUEST_AT.z), "the ray leaves his torso (m)").toBeLessThan(1e-9);
    expect(angleBetween(r.shots[0]!.ray, Object.assign(new LookRay(), { dirX: expected.dir.x, dirY: expected.dir.y, dirZ: expected.dir.z })), "the ray's angle off the way to the point (rad)").toBeLessThanOrEqual(WEAPONS.pistol.cone + 1e-9);
    expect(hypot3(aim.dirX - expected.dir.x, aim.dirY - expected.dir.y, aim.dirZ - expected.dir.z), "the aim rewritten to that direction").toBeLessThan(1e-9);
  });

  it("when a guest fires, then the act sent has its eye at his torso and its direction toward the point the ray met, and nothing is carried out on his machine", () => {
    const r = rig(true);
    r.met.along = meeting;
    const aim = cursorRay();
    const expected = towardMeeting(cursorRay(), meeting);
    const far = r.acts.shootLocal(aim, WEAPONS.pistol);
    expect(r.sent.length, "acts sent").toBe(1);
    const act = r.sent[0]!;
    expect(act.kind, "kind").toBe(ACT.shot);
    expect(hypot3(act.eyeX - GUEST_AT.x, act.eyeY - GUEST_AT.y, act.eyeZ - GUEST_AT.z), "the act's eye from his torso (m)").toBeLessThan(1e-9);
    expect(hypot3(act.dirX - expected.dir.x, act.dirY - expected.dir.y, act.dirZ - expected.dir.z), "the act's direction off the way to the point").toBeLessThan(1e-9);
    expect(far, "the tracer runs to the point (m)").toBeCloseTo(expected.length, 9);
    expect(r.shots.length, "carried out locally").toBe(0);
  });

  it("when nothing is under the cursor inside the gun's range, then the shot goes from his torso toward the ray's point at that range", () => {
    const r = rig(true);
    const expected = towardMeeting(cursorRay(), WEAPONS.rifle.range);
    const far = r.acts.shootLocal(cursorRay(), WEAPONS.rifle);
    expect(r.looks[0]!.range, "looked within the gun's range (m)").toBe(WEAPONS.rifle.range);
    const act = r.sent[0]!;
    expect(hypot3(act.dirX - expected.dir.x, act.dirY - expected.dir.y, act.dirZ - expected.dir.z), "the act's direction off the way to the ray's point at that range").toBeLessThan(1e-9);
    expect(far, "the tracer runs that far from the torso (m)").toBeCloseTo(expected.length, 9);
  });

  /** The aim ray's point nearest the torso (10, 1, 20) is (10.5, 1.4, 20); the muzzle stands in front of him and beside it. */
  const muzzleAt = { x: 10.4, y: 1.4, z: 20.6 };
  const aimPastTorso = (): LookRay => Object.assign(new LookRay(), { eyeX: 10.5, eyeY: 1.4, eyeZ: 0, dirZ: 1 });

  it("when the host's own player fires with a gun in hand, then the ray fired starts at his muzzle and goes to what the aim ray met, within the gun's cone", () => {
    const r = rig();
    r.places.set(HOST, GUEST_AT);
    r.gun.muzzle = muzzleAt;
    r.met.along = 15;
    const target = { x: 10.5, y: 1.4, z: 35 };
    const toTarget = hypot3(target.x - muzzleAt.x, target.y - muzzleAt.y, target.z - muzzleAt.z);
    const sight = Object.assign(new LookRay(), { dirX: (target.x - muzzleAt.x) / toTarget, dirY: (target.y - muzzleAt.y) / toTarget, dirZ: (target.z - muzzleAt.z) / toTarget });
    r.acts.shootLocal(aimPastTorso(), WEAPONS.pistol);
    expect(r.shots.length, "rays fired").toBe(1);
    const ray = r.shots[0]!.ray;
    expect(hypot3(ray.eyeX - muzzleAt.x, ray.eyeY - muzzleAt.y, ray.eyeZ - muzzleAt.z), "the ray's start from the muzzle (m)").toBeLessThan(1e-9);
    expect(angleBetween(ray, sight), "the ray's angle off the way to what the aim met (rad)").toBeLessThanOrEqual(WEAPONS.pistol.cone + 1e-9);
  });

  const closeCases = [
    { it: "when what the aim met is 0.2 m from the muzzle (he is pressed against a wall), then the shot goes along the aim ray's own direction from the muzzle", along: 0.3, muzzleZ: 20.1 },
    { it: "when what the aim met is behind the muzzle along the aim, then the shot goes along the aim ray's own direction from the muzzle", along: 0.3, muzzleZ: 20.6 },
  ] as const;
  for (const testCase of closeCases) {
    it(testCase.it, () => {
      const r = rig(true);
      r.gun.muzzle = { ...muzzleAt, z: testCase.muzzleZ };
      r.met.along = testCase.along;
      r.acts.shootLocal(aimPastTorso(), WEAPONS.pistol);
      const act = r.sent[0]!;
      expect(hypot3(act.eyeX - muzzleAt.x, act.eyeY - muzzleAt.y, act.eyeZ - testCase.muzzleZ), "the act's eye from the muzzle (m)").toBeLessThan(1e-9);
      expect([act.dirX, act.dirY, act.dirZ], "the act's direction: the aim's own").toEqual([0, 0, 1]);
    });
  }

  it("when a guest fires with a gun in hand, then the act's eye is his muzzle and its direction is toward what his aim ray met", () => {
    const r = rig(true);
    r.gun.muzzle = muzzleAt;
    r.met.along = 15;
    r.acts.shootLocal(aimPastTorso(), WEAPONS.pistol);
    const act = r.sent[0]!;
    const toTarget = hypot3(10.5 - muzzleAt.x, 1.4 - muzzleAt.y, 35 - muzzleAt.z);
    expect(hypot3(act.eyeX - muzzleAt.x, act.eyeY - muzzleAt.y, act.eyeZ - muzzleAt.z), "the act's eye from the muzzle (m)").toBeLessThan(1e-9);
    expect(hypot3(act.dirX - (10.5 - muzzleAt.x) / toTarget, act.dirY - (1.4 - muzzleAt.y) / toTarget, act.dirZ - (35 - muzzleAt.z) / toTarget), "the act's direction off the way to the target").toBeLessThan(1e-9);
  });

  it("when the target is behind him, then he is turned to it; when it is ahead of him, he is not", () => {
    const behind = rig();
    behind.places.set(HOST, GUEST_AT);
    behind.met.along = 30;
    behind.acts.shootLocal(Object.assign(new LookRay(), { eyeX: 10, eyeY: 1.3, eyeZ: 40, dirZ: -1 }), WEAPONS.pistol);
    expect(behind.turned.length, "turns for a target 10 m behind him").toBe(1);
    expect(behind.turned[0]!.dz, "toward it (level z)").toBeLessThan(-5);
    const ahead = rig();
    ahead.places.set(HOST, GUEST_AT);
    ahead.met.along = 15;
    ahead.acts.shootLocal(aimPastTorso(), WEAPONS.pistol);
    expect(ahead.turned.length, "turns for a target ahead of him").toBe(0);
  });

  it("when a guest's centred shot has the camera line 1.2 m off his torso, then it is looked along all the same, and the act sent has its eye at his torso and its direction toward what the centre ray met", () => {
    const r = rig(true);
    r.met.along = 15;
    const aim = Object.assign(new LookRay(), { eyeX: 11.2, eyeY: 1, eyeZ: 0, dirZ: 1 });
    const expected = towardMeeting(aim, 15);
    r.acts.shootLocal(aim, WEAPONS.pistol);
    expect(r.looks.length, "looks along the centre ray").toBe(1);
    const act = r.sent[0]!;
    expect(hypot3(act.eyeX - GUEST_AT.x, act.eyeY - GUEST_AT.y, act.eyeZ - GUEST_AT.z), "the act's eye from his torso (m)").toBeLessThan(1e-9);
    expect(hypot3(act.dirX - expected.dir.x, act.dirY - expected.dir.y, act.dirZ - expected.dir.z), "the act's direction off the way to what the ray met").toBeLessThan(1e-9);
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

describe("given a guest running at 7 m/s whose body the host sees 1 m behind him along his run", () => {
  it("when his act leaves his own torso along his aim, then the host carries it out; a camera line 1.45 m off him that would read 2.4 m from the host's view is not what a guest sends", () => {
    const r = rig();
    r.places.set(GUEST, { ...GUEST_AT, z: GUEST_AT.z - 1 });
    const act = actAt(ACT.shot, PISTOL_SLOT, 0);
    act.eyeY = GUEST_AT.y;
    r.acts.hear(GUEST, act);
    expect(r.shots.length, "rays fired from the act's eye, 1 m ahead of the host's view of him").toBe(1);
    expect(r.shots[0]!.ray.eyeZ, "the ray starts where the act's eye was (z)").toBeCloseTo(GUEST_AT.z, 9);
  });
});
