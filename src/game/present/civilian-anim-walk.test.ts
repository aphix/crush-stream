import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ACTIVITY, ACTIVITY_OPEN_ENDED } from "../ai/civilians/civilian-activity.ts";
import { STRIDE_RADIANS_PER_METRE } from "../ai/civilians/civilian-crowd-constants.ts";
import { neuroticismOf } from "../ai/civilians/civilian-temperament.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { DOOR, type Frontage, stoopStepRange } from "../world/openworld/openworld-facade-solids.ts";
import { Stoops } from "../world/openworld/openworld-stoops.ts";
import { CHANNELS } from "./civilian-anim-channels.ts";
import type { ActivityPose } from "./civilian-anim.ts";
import { MAX_LAG, MAX_TURN_RATE, PoseSmoothing, TELEPORT } from "./civilian-anim-smoothing.ts";
import { ankle, type Capture, clipAt, facing, gap, handTip, HEAD, hip, leaning, MINUS_X, PLUS_X, posed, STANDING, TIGHT, TORSO } from "./civilian-anim.test-util.ts";
import { WALK_SPEED as FULL_WALK_SPEED } from "./walker-locomotion.ts";

const FRAME_SECONDS = 1 / FRAME_HZ;
/** A 240 Hz display's frame rate: at it the turn-rate cap binds on a sharp corner (at 60 Hz the low-pass alone keeps under it). */
const FAST_DISPLAY_HZ = 240;
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

/** Civilian 0 driven through `frames` frames of `dt` s: each frame the brain's pose is `brain(frame)`, `PoseSmoothing.walk` draws it, and `seen` reads what was drawn. */
function drive(dt: number, frames: number, brain: (frame: number, pose: ActivityPose) => void, seen: (pose: ActivityPose, frame: number) => void): void {
  const smoothing = new PoseSmoothing(1);
  const channels = new Float64Array(CHANNELS);
  const pose: ActivityPose = { ...STANDING };
  for (let frame = 0; frame < frames; frame++) {
    smoothing.begin(frame + 1, dt);
    brain(frame, pose);
    smoothing.walk(0, pose);
    smoothing.apply(0, ACTIVITY.none, 1, channels);
    seen(pose, frame);
  }
}

describe("given a civilian whose brain walks east, then turns a corner to walk north", () => {
  const DT = 1 / FAST_DISPLAY_HZ;
  const EAST = Math.PI / 2;
  const TURN_AT = 120;
  const brain = (frame: number, pose: ActivityPose): void => {
    const after = Math.max(0, frame - TURN_AT);
    pose.x = (Math.min(frame, TURN_AT) * 1.5) * DT;
    pose.z = after * 1.5 * DT;
    pose.yaw = frame < TURN_AT ? EAST : 0;
    pose.speed = 1.5;
  };

  // mutation: sed -i 's/const reach = MAX_TURN_RATE \* this.frameSeconds;/const reach = 1e9;/' src/game/present/civilian-anim-smoothing.ts
  it("when she is drawn, then her facing turns at most MAX_TURN_RATE a second, as fast as that at first, and ends facing north", () => {
    let last = EAST;
    let fastest = 0;
    let yaw = EAST;
    drive(DT, TURN_AT + 240, brain, (pose, frame) => {
      if (frame > 0) fastest = Math.max(fastest, Math.abs(pose.yaw - last));
      last = pose.yaw;
      yaw = pose.yaw;
    });
    expect(fastest, "the most she turned in one frame").toBeLessThanOrEqual(MAX_TURN_RATE * DT + 1e-9);
    expect(fastest, "she turns as fast as she may when the corner is sharp").toBeGreaterThan(MAX_TURN_RATE * DT * 0.99);
    expect(Math.abs(yaw), "her facing a second after").toBeLessThan(0.01);
  });
});

