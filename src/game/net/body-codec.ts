import { ACTIVITY_OPEN_ENDED } from "../ai/civilians/civilian-activity.ts";
import { MAX_TETHERS } from "../kernel/constants.ts";
import { MSG, type Reader, type Writer } from "./codec.ts";

/** The four kinds of person a record names: a civilian (id her resident index), a player on foot (his car's index), a foot cop and a medic (their number). */
export const BODY_KIND = { civilian: 0, player: 1, cop: 2, medic: 3 } as const;
/** Bits 0-1 of a record's state: how the body is: on its feet, lying, or getting up. */
export const BODY_POSTURE = { stand: 0, down: 1, getUp: 2 } as const;
export const POSTURE_MASK = 3;
/** The other bits of a record's state: a cable holds her, the hook pins her, she is a thrown dummy, a car or shot has just struck her, the record is a pose record (feet, not a torso). */
export const BODY_FLAG = { roped: 4, pinned: 8, thrown: 16, struck: 32, pose: 64 } as const;
/** A player's record alone carries these: a blow staggered him (the blow's bearing rides the record's activity clock, which nothing else reads on a player; the bit is a civilian's `pinned`, which nothing reads on a guest), and he holds a first hook end (the one bit no other kind uses: `thrown` is read on every kind). */
export const PLAYER_FLAG = { staggered: 8, holds: 128 } as const;
/** A cable nobody fired. */
export const CABLE_NO_OWNER = 255;
/** The state bits each kind may carry, by kind: a civilian posture, roped, pinned, thrown, pose; a player posture, roped, staggered, struck, holds; a cop and a medic posture, thrown, pose. */
const STATE_MASK = [95, 175, 83, 83] as const;
/** What a cable end is: a car's point in its frame, a point of the world, or a person (this plus her kind). */
export const CABLE_END = { car: 0, world: 1, person: 2 } as const;
/** The most records a frame carries: 8 players + 4 foot cops + 2 medics + 8 people in the law's hands + 13 pool slots that are not this machine's walker (4 + 6 + 4 less 1) is 35, the most that exist at once; 40 is the next multiple of 8. */
export const BODY_FRAME_MAX = 40;
/** The most hidden civilians a frame carries: 16 held by the hook + 8 in the law's hands, the most that exist at once. */
export const HIDDEN_MAX = 24;

/** Bytes: the header (type, seq, crowd time, record count), a record, a cable end, a cable (two ends, length, strain, owner) and a hidden entry. */
const HEADER_BYTES = 12;
const RECORD_BYTES = 20;
const END_BYTES = 9;
const CABLE_BYTES = 2 * END_BYTES + 4;
const HIDDEN_BYTES = 2;
/** Byte offsets in the header and in a record. */
const CROWD_TIME_AT = 3;
const COUNT_AT = 11;
const RECORD_STATE_AT = 3;
/** The smallest frame: the header and the cable and hidden counts. */
const EMPTY_FRAME_BYTES = HEADER_BYTES + 2;
/** A cable end's kind is at most a person's: `CABLE_END.person` plus the last kind. */
const CABLE_END_MAX = CABLE_END.person + BODY_KIND.medic;

/** Places, velocities and end points go in centimetres (an i16: ±327.67 m, held at the edge, never wrapped). */
const CENTIMETRES = 100;
const METRES_PER_STEP = 1 / CENTIMETRES;
/** A facing goes in 256 steps of a turn. */
const HEADING_STEPS = 256;
const TWO_PI = Math.PI * 2;
const RADIANS_PER_HEADING_STEP = TWO_PI / HEADING_STEPS;
/** An activity's clock and time left go in tenths of a second, 254 the most; 255 in the left byte is `ACTIVITY_OPEN_ENDED`. */
const TENTHS = 10;
const TIME_BYTE_MAX = 254;
const OPEN_ENDED_BYTE = 255;
/** A cable's strain goes in 255 steps of its strength. */
const STRAIN_STEPS = 255;
const WORD_MAX = 65535;

/** Where a body stands (m), moves (m/s), faces (rad) and how it is: a record's place as the follow rules read it. */
export type BodyMotion = { x: number; y: number; z: number; vx: number; vy: number; vz: number; heading: number; posture: number };

/** The host's frame of people (`MSG.bodies`): records, cables and the civilians drawn by nobody, in typed arrays made once. */
export type BodyFrame = {
  seq: number;
  crowdTime: number;
  count: number;
  readonly kind: Uint8Array;
  readonly id: Uint16Array;
  readonly state: Uint8Array;
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  readonly heading: Float32Array;
  readonly activity: Uint8Array;
  readonly activityClock: Float32Array;
  readonly activityLeft: Float32Array;
  cables: number;
  readonly endKind: Uint8Array;
  readonly endId: Uint16Array;
  readonly endPoint: Float32Array;
  readonly cableLength: Float32Array;
  readonly cableStrain: Float32Array;
  /** Per cable, the actor (car index) who fired it, `CABLE_NO_OWNER` for none. */
  readonly cableOwner: Uint8Array;
  hidden: number;
  readonly hiddenId: Uint16Array;
};

