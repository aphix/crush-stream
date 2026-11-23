import * as THREE from "three";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hypot2 } from "../kernel/physics-core.js";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { ACT, Act } from "../net/act-codec.ts";
import { driverLook } from "../present/driver-look.ts";
import { activeGround } from "../world/ground.ts";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";
import type { ActorPlace } from "./engine-openworld-acts.ts";

const LINK = "#scene=openworld&seed=beef";
const SETTLE_S = 3;
const GUEST = 1;
const PISTOL_SLOT = 1;
const SHOTGUN_SLOT = 2;
/** The torso stands this high over the ground, and the guest's eye this much higher (m). */
const TORSO_UP = 1;
const EYE_UP = 0.3;

// One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
let rig: OnFootRig;
const clock = { now: 1000 };

beforeAll(async () => {
  rig = await OnFootRig.boot(LINK);
  rig.run(SETTLE_S);
});
beforeEach(() => {
  rig.engine["onFoot"].reset();
  rig.engine["ragdolls"].reset();
  rig.engine["race"].adoptCar(0);
  rig.sit(0);
  rig.run(0.2);
  clock.now += 10;
  rig.engine["acts"]["ports"].now = () => clock.now;
});
afterEach(() => Reflect.deleteProperty(rig.engine, "actorPlace"));
afterAll(() => rig.dispose());

/** The guest is on foot at `at` (his torso): the host's place for car 1, the way the players' bodies will answer it. */
function guestStandsAt(at: ActorPlace): void {
  const hostsOwn = rig.engine["actorPlace"].bind(rig.engine);
  rig.engine["actorPlace"] = (actor, out) => {
    if (actor !== GUEST) return hostsOwn(actor, out);
    Object.assign(out, at);
    return true;
  };
}

/** A shot act of weapon slot `arg` along the unit `dir`, its eye `back` m behind the guest's torso on that line and `aside` m to its side, 0.3 m over the torso. */
function shotFrom(at: ActorPlace, back: number, aside: number, dir: THREE.Vector3, arg = PISTOL_SLOT): Act {
  const act = new Act();
  act.kind = ACT.shot;
  act.arg = arg;
  act.eyeX = at.x - dir.x * back - dir.z * aside;
  act.eyeY = at.y + EYE_UP + dir.y * -back;
  act.eyeZ = at.z - dir.z * back + dir.x * aside;
  act.dirX = dir.x;
  act.dirY = dir.y;
  act.dirZ = dir.z;
  return act;
}

/** The host's walker on foot, and the way along the street away from his car (a unit vector, level). */
function hostOnFoot(): { torso: THREE.Vector3; away: THREE.Vector3 } {
  rig.getOut();
  const torso = rig.torso();
  const car = rig.cars()[0]!.group.position;
  const gap = hypot2(torso.x - car.x, torso.z - car.z);
  return { torso, away: new THREE.Vector3((torso.x - car.x) / gap, 0, (torso.z - car.z) / gap) };
}

/** A standing dummy `metres` from `from` along `away`, in pool slot `slot`; the slot. */
function dummyAhead(from: THREE.Vector3, away: THREE.Vector3, metres: number, slot = 0): number {
  const spot = new THREE.Vector3(from.x + away.x * metres, 0, from.z + away.z * metres);
  spot.y = activeGround().heightAt(spot.x, spot.z);
  rig.engine["ragdolls"].startWalker(spot, 0, { cop: false, look: driverLook(1, 0) }, slot);
  rig.run(1);
  return slot;
}

/** The guest on foot 1.5 m beside the host's walker, with a dummy 8 m in front of him along `away` and another 6 m behind him; their pool slots. */
function guestWithDummies(): { guest: ActorPlace; away: THREE.Vector3; front: number; back: number } {
  const { torso, away } = hostOnFoot();
  const ground = activeGround().heightAt(torso.x, torso.z);
  const side = new THREE.Vector3(-away.z, 0, away.x);
  const guest: ActorPlace = { x: torso.x + side.x * 1.5, y: ground + TORSO_UP, z: torso.z + side.z * 1.5, heading: 0 };
  const spot = new THREE.Vector3(guest.x, 0, guest.z);
  const front = dummyAhead(spot, away, 8);
  const back = dummyAhead(spot, away, -6, 1);
  guestStandsAt(guest);
  return { guest, away, front, back };
}

