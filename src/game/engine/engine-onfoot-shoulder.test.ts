import * as THREE from "three";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hypot3 } from "../kernel/physics-core.js";
import type { FloorBox } from "../present/walker-floor.ts";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";

const LINK = "#scene=openworld&seed=beef";
const SETTLE_S = 3;
/** The blend from the car's camera to his (0.3 s) and a frame's slack, then the shoulder's and the aim's easing (0.25 s, 0.15 s) with room to finish. */
const ONFOOT_BLEND_S = 0.5;
const EASED_S = 1.5;
/** The climb into the car (`OnFootFlow`) and a frame's slack (s). */
const CLIMB_IN_S = 0.7;
/** How far (m) the eye stands to the camera's right of his middle with a gun in hand in the follow view, and how near that may be read. */
const ARMED_ACROSS_M = 0.7;
const ACROSS_SLACK_M = 0.02;
/** The eye's offset may pass either end of its range by no more than this (m): none, to a hair of rounding. */
const OVERSHOOT_M = 0.005;
/** His shoulders reach 0.29 m off his middle: the centre ray must pass at least this far (m) from it, 0.06 m clear of them. */
const CLEAR_M = 0.35;
/** The most the eye may move in one frame (m): the armed shoulder eases in at about 0.035 m a frame, the aim's draw-in at about 0.17, and a snap is the whole 0.7 m or 2.1 m. */
const SHOULDER_STEP_M = 0.06;
const AIM_STEP_M = 0.25;
/** A pen of walls round him, the face of each this far (m) from his middle, and what thickness and height it has. */
const PEN_FACE_M = 0.45;
const PEN_WALL_M = 0.5;
const PEN_HEIGHT_M = 3;

// One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
let rig: OnFootRig;
const camera = () => rig.engine["camera"];
const _right = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _toTorso = new THREE.Vector3();

/** The eye's offset (m) from his middle along the camera's right, level. */
function eyeAcross(): number {
  const eye = camera().position;
  const torso = rig.torso();
  camera().updateMatrixWorld(true);
  _right.setFromMatrixColumn(camera().matrixWorld, 0).setY(0).normalize();
  return (eye.x - torso.x) * _right.x + (eye.z - torso.z) * _right.z;
}

/** How far (m) his middle is from the line the view's centre looks along. */
function centreMiss(): number {
  camera().getWorldDirection(_forward);
  _toTorso.copy(rig.torso()).sub(camera().position);
  return _toTorso.sub(_forward.multiplyScalar(_toTorso.dot(_forward))).length();
}

/** Where his middle is across the view: its offset along the camera's right over its depth ahead (the tangent of its angle off the centre; negative is left). The headless canvas has no size to project with. */
function torsoAcrossView(): number {
  camera().updateMatrixWorld(true);
  _right.setFromMatrixColumn(camera().matrixWorld, 0);
  camera().getWorldDirection(_forward);
  _toTorso.copy(rig.torso()).sub(camera().position);
  return _toTorso.dot(_right) / _toTorso.dot(_forward);
}

/** The eye's largest move (m) in one frame over `seconds`, with `each` run before every frame. */
function widestStep(seconds: number, each: () => void = () => {}): number {
  let widest = 0;
  const last = camera().position.clone();
  for (let f = 0; f < Math.round(seconds / FRAME); f++) {
    each();
    rig.run(FRAME);
    widest = Math.max(widest, hypot3(camera().position.x - last.x, camera().position.y - last.y, camera().position.z - last.z));
    last.copy(camera().position);
  }
  return widest;
}

/** The right button going down (`true`) or up on the canvas. */
function aim(down: boolean): void {
  if (down) rig.engine["onArmsDown"](Object.assign(new Event("pointerdown"), { button: 2 }) as PointerEvent);
  else rig.engine["onArmsUp"](Object.assign(new Event("pointerup"), { button: 2 }) as PointerEvent);
}

