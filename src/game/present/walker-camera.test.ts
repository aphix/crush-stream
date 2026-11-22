import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { acrossAt, boomAt, Damped, FOLLOW_BOOM, FollowFocus, followFov, PIVOT_OVER_TORSO, RECENTER_DELAY, REST_PITCH, type Sweep, WalkerView } from "./walker-camera.ts";
import { RUN_SPEED, WALK_SPEED } from "./walker-locomotion.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

import { detSin, hypot3 } from "../kernel/physics-core.js";
const FRAME = 1 / FRAME_HZ;
/** The torso's centre standing (m). */
const STANDING_TORSO = 1.13;
/** The top of his head over his torso's centre (m: the head box's centre 0.52 m up, 0.12 m to its crown). */
const HEAD_TOP_OVER_TORSO = 0.64;
/** 5 % of the view's width, in normalised device units. */
const CENTRE_NDC = 0.1;
const OPEN: Sweep = (_x, _y, _z, _dx, _dy, _dz, length) => length;

describe("given a critically damped value", () => {
  const smoothCases: readonly { it: string; smoothTime: number; expectedMaxGapAtOne: number; expectedMaxGapAtTwo: number }[] = [
    { it: "when it follows a step with a 0.3 s smoothing, then 60 % of the gap is closed in 0.3 s and 90 % in 0.6 s, and it never overshoots", smoothTime: 0.3, expectedMaxGapAtOne: 0.43, expectedMaxGapAtTwo: 0.101 },
    { it: "when it follows a step with a 0.12 s smoothing, then it is as quick, scaled", smoothTime: 0.12, expectedMaxGapAtOne: 0.43, expectedMaxGapAtTwo: 0.11 },
  ];
  for (const testCase of smoothCases) {
    it(testCase.it, () => {
      const value = new Damped();
      let overshoot = 0;
      let atOne = NaN;
      let atTwo = NaN;
      for (let f = 1; f <= Math.round((2 * testCase.smoothTime) / FRAME); f++) {
        value.step(1, testCase.smoothTime, FRAME);
        overshoot = Math.max(overshoot, value.x - 1);
        if (f === Math.round(testCase.smoothTime / FRAME)) atOne = 1 - value.x;
        atTwo = 1 - value.x;
      }
      expect(overshoot, `overshot by ${overshoot}`).toBeLessThanOrEqual(0);
      expect(atOne <= testCase.expectedMaxGapAtOne && atOne > 0.3, `gap after one smoothing time ${atOne.toFixed(2)}`).toBeTruthy();
      expect(atTwo, `gap after two ${atTwo.toFixed(3)}`).toBeLessThanOrEqual(testCase.expectedMaxGapAtTwo);
    });
  }

  it("when the step is taken in one big step or many small ones, then it lands in the same place", () => {
    const big = new Damped();
    const small = new Damped();
    big.step(1, 0.3, 0.5);
    for (let f = 0; f < 30; f++) small.step(1, 0.3, 0.5 / 30);
    expect(Math.abs(big.x - small.x), `${big.x} vs ${small.x}`).toBeLessThan(1e-9);
  });
});

/** The focus follows a torso that runs along +z at `speed` and bobs `bob` m at `hertz` for `seconds`: its height spread and the lag behind him. */
function follow(speed: number, bob: number, hertz: number, seconds: number): { heightPP: number; lag: number; meanHeight: number } {
  const focus = new FollowFocus();
  focus.seed(0, STANDING_TORSO, 0);
  const heights: number[] = [];
  let lag = 0;
  for (let f = 0; f < seconds * 60; f++) {
    const t = f * FRAME;
    const z = speed * t;
    focus.follow(FRAME, 0, STANDING_TORSO + bob * detSin(2 * Math.PI * hertz * t), z, speed);
    if (t > seconds / 2) {
      heights.push(focus.point[1]!);
      lag = z - focus.point[2]!;
    }
  }
  return { heightPP: Math.max(...heights) - Math.min(...heights), lag, meanHeight: heights.reduce((a, b) => a + b, 0) / heights.length };
}

