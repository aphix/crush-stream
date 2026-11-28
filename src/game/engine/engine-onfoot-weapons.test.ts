import * as THREE from "three";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hypot2 } from "../kernel/physics-core.js";
import { LookRay } from "../ai/civilians/civilian-look.ts";
import { driverLook } from "../present/driver-look.ts";
import { blankPad, PAD_BUTTON, type PadState, type TouchPad } from "../vehicle/gamepad.ts";
import { activeGround } from "../world/ground.ts";
import { WEAPONS } from "./engine-onfoot-arms.ts";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";
import type { CarPick } from "./engine-openworld.ts";
import { RayNearest } from "./ray-nearest.ts";

const LINK = "#scene=openworld&seed=beef";
/** Seconds the traffic needs to stand its first kerb cars (its first passes show every space in reach). */
const SETTLE_S = 3;

// One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
let rig: OnFootRig;

/** Fire pressed and let go. */
function fire(): void {
  rig.engine["onFoot"].arms.press();
  rig.engine["onFoot"].arms.release();
}

/** The right mouse button going down (`true`) or up on the canvas. */
function rightButton(down: boolean): void {
  if (down) rig.engine["onArmsDown"](Object.assign(new Event("pointerdown"), { button: 2 }) as PointerEvent);
  else rig.engine["onArmsUp"](Object.assign(new Event("pointerup"), { button: 2 }) as PointerEvent);
}

/** A ray from (x, y, z) toward (tx, ty, tz). */
function rayFrom(x: number, y: number, z: number, tx: number, ty: number, tz: number): LookRay {
  const ray = new LookRay();
  const d = new THREE.Vector3(tx - x, ty - y, tz - z).normalize();
  ray.eyeX = x;
  ray.eyeY = y;
  ray.eyeZ = z;
  ray.dirX = d.x;
  ray.dirY = d.y;
  ray.dirZ = d.z;
  return ray;
}

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
});
afterAll(() => rig.dispose());

