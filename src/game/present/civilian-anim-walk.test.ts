import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ACTIVITY, ACTIVITY_OPEN_ENDED } from "../ai/civilians/civilian-activity.ts";
import { STRIDE_RADIANS_PER_METRE } from "../ai/civilians/civilian-crowd-constants.ts";
import { neuroticismOf } from "../ai/civilians/civilian-temperament.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { ActivityPose } from "./civilian-anim.ts";
import { PoseSmoothing } from "./civilian-anim-smoothing.ts";
import { ankle, type Capture, clipAt, facing, gap, handTip, HEAD, hip, leaning, MINUS_X, PLUS_X, posed, TIGHT, TORSO } from "./civilian-anim.test-util.ts";

const FRAME_SECONDS = 1 / FRAME_HZ;
const WALK_SPEED = 1.4;
const walkAt = (phase: number): Capture => posed({ stride: phase, speed: WALK_SPEED });
const HALF_TURN = Math.PI;
const QUARTER_TURN = Math.PI / 2;

describe("given a civilian walking at 1.4 m/s, her stride following the metres she walks", () => {
  /** How fast (as a share of her walking speed) leg `side`'s ankle moves over the ground as her stride goes `step` rad on from `from`. */
  function slideShare(side: number, from: number, step: number): number {
    const metres = step / STRIDE_RADIANS_PER_METRE;
    const before = ankle(walkAt(from), side);
    const after = ankle(walkAt(from + step), side).add(new THREE.Vector3(0, 0, metres));
    return Math.abs(after.z - before.z) / metres;
  }

  it("when a foot is on the ground in the middle of its stance, then it does not slide: it moves over the ground at under 0.4 of her pace", () => {
    const step = 0.05;
    for (let phase = HALF_TURN - QUARTER_TURN / 2; phase < HALF_TURN + QUARTER_TURN / 2; phase += step) {
      expect(slideShare(MINUS_X, phase, step), `foot at stride ${phase.toFixed(2)}`).toBeLessThan(0.4);
    }
  });

  it("when a foot is on the ground in the middle of its stance, then it stays at the ground's height", () => {
    for (const phase of [HALF_TURN - 0.5, HALF_TURN, HALF_TURN + 0.5]) {
      expect(ankle(walkAt(phase), MINUS_X).y, `stride ${phase.toFixed(2)}`).toBeCloseTo(0.08, 1);
    }
  });

  it("when her right leg is at its furthest forward, then her left arm is forward too and her right arm and left leg are back", () => {
    const body = walkAt(QUARTER_TURN);
    expect(ankle(body, MINUS_X).z - ankle(body, PLUS_X).z, "right foot ahead of the left").toBeGreaterThan(0.5);
    expect(handTip(body, PLUS_X).z - handTip(body, MINUS_X).z, "left hand ahead of the right").toBeGreaterThan(0.3);
  });

  it("when her right leg is forward, then her shoulders turn the other way and her head keeps nearer to straight ahead", () => {
    const body = walkAt(QUARTER_TURN);
    expect(facing(body, TORSO).x, "shoulders turned against the hips").toBeLessThan(-0.08);
    expect(Math.abs(facing(body, HEAD).x), "head held nearer straight").toBeLessThan(Math.abs(facing(body, TORSO).x) - 0.02);
    expect(facing(walkAt(-QUARTER_TURN), TORSO).x, "and the other way a step later").toBeGreaterThan(0.08);
  });

  it("when her legs are spread, then her hips are lower than when they pass: the hips rise and fall twice a stride", () => {
    const passing = hip(walkAt(0), MINUS_X).y;
    expect(passing - hip(walkAt(QUARTER_TURN), MINUS_X).y, "spread").toBeCloseTo(0.05, 2);
    expect(passing - hip(walkAt(HALF_TURN), MINUS_X).y, "passing again").toBeCloseTo(0, 2);
  });

  it("when she walks a stride, then her head nods a little twice and no more", () => {
    let largest = 0;
    for (let phase = 0; phase < 2 * Math.PI; phase += 0.2) largest = Math.max(largest, Math.abs(leaning(walkAt(phase), HEAD).z));
    expect(largest).toBeGreaterThan(0.015);
    expect(largest).toBeLessThan(0.03);
  });

  it("when her stride runs round past a whole turn, then nothing of her jumps from frame to frame", () => {
    const step = (STRIDE_RADIANS_PER_METRE * WALK_SPEED) / FRAME_HZ;
    let before = walkAt(2 * Math.PI - 3 * step);
    for (let frame = -2; frame < 6; frame++) {
      const now = walkAt(2 * Math.PI + frame * step);
      expect(gap(before, now).distance, `frame ${frame}`).toBeLessThan(0.12);
      expect(gap(before, now).angle, `frame ${frame}`).toBeLessThan(0.25);
      before = now;
    }
  });
});

