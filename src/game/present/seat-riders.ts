import { MAX_CARS } from "../scenes/fleet.ts";
import { MAX_ACTORS, type SeatTable } from "../scenes/seat-table.ts";
import { SCOOT_SECONDS, SEAT_DRIVER } from "../vehicle/car-seats.ts";
import type { DriverLook } from "./driver-look.ts";

const NONE = -1;

/**
 * Every seated player as the seat table draws him: his car, his seat, and a slide from the seat he sat down in to his own (`SCOOT_SECONDS`).
 * Players the table holds are drawn from here; a car's own driver (a resident, a cop) is drawn by `SeatedDrivers` as before.
 */
export class SeatRiders {
  /** The players to draw, packed from 0: each one's actor, car, seat, and the seat he slides from (-1: none) with the seconds he has slid. */
  count = 0;
  readonly actor = new Int8Array(MAX_ACTORS);
  readonly car = new Int16Array(MAX_ACTORS);
  readonly seat = new Int8Array(MAX_ACTORS);
  readonly from = new Int8Array(MAX_ACTORS);
  readonly slid = new Float64Array(MAX_ACTORS);
  /** How actor `actor` is dressed. */
  readonly lookOf: (actor: number) => DriverLook;
  private readonly lastCar = new Int16Array(MAX_ACTORS).fill(NONE);
  private readonly lastSeat = new Int8Array(MAX_ACTORS).fill(NONE);
  private readonly entry = new Int8Array(MAX_ACTORS).fill(NONE);
  private readonly slideFrom = new Int8Array(MAX_ACTORS).fill(NONE);
  private readonly slideFor = new Float64Array(MAX_ACTORS);
  private readonly driven = new Uint8Array(MAX_CARS);

  constructor(lookOf: (actor: number) => DriverLook) {
    this.lookOf = lookOf;
  }

  /** Actor `actor` sat down in seat `seat` (the one beside his door): he is drawn sliding from it to the seat the table gives him. */
  sitDown(actor: number, seat: number): void {
    this.entry[actor] = seat;
  }

  /** Whether a player holds the driver's seat of `car`: `SeatedDrivers` leaves its drawing to this. */
  drives(car: number): boolean {
    return this.driven[car] === 1;
  }

  /**
   * Once a frame: the players `table` seats, `dt` s on. A player whose seat changed slides from the one he left (in the same car) or from the seat he sat down in; `hidden`
   * is the player climbing in or out here, not drawn seated until he has finished.
   */
  refresh(table: SeatTable, dt: number, hidden: number): void {
    this.driven.fill(0);
    let n = 0;
    for (let actor = 0; actor < MAX_ACTORS; actor++) {
      const car = table.carOf(actor);
      if (car < 0 || car >= MAX_CARS || actor === hidden) {
        this.lastCar[actor] = NONE;
        this.lastSeat[actor] = NONE;
        if (car < 0) this.entry[actor] = NONE;
        continue;
      }
      const seat = table.seatOf(actor);
      if (car !== this.lastCar[actor] || seat !== this.lastSeat[actor]) this.begin(actor, car, seat);
      this.slideFor[actor] = this.slideFor[actor]! + dt;
      if (this.slideFor[actor]! >= SCOOT_SECONDS) this.slideFrom[actor] = NONE;
      this.actor[n] = actor;
      this.car[n] = car;
      this.seat[n] = seat;
      this.from[n] = this.slideFrom[actor]!;
      this.slid[n] = this.slideFor[actor]!;
      if (seat === SEAT_DRIVER) this.driven[car] = 1;
      n++;
    }
    this.count = n;
  }

  private begin(actor: number, car: number, seat: number): void {
    const sameCar = car === this.lastCar[actor] && this.lastSeat[actor]! >= 0;
    const start = sameCar ? this.lastSeat[actor]! : this.entry[actor]!;
    this.slideFrom[actor] = start === seat ? NONE : start;
    this.slideFor[actor] = 0;
    this.lastCar[actor] = car;
    this.lastSeat[actor] = seat;
    this.entry[actor] = NONE;
  }
}