describe("given a civilian who stands and then is set off east at 1.5 m/s by her brain", () => {
  const DT = FRAME_SECONDS;
  const STAND_FRAMES = 60;
  const brain = (speed: number) => (frame: number, pose: ActivityPose) => {
    const walked = Math.max(0, frame - STAND_FRAMES + 1);
    pose.x = walked * speed * DT;
    pose.speed = frame < STAND_FRAMES ? 0 : speed;
  };

  // mutation: sed -i 's/this.drawnSpeed\[civilian\]! += (metres \/ this.frameSeconds - this.drawnSpeed\[civilian\]!) \* this.posShare;/this.drawnSpeed[civilian] = pose.speed;/' src/game/present/civilian-anim-smoothing.ts
  it("when she is drawn, then her drawn speed is under 1.5 for the first 0.3 s and has reached it by the end, and she is never over MAX_LAG behind", () => {
    let fastestEarly = 0;
    let lag = 0;
    let finalSpeed = 0;
    const walk = brain(1.5);
    drive(DT, STAND_FRAMES + 120, walk, (pose, frame) => {
      const since = frame - STAND_FRAMES;
      if (since >= 0 && since < 0.3 / DT) fastestEarly = Math.max(fastestEarly, pose.speed);
      const brainPose = { ...pose };
      walk(frame, brainPose);
      lag = Math.max(lag, brainPose.x - pose.x);
      finalSpeed = pose.speed;
    });
    expect(fastestEarly, "her drawn speed in the first 0.3 s").toBeLessThan(1.5);
    expect(finalSpeed, "her drawn speed two seconds on").toBeGreaterThan(1.4);
    expect(lag, "the furthest she is behind (m)").toBeLessThanOrEqual(MAX_LAG);
  });

  // mutation: sed -i 's/const behind = Math.min(left, MAX_LAG);/const behind = left;/' src/game/present/civilian-anim-smoothing.ts
  it("when her brain sprints at 4 m/s, then she is never over MAX_LAG behind, and is that far behind at full speed", () => {
    let lag = 0;
    const sprint = brain(4);
    drive(DT, STAND_FRAMES + 120, sprint, (pose, frame) => {
      const brainPose = { ...pose };
      sprint(frame, brainPose);
      lag = Math.max(lag, brainPose.x - pose.x);
    });
    expect(lag, "the furthest she is behind (m)").toBeLessThanOrEqual(MAX_LAG + 1e-9);
    expect(lag, "the furthest she is behind (m)").toBeGreaterThan(MAX_LAG - 0.01);
  });

  // mutation: sed -i 's/Math.min(STRIDE_RADIANS_PER_METRE, RUN_RADIANS_PER_SECOND \/ (speed + STILL_SPEED))/STRIDE_RADIANS_PER_METRE/' src/game/present/civilian-anim-smoothing.ts
  it("when her brain sprints, then her stride quickens no faster than a runner's strides a second, and at a walk it goes the civilians' radians a metre", () => {
    const rate = (speed: number): number => {
      const marks: number[] = [];
      const walk = brain(speed);
      drive(DT, STAND_FRAMES + 180, walk, (pose, frame) => void (frame === STAND_FRAMES + 119 || frame === STAND_FRAMES + 179 ? marks.push(pose.stride) : 0));
      return marks[1]! - marks[0]!;
    };
    expect(rate(4), "radians over the second at a sprint").toBeCloseTo(2 * Math.PI * 1.45, 0);
    expect(rate(1.5), "radians over the second at a walk").toBeCloseTo(1.5 * STRIDE_RADIANS_PER_METRE, 0);
  });
});

describe("given a civilian drawn standing whose brain puts her five metres away in one frame", () => {
  // mutation: sed -i 's/gap > TELEPORT/gap > 1e9/' src/game/present/civilian-anim-smoothing.ts
  it("when the next frame is drawn, then she is there at once, facing as the brain says", () => {
    expect(TELEPORT, "a jump this far is no walk").toBeLessThan(5);
    let drawn = -1;
    let facingYaw = -1;
    drive(
      FRAME_SECONDS,
      10,
      (frame, pose) => {
        pose.x = frame < 5 ? 0 : 5;
        pose.yaw = frame < 5 ? 0 : 1;
      },
      (pose, frame) => {
        if (frame !== 5) return;
        drawn = pose.x;
        facingYaw = pose.yaw;
      },
    );
    expect(drawn, "drawn x").toBe(5);
    expect(facingYaw, "drawn facing").toBe(1);
  });
});

