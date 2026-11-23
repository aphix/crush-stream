import { DRIVER_SIDE } from "./constants.ts";
import type { BodyStyle } from "./car-variants.ts";

/** A row of seats is a left and a right one. */
const SEATS_PER_ROW = 2;
/** The most rows a style has: a front row and a rear row. */
const MAX_ROWS = 2;
/** The seat table's width per car. */
export const MAX_SEATS = MAX_ROWS * SEATS_PER_ROW;
/** The seat that drives: the front seat on `DRIVER_SIDE`. */
export const SEAT_DRIVER = 0;

/** Rows `style` has: its front row, and a rear row when the cabin has a bench (`BodyStyle.seats.rear`). */
export function seatRows(style: BodyStyle): number {
  return style.seats.rear === null ? 1 : MAX_ROWS;
}

/** Seats `style` has: two a row. */
export function seatCount(style: BodyStyle): number {
  return seatRows(style) * SEATS_PER_ROW;
}

/** Seat index of a row's side: 0 on the driver's side, 1 on the other. */
function seatAt(row: number, side: number): number {
  return row * SEATS_PER_ROW + side;
}

/** The x sign (car frame) of the door on `seat`'s side. */
export function seatDoorSide(seat: number): number {
  return seat % SEATS_PER_ROW === 0 ? DRIVER_SIDE : -DRIVER_SIDE;
}

/** The other seat of the front row for a front `seat` (the one he slides across to reach the far door), -1 for a seat of a rear row. */
export function frontNeighbour(seat: number): number {
  return seat >= 0 && seat < SEATS_PER_ROW ? seat ^ 1 : -1;
}

/** The side (0 or 1) the door at x sign `doorSide` belongs to. */
function doorSideOf(doorSide: number): number {
  return doorSide === DRIVER_SIDE ? 0 : 1;
}

/** The front seat beside the door at x sign `doorSide`: where he sits down before he slides anywhere. */
export function entrySeat(doorSide: number): number {
  return seatAt(0, doorSideOf(doorSide));
}

/**
 * The seat a player who gets in at the door at x sign `doorSide` takes, `taken` being a bit mask of the seats held (bit = seat index): the driver's seat if it is free,
 * else the other front seat, else in a rear row the seat on his door's side, else the other rear seat. -1 when none is free.
 */
export function fillSeat(rows: number, taken: number, doorSide: number): number {
  for (let row = 0; row < rows; row++) {
    const near = seatAt(row, doorSideOf(doorSide));
    const first = row === 0 ? SEAT_DRIVER : near;
    const second = row === 0 ? seatAt(0, 1) : near ^ 1;
    if ((taken & (1 << first)) === 0) return first;
    if ((taken & (1 << second)) === 0) return second;
  }
  return -1;
}

/** Where a seat's hip sits (m, car frame): across on `DRIVER_SIDE` for side 0, the front hip's height and depth, or the rear bench's. */
export function seatHip(style: BodyStyle, seat: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const [across, up, along] = style.seats.front;
  const bench = seat >= SEATS_PER_ROW ? style.seats.rear : null;
  out.x = seatDoorSide(seat) * across;
  out.y = bench ? bench[0] : up;
  out.z = bench ? bench[1] : along;
  return out;
}

/** How long (s) a player takes to slide from the seat he sat down in to his own. */
export const SCOOT_SECONDS = 0.45;

/** How far along a slide of `SCOOT_SECONDS` a clock `t` (s) is, eased 0 to 1. */
export function scootShare(t: number): number {
  const x = Math.max(0, Math.min(1, t / SCOOT_SECONDS));
  return x * x * (3 - 2 * x);
}