/** The three numbers of a place or a velocity as they are read off the wire. */
const _triple = new Float32Array(3);

export function makeBodyFrame(): BodyFrame {
  return {
    seq: -1,
    crowdTime: 0,
    count: 0,
    kind: new Uint8Array(BODY_FRAME_MAX),
    id: new Uint16Array(BODY_FRAME_MAX),
    state: new Uint8Array(BODY_FRAME_MAX),
    pos: new Float32Array(3 * BODY_FRAME_MAX),
    vel: new Float32Array(3 * BODY_FRAME_MAX),
    heading: new Float32Array(BODY_FRAME_MAX),
    activity: new Uint8Array(BODY_FRAME_MAX),
    activityClock: new Float32Array(BODY_FRAME_MAX),
    activityLeft: new Float32Array(BODY_FRAME_MAX),
    cables: 0,
    endKind: new Uint8Array(2 * MAX_TETHERS),
    endId: new Uint16Array(2 * MAX_TETHERS),
    endPoint: new Float32Array(6 * MAX_TETHERS),
    cableLength: new Float32Array(MAX_TETHERS),
    cableStrain: new Float32Array(MAX_TETHERS),
    cableOwner: new Uint8Array(MAX_TETHERS),
    hidden: 0,
    hiddenId: new Uint16Array(HIDDEN_MAX),
  };
}

/** The frame holds nothing again. */
export function clearBodyFrame(out: BodyFrame): void {
  out.count = 0;
  out.cables = 0;
  out.hidden = 0;
}

/** A record of `kind` and `id` in `state`, its place, velocity, facing and activity zero; the index it took, -1 when the frame is full. */
export function addBodyRecord(out: BodyFrame, kind: number, id: number, state: number): number {
  const at = out.count;
  if (at === BODY_FRAME_MAX) return -1;
  out.count = at + 1;
  out.kind[at] = kind;
  out.id[at] = id;
  out.state[at] = state;
  for (let axis = 0; axis < 3; axis++) {
    out.pos[3 * at + axis] = 0;
    out.vel[3 * at + axis] = 0;
  }
  out.heading[at] = 0;
  out.activity[at] = 0;
  out.activityClock[at] = 0;
  out.activityLeft[at] = 0;
  return at;
}

/** Civilian `civilian` is drawn by nobody on the host; false when the list is full. */
export function addHidden(out: BodyFrame, civilian: number): boolean {
  if (out.hidden === HIDDEN_MAX) return false;
  out.hiddenId[out.hidden++] = civilian;
  return true;
}

/** `f` as a `MSG.bodies` message: 12 + 20 x records + 1 + 22 x cables + 1 + 2 x hidden bytes. */
export function writeBodyFrame(w: Writer, f: BodyFrame): void {
  w.u8(MSG.bodies);
  w.u16(f.seq);
  w.f64(f.crowdTime);
  w.u8(f.count);
  for (let at = 0; at < f.count; at++) {
    w.u8(f.kind[at]!);
    w.u16(f.id[at]!);
    w.u8(f.state[at]!);
    w.q16s(f.pos, 3, CENTIMETRES, 3 * at);
    w.q16s(f.vel, 3, CENTIMETRES, 3 * at);
    w.u8(Math.round((((f.heading[at]! % TWO_PI) + TWO_PI) % TWO_PI) / RADIANS_PER_HEADING_STEP) & (HEADING_STEPS - 1));
    w.u8(f.activity[at]!);
    w.u8(Math.max(0, Math.min(TIME_BYTE_MAX, Math.round(f.activityClock[at]! * TENTHS))));
    w.u8(f.activityLeft[at]! >= ACTIVITY_OPEN_ENDED ? OPEN_ENDED_BYTE : Math.max(0, Math.min(TIME_BYTE_MAX, Math.round(f.activityLeft[at]! * TENTHS))));
  }
  w.u8(f.cables);
  for (let cable = 0; cable < f.cables; cable++) {
    for (let end = 2 * cable; end < 2 * cable + 2; end++) {
      w.u8(f.endKind[end]!);
      w.u16(f.endId[end]!);
      w.q16s(f.endPoint, 3, CENTIMETRES, 3 * end);
    }
    w.u16(Math.max(0, Math.min(WORD_MAX, Math.round(f.cableLength[cable]! * CENTIMETRES))));
    w.u8(Math.round(STRAIN_STEPS * Math.min(1, Math.max(0, f.cableStrain[cable]!))));
    w.u8(f.cableOwner[cable]!);
  }
  w.u8(f.hidden);
  for (let at = 0; at < f.hidden; at++) w.u16(f.hiddenId[at]!);
}

