import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WORLD } from "../contact/tether.ts";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";

const LINK = "#scene=openworld&seed=beef";
/** Seconds the traffic needs to stand its first kerb cars (its first passes show every space in reach). */
const SETTLE_S = 3;

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

  // mutation: sed -i '/^    if (!this.host.afoot() \&\& (this.host.tethers.count > 0 || this.held)) this.cut();/d' src/game/engine/engine-tether.ts
  it("when he gets back into his car with a cable out, then no cable is left", () => {
    rig.getOut();
    const tethers = rig.engine["world"].tethers;
    const slot = tethers.open();
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
});
