import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { fillSeat, seatCount, seatDoorSide, SEAT_DRIVER, seatRows } from "../vehicle/car-seats.ts";
import { ACT } from "../net/act-codec.ts";
import { MAX_ACTORS, SeatTable } from "../scenes/seat-table.ts";
import { SEATS_NOTICE } from "../net/seats-codec.ts";
import { ENTER_MAX_SPEED, EXIT_MAX_SPEED } from "../present/onfoot-flow.ts";
import type { Pole } from "../present/ragdoll-ground.ts";
import { DoorSwings } from "./engine-openworld-door-swings.ts";
import type { ActorPlace } from "./engine-openworld-law.ts";
import { doorAt, doorBlocked } from "./onfoot-doors.ts";

/** What asking for a seat came to: done (the table says so now), sent (a guest waits for the host's answer) or refused (`OpenWorldSeats.refusal` says why). */
export const ASK = { done: 0, sent: 1, refused: 2 } as const;

/** The door a player at a torso may get in at: the car, its x sign, and the car's speed (m/s). */
export type DoorPick = { car: number; side: number; speed: number };

/** The throttle (0 to 1) that counts as pressing it, and the least time (s) between two asks to take the wheel. */
const WHEEL_GAS = 0.3;
const WHEEL_ASK_GAP_S = 1;
/** A car this far (m) from a torso has no door in its reach: skips the door test. */
const NEAR_CAR_M = 4.5;
const NO_CAR = -1;

const _torso = new THREE.Vector3();
const _place: ActorPlace = { x: 0, y: 0, z: 0, heading: 0, velocityX: 0, velocityZ: 0 };
const _speed = new Float64Array(1);
const _eye = { x: 0, y: 0, z: 0 };
const _up = { x: 0, y: 1, z: 0 };

/** What the seats need of the engine. */
type SeatPorts = {
  cars(): readonly DeformableCar[];
  poles(): readonly Pole[];
  /** Where actor `actor` stands on foot, into `out`; false when he is not on foot. */
  place(actor: number, out: ActorPlace): boolean;
  /** The open world is on: the table holds anyone only then. */
  active(): boolean;
  /** Another player sits in the room as actor `actor` (a peer's car): the host seats him in his own car when he joins and frees his seat when he leaves. */
  peer(actor: number): boolean;
  /** This machine's player's actor. */
  self(): number;
  /** This machine is a guest: it asks the host instead of seating anyone. */
  guest(): boolean;
  /** Car `car` has nobody in it that a player may take (`OpenWorldDirector.canEnter`): host and solo only. */
  canTake(car: number): boolean;
  /** A player took car `car` for good: the traffic never drives it again. */
  taken(car: number): void;
  /** The throttle this machine's player holds (0 to 1). */
  gas(): number;
  now(): number;
  /** A guest's way to the host: `NetPlay.sendAct`. */
  sendAct(kind: number, arg: number, eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): void;
};

/**
 * Who sits where in the open world, and the one family of functions that carries out getting in and out for any player at the machine that runs the cars (`getIn`, `getOut`),
 * which the host's own player and a solo one call as a guest's act does. A guest asks the host and waits for the table it sends (`MSG.seats`); the table is the one truth.
 */
export class OpenWorldSeats {
  readonly table = new SeatTable();
  private readonly ports: SeatPorts;
  private readonly swings: DoorSwings;
  /** Per actor, the car he last sat at the wheel of: the one his reset puts him in. */
  private readonly lastDriven = new Int16Array(MAX_ACTORS).fill(NO_CAR);
  /** Per actor, 1 once the roster has seated him. */
  private readonly known = new Uint8Array(MAX_ACTORS);
  private wasActive = false;
  private noticeHeard: number = SEATS_NOTICE.none;
  private wheelAskedAt = -Infinity;

  constructor(ports: SeatPorts) {
    this.ports = ports;
    this.swings = new DoorSwings({ cars: () => ports.cars(), place: (actor, out) => ports.place(actor, out), seated: (actor) => this.table.carOf(actor) >= 0 });
  }

  /** Seat of this machine's player (row x 2 + side), -1 when he sits in none. */
  mySeat(): number {
    return this.table.seatOf(this.ports.self());
  }

  /** Car this machine's player sits in, -1 when none. */
  myCar(): number {
    return this.table.carOf(this.ports.self());
  }

