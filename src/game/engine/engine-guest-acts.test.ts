import * as THREE from "three";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hypot2, hypot3 } from "../kernel/physics-core.js";
import { wrapAngle } from "../present/walker-math.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { ACT, Act } from "../net/act-codec.ts";
import { LookRay } from "../ai/civilians/civilian-look.ts";
import { driverLook } from "../present/driver-look.ts";
import { WEAPONS } from "./engine-onfoot-arms.ts";
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
/** A dummy's chest stands this high over its ground (m). */
const CHEST_UP = 1.2;
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
afterEach(() => {
  Reflect.deleteProperty(rig.engine, "actorPlace");
  Reflect.deleteProperty(rig.engine, "aimRay");
});
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

/** A cursor ray from a camera 20 m behind the torso and 3 m up, at the chest of a dummy 5 m ahead and 10 m to the torso's side; it passes the torso about 7 m off. */
function cursorOnDummyAside(): { aim: LookRay; dummy: THREE.Vector3; slot: number; torso: THREE.Vector3 } {
  const { torso, away } = hostOnFoot();
  const side = new THREE.Vector3(-away.z, 0, away.x);
  const slot = dummyAhead(new THREE.Vector3(torso.x + side.x * 10, 0, torso.z + side.z * 10), away, 5);
  const dummy = new THREE.Vector3(torso.x + side.x * 10 + away.x * 5, 0, torso.z + side.z * 10 + away.z * 5);
  dummy.y = activeGround().heightAt(dummy.x, dummy.z);
  const eye = new THREE.Vector3(torso.x - away.x * 20, torso.y + 2, torso.z - away.z * 20);
  const chest = dummy.clone().add(new THREE.Vector3(0, CHEST_UP, 0));
  const dir = chest.clone().sub(eye).normalize();
  const aim = new LookRay();
  Object.assign(aim, { eyeX: eye.x, eyeY: eye.y, eyeZ: eye.z, dirX: dir.x, dirY: dir.y, dirZ: dir.z });
  const miss = torso.clone().sub(eye).cross(dir).length();
  expect(miss, "control: how far the cursor ray passes his torso (m)").toBeGreaterThan(5);
  return { aim, dummy, slot, torso };
}

describe("given the camera pulled back 20 m and the cursor on a dummy 10 m off to the player's side", () => {
  it("when the host's own player fires, then the dummy is struck, the shot leaves his torso and the tracer ends on the dummy", () => {
    const { aim, dummy, slot, torso } = cursorOnDummyAside();
    expect(rig.engine["ragdolls"].walkers[slot]!.state, "control: the dummy stands").toBe("stand");
    const far = rig.engine["acts"].shootLocal(aim, WEAPONS.pistol);
    rig.run(FRAME);
    expect(rig.engine["ragdolls"].walkers[slot]!.state, "the dummy after the shot").not.toBe("stand");
    expect(hypot2(aim.eyeX - torso.x, aim.eyeZ - torso.z), "the ray the shot left along starts at his torso (m)").toBeLessThan(0.1);
    expect(hypot2(aim.eyeX + aim.dirX * far - dummy.x, aim.eyeZ + aim.dirZ * far - dummy.z), "the tracer ends within a body's width of the dummy (m)").toBeLessThan(0.7);
  });

  it("when a guest fires, then the act sent has its eye at his torso and its direction toward the dummy, and nothing is struck on his machine", () => {
    const { aim, dummy, slot, torso } = cursorOnDummyAside();
    const net = rig.engine["net"];
    const sent = vi.spyOn(net, "sendAct").mockImplementation(() => {});
    const role = net.role;
    try {
      Object.defineProperty(net, "role", { value: "client", configurable: true, writable: true });
      rig.engine["acts"].shootLocal(aim, WEAPONS.pistol);
    } finally {
      Object.defineProperty(net, "role", { value: role, configurable: true, writable: true });
    }
    expect(sent, "acts sent").toHaveBeenCalledTimes(1);
    const [kind, arg, eye, dir] = sent.mock.calls[0]!;
    sent.mockRestore();
    const toDummy = new THREE.Vector3(dummy.x - torso.x, dummy.y + CHEST_UP - torso.y, dummy.z - torso.z).normalize();
    expect(kind, "kind").toBe(ACT.shot);
    expect(arg, "weapon").toBe(PISTOL_SLOT);
    expect(hypot2(eye.x - torso.x, eye.z - torso.z), "the act's eye from his torso (m)").toBeLessThan(0.1);
    expect(dir.x * toDummy.x + dir.y * toDummy.y + dir.z * toDummy.z, "the act's direction against the way to the dummy").toBeGreaterThan(0.99);
    expect(rig.engine["ragdolls"].walkers[slot]!.state, "the dummy on the guest's machine").toBe("stand");
  });
});

/** The player's engine aims through `ray` (the camera's centre dot) until the next row: the pose and the shot both ask for it. */
function aimThrough(ray: LookRay): void {
  rig.engine["aimRay"] = (_centre, out) => void Object.assign(out, ray);
}

/** A ray from `eye` at `target`. */
function rayFromTo(eye: THREE.Vector3, target: THREE.Vector3): LookRay {
  const dir = target.clone().sub(eye).normalize();
  return Object.assign(new LookRay(), { eyeX: eye.x, eyeY: eye.y, eyeZ: eye.z, dirX: dir.x, dirY: dir.y, dirZ: dir.z });
}

