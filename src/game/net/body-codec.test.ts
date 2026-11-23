import { describe, expect, it } from "vitest";
import { ACTIVITY, ACTIVITY_OPEN_ENDED } from "../ai/civilians/civilian-activity.ts";
import { Reader, Writer } from "./codec.ts";
import { addBodyRecord, addHidden, BODY_FLAG, BODY_FRAME_MAX, BODY_KIND, BODY_POSTURE, CABLE_END, clearBodyFrame, copyBodyFrame, HIDDEN_MAX, makeBodyFrame, makeFootRecord, POSTURE_MASK, readBodyFrame, readFoot, writeBodyFrame, writeFoot, type BodyFrame, type FootRecord } from "./body-codec.ts";

const CIVILIAN = 17;
const PLAYER_CAR = 3;
const MEDIC = 1;
const HIDDEN_CIVILIAN = 9;
/** The foot cops a frame has: ids repeat past this in the full-frame row. */
const FRAME_COPS = 4;
const CAR_ENDED_CABLE = 5;
const SEQ = 4242;
const CROWD_TIME = 5400.25;
const CENTIMETRE = 0.01;
const FACING_TOLERANCE = (1.4 * Math.PI) / 180;
const STRAIN_STEP = 1 / 255;
/** The wire layout the untrusted-peer rows poke at, for the three-record, one-cable, one-hidden frame below: the crowd time's offset and the count's, the record starts, the cable count's offset, the cable's first end and the hidden count's offset, and the whole length. */
const CROWD_TIME_AT = 3;
const RECORD_COUNT_AT = 11;
const FIRST_RECORD_AT = 12;
const PLAYER_RECORD_AT = 32;
const MEDIC_RECORD_AT = 52;
const CABLE_COUNT_AT = 72;
const CABLE_FIRST_END_AT = 73;
const HIDDEN_COUNT_AT = 94;
const FRAME_BYTES = 97;
const STATE_AT = 3;

function place(frame: BodyFrame, at: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, heading: number): void {
  frame.pos.set([x, y, z], 3 * at);
  frame.vel.set([vx, vy, vz], 3 * at);
  frame.heading[at] = heading;
}

/** A standing pinned civilian, a struck player lying, a kneeling medic's pose, a cable from a car to the civilian and one hidden civilian. */
function sampleFrame(): BodyFrame {
  const frame = makeBodyFrame();
  frame.seq = SEQ;
  frame.crowdTime = CROWD_TIME;
  const civilian = addBodyRecord(frame, BODY_KIND.civilian, CIVILIAN, BODY_POSTURE.stand | BODY_FLAG.pinned);
  place(frame, civilian, 12.34, 0.5, -56.78, 1.2, 0, -0.4, 1);
  const player = addBodyRecord(frame, BODY_KIND.player, PLAYER_CAR, BODY_POSTURE.down | BODY_FLAG.struck);
  place(frame, player, -200.5, 1.25, 88.88, 6, 2, -3, 4);
  const medic = addBodyRecord(frame, BODY_KIND.medic, MEDIC, BODY_FLAG.pose);
  place(frame, medic, 30, 0, 31.5, 0, 0, 0, 5.9);
  frame.activity[medic] = ACTIVITY.kneel;
  frame.activityClock[medic] = 3.4;
  frame.activityLeft[medic] = ACTIVITY_OPEN_ENDED;
  frame.cables = 1;
  frame.endKind[0] = CABLE_END.car;
  frame.endId[0] = CAR_ENDED_CABLE;
  frame.endPoint.set([0.5, 0.3, -1.1], 0);
  frame.endKind[1] = CABLE_END.person + BODY_KIND.civilian;
  frame.endId[1] = CIVILIAN;
  frame.cableLength[0] = 12.34;
  frame.cableStrain[0] = 0.5;
  addHidden(frame, HIDDEN_CIVILIAN);
  return frame;
}

function sent(frame: BodyFrame): Uint8Array {
  const writer = new Writer(1024);
  writeBodyFrame(writer, frame);
  return writer.done().slice();
}

/** The angle between two facings (rad), the short way round. */
function facingGap(a: number, b: number): number {
  const turn = Math.PI * 2;
  const gap = (((a - b) % turn) + turn) % turn;
  return Math.min(gap, turn - gap);
}

