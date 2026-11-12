import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import { WALKER_SLOT } from "../present/ragdoll-pool.ts";
import { wrapAngle } from "../present/walker-math.ts";
import { WALK_SPEED } from "../present/walker-locomotion.ts";
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

/** How far (m) his right forearm stands ahead of his torso along his facing. */
function forearm(): number {
  const bodies = rig.engine["ragdolls"]["dolls"][WALKER_SLOT]!.bodies;
  const a = bodies[5]!.translation();
  const b = bodies[0]!.translation();
  const w = rig.walker();
  return (a.x - b.x) * detSin(w.facing) + (a.z - b.z) * detCos(w.facing);
}

/** The stand-in canvas has no pointer capture and no cursor: the camera asks for both. */
function pointer(type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number): void {
  const view = rig.engine["view"];
  Object.assign(view["canvas"], { setPointerCapture() {}, releasePointerCapture() {}, style: {} });
  const press = Object.assign(new Event(type), { button: 0, pointerId: 1, clientX: x, clientY: y }) as PointerEvent;
  if (type === "pointerdown") view["onPointerDown"](press);
  else if (type === "pointermove") view["onPointerMove"](press);
  else view["onPointerUp"](press);
}

/** The heading (rad) the camera looks along, level. */
function cameraHeading(): number {
  const look = rig.engine["view"].look;
  const eye = rig.engine["camera"].position;
  return detAtan2(look.x - eye.x, look.z - eye.z);
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
  // mutation: sed -i 's/^export const PLAYER_PUNCH_COOLDOWN = 0.6;/export const PLAYER_PUNCH_COOLDOWN = 0;/' src/game/ai/civilians/civilian-constants.ts
  it("when fire is pressed on foot in the open world, then his right forearm goes at least 0.3 m forward within a quarter second, the punch lands once, and a second press inside the cooldown throws nothing", () => {
    rig.getOut();
    const landed = vi.spyOn(rig.engine["openWorld"], "punch");
    const before = forearm();
    fire();
    let reach = before;
    for (let f = 0; f < 15; f++) {
      rig.run(FRAME);
      reach = Math.max(reach, forearm());
    }
    expect(reach - before, "his forearm's greatest reach forward (m)").toBeGreaterThanOrEqual(0.3);
    fire();
    // Past the punch's own 0.45 s and inside the 0.6 s cooldown: only the cooldown refuses this one.
    rig.run(0.5 - 15 * FRAME);
    fire();
    rig.run(0.5);
    expect(landed, "punches landed").toHaveBeenCalledTimes(1);
    landed.mockRestore();
  });

  // mutation: sed -i 's/    return this.host.openWorld() \&\& this.flow.phase === "onFoot" \&\& !this.host.guest();/    return this.host.openWorld() \&\& this.flow.phase === "onFoot";/' src/game/engine/engine-onfoot.ts
  it("when a guest in a room presses fire on foot in the open world, then nothing is thrown", () => {
    rig.getOut();
    const landed = vi.spyOn(rig.engine["openWorld"], "punch");
    const net = rig.engine["net"];
    const role = net.role;
    try {
      Object.defineProperty(net, "role", { value: "client", configurable: true, writable: true });
      fire();
      rig.run(0.5);
      expect(landed, "punches landed").not.toHaveBeenCalled();
      expect(rig.engine["onFoot"].armed(), "armed").toBe(false);
    } finally {
      Object.defineProperty(net, "role", { value: role, configurable: true, writable: true });
      landed.mockRestore();
    }
  });

  // mutation: sed -i 's/^    if (this.arms.aiming) {/    if (false) {/' src/game/engine/engine-onfoot.ts
  it("when aim is held, then he turns to the camera's forward and a sideways key does not move him; forward walks him at no more than walking pace", () => {
    rig.getOut();
    const keys = rig.engine["keys"];
    rightButton(true);
    try {
      const start = rig.torso();
      keys.add("KeyD");
      rig.run(1);
      const sideways = rig.torso();
      expect(hypot2(sideways.x - start.x, sideways.z - start.z), "moved by D (m)").toBeLessThan(0.2);
      expect(Math.abs(wrapAngle(rig.walker().heading - cameraHeading())), "his heading off the camera's (rad)").toBeLessThanOrEqual(0.05);
      keys.delete("KeyD");
      keys.add("KeyW");
      rig.run(2);
      const ahead = rig.torso();
      const walked = hypot2(ahead.x - sideways.x, ahead.z - sideways.z);
      expect(walked, "moved by W (m)").toBeGreaterThan(0.5);
      expect(walked, "no farther than a walk (m)").toBeLessThanOrEqual(WALK_SPEED * 2 + 0.3);
    } finally {
      keys.clear();
      rightButton(false);
    }
  });

  // mutation: sed -i 's/^    } else if (!cancelled \&\& click \&\& this.click?.()) return;/    }/' src/game/present/engine-camera.ts
  it("when the mouse is free, then a click on the view throws one punch and a drag turns the view and throws none", () => {
    rig.getOut();
    const punched = vi.spyOn(rig.walker(), "punch");
    pointer("pointerdown", 300, 300);
    pointer("pointerup", 300, 300);
    expect(punched, "punches after the click").toHaveBeenCalledTimes(1);
    rig.run(1);
    pointer("pointerdown", 300, 300);
    pointer("pointermove", 360, 300);
    pointer("pointerup", 360, 300);
    expect(punched, "punches after the drag").toHaveBeenCalledTimes(1);
    punched.mockRestore();
  });
});
