import { describe, expect, it } from "vitest";
import type { HighlightClip } from "../match/highlights.ts";
import { blankStrike } from "../scenes/figure-strike.ts";
import { NET_VERSION, Reader, Writer } from "./codec.ts";
import { carLayout } from "./car-pose.ts";
import { clipBytes, decodeSaved, encodeSaved, packReel, readClip, savedPlayable, unpackReel, writeClip } from "./reel-codec.ts";
import { EPICENTER, epicenterValues, loadEpicenter } from "../deform/epicenter.ts";
import { makeClip, sameClip } from "./reel-clip.test-util.ts";
import type { ClipVip } from "../match/highlights.ts";

describe("given a recorded highlight clip and the codec that sends and saves it", () => {
  it("when a reel of two clips is packed into a reel message and unpacked, then it comes back byte for byte with its seed and start time", async () => {
    const { clip, car } = makeClip();
    const msg = await packReel({ seed: 0xdeadbeef, clips: [clip, clip] }, 1234.5);
    const got = await unpackReel(msg, carLayout(car));
    expect(got.reel.seed).toBe(0xdeadbeef);
    expect(got.startAt).toBe(1234.5);
    expect(got.reel.clips.length).toBe(2);
    sameClip(got.reel.clips[1]!, clip);
  });

  it("when a saved clip is encoded and decoded, then it decodes to the same clip", async () => {
    const { clip, car } = makeClip();
    const got = await decodeSaved(await encodeSaved(clip), carLayout(car));
    expect(typeof got, `decoded as ${String(got)}`).not.toBe("string");
    sameClip(got as HighlightClip, clip);
  });

  it("when a saved clip is decoded after a version byte is changed or the data damaged, then another build's clip is refused as 'version' and a damaged, truncated or non-base64 one as 'corrupt'", async () => {
    const { clip, car } = makeClip();
    const L = carLayout(car);
    const bytes = Uint8Array.from(atob(await encodeSaved(clip)), (c) => c.charCodeAt(0));
    const recode = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
    const edited = (at: number, v: number): string => {
      const b = bytes.slice();
      b[at] = v;
      return recode(b);
    };
    expect(await decodeSaved(edited(4, bytes[4]! + 1), L), "another REPLAY_VERSION").toBe("version");
    expect(await decodeSaved(edited(6, NET_VERSION + 1), L), "another NET_VERSION").toBe("version");
    expect(await decodeSaved(edited(7, bytes[7]! ^ 0xff), L), "another sim fingerprint").toBe("version");
    expect(await decodeSaved(edited(0, 0), L), "not a clip").toBe("corrupt");
    expect(await decodeSaved(recode(bytes.subarray(0, bytes.length - 40)), L), "truncated").toBe("corrupt");
    expect(await decodeSaved("%%%", L), "not base64").toBe("corrupt");
  });

  it("when a saved clip's header is checked alone, then this build's passes and every other version, fingerprint or damage fails, whatever follows the 11 header bytes", async () => {
    const { clip } = makeClip();
    const text = await encodeSaved(clip);
    const bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    const recode = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
    const edited = (at: number, v: number): string => {
      const b = bytes.slice();
      b[at] = v;
      return recode(b);
    };
    expect(savedPlayable(text)).toBe(true);
    expect(savedPlayable(recode(bytes.subarray(0, 11))), "the header alone is enough").toBe(true);
    expect(savedPlayable(edited(4, bytes[4]! + 1)), "another REPLAY_VERSION").toBe(false);
    expect(savedPlayable(edited(6, NET_VERSION + 1)), "another NET_VERSION").toBe(false);
    expect(savedPlayable(edited(7, bytes[7]! ^ 0xff)), "another sim fingerprint").toBe(false);
    expect(savedPlayable(edited(0, 0)), "not a clip").toBe(false);
    expect(savedPlayable(recode(bytes.subarray(0, 6))), "truncated inside the header").toBe(false);
    expect(savedPlayable("%%%"), "not base64").toBe(false);
    expect(savedPlayable("")).toBe(false);
  });
});

const refusedStrikes = [
  { it: "when a strike names a car the clip does not carry", strikes: [{ step: 10, car: 2, x: 1 }], expectedMessage: "clip strike" },
  { it: "when a strike's step is the clip's length", strikes: [{ step: 600, car: 0, x: 1 }], expectedMessage: "clip strike" },
  { it: "when a strike comes before the one listed ahead of it", strikes: [{ step: 20, car: 0, x: 1 }, { step: 19, car: 1, x: 1 }], expectedMessage: "clip strike" },
  { it: "when a strike's position is not finite", strikes: [{ step: 10, car: 0, x: Infinity }], expectedMessage: "non-finite value" },
  { it: "when a clip lists one strike more than the cap", strikes: Array.from({ length: 17 }, (_, i) => ({ step: i, car: 0, x: 1 })), expectedMessage: "clip strikes" },
] as const;