describe("given a frame of a standing pinned civilian, a struck player lying, a kneeling medic's pose, a cable from a car to the civilian, and one hidden civilian", () => {
  it("when it is written and read back and copied, then every person's kind, id, posture, flags and activity read back exactly, each place within 1 cm, each velocity within 1 cm/s, each facing within 1.4 degrees, the cable's ends, its length within 1 cm and its strain within 1/255, and the hidden civilian's index exactly", () => {
    const original = sampleFrame();
    const bytes = sent(original);
    expect(bytes.length, "message length: 12 + 20 x 3 + 1 + 21 x 1 + 1 + 2 x 1").toBe(FRAME_BYTES);
    const read = makeBodyFrame();
    expect(readBodyFrame(bytes, new Reader(), read), "the message is taken").toBe(true);
    const copy = makeBodyFrame();
    copyBodyFrame(read, copy);
    expect(copy.seq, "sequence").toBe(SEQ);
    expect(copy.crowdTime, "crowd time").toBe(CROWD_TIME);
    expect(copy.count, "records").toBe(3);
    for (let at = 0; at < original.count; at++) {
      expect(copy.kind[at], `record ${at}: kind`).toBe(original.kind[at]);
      expect(copy.id[at], `record ${at}: id`).toBe(original.id[at]);
      expect(copy.state[at], `record ${at}: posture and flags`).toBe(original.state[at]);
      expect(copy.state[at]! & POSTURE_MASK, `record ${at}: posture`).toBe(original.state[at]! & POSTURE_MASK);
      expect(copy.activity[at], `record ${at}: activity`).toBe(original.activity[at]);
      for (let axis = 3 * at; axis < 3 * at + 3; axis++) {
        expect(Math.abs(copy.pos[axis]! - original.pos[axis]!), `record ${at}: place ${axis} (m)`).toBeLessThanOrEqual(CENTIMETRE);
        expect(Math.abs(copy.vel[axis]! - original.vel[axis]!), `record ${at}: velocity ${axis} (m/s)`).toBeLessThanOrEqual(CENTIMETRE);
      }
      expect(facingGap(copy.heading[at]!, original.heading[at]!), `record ${at}: facing (rad)`).toBeLessThanOrEqual(FACING_TOLERANCE);
    }
    expect(copy.activityClock[2], "the medic's clock (s)").toBeCloseTo(3.4, 4);
    expect(copy.activityLeft[2], "the medic's open-ended activity").toBe(ACTIVITY_OPEN_ENDED);
    expect(copy.cables, "cables").toBe(1);
    expect(copy.endKind[0], "end A kind").toBe(CABLE_END.car);
    expect(copy.endId[0], "end A id").toBe(CAR_ENDED_CABLE);
    expect(copy.endPoint[1], "end A point y (m)").toBeCloseTo(0.3, 2);
    expect(copy.endPoint[2], "end A point z (m)").toBeCloseTo(-1.1, 2);
    expect(copy.endKind[1], "end B kind: a civilian").toBe(CABLE_END.person + BODY_KIND.civilian);
    expect(copy.endId[1], "end B id").toBe(CIVILIAN);
    expect(Math.abs(copy.cableLength[0]! - 12.34), "length (m)").toBeLessThanOrEqual(CENTIMETRE);
    expect(Math.abs(copy.cableStrain[0]! - 0.5), "strain").toBeLessThanOrEqual(STRAIN_STEP);
    expect(copy.hidden, "hidden").toBe(1);
    expect(copy.hiddenId[0], "the hidden civilian").toBe(HIDDEN_CIVILIAN);
  });

  it("when a place 400 m out is written and read, then it reads 327.67 m: held at the edge, not wrapped", () => {
    const frame = makeBodyFrame();
    const at = addBodyRecord(frame, BODY_KIND.civilian, CIVILIAN, BODY_POSTURE.stand);
    place(frame, at, 400, 0, -400, 0, 0, 0, 0);
    const read = makeBodyFrame();
    expect(readBodyFrame(sent(frame), new Reader(), read), "the message is taken").toBe(true);
    expect(read.pos[0], "x (m)").toBeCloseTo(327.67, 2);
    expect(read.pos[2], "z (m)").toBeCloseTo(-327.67, 2);
  });

  it("when a frame is full and a record, a hidden civilian or a clear is asked, then the extra record and hidden entry are refused and a cleared frame is empty", () => {
    const frame = makeBodyFrame();
    for (let at = 0; at < BODY_FRAME_MAX; at++) addBodyRecord(frame, BODY_KIND.cop, at % FRAME_COPS, BODY_POSTURE.stand);
    for (let at = 0; at < HIDDEN_MAX; at++) addHidden(frame, at);
    expect(frame.count, "records kept").toBe(BODY_FRAME_MAX);
    expect(addBodyRecord(frame, BODY_KIND.cop, 0, BODY_POSTURE.stand), "one record too many").toBe(-1);
    expect(addHidden(frame, 1), "one hidden entry too many").toBe(false);
    expect(sent(frame).length, "the fullest frame's length").toBe(12 + 20 * BODY_FRAME_MAX + 1 + 1 + 2 * HIDDEN_MAX);
    clearBodyFrame(frame);
    expect(frame.count + frame.cables + frame.hidden, "a cleared frame").toBe(0);
  });
});

/** The sample's message with byte `at` set to `value`. */
function withByte(at: number, value: number): Uint8Array {
  const data = sent(sampleFrame());
  data[at] = value;
  return data;
}

/** The sample's message with the f64 at the crowd time's place set to `value`. */
function withCrowdTime(value: number): Uint8Array {
  const data = sent(sampleFrame());
  new DataView(data.buffer).setFloat64(CROWD_TIME_AT, value, true);
  return data;
}

