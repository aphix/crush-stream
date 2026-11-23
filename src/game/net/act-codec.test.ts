import { afterEach, describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { must } from "../kernel/must.test-util.ts";
import { setGround } from "../world/ground.ts";
import { frame, makeWorld } from "../world/race-world.test-util.ts";
import { ACT, Act, packAct, readAct } from "./act-codec.ts";
import { ActInbox } from "./act-link.ts";
import { MSG } from "./codec.ts";
import { FRAME_MS, Hub } from "./net-hub.test-util.ts";
import { NetPlay } from "./net-play.ts";
import { worldGame } from "./net-world-game.test-util.ts";

const EYE_STEP = 0.01;
/** The contract's size of an act on the wire (bytes). */
const ACT_BYTES = 17;
const DIR_STEP = 1 / 32767;

/** An act of `kind` from (1.25, 2, -3.5) along the unit (0.6, 0, 0.8). */
function actOf(kind: number, seq = 7): Act {
  const act = new Act();
  act.seq = seq;
  act.kind = kind;
  act.arg = 2;
  act.eyeX = 1.25;
  act.eyeY = 2;
  act.eyeZ = -3.5;
  act.dirX = 0.6;
  act.dirY = 0;
  act.dirZ = 0.8;
  return act;
}

/** The bytes of `actOf(kind, seq)`; the act must pack. */
function packed(kind: number, seq = 7): Uint8Array<ArrayBuffer> {
  const data = packAct(actOf(kind, seq));
  must(data, `kind ${kind} packs`);
  return data;
}

describe("given a guest's act on foot", () => {
  it("when an act of each kind is packed and read, then the host reads its kind, argument, eye to a centimetre and direction to 1/32767, in 17 bytes", () => {
    for (const kind of Object.values(ACT)) {
      const data = packed(kind);
      const read = new Act();
      expect(data.length, `kind ${kind}: bytes`).toBe(ACT_BYTES);
      expect(data[0], `kind ${kind}: type byte`).toBe(MSG.act);
      expect(readAct(data, read), `kind ${kind}: read`).toBe(true);
      expect(read.kind, `kind ${kind}: kind`).toBe(kind);
      expect(read.arg, `kind ${kind}: arg`).toBe(2);
      expect(read.seq, `kind ${kind}: seq`).toBe(7);
      expect(Math.abs(read.eyeX - 1.25), "eye x").toBeLessThanOrEqual(EYE_STEP);
      expect(Math.abs(read.eyeY - 2), "eye y").toBeLessThanOrEqual(EYE_STEP);
      expect(Math.abs(read.eyeZ + 3.5), "eye z").toBeLessThanOrEqual(EYE_STEP);
      expect(Math.abs(read.dirX - 0.6), "dir x").toBeLessThanOrEqual(DIR_STEP);
      expect(Math.abs(read.dirZ - 0.8), "dir z").toBeLessThanOrEqual(DIR_STEP);
    }
  });

  const refusedValues = [
    { it: "when its eye is not a number, then nothing is packed", field: "eyeX", value: NaN },
    { it: "when its direction is infinite, then nothing is packed", field: "dirZ", value: Infinity },
    { it: "when its eye is past what 16 bits of centimetres hold, then nothing is packed", field: "eyeY", value: 400 },
    { it: "when its kind is one this build does not know, then nothing is packed", field: "kind", value: 8 },
  ] as const;
  for (const testCase of refusedValues) {
    it(testCase.it, () => {
      const act = actOf(ACT.shot);
      act[testCase.field] = testCase.value;
      expect(packAct(act), "the packed act").toBeNull();
      expect(packAct(actOf(ACT.shot)), "companion: the same act with its values in range packs").not.toBeNull();
    });
  }

  it("when the host reads a message of another length, another type or an unknown kind, then it refuses it", () => {
    const good = packed(ACT.punch);
    const out = new Act();
    const wrongType = good.slice();
    wrongType[0] = MSG.input;
    const unknownKind = good.slice();
    unknownKind[3] = 8;
    const oneLong = new Uint8Array(ACT_BYTES + 1);
    oneLong.set(good);
    expect(readAct(good, out), "control: the good message reads").toBe(true);
    expect(readAct(good.subarray(0, ACT_BYTES - 1), out), "one byte short").toBe(false);
    expect(readAct(oneLong, out), "one byte long").toBe(false);
    expect(readAct(wrongType, out), "another type").toBe(false);
    expect(readAct(unknownKind, out), "an unknown kind").toBe(false);
  });
});

describe("given the host's inbox for one guest's acts", () => {
  it("when an act arrives twice, or an older one after a newer one, then it is carried out once; a number past the wrap is newer", () => {
    const inbox = new ActInbox();
    const heard: number[] = [];
    const take = (seq: number): boolean => inbox.take("p", 1, packed(ACT.punch, seq), (_actor, act) => void heard.push(act.seq));
    expect(take(65534), "the first").toBe(true);
    expect(take(65534), "the same again").toBe(false);
    expect(take(65535), "the next").toBe(true);
    expect(take(0), "past the wrap").toBe(true);
    expect(take(65535), "an old one replayed").toBe(false);
    expect(heard, "numbers carried out").toEqual([65534, 65535, 0]);
  });
});

const open: NetPlay[] = [];
afterEach(() => {
  for (const net of open.splice(0)) net.leave();
  setGround(null);
});

type Heard = { actor: number; kind: number; arg: number; eyeX: number };

/** A host of an open-world room and a guest seated as car 1, the acts the host's engine heard collected. */
function room() {
  const hub = new Hub();
  let now = 1000;
  const hostWorld = makeWorld();
  const guestWorld = makeWorld();
  const heard: Heard[] = [];
  const hostGame = worldGame(hostWorld, "Ann", () => null, (actor, act) => {
    heard.push({ actor, kind: act.kind, arg: act.arg, eyeX: act.eyeX });
    return 0;
  }).game;
  const host = new NetPlay(hostGame, { connect: hub.connect, now: () => now });
  const guest = new NetPlay(worldGame(guestWorld, "Zed").game, { connect: hub.connect, now: () => now });
  open.push(host, guest);
  host.hostRoom({ kind: "openworld", code: "R", tx: "bc", minPlayers: 1, course: "", playlist: [], autoNext: true });
  guest.join("R", "bc");
  const state = { acc: 0 };
  const step = (n: number): void => {
    for (let k = 0; k < n; k++) {
      now += FRAME_MS;
      frame(hostWorld, state);
      host.frame(FRAME_MS / 1000);
      guest.frame(FRAME_MS / 1000);
      hub.flush();
    }
  };
  step(60);
  return { hub, host, guest, heard, step };
}

describe("given a host and a guest seated as car 1 in a room", () => {
  it("when the guest sends a punch and then a shot, then the host's engine hears each, once, from car 1, in order", () => {
    const r = room();
    expect(r.guest.status().car, "control: the guest's car").toBe(1);
    r.guest.sendAct(ACT.punch, 0, { x: 5, y: 1, z: 6 }, { x: 0, y: 0, z: 1 });
    r.guest.sendAct(ACT.shot, 2, { x: 5.5, y: 2, z: 6 }, { x: 0, y: 0, z: 1 });
    r.step(2);
    const flat = r.heard.flatMap((act) => [act.actor, act.kind, act.arg, act.eyeX]);
    expect(r.heard.length, "acts heard").toBe(2);
    expect(firstMismatch(flat, [1, ACT.punch, 0, 5, 1, ACT.shot, 2, 5.5], 1e-9), "what the host heard: actor, kind, arg, eye x of each").toBeUndefined();
  });

  it("when the same bytes reach the host again, or arrive from a peer it never seated, then the host hears nothing more", () => {
    const r = room();
    const data = packed(ACT.punch, 0);
    const guestId = r.guest.status().selfId;
    const hostId = r.host.status().selfId;
    r.hub.sendAs(guestId, hostId, data);
    r.hub.flush();
    r.hub.sendAs(guestId, hostId, data);
    r.hub.sendAs("stranger", hostId, data);
    r.hub.flush();
    expect(r.heard.length, "acts heard: the first once, its replay and the stranger's never").toBe(1);
  });
});
