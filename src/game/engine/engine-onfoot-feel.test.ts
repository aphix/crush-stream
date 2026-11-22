import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detAtan2, detCos, detSin } from "../kernel/physics-core.js";
import { RUN_SPEED, WALK_SPEED } from "../present/walker-locomotion.ts";
import { wrapAngle } from "../present/walker-math.ts";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";

/** The fleet's crash loop seed that stops car 0 with its driver in and room at its door (the fleet on-foot rows' `LOOP_DRIVER_IN_SEED`). */
const LOOP_DRIVER_IN_SEED = 4;
/** The other cars wait this far out on the disc once the crash is over, so no wreck lies at car 0's door. */
const PARKED_AT = 30;
/** He reaches the speed a key asks for within these (s), GTA's 0.3 s ramp (`.extraResearch/third-person-camera-and-controls.md`), and stops within this long and this far on release. */
const RUN_WITHIN_S = 0.35;
const WALK_WITHIN_S = 0.2;
const STOP_WITHIN_S = 0.35;
const STOP_WITHIN_M = 0.55;
/** He runs this long (s) before W is let go: past the 0.35 s ramp and its jerk-limited settling, at a steady run. */
const STEADY_RUN_S = 1;
/** A held diagonal is read for this long (s) from the moment he is out: through the camera's blend in, a press held on the view so the follow camera does not recentre. */
const DIAGONAL_S = 1;

let rig: OnFootRig;

/** Frames run while `held` keys are down until `done` (at most `limit` s); the seconds it took, `Infinity` when it never did. */
function secondsUntil(held: readonly string[], done: () => boolean, limit: number): number {
  const keys = rig.engine["keys"];
  for (let k = 0; k < held.length; k++) keys.add(held[k]!);
  let seconds = Infinity;
  for (let f = 1; f <= Math.round(limit / FRAME) && seconds === Infinity; f++) {
    rig.run(FRAME);
    if (done()) seconds = f * FRAME;
  }
  for (let k = 0; k < held.length; k++) keys.delete(held[k]!);
  return seconds;
}

/** From a steady run on the keys, released: the seconds until he stands still and the metres his root went on. */
function stopFromRun(): { seconds: number; metres: number } {
  const walker = rig.walker();
  secondsUntil(["KeyW"], () => false, STEADY_RUN_S);
  expect(walker.loco.speed, "control: a steady run when W is let go (m/s)").toBeCloseTo(RUN_SPEED, 2);
  let metres = 0;
  const seconds = secondsUntil(
    [],
    () => {
      metres += walker.loco.speed * FRAME;
      return walker.loco.speed === 0;
    },
    1,
  );
  return { seconds, metres };
}

/** The world heading his walker is given each frame while W and D are held for `seconds`, less the view's own heading (its orbit yaw turned to face away). */
function headingsAgainstView(seconds: number): { world: number[]; view: number[] } {
  const out = { world: [] as number[], view: [] as number[] };
  const view = rig.engine["view"];
  secondsUntil(
    ["KeyW", "KeyD"],
    () => {
      out.world.push(rig.walker().heading);
      out.view.push(wrapAngle(rig.walker().heading - detAtan2(-detSin(view.orbitAngle), -detCos(view.orbitAngle))));
      return false;
    },
    seconds,
  );
  return out;
}

const spread = (values: readonly number[]): number => Math.max(...values.map((v) => Math.abs(wrapAngle(v - values[0]!))));

