import { MSG } from "./codec.ts";

/** What a guest on foot does that the host decides: the act kinds of `MSG.act` (the type byte after the sequence number). */
export const ACT = { punch: 0, shot: 1, hookFire: 2, hookCut: 3, hookReelOn: 4, hookReelOff: 5, getIn: 6, getOut: 7 } as const;

/** Act kinds this build knows: a kind from `ACT_KINDS` on is refused. */
export const ACT_KINDS = 8;

/** Type byte, sequence (u16), kind (u8), arg (u8), eye (i16 x 3, cm), direction (i16 x 3, times 32767). */
const ACT_BYTES = 17;
const SEQ_AT = 1;
const KIND_AT = 3;
const ARG_AT = 4;
const EYE_AT = 5;
const DIR_AT = 11;
const CM = 100;
const DIR_STEPS = 32767;
const I16_MAX = 32767;

/** An act as the host reads it: what the guest did, from where its eye stood (m) and along which unit direction. */
export class Act {
  seq = 0;
  kind: number = ACT.punch;
  arg = 0;
  eyeX = 0;
  eyeY = 0;
  eyeZ = 0;
  dirX = 0;
  dirY = 0;
  dirZ = 0;
}

/** Whether `m` metres fit an i16 of centimetres. */
function fitsEye(m: number): boolean {
  return Math.abs(Math.round(m * CM)) <= I16_MAX;
}

/** The `MSG.act` for `act`; null when a value is not finite or the eye is past what 16 bits of centimetres hold, or the kind is unknown (nothing is sent for it). */
export function packAct(act: Act): Uint8Array<ArrayBuffer> | null {
  const finite = Number.isFinite(act.eyeX) && Number.isFinite(act.eyeY) && Number.isFinite(act.eyeZ) && Number.isFinite(act.dirX) && Number.isFinite(act.dirY) && Number.isFinite(act.dirZ);
  if (!finite || !Number.isInteger(act.kind) || act.kind < 0 || act.kind >= ACT_KINDS) return null;
  if (!fitsEye(act.eyeX) || !fitsEye(act.eyeY) || !fitsEye(act.eyeZ)) return null;
  const out = new Uint8Array(ACT_BYTES);
  const view = new DataView(out.buffer);
  out[0] = MSG.act;
  view.setUint16(SEQ_AT, act.seq, true);
  out[KIND_AT] = act.kind;
  out[ARG_AT] = act.arg & 0xff;
  view.setInt16(EYE_AT, Math.round(act.eyeX * CM), true);
  view.setInt16(EYE_AT + 2, Math.round(act.eyeY * CM), true);
  view.setInt16(EYE_AT + 4, Math.round(act.eyeZ * CM), true);
  view.setInt16(DIR_AT, Math.round(Math.max(-1, Math.min(1, act.dirX)) * DIR_STEPS), true);
  view.setInt16(DIR_AT + 2, Math.round(Math.max(-1, Math.min(1, act.dirY)) * DIR_STEPS), true);
  view.setInt16(DIR_AT + 4, Math.round(Math.max(-1, Math.min(1, act.dirZ)) * DIR_STEPS), true);
  return out;
}

/** Reads a guest's `MSG.act` into `out`: false (and `out` unspecified) for a message of another length or type or an unknown kind (untrusted: a peer's). */
export function readAct(data: Uint8Array, out: Act): boolean {
  if (data.length !== ACT_BYTES || data[0] !== MSG.act || data[KIND_AT]! >= ACT_KINDS) return false;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  out.seq = view.getUint16(SEQ_AT, true);
  out.kind = data[KIND_AT]!;
  out.arg = data[ARG_AT]!;
  out.eyeX = view.getInt16(EYE_AT, true) / CM;
  out.eyeY = view.getInt16(EYE_AT + 2, true) / CM;
  out.eyeZ = view.getInt16(EYE_AT + 4, true) / CM;
  out.dirX = view.getInt16(DIR_AT, true) / DIR_STEPS;
  out.dirY = view.getInt16(DIR_AT + 2, true) / DIR_STEPS;
  out.dirZ = view.getInt16(DIR_AT + 4, true) / DIR_STEPS;
  return true;
}
