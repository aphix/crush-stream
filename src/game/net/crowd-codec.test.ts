import { describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { must } from "../kernel/must.test-util.ts";
import { MSG, NET_VERSION } from "./codec.ts";
import { CROWD_EVENT_FIELDS, packCrowd, readCrowd } from "./crowd-codec.ts";
import { CROWD_EVENT_LOG_MAX } from "./net-constants.ts";

const SEED = 0xdeadbeef;
const HOST_TIME = 123456.789012345;
const CROWD_TIME = 5400.25;
/** Kind, subject, time: a knock on civilian 17, a wreck at place 65535 (the widest subject), a knock on civilian 0. */
const EVENTS = Float64Array.of(1, 17, 5399.5, 2, 65535, 5400.0625, 1, 0, 5400.125);

/** `count` events with distinct times, so a dropped or reordered one shows. */
function eventLog(count: number): Float64Array {
  const events = new Float64Array(count * CROWD_EVENT_FIELDS);
  for (let i = 0; i < count; i++) {
    events[i * CROWD_EVENT_FIELDS] = 1 + (i % 2);
    events[i * CROWD_EVENT_FIELDS + 1] = i;
    events[i * CROWD_EVENT_FIELDS + 2] = 1000 + i * 0.5;
  }
  return events;
}

describe("given the open world's crowd message", () => {
  it("when it is the one this build speaks, then it is type 13 on wire version 43", () => {
    expect(MSG.crowd, "type byte").toBe(13);
    expect(NET_VERSION, "wire version").toBe(62);
  });

  it("when a clock and an event log are sent, then the guest reads every field back exactly", () => {
    const read = readCrowd(packCrowd(SEED, HOST_TIME, CROWD_TIME, EVENTS));
    must(read, "the message reads");
    expect(read.seed, "seed").toBe(SEED);
    expect(read.hostTime, "host clock").toBe(HOST_TIME);
    expect(read.crowdTime, "crowd clock").toBe(CROWD_TIME);
    expect(firstMismatch(read.events, EVENTS), "events").toBeUndefined();
  });

  it("when the log is empty, then the clocks still arrive with no events", () => {
    const read = readCrowd(packCrowd(1, HOST_TIME, 0, new Float64Array(0)));
    must(read, "the message reads");
    expect(read.crowdTime, "crowd clock").toBe(0);
    expect(read.events.length, "events").toBe(0);
  });

  it("when the log is longer than the cap, then only the newest events are carried, in order", () => {
    const extra = 88;
    const log = eventLog(CROWD_EVENT_LOG_MAX + extra);
    const read = readCrowd(packCrowd(SEED, HOST_TIME, CROWD_TIME, log));
    must(read, "the message reads");
    expect(read.events.length / CROWD_EVENT_FIELDS, "events carried").toBe(CROWD_EVENT_LOG_MAX);
    expect(firstMismatch(read.events, log.subarray(extra * CROWD_EVENT_FIELDS)), "the newest events").toBeUndefined();
  });

  it("when the message is read from the middle of a larger buffer, then it reads the same", () => {
    const sent = packCrowd(SEED, HOST_TIME, CROWD_TIME, EVENTS);
    const padded = new Uint8Array(sent.length + 7);
    padded.set(sent, 3);
    const read = readCrowd(padded.subarray(3, 3 + sent.length));
    must(read, "the message reads");
    expect(firstMismatch(read.events, EVENTS), "events").toBeUndefined();
  });
});

/** The wire layout the untrusted-peer rows poke at: the crowd clock's and the event count's byte offsets, the header's length, and an event's time offset. */
const CROWD_TIME_AT = 13;
const COUNT_AT = 21;
const HEADER_BYTES = 23;
const EVENT_TIME_AT = 3;

describe("given a crowd message from an untrusted peer", () => {
  const sent = packCrowd(SEED, HOST_TIME, CROWD_TIME, EVENTS);
  const wrongType = sent.slice();
  wrongType[0] = MSG.roster;
  const overCount = sent.slice();
  new DataView(overCount.buffer).setUint16(COUNT_AT, CROWD_EVENT_LOG_MAX + 1, true);
  const nanClock = sent.slice();
  new DataView(nanClock.buffer).setFloat64(CROWD_TIME_AT, Number.NaN, true);
  const infiniteEventTime = sent.slice();
  new DataView(infiniteEventTime.buffer).setFloat64(HEADER_BYTES + EVENT_TIME_AT, Number.POSITIVE_INFINITY, true);
  const cases = [
    { it: "when it is another message type, then it is dropped", data: wrongType },
    { it: "when it is cut short, then it is dropped", data: sent.subarray(0, sent.length - 1) },
    { it: "when it carries a stray trailing byte, then it is dropped", data: Uint8Array.of(...sent, 0) },
    { it: "when it is shorter than a header, then it is dropped", data: sent.subarray(0, 10) },
    { it: "when its count claims more than the cap, then it is dropped", data: overCount },
    { it: "when its crowd clock is not a number, then it is dropped", data: nanClock },
    { it: "when an event's time is infinite, then the whole message is dropped", data: infiniteEventTime },
  ] as const;
  for (const testCase of cases) {
    it(testCase.it, () => {
      expect(readCrowd(testCase.data)).toBe(null);
    });
  }
});