describe("given a civilian drawn through a pose smoothing", () => {
  const PHONE: Partial<ActivityPose> = { activity: ACTIVITY.phoneCall, clock: 3, left: ACTIVITY_OPEN_ENDED };
  const LATER_FRAMES = 45;

  /** Civilian `civilian` drawn in frame `stamp`. */
  function draw(smoothing: PoseSmoothing, stamp: number, changes: Partial<ActivityPose>, civilian = 0): Capture {
    smoothing.begin(stamp, FRAME_SECONDS);
    return posed(changes, smoothing, civilian);
  }

  it("when her call is cut off between two frames, then the next frame still has her hand at her ear, and it comes down to her side within three quarters of a second", () => {
    const smoothing = new PoseSmoothing(1);
    const calling = draw(smoothing, 1, PHONE);
    const cut = draw(smoothing, 2, {});
    expect(gap(posed({}), calling).distance, "the cut is a big change").toBeGreaterThan(0.3);
    expect(gap(cut, calling).distance, "no jump").toBeLessThan(0.08);
    let drawn = cut;
    for (let frame = 3; frame < 3 + LATER_FRAMES; frame++) drawn = draw(smoothing, frame, {});
    expect(gap(drawn, posed({})).distance, "her hand is down").toBeLessThan(0.03);
  });

  it("when she sets off from standing, then the first step is the standing pose and it grows into the stride", () => {
    const smoothing = new PoseSmoothing(1);
    const standing = draw(smoothing, 1, {});
    const first = draw(smoothing, 2, { speed: WALK_SPEED, stride: 0.4 });
    expect(gap(first, standing).distance, "no jump").toBeLessThan(0.03);
    let drawn = first;
    for (let frame = 3; frame < 3 + LATER_FRAMES; frame++) drawn = draw(smoothing, frame, { speed: WALK_SPEED, stride: frame * 0.1 });
    expect(gap(drawn, posed({ speed: WALK_SPEED, stride: (2 + LATER_FRAMES) * 0.1 })).distance, "the stride is hers").toBeLessThan(0.03);
  });

  it("when she goes on walking or doing the same thing, then her pose is the unsmoothed pose exactly: nothing is delayed or flattened", () => {
    const smoothing = new PoseSmoothing(1);
    let drawn = draw(smoothing, 1, { speed: WALK_SPEED, stride: 0 });
    for (let frame = 2; frame < 60; frame++) drawn = draw(smoothing, frame, { speed: WALK_SPEED, stride: frame * 0.1 });
    expect(gap(drawn, posed({ speed: WALK_SPEED, stride: 5.9 })).distance).toBeLessThan(TIGHT);
  });

  it("when she was not drawn last frame, then she starts where she is: no old pose is paid back", () => {
    const smoothing = new PoseSmoothing(1);
    draw(smoothing, 1, PHONE);
    const drawn = draw(smoothing, 3, {});
    expect(gap(drawn, posed({})).distance).toBeLessThan(TIGHT);
  });

  it("when one civilian's call is cut off and another's goes on, then only the first is smoothed", () => {
    const smoothing = new PoseSmoothing(2);
    draw(smoothing, 1, PHONE, 0);
    draw(smoothing, 1, PHONE, 1);
    const cut = draw(smoothing, 2, {}, 0);
    const going = draw(smoothing, 2, PHONE, 1);
    expect(gap(cut, posed({})).distance, "the first is still on her way").toBeGreaterThan(0.2);
    expect(gap(going, posed(PHONE)).distance, "the second is as she is").toBeLessThan(TIGHT);
  });
});

