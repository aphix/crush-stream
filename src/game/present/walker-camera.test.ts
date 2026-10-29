import { describe, expect, it } from "vitest";
import { Damped, FOLLOW_RADIUS, FollowFocus, followFov, PIVOT_OVER_TORSO, RECENTER_DELAY } from "./walker-camera.ts";
import { RUN_SPEED, WALK_SPEED } from "./walker-locomotion.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const FRAME = 1 / FRAME_HZ;
/** The torso's centre standing (m). */
const STANDING_TORSO = 1.13;

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
    focus.follow(FRAME, 0, STANDING_TORSO + bob * Math.sin(2 * Math.PI * hertz * t), z, speed);
    if (t > seconds / 2) {
      heights.push(focus.point[1]!);
      lag = z - focus.point[2]!;
    }
  }
  return { heightPP: Math.max(...heights) - Math.min(...heights), lag, meanHeight: heights.reduce((a, b) => a + b, 0) / heights.length };
}

describe("given the on-foot camera's focus", () => {
  it("when he runs bobbing 4 cm at 3 Hz, then the focus bobs under a quarter of that and sits at the chest, 1.35-1.55 m up", () => {
    const { heightPP, meanHeight } = follow(RUN_SPEED, 0.04, 3, 6);
    expect(heightPP, `focus height spread ${(heightPP * 100).toFixed(2)} cm of an 8 cm bob`).toBeLessThan(0.25 * 0.08);
    expect(heightPP, "the follow is not frozen").toBeGreaterThan(0);
    expect(meanHeight >= 1.35 && meanHeight <= 1.55, `pivot ${meanHeight.toFixed(2)} m (torso ${STANDING_TORSO} + ${PIVOT_OVER_TORSO})`).toBeTruthy();
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

  it("when the camera sits 3.5-4.5 m back with a 66 degree view across, then it matches the research's third-person shot", () => {
    expect(FOLLOW_RADIUS >= 3.5 && FOLLOW_RADIUS <= 4.5, `distance ${FOLLOW_RADIUS}`).toBeTruthy();
    const wide = followFov(16 / 9);
    expect(Math.abs((2 * Math.atan(Math.tan((wide * Math.PI) / 360) * (16 / 9)) * 180) / Math.PI - 66), `vertical ${wide.toFixed(1)} degrees across 16:9`).toBeLessThan(1);
    expect(followFov(0.5), "an upright phone keeps the widest vertical lens").toBe(56);
  });
});

/** The yaw after `seconds` of a view left alone (`looking` false) behind a walker facing `facing` at `speed`: every frame's yaw. */
function recenter(speed: number, looking: boolean, seconds: number, facing = 0, startYaw = 1.2): number[] {
  const focus = new FollowFocus();
  focus.seed(0, STANDING_TORSO, 0);
  const yaws: number[] = [];
  let yaw = startYaw;
  for (let f = 0; f < seconds * 60; f++) {
    yaw = focus.recenter(FRAME, yaw, facing, speed, looking);
    yaws.push(yaw);
  }
  return yaws;
}

describe("given the view left alone while he runs", () => {
  it("when the player has not looked for under 1.2 s, then the view stays where it is, and after it comes back behind him without overshoot", () => {
    const yaws = recenter(RUN_SPEED, false, 4);
    const before = yaws.slice(0, Math.floor(RECENTER_DELAY * 60) - 2);
    expect(before.every((yaw) => yaw === 1.2), "untouched inside the delay").toBeTruthy();
    const behind = Math.PI;
    expect(Math.abs(Math.abs(yaws[yaws.length - 1]!) - behind), `ends behind him: ${yaws[yaws.length - 1]!.toFixed(2)}`).toBeLessThan(0.1);
    let worst = 0;
    for (let i = 1; i < yaws.length; i++) {
      const stepped = Math.abs(yaws[i]! - yaws[i - 1]!);
      if (stepped < 1) worst = Math.max(worst, Math.abs(yaws[i]!) - behind);
    }
    expect(worst, `overshot behind by ${worst}`).toBeLessThanOrEqual(0.01);
  });

  const holdCases: readonly { it: string; speed: number; looking: boolean }[] = [
    { it: "when the player keeps looking round, then it never comes back", speed: RUN_SPEED, looking: true },
    { it: "when he is nearly standing, then it never comes back", speed: 0.3, looking: false },
  ];
  for (const testCase of holdCases) {
    it(testCase.it, () => {
      const yaws = recenter(testCase.speed, testCase.looking, 5);
      expect(yaws.every((yaw) => yaw === 1.2), "the view is where the player left it").toBeTruthy();
    });
  }
});