  /** Whether player `actor` may take a seat of `car`: the driver's seat when nobody holds it and the car is one to take, his own car or the one he last drove, any other seat when a player drives it, and one is free. */
  mayEnter(actor: number, car: number): boolean {
    const cars = this.ports.cars();
    const body = cars[car];
    if (body === undefined || this.table.carOf(actor) >= 0) return false;
    const taken = this.table.takenMask(car);
    if (taken === (1 << seatCount(body.style)) - 1) return false;
    return this.table.driverOf(car) >= 0 || (taken === 0 && (car === actor || car === this.lastDriven[actor] || this.ports.canTake(car)));
  }

  /** The car and door this machine's player standing at `torso` may get in at, into `out`: the same door test that `getIn` uses, lighting the prompt. */
  pick(torso: THREE.Vector3, out: DoorPick): boolean {
    const cars = this.ports.cars();
    const actor = this.ports.self();
    for (let car = 0; car < cars.length; car++) {
      const body = cars[car]!;
      if (Math.abs(body.group.position.x - torso.x) > NEAR_CAR_M || Math.abs(body.group.position.z - torso.z) > NEAR_CAR_M || !this.mayEnter(actor, car)) continue;
      const side = doorAt(body, torso, _speed);
      if (side === 0) continue;
      out.car = car;
      out.side = side;
      out.speed = _speed[0]!;
      return true;
    }
    return false;
  }

  /**
   * Player `actor`, on foot, gets in car `car` at the door nearest his torso: seated by `fillSeat`, the door swinging open for him, the car his for good when it is the driver's seat of one that was not his own.
   * An actor already in that car is re-seated by the same rule (the throttle with the driver's seat empty slides him over). 0, or the `SEATS_NOTICE` that says why not.
   */
  getIn(actor: number, car: number): number {
    const body = this.ports.cars()[car];
    if (body === undefined || actor < 0 || actor >= MAX_ACTORS) return SEATS_NOTICE.noCar;
    if (this.table.carOf(actor) === car) return this.reseat(actor, car, body);
    if (!this.ports.place(actor, _place)) return SEATS_NOTICE.noCar;
    _torso.set(_place.x, _place.y, _place.z);
    if (!this.mayEnter(actor, car)) return SEATS_NOTICE.noCar;
    const side = doorAt(body, _torso, _speed);
    if (side === 0) return SEATS_NOTICE.noCar;
    if (_speed[0]! > ENTER_MAX_SPEED) return SEATS_NOTICE.tooFast;
    const seat = fillSeat(seatRows(body.style), this.table.takenMask(car), side);
    if (seat < 0 || !this.table.sit(actor, car, seat)) return SEATS_NOTICE.noCar;
    if (seat === SEAT_DRIVER) this.drives(actor, car, body);
    this.swings.open(actor, car, side, false);
    return SEATS_NOTICE.none;
  }

  private reseat(actor: number, car: number, body: DeformableCar): number {
    const old = this.table.seatOf(actor);
    const taken = this.table.takenMask(car) & ~(1 << old);
    const seat = fillSeat(seatRows(body.style), taken, seatDoorSide(old));
    if (seat !== old) this.table.sit(actor, car, seat);
    if (seat === SEAT_DRIVER) this.drives(actor, car, body);
    return SEATS_NOTICE.none;
  }

  /** Actor `actor` took the driver's seat of `car`: it is his for good when it was not his own, the one his reset puts him in, and driven again if its driver had been thrown out. */
  private drives(actor: number, car: number, body: DeformableCar): void {
    if (car !== actor) this.ports.taken(car);
    this.lastDriven[actor] = car;
    body.driverOut = null;
  }

  /** Player `actor` gets out of his seat by the door on its side, which swings open for him. 0, or the `SEATS_NOTICE` that says why not. */
  getOut(actor: number): number {
    const index = this.table.carOf(actor);
    const body = this.ports.cars()[index];
    if (body === undefined) return SEATS_NOTICE.noCar;
    const side = seatDoorSide(this.table.seatOf(actor));
    if (body.velocity.length() > EXIT_MAX_SPEED) return SEATS_NOTICE.tooFast;
    if (doorBlocked(this.ports.cars(), body, this.ports.poles(), side)) return SEATS_NOTICE.doorBlocked;
    this.table.leave(actor);
    this.swings.open(actor, index, side, true);
    return SEATS_NOTICE.none;
  }

  /** The driver of car `car` was thrown out: he is on foot, and the seat is free. Passengers stay. */
  driverEjected(car: number): void {
    const actor = this.table.driverOf(car);
    if (actor >= 0) this.table.leave(actor);
  }