describe("given a bodies message a peer tampered with", () => {
  const good = sent(sampleFrame());
  const cases = [
    { it: "one byte short", data: good.subarray(0, good.length - 1) },
    { it: "one byte long", data: Uint8Array.of(...good, 0) },
    { it: "the type byte of the crowd message", data: withByte(0, 13) },
    { it: "a record count of 41", data: withByte(RECORD_COUNT_AT, BODY_FRAME_MAX + 1) },
    { it: "a cable count of 7", data: withByte(CABLE_COUNT_AT, 7) },
    { it: "a hidden count of 25", data: withByte(HIDDEN_COUNT_AT, HIDDEN_MAX + 1) },
    { it: "a civilian struck", data: withByte(FIRST_RECORD_AT + STATE_AT, BODY_FLAG.struck) },
    { it: "a player a pose record", data: withByte(PLAYER_RECORD_AT + STATE_AT, BODY_FLAG.pose) },
    { it: "a pose record roped", data: withByte(FIRST_RECORD_AT + STATE_AT, BODY_FLAG.pose | BODY_FLAG.roped) },
    { it: "a thrown record standing", data: withByte(FIRST_RECORD_AT + STATE_AT, BODY_FLAG.thrown | BODY_POSTURE.stand) },
    { it: "a posture of 3", data: withByte(MEDIC_RECORD_AT + STATE_AT, 3) },
    { it: "a kind of 4", data: withByte(FIRST_RECORD_AT, 4) },
    { it: "a cable end of kind 6", data: withByte(CABLE_FIRST_END_AT, 6) },
    { it: "a crowd time that is not a number", data: withCrowdTime(Number.NaN) },
    { it: "a crowd time that is infinite", data: withCrowdTime(Number.POSITIVE_INFINITY) },
  ] as const;
  for (const testCase of cases) {
    it(`when it has ${testCase.it}, then it is refused whole; and the untouched message is taken`, () => {
      const into = makeBodyFrame();
      expect(readBodyFrame(testCase.data, new Reader(), into), "the tampered message").toBe(false);
      expect(into.count, "nothing was read into the frame").toBe(0);
      expect(readBodyFrame(good, new Reader(), into), "the untouched message").toBe(true);
      expect(into.count, "its records").toBe(3);
    });
  }
});

/** The foot message's layout the tampered rows poke at: the state byte's and the crowd time's offsets. */
const FOOT_STATE_AT = 11;
const FOOT_CROWD_TIME_AT = 3;
const FOOT_LENGTH = 25;

function footSample(): FootRecord {
  const foot = makeFootRecord();
  foot.seq = 513;
  foot.crowdTime = 812.5;
  foot.posture = BODY_POSTURE.getUp;
  foot.left = true;
  foot.x = -12.34;
  foot.y = 1.11;
  foot.z = 56.78;
  foot.vx = 6.5;
  foot.vy = -0.25;
  foot.vz = 0.01;
  foot.heading = 2.5;
  return foot;
}

function sentFoot(): Uint8Array {
  const writer = new Writer(64);
  writeFoot(writer, footSample());
  return writer.done().slice();
}

describe("given a foot message", () => {
  it("when it is written and read back, then posture, the left bit, torso within 1 cm, velocity within 1 cm/s and facing within 1.4 degrees read back; and a message one byte short, with posture 3, with another state bit, or with a crowd time of NaN is refused", () => {
    const data = sentFoot();
    const into = makeFootRecord();
    expect(data.length, "message length").toBe(FOOT_LENGTH);
    expect(readFoot(data, new Reader(), into), "the message is taken").toBe(true);
    const sent = footSample();
    expect(into.seq, "sequence").toBe(sent.seq);
    expect(into.crowdTime, "crowd time").toBe(sent.crowdTime);
    expect(into.posture, "posture").toBe(BODY_POSTURE.getUp);
    expect(into.left, "back in a car").toBe(true);
    for (const axis of ["x", "y", "z", "vx", "vy", "vz"] as const) expect(Math.abs(into[axis] - sent[axis]), `${axis} (m or m/s)`).toBeLessThanOrEqual(CENTIMETRE);
    expect(facingGap(into.heading, sent.heading), "facing (rad)").toBeLessThanOrEqual(FACING_TOLERANCE);
    const tampered = [data.subarray(0, FOOT_LENGTH - 1), withFootByte(FOOT_STATE_AT, 3), withFootByte(FOOT_STATE_AT, BODY_POSTURE.stand | BODY_FLAG.roped), footWithNanTime()];
    for (const bad of tampered) expect(readFoot(bad, new Reader(), makeFootRecord()), "a tampered foot message").toBe(false);
  });
});

function withFootByte(at: number, value: number): Uint8Array {
  const data = sentFoot();
  data[at] = value;
  return data;
}

function footWithNanTime(): Uint8Array {
  const data = sentFoot();
  new DataView(data.buffer).setFloat64(FOOT_CROWD_TIME_AT, Number.NaN, true);
  return data;
}