describe("given the real engine in the open world, its player on foot", () => {
  it("when the pistol's ray meets a standing dummy 8 m off, then his torso leaves at 4 m/s or more along the shot and he is limp", () => {
    rig.getOut();
    const torso = rig.torso();
    // Away from his own car, so the car he left is not in the way.
    const car = rig.cars()[0]!.group.position;
    const away = hypot2(torso.x - car.x, torso.z - car.z);
    const dirX = (torso.x - car.x) / away;
    const dirZ = (torso.z - car.z) / away;
    const spot = new THREE.Vector3(torso.x + dirX * 8, 0, torso.z + dirZ * 8);
    spot.y = activeGround().heightAt(spot.x, spot.z);
    const slot = rig.engine["ragdolls"].startWalker(spot, 0, { cop: false, look: driverLook(1, 0) }, 0);
    rig.run(1);
    const eyeY = activeGround().heightAt(torso.x, torso.z) + 1.3;
    const went = rig.engine["openWorld"].shoot(rig.engine["drivenCar"](), rayFrom(torso.x, eyeY, torso.z, torso.x + dirX, eyeY, torso.z + dirZ), WEAPONS.pistol);
    expect(went, "how far the shot went (m)").toBeGreaterThanOrEqual(7);
    expect(went, "how far the shot went (m)").toBeLessThanOrEqual(9);
    rig.run(FRAME);
    const doll = rig.engine["ragdolls"]["dolls"][slot]!;
    expect(rig.engine["ragdolls"].walkers[slot]!.state, "the dummy shot").not.toBe("stand");
    expect(doll.vel[0]! * dirX + doll.vel[2]! * dirZ, "his torso's speed along the shot (m/s)").toBeGreaterThanOrEqual(4);
  });

  it("when the shotgun's rays meet a kerb car's side window 6 m off, then the car is moving along the shot and that pane is cracked or shattered", () => {
    rig.getOut();
    const torso = rig.torso();
    rig.place(1, torso.x + 6, torso.z);
    rig.run(0.5);
    const car = rig.cars()[1]!;
    car.group.updateMatrixWorld(true);
    const eye = new THREE.Vector3(torso.x, torso.y + 0.3, torso.z);
    const sides = car.glassPanes.filter((pane) => pane.name === "doorL" || pane.name === "doorR");
    // The middle of the pane's glass: the mesh's own origin sits at its foot, on the door's skin.
    const at = (pane: (typeof sides)[number]): THREE.Vector3 => {
      pane.mesh.geometry.computeBoundingBox();
      return pane.mesh.localToWorld(pane.mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()));
    };
    const pane = sides.reduce((near, next) => (at(next).distanceTo(eye) < at(near).distanceTo(eye) ? next : near));
    expect(pane.state, "control: the pane is whole").toBe("intact");
    const centre = at(pane);
    const ray = rayFrom(eye.x, eye.y, eye.z, centre.x, centre.y, centre.z);
    for (let shot = 0; shot < 8; shot++) rig.engine["openWorld"].shoot(rig.engine["drivenCar"](), ray, WEAPONS.shotgun);
    expect(car.velocity.x, "the car's speed along the shot (m/s)").toBeGreaterThan(0);
    expect(pane.state, `pane ${pane.name}`).not.toBe("intact");
  });

  it("when two shots are picked against the cars, then the nearest-hit search is handed one list of every live car's group, the same list both times, and the pick names the car and the pane hit", () => {
    rig.getOut();
    const torso = rig.torso();
    rig.place(1, torso.x + 6, torso.z);
    rig.run(0.5);
    const car = rig.cars()[1]!;
    car.group.updateMatrixWorld(true);
    const eye = new THREE.Vector3(torso.x, torso.y + 0.3, torso.z);
    const sides = car.glassPanes.filter((pane) => pane.name === "doorL" || pane.name === "doorR");
    // The middle of the pane's glass: the mesh's own origin sits at its foot, on the door's skin.
    const at = (pane: (typeof sides)[number]): THREE.Vector3 => {
      pane.mesh.geometry.computeBoundingBox();
      return pane.mesh.localToWorld(pane.mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()));
    };
    const pane = sides.reduce((near, next) => (at(next).distanceTo(eye) < at(near).distanceTo(eye) ? next : near));
    const centre = at(pane);
    const ray = rayFrom(eye.x, eye.y, eye.z, centre.x, centre.y, centre.z);
    const out: CarPick = { car: -1, x: 0, y: 0, z: 0, along: Infinity, pane: null };
    const cast = vi.spyOn(RayNearest.prototype, "find");
    let calls: typeof cast.mock.calls = [];
    try {
      for (let shot = 0; shot < 2; shot++) rig.engine["pickCar"](ray, WEAPONS.shotgun.range, out);
      calls = [...cast.mock.calls];
    } finally {
      cast.mockRestore();
    }
    const [first, second] = calls;
    expect(second![1], "the same list of groups").toBe(first![1]);
    expect(first![1].length, "every live car's group").toBe(rig.engine["live"]().length);
    expect(out.car, "the car picked").toBe(1);
    expect(out.pane, "the pane picked").toBe(pane.name);
  });

  it("when he fires any gun, then the police chase opens, seen or not", () => {
    // 10 m on along the street from where the car stands: getting out where it stands is a walk on a crossing against the signal, a chase of its own.
    const car = rig.cars()[0]!.group.position;
    rig.place(0, car.x + 10, car.z);
    rig.run(0.5);
    rig.getOut();
    const scene = rig.engine["openWorld"]["law"]!["scene"];
    expect(scene.footChaseOf({ cops: 0, hold: 0, left: 0 }), "control: no chase before the shot").toBe(false);
    rig.press("Digit2");
    fire();
    rig.run(0.5);
    expect(scene.footChaseOf({ cops: 0, hold: 0, left: 0 }), "the chase").toBe(true);
  });

  it("when he holds fire for a second with the rifle and aim held, then 8 or 9 shots are fired; with the pistol held the same way, one", () => {
    rig.getOut();
    const fired = vi.spyOn(rig.engine["openWorld"], "shotFired");
    rig.press("Digit4");
    rightButton(true);
    try {
      rig.engine["onFoot"].arms.press();
      rig.run(1);
      rig.engine["onFoot"].arms.release();
      const rifle = fired.mock.calls.length;
      expect(rifle >= 8 && rifle <= 9, `rifle shots: ${rifle}`).toBe(true);
      // The rifle's last cooldown runs out before the pistol is fired.
      rig.run(0.2);
      rig.press("Digit2");
      rig.engine["onFoot"].arms.press();
      rig.run(1);
      rig.engine["onFoot"].arms.release();
      expect(fired.mock.calls.length - rifle, "pistol shots").toBe(1);
    } finally {
      rightButton(false);
      fired.mockRestore();
    }
  });

  /** The pad with LB held (or not) and the right stick at (`rx`, `ry`). */
  const lbPad = (held: boolean, rx = 0, ry = 0): PadState => ({ ...blankPad(), connected: true, held: held ? 1 << PAD_BUTTON.lb : 0, rx, ry });
  const noTouch: TouchPad = { x: 0, y: 0, gas: 0, brake: 0, held: 0, tapped: 0 };
  const wheel = (deltaY: number): void => rig.engine["view"]["onWheel"](Object.assign(new Event("wheel"), { deltaY, deltaMode: 0 }) as WheelEvent);

  it("when 2 is pressed and LB is tapped, then the pistol is put away and a second tap draws it again; RB on a pad steps nothing, RB from the touch strip steps to the next weapon", () => {
    rig.getOut();
    const onFoot = rig.engine["onFoot"];
    rig.press("Digit2");
    expect(onFoot.hud()!.arms, "after 2").toEqual({ slot: 1, name: "Pistol" });
    for (const slot of [0, 1]) {
      onFoot.arms.pad(lbPad(true), noTouch);
      onFoot.arms.pad(lbPad(false), noTouch);
      expect(onFoot.hud()!.arms!.slot, `after tap ${slot + 1}`).toBe(slot);
    }
    onFoot.padPress(1 << PAD_BUTTON.rb);
    expect(onFoot.hud()!.arms, "RB on a pad").toEqual({ slot: 1, name: "Pistol" });
    rig.engine.touch.held = 1 << PAD_BUTTON.rb;
    onFoot.padPress(1 << PAD_BUTTON.rb);
    rig.engine.touch.held = 0;
    expect(onFoot.hud()!.arms, "RB from the touch strip").toEqual({ slot: 2, name: "Shotgun" });
  });

  it("when LB is held for 0.3 s, then the weapon wheel opens on the weapon in hand, the right stick picks a spoke without turning the camera, and letting go equips it", () => {
    rig.getOut();
    const { arms } = rig.engine["onFoot"];
    rig.press("Digit4");
    arms.pad(lbPad(true), noTouch);
    arms.frame(0.1);
    expect(arms.wheelHud(), "not yet open at 0.1 s").toBe(null);
    arms.frame(0.2);
    expect(arms.wheelHud()!.pick, "open on the rifle").toBe(3);
    const nudge = lbPad(true, 0.3, 0);
    arms.pad(nudge, noTouch);
    expect(arms.wheelHud()!.pick, "a nudge under half picks nothing new").toBe(3);
    const stick = lbPad(true, 0.95, -0.31);
    arms.pad(stick, noTouch);
    expect(arms.wheelHud()!.pick, "up and right: the pistol").toBe(1);
    expect([stick.rx, stick.ry], "the camera's stick is zeroed while the wheel is open").toEqual([0, 0]);
    arms.pad(lbPad(false), noTouch);
    expect(arms.wheelHud(), "shut").toBe(null);
    expect(arms.weapon, "equipped on release").toBe("pistol");
  });

  it("when Tab is held, then the wheel opens and the mouse picks a spoke; letting go equips it", () => {
    rig.getOut();
    const { arms } = rig.engine["onFoot"];
    rig.press("Digit4");
    rig.engine["keys"].add("Tab");
    rig.run(0.3);
    expect(arms.wheelOpen, "open").toBe(true);
    expect(arms.wheelMove(0, 0), "the wheel takes the mouse").toBe(true);
    rig.engine["onArmsMove"](Object.assign(new Event("pointermove"), { movementX: 100, movementY: 0 }) as PointerEvent);
    expect(arms.wheelPick, "a full push right: the pistol").toBe(1);
    rig.engine["keys"].delete("Tab");
    rig.run(2 * FRAME);
    expect(arms.wheelOpen, "shut").toBe(false);
    expect(arms.weapon, "equipped on release").toBe("pistol");
  });

  it("when the mouse wheel turns on foot in the open world, then a notch steps the weapon and the zoom stays; while aiming the wheel zooms", () => {
    rig.getOut();
    const { arms } = rig.engine["onFoot"];
    const radius = (): number => rig.engine["view"]["radius"];
    rig.press("Digit2");
    const rest = radius();
    wheel(100);
    expect(arms.weapon, "a notch down: the shotgun").toBe("shotgun");
    expect(radius(), "the zoom stays").toBe(rest);
    wheel(-100);
    wheel(-100);
    wheel(-100);
    expect(arms.weapon, "three notches up: past fists to the hook").toBe("hook");
    wheel(40);
    wheel(40);
    expect(arms.weapon, "a trackpad's 80 px is not a notch yet").toBe("hook");
    wheel(40);
    expect(arms.weapon, "120 px is one: wrapped to fists").toBe("fists");
    rightButton(true);
    try {
      wheel(100);
      expect(radius(), "aiming: the zoom").not.toBe(rest);
      expect(arms.weapon, "aiming: the weapon stays").toBe("fists");
    } finally {
      rightButton(false);
    }
  });

  it("when the mouse wheel turns at the wheel of the car, then it zooms and takes no weapon", () => {
    rig.sit(0);
    const rest = rig.engine["view"]["radius"];
    wheel(100);
    expect(rig.engine["view"]["radius"], "zoomed").not.toBe(rest);
    expect(rig.engine["onFoot"].arms.weapon).toBe("fists");
  });

  it("when a digit is pressed at the wheel, then no weapon is taken: the weapon in hand stays fists", () => {
    rig.sit(0);
    rig.press("Digit3");
    expect(rig.engine["onFoot"].arms.weapon).toBe("fists");
  });
});
