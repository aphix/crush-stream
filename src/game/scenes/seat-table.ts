import { MAX_SEATS } from "../vehicle/car-seats.ts";
import { MAX_CARS } from "./fleet.ts";

/** Actors are roster seats: a player's own car index, host 0 and guests 1 on. */
export const MAX_ACTORS = MAX_CARS;

/** Who sits where: the one truth of a room's seats. The host decides it, every peer holds a copy of it (`MSG.seats`). */
export class SeatTable {
  /** Counts each change, so the host knows when to tell its peers. */
  version = 0;
  private readonly carOfActor = new Int8Array(MAX_ACTORS).fill(-1);
  private readonly seatOfActor = new Int8Array(MAX_ACTORS).fill(-1);
  private readonly holders = new Int8Array(MAX_CARS * MAX_SEATS).fill(-1);
  private seated = 0;

  /** The car actor `actor` sits in, -1 when he sits in none. */
  carOf(actor: number): number {
    return actor >= 0 && actor < MAX_ACTORS ? this.carOfActor[actor]! : -1;
  }

  /** Actor `actor`'s seat in his car (row x 2 + side), -1 when he sits in none. */
  seatOf(actor: number): number {
    return actor >= 0 && actor < MAX_ACTORS ? this.seatOfActor[actor]! : -1;
  }

  /** The actor in `seat` of `car`, -1 for nobody. */
  holderOf(car: number, seat: number): number {
    return car >= 0 && car < MAX_CARS && seat >= 0 && seat < MAX_SEATS ? this.holders[car * MAX_SEATS + seat]! : -1;
  }

  /** The player at the wheel of `car`, -1 for none. */
  driverOf(car: number): number {
    return this.holderOf(car, 0);
  }

  /** The seats of `car` that players hold, as a bit mask (bit = seat index). */
  takenMask(car: number): number {
    let mask = 0;
    for (let seat = 0; seat < MAX_SEATS; seat++) if (this.holderOf(car, seat) >= 0) mask |= 1 << seat;
    return mask;
  }

  /** How many players sit anywhere. */
  get count(): number {
    return this.seated;
  }

  /** Actor `actor` takes `seat` of `car`, leaving the seat he held. False when a number is out of range or another player holds the seat. */
  sit(actor: number, car: number, seat: number): boolean {
    if (actor < 0 || actor >= MAX_ACTORS || car < 0 || car >= MAX_CARS || seat < 0 || seat >= MAX_SEATS) return false;
    const held = this.holders[car * MAX_SEATS + seat]!;
    if (held >= 0 && held !== actor) return false;
    if (held === actor) return true;
    this.leave(actor);
    this.holders[car * MAX_SEATS + seat] = actor;
    this.carOfActor[actor] = car;
    this.seatOfActor[actor] = seat;
    this.seated++;
    this.version++;
    return true;
  }

  /** Actor `actor` leaves his seat, if he holds one. */
  leave(actor: number): void {
    const car = this.carOf(actor);
    if (car < 0) return;
    this.holders[car * MAX_SEATS + this.seatOfActor[actor]!] = -1;
    this.carOfActor[actor] = -1;
    this.seatOfActor[actor] = -1;
    this.seated--;
    this.version++;
  }

  /** Nobody sits anywhere. */
  clear(): void {
    if (this.seated === 0) return;
    this.carOfActor.fill(-1);
    this.seatOfActor.fill(-1);
    this.holders.fill(-1);
    this.seated = 0;
    this.version++;
  }
}
