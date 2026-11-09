import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ACTIVITY, ACTIVITY_OPEN_ENDED, ACTIVITY_SECONDS, type ActivityName } from "../ai/civilians/civilian-activity.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { type ActivityPose, poseActivity } from "./civilian-anim.ts";
import { FOREARM_LENGTH, type PoseSink } from "./civilian-anim-rig.ts";
import { PARTS } from "./ragdoll-body.ts";

/** Every part's centre and rotation as the rig posed it, body frame (she stands at the origin facing +z). */
type Capture = PoseSink & { centres: THREE.Vector3[]; turns: THREE.Quaternion[] };

function newCapture(): Capture {
  const centres = Array.from({ length: PARTS.length }, () => new THREE.Vector3());
  const turns = Array.from({ length: PARTS.length }, () => new THREE.Quaternion());
  return {
    centres,
    turns,
    pose(_slot, part, position, rotation) {
      centres[part]!.copy(position);
      turns[part]!.copy(rotation);
    },
  };
}

const TORSO = 0;
const HEAD = 1;
const FOREARM = [3, 5] as const;
const THIGH = [6, 8] as const;
const SHIN = [7, 9] as const;
const MINUS_X = 0;
const PLUS_X = 1;
const FRAME_SECONDS = 1 / FRAME_HZ;

const STANDING: ActivityPose = { x: 0, y: 0, z: 0, yaw: 0, stride: 0, speed: 0, activity: ACTIVITY.none, clock: 0, left: ACTIVITY_OPEN_ENDED, surface: 0, hasPartner: false, bearing: 0, variant: 0 };

/** A pose from `STANDING` with `changes`; variant 0 is right-handed (her main side is +x) and starts loops at their beginning. */
const posed = (changes: Partial<ActivityPose>): Capture => {
  const body = newCapture();
  poseActivity(body, 0, { ...STANDING, ...changes });
  return body;
};

/** Clip `name` at `clock` seconds with the time left in it a finite clip has. */
const clipAt = (name: ActivityName, clock: number, changes: Partial<ActivityPose> = {}): Capture => {
  const seconds = ACTIVITY_SECONDS[name];
  return posed({ activity: ACTIVITY[name], clock, left: seconds > 0 ? seconds - clock : ACTIVITY_OPEN_ENDED, ...changes });
};

const pointOn = (body: Capture, part: number, local: THREE.Vector3): THREE.Vector3 => local.applyQuaternion(body.turns[part]!).add(body.centres[part]!);
const handTip = (body: Capture, side: number): THREE.Vector3 => pointOn(body, FOREARM[side]!, new THREE.Vector3(0, -(FOREARM_LENGTH - PARTS[3].h[1]), 0));
const elbow = (body: Capture, side: number): THREE.Vector3 => pointOn(body, FOREARM[side]!, new THREE.Vector3(0, PARTS[3].h[1], 0));
const hip = (body: Capture, side: number): THREE.Vector3 => pointOn(body, THIGH[side]!, new THREE.Vector3(0, PARTS[6].h[1], 0));
const ankle = (body: Capture, side: number): THREE.Vector3 => pointOn(body, SHIN[side]!, new THREE.Vector3(0, -PARTS[7].h[1], 0));
/** Where part `part`'s front (+z) points. */
const facing = (body: Capture, part: number): THREE.Vector3 => new THREE.Vector3(0, 0, 1).applyQuaternion(body.turns[part]!);
const leaning = (body: Capture, part: number): THREE.Vector3 => new THREE.Vector3(0, 1, 0).applyQuaternion(body.turns[part]!);

/** The largest a part's centre and rotation (rad) differ between two poses. */
function gap(a: Capture, b: Capture): { distance: number; angle: number } {
  let distance = 0;
  let angle = 0;
  for (let part = 0; part < PARTS.length; part++) {
    distance = Math.max(distance, a.centres[part]!.distanceTo(b.centres[part]!));
    angle = Math.max(angle, a.turns[part]!.angleTo(b.turns[part]!));
  }
  return { distance, angle };
}

const TIGHT = 1e-6;
const WALKING = { stride: 1.3, speed: 1.2 } as const;

