import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WALKER_SLOT } from "../present/ragdoll-pool.ts";
import type { FloorBox } from "../present/walker-floor.ts";
import { SHOULDER_BOOM, SQUEEZED_BOOM } from "../present/walker-camera.ts";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";

/** The blend from the car's camera to his (0.3 s) and a frame's slack (s). */
const SETTLE_S = 0.5;
/** Wheel notches (a mouse's 120 a notch, in and out) that take the nearest shoulder camera through to his eyes, and back out of them. */
const NOTCH = 120;
const NOTCHES_IN = 30;
const NOTCHES_OUT = 3;
/** First person: his eyes over his torso's centre (m), and how far off it across the level the eye may stand. */
const EYE_OVER_TORSO_MIN = 0.4;
const EYE_OVER_TORSO_MAX = 0.7;
const EYE_OFF_TORSO_MAX = 0.25;
/** A pen of walls round him (the face of each this far, m, from his middle: past his arms' reach of 0.3) and what a drag turns through. */
const PEN_FACE_M = 0.45;
const PEN_WALL_M = 0.5;
const PEN_HEIGHT_M = 3;
const DRAG_PX = 40;
const DRAG_STEPS = 60;
/** His head's centre over his torso's (m), and the nearest the eye may come to it in the shoulder view. */
const HEAD_OVER_TORSO = 0.52;
const HEAD_CLEAR_M = 0.45;