describe("given the on-foot camera's focus", () => {
  it("when he runs bobbing 4 cm at 3 Hz, then the focus bobs under a quarter of that and sits at his head, 1.6-1.75 m up", () => {
    const { heightPP, meanHeight } = follow(RUN_SPEED, 0.04, 3, 6);
    expect(heightPP, `focus height spread ${(heightPP * 100).toFixed(2)} cm of an 8 cm bob`).toBeLessThan(0.25 * 0.08);
    expect(heightPP, "the follow is not frozen").toBeGreaterThan(0);
    expect(meanHeight >= 1.6 && meanHeight <= 1.75, `pivot ${meanHeight.toFixed(2)} m (torso ${STANDING_TORSO} + ${PIVOT_OVER_TORSO})`).toBeTruthy();
  });

  const lagCases: readonly { it: string; speed: number; expectedMinLag: number; expectedMaxLag: number }[] = [
    { it: "when he walks, then the focus trails him by a third of a metre or so, not more", speed: WALK_SPEED, expectedMinLag: 0.2, expectedMaxLag: 0.55 },
    { it: "when he runs, then the focus trails him by 0.3-0.5 m, tighter in time than a walk's", speed: RUN_SPEED, expectedMinLag: 0.25, expectedMaxLag: 0.55 },
  ];
  for (const testCase of lagCases) {
    it(testCase.it, () => {
      const { lag } = follow(testCase.speed, 0, 1, 6);
      expect(lag >= testCase.expectedMinLag && lag <= testCase.expectedMaxLag, `lag ${lag.toFixed(2)} m within ${testCase.expectedMinLag}-${testCase.expectedMaxLag}`).toBeTruthy();
    });
  }

  // mutation: sed -i 's/^const FOV_MIN = 48;/const FOV_MIN = 36;/' src/game/present/walker-camera.ts
  const framings: readonly { it: string; aspect: number }[] = [
    { it: "when he stands at the default zoom on a wide screen, then his head and feet are in view and he stands in the middle across", aspect: 16 / 9 },
    { it: "when he stands at the default zoom on a 4:3 screen, then his head and feet are in view and he stands in the middle across", aspect: 4 / 3 },
    { it: "when he stands at the default zoom on an upright phone, then his head and feet are in view and he stands in the middle across", aspect: 9 / 16 },
  ];
  for (const framing of framings) {
    it(framing.it, () => {
      const view = new WalkerView();
      view.shoulder(0, STANDING_TORSO, 0, 0, STANDING_TORSO + PIVOT_OVER_TORSO, 0, Math.PI, REST_PITCH, boomAt(FOLLOW_BOOM, REST_PITCH), acrossAt(FOLLOW_BOOM), OPEN, FRAME);
      const camera = new THREE.PerspectiveCamera(followFov(framing.aspect), framing.aspect, 0.1, 100);
      camera.position.set(view.eye[0]!, view.eye[1]!, view.eye[2]!);
      camera.lookAt(view.eye[0]! + view.ahead[0]!, view.eye[1]! + view.ahead[1]!, view.eye[2]! + view.ahead[2]!);
      camera.updateMatrixWorld();
      const head = new THREE.Vector3(0, STANDING_TORSO + HEAD_TOP_OVER_TORSO, 0).project(camera);
      const feet = new THREE.Vector3(0, 0, 0).project(camera);
      expect(Math.abs(head.x), `his head across the view (NDC, 0.1 is 5 % of its width): ${head.x.toFixed(3)}`).toBeLessThanOrEqual(CENTRE_NDC);
      expect(Math.abs(head.y), `his head's top up the view (NDC): ${head.y.toFixed(3)}`).toBeLessThan(1);
      expect(Math.abs(feet.y), `his feet down the view (NDC): ${feet.y.toFixed(3)}`).toBeLessThan(1);
      expect(feet.y, "his feet below his head").toBeLessThan(head.y);
      expect(head.y, "he stands in the lower part of the view, his head near the middle").toBeLessThan(0.35);
    });
  }

  it("when the boom is read at level and looking down, then it is GTA's 3.7 m at level and shorter looking down", () => {
    expect(boomAt(FOLLOW_BOOM, 0), "level boom (m)").toBeCloseTo(3.7, 6);
    expect(boomAt(FOLLOW_BOOM, 1), "boom looking down 1 rad (m)").toBeLessThan(3);
  });
});

/** The yaw after `seconds` of a view left alone (`looking` false) behind a walker facing `facing` at `speed`: every frame's yaw. */
function recenter(speed: number, looking: boolean, seconds: number, facing = 0, startYaw = 1.2, byPad = true): number[] {
  const focus = new FollowFocus();
  focus.seed(0, STANDING_TORSO, 0);
  const yaws: number[] = [];
  let yaw = startYaw;
  for (let f = 0; f < seconds * 60; f++) {
    yaw = focus.recenter(FRAME, yaw, facing, speed, looking, byPad);
    yaws.push(yaw);
  }
  return yaws;
}