describe("given the host's engine in the open world with a guest on foot near the host's walker", () => {
  it("when the guest's pistol act aims at a dummy 8 m ahead of him from an eye 30 m behind him, then the dummy is launched along the shot and the ray ends at its near side; the same ray moved 10 m sideways does nothing", () => {
    const { guest, away, front } = guestWithDummies();
    const dir = new THREE.Vector3(away.x, 0, away.z);
    rig.engine["acts"].hear(GUEST, shotFrom(guest, 30, 10, dir));
    rig.run(FRAME);
    expect(rig.engine["ragdolls"].walkers[front]!.state, "the dummy after the ray moved 10 m sideways").toBe("stand");
    const rays = vi.spyOn(rig.engine["openWorld"], "shoot");
    clock.now += 1;
    rig.engine["acts"].hear(GUEST, shotFrom(guest, 30, 0, dir));
    expect(rays.mock.results[0]?.value, "how far the guest's ray went from his torso (m)").toBeGreaterThan(6.5);
    expect(rays.mock.results[0]?.value, "how far the guest's ray went from his torso (m)").toBeLessThan(8.5);
    rays.mockRestore();
    rig.run(FRAME);
    const doll = rig.engine["ragdolls"]["dolls"][front]!;
    expect(rig.engine["ragdolls"].walkers[front]!.state, "the dummy after the act from the far eye").not.toBe("stand");
    expect(doll.vel[0]! * away.x + doll.vel[2]! * away.z, "the dummy's speed along the shot (m/s)").toBeGreaterThanOrEqual(4);
  });

  it("when a dummy stands between a far eye and the guest, then the guest's shot does not hit it, and it does hit the dummy in front of him", () => {
    const { guest, away, front, back } = guestWithDummies();
    const dir = new THREE.Vector3(away.x, 0, away.z);
    rig.engine["acts"].hear(GUEST, shotFrom(guest, 30, 0, dir));
    rig.run(FRAME);
    expect(rig.engine["ragdolls"].walkers[back]!.state, "the dummy between the eye and him").toBe("stand");
    expect(rig.engine["ragdolls"].walkers[front]!.state, "the dummy in front of him").not.toBe("stand");
  });

  it("when two shotgun acts arrive 0.1 s apart, then the law hears one shot, and a third 0.5 s later makes two", () => {
    const { torso, away } = hostOnFoot();
    const guest: ActorPlace = { x: torso.x + away.x * 3, y: torso.y, z: torso.z + away.z * 3, heading: 0 };
    guestStandsAt(guest);
    const fired = vi.spyOn(rig.engine["openWorld"], "shotFired");
    const act = shotFrom(guest, 0, 0, away, SHOTGUN_SLOT);
    rig.engine["acts"].hear(GUEST, act);
    clock.now += 0.1;
    rig.engine["acts"].hear(GUEST, act);
    expect(fired, "shots after two acts 0.1 s apart").toHaveBeenCalledTimes(1);
    clock.now += 0.4;
    rig.engine["acts"].hear(GUEST, act);
    expect(fired, "shots after a third act 0.5 s on").toHaveBeenCalledTimes(2);
    fired.mockRestore();
  });

  it("when the guest's pistol act aims at the host's own walker, then the host's walker is knocked down", () => {
    const { torso, away } = hostOnFoot();
    const ground = activeGround().heightAt(torso.x, torso.z);
    const guest: ActorPlace = { x: torso.x + away.x * 6, y: ground + TORSO_UP, z: torso.z + away.z * 6, heading: 0 };
    guestStandsAt(guest);
    const eye = new THREE.Vector3(guest.x, guest.y + EYE_UP, guest.z);
    const dir = new THREE.Vector3(torso.x, torso.y, torso.z).sub(eye).normalize();
    expect(rig.walker().state, "control: the host's walker stands").toBe("stand");
    rig.engine["acts"].hear(GUEST, shotFrom(guest, 0, 0, dir));
    rig.run(FRAME);
    expect(rig.walker().state, "the host's walker after the guest's shot").not.toBe("stand");
  });

  it("when the guest punches the host's walker three times inside ten seconds, then the first two stagger him and the third knocks him down", () => {
    const { torso, away } = hostOnFoot();
    const ground = activeGround().heightAt(torso.x, torso.z);
    const guest: ActorPlace = { x: torso.x + away.x, y: ground + TORSO_UP, z: torso.z + away.z, heading: 0 };
    guestStandsAt(guest);
    const punch = new Act();
    punch.kind = ACT.punch;
    punch.eyeX = guest.x;
    punch.eyeY = guest.y;
    punch.eyeZ = guest.z;
    punch.dirX = -away.x;
    punch.dirZ = -away.z;
    const strengthAfter: number[] = [];
    for (let blow = 0; blow < 2; blow++) {
      clock.now += 1;
      rig.engine["acts"].hear(GUEST, punch);
      strengthAfter.push(rig.walker().strength);
      expect(rig.walker().state, `after blow ${blow + 1}`).toBe("stand");
      rig.run(0.7);
    }
    expect(Math.max(...strengthAfter), "his strength just after a staggering blow").toBeLessThanOrEqual(0.5);
    clock.now += 1;
    rig.engine["acts"].hear(GUEST, punch);
    rig.run(FRAME);
    expect(rig.walker().state, "after the third blow").not.toBe("stand");
  });
});

describe("given the host's own player on foot in the open world", () => {
  it("when he punches and fires, then the same punchBy and shootBy that carry out a guest's act run for his own car", () => {
    hostOnFoot();
    const punched = vi.spyOn(rig.engine["acts"], "punchBy");
    const shot = vi.spyOn(rig.engine["acts"], "shootBy");
    rig.engine["onFoot"].arms.press();
    rig.engine["onFoot"].arms.release();
    rig.run(1);
    rig.press("Digit2");
    rig.engine["onFoot"].arms.press();
    rig.engine["onFoot"].arms.release();
    const own = rig.engine["drivenCar"]();
    expect(firstMismatch(punched.mock.calls.map((call) => call[0]), [own]), "actors punched for").toBeUndefined();
    expect(firstMismatch(shot.mock.calls.map((call) => call[0]), [own]), "actors fired for").toBeUndefined();
    punched.mockRestore();
    shot.mockRestore();
  });
});
