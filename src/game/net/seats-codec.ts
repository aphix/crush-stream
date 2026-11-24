import { MSG } from "./codec.ts";
import { MAX_ACTORS, SeatTable } from "../scenes/seat-table.ts";

/** What the byte after the seats tells the peer it is sent to: nothing, or why the host did not carry out what he asked (he shows the on-foot refusal text for it). */
export const SEATS_NOTICE = { none: 0, noCar: 1, tooFast: 2, doorBlocked: 3 } as const;
/** Notice values this build knows. */
const NOTICES = 4;

/** The `arg` byte of a guest's get-out act: the door he will climb out by, 1 the door at x sign +1, 2 the one at -1 (0: he names none). */
export function exitDoorArg(side: number): number {
  return side > 0 ? 1 : side < 0 ? 2 : 0;
}

/** The door (x sign) a get-out act's `arg` names; 0 for none or a value this build does not know (untrusted: a peer's). */
export function exitDoorOf(arg: number): number {
  return arg === 1 ? 1 : arg === 2 ? -1 : 0;
}

/** Type byte, count byte, then per seated actor: actor, car, seat (row x 2 + side); then the notice byte. */
const HEAD_BYTES = 2;
const ENTRY_BYTES = 3;
const NOTICE_BYTES = 1;

const scratch = new SeatTable();

/** `MSG.seats` for `table` with `notice` for the peer it goes to. */
export function packSeats(table: SeatTable, notice: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(HEAD_BYTES + table.count * ENTRY_BYTES + NOTICE_BYTES);
  out[0] = MSG.seats;
  out[1] = table.count;
  let at = HEAD_BYTES;
  for (let actor = 0; actor < MAX_ACTORS; actor++) {
    const car = table.carOf(actor);
    if (car < 0) continue;
    out[at++] = actor;
    out[at++] = car;
    out[at++] = table.seatOf(actor);
  }
  out[at] = notice;
  return out;
}

/**
 * Reads a host's `MSG.seats` over `into`: the notice byte, or -1 (and `into` untouched) for a message of another length or type, a number out of range,
 * an actor seated twice or a seat held twice (untrusted: whatever a peer sent).
 */
export function readSeats(data: Uint8Array, into: SeatTable): number {
  if (data.length < HEAD_BYTES + NOTICE_BYTES || data[0] !== MSG.seats) return -1;
  const count = data[1]!;
  if (data.length !== HEAD_BYTES + count * ENTRY_BYTES + NOTICE_BYTES || data[data.length - 1]! >= NOTICES) return -1;
  scratch.clear();
  for (let entry = 0; entry < count; entry++) {
    const at = HEAD_BYTES + entry * ENTRY_BYTES;
    if (scratch.carOf(data[at]!) >= 0 || !scratch.sit(data[at]!, data[at + 1]!, data[at + 2]!)) return -1;
  }
  into.clear();
  for (let entry = 0; entry < count; entry++) {
    const at = HEAD_BYTES + entry * ENTRY_BYTES;
    into.sit(data[at]!, data[at + 1]!, data[at + 2]!);
  }
  return data[data.length - 1]!;
}