describe("given the view left alone while a pad's stick runs him", () => {
  it("when the player has not looked for under a second, then the view stays where it is, and after it comes back behind him without overshoot", () => {
    const yaws = recenter(RUN_SPEED, false, 4, 0, 2.5);
    const before = yaws.slice(0, Math.floor(RECENTER_DELAY * 60) - 2);
    expect(before.every((yaw) => yaw === 2.5), "untouched inside the delay").toBeTruthy();
    const behind = Math.PI;
    expect(Math.abs(Math.abs(yaws[yaws.length - 1]!) - behind), `ends behind him: ${yaws[yaws.length - 1]!.toFixed(2)}`).toBeLessThan(0.1);
    let worst = 0;
    for (let i = 1; i < yaws.length; i++) {
      const stepped = Math.abs(yaws[i]! - yaws[i - 1]!);
      if (stepped < 1) worst = Math.max(worst, Math.abs(yaws[i]!) - behind);
    }
    expect(worst, `overshot behind by ${worst}`).toBeLessThanOrEqual(0.01);
  });

  // mutation: sed -i 's/^const RECENTER_GAP = 0.9;/const RECENTER_GAP = 9;/' src/game/present/walker-camera.ts
  it("when he walks sideways to the camera for 4 s without a look, then the camera's yaw does not move", () => {
    const yaws = recenter(RUN_SPEED, false, 4, 1.2 - Math.PI / 2);
    expect(yaws.every((yaw) => yaw === 1.2), `yaws from ${yaws[0]} to ${yaws[yaws.length - 1]}`).toBe(true);
  });

  const holdCases: readonly { it: string; speed: number; looking: boolean; byPad: boolean }[] = [
    { it: "when the player keeps looking round, then it never comes back", speed: RUN_SPEED, looking: true, byPad: true },
    { it: "when he is nearly standing, then it never comes back", speed: 0.3, looking: false, byPad: true },
    // mutation: sed -i 's/    if (!byPad || this.idle < RECENTER_DELAY/    if (this.idle < RECENTER_DELAY/' src/game/present/walker-camera.ts
    { it: "when the keys walk him and the mouse turned the view, then it never comes back by itself", speed: RUN_SPEED, looking: false, byPad: false },
  ];
  for (const testCase of holdCases) {
    it(testCase.it, () => {
      const yaws = recenter(testCase.speed, testCase.looking, 5, 0, 1.2, testCase.byPad);
      expect(yaws.every((yaw) => yaw === 1.2), "the view is where the player left it").toBeTruthy();
    });
  }
});

/** His head's centre over his torso's centre (m: the head box at 1.63 m, the torso's at 1.11 m). */
const HEAD_OVER_TORSO = 0.52;
/** An eye this near (m) his head's centre sees inside his head and shoulders. */
const HEAD_INSIDE_M = 0.3;
/** Turns tried round him in a squeeze (rad, a twelfth of a circle each). */
const TURN_STEP = Math.PI / 6;
const BLOCKED: Sweep = () => 0;

describe("given the camera behind him in a spot where every sweep is blocked at once", () => {
  // mutation: sed -i 's/^const HEAD_HIDE = 0.4;/const HEAD_HIDE = 0;/' src/game/present/walker-camera.ts
  it("when the view is turned all the way round him, then the eye pulls in to his head rather than into a wall, and his head and torso are not drawn to it", () => {
    const view = new WalkerView();
    for (let k = 0; k < 12; k++) {
      view.shoulder(0, STANDING_TORSO, 0, 0, STANDING_TORSO + PIVOT_OVER_TORSO, 0, k * TURN_STEP, REST_PITCH, FOLLOW_BOOM, 0, BLOCKED, FRAME);
      const head = hypot3(view.eye[0]!, view.eye[1]! - (STANDING_TORSO + HEAD_OVER_TORSO), view.eye[2]!);
      expect(head, `turn ${k}: the eye is ${head.toFixed(2)} m from his head`).toBeLessThan(HEAD_INSIDE_M);
      expect(view.inHead, `turn ${k}: his head is hidden from an eye inside it`).toBe(true);
    }
  });
});