/** The pistol in the host's player's hand, he on foot facing `facing`, the camera `back` m behind him and `up` m over his torso with its centre dot on `target`: the engine posed for 0.4 s. */
function pistolAimedAt(target: (torso: THREE.Vector3, facing: THREE.Vector3) => THREE.Vector3, back: number, up: number): { torso: THREE.Vector3; facing: THREE.Vector3; aim: LookRay } {
  const { torso } = hostOnFoot();
  const turned = rig.walker().facing;
  const facing = new THREE.Vector3(Math.sin(turned), 0, Math.cos(turned));
  const aim = rayFromTo(new THREE.Vector3(torso.x - facing.x * back, torso.y + up, torso.z - facing.z * back), target(torso, facing));
  rig.press("Digit2");
  aimThrough(aim);
  rig.run(0.4);
  return { torso, facing, aim };
}

/** The ray the pistol's next shot hands the director, copied, and how far (m) the director says it went. */
function firedRay(): { ray: LookRay; went: number } {
  const shoot = vi.spyOn(rig.engine["openWorld"], "shoot");
  rig.engine["onFoot"].arms.press();
  rig.engine["onFoot"].arms.release();
  const ray = Object.assign(new LookRay(), shoot.mock.calls[0]![1]);
  const went = shoot.mock.results[0]!.value as number;
  shoot.mockRestore();
  return { ray, went };
}

describe("given the pistol in hand on foot, the camera just behind and over him and its centre dot on a dummy 15 m ahead", () => {
  it("when he fires, then the barrel and the fired ray agree within 2 degrees, the muzzle stands in front of his chest above his waist, the ray starts at it, and the dummy is struck", () => {
    const { torso, facing, aim } = pistolAimedAt((from, f) => {
      const dummy = new THREE.Vector3(from.x + f.x * 15, 0, from.z + f.z * 15);
      dummy.y = activeGround().heightAt(dummy.x, dummy.z);
      dummyAhead(from, f, 15);
      return dummy.add(new THREE.Vector3(0, CHEST_UP, 0));
    }, 1.6, 0.9);
    const ground = activeGround().heightAt(torso.x, torso.z);
    const muzzle = rig.engine["playerShots"].muzzles;
    const barrel = new THREE.Vector3(0, -1, 0).applyQuaternion(rig.engine["handGun"].quaternion);
    const { ray } = firedRay();
    rig.run(FRAME);
    expect(Math.acos(Math.min(1, barrel.x * ray.dirX + barrel.y * ray.dirY + barrel.z * ray.dirZ)), "the angle between the barrel and the fired ray (rad)").toBeLessThan((2 * Math.PI) / 180);
    expect((muzzle[0]! - torso.x) * facing.x + (muzzle[2]! - torso.z) * facing.z, "the muzzle's distance ahead of his chest (m)").toBeGreaterThan(0.2);
    expect(muzzle[1]! - ground, "the muzzle's height over the ground: above his waist (m)").toBeGreaterThan(1);
    expect(hypot3(ray.eyeX - muzzle[0]!, ray.eyeY - muzzle[1]!, ray.eyeZ - muzzle[2]!), "the ray's start from the muzzle, which has moved a frame since (m)").toBeLessThan(0.02);
    expect(hypot3(aim.eyeX - ray.eyeX, aim.eyeY - ray.eyeY, aim.eyeZ - ray.eyeZ), "the ray does not start at the camera (m)").toBeGreaterThan(1);
    expect(rig.engine["ragdolls"].walkers[0]!.state, "the dummy after the shot").not.toBe("stand");
  });

  it("when a car stands between his muzzle and the dummy and the camera sees over it, then the car takes the shot and the dummy stands", () => {
    const { torso, aim } = pistolAimedAt((from, f) => {
      const dummy = new THREE.Vector3(from.x + f.x * 15, 0, from.z + f.z * 15);
      dummy.y = activeGround().heightAt(dummy.x, dummy.z);
      dummyAhead(from, f, 15);
      rig.place(1, from.x + f.x * 6, from.z + f.z * 6);
      return dummy.add(new THREE.Vector3(0, CHEST_UP, 0));
    }, 1.6, 1.4);
    rig.run(0.5);
    const car = rig.cars()[1]!;
    const shotAt = (): number => hypot2(torso.x - car.group.position.x, torso.z - car.group.position.z);
    expect(rig.engine["openWorld"].meet(rig.engine["drivenCar"](), aim, 120), "control: the camera's ray goes over the car and meets the dummy (m)").toBeGreaterThan(15);
    const { went } = firedRay();
    rig.run(FRAME);
    expect(went, "how far the shot went: to the car 6 m ahead, not to the dummy 15 m ahead (m)").toBeLessThan(shotAt() + 1);
    expect(went, "how far the shot went (m)").toBeGreaterThan(3);
    expect(rig.engine["ragdolls"].walkers[0]!.state, "the dummy behind the car").toBe("stand");
    expect(shotAt(), "control: the car stands between").toBeLessThan(8);
  });

  it("when the centre dot is on a dummy behind him and he fires, then his heading turns toward it within half a second", () => {
    pistolAimedAt((from, f) => {
      const dummy = new THREE.Vector3(from.x - f.x * 10, 0, from.z - f.z * 10);
      dummy.y = activeGround().heightAt(dummy.x, dummy.z);
      dummyAhead(from, f, -10);
      return dummy.add(new THREE.Vector3(0, CHEST_UP, 0));
    }, -3, 2.2);
    const bearing = Math.atan2(-Math.sin(rig.walker().facing), -Math.cos(rig.walker().facing));
    expect(Math.abs(wrapAngle(rig.walker().facing - bearing)), "control: he faces away from the dummy (rad)").toBeGreaterThan(2);
    firedRay();
    rig.run(0.5);
    expect(Math.abs(wrapAngle(rig.walker().heading - bearing)), "his heading off the dummy's bearing (rad)").toBeLessThan(0.1);
    expect(Math.abs(wrapAngle(rig.walker().facing - bearing)), "his facing off the dummy's bearing after half a second (rad)").toBeLessThan(0.6);
  });
});