describe("given a customer at a counter", () => {
  const COUNTER_TOPS = [0.9, 1.1] as const;
  const HAND_OVER_AT = 1;
  const TAKE_AT = 2.6;
  const REACH = 0.03;

  it.each(COUNTER_TOPS)("when the clip is at its hand-over at a %f m counter, then her main hand is over the counter, a hand's breadth above it, half a metre ahead", (counter) => {
    const body = clipAt("buy", HAND_OVER_AT, { surface: counter });
    expect(handTip(body, PLUS_X).distanceTo(new THREE.Vector3(0.1, counter + 0.08, 0.5))).toBeLessThan(REACH);
    expect(handTip(body, MINUS_X).y, "her other hand hangs").toBeLessThan(counter - 0.15);
  });

  it.each(COUNTER_TOPS)("when the clip is at its take at a %f m counter, then her other hand is out over it for the goods", (counter) => {
    const body = clipAt("buy", TAKE_AT, { surface: counter });
    expect(handTip(body, MINUS_X).distanceTo(new THREE.Vector3(-0.1, counter + 0.14, 0.46))).toBeLessThan(REACH);
    expect(handTip(body, PLUS_X).y, "her main hand is back").toBeLessThan(counter - 0.1);
  });
});

describe("given a walker at a door", () => {
  const PUSH_AT = 0.9;
  const HANDLE = new THREE.Vector3(0.1, 1, 0.62);

  it("when the clip is at its push, then her main hand is on the handle's height ahead of her and she leans into it", () => {
    const body = clipAt("door", PUSH_AT, WALKING);
    expect(handTip(body, PLUS_X).distanceTo(HANDLE)).toBeLessThan(0.03);
    expect(leaning(body, TORSO).z, "her torso leans forward").toBeGreaterThan(0.12);
  });

  it("when the clip is at its push, then her legs go on striding as they would without the door", () => {
    const body = clipAt("door", PUSH_AT, WALKING);
    const walk = posed(WALKING);
    for (const part of [...THIGH, ...SHIN, 10, 11]) expect(body.centres[part]!.distanceTo(walk.centres[part]!), `part ${part}`).toBeLessThan(TIGHT);
  });
});

describe("given a civilian sitting down on seats of each height the interiors publish", () => {
  const SEAT_TOPS = [0.7, 0.46, 0.44, 0.5] as const;
  const SEATED_LEG_Z = [0.26, 0.3] as const;
  /** The hip joint sits one thigh half-thickness over a seat's top. */
  const HIP_OVER_SEAT = 0.075;
  const ANKLE_HEIGHT = 0.08;
  const FIT = 0.005;

  it.each(SEAT_TOPS)("when she has sat down on a %f m seat, then her hips rest on it and her feet are on the floor under her", (seat) => {
    const body = clipAt("sitDown", 1.2, { surface: seat });
    for (const side of [MINUS_X, PLUS_X]) {
      expect(hip(body, side).y, `hip ${side}`).toBeCloseTo(seat + HIP_OVER_SEAT, 2);
      expect(Math.abs(ankle(body, side).y - ANKLE_HEIGHT), `ankle ${side} off the floor`).toBeLessThan(FIT);
      expect(Math.abs(ankle(body, side).z - SEATED_LEG_Z[side]!), `ankle ${side} ahead of the hip`).toBeLessThan(0.01);
    }
  });

  it.each(SEAT_TOPS)("when she sits on a %f m seat a while, then her hips and feet are where they were when she sat", (seat) => {
    const sat = clipAt("sitDown", 1.2, { surface: seat });
    const sitting = clipAt("sit", 4, { surface: seat });
    for (const side of [MINUS_X, PLUS_X]) {
      expect(hip(sitting, side).distanceTo(hip(sat, side))).toBeLessThan(FIT);
      expect(ankle(sitting, side).distanceTo(ankle(sat, side))).toBeLessThan(FIT);
    }
  });

  it("when she sits down, then the pelvis sinks while the feet stay where they are", () => {
    const standing = clipAt("sitDown", 0.2, { surface: 0.46 });
    const halfway = clipAt("sitDown", 0.6, { surface: 0.46 });
    expect(hip(halfway, PLUS_X).y, "hips are lower halfway").toBeLessThan(hip(standing, PLUS_X).y - 0.08);
    expect(Math.abs(ankle(halfway, PLUS_X).y - ANKLE_HEIGHT), "halfway her feet are on the floor").toBeLessThan(FIT);
  });

  it("when she sits on a stoop's third step, then her hips are on it and her back leans over her knees", () => {
    const body = clipAt("sitSteps", 5, { surface: 0.54 });
    expect(hip(body, PLUS_X).y).toBeCloseTo(0.54 + HIP_OVER_SEAT, 2);
    expect(Math.abs(ankle(body, PLUS_X).y - ANKLE_HEIGHT)).toBeLessThan(FIT);
    expect(leaning(body, TORSO).z, "leaning forward").toBeGreaterThan(0.3);
  });

  it("when she has stood up, then she stands as she would have standing still", () => {
    const stood = clipAt("standUp", ACTIVITY_SECONDS.standUp, { surface: 0.46 });
    const standing = posed({});
    expect(gap(stood, standing).distance).toBeLessThan(TIGHT);
    expect(gap(stood, standing).angle).toBeLessThan(TIGHT);
  });

  it("when she sits down, sits and stands up, then each clip starts in the pose the one before it ended in", () => {
    const seat = { surface: 0.46 };
    const sat = clipAt("sitDown", ACTIVITY_SECONDS.sitDown, seat);
    for (const next of ["sit", "sitSteps", "standUp"] as const) {
      const starting = clipAt(next, 0, seat);
      expect(gap(sat, starting).distance, `${next} start`).toBeLessThan(TIGHT);
      expect(gap(sat, starting).angle, `${next} start`).toBeLessThan(TIGHT);
    }
  });
});

