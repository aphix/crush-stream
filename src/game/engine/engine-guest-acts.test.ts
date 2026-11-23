import * as THREE from "three";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hypot2, hypot3 } from "../kernel/physics-core.js";
import { wrapAngle } from "../present/walker-math.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { ACT, Act } from "../net/act-codec.ts";
import { LookRay } from "../ai/civilians/civilian-look.ts";
import { driverLook } from "../present/driver-look.ts";
import { WEAPONS } from "./engine-onfoot-arms.ts";
import { FLASH_S } from "../present/shot-fx.ts";
import { allocatedBytes, untilQuiet } from "../kernel/alloc-sample.test-util.ts";
import { drawnHalf, hasStoop } from "../world/openworld/openworld-facade-solids.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
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
/** Back in car 0 with nothing held: the state every row starts from. */
function backInCar(): void {
  rig.engine["onFoot"].reset();
  rig.engine["ragdolls"].reset();
  rig.engine["race"].adoptCar(0);
  rig.sit(0);
  // A row's dummies and its parked car stay where they stood: nothing of an earlier row is in the line of fire.
  for (const slot of [0, 1]) rig.engine["ragdolls"].stopWalker(slot);
  const home = rig.cars()[0]!.group.position;
  rig.place(1, home.x + 25, home.z + 25);
  rig.run(0.2);
}

