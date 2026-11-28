import { hypot2, hypot3 } from "../kernel/physics-core.js";
import * as THREE from "three";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WALKER_SLOT } from "../present/ragdoll-pool.ts";
import type { FloorBox } from "../present/walker-floor.ts";
import { DRAG_YAW_PER_PX } from "../present/free-cam.ts";
import { FIRST_PERSON_RADIUS, SHOULDER_BOOM, SHOULDER_NEAREST } from "../present/walker-camera.ts";
import { RUN_SPEED, SPRINT_SPEED } from "../present/walker-locomotion.ts";
import { DRIVE_KEYS } from "../vehicle/drive-input.ts";
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
/** A wall this far (m) behind him across the camera's way, and the share of the held distance one notch in must leave at most (a notch zooms 12 %). */
const WALL_BEHIND_M = 1.5;
const NOTCH_IN_SHARE = 0.95;
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
  let pen: FloorBox[] = [];
  /** A pen of walls round him, the face of each `PEN_FACE_M` from his middle. */
  const wallItIn = () => {
    const middle = rig.torso();
    const wall = (x0: number, z0: number, x1: number, z1: number): FloorBox => ({ x0, z0, x1, z1, y0: middle.y - 1.2, y1: middle.y - 1.2 + PEN_HEIGHT_M });
    const out = PEN_FACE_M + PEN_WALL_M;
    pen = [
      wall(middle.x - out, middle.z - out, middle.x - PEN_FACE_M, middle.z + out),
      wall(middle.x + PEN_FACE_M, middle.z - out, middle.x + out, middle.z + out),
      wall(middle.x - out, middle.z - out, middle.x + out, middle.z - PEN_FACE_M),
      wall(middle.x - out, middle.z + PEN_FACE_M, middle.x + out, middle.z + out),
    ];
    rig.engine["ragdolls"].setFixedBoxes(pen);
  };
  /** The point stands inside one of the pen's walls. */
  const inPenWall = (p: THREE.Vector3) => pen.some((w) => p.x > w.x0 && p.x < w.x1 && p.z > w.z0 && p.z < w.z1 && p.y > w.y0 && p.y < w.y1);

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

  it("when V is pressed at the wheel, then the drive view cycles; out of the car V goes from the follow over his shoulder to his eyes and back, and leaves the drive view as it was", () => {
    const seat = rig.engine["seat"];
    const before = seat.view;
    rig.press("KeyV");
    expect(seat.view, "V at the wheel cycles the drive view").not.toBe(before);
    const driven = seat.view;
    rig.getOut();
    rig.run(SETTLE_S);
    expect(onFoot().footView, "out of the car: the follow").toBe("follow");
    rig.press("KeyV");
    rig.run(FRAME);
    expect(onFoot().footView, "V: over his shoulder").toBe("shoulder");
    rig.press("KeyV");
    rig.run(FRAME);
    expect(onFoot().footView, "V again: his eyes").toBe("first");
    rig.press("KeyV");
    rig.run(FRAME);
    expect(onFoot().footView, "V again: the follow").toBe("follow");
    expect(seat.view, "the drive view is as he left it").toBe(driven);
  });

  it("when he is out and V takes the camera to his eyes, then it stands at his head and his head and torso are not drawn to it; behind him they are", () => {
    const mesh = rig.engine["ragdolls"].pickMesh;
    rig.getOut();
    rig.run(SETTLE_S);
    expect(mesh.viewHidden.value, "the follow: he is drawn whole").toBe(-1);
    rig.press("KeyV");
    rig.run(SETTLE_S);
    expect(mesh.viewHidden.value, "over his shoulder: he is drawn whole").toBe(-1);
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
    expect(mesh.viewHidden.value, "the follow again: he is drawn whole").toBe(-1);
  });

  it("when V takes the camera to his eyes, then the near plane comes in under 0.1 m; when a reset puts him back at the wheel from there (no climb in to restore it), it is the car view's near exactly", () => {
    const camera = rig.engine["camera"];
    const carNear = camera.near;
    rig.getOut();
    rig.run(SETTLE_S);
    rig.press("KeyV");
    rig.press("KeyV");
    rig.run(SETTLE_S);
    expect(onFoot().footView, "his eyes").toBe("first");
    expect(camera.near, "the near plane at his eyes (m)").toBeLessThan(0.1);
    onFoot().reset();
    rig.sit(0);
    rig.run(FRAME);
    expect(camera.near, "the near plane back at the wheel (m)").toBe(carNear);
  });

  it("when the mouse drags the view round him on foot with a wall close on every side, then it stays his follow view at the wheel's boom and the eye never stands in a wall", () => {
    rig.getOut();
    rig.run(SETTLE_S);
    wallItIn();
    rig.run(SETTLE_S);
    const boom = view().orbitRadius;
    for (let step = 0; step < DRAG_STEPS; step++) {
      view().lookBy(DRAG_PX, step % 2 === 0 ? DRAG_PX / 4 : -DRAG_PX / 4);
      rig.run(FRAME);
      const eye = rig.engine["camera"].position;
      expect(onFoot().footView, `drag ${step}: still the follow`).toBe("follow");
      expect(inPenWall(eye), `drag ${step}: the eye (${eye.x.toFixed(2)}, ${eye.y.toFixed(2)}, ${eye.z.toFixed(2)}) is out of the walls`).toBe(false);
    }
    expect(view().orbitRadius, "the drag did not zoom").toBeCloseTo(boom, 6);
  });

  it("when a ride-along or the Auto camera held the view just before he took over on foot, then a press, a drag and a release of the mouse round him leave it his follow view at his boom", () => {
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
    expect(onFoot().footView, "pressed and dragged: still the follow").toBe("follow");
    pointer("pointerup", 100 + DRAG_PX, 100);
    rig.run(SETTLE_S);
    expect(onFoot().footView, "released: still the follow").toBe("follow");
    expect(view().orbitRadius, "the boom after the drag (m)").toBeCloseTo(boom, 6);
    pointer("pointerdown", 100, 100);
    pointer("pointerup", 100, 100);
    rig.run(SETTLE_S);
    expect(onFoot().footView, "a click: still the follow").toBe("follow");
  });

  it("when a press's release is lost and he presses and drags again, then the view turns by the drag and stays the follow at his boom", () => {
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
    expect(onFoot().footView, "still the follow").toBe("follow");
    pointer("pointerup", 400 + DRAG_PX, 100);
  });

  it("when a press lands with the orbit's pose read from a point a hand's width from his eye in a pen of walls, then it stays his follow view at his boom and the eye stays out of the walls", () => {
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
    expect(onFoot().footView, "a press by the wall: still the follow").toBe("follow");
    expect(inPenWall(eye), `the eye (${eye.x.toFixed(2)}, ${eye.z.toFixed(2)}) is out of the walls`).toBe(false);
    expect(view().orbitRadius, "the boom is where he had it (m)").toBeCloseTo(boom, 6);
  });

  it("when anything but the wheel, a pinch or View moves the orbit's zoom to his eyes' distance, then he stays in the follow view and the zoom is put back, and the wheel's last notch still takes him to his eyes", () => {
    rig.getOut();
    rig.run(SETTLE_S);
    const boom = view().orbitRadius;
    // Whatever left the orbit's pose to be read from the camera and its aim, a hold on the view or an eased pose: not the player's zoom.
    view().easeOrbit(FIRST_PERSON_RADIUS, view().orbitPitch, 1);
    rig.run(SETTLE_S);
    expect(onFoot().footView, "the zoom moved by another writer: still the follow").toBe("follow");
    expect(view().orbitRadius, "and the boom is where he had it (m)").toBeCloseTo(boom, 6);
    for (let n = 0; n < NOTCHES_IN; n++) wheel(-NOTCH);
    rig.run(FRAME);
    expect(onFoot().footView, "the wheel's last notch: his eyes").toBe("first");
    for (let n = 0; n < NOTCHES_OUT; n++) wheel(NOTCH);
    rig.run(FRAME);
    expect(onFoot().footView, "a few notches out: over his shoulder").toBe("shoulder");
  });

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

  it("when a wall behind him holds the camera in and the wheel turns one notch in, then the eye comes in by the notch at once, with no dead stretch of the wheel", () => {
    rig.getOut();
    rig.run(SETTLE_S);
    const him = rig.torso();
    const eye = rig.engine["camera"].position;
    const out = hypot2(eye.x - him.x, eye.z - him.z);
    const ux = (eye.x - him.x) / out;
    const uz = (eye.z - him.z) / out;
    // A wide wall across the camera's way, its near face `WALL_BEHIND_M` behind him.
    const cx = him.x + ux * (WALL_BEHIND_M + PEN_WALL_M / 2);
    const cz = him.z + uz * (WALL_BEHIND_M + PEN_WALL_M / 2);
    const half = Math.abs(ux) > Math.abs(uz) ? { x: PEN_WALL_M / 2, z: 6 } : { x: 6, z: PEN_WALL_M / 2 };
    rig.engine["ragdolls"].setFixedBoxes([{ x0: cx - half.x, z0: cz - half.z, x1: cx + half.x, z1: cz + half.z, y0: him.y - 1.2, y1: him.y - 1.2 + PEN_HEIGHT_M }]);
    rig.run(SETTLE_S);
    const held = hypot2(eye.x - him.x, eye.z - him.z);
    expect(held, `the wall holds the eye in (m back): ${held.toFixed(2)}`).toBeLessThan(WALL_BEHIND_M);
    wheel(-NOTCH);
    rig.run(SETTLE_S);
    const after = hypot2(eye.x - him.x, eye.z - him.z);
    expect(after, `one notch in from ${held.toFixed(2)} m: ${after.toFixed(2)} m`).toBeLessThan(held * NOTCH_IN_SHARE);
  });

  it("when he runs and then sprints with the view left alone, then at the sprint the camera stands 15 % farther from the point it frames than at the run", () => {
    rig.getOut();
    rig.run(SETTLE_S);
    const keys = rig.engine["keys"];
    const gap = () => {
      const point = onFoot()["cam"]["follow"].point;
      const eye = rig.engine["camera"].position;
      return hypot3(eye.x - point[0]!, eye.y - point[1]!, eye.z - point[2]!);
    };
    try {
      keys.add("KeyW");
      rig.run(2);
      expect(rig.walker().loco.speed, "control: he runs (m/s)").toBeCloseTo(RUN_SPEED, 1);
      const running = gap();
      keys.add(DRIVE_KEYS.boost[0]!);
      rig.run(2);
      expect(rig.walker().loco.speed, "control: he sprints (m/s)").toBeCloseTo(SPRINT_SPEED, 1);
      expect(gap() / running, `the camera's distance at the sprint over the run's (${running.toFixed(2)} m at the run)`).toBeCloseTo(1.15, 2);
    } finally {
      keys.clear();
    }
  });
});