describe("given the real engine in the fleet, its player at the wheel of car 0", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let rig: OnFootRig;
  const onFoot = () => rig.engine["onFoot"];
  const view = () => rig.engine["view"];
  const wheel = (deltaY: number) => view()["onWheel"](Object.assign(new Event("wheel"), { deltaY }) as WheelEvent);

  beforeAll(async () => {
    rig = await OnFootRig.boot();
    rig.engine["looping"] = false;
    rig.run(FRAME);
  });
  beforeEach(() => {
    rig.normalTime();
    onFoot().reset();
    rig.engine["ragdolls"].reset();
    // The dummies' world keeps the boxes a row streamed in across a reset (a building's stay while he walks): a row's pen must not close the next one's door.
    rig.engine["ragdolls"].setFixedBoxes([]);
    for (let i = 0; i < rig.cars().length; i++) rig.place(i, i === 0 ? 0 : 30 * (i % 2 === 0 ? 1 : -1), i === 0 ? 0 : -30 + 4 * i);
    rig.sit(0);
    rig.run(0.2);
  });
  afterAll(() => rig.dispose());

  // mutation: sed -i 's/    if (this.flow.active \&\& SEAT_KEYS.camera.includes(e.code)) {/    if (false) {/' src/game/engine/engine-onfoot.ts
  it("when V is pressed at the wheel, then the drive view cycles; out of the car V goes from over his shoulder to his eyes and back, and leaves the drive view as it was", () => {
    const seat = rig.engine["seat"];
    const before = seat.view;
    rig.press("KeyV");
    expect(seat.view, "V at the wheel cycles the drive view").not.toBe(before);
    const driven = seat.view;
    rig.getOut();
    rig.run(SETTLE_S);
    expect(onFoot().footView, "out of the car: over his shoulder").toBe("shoulder");
    rig.press("KeyV");
    rig.run(FRAME);
    expect(onFoot().footView, "V: his eyes").toBe("first");
    rig.press("KeyV");
    rig.run(FRAME);
    expect(onFoot().footView, "V again: over his shoulder").toBe("shoulder");
    expect(seat.view, "the drive view is as he left it").toBe(driven);
  });

  // mutation: sed -i 's/    this.mesh.viewHidden.value = shown ? -1 : WALKER_SLOT;/    this.mesh.viewHidden.value = -1;/' src/game/present/ragdoll-throw.ts
  it("when he is out and V takes the camera to his eyes, then it stands at his head and his head and torso are not drawn to it; over his shoulder they are", () => {
    const mesh = rig.engine["ragdolls"].pickMesh;
    rig.getOut();
    rig.run(SETTLE_S);
    expect(mesh.viewHidden.value, "over his shoulder he is drawn whole").toBe(-1);
    rig.press("KeyV");
    rig.run(SETTLE_S);
    expect(mesh.viewHidden.value, "his eyes: his head and torso are not drawn").toBe(WALKER_SLOT);
    const torso = rig.torso();
    const eye = rig.engine["camera"].position;
    const off = Math.hypot(eye.x - torso.x, eye.z - torso.z);
    expect(off, `the eye is at his head: ${off.toFixed(2)} m off his torso across`).toBeLessThan(EYE_OFF_TORSO_MAX);
    expect(eye.y - torso.y >= EYE_OVER_TORSO_MIN && eye.y - torso.y <= EYE_OVER_TORSO_MAX, `at his eyes' height: ${(eye.y - torso.y).toFixed(2)} m over his torso`).toBeTruthy();
    rig.press("KeyV");
    rig.run(SETTLE_S);
    expect(mesh.viewHidden.value, "over his shoulder again he is drawn whole").toBe(-1);
  });

  // mutation: sed -i 's/^export const SQUEEZED_BOOM = 0.6;/export const SQUEEZED_BOOM = 0;/' src/game/present/walker-camera.ts
  it("when the mouse drags the view round him on foot with a wall close on every side, then it stays his shoulder view at the wheel's boom, his head drawn and the eye off it", () => {
    rig.getOut();
    rig.run(SETTLE_S);
    const middle = rig.torso();
    const wall = (x0: number, z0: number, x1: number, z1: number): FloorBox => ({ x0, z0, x1, z1, y0: middle.y - 1.2, y1: middle.y - 1.2 + PEN_HEIGHT_M });
    const out = PEN_FACE_M + PEN_WALL_M;
    rig.engine["ragdolls"].setFixedBoxes([
      wall(middle.x - out, middle.z - out, middle.x - PEN_FACE_M, middle.z + out),
      wall(middle.x + PEN_FACE_M, middle.z - out, middle.x + out, middle.z + out),
      wall(middle.x - out, middle.z - out, middle.x + out, middle.z - PEN_FACE_M),
      wall(middle.x - out, middle.z + PEN_FACE_M, middle.x + out, middle.z + out),
    ]);
    rig.run(SETTLE_S);
    const boom = view().orbitRadius;
    const mesh = rig.engine["ragdolls"].pickMesh;
    for (let step = 0; step < DRAG_STEPS; step++) {
      view().lookBy(DRAG_PX, step % 2 === 0 ? DRAG_PX / 4 : -DRAG_PX / 4);
      rig.run(FRAME);
      const him = rig.torso();
      const eye = rig.engine["camera"].position;
      const head = Math.hypot(eye.x - him.x, eye.y - (him.y + HEAD_OVER_TORSO), eye.z - him.z);
      expect(onFoot().footView, `drag ${step}: still over his shoulder`).toBe("shoulder");
      expect(mesh.viewHidden.value, `drag ${step}: his head is drawn`).toBe(-1);
      expect(head, `drag ${step}: the eye is ${head.toFixed(2)} m from his head`).toBeGreaterThan(HEAD_CLEAR_M);
    }
    expect(view().orbitRadius, "the drag did not zoom").toBeCloseTo(boom, 6);
    expect(SQUEEZED_BOOM, "the squeeze is a head's reach").toBeGreaterThan(HEAD_CLEAR_M);
  });

  // mutation: sed -i 's/    view.minRadius = FIRST_PERSON_RADIUS;/    view.minRadius = this.carMinRadius;/' src/game/engine/engine-onfoot.ts
  it("when he is out, then the wheel zooms in to his eyes and out again, its nearest within the shoulder camera's boom; back at the wheel the car's zoom range is as it was", () => {
    const carNearest = view().minRadius;
    rig.getOut();
    rig.run(SETTLE_S);
    expect(view().minRadius, `the wheel's nearest on foot: ${view().minRadius} m`).toBeLessThanOrEqual(SHOULDER_BOOM);
    for (let n = 0; n < NOTCHES_IN; n++) wheel(-NOTCH);
    rig.run(FRAME);
    expect(onFoot().footView, "zoomed all the way in: his eyes").toBe("first");
    for (let n = 0; n < NOTCHES_OUT; n++) wheel(NOTCH);
    rig.run(FRAME);
    expect(onFoot().footView, "a few notches out: over his shoulder").toBe("shoulder");
    rig.getIn();
    expect(view().minRadius, "the car's zoom range").toBe(carNearest);
  });
});
