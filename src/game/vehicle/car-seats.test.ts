import { describe, expect, it } from "vitest";
import { CAR_STYLES } from "./car-variants.ts";
import { entrySeat, fillSeat, MAX_SEATS, scootShare, SCOOT_SECONDS, SEAT_DRIVER, seatCount, seatDoorSide, seatHip, seatRows } from "./car-seats.ts";
import { DRIVER_SIDE } from "./constants.ts";

const FRONT_ONLY = 1;
const WITH_REAR = 2;
/** Seats as a bit mask: the driver's, the other front, the rear driver's side, the rear other side. */
const DRIVER = 1 << 0;
const FRONT_PASSENGER = 1 << 1;
const REAR_DRIVER_SIDE = 1 << 2;
const REAR_OTHER_SIDE = 1 << 3;
const PASSENGER_DOOR = -DRIVER_SIDE;

describe("given a car's seats", () => {
  it("when each body style's rows are counted, then every style has a front row and every style but the pickup (a regular cab) has a rear row", () => {
    const rows = Object.values(CAR_STYLES).map((style) => [style.id, seatRows(style)] as const);
    for (const [id, count] of rows) expect(count, `${id}'s rows`).toBe(id === "pickup" ? FRONT_ONLY : WITH_REAR);
    expect(seatCount(CAR_STYLES.sedan), "a sedan's seats").toBe(MAX_SEATS);
    expect(seatCount(CAR_STYLES.pickup), "a pickup's seats").toBe(2);
  });

  it("when the driver's seat is asked about, then it is the front seat on the driver's side, and its door is the driver's", () => {
    expect(SEAT_DRIVER).toBe(0);
    expect(seatDoorSide(SEAT_DRIVER)).toBe(DRIVER_SIDE);
    expect(seatDoorSide(1)).toBe(PASSENGER_DOOR);
    expect(seatDoorSide(2), "the rear seat on the driver's side").toBe(DRIVER_SIDE);
    expect(seatDoorSide(3), "the rear seat on the other side").toBe(PASSENGER_DOOR);
  });

  const fills: readonly { it: string; rows: number; taken: number; door: number; seat: number }[] = [
    { it: "when nobody sits and he gets in at the driver's door, then he takes the driver's seat", rows: 2, taken: 0, door: DRIVER_SIDE, seat: 0 },
    { it: "when nobody sits and he gets in at the passenger door, then he takes the driver's seat too (and slides over)", rows: 2, taken: 0, door: PASSENGER_DOOR, seat: 0 },
    { it: "when the driver sits and he gets in at either door, then he takes the other front seat", rows: 2, taken: DRIVER, door: DRIVER_SIDE, seat: 1 },
    { it: "when both front seats are taken and he gets in at the driver's door, then he takes the rear seat on the driver's side", rows: 2, taken: DRIVER | FRONT_PASSENGER, door: DRIVER_SIDE, seat: 2 },
    { it: "when both front seats are taken and he gets in at the passenger door, then he takes the rear seat on that side", rows: 2, taken: DRIVER | FRONT_PASSENGER, door: PASSENGER_DOOR, seat: 3 },
    { it: "when the rear seat on his door's side is taken, then he takes the other rear seat", rows: 2, taken: DRIVER | FRONT_PASSENGER | REAR_DRIVER_SIDE, door: DRIVER_SIDE, seat: 3 },
    { it: "when every seat is taken, then there is no seat for him", rows: 2, taken: DRIVER | FRONT_PASSENGER | REAR_DRIVER_SIDE | REAR_OTHER_SIDE, door: DRIVER_SIDE, seat: -1 },
    { it: "when a car has only a front row and both seats are taken, then there is no seat for him", rows: 1, taken: DRIVER | FRONT_PASSENGER, door: PASSENGER_DOOR, seat: -1 },
    { it: "when the driver has left a car with a passenger in the front, then the next to get in takes the driver's seat", rows: 2, taken: FRONT_PASSENGER, door: PASSENGER_DOOR, seat: 0 },
  ];
  for (const fill of fills) {
    it(fill.it, () => {
      expect(fillSeat(fill.rows, fill.taken, fill.door)).toBe(fill.seat);
    });
  }

  it("when he gets in at a door, then he first sits in the front seat beside it", () => {
    expect(entrySeat(DRIVER_SIDE)).toBe(0);
    expect(entrySeat(PASSENGER_DOOR)).toBe(1);
  });
});

describe("given where a seat's hip sits", () => {
  const out = { x: 0, y: 0, z: 0 };
  it("when the front seats are read, then they mirror across the centre line at the style's own hip height and depth", () => {
    for (const style of Object.values(CAR_STYLES)) {
      const [across, up, along] = style.seats.front;
      const driver = { ...seatHip(style, 0, out) };
      const passenger = { ...seatHip(style, 1, out) };
      expect(driver.x, `${style.id}: the driver's side`).toBeCloseTo(DRIVER_SIDE * across, 9);
      expect(passenger.x, `${style.id}: the other side`).toBeCloseTo(-DRIVER_SIDE * across, 9);
      expect(driver.y, `${style.id}: the driver's hip height`).toBe(up);
      expect(driver.z, `${style.id}: the driver's hip depth`).toBe(along);
      expect(passenger.y, `${style.id}: the passenger's hip height`).toBe(up);
      expect(passenger.z, `${style.id}: the passenger's hip depth`).toBe(along);
    }
  });

  it("when the rear seats of a style with a rear row are read, then they sit on its bench behind the front ones, on each side", () => {
    for (const style of Object.values(CAR_STYLES)) {
      if (style.seats.rear === null) continue;
      const [bench, depth] = style.seats.rear;
      const left = { ...seatHip(style, 2, out) };
      const right = { ...seatHip(style, 3, out) };
      expect(left.y, `${style.id}: the bench's height`).toBe(bench);
      expect(left.z, `${style.id}: the bench's depth`).toBe(depth);
      expect(left.z, `${style.id}: behind the front seat`).toBeLessThan(style.seats.front[2]);
      expect(left.x, `${style.id}: the two sides mirror`).toBeCloseTo(-right.x, 9);
    }
  });
});

describe("given a slide from one seat to another", () => {
  it("when its clock runs, then the share goes from 0 to 1 over its duration and stays", () => {
    expect(scootShare(0)).toBe(0);
    expect(scootShare(SCOOT_SECONDS / 2)).toBeCloseTo(0.5, 9);
    expect(scootShare(SCOOT_SECONDS)).toBe(1);
    expect(scootShare(SCOOT_SECONDS * 3)).toBe(1);
  });
});