/** Whether record `at`'s kind, state bits and posture are ones a host writes (the posture is a posture, the bits are the kind's, a pose record is none of thrown, roped, pinned or struck, a thrown one lies). */
function recordIsSound(data: Uint8Array, base: number): boolean {
  const kind = data[base]!;
  if (kind > BODY_KIND.medic) return false;
  const state = data[base + RECORD_STATE_AT]!;
  const posture = state & POSTURE_MASK;
  if (posture > BODY_POSTURE.getUp || (state & ~STATE_MASK[kind]!) !== 0) return false;
  if ((state & BODY_FLAG.pose) !== 0 && (state & (BODY_FLAG.thrown | BODY_FLAG.roped | BODY_FLAG.pinned | BODY_FLAG.struck)) !== 0) return false;
  return (state & BODY_FLAG.thrown) === 0 || posture === BODY_POSTURE.down;
}

/** Reads a `MSG.bodies` message into `out`: false, with `out` untouched, when it is not one this build reads (untrusted: a peer's), so a bad length, count, kind, state or clock is dropped whole. */
export function readBodyFrame(data: Uint8Array, r: Reader, out: BodyFrame): boolean {
  if (data.length < EMPTY_FRAME_BYTES || data[0] !== MSG.bodies) return false;
  const count = data[COUNT_AT]!;
  if (count > BODY_FRAME_MAX) return false;
  const cablesAt = HEADER_BYTES + count * RECORD_BYTES;
  if (data.length < cablesAt + 2) return false;
  const cables = data[cablesAt]!;
  if (cables > MAX_TETHERS) return false;
  const hiddenAt = cablesAt + 1 + cables * CABLE_BYTES;
  if (data.length < hiddenAt + 1) return false;
  const hidden = data[hiddenAt]!;
  if (hidden > HIDDEN_MAX || data.length !== hiddenAt + 1 + hidden * HIDDEN_BYTES) return false;
  r.reset(data);
  r.off = CROWD_TIME_AT;
  const crowdTime = r.f64();
  if (!Number.isFinite(crowdTime)) return false;
  for (let at = 0; at < count; at++) if (!recordIsSound(data, HEADER_BYTES + at * RECORD_BYTES)) return false;
  for (let cable = 0; cable < cables; cable++) {
    const base = cablesAt + 1 + cable * CABLE_BYTES;
    if (data[base]! > CABLE_END_MAX || data[base + END_BYTES]! > CABLE_END_MAX) return false;
  }
  clearBodyFrame(out);
  r.off = 1;
  out.seq = r.u16();
  out.crowdTime = crowdTime;
  r.off = HEADER_BYTES;
  for (let record = 0; record < count; record++) {
    const kind = r.u8();
    const id = r.u16();
    const at = addBodyRecord(out, kind, id, r.u8());
    r.q16s(_triple, 3, METRES_PER_STEP);
    for (let axis = 0; axis < 3; axis++) out.pos[3 * at + axis] = _triple[axis]!;
    r.q16s(_triple, 3, METRES_PER_STEP);
    for (let axis = 0; axis < 3; axis++) out.vel[3 * at + axis] = _triple[axis]!;
    out.heading[at] = r.u8() * RADIANS_PER_HEADING_STEP;
    out.activity[at] = r.u8();
    out.activityClock[at] = r.u8() / TENTHS;
    const left = r.u8();
    out.activityLeft[at] = left === OPEN_ENDED_BYTE ? ACTIVITY_OPEN_ENDED : left / TENTHS;
  }
  r.off = cablesAt + 1;
  out.cables = cables;
  for (let cable = 0; cable < cables; cable++) {
    for (let end = 2 * cable; end < 2 * cable + 2; end++) {
      out.endKind[end] = r.u8();
      out.endId[end] = r.u16();
      r.q16s(_triple, 3, METRES_PER_STEP);
      for (let axis = 0; axis < 3; axis++) out.endPoint[3 * end + axis] = _triple[axis]!;
    }
    out.cableLength[cable] = r.u16() / CENTIMETRES;
    out.cableStrain[cable] = r.u8() / STRAIN_STEPS;
    out.cableOwner[cable] = r.u8();
  }
  r.off = hiddenAt + 1;
  for (let entry = 0; entry < hidden; entry++) addHidden(out, r.u16());
  return true;
}