describe("given two civilians bumping", () => {
  const STAGGER_AT = 0.12;

  it("when the stagger is at its deepest with the partner on her +x side, then her chest has turned away from him and her near arm flung forward", () => {
    const body = clipAt("bump", STAGGER_AT, { hasPartner: true, bearing: 1 });
    expect(facing(body, TORSO).x, "chest turned to -x").toBeLessThan(-0.35);
    expect(handTip(body, PLUS_X).z, "near arm flung forward").toBeGreaterThan(0.35);
  });

  it("when the partner is on her -x side, then the same stagger is turned the other way", () => {
    const body = clipAt("bump", STAGGER_AT, { hasPartner: true, bearing: -1 });
    expect(facing(body, TORSO).x, "chest turned to +x").toBeGreaterThan(0.35);
    expect(handTip(body, MINUS_X).z, "near arm flung forward").toBeGreaterThan(0.35);
  });
});

describe("given a fist fight", () => {
  const PARTNER_ON_PLUS_X = { hasPartner: true, bearing: 0.5 } as const;

  it("when the swing is at its strike, then her fist is at a face's height almost an arm's length ahead", () => {
    const body = clipAt("swing", 0.3, PARTNER_ON_PLUS_X);
    expect(handTip(body, PLUS_X).distanceTo(new THREE.Vector3(0.1, 1.47, 0.95))).toBeLessThan(0.03);
  });

  it("when the swing goes from its wind-up to its strike, then the fist travels forward", () => {
    const windUp = handTip(clipAt("swing", 0.18, PARTNER_ON_PLUS_X), PLUS_X);
    const strike = handTip(clipAt("swing", 0.3, PARTNER_ON_PLUS_X), PLUS_X);
    expect(strike.z - windUp.z).toBeGreaterThan(0.4);
  });

  it("when she blocks, then both fists guard her head and her feet are planted in a crouch", () => {
    const body = clipAt("block", 1, PARTNER_ON_PLUS_X);
    for (const side of [MINUS_X, PLUS_X]) {
      expect(handTip(body, side).y, `fist ${side} at her head`).toBeGreaterThan(1.45);
      expect(Math.abs(ankle(body, side).y - 0.08), `ankle ${side}`).toBeLessThan(0.01);
    }
    expect(hip(body, PLUS_X).y, "crouched").toBeLessThan(0.8);
  });

  it("when she is hit from her +x side, then her head snaps to -x, and later her hand is at her cheek", () => {
    const snapped = clipAt("hit", 0.1, PARTNER_ON_PLUS_X);
    expect(facing(snapped, HEAD).x, "head snapped away").toBeLessThan(-0.6);
    const holding = clipAt("hit", 0.5, PARTNER_ON_PLUS_X);
    expect(handTip(holding, PLUS_X).distanceTo(new THREE.Vector3(0.1, 1.52, 0.24))).toBeLessThan(0.04);
  });

  it("when she is hit from her -x side, then her head snaps to +x", () => {
    const snapped = clipAt("hit", 0.1, { hasPartner: true, bearing: -0.5 });
    expect(facing(snapped, HEAD).x).toBeGreaterThan(0.6);
  });
});

