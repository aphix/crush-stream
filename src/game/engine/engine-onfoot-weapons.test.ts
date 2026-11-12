import * as THREE from "three";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hypot2 } from "../kernel/physics-core.js";
import { LookRay } from "../ai/civilians/civilian-look.ts";
import { driverLook } from "../present/driver-look.ts";
import { PAD_BUTTON } from "../vehicle/gamepad.ts";
import { activeGround } from "../world/ground.ts";
import { WEAPONS } from "./engine-onfoot-arms.ts";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";

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
  // mutation: sed -i 's/^  pistol: { name: "Pistol", speed: 6,/  pistol: { name: "Pistol", speed: 0,/' src/game/engine/engine-onfoot-arms.ts
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
    const went = rig.engine["openWorld"].shoot(rayFrom(torso.x, eyeY, torso.z, torso.x + dirX, eyeY, torso.z + dirZ), WEAPONS.pistol);
    expect(went, "how far the shot went (m)").toBeGreaterThanOrEqual(7);
    expect(went, "how far the shot went (m)").toBeLessThanOrEqual(9);
    rig.run(FRAME);
    const doll = rig.engine["ragdolls"]["dolls"][slot]!;
    expect(rig.engine["ragdolls"].walkers[slot]!.state, "the dummy shot").not.toBe("stand");
    expect(doll.vel[0]! * dirX + doll.vel[2]! * dirZ, "his torso's speed along the shot (m/s)").toBeGreaterThanOrEqual(4);
  });

  // mutation: sed -i '/^      car.hitGlass(pick.pane);/d' src/game/engine/engine-openworld.ts
  it("when the shotgun's rays meet a kerb car's side window 6 m off, then the car is moving along the shot and that pane is cracked or shattered", () => {
    rig.getOut();
    const torso = rig.torso();
    rig.place(1, torso.x + 6, torso.z);
    rig.run(0.5);
    const car = rig.cars()[1]!;
    car.group.updateMatrixWorld(true);
    const eye = new THREE.Vector3(torso.x, torso.y + 0.3, torso.z);
    const sides = car.glassPanes.filter((pane) => pane.name === "doorL" || pane.name === "doorR");
    const at = (pane: (typeof sides)[number]): THREE.Vector3 => pane.mesh.getWorldPosition(new THREE.Vector3());
    const pane = sides.reduce((near, next) => (at(next).distanceTo(eye) < at(near).distanceTo(eye) ? next : near));
    expect(pane.state, "control: the pane is whole").toBe("intact");
    const centre = at(pane);
    const ray = rayFrom(eye.x, eye.y, eye.z, centre.x, centre.y, centre.z);
    for (let shot = 0; shot < 8; shot++) rig.engine["openWorld"].shoot(ray, WEAPONS.shotgun);
    expect(car.velocity.x, "the car's speed along the shot (m/s)").toBeGreaterThan(0);
    expect(pane.state, `pane ${pane.name}`).not.toBe("intact");
  });

  // mutation: sed -i '/^    this.openWorld.shotFired();/d' src/game/engine/engine.ts
  it("when he fires any gun, then the police chase opens, seen or not", () => {
    rig.getOut();
    const scene = rig.engine["openWorld"]["law"]!["scene"];
    expect(scene.footChaseOf({ cops: 0, hold: 0, left: 0 }), "control: no chase before the shot").toBe(false);
    rig.press("Digit2");
    fire();
    rig.run(0.5);
    expect(scene.footChaseOf({ cops: 0, hold: 0, left: 0 }), "the chase").toBe(true);
  });

  // mutation: sed -i 's/every: 0.12, auto: true,/every: 0.12, auto: false,/' src/game/engine/engine-onfoot-arms.ts
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

  // mutation: sed -i 's/^      arms: this.arms.hud(),/      arms: null,/' src/game/engine/engine-onfoot.ts
  it("when 2 is pressed on foot in the open world, then the HUD's weapon reads Pistol; LB steps back to Fists and RB on to Shotgun", () => {
    rig.getOut();
    const onFoot = rig.engine["onFoot"];
    rig.press("Digit2");
    expect(onFoot.hud()!.arms, "after 2").toEqual({ slot: 1, name: "Pistol" });
    onFoot.padPress(1 << PAD_BUTTON.lb);
    expect(onFoot.hud()!.arms, "after LB").toEqual({ slot: 0, name: "Fists" });
    onFoot.padPress(1 << PAD_BUTTON.rb);
    onFoot.padPress(1 << PAD_BUTTON.rb);
    expect(onFoot.hud()!.arms, "after RB twice").toEqual({ slot: 2, name: "Shotgun" });
  });

  // mutation: sed -i 's/^    if (this.armed() \&\& this.arms.key(e.code)) return true;/    if (this.arms.key(e.code)) return true;/' src/game/engine/engine-onfoot.ts
  it("when a digit is pressed at the wheel, then no weapon is taken: the weapon in hand stays fists", () => {
    rig.sit(0);
    rig.press("Digit3");
    expect(rig.engine["onFoot"].arms.weapon).toBe("fists");
  });
});
