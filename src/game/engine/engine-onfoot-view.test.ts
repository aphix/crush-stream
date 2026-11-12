import { hypot2, hypot3 } from "../kernel/physics-core.js";
import * as THREE from "three";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WALKER_SLOT } from "../present/ragdoll-pool.ts";
import type { FloorBox } from "../present/walker-floor.ts";
import { DRAG_YAW_PER_PX } from "../present/free-cam.ts";
import { FIRST_PERSON_RADIUS, SHOULDER_BOOM, SHOULDER_NEAREST, SQUEEZED_BOOM } from "../present/walker-camera.ts";
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
/** How far (m) from his eye a stale aim stands: nearer than the orbit's nearest boom, so the adopted pose is clamped to it. */
const HAND_WIDTH_M = 0.3;

describe("given the real engine in the fleet, its player at the wheel of car 0", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let rig: OnFootRig;
  const onFoot = () => rig.engine["onFoot"];
  const view = () => rig.engine["view"];
  const wheel = (deltaY: number) => view()["onWheel"](Object.assign(new Event("wheel"), { deltaY }) as WheelEvent);
  /** The stand-in canvas has no pointer capture and no cursor: the camera asks for both. */
  const pointer = (type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number) => {
    Object.assign(view()["canvas"], { setPointerCapture() {}, releasePointerCapture() {}, style: {} });
    const press = Object.assign(new Event(type), { button: 0, pointerId: 1, clientX: x, clientY: y }) as PointerEvent;
    if (type === "pointerdown") view()["onPointerDown"](press);
    else if (type === "pointermove") view()["onPointerMove"](press);
    else view()["onPointerUp"](press);
  };
  /** A pen of walls round him, the face of each `PEN_FACE_M` from his middle. */
  const wallItIn = () => {
    const middle = rig.torso();
    const wall = (x0: number, z0: number, x1: number, z1: number): FloorBox => ({ x0, z0, x1, z1, y0: middle.y - 1.2, y1: middle.y - 1.2 + PEN_HEIGHT_M });
    const out = PEN_FACE_M + PEN_WALL_M;
    rig.engine["ragdolls"].setFixedBoxes([
      wall(middle.x - out, middle.z - out, middle.x - PEN_FACE_M, middle.z + out),
      wall(middle.x + PEN_FACE_M, middle.z - out, middle.x + out, middle.z + out),
      wall(middle.x - out, middle.z - out, middle.x + out, middle.z - PEN_FACE_M),
      wall(middle.x - out, middle.z + PEN_FACE_M, middle.x + out, middle.z + out),
    ]);
  };

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
    const off = hypot2(eye.x - torso.x, eye.z - torso.z);
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
    wallItIn();
    rig.run(SETTLE_S);
    const boom = view().orbitRadius;
    const mesh = rig.engine["ragdolls"].pickMesh;
    for (let step = 0; step < DRAG_STEPS; step++) {
      view().lookBy(DRAG_PX, step % 2 === 0 ? DRAG_PX / 4 : -DRAG_PX / 4);
      rig.run(FRAME);
      const him = rig.torso();
      const eye = rig.engine["camera"].position;
      const head = hypot3(eye.x - him.x, eye.y - (him.y + HEAD_OVER_TORSO), eye.z - him.z);
      expect(onFoot().footView, `drag ${step}: still over his shoulder`).toBe("shoulder");
      expect(mesh.viewHidden.value, `drag ${step}: his head is drawn`).toBe(-1);
      expect(head, `drag ${step}: the eye is ${head.toFixed(2)} m from his head`).toBeGreaterThan(HEAD_CLEAR_M);
    }
    expect(view().orbitRadius, "the drag did not zoom").toBeCloseTo(boom, 6);
    expect(SQUEEZED_BOOM, "the squeeze is a head's reach").toBeGreaterThan(HEAD_CLEAR_M);
  });

  // mutation: sed -i '/^      this.view.frameRide(null);$/d' src/game/engine/engine.ts
  it("when a ride-along or the Auto camera held the view just before he took over on foot, then a press, a drag and a release of the mouse round him leave it his shoulder view at his boom", () => {
    const stale = new THREE.Vector3(0, 1, 0);
    rig.getOut();
    rig.run(SETTLE_S);
    const boom = view().orbitRadius;
    // The ride flag the other cameras leave up: on foot nothing else clears it, and a press with it up takes the orbit's pose from the camera and its aim.
    view().frameRide(stale);
    rig.run(FRAME);
    expect(view()["ride"], "the walker's camera ended the ride's hold on the view").toBe(false);
    const angle = view().orbitAngle;
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 100 + DRAG_PX, 100);
    rig.run(SETTLE_S);
    expect(angle - view().orbitAngle, "the drag turned the orbit by its pixels (rad): it was a drag").toBeCloseTo(DRAG_PX * DRAG_YAW_PER_PX, 3);
    expect(onFoot().footView, "pressed and dragged: still over his shoulder").toBe("shoulder");
    pointer("pointerup", 100 + DRAG_PX, 100);
    rig.run(SETTLE_S);
    expect(onFoot().footView, "released: still over his shoulder").toBe("shoulder");
    expect(view().orbitRadius, "the boom after the drag (m)").toBeCloseTo(boom, 6);
    pointer("pointerdown", 100, 100);
    pointer("pointerup", 100, 100);
    rig.run(SETTLE_S);
    expect(onFoot().footView, "a click: still over his shoulder").toBe("shoulder");
  });

  // mutation: sed -i '/^    if (e.pointerId === this.dragId || e.pointerId === this.pinchId) this.release(e, true);/d' src/game/present/engine-camera.ts
  it("when a press's release is lost and he presses and drags again, then the view turns by the drag and stays over his shoulder at his boom", () => {
    rig.getOut();
    rig.run(SETTLE_S);
    const boom = view().orbitRadius;
    pointer("pointerdown", 100, 100);
    rig.run(FRAME);
    const angle = view().orbitAngle;
    pointer("pointerdown", 400, 100);
    pointer("pointermove", 400 + DRAG_PX, 100);
    rig.run(SETTLE_S);
    expect(angle - view().orbitAngle, "the second drag turned the orbit by its pixels (rad)").toBeCloseTo(DRAG_PX * DRAG_YAW_PER_PX, 3);
    expect(view().orbitRadius, "the boom after the drag (m): no pinch zoomed it").toBeCloseTo(boom, 6);
    expect(onFoot().footView, "still over his shoulder").toBe("shoulder");
    pointer("pointerup", 400 + DRAG_PX, 100);
  });

  // mutation: sed -i -e 's/    return this.framed ? this.mode : "shoulder";/    return this.framed \&\& this.host.view.orbitRadius < SHOULDER_NEAREST ? "first" : "shoulder";/' -e 's/    } else if (view.orbitRadius !== this.zoomKept) {/    } else if (false) {/' src/game/engine/engine-onfoot.ts
  it("when a press lands with the orbit's pose read from a point a hand's width from his eye in a pen of walls, then it stays his shoulder view at his boom, his head drawn and the eye off it", () => {
    rig.getOut();
    rig.run(SETTLE_S);
    wallItIn();
    rig.run(SETTLE_S);
    const boom = view().orbitRadius;
    const eye = rig.engine["camera"].position;
    // What an adopted pose is when the camera's aim stands this near the squeezed eye: the orbit's own nearest boom, inside the shoulder camera's.
    view().frameRide(new THREE.Vector3(eye.x, eye.y, eye.z + HAND_WIDTH_M));
    pointer("pointerdown", 100, 100);
    pointer("pointerup", 100, 100);
    expect(view().orbitRadius, "the press took the orbit's pose from the camera and the aim (m)").toBeLessThan(SHOULDER_NEAREST);
    rig.run(SETTLE_S);
    const him = rig.torso();
    const head = hypot3(eye.x - him.x, eye.y - (him.y + HEAD_OVER_TORSO), eye.z - him.z);
    expect(onFoot().footView, "a press by the wall: still over his shoulder").toBe("shoulder");
    expect(rig.engine["ragdolls"].pickMesh.viewHidden.value, "his head is drawn").toBe(-1);
    expect(head, `the eye is ${head.toFixed(2)} m from his head`).toBeGreaterThan(HEAD_CLEAR_M);
    expect(view().orbitRadius, "the boom is where he had it (m)").toBeCloseTo(boom, 6);
  });

  // mutation: sed -i 's/    } else if (view.orbitRadius !== this.zoomKept) {/    } else if (false) {/' src/game/engine/engine-onfoot.ts
  it("when anything but the wheel, a pinch or View moves the orbit's zoom to his eyes' distance, then he stays in the shoulder view and the zoom is put back, and the wheel's last notch still takes him to his eyes", () => {
    rig.getOut();
    rig.run(SETTLE_S);
    const boom = view().orbitRadius;
    // Whatever left the orbit's pose to be read from the camera and its aim, a hold on the view or an eased pose: not the player's zoom.
    view().easeOrbit(FIRST_PERSON_RADIUS, view().orbitPitch, 1);
    rig.run(SETTLE_S);
    expect(onFoot().footView, "the zoom moved by another writer: still over his shoulder").toBe("shoulder");
    expect(view().orbitRadius, "and the boom is where he had it (m)").toBeCloseTo(boom, 6);
    for (let n = 0; n < NOTCHES_IN; n++) wheel(-NOTCH);
    rig.run(FRAME);
    expect(onFoot().footView, "the wheel's last notch: his eyes").toBe("first");
    for (let n = 0; n < NOTCHES_OUT; n++) wheel(NOTCH);
    rig.run(FRAME);
    expect(onFoot().footView, "a few notches out: over his shoulder").toBe("shoulder");
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