  /** Actor `actor`'s reset (R): he sits at the wheel of the car he last drove if it is free, else of his own; the car to put back at its spawn, -1 for none. */
  respawned(actor: number): number {
    const seated = this.table.carOf(actor);
    if (seated >= 0) return this.table.seatOf(actor) === SEAT_DRIVER ? seated : NO_CAR;
    const last = this.lastDriven[actor]!;
    const car = last !== NO_CAR && this.ports.cars()[last] !== undefined && this.table.sit(actor, last, SEAT_DRIVER) ? last : actor;
    if (car === actor && (this.ports.cars()[car] === undefined || !this.table.sit(actor, car, SEAT_DRIVER))) return NO_CAR;
    return car;
  }

  /** This machine's player's trip ended without its climb (a reset, a climb that could not start): the door he swung is let go. */
  tripEnded(): void {
    this.swings.release(this.ports.self());
  }

  /** This machine's player's reset (R): the host and solo seat him at the wheel of his car again; a guest asks the host by his reset request, so nothing here. */
  respawnMine(): number {
    return this.ports.guest() ? NO_CAR : this.respawned(this.ports.self());
  }

  /** This machine's player asks to get in car `car`: carried out here by the host and solo, sent to the host by a guest. */
  askIn(car: number): number {
    if (this.ports.guest()) {
      const body = this.ports.cars()[car];
      if (body === undefined) return this.refuse(SEATS_NOTICE.noCar);
      const onFoot = this.ports.place(this.ports.self(), _place);
      _eye.x = onFoot ? _place.x : body.group.position.x;
      _eye.y = onFoot ? _place.y : body.group.position.y;
      _eye.z = onFoot ? _place.z : body.group.position.z;
      this.ports.sendAct(ACT.getIn, car, _eye, _up);
      return ASK.sent;
    }
    return this.refuse(this.getIn(this.ports.self(), car));
  }

  /** This machine's player asks to get out of his seat: carried out here by the host and solo, sent to the host by a guest. */
  askOut(): number {
    if (this.ports.guest()) {
      const body = this.ports.cars()[this.myCar()];
      if (body === undefined) return this.refuse(SEATS_NOTICE.noCar);
      this.ports.sendAct(ACT.getOut, 0, body.group.position, _up);
      return ASK.sent;
    }
    return this.refuse(this.getOut(this.ports.self()));
  }

  private refuse(notice: number): number {
    this.noticeHeard = notice;
    return notice === SEATS_NOTICE.none ? ASK.done : ASK.refused;
  }

  /** The host's notice (`SEATS_NOTICE`) for the last thing this player asked: 0 for none; read once. */
  takeNotice(): number {
    const notice = this.noticeHeard;
    this.noticeHeard = SEATS_NOTICE.none;
    return notice;
  }

  /** A guest's host refused what he asked: shown as the on-foot refusal for `notice`. */
  heardNotice(notice: number): void {
    this.noticeHeard = notice;
  }

  /** Seats every peer in the room that the table has not met in his own car's driver seat, and frees the seat of every one it met that is gone. Host and solo. */
  private seatRoster(): void {
    for (let actor = 0; actor < MAX_ACTORS; actor++) {
      const present = actor === this.ports.self() || this.ports.peer(actor);
      if (present && this.known[actor] === 0) {
        this.known[actor] = 1;
        this.table.sit(actor, actor, SEAT_DRIVER);
        this.lastDriven[actor] = actor;
      } else if (!present && this.known[actor] === 1) {
        this.known[actor] = 0;
        this.table.leave(actor);
        this.lastDriven[actor] = NO_CAR;
      }
    }
  }

  /** Everyone is gone (the open world was left or began again). */
  private reset(): void {
    this.swings.clear();
    this.table.clear();
    this.known.fill(0);
    this.lastDriven.fill(NO_CAR);
  }

  /** Once a frame: the open world's start and end, the roster, the doors, and a passenger's throttle with the driver's seat empty asking for the wheel. */
  frame(wallDt: number): void {
    const active = this.ports.active();
    if (active !== this.wasActive) {
      this.wasActive = active;
      if (!active || !this.ports.guest()) this.reset();
    }
    if (!active) return;
    if (!this.ports.guest()) {
      this.seatRoster();
      this.swings.frame(wallDt);
    }
    const car = this.myCar();
    if (this.mySeat() <= SEAT_DRIVER || this.table.driverOf(car) >= 0 || this.ports.gas() < WHEEL_GAS) return;
    const now = this.ports.now();
    if (now - this.wheelAskedAt < WHEEL_ASK_GAP_S) return;
    this.wheelAskedAt = now;
    this.askIn(car);
  }
}