/** He is out, settled, and has the weapon `key` in hand (a digit). */
function outWith(key: string): void {
  rig.getOut();
  rig.run(ONFOOT_BLEND_S);
  rig.press(key);
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

describe("given the real engine in the open world, its player on foot in the follow view", () => {
  it("when he takes a gun with 2 and the view settles, then the eye stands 0.7 m to the camera's right, his middle is left of the view's centre and the centre ray clears his shoulders", () => {
    outWith("Digit2");
    rig.run(EASED_S);
    expect(Math.abs(eyeAcross() - ARMED_ACROSS_M), "the eye's distance from the stated offset (m)").toBeLessThanOrEqual(ACROSS_SLACK_M);
    expect(torsoAcrossView(), "his middle across the view").toBeLessThan(-0.1);
    expect(centreMiss(), "the centre ray's distance from his middle (m)").toBeGreaterThanOrEqual(CLEAR_M);
  });

  it("when he takes the pistol and puts it away with 1, then the eye is centred behind him again", () => {
    outWith("Digit2");
    rig.run(EASED_S);
    rig.press("Digit1");
    rig.run(EASED_S);
    expect(Math.abs(eyeAcross()), "the eye's offset to the right (m)").toBeLessThanOrEqual(ACROSS_SLACK_M);
    expect(Math.abs(torsoAcrossView()), "his middle across the view").toBeLessThan(0.02);
  });

  it("when he takes the hook with 0, then the eye stands over his shoulder as with a gun", () => {
    outWith("Digit0");
    rig.run(EASED_S);
    expect(Math.abs(eyeAcross() - ARMED_ACROSS_M), "the eye's distance from the stated offset (m)").toBeLessThanOrEqual(ACROSS_SLACK_M);
  });

  it("when he takes a gun and then puts it away, then the eye never moves more than 0.06 m a frame and its offset stays between none and 0.7 m", () => {
    outWith("Digit1");
    rig.run(EASED_S);
    let lo = 0;
    let hi = 0;
    const range = () => {
      lo = Math.min(lo, eyeAcross());
      hi = Math.max(hi, eyeAcross());
    };
    rig.press("Digit2");
    const takeIn = widestStep(EASED_S, range);
    rig.press("Digit1");
    const putAway = widestStep(EASED_S, range);
    expect(takeIn, "the eye's widest step taking the gun (m)").toBeLessThanOrEqual(SHOULDER_STEP_M);
    expect(putAway, "the eye's widest step putting it away (m)").toBeLessThanOrEqual(SHOULDER_STEP_M);
    expect(lo, "the eye's farthest left (m)").toBeGreaterThanOrEqual(-OVERSHOOT_M);
    expect(hi, "the eye's farthest right (m)").toBeLessThanOrEqual(ARMED_ACROSS_M + OVERSHOOT_M);
  });

  it("when he climbs back into his car with a gun in hand, then the eye moves no more a frame than it does climbing in with fists", () => {
    const climbIn = (key: string): number => {
      outWith(key);
      rig.run(EASED_S);
      rig.walkToDoor(rig.cars()[rig.away()]!);
      rig.run(EASED_S);
      rig.press("Enter");
      const widest = widestStep(CLIMB_IN_S);
      rig.run(CLIMB_IN_S);
      expect(rig.phase(), "the climb in is over").toBe("inCar");
      return widest;
    };
    const fists = climbIn("Digit1");
    expect(climbIn("Digit2"), `the eye's widest step climbing in with a gun (m), fists: ${fists.toFixed(3)}`).toBeLessThanOrEqual(fists + SHOULDER_STEP_M);
  });

  it("when aim is held from the shoulder view and then let go, then the eye moves continuously and the shoulder's offset is the aim's start", () => {
    outWith("Digit2");
    rig.run(EASED_S);
    const rest = camera().position.clone();
    const before = eyeAcross();
    aim(true);
    const drawn = widestStep(EASED_S);
    const moved = camera().position.distanceTo(rest);
    aim(false);
    const back = widestStep(EASED_S);
    expect(moved, "the aim draws the eye in by (m)").toBeGreaterThan(1);
    expect(drawn, "the eye's widest step drawing in (m)").toBeLessThanOrEqual(AIM_STEP_M);
    expect(back, "the eye's widest step coming back (m)").toBeLessThanOrEqual(AIM_STEP_M);
    expect(Math.abs(eyeAcross() - before), "after the aim the offset is the shoulder's again (m)").toBeLessThanOrEqual(ACROSS_SLACK_M);
  });

  it("when walls stand round him and he has a gun, then the eye is inside none of them and stands short of the one on its right", () => {
    outWith("Digit2");
    const middle = rig.torso();
    const wall = (x0: number, z0: number, x1: number, z1: number): FloorBox => ({ x0, z0, x1, z1, y0: middle.y - 1.2, y1: middle.y - 1.2 + PEN_HEIGHT_M });
    const out = PEN_FACE_M + PEN_WALL_M;
    const pen = [
      wall(middle.x - out, middle.z - out, middle.x - PEN_FACE_M, middle.z + out),
      wall(middle.x + PEN_FACE_M, middle.z - out, middle.x + out, middle.z + out),
      wall(middle.x - out, middle.z - out, middle.x + out, middle.z - PEN_FACE_M),
      wall(middle.x - out, middle.z + PEN_FACE_M, middle.x + out, middle.z + out),
    ];
    rig.engine["ragdolls"].setFixedBoxes(pen);
    rig.run(EASED_S);
    const eye = camera().position;
    const inside = pen.filter((w) => eye.x > w.x0 && eye.x < w.x1 && eye.z > w.z0 && eye.z < w.z1 && eye.y > w.y0 && eye.y < w.y1);
    const across = eyeAcross();
    rig.engine["ragdolls"].setFixedBoxes([]);
    expect(inside.length, "pen walls the eye is inside").toBe(0);
    expect(across, "the eye's offset to the right, short of the wall's face (m)").toBeLessThan(PEN_FACE_M);
  });
});
