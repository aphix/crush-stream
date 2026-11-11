import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hypot2 } from "../kernel/physics-core.js";
import { blankPad, PAD_BUTTON, readPad, type PadSource, type TouchPad } from "../vehicle/gamepad.ts";
import { blankWalkIntent, readWalkIntent } from "./engine-walk-input.ts";
import { OnFootDirector } from "./engine-onfoot.ts";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";
import { wrapAngle } from "../present/walker-math.ts";

const noTouch: TouchPad = { x: 0, y: 0, gas: 0, brake: 0, held: 0, tapped: 0 };
const SETTLE_S = 0.5;
const CLIMB_S = 1.5;
/** The fleet's crash loop seed that stops car 0 with its driver in and room at its door (the fleet on-foot rows' `LOOP_DRIVER_IN_SEED`). */
const LOOP_DRIVER_IN_SEED = 4;
/** The other cars wait this far out on the disc once the crash is over, so no wreck lies at car 0's door. */
const PARKED_AT = 30;

/** A standard-mapping pad with the left stick at (`x`, 0). */
function stickPad(x: number): PadSource {
  return { connected: true, axes: [x, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
}

describe("given the pad's one dead zone and curve on foot", () => {
  const speedAt = (raw: number): number => {
    const state = blankPad();
    readPad(stickPad(raw), state);
    const intent = readWalkIntent(new Set(), state, noTouch, blankWalkIntent());
    // mutation: sed -i 's/CREEP_SPEED + (RUN_SPEED - CREEP_SPEED) \* Math.min(1, reach)/CREEP_SPEED + (RUN_SPEED - CREEP_SPEED) * Math.min(1, reach) ** 1.5/' src/game/engine/engine-onfoot.ts
    return OnFootDirector.prototype["pace"].call(null as never, intent, hypot2(intent.forward, intent.strafe));
  };

  it("when the left stick is pushed 0.25, 0.5, 0.75 and all the way, then he walks 0.87, 1.40, 2.29 and 3.50 m/s", () => {
    for (const [raw, mps] of [[0.25, 0.87], [0.5, 1.4], [0.75, 2.29], [1, 3.5]] as const) expect(Math.abs(speedAt(raw) - mps), `stick ${raw}: ${speedAt(raw).toFixed(3)} m/s`).toBeLessThan(0.01);
  });
});

describe("given the real engine in the fleet, its player at the wheel of car 0", () => {
  let rig: OnFootRig;
  beforeAll(async () => {
    rig = await OnFootRig.boot();
    rig.engine["looping"] = false;
    rig.run(FRAME);
    // A pinned scene seed rolls the same crash every run, and car 0 is run until it has stopped in it: too fast a car is refused leaving.
    rig.stoppedInFleetLoop(LOOP_DRIVER_IN_SEED);
    rig.normalTime();
    for (let i = 1; i < rig.cars().length; i++) rig.place(i, PARKED_AT * (i % 2 === 0 ? 1 : -1), -PARKED_AT + 4 * i);
    rig.run(0.2);
  });
  afterAll(() => rig.dispose());
  const tap = (button: number): void => {
    rig.engine.touch.tapped |= 1 << button;
    rig.run(CLIMB_S);
  };

  // mutation: sed -i 's/const ON_FOOT_BUTTON = 1 << PAD_BUTTON.north/const ON_FOOT_BUTTON = 1 << PAD_BUTTON.east/' src/game/engine/engine-onfoot.ts
  it("when Y is pressed at the wheel, then he gets out, and Y at his door gets him back in; B does neither", () => {
    tap(PAD_BUTTON.east);
    expect(rig.phase(), "B did not get him out").toBe("inCar");
    tap(PAD_BUTTON.north);
    expect(rig.phase(), "Y got him out").toBe("onFoot");
    tap(PAD_BUTTON.east);
    expect(rig.phase(), "B did not get him in").toBe("onFoot");
    tap(PAD_BUTTON.north);
    expect(rig.phase(), "Y got him back in").toBe("inCar");
  });

  // mutation: sed -i 's/const VIEW_BUTTON = 1 << PAD_BUTTON.east/const VIEW_BUTTON = 1 << PAD_BUTTON.north/' src/game/engine/engine-onfoot.ts
  it("when he is out and B is pressed, then the on-foot view cycles to his eyes and back, and Y does not cycle it", () => {
    tap(PAD_BUTTON.north);
    rig.run(SETTLE_S);
    expect(rig.engine["onFoot"].footView).toBe("shoulder");
    tap(PAD_BUTTON.east);
    expect(rig.engine["onFoot"].footView, "B: his eyes").toBe("first");
    tap(PAD_BUTTON.east);
    expect(rig.engine["onFoot"].footView, "B again: over his shoulder").toBe("shoulder");
  });

  // mutation: sed -i 's/^const INTENT_SECONDS = 0.08;/const INTENT_SECONDS = 1e-9;/' src/game/engine/engine-onfoot.ts
  it("when D is pressed while W is held, then his heading has turned by less than 0.6 rad three frames later, and by 0.7 rad or more half a second later", () => {
    if (rig.phase() !== "onFoot") rig.getOut();
    rig.engine["keys"].add("KeyW");
    rig.run(0.5);
    const start = rig.walker().heading;
    rig.engine["keys"].add("KeyD");
    rig.run(3 * FRAME);
    const early = Math.abs(wrapAngle(rig.walker().heading - start));
    rig.run(0.5);
    const late = Math.abs(wrapAngle(rig.walker().heading - start));
    rig.engine["keys"].clear();
    expect(early, "three frames after D").toBeLessThan(0.6);
    expect(late, "half a second after D").toBeGreaterThanOrEqual(0.7);
  });
});