describe("given people whose look words give them a pace and an amplitude of their own", () => {
  /** A look word with only its pace bits (bits 12-18) or its amplitude bits (19-25) set, to the largest value there is. */
  const FASTEST = 63 << 12;
  const BIGGEST = 63 << 19;

  it("when her pace is quick, then her clip is the neutral clip a little later: the same poses, sooner", () => {
    const quick = clipAt("talk", 2, { variant: FASTEST });
    let bestClock = 0;
    let bestGap = Infinity;
    for (let clock = 2; clock < 2.5; clock += 0.0005) {
      const found = gap(quick, clipAt("talk", clock)).distance;
      if (found < bestGap) [bestClock, bestGap] = [clock, found];
    }
    expect(bestGap, "the same pose").toBeLessThan(2e-4);
    expect(bestClock, "found later in the neutral clip").toBeGreaterThan(2.05);
  });

  it("when her amplitude is big, then she gestures further from her walk than a neutral civilian does", () => {
    const neutral = clipAt("talk", 2);
    const big = clipAt("talk", 2, { variant: BIGGEST });
    const rest = posed({});
    const reach = (body: Capture): number => handTip(body, PLUS_X).distanceTo(handTip(rest, PLUS_X));
    expect(reach(big)).toBeGreaterThan(reach(neutral) * 1.02);
    expect(reach(big)).toBeLessThan(reach(neutral) * 1.3);
  });

  it("when only her gender and species bits are set, then she moves as the neutral one does: they are not her pace or her amplitude", () => {
    const WOMAN = 1 << 29;
    expect(gap(clipAt("talk", 2, { variant: WOMAN }), clipAt("talk", 2)).distance).toBeLessThan(TIGHT);
  });
});

describe("given a flinch from a crash by the calmest and the jumpiest of 256 people", () => {
  const LOOKS = Array.from({ length: 256 }, (_, person) => Math.imul(person + 1, 0x9e3779b1) >>> 0);
  const CALM = LOOKS.reduce((best, look) => (neuroticismOf(look) < neuroticismOf(best) ? look : best));
  const JUMPY = LOOKS.reduce((best, look) => (neuroticismOf(look) > neuroticismOf(best) ? look : best));
  const DANGER = { hasPartner: true, bearing: 0.6 } as const;
  const CLOCKS = Array.from({ length: 91 }, (_, step) => step * 0.01);

  const flinchAt = (look: number, clock: number): Capture => clipAt("recoil", clock, { ...DANGER, variant: look });
  const lean = (look: number, clock: number): number => -leaning(flinchAt(look, clock), TORSO).z;
  /** The clock (s) at which the flinch of `look` leans back furthest. */
  const peakClock = (look: number): number => CLOCKS.reduce((best, clock) => (lean(look, clock) > lean(look, best) ? clock : best));

  it("when they flinch, then the jumpy one leans back further and sooner than the calm one", () => {
    expect(neuroticismOf(JUMPY) - neuroticismOf(CALM), "the people differ").toBeGreaterThan(0.5);
    expect(lean(JUMPY, peakClock(JUMPY)), "further").toBeGreaterThan(lean(CALM, peakClock(CALM)) * 1.4);
    expect(peakClock(JUMPY), "sooner").toBeLessThan(peakClock(CALM));
  });

  it("when the jumpy one flinches from a danger on her +x side, then she leans back with both hands up in front and the near one highest, her head round to it", () => {
    const body = flinchAt(JUMPY, peakClock(JUMPY));
    expect(leaning(body, TORSO).z, "leaning back").toBeLessThan(-0.15);
    for (const side of [MINUS_X, PLUS_X]) {
      expect(handTip(body, side).y, `hand ${side} up`).toBeGreaterThan(1.1);
      expect(handTip(body, side).z, `hand ${side} in front`).toBeGreaterThan(0.15);
    }
    expect(handTip(body, PLUS_X).y, "the near hand higher").toBeGreaterThan(handTip(body, MINUS_X).y + 0.05);
    expect(facing(body, HEAD).x, "head toward it").toBeGreaterThan(0.2);
  });

  it("when the flinch is over its start, then the hands come down and the body settles while she still looks: it is not a frozen pose", () => {
    const peak = peakClock(JUMPY);
    const later = peak + 0.4;
    expect(handTip(flinchAt(JUMPY, later), PLUS_X).y, "hands lower").toBeLessThan(handTip(flinchAt(JUMPY, peak), PLUS_X).y - 0.2);
    expect(lean(JUMPY, later), "body upright again").toBeLessThan(lean(JUMPY, peak) * 0.6);
    expect(facing(flinchAt(JUMPY, later), HEAD).x, "still looking at it").toBeGreaterThan(0.2);
  });

  it("when the calm one flinches, then her hands rise less than the jumpy one's", () => {
    const hands = (look: number): number => handTip(flinchAt(look, peakClock(look)), PLUS_X).y;
    expect(hands(CALM)).toBeLessThan(hands(JUMPY) - 0.05);
  });
});
