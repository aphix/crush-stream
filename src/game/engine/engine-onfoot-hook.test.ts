import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { WORLD } from "../contact/tether.ts";
import { detCos, detSin, hypot2, hypot3 } from "../kernel/physics-core.js";
import { driverLook } from "../present/driver-look.ts";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";

const LINK = "#scene=openworld&seed=beef";
/** Seconds the traffic needs to stand its first kerb cars (its first passes show every space in reach). */
const SETTLE_S = 3;
/** The pool slot the man he hooks stands in: a base slot no civilian's body takes. */
const MAN = 0;

// One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
let rig: OnFootRig;

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
  // mutation: sed -i 's/, Digit0: "hook"//' src/game/engine/engine-onfoot-arms.ts
  it("when 0 is pressed on foot in the open world, then the weapon in hand is the hook, the HUD names it and the tether is on offer; at the wheel it is not", () => {
    rig.getOut();
    rig.press("Digit0");
    rig.run(FRAME);
    expect(rig.engine["onFoot"].hud()!.arms, "the weapon").toEqual({ slot: 4, name: "Hook" });
    expect(rig.engine.tether.hud(), "on offer").not.toBe(null);
    rig.getIn();
    rig.press("Digit0");
    rig.run(FRAME);
    expect(rig.engine.tether.hud(), "at the wheel").toBe(null);
  });

  // mutation: sed -i '/^      this.host.hook();/d' src/game/engine/engine-onfoot-arms.ts
  it("when fire is pressed with the hook in hand, then the tether takes one fire; with the pistol in hand it takes none", () => {
    rig.getOut();
    const fired = vi.spyOn(rig.engine.tether, "fire");
    rig.press("Digit0");
    rig.engine["onFoot"].arms.press();
    rig.engine["onFoot"].arms.release();
    expect(fired).toHaveBeenCalledTimes(1);
    rig.press("Digit2");
    rig.engine["onFoot"].arms.press();
    rig.engine["onFoot"].arms.release();
    expect(fired).toHaveBeenCalledTimes(1);
    fired.mockRestore();
  });

  // mutation: sed -i '/^    if (!this.host.afoot()) this.cutFor(local);/d' src/game/engine/engine-tether.ts
  it("when he gets back into his car with a cable out, then no cable is left", () => {
    rig.getOut();
    const tethers = rig.engine["world"].tethers;
    const slot = tethers.open(rig.engine["seat"].carIndex);
    // The solver drops a cable whose two ends are both the world (nothing to pull): this one runs from his car's middle to a world point 5 m off it.
    const car = rig.cars()[0]!.group.position;
    tethers.setEnd(slot, 0, 0, 0, 0, 0);
    tethers.setEnd(slot, 1, WORLD, car.x, car.y, car.z + 5);
    tethers.fit(slot, rig.cars());
    rig.run(FRAME);
    expect(tethers.count, "on foot: the cable stays").toBe(1);
    rig.getIn();
    rig.run(FRAME);
    expect(tethers.count, "at the wheel").toBe(0);
  });

  // mutation: sed -i 's/    if (doll === undefined || !doll.live) return false;/    if (doll === undefined || !doll.live || doll.driven) return false;/' src/game/present/ragdoll-ropes.ts
  it("when he hooks a man standing 4 m ahead and then the ground 6 m to his side, then the cable's end stays on the man, and reeling drags him at least 2 m", () => {
    rig.getOut();
    rig.press("Digit0");
    rig.run(0.3);
    const { engine } = rig;
    const ragdolls = engine["ragdolls"];
    const tether = engine.tether;
    const tethers = engine["world"].tethers;
    const camera = engine["camera"];
    const facing = rig.walker().facing;
    const me = rig.torso();
    expect(ragdolls.startWalker(new THREE.Vector3(me.x + 4 * detSin(facing), 0, me.z + 4 * detCos(facing)), 0, { cop: false, look: driverLook(1, 0) }, MAN), "the man stands").toBe(MAN);
    rig.run(1);
    const man = ragdolls["dolls"][MAN]!;
    const fireAt = (x: number, y: number, z: number): void => {
      const eye = rig.torso();
      camera.position.set(eye.x, eye.y + 1.2, eye.z);
      camera.lookAt(x, y, z);
      camera.updateMatrixWorld(true);
      tether["aim"]();
      tether["fireDue"] = true;
      tether["attach"]();
    };
    fireAt(man.cur[0]!, man.cur[1]!, man.cur[2]!);
    fireAt(me.x + 6 * detCos(facing), 0, me.z - 6 * detSin(facing));
    rig.run(0.5);
    expect(tethers.count, "the cable is out").toBe(1);
    let slot = 0;
    while (!tethers.isAlive(slot)) slot++;
    const end = tethers.point(slot, 0, new THREE.Vector3());
    expect(hypot3(end.x - man.cur[0]!, end.y - man.cur[1]!, end.z - man.cur[2]!), "its end from his torso (m)").toBeLessThan(0.7);
    const from = [man.cur[0]!, man.cur[2]!];
    rig.hold("BracketRight", 1.5);
    expect(hypot2(man.cur[0]! - from[0]!, man.cur[2]! - from[1]!), "dragged by the reel (m)").toBeGreaterThanOrEqual(2);
  });
});