describe("given two civilians talking and a loner standing about", () => {
  it("when she talks, then her main hand rises in a gesture her walk would not make", () => {
    const gesturing = clipAt("talk", 2);
    expect(handTip(gesturing, PLUS_X).y - elbow(gesturing, PLUS_X).y, "forearm up").toBeGreaterThan(0.15);
    const resting = clipAt("talk", 0);
    expect(handTip(resting, PLUS_X).y - elbow(resting, PLUS_X).y, "forearm down at the start").toBeLessThan(0);
  });

  it("when a left-handed civilian talks, then the gesture is on her -x side", () => {
    const gesturing = clipAt("talk", 2, { variant: 1 });
    expect(handTip(gesturing, MINUS_X).y - elbow(gesturing, MINUS_X).y).toBeGreaterThan(0.15);
  });

  it("when she looks at her partner on her +x side, then her head has turned to +x", () => {
    const body = clipAt("talk", 2, { hasPartner: true, bearing: 0.8 });
    expect(facing(body, HEAD).x).toBeGreaterThan(0.4);
  });

  it("when a loner has stood about a while, then she scratches her head with her main hand", () => {
    const body = clipAt("idle", 10.5);
    expect(handTip(body, PLUS_X).distanceTo(new THREE.Vector3(0.1, 1.66, 0.1))).toBeLessThan(0.04);
  });

  it("when two loners stand about the same moment, then their fidgets are out of step", () => {
    const first = clipAt("idle", 10.5, { variant: 0 });
    const second = clipAt("idle", 10.5, { variant: 0b1010101010 });
    expect(gap(first, second).distance).toBeGreaterThan(0.05);
  });
});

describe("given an activity that starts or ends while she walks", () => {
  const EASED_IN: readonly ActivityName[] = ["idle", "talk", "buy", "door", "sitDown", "bump", "swing", "block", "hit"];
  const ACTIVE_CLOCKS: Readonly<Record<ActivityName, number>> = { none: 0, idle: 10.5, talk: 2, buy: 1, door: 0.9, sitDown: 1, sit: 3, standUp: 0.5, bump: 0.12, swing: 0.3, block: 1, hit: 0.1, sitSteps: 5 };
  const WITH_PARTNER = { hasPartner: true, bearing: 0.6, surface: 0.9, ...WALKING } as const;

  it.each(EASED_IN)("when %s begins, then she is in her walk's pose at the first instant", (name) => {
    const clip = clipAt(name, 0, WITH_PARTNER);
    const walk = posed(WITH_PARTNER);
    expect(gap(clip, walk).distance).toBeLessThan(TIGHT);
    expect(gap(clip, walk).angle).toBeLessThan(TIGHT);
  });

  it.each(EASED_IN)("when %s runs, then no frame moves a part more than 0.3 m or turns one a quarter turn", (name) => {
    const seconds = Math.max(ACTIVITY_SECONDS[name] + 0.3, 4);
    let worstDistance = 0;
    let worstAngle = 0;
    let before = clipAt(name, 0, WITH_PARTNER);
    for (let frame = 1; frame * FRAME_SECONDS < seconds; frame++) {
      const clock = frame * FRAME_SECONDS;
      const now = clipAt(name, clock, { ...WITH_PARTNER, stride: WALKING.stride + frame * 0.12 });
      const step = gap(before, now);
      worstDistance = Math.max(worstDistance, step.distance);
      worstAngle = Math.max(worstAngle, step.angle);
      before = now;
    }
    expect(worstDistance, "a part's largest step in a frame (m)").toBeLessThan(0.3);
    expect(worstAngle, "a part's largest turn in a frame (rad)").toBeLessThan(Math.PI / 2);
  });

  it("when her talk ends, then she eases back to her walk over its last moments and is in it when it is over", () => {
    const talking = clipAt("talk", 2, { ...WITH_PARTNER, left: ACTIVITY_OPEN_ENDED });
    const ending = clipAt("talk", 2, { ...WITH_PARTNER, left: 0.2 });
    const over = clipAt("talk", 2, { ...WITH_PARTNER, left: 0 });
    const walk = posed(WITH_PARTNER);
    expect(gap(over, walk).distance, "over").toBeLessThan(TIGHT);
    expect(gap(ending, walk).distance, "easing back").toBeGreaterThan(0.01);
    expect(gap(ending, talking).distance, "still easing").toBeGreaterThan(0.01);
  });

  it.each(Object.keys(ACTIVITY).filter((name): name is ActivityName => name !== "none"))("when she is in %s, then her pose is not the walk's", (name) => {
    const clip = clipAt(name, ACTIVE_CLOCKS[name], { ...WITH_PARTNER, surface: 0.46 });
    const walk = posed({ ...WITH_PARTNER, surface: 0.46 });
    expect(gap(clip, walk).distance).toBeGreaterThan(0.03);
  });
});