describe("given the real engine in the fleet, its player at the wheel of car 0", () => {
  beforeAll(async () => {
    rig = await OnFootRig.boot();
    rig.engine["looping"] = false;
    rig.run(FRAME);
    rig.stoppedInFleetLoop(LOOP_DRIVER_IN_SEED);
    rig.normalTime();
    for (let i = 1; i < rig.cars().length; i++) rig.place(i, PARKED_AT * (i % 2 === 0 ? 1 : -1), -PARKED_AT + 4 * i);
    rig.run(0.2);
  });
  afterAll(() => rig.dispose());

  // mutation: sed -i 's/^    this.pollInput(wallDt);$//; s/^\(          this.pace.run(simDt.*\)$/\1\n          this.pollInput(wallDt);/' /home/aphix/worktrees/Feel/src/game/engine/engine.ts
  it("when W goes down, then the car's shaped drive asks for throttle in the frame the key is first read", () => {
    expect(rig.engine["seat"].mode, "he has the wheel").toBe("drive");
    expect(secondsUntil(["KeyW"], () => rig.engine["seat"]["out"].throttle > 0, FRAME), "throttle in the first frame").toBe(FRAME);
    rig.run(0.5);
  });

  // mutation: sed -i 's/^      this.onFoot.frame(wallDt);$//; s/^\(      this.ragdolls.update(simDt, .*\)$/\1\n      this.onFoot.frame(wallDt);/' /home/aphix/worktrees/Feel/src/game/engine/engine.ts
  it("when he is out and W goes down, then his walker is moving in the frame the key is first read", () => {
    rig.getOut();
    rig.run(1);
    expect(secondsUntil(["KeyW"], () => rig.walker().loco.speed > 0, FRAME), "moving in the first frame").toBe(FRAME);
    rig.run(1);
  });

  // mutation: sed -i 's/^const JERK = 175;/const JERK = 40;/' /home/aphix/worktrees/Feel/src/game/present/walker-locomotion.ts
  it("when he stands and W is held, then he runs within 0.35 s, and with the walk control within 0.2 s", () => {
    const walker = rig.walker();
    expect(secondsUntil(["KeyW"], () => walker.loco.speed >= 0.98 * RUN_SPEED, 1), "to a run").toBeLessThanOrEqual(RUN_WITHIN_S);
    rig.run(1);
    expect(secondsUntil(["KeyW", "Space"], () => walker.loco.speed >= 0.98 * WALK_SPEED, 1), "to a walk").toBeLessThanOrEqual(WALK_WITHIN_S);
    rig.run(1);
  });

  // mutation: sed -i 's/^const BRAKE_AT_RUN = 14;/const BRAKE_AT_RUN = 5;/' /home/aphix/worktrees/Feel/src/game/present/walker-locomotion.ts
  it("when he runs and W is let go, then he stands still within 0.35 s and half a metre", () => {
    const stop = stopFromRun();
    expect(stop.seconds, "seconds to a stand").toBeLessThanOrEqual(STOP_WITHIN_S);
    expect(stop.metres, "metres to a stand").toBeLessThanOrEqual(STOP_WITHIN_M);
  });

  // mutation: sed -i -e 's/^    const ahead = -detSin(view.orbitAngle);/    const ahead = view.look.x - this.host.camera.position.x;/' -e 's/^    const side = -detCos(view.orbitAngle);/    const side = view.look.z - this.host.camera.position.z;/' /home/aphix/worktrees/Feel/src/game/engine/engine-onfoot.ts
  it("when he gets out and holds forward and right with the view held still, then his heading stays the same way off the view's every frame through the camera's blend in", () => {
    rig.getIn();
    rig.getOut();
    const view = rig.engine["view"];
    // A press held on the view without moving: the player holds the camera, so the follow camera's recentre waits.
    Object.assign(view["canvas"], { setPointerCapture() {}, releasePointerCapture() {}, style: {} });
    const press = (type: string) => Object.assign(new Event(type), { button: 0, pointerId: 1, clientX: 300, clientY: 300 }) as PointerEvent;
    view["onPointerDown"](press("pointerdown"));
    const yaw = view.orbitAngle;
    const held = headingsAgainstView(DIAGONAL_S);
    // Let go as a cancel: a click in place would pick the car under the cursor.
    view["onPointerUp"](press("pointercancel"));
    expect(view.orbitAngle, "control: the view kept still").toBe(yaw);
    expect(spread(held.view), "heading against the view (rad)").toBeLessThan(1e-6);
    expect(spread(held.world), "world heading (rad)").toBeLessThan(1e-6);
  });
});