describe("given the walk at different paces", () => {
  const reach = (speed: number): number => ankle(posed({ stride: QUARTER_TURN, speed }), MINUS_X).z - ankle(posed({ stride: QUARTER_TURN, speed }), PLUS_X).z;

  // mutation: sed -i 's/const legGain = Math.min(LEG_GAIT_CEILING, Math.max(LEG_GAIT_FLOOR, gait));/const legGain = 1;/' src/game/present/civilian-anim.ts
  it("when she goes at half a walk, a walk or two walks, then her legs swing less, the same, more (the full swing at FULL_WALK_SPEED, the limits 0.3 and 1.6 of it)", () => {
    expect(reach(FULL_WALK_SPEED / 2), "half a walk").toBeLessThan(reach(FULL_WALK_SPEED) * 0.75);
    expect(reach(FULL_WALK_SPEED * 2), "twice a walk").toBeGreaterThan(reach(FULL_WALK_SPEED) * 1.3);
    expect(reach(FULL_WALK_SPEED * 6), "a sprint: the limit").toBeCloseTo(reach(FULL_WALK_SPEED * 2), 6);
  });

  // mutation: sed -i 's/channels\[CHANNEL.torsoPitch\] = LEAN_PER_GAIT/channels[CHANNEL.torsoPitch] = 0 * LEAN_PER_GAIT/' src/game/present/civilian-anim.ts
  it("when she goes at a walk she stands upright, and at two walks she leans into it", () => {
    expect(Math.abs(leaning(posed({ stride: 1, speed: FULL_WALK_SPEED }), TORSO).z), "at a walk").toBeLessThan(0.01);
    expect(Math.abs(leaning(posed({ stride: 1, speed: FULL_WALK_SPEED * 2 }), TORSO).z), "at two walks").toBeGreaterThan(0.1);
  });

  // mutation: sed -i 's/pose.speed > WALKING_ABOVE) fillWalk/pose.speed > 0) fillWalk/' src/game/present/civilian-anim.ts
  it("when her speed is 0.04 m/s, then she stands: no stride shows", () => {
    expect(gap(posed({ stride: 1.3, speed: 0.04 }), posed({ stride: 1.3, speed: 0 })).distance, "the most a part moved").toBe(0);
  });

  /** Every centre and rotation, each times its place in the list, summed in order: it changes with any bit of any one. Taken from the walk before the gait was scaled by pace. */
  const fingerprint = (body: Capture): number => {
    let sum = 0;
    let at = 0;
    for (let part = 0; part < body.centres.length; part++) {
      const centre = body.centres[part]!;
      const turn = body.turns[part]!;
      for (const value of [centre.x, centre.y, centre.z, turn.x, turn.y, turn.z, turn.w]) sum += value * ++at;
    }
    return sum;
  };

  // mutation: sed -i 's/const kneeGain = KNEE_BEND_FLOOR + (1 - KNEE_BEND_FLOOR) \* gait;/const kneeGain = 0.5;/' src/game/present/civilian-anim.ts
  it("when she goes at exactly a walk's pace, then she is posed bit for bit as the walk was before the pace scaled it", () => {
    expect(fingerprint(posed({ stride: 1.3, speed: FULL_WALK_SPEED })), "stride 1.3").toBe(770.0065236694766);
    expect(fingerprint(posed({ stride: 2.9, speed: FULL_WALK_SPEED })), "stride 2.9").toBe(800.1037109422696);
  });
});

describe("given a civilian walking on the third tread of a stoop's steps, up its door's spur", () => {
  const STEP_3 = stoopStepRange(3);
  const HOUSE: Frontage = { x: 0, z: 0, yaw: 0, depth: 10, style: "federal", storeys: 3, variant: 0 };
  const stoops = new Stoops([HOUSE], [0]);
  const spotX = new Float32Array(1);
  const spotZ = new Float32Array(1);
  const spotY = new Float32Array(1);
  const treadAt = (x: number, z: number): number => {
    spotX[0] = x;
    spotZ[0] = z;
    stoops.liftFeet(spotX, spotZ, spotY, 0);
    return spotY[0]!;
  };
  const onTread = { x: (STEP_3.near + STEP_3.far) / 2, z: DOOR.across, yaw: QUARTER_TURN, speed: FULL_WALK_SPEED };

  // mutation: sed -i 's/^  if (pose.onSpur) plantOnTreads(pose);$/  void 0;/' src/game/present/civilian-anim.ts
  it("when a foot is planted (its leg straight, the walk's mid-stance), then its ankle stands at that tread's height, to the millimetre, and no further ahead", () => {
    for (const [side, stride] of [[MINUS_X, HALF_TURN], [PLUS_X, 0]] as const) {
      const flat = ankle(posed({ ...onTread, stride }), side);
      const planted = ankle(posed({ ...onTread, stride, onSpur: true, stoops }), side);
      const tread = treadAt(flat.x, flat.z);
      expect(tread, `side ${side}: the tread under the foot is a step up`).toBeGreaterThan(0.2);
      expect(Math.abs(planted.y - flat.y - tread), `side ${side}: how far the ankle is off the tread's height`).toBeLessThan(0.001);
      expect(Math.abs(planted.x - flat.x) + Math.abs(planted.z - flat.z), `side ${side}: how far the ankle moved along the ground`).toBeLessThan(0.001);
    }
  });

  // mutation: sed -i 's/if (pose.onSpur) plantOnTreads/if (true) plantOnTreads/' src/game/present/civilian-anim.ts
  it("when she walks on level ground (not the spur, or no stoops), then no foot is lifted", () => {
    const flat = ankle(posed({ ...onTread, stride: HALF_TURN }), MINUS_X);
    expect(ankle(posed({ ...onTread, stride: HALF_TURN, onSpur: true, stoops: null }), MINUS_X).y, "no stoops").toBe(flat.y);
    expect(ankle(posed({ ...onTread, stride: HALF_TURN, onSpur: false, stoops }), MINUS_X).y, "not on the spur").toBe(flat.y);
  });
});