/** `to` holds what `from` holds: the clock, the counts and every record, cable and hidden entry in use. */
export function copyBodyFrame(from: BodyFrame, to: BodyFrame): void {
  to.seq = from.seq;
  to.crowdTime = from.crowdTime;
  to.count = from.count;
  to.cables = from.cables;
  to.hidden = from.hidden;
  for (let at = 0; at < from.count; at++) {
    to.kind[at] = from.kind[at]!;
    to.id[at] = from.id[at]!;
    to.state[at] = from.state[at]!;
    for (let axis = 3 * at; axis < 3 * at + 3; axis++) {
      to.pos[axis] = from.pos[axis]!;
      to.vel[axis] = from.vel[axis]!;
    }
    to.heading[at] = from.heading[at]!;
    to.activity[at] = from.activity[at]!;
    to.activityClock[at] = from.activityClock[at]!;
    to.activityLeft[at] = from.activityLeft[at]!;
  }
  for (let end = 0; end < 2 * from.cables; end++) {
    to.endKind[end] = from.endKind[end]!;
    to.endId[end] = from.endId[end]!;
    for (let axis = 3 * end; axis < 3 * end + 3; axis++) to.endPoint[axis] = from.endPoint[axis]!;
  }
  for (let cable = 0; cable < from.cables; cable++) {
    to.cableLength[cable] = from.cableLength[cable]!;
    to.cableStrain[cable] = from.cableStrain[cable]!;
    to.cableOwner[cable] = from.cableOwner[cable]!;
  }
  for (let at = 0; at < from.hidden; at++) to.hiddenId[at] = from.hiddenId[at]!;
}

/** The state byte's bit that says a guest is back in a car: his walker is gone. */
const FOOT_LEFT = 128;
/** The foot message's length: type, seq u16, crowd time f64, state, torso i16x3, velocity i16x3, heading. */
const FOOT_BYTES = 25;
const FOOT_STATE_AT = 11;
const FOOT_TORSO_AT = 12;
const FOOT_HEADING_AT = 24;

/** A guest's walker as his own machine has it (`MSG.foot`): where, how fast, which way and how, at his crowd second `crowdTime`; `left`: he is back in a car. */
export type FootRecord = BodyMotion & { seq: number; crowdTime: number; left: boolean };

export function makeFootRecord(): FootRecord {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0, seq: 0, crowdTime: 0, left: false };
}

/** `f` as a `MSG.foot` message (25 bytes). */
export function writeFoot(w: Writer, f: FootRecord): void {
  w.u8(MSG.foot);
  w.u16(f.seq);
  w.f64(f.crowdTime);
  w.u8(f.posture | (f.left ? FOOT_LEFT : 0));
  _triple[0] = f.x;
  _triple[1] = f.y;
  _triple[2] = f.z;
  w.q16s(_triple, 3, CENTIMETRES);
  _triple[0] = f.vx;
  _triple[1] = f.vy;
  _triple[2] = f.vz;
  w.q16s(_triple, 3, CENTIMETRES);
  w.u8(Math.round((((f.heading % TWO_PI) + TWO_PI) % TWO_PI) / RADIANS_PER_HEADING_STEP) & (HEADING_STEPS - 1));
}

/** Reads a `MSG.foot` message into `out`: false, with `out` untouched, for a bad length, type, posture, state bit or crowd time (untrusted: a peer's). */
export function readFoot(data: Uint8Array, r: Reader, out: FootRecord): boolean {
  if (data.length !== FOOT_BYTES || data[0] !== MSG.foot) return false;
  const state = data[FOOT_STATE_AT]!;
  if ((state & POSTURE_MASK) > BODY_POSTURE.getUp || (state & ~(POSTURE_MASK | FOOT_LEFT)) !== 0) return false;
  r.reset(data);
  r.off = 1;
  const seq = r.u16();
  const crowdTime = r.f64();
  if (!Number.isFinite(crowdTime)) return false;
  out.seq = seq;
  out.crowdTime = crowdTime;
  out.posture = state & POSTURE_MASK;
  out.left = (state & FOOT_LEFT) !== 0;
  r.off = FOOT_TORSO_AT;
  r.q16s(_triple, 3, METRES_PER_STEP);
  out.x = _triple[0]!;
  out.y = _triple[1]!;
  out.z = _triple[2]!;
  r.q16s(_triple, 3, METRES_PER_STEP);
  out.vx = _triple[0]!;
  out.vy = _triple[1]!;
  out.vz = _triple[2]!;
  r.off = FOOT_HEADING_AT;
  out.heading = r.u8() * RADIANS_PER_HEADING_STEP;
  return true;
}
