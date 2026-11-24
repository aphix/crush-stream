import { MSG } from "./codec.ts";

/** What a guest on foot does that the host decides: the act kinds of `MSG.act` (the type byte after the sequence number). */
export const ACT = { punch: 0, shot: 1, hookFire: 2, hookCut: 3, hookReelOn: 4, hookReelOff: 5, getIn: 6, getOut: 7 } as const;

/** Act kinds this build knows: a kind from `ACT_KINDS` on is refused. */
export const ACT_KINDS = 8;

/** What a guest's own aim ray first met, as a shot or a hook fire names it: nothing (the world), or a civilian, a foot cop, a player (by car index) or a car. */
export const NAMED = { nothing: 0, civilian: 1, cop: 2, player: 3, car: 4 } as const;

/** Named kinds this build knows: a kind from `NAMED_KINDS` on is refused. */
const NAMED_KINDS = 5;

/** Type byte, sequence (u16), kind (u8), arg (u8), eye (i16 x 3, cm), direction (i16 x 3, times 32767). */
const ACT_BYTES = 17;
/** A shot and a hook fire add the name of what the guest's ray met: kind (u8), index (u16), the hit point's offset from that thing's origin as the guest draws it (i16 x 3, cm; a car's in the car's own frame). */
const NAMED_BYTES = 9;
const NAMED_AT = ACT_BYTES;
const SEQ_AT = 1;
const KIND_AT = 3;
const ARG_AT = 4;
const EYE_AT = 5;
const DIR_AT = 11;
const CM = 100;
const DIR_STEPS = 32767;
const I16_MAX = 32767;

/** Whether acts of `kind` carry the name of what the guest's ray met. */
function carriesName(kind: number): boolean {
  return kind === ACT.shot || kind === ACT.hookFire;
}

/** What a guest's ray first met: its `NAMED` kind, its index (a civilian's, a cop's, a player's car, a car's), and the hit point (m) as an offset from that thing's origin as the guest draws it. */
export class Named {
  kind: number = NAMED.nothing;
  id = 0;
  x = 0;
  y = 0;
  z = 0;
}

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
  /** Only a shot and a hook fire carry one. */
  readonly named = new Named();
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
  const named = carriesName(act.kind);
  const out = new Uint8Array(named ? ACT_BYTES + NAMED_BYTES : ACT_BYTES);
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
  if (named) packNamed(act.named, view);
  return out;
}

/** The name `named` into `view` after the act's fixed part: a name that is no kind of ours, not finite or past what 16 bits of centimetres hold is sent as nothing (the act itself still goes). */
function packNamed(named: Named, view: DataView): void {
  const fits = Number.isInteger(named.kind) && named.kind > NAMED.nothing && named.kind < NAMED_KINDS && Number.isInteger(named.id) && named.id >= 0 && named.id <= 0xffff && fitsEye(named.x) && fitsEye(named.y) && fitsEye(named.z);
  view.setUint8(NAMED_AT, fits ? named.kind : NAMED.nothing);
  view.setUint16(NAMED_AT + 1, fits ? named.id : 0, true);
  view.setInt16(NAMED_AT + 3, fits ? Math.round(named.x * CM) : 0, true);
  view.setInt16(NAMED_AT + 5, fits ? Math.round(named.y * CM) : 0, true);
  view.setInt16(NAMED_AT + 7, fits ? Math.round(named.z * CM) : 0, true);
}

/** Reads the name after the act's fixed part of `view` into `out`; false for a kind that is none of `NAMED`. */
function readNamed(view: DataView, out: Named): boolean {
  const kind = view.getUint8(NAMED_AT);
  if (kind >= NAMED_KINDS) return false;
  out.kind = kind;
  out.id = view.getUint16(NAMED_AT + 1, true);
  out.x = view.getInt16(NAMED_AT + 3, true) / CM;
  out.y = view.getInt16(NAMED_AT + 5, true) / CM;
  out.z = view.getInt16(NAMED_AT + 7, true) / CM;
  return true;
}

/** Reads a guest's `MSG.act` into `out`: false (and `out` unspecified) for a message of another length or type, an unknown kind or an unknown named kind (untrusted: a peer's). */
export function readAct(data: Uint8Array, out: Act): boolean {
  if (data[0] !== MSG.act || data[KIND_AT]! >= ACT_KINDS || data.length !== (carriesName(data[KIND_AT]!) ? ACT_BYTES + NAMED_BYTES : ACT_BYTES)) return false;
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
  if (carriesName(out.kind)) return readNamed(view, out.named);
  out.named.kind = NAMED.nothing;
  return true;
}