describe("given a clip that lists the figures its cars ran down", () => {
  it("when it is written and read back, then its size is the bytes written and every strike comes back bit for bit, the VIP's guard index included", () => {
    const { clip, car } = makeClip();
    const w = new Writer(clipBytes(clip));
    writeClip(w, clip);
    expect(w.off, "bytes written").toBe(clipBytes(clip));
    const got = readClip(new Reader().reset(w.done()), carLayout(car));
    expect(got.strikes.length, "strikes decoded").toBe(2);
    expect(got.strikes[1]!.s.guard, "the VIP's guard index").toBe(-1);
    sameClip(got, clip);
  });

  for (const testCase of refusedStrikes) {
    it(`${testCase.it}, then the decoder refuses the clip`, () => {
      const { clip, car } = makeClip();
      const strikes = testCase.strikes.map((x) => ({ step: x.step, s: { ...blankStrike(), car: x.car, x: x.x } }));
      const w = new Writer(clipBytes({ ...clip, strikes }));
      writeClip(w, { ...clip, strikes });
      expect(() => readClip(new Reader().reset(w.done()), carLayout(car))).toThrow(expect.objectContaining({ name: "RangeError", message: testCase.expectedMessage }));
    });
  }
});

const SQUAD = makeClip().clip.squad!;
const refusedSquads = [
  { it: "when a decision names a car the clip does not carry", squad: { ...SQUAD, events: [{ step: 3, kind: 2, a: 0, b: 2, c: 1 }] }, expectedMessage: "clip squad event" },
  { it: "when a decision names a guard the squad does not have", squad: { ...SQUAD, events: [{ step: 3, kind: 3, a: 3, b: 0, c: 0 }] }, expectedMessage: "clip squad event" },
  { it: "when a decision is not a kind", squad: { ...SQUAD, events: [{ step: 3, kind: 4, a: 0, b: 0, c: 0 }] }, expectedMessage: "clip squad event" },
  { it: "when a decision comes after the clip's last step", squad: { ...SQUAD, events: [{ step: 600, kind: 0, a: 1, b: 0, c: 0 }] }, expectedMessage: "clip squad event" },
  { it: "when a decision comes before the one listed ahead of it", squad: { ...SQUAD, events: [{ step: 20, kind: 0, a: 1, b: 0, c: 0 }, { step: 19, kind: 0, a: 0, b: 0, c: 0 }] }, expectedMessage: "clip squad event" },
  { it: "when the squad's state holds a mode no guard has", squad: { ...SQUAD, state: Float32Array.from(SQUAD.state, (v, i) => (i === 2 ? 9 : v)) }, expectedMessage: "clip squad state" },
  { it: "when the squad's state names a target car the clip does not carry", squad: { ...SQUAD, state: Float32Array.from(SQUAD.state, (v, i) => (i === 1 ? 2 : v)) }, expectedMessage: "clip squad state" },
  { it: "when the squad lists one decision more than the cap", squad: { ...SQUAD, events: Array.from({ length: 2049 }, () => ({ step: 3, kind: 0, a: 1, b: 0, c: 0 })) }, expectedMessage: "clip squad events" },
] as const;

describe("given a clip that carries the guard squad", () => {
  it("when it is written and read back, then its size is the bytes written and the squad's state and decisions come back bit for bit", () => {
    const { clip, car } = makeClip();
    const w = new Writer(clipBytes(clip));
    writeClip(w, clip);
    expect(w.off, "bytes written").toBe(clipBytes(clip));
    const got = readClip(new Reader().reset(w.done()), carLayout(car));
    expect(got.squad!.events.length, "decisions decoded").toBe(4);
    sameClip(got, clip);
  });

  it("when the course has no squad, then the clip carries none and reads back the same", () => {
    const { clip, car } = makeClip();
    const bare = { ...clip, squad: null };
    const w = new Writer(clipBytes(bare));
    writeClip(w, bare);
    expect(w.off, "bytes written").toBe(clipBytes(bare));
    expect(readClip(new Reader().reset(w.done()), carLayout(car)).squad).toBe(null);
  });

  for (const testCase of refusedSquads) {
    it(`${testCase.it}, then the decoder refuses the clip`, () => {
      const { clip, car } = makeClip();
      const bad = { ...clip, squad: testCase.squad as HighlightClip["squad"] };
      const w = new Writer(clipBytes(bad));
      writeClip(w, bad);
      expect(() => readClip(new Reader().reset(w.done()), carLayout(car))).toThrow(expect.objectContaining({ name: "RangeError", message: testCase.expectedMessage }));
    });
  }
});

