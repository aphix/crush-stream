import { packSeats, SEATS_NOTICE } from "./seats-codec.ts";
import type { SeatTable } from "../scenes/seat-table.ts";

/** The host's end of `MSG.seats`: says when the table changed since the last message went out. */
export class SeatsOutbox {
  private sent = -1;

  /** The message for `table` when it changed since the last one, or `force`d (a keyframe, a peer that joined); null otherwise. */
  due(table: SeatTable, force: boolean): Uint8Array<ArrayBuffer> | null {
    if (!force && table.version === this.sent) return null;
    this.sent = table.version;
    return packSeats(table, SEATS_NOTICE.none);
  }

  /** The next message goes out whatever the table says (the room closed, a new table). */
  reset(): void {
    this.sent = -1;
  }
}
