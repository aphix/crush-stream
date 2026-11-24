import { describe, expect, it } from "vitest";
import { ACTIVITY, ACTIVITY_OPEN_ENDED } from "../ai/civilians/civilian-activity.ts";
import { Reader, Writer } from "./codec.ts";
import { addBodyRecord, addHidden, BODY_FLAG, BODY_FRAME_MAX, BODY_KIND, BODY_POSTURE, CABLE_END, clearBodyFrame, copyBodyFrame, HIDDEN_MAX, makeBodyFrame, makeFootRecord, packArms, PLAYER_FLAG, POSTURE_MASK, readBodyFrame, readFoot, SHOT_COUNT_MASK, shotsOfArms, weaponOfArms, WEAPON_SLOTS, writeBodyFrame, writeFoot, type BodyFrame, type FootRecord } from "./body-codec.ts";
import { allocatedBytes, untilQuiet } from "../kernel/alloc-sample.test-util.ts";

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
const MEDIC_RECORD_AT = 59;
const CABLE_COUNT_AT = 79;
const CABLE_FIRST_END_AT = 80;
const HIDDEN_COUNT_AT = 102;
const FRAME_BYTES = 105;
/** Where a player record's arms byte is, in the sample's message. */
const PLAYER_ARMS_AT = PLAYER_RECORD_AT + 20;
/** The actor who fired the sample frame's cable. */
const CABLE_OWNER = 3;
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
  frame.arms[player] = packArms(2, 17);
  frame.armsFar.set([-190.5, 1.5, 70.25], 3 * player);
  const medic = addBodyRecord(frame, BODY_KIND.medic, MEDIC, BODY_FLAG.pose);
  place(frame, medic, 30, 0, 31.5, 0, 0, 0, 5.9);
  frame.activity[medic] = ACTIVITY.kneel;
  frame.activityClock[medic] = 3.4;
  frame.activityLeft[medic] = ACTIVITY_OPEN_ENDED;
  frame.cables = 1;
  frame.endKind[0] = CABLE_END.car;
  frame.endId[0] = CAR_ENDED_CABLE;
  frame.endPoint.set([0.5, 0.3, -1.1, -2.25, 4.5, 0.75], 0);
  frame.endKind[1] = CABLE_END.person + BODY_KIND.civilian;
  frame.endId[1] = CIVILIAN;
  frame.cableLength[0] = 12.34;
  frame.cableStrain[0] = 0.5;
  frame.cableOwner[0] = CABLE_OWNER;
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
    expect(bytes.length, "message length: 12 + 20 x 3 + 7 (the player's arms) + 1 + 22 x 1 + 1 + 2 x 1").toBe(FRAME_BYTES);
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
    for (let axis = 0; axis < 6; axis++) expect(Math.abs(copy.endPoint[axis]! - original.endPoint[axis]!), `cable end point, axis ${axis} (m)`).toBeLessThanOrEqual(CENTIMETRE);
    expect(copy.endKind[1], "end B kind: a civilian").toBe(CABLE_END.person + BODY_KIND.civilian);
    expect(copy.endId[1], "end B id").toBe(CIVILIAN);
    expect(Math.abs(copy.cableLength[0]! - 12.34), "length (m)").toBeLessThanOrEqual(CENTIMETRE);
    expect(Math.abs(copy.cableStrain[0]! - 0.5), "strain").toBeLessThanOrEqual(STRAIN_STEP);
    expect(copy.cableOwner[0], "the actor who fired it").toBe(CABLE_OWNER);
    expect(copy.hidden, "hidden").toBe(1);
    expect(copy.hiddenId[0], "the hidden civilian").toBe(HIDDEN_CIVILIAN);
  });

  it("when a standing player's record says a blow staggered him and that he holds a first hook end, then a guest takes the frame and reads both back", () => {
    const frame = makeBodyFrame();
    const state = BODY_POSTURE.stand | PLAYER_FLAG.staggered | PLAYER_FLAG.holds;
    addBodyRecord(frame, BODY_KIND.player, PLAYER_CAR, state);
    const read = makeBodyFrame();
    expect(readBodyFrame(sent(frame), new Reader(), read), "the message is taken").toBe(true);
    expect(read.state[0], "his state").toBe(state);
  });

  it("when a player's record carries his arms and a held first end, then it is 7 bytes longer than a civilian's and 13 with the held end, and each reads back: the arms byte exactly, the far end of his shot and the held end within 1 cm; a player not holding one costs 7", () => {
    const frame = makeBodyFrame();
    const holder = addBodyRecord(frame, BODY_KIND.player, PLAYER_CAR, BODY_POSTURE.stand | PLAYER_FLAG.holds);
    frame.arms[holder] = packArms(4, 9);
    frame.armsFar.set([12.34, 1.5, -56.78], 3 * holder);
    frame.holdAt.set([-3.21, 0.8, 99.99], 3 * holder);
    const bare = addBodyRecord(frame, BODY_KIND.player, PLAYER_CAR + 1, BODY_POSTURE.stand);
    frame.arms[bare] = packArms(1, 31);
    const bytes = sent(frame);
    expect(bytes.length, "12 + (20 + 7 + 6) + (20 + 7) + 1 + 1").toBe(12 + 33 + 27 + 2);
    const read = makeBodyFrame();
    expect(readBodyFrame(bytes, new Reader(), read), "the message is taken").toBe(true);
    expect([weaponOfArms(read.arms[holder]!), shotsOfArms(read.arms[holder]!)], "holder's weapon and shots").toEqual([4, 9]);
    expect([weaponOfArms(read.arms[bare]!), shotsOfArms(read.arms[bare]!)], "the other's weapon and shots").toEqual([1, 31]);
    for (let axis = 0; axis < 3; axis++) {
      expect(Math.abs(read.armsFar[3 * holder + axis]! - frame.armsFar[3 * holder + axis]!), `far end ${axis} (m)`).toBeLessThanOrEqual(CENTIMETRE);
      expect(Math.abs(read.holdAt[3 * holder + axis]! - frame.holdAt[3 * holder + axis]!), `held end ${axis} (m)`).toBeLessThanOrEqual(CENTIMETRE);
      expect(read.holdAt[3 * bare + axis], `no held end ${axis}`).toBe(0);
    }
    expect(read.id[bare], "the record after a 33-byte one is read from the right place").toBe(PLAYER_CAR + 1);
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
    { it: "a player's weapon slot of 5", data: withByte(PLAYER_ARMS_AT, WEAPON_SLOTS) },
    { it: "a player that holds a first end with no point after his arms", data: withByte(PLAYER_RECORD_AT + STATE_AT, PLAYER_FLAG.holds | BODY_FLAG.struck | BODY_POSTURE.down) },
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
const FOOT_LENGTH = 32;
const FOOT_ARMS_AT = 25;

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

  it("when his arms byte and the far end of his latest shot are written and read back, then the weapon slot and shot count read back exactly and the far end within 1 cm, and the shot counter wraps", () => {
    const foot = footSample();
    foot.arms = packArms(3, SHOT_COUNT_MASK);
    foot.farX = -44.44;
    foot.farY = 1.25;
    foot.farZ = 120.5;
    const writer = new Writer(64);
    writeFoot(writer, foot);
    const into = makeFootRecord();
    expect(readFoot(writer.done().slice(), new Reader(), into), "the message is taken").toBe(true);
    expect(weaponOfArms(into.arms), "weapon slot").toBe(3);
    expect(shotsOfArms(into.arms), "shot count").toBe(SHOT_COUNT_MASK);
    for (const axis of ["farX", "farY", "farZ"] as const) expect(Math.abs(into[axis] - foot[axis]), `${axis} (m)`).toBeLessThanOrEqual(CENTIMETRE);
    expect(shotsOfArms(packArms(3, SHOT_COUNT_MASK + 1)), "one shot past the counter's range").toBe(0);
  });

  it("when a foot message names weapon slot 5 (past the arms' list), then it is refused", () => {
    expect(readFoot(withFootByte(FOOT_ARMS_AT, WEAPON_SLOTS), new Reader(), makeFootRecord()), "a weapon slot of 5").toBe(false);
    expect(readFoot(withFootByte(FOOT_ARMS_AT, WEAPON_SLOTS - 1), new Reader(), makeFootRecord()), "the last weapon slot").toBe(true);
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

describe("given the people frame and the foot message every machine writes each net frame", () => {
  /** Messages a loop writes, the bound (bytes) for a loop, and the loops run before the read (cold code boxes every double). The clocks are zero here: handing a message's f64 clock across `Writer.f64` boxes one number, as before the arms. A read makes one `DataView` a message (`Reader.reset`), also as before: reads are not measured. */
  const MESSAGES = 600;
  const BOUND_BYTES = 8192;
  const WARM_LOOPS = 400;
  /** The sample frame's bytes, the holder's record added to it (20 + 7 + 6) and the foot message's. */
  const HOLDER_RECORD_BYTES = 33;

  it("when a frame with armed players, one holding a first end, and a foot message are written 600 times, then all of it allocates under 8 KB", () => {
    const frame = sampleFrame();
    const holder = addBodyRecord(frame, BODY_KIND.player, PLAYER_CAR + 1, BODY_POSTURE.stand | PLAYER_FLAG.holds);
    frame.arms[holder] = packArms(4, 9);
    const foot = footSample();
    frame.crowdTime = 0;
    foot.crowdTime = 0;
    const writer = new Writer(2048);
    const writeFrames = (): void => {
      for (let message = 0; message < MESSAGES; message++) {
        writer.off = 0;
        writeBodyFrame(writer, frame);
      }
    };
    const writeFeet = (): void => {
      for (let message = 0; message < MESSAGES; message++) {
        writer.off = 0;
        writeFoot(writer, foot);
      }
    };
    for (let warm = 0; warm < WARM_LOOPS; warm++) {
      writeFrames();
      writeFeet();
    }
    const frameBytes = untilQuiet(() => allocatedBytes(writeFrames), BOUND_BYTES);
    writer.off = 0;
    writeBodyFrame(writer, frame);
    expect(writer.off, "control: the frame was written").toBe(FRAME_BYTES + HOLDER_RECORD_BYTES);
    const footBytes = untilQuiet(() => allocatedBytes(writeFeet), BOUND_BYTES);
    expect(frameBytes, "bytes allocated by 600 frames").toBeLessThanOrEqual(BOUND_BYTES);
    expect(footBytes, "bytes allocated by 600 foot messages").toBeLessThanOrEqual(BOUND_BYTES);
  });
});

describe("given the people frame and the foot message every machine reads each net frame", () => {
  /** Messages of each kind a loop reads, the loops run before a read (cold code boxes every double), and the slack (bytes) over the `DataView` each read makes in `Reader.reset`. */
  const MESSAGES = 600;
  const WARM_LOOPS = 400;
  const SLACK_BYTES = 4096;

  it("when 600 people frames and 600 foot messages are read, then they allocate no more than the DataView each read makes, as measured, plus 4 KB", () => {
    const frame = sampleFrame();
    const holder = addBodyRecord(frame, BODY_KIND.player, PLAYER_CAR + 1, BODY_POSTURE.stand | PLAYER_FLAG.holds);
    frame.arms[holder] = packArms(4, 9);
    const frameBytes = sent(frame);
    const footBytes = sentFoot();
    const reader = new Reader();
    const into = makeBodyFrame();
    const intoFoot = makeFootRecord();
    const resets = (): void => {
      for (let message = 0; message < MESSAGES; message++) {
        reader.reset(frameBytes);
        reader.reset(footBytes);
      }
    };
    const reads = (): void => {
      for (let message = 0; message < MESSAGES; message++) {
        readBodyFrame(frameBytes, reader, into);
        readFoot(footBytes, reader, intoFoot);
      }
    };
    for (let warm = 0; warm < WARM_LOOPS; warm++) {
      resets();
      reads();
    }
    const bound = allocatedBytes(resets) + SLACK_BYTES;
    const read = untilQuiet(() => allocatedBytes(reads), bound);
    expect(into.arms[1], "control: the frame was read").toBe(packArms(2, 17));
    expect(read, `bytes allocated by ${2 * MESSAGES} reads (the resets alone, plus 4 KB, are ${bound})`).toBeLessThanOrEqual(bound);
  });
});