describe("given a clip recorded with the epicenter activation on", () => {
  it("when it is written and read back, then its size is the bytes written and the activation's values come back bit for bit", () => {
    const { clip, car } = makeClip();
    const on = { ...clip, epicenter: epicenterValues() };
    const w = new Writer(clipBytes(on));
    writeClip(w, on);
    expect(w.off, "bytes written").toBe(clipBytes(on));
    sameClip(readClip(new Reader().reset(w.done()), carLayout(car)), on);
  });

  it("when a value of it is not a number, then the decoder refuses the clip", () => {
    const { clip, car } = makeClip();
    const bad = { ...clip, epicenter: epicenterValues().map((v, i) => (i === 1 ? Number.NaN : v)) };
    const w = new Writer(clipBytes(bad));
    writeClip(w, bad);
    expect(() => readClip(new Reader().reset(w.done()), carLayout(car))).toThrow(expect.objectContaining({ name: "RangeError", message: "clip epicenter" }));
  });

  it("when the clip carries fewer values than the object has knobs (recorded before the last knob existed), then it reads, and loading it sets the knobs it lacks to their defaults", () => {
    const { clip, car } = makeClip();
    const shorter = { ...clip, epicenter: [1, 0.5, 0, 0, 0, 0, 0] };
    const w = new Writer(clipBytes(shorter));
    writeClip(w, shorter);
    const back = readClip(new Reader().reset(w.done()), carLayout(car));
    expect(back.epicenter?.length, "the values it carries").toBe(7);
    const saved = epicenterValues();
    try {
      loadEpicenter(back.epicenter!);
      expect(EPICENTER.on).toBe(1);
      expect(EPICENTER.relockHold).toBe(0.5);
      expect(EPICENTER.thawHold, "a knob the clip lacks is off").toBe(0);
      expect(EPICENTER.feedMin, "a knob the clip lacks is off").toBe(0);
    } finally {
      loadEpicenter(saved);
    }
  });

  it("when the clip carries more values than the object has knobs (recorded by a newer build), then the decoder refuses it rather than replay without knobs the recording ran with", () => {
    const { clip, car } = makeClip();
    const longer = { ...clip, epicenter: [...epicenterValues(), 0.5] };
    const w = new Writer(clipBytes(longer));
    writeClip(w, longer);
    expect(() => readClip(new Reader().reset(w.done()), carLayout(car))).toThrow(expect.objectContaining({ name: "RangeError", message: "clip epicenter knobs" }));
  });
});

const refusedVips: { it: string; vip: ClipVip; expectedMessage: string }[] = [
  { it: "when the VIP starts in a car the clip does not carry", vip: { start: 2, events: [] }, expectedMessage: "clip vip" },
  { it: "when a change names a car the clip does not carry", vip: { start: 255, events: [{ step: 10, car: 2 }] }, expectedMessage: "clip vip event" },
  { it: "when a change comes after the clip's last step", vip: { start: 255, events: [{ step: 600, car: 1 }] }, expectedMessage: "clip vip event" },
  { it: "when a change comes before the one listed ahead of it", vip: { start: 255, events: [{ step: 20, car: 1 }, { step: 19, car: 255 }] }, expectedMessage: "clip vip event" },
  { it: "when the clip lists one change more than the cap", vip: { start: 255, events: Array.from({ length: 9 }, () => ({ step: 3, car: 1 })) }, expectedMessage: "clip vip events" },
];

describe("given a clip that lists the car the course's VIP rides in", () => {
  it("when it is written and read back, then its size is the bytes written and the ride and its changes come back as they were", () => {
    const { clip, car } = makeClip();
    const w = new Writer(clipBytes(clip));
    writeClip(w, clip);
    expect(w.off, "bytes written").toBe(clipBytes(clip));
    const got = readClip(new Reader().reset(w.done()), carLayout(car));
    expect(got.vip.start, "out of the car at the start").toBe(255);
    expect(got.vip.events, "the VIP's changes").toHaveLength(2);
    expect(got.vip.events[0]?.step, "gets in at step").toBe(90);
    expect(got.vip.events[0]?.car, "gets in car").toBe(1);
    expect(got.vip.events[1]?.step, "thrown out at step").toBe(330);
    expect(got.vip.events[1]?.car, "thrown out of car").toBe(255);
  });

  for (const testCase of refusedVips) {
    it(`${testCase.it}, then the decoder refuses the clip`, () => {
      const { clip, car } = makeClip();
      const bad = { ...clip, vip: testCase.vip };
      const w = new Writer(clipBytes(bad));
      writeClip(w, bad);
      expect(() => readClip(new Reader().reset(w.done()), carLayout(car))).toThrow(expect.objectContaining({ name: "RangeError", message: testCase.expectedMessage }));
    });
  }
});