beforeEach(() => {
  backInCar();
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

/** Where each view puts the camera behind and over his torso (m): the follow, over his shoulder with aim held, and his own eyes. */
const VIEWS = { follow: { back: 4, up: 2.2 }, aim: { back: 1.6, up: 0.9 }, first: { back: 0, up: 0.55 } } as const;

/** He stands in `view`: aim held for "aim"; his eyes for "first" (`V` twice). */
function enterView(view: keyof typeof VIEWS): void {
  if (view === "aim") rig.engine["onArmsDown"](Object.assign(new Event("pointerdown"), { button: 2 }) as PointerEvent);
  if (view === "first") for (let press = 0; press < 2; press++) rig.press("KeyV");
  expect(rig.engine["onFoot"].footView, `control: the ${view} view`).toBe(view === "first" ? "first" : "follow");
}

/** The aim is let go, and the follow is his view again. */
function leaveView(view: keyof typeof VIEWS): void {
  if (view === "aim") rig.engine["onArmsUp"](Object.assign(new Event("pointerup"), { button: 2 }) as PointerEvent);
  if (view === "first") rig.press("KeyV");
}

/** The pistol in the host's player's hand, he on foot facing `facing`, the camera `back` m behind him and `up` m over his torso with its centre dot on `target`: the engine posed for 0.4 s. */
function pistolAimedAt(target: (torso: THREE.Vector3, facing: THREE.Vector3) => THREE.Vector3, back: number, up: number, view?: keyof typeof VIEWS): { torso: THREE.Vector3; facing: THREE.Vector3; aim: LookRay } {
  hostOnFoot();
  rig.press("Digit2");
  if (view !== undefined) enterView(view);
  // He settles first: his facing and his place are read once he has stopped turning to the camera.
  rig.run(0.6);
  const torso = rig.torso();
  const turned = rig.walker().facing;
  const facing = new THREE.Vector3(Math.sin(turned), 0, Math.cos(turned));
  const aim = rayFromTo(new THREE.Vector3(torso.x - facing.x * back, torso.y + up, torso.z - facing.z * back), target(torso, facing));
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
  it("when he fires, then the barrel and the fired ray agree within 0.5 degrees, the muzzle stands in front of his chest above his waist, the ray starts at it, and the dummy is struck", () => {
    const { torso, facing, aim } = pistolAimedAt((from, f) => {
      const dummy = new THREE.Vector3(from.x + f.x * 15, 0, from.z + f.z * 15);
      dummy.y = activeGround().heightAt(dummy.x, dummy.z);
      dummyAhead(from, f, 15);
      return dummy.add(new THREE.Vector3(0, CHEST_UP, 0));
    }, 1.6, 0.9);
    const ground = activeGround().heightAt(torso.x, torso.z);
    const muzzle = rig.engine["playerShots"].muzzles;
    const { ray } = firedRay();
    const barrel = barrelNow();
    rig.run(FRAME);
    expect(Math.acos(Math.min(1, barrel.x * ray.dirX + barrel.y * ray.dirY + barrel.z * ray.dirZ)), "the angle between the barrel and the fired ray (rad)").toBeLessThan((0.5 * Math.PI) / 180);
    expect((muzzle[0]! - torso.x) * facing.x + (muzzle[2]! - torso.z) * facing.z, "the muzzle's distance ahead of his chest (m)").toBeGreaterThan(0.2);
    expect(muzzle[1]! - ground, "the muzzle's height over the ground: above his waist (m)").toBeGreaterThan(1);
    expect(hypot3(ray.eyeX - muzzle[0]!, ray.eyeY - muzzle[1]!, ray.eyeZ - muzzle[2]!), "the ray's start from the muzzle, which has moved a frame since (m)").toBeLessThan(0.02);
    expect(hypot3(aim.eyeX - ray.eyeX, aim.eyeY - ray.eyeY, aim.eyeZ - ray.eyeZ), "the ray does not start at the camera (m)").toBeGreaterThan(1);
    expect(rig.engine["ragdolls"].walkers[0]!.state, "the dummy after the shot").not.toBe("stand");
  });

  it("when a dummy stands on the line from his muzzle to a second dummy the camera sees over it, then the near one takes the shot and the far one stands", () => {
    const far = new THREE.Vector3();
    const { torso, aim } = pistolAimedAt((from, f) => {
      far.set(from.x + f.x * 15, 0, from.z + f.z * 15);
      far.y = activeGround().heightAt(far.x, far.z);
      dummyAhead(from, f, 15);
      return far.clone().add(new THREE.Vector3(0, CHEST_UP, 0));
    }, 1.6, 1.4);
    // The gun is held 0.3 m to the side of his chest, so the bullet's line to the far dummy is where the near one must stand.
    const tip = tipNow();
    const line = new THREE.Vector3(far.x - tip.x, 0, far.z - tip.z).normalize();
    const near = new THREE.Vector3(tip.x + line.x * 5, 0, tip.z + line.z * 5);
    near.y = activeGround().heightAt(near.x, near.z);
    rig.engine["ragdolls"].startWalker(near, 0, { cop: false, look: driverLook(1, 0) }, 1);
    rig.run(1);
    expect(rig.engine["openWorld"].meet(rig.engine["drivenCar"](), aim, 120), "control: the camera's ray goes over the near dummy and meets the far one (m)").toBeGreaterThan(15);
    expect(rig.engine["ragdolls"].walkers[1]!.state, "control: the near dummy stands").toBe("stand");
    const { went } = firedRay();
    rig.run(FRAME);
    expect(went, "how far the shot went: to the near dummy 5 m from the tip, not to the far one (m)").toBeLessThan(6.5);
    expect(went, "how far the shot went (m)").toBeGreaterThan(3);
    expect(rig.engine["ragdolls"].walkers[1]!.state, "the near dummy").not.toBe("stand");
    expect(rig.engine["ragdolls"].walkers[0]!.state, "the far dummy behind it").toBe("stand");
    expect(hypot2(torso.x - rig.torso().x, torso.z - rig.torso().z), "control: he did not move (m)").toBeLessThan(1);
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

/** The angle (rad) between two directions. */
function angleBetween(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.acos(Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
}

/** The hand gun's barrel as it lies now: its -y axis in the world. */
function barrelNow(): THREE.Vector3 {
  const e = rig.engine["handGun"].matrix.elements;
  return new THREE.Vector3(-e[4]!, -e[5]!, -e[6]!);
}

/** The gun's tip as the engine last posed or laid it. */
function tipNow(): THREE.Vector3 {
  const muzzle = rig.engine["playerShots"].muzzles;
  return new THREE.Vector3(muzzle[0], muzzle[1], muzzle[2]);
}

describe("given the pistol in hand and its centre dot on a point 3 m, 15 m and 100 m ahead, in each view", () => {
  const cases = [3, 15, 100].flatMap((metres) => (Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((view) => ({ metres, view })));
  for (const { metres, view } of cases) {
    it(`when he fires at ${metres} m in the ${view} view, then on the frame of the shot the barrel and the fired ray agree within 0.5 degrees and the ray starts at the gun's tip, and the lay is still held a frame later`, () => {
      const { back, up } = VIEWS[view];
      const { aim } = pistolAimedAt((from, f) => new THREE.Vector3(from.x + f.x * metres, activeGround().heightAt(from.x + f.x * metres, from.z + f.z * metres) + CHEST_UP, from.z + f.z * metres), back, up, view);
      const { ray } = firedRay();
      const tip = tipNow();
      const barrel = barrelNow();
      const rayDir = { x: ray.dirX, y: ray.dirY, z: ray.dirZ };
expect(hypot3(ray.eyeX - tip.x, ray.eyeY - tip.y, ray.eyeZ - tip.z), "the ray's start from the gun's tip (m)").toBeLessThan(1e-3);
      expect(angleBetween(barrel, rayDir), "the barrel and the fired ray on the frame of the shot (rad)").toBeLessThan((0.5 * Math.PI) / 180);
      rig.run(FRAME);
      expect(FRAME, "control: a frame is inside the flash").toBeLessThan(FLASH_S);
      expect(angleBetween(barrelNow(), rayDir), "the barrel and the fired ray a frame later (rad)").toBeLessThan((0.5 * Math.PI) / 180);
      expect(hypot3(aim.eyeX - ray.eyeX, aim.eyeY - ray.eyeY, aim.eyeZ - ray.eyeZ), "control: the camera is not where the ray starts (m)").toBeGreaterThan(0.2);
      leaveView(view);
    });
  }
});

/** A frontage's outward and across unit vectors on the ground plane. */
function frontageAxes(yaw: number): { out: THREE.Vector3; across: THREE.Vector3 } {
  return { out: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), across: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)) };
}

/** The player's walker stood at `spot` facing `facing`, on foot with the pistol in hand. */
function standAt(spot: THREE.Vector3, facing: THREE.Vector3): void {
  hostOnFoot();
  rig.engine["ragdolls"].stopWalker();
  rig.engine["ragdolls"].startWalker(spot, Math.atan2(facing.x, facing.z), { cop: false, look: driverLook(0, 0) });
  rig.run(1);
  rig.press("Digit2");
}

/** Where he first stands (m from the drawn facade): the footprint stands a little beyond it, and the walker settles a few tenths off where he is put, so `standNearWall` corrects it. */
const WALL_GAP_M = 0.5;
/** He is near enough the wall when its footprint is this far (m) from his torso at most: the gun's tip, held out in front of his chest, is then past it. */
const WALL_NEAR_M = 0.2;
/** And not inside it: a footprint he stands in is no wall to a ray. */
const WALL_NOT_INSIDE_M = 0.05;
/** A level ray from his torso along his facing meets nothing within this (m) when he stands inside the footprint or far from it. */
const WALL_LOOK_M = 3;

/** The most facades tried: a flat one with clear ground before it is found among the first few. */
const WALL_CANDIDATES = 12;

/** Points on the flat drawn facades of the city's buildings that have no stoop and no bay (nothing stands out of them for him to be held off by): each point, the facing toward the wall and the wall's out vector; only where a level ray 1.3 m up from `WALL_GAP_M` out meets the building within 0.7 m. */
function flatWalls(): { base: THREE.Vector3; facing: THREE.Vector3; out: THREE.Vector3 }[] {
  const lots = layOutLots();
  const found: { base: THREE.Vector3; facing: THREE.Vector3; out: THREE.Vector3 }[] = [];
  hostOnFoot();
  for (const place of lots.places.slice(0, lots.backdropStart)) {
    if (hasStoop(place) || found.length >= WALL_CANDIDATES) continue;
    const { out } = frontageAxes(place.yaw);
    const face = drawnHalf(place.depth);
    const base = new THREE.Vector3(place.x + out.x * face, 0, place.z + out.z * face);
    base.y = activeGround().heightAt(base.x, base.z);
    const facing = out.clone().multiplyScalar(-1);
    const ray = Object.assign(new LookRay(), { eyeX: base.x + out.x * WALL_GAP_M, eyeY: base.y + 1.3, eyeZ: base.z + out.z * WALL_GAP_M, dirX: facing.x, dirY: 0, dirZ: facing.z });
    if (rig.engine["openWorld"].meet(rig.engine["drivenCar"](), ray, WALL_LOOK_M) < 0.7) found.push({ base, facing, out });
  }
  return found;
}

/** How far (m) the wall's footprint is in front of his torso, a level ray along `facing`; `WALL_LOOK_M` when none is met. */
function wallAhead(facing: THREE.Vector3): number {
  const torso = rig.torso();
  const ray = Object.assign(new LookRay(), { eyeX: torso.x, eyeY: torso.y, eyeZ: torso.z, dirX: facing.x, dirY: 0, dirZ: facing.z });
  return rig.engine["openWorld"].meet(rig.engine["drivenCar"](), ray, WALL_LOOK_M);
}

/** He stands facing the wall with its footprint within `WALL_NEAR_M` of his torso and not inside it: put at a gap, read, and moved by what the read says, a few times; the point he was put at. */
function standNearWall(base: THREE.Vector3, facing: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  let gap = WALL_GAP_M;
  const seen: string[] = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    const spot = new THREE.Vector3(base.x + out.x * gap, 0, base.z + out.z * gap);
    spot.y = activeGround().heightAt(spot.x, spot.z);
    backInCar();
    standAt(spot, facing);
    const ahead = wallAhead(facing);
    seen.push(`gap ${gap.toFixed(2)} torsoZ-spotZ ${(rig.torso().z - spot.z).toFixed(2)} torsoX-spotX ${(rig.torso().x - spot.x).toFixed(2)} ahead ${ahead.toFixed(2)}`);
    if (ahead >= WALL_NOT_INSIDE_M && ahead <= WALL_NEAR_M) return spot;
    gap += ahead >= WALL_LOOK_M ? WALL_LOOK_M / 12 : -(ahead - WALL_NEAR_M / 2);
  }
  throw new Error(`he could not be stood a hand from the wall: ${seen.join(" | ")}`);
}

describe("given the pistol in hand a hand's breadth from a rowhome's wall, the gun's tip past it", () => {
  it("when he fires at the wall, then the shot ends on the wall and a dummy standing behind it is not struck", () => {
    let stood: { spot: THREE.Vector3; facing: THREE.Vector3; out: THREE.Vector3 } | null = null;
    const tried: string[] = [];
    for (const wall of flatWalls()) {
      try {
        stood = { spot: standNearWall(wall.base, wall.facing, wall.out), facing: wall.facing, out: wall.out };
        break;
      } catch (error) {
        tried.push((error as Error).message);
      }
    }
    if (stood === null) throw new Error(`no flat wall he could be stood a hand from: ${tried.join(" || ")}`);
    const { spot, facing, out } = stood;
    const behind = new THREE.Vector3(spot.x + facing.x * 2.5, 0, spot.z + facing.z * 2.5);
    behind.y = activeGround().heightAt(behind.x, behind.z);
    rig.engine["ragdolls"].startWalker(behind, 0, { cop: false, look: driverLook(1, 0) }, 0);
    rig.run(1);
    const torso = rig.torso();
    const eye = new THREE.Vector3(torso.x + out.x * 1.6, torso.y + 0.9, torso.z + out.z * 1.6);
    const target = new THREE.Vector3(torso.x + facing.x * 0.4, torso.y + 0.4, torso.z + facing.z * 0.4);
    aimThrough(rayFromTo(eye, target));
    rig.run(0.4);
    const tip = tipNow();
    expect(wallAhead(facing), "control: the wall's footprint is a hand from his torso (m)").toBeLessThanOrEqual(WALL_NEAR_M);
    expect(rig.engine["openWorld"].wallBetween(torso.x, torso.y, torso.z, tip.x, tip.y, tip.z), "control: the gun's tip is past the wall (a wall stands between his torso and it)").toBe(true);
    // Inside the building he does not stay standing (it is no ground for a dummy), so what is read is whether a blow was struck at any dummy.
    const struck = vi.spyOn(rig.engine as unknown as { strikeDoll: () => void }, "strikeDoll");
    const { went } = firedRay();
    rig.run(FRAME);
    expect(went, "how far the shot went from its start (m): the wall is under 0.7 m away").toBeLessThan(0.7);
    expect(struck, "dummies struck by the shot").not.toHaveBeenCalled();
    struck.mockRestore();
  });

  it("when a dummy stands 0.9 m from the gun's tip in the open, then the shot strikes it", () => {
    const { torso, facing } = pistolAimedAt((from, f) => new THREE.Vector3(from.x + f.x * 3, activeGround().heightAt(from.x + f.x * 3, from.z + f.z * 3) + CHEST_UP, from.z + f.z * 3), 1.6, 0.9);
    const tip = tipNow();
    const tipAway = (tip.x - torso.x) * facing.x + (tip.z - torso.z) * facing.z;
    expect(tipAway, "control: the tip is held out in front of his chest (m)").toBeGreaterThan(0.2);
    const slot = dummyAhead(new THREE.Vector3(torso.x, 0, torso.z), facing, tipAway + 0.9);
    const chest = new THREE.Vector3(torso.x + facing.x * (tipAway + 0.9), activeGround().heightAt(torso.x, torso.z) + CHEST_UP, torso.z + facing.z * (tipAway + 0.9));
    aimThrough(rayFromTo(new THREE.Vector3(torso.x - facing.x * 1.6, torso.y + 0.9, torso.z - facing.z * 1.6), chest));
    rig.run(0.4);
    firedRay();
    rig.run(FRAME);
    expect(rig.engine["ragdolls"].walkers[slot]!.state, "the dummy 0.9 m from the tip").not.toBe("stand");
  });
});

describe("given a gun in the player's hand", () => {
  /** Frames posed, and the bound (bytes): the sampling profiler's own cost is 4-5 KB of a read. */
  const FRAMES = 600;
  const BOUND_BYTES = 8192;

  it("when the gun is posed for 600 frames, then all of them together allocate under 8 KB", () => {
    pistolAimedAt((from, f) => new THREE.Vector3(from.x + f.x * 15, activeGround().heightAt(from.x + f.x * 15, from.z + f.z * 15) + CHEST_UP, from.z + f.z * 15), 1.6, 0.9);
    Reflect.deleteProperty(rig.engine, "aimRay");
    const pose = (): void => {
      for (let frame = 0; frame < FRAMES; frame++) rig.engine["poseHandGun"](FRAME);
    };
    const bytes = untilQuiet(() => allocatedBytes(pose), BOUND_BYTES);
    expect(bytes, "bytes allocated by 600 posed frames").toBeLessThanOrEqual(BOUND_BYTES);
  });
});

describe("given him running with the rifle and its fire held, the centre dot 45 degrees off his run", () => {
  /** Runs for 2 s from the car with the mouse captured and the rifle's fire held when `fire`, the centre dot 45 degrees off `runAngle` (the direction of a free run; any for the first); the ground (m) he covers and the angle of his run. */
  function runTwoSeconds(fire: boolean, runAngle: number): { covered: number; angle: number } {
    backInCar();
    const { torso } = hostOnFoot();
    rig.press("Digit4");
    const dot = new THREE.Vector3(torso.x + Math.sin(runAngle + Math.PI / 4) * 15, torso.y + 0.3, torso.z + Math.cos(runAngle + Math.PI / 4) * 15);
    aimThrough(rayFromTo(new THREE.Vector3(torso.x - Math.sin(runAngle) * 1.6, torso.y + 0.9, torso.z - Math.cos(runAngle) * 1.6), dot));
    const host = rig.engine["onFoot"]["host"];
    const captured = host.mouseCaptured;
    host.mouseCaptured = () => true;
    rig.engine["keys"].add("KeyW");
    if (fire) rig.engine["onFoot"].arms.press();
    rig.run(2);
    rig.engine["onFoot"].arms.release();
    rig.engine["keys"].clear();
    host.mouseCaptured = captured;
    const end = rig.torso();
    return { covered: hypot2(end.x - torso.x, end.z - torso.z), angle: Math.atan2(end.x - torso.x, end.z - torso.z) };
  }

  it("when he runs for 2 s with the fire held, then he covers at least 80 percent of the ground he covers in 2 s without firing", () => {
    const firing = vi.spyOn(rig.engine["openWorld"], "shotFired");
    const free = runTwoSeconds(false, 0);
    expect(firing, "control: no shot was fired in the free run").not.toHaveBeenCalled();
    const held = runTwoSeconds(true, free.angle);
    expect(firing.mock.calls.length, "control: the fire held fired the rifle many times").toBeGreaterThan(8);
    firing.mockRestore();
    expect(free.covered, "control: he ran (m)").toBeGreaterThan(3);
    expect(held.covered / free.covered, "the share of the free run's ground he covers firing").toBeGreaterThanOrEqual(0.8);
  });
});
