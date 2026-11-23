import { describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { SeatTable } from "../scenes/seat-table.ts";
import { MSG } from "./codec.ts";
import { packSeats, readSeats, SEATS_NOTICE } from "./seats-codec.ts";
import { SeatsOutbox } from "./seats-link.ts";

/** The host's table: the host in car 0's driver seat, a guest beside him, a second guest in the rear, a third alone in his own car. */
function tableOfFour(): SeatTable {
  const table = new SeatTable();
  table.sit(0, 0, 0);
  table.sit(1, 0, 1);
  table.sit(2, 0, 3);
  table.sit(3, 3, 0);
  return table;
}

/** Every seated actor as (actor, car, seat) triples, in actor order. */
function triples(table: SeatTable): number[] {
  const out: number[] = [];
  for (let actor = 0; actor < 32; actor++) if (table.carOf(actor) >= 0) out.push(actor, table.carOf(actor), table.seatOf(actor));
  return out;
}

describe("given the host's table of who sits where", () => {
  it("when it is packed, then the message is the type byte 17, the count, three bytes a seated actor (actor, car, seat) and the notice byte", () => {
    const data = packSeats(tableOfFour(), SEATS_NOTICE.none);
    expect(data.length, "2 + 3 x 4 + 1 bytes").toBe(15);
    expect(MSG.seats, "its id").toBe(17);
    expect(firstMismatch(Array.from(data), [17, 4, 0, 0, 0, 1, 0, 1, 2, 0, 3, 3, 3, 0, 0]), "the layout").toBeUndefined();
  });

  it("when a peer reads it, then it holds the same table", () => {
    const heard = new SeatTable();
    heard.sit(5, 5, 0);
    expect(readSeats(packSeats(tableOfFour(), SEATS_NOTICE.none), heard), "read").toBe(SEATS_NOTICE.none);
    expect(firstMismatch(triples(heard), triples(tableOfFour())), "who sits where").toBeUndefined();
    expect(heard.carOf(5), "a seat the host's table does not hold is empty").toBe(-1);
  });

  it("when a refused guest's message is read, then it leaves him unseated and carries the byte that tells him to show the refusal", () => {
    const table = tableOfFour();
    const heard = new SeatTable();
    expect(readSeats(packSeats(table, SEATS_NOTICE.noCar), heard), "the notice").toBe(SEATS_NOTICE.noCar);
    expect(heard.carOf(5), "he sits nowhere").toBe(-1);
    expect(readSeats(packSeats(table, SEATS_NOTICE.tooFast), heard)).toBe(SEATS_NOTICE.tooFast);
    expect(readSeats(packSeats(table, SEATS_NOTICE.doorBlocked), heard)).toBe(SEATS_NOTICE.doorBlocked);
  });

  const malformed: readonly { it: string; edit: (data: Uint8Array) => Uint8Array }[] = [
    { it: "when it is cut short, then it is refused", edit: (data) => data.slice(0, data.length - 2) },
    { it: "when it is another message's type, then it is refused", edit: (data) => Uint8Array.of(MSG.roster, ...data.slice(1)) },
    { it: "when its count is one more than its entries, then it is refused", edit: (data) => Uint8Array.of(data[0]!, data[1]! + 1, ...data.slice(2)) },
    { it: "when it seats a car past the field, then it is refused", edit: (data) => Uint8Array.of(...data.slice(0, 3), 99, ...data.slice(4)) },
    { it: "when it names a seat past a car's four, then it is refused", edit: (data) => Uint8Array.of(...data.slice(0, 4), 4, ...data.slice(5)) },
    { it: "when it seats two actors in one seat, then it is refused", edit: (data) => Uint8Array.of(...data.slice(0, 5), 1, 0, 0, ...data.slice(8)) },
    { it: "when it seats one actor twice, then it is refused", edit: (data) => Uint8Array.of(...data.slice(0, 5), 0, 3, 2, ...data.slice(8)) },
    { it: "when its notice is one this build does not know, then it is refused", edit: (data) => Uint8Array.of(...data.slice(0, data.length - 1), 9) },
  ];
  for (const bad of malformed) {
    it(bad.it, () => {
      const heard = tableOfFour();
      const before = triples(heard);
      expect(readSeats(bad.edit(packSeats(tableOfFour(), SEATS_NOTICE.none)), heard), "refused").toBe(-1);
      expect(firstMismatch(triples(heard), before), "the table it was read into is untouched").toBeUndefined();
    });
  }
});

describe("given the host's outbox", () => {
  it("when the table has not changed since the last message, then nothing is due, and a forced message (a keyframe, a peer that joined) is", () => {
    const table = tableOfFour();
    const outbox = new SeatsOutbox();
    expect(outbox.due(table, false), "the first message").not.toBeNull();
    expect(outbox.due(table, false), "nothing changed").toBeNull();
    expect(outbox.due(table, true), "forced").not.toBeNull();
  });

  it("when a player sits or leaves, then the next message is due", () => {
    const table = tableOfFour();
    const outbox = new SeatsOutbox();
    outbox.due(table, false);
    table.leave(1);
    expect(outbox.due(table, false), "he left").not.toBeNull();
    table.sit(1, 3, 1);
    expect(outbox.due(table, false), "he sat").not.toBeNull();
    outbox.reset();
    expect(outbox.due(table, false), "the room closed and opened again").not.toBeNull();
  });
});

describe("given the seat table", () => {
  it("when two players ask for one seat, then the first has it and the second does not", () => {
    const table = new SeatTable();
    expect(table.sit(1, 4, 0)).toBe(true);
    expect(table.sit(2, 4, 0)).toBe(false);
    expect(table.driverOf(4), "the first one drives").toBe(1);
    expect(table.carOf(2), "the second sits nowhere").toBe(-1);
  });

  it("when a player moves to another seat, then the seat he left is free and he holds one only", () => {
    const table = new SeatTable();
    table.sit(1, 4, 1);
    table.sit(1, 4, 0);
    expect(table.holderOf(4, 1), "the seat he left").toBe(-1);
    expect(table.driverOf(4)).toBe(1);
    expect(table.count, "seated players").toBe(1);
    expect(table.takenMask(4), "the seats of the car held").toBe(1);
  });

  it("when a player leaves, then his seat is free", () => {
    const table = tableOfFour();
    table.leave(1);
    expect(table.holderOf(0, 1)).toBe(-1);
    expect(table.carOf(1)).toBe(-1);
    expect(table.count).toBe(3);
  });
});
