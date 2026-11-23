import type * as THREE from "three";
import type { DriverSeat } from "../vehicle/car-drive.ts";
import { MAX_SEATS, SEAT_DRIVER, seatDoorSide } from "../vehicle/car-seats.ts";
import { DRIVER_SIDE } from "../vehicle/constants.ts";
import { SEATS_NOTICE } from "../net/seats-codec.ts";
import type { OnFootRefusal, OnFootStep } from "../present/onfoot-flow.ts";
import { ASK, type DoorPick } from "./engine-openworld-seats.ts";

/** What the director asks of the open world's seats (`OpenWorldSeats`). */
export interface OnFootDesk {
  /** This player's seat (row x 2 + side) and car, -1 when he sits in none. */
  mySeat(): number;
  myCar(): number;
  /** The door (x sign) he would leave his seat by, 0 when no door has room. */
  myExitSide(): number;
  /** The car and door he may get in at from `torso`, into `out`. */
  pick(torso: THREE.Vector3, out: DoorPick): boolean;
  askIn(car: number): number;
  askOut(): number;
  /** Why the host refused the last ask (`SEATS_NOTICE`), 0 for it did not; read once. */
  takeNotice(): number;
  /** His reset (R) seats him at the wheel of his car again; the car, -1 for none. */
  respawnMine(): number;
  /** His trip ended (a reset, a failed climb): the door he swung is let go. */
  tripEnded(): void;
}

/** What the ride needs of the director's host. */
type RideHost = {
  seat: DriverSeat;
  desk(): OnFootDesk | null;
  adopt(index: number): void;
};

/** A guest waits this long (s) for the host's answer to what he asked, then gives up. */
const ASK_WAIT_SECONDS = 3;
const NOT_SET = -2;
const REFUSAL_OF: Record<number, OnFootRefusal> = {
  [SEATS_NOTICE.noCar]: "noCarInReach",
  [SEATS_NOTICE.tooFast]: "tooFast",
  [SEATS_NOTICE.doorBlocked]: "doorBlocked",
};

const _pick: DoorPick = { car: -1, side: DRIVER_SIDE, speed: 0 };

/**
 * The seats side of the player's trip: asking the seat table for a seat or to leave one (a guest waits for the host's answer), the door the trip goes through, and the seat the
 * camera and wheel take once the table changes under him (a passenger who takes the wheel). Outside the open world there is no table and every ask is granted at once.
 */
export class OnFootRide {
  /** The door of the trip in hand, as its x sign. */
  side = DRIVER_SIDE;
  /** The trip in hand is a passenger's: not the driver's seat. */
  passenger = false;
  /** Why the last ask was refused. */
  refusal: OnFootRefusal | null = null;
  private readonly host: RideHost;
  private asked: OnFootStep = "none";
  /** The car the step in hand was asked for. */
  car = -1;
  private askedFor = 0;
  private key = NOT_SET;

  constructor(host: RideHost) {
    this.host = host;
  }

  /** The car he may get in at from `torso` and its speed (`speed[0]`), -1 for none: the door is kept in `side`. */
  reach(torso: THREE.Vector3, speed: Float64Array): number {
    const desk = this.host.desk();
    if (desk === null || !desk.pick(torso, _pick)) return -1;
    this.side = _pick.side;
    speed[0] = _pick.speed;
    return _pick.car;
  }

  /** The player pressed the control: asks for what `step` (`exitStarted` or `enterStarted`) wants of car `car`. `begin` to go on at once, `wait` for the host's answer, `refused` (see `refusal`). */
  ask(step: OnFootStep, car: number): "begin" | "wait" | "refused" {
    const desk = this.host.desk();
    if (desk === null) {
      this.side = DRIVER_SIDE;
      this.passenger = false;
      return "begin";
    }
    let result: number;
    if (step === "exitStarted") {
      const seat = desk.mySeat();
      this.side = desk.myExitSide() || seatDoorSide(Math.max(SEAT_DRIVER, seat));
      this.passenger = seat > SEAT_DRIVER;
      result = desk.askOut();
    } else result = desk.askIn(car);
    if (result === ASK.refused) {
      this.refusal = REFUSAL_OF[desk.takeNotice()] ?? "noCarInReach";
      return "refused";
    }
    this.asked = step;
    this.car = car;
    this.askedFor = 0;
    if (result !== ASK.done || !this.answered(desk)) return "wait";
    this.asked = "none";
    return "begin";
  }

  /** Once a frame while he waits for the host: the step to begin once the table says what he asked, `refused` when the host says no (or says nothing for `ASK_WAIT_SECONDS`), else `none`. */
  settle(wallDt: number): OnFootStep {
    const desk = this.host.desk();
    if (this.asked === "none" || desk === null) return "none";
    const notice = desk.takeNotice();
    this.askedFor += wallDt;
    if (notice !== SEATS_NOTICE.none || this.askedFor > ASK_WAIT_SECONDS) {
      this.refusal = REFUSAL_OF[notice] ?? "noCarInReach";
      this.asked = "none";
      return "refused";
    }
    if (!this.answered(desk)) return "none";
    const step = this.asked;
    this.asked = "none";
    return step;
  }

  private answered(desk: OnFootDesk): boolean {
    return this.asked === "exitStarted" ? desk.myCar() < 0 : desk.myCar() === this.car;
  }

  /** Whether he waits for the host. */
  get waiting(): boolean {
    return this.asked !== "none";
  }

  /** Whether the seat he gets in at is a passenger's: read once the table has seated him. */
  seatedAsPassenger(): boolean {
    const desk = this.host.desk();
    return desk !== null && desk.mySeat() > SEAT_DRIVER;
  }

  /** The trip is over or begun anew: nothing waits and the seat is read afresh. */
  reset(): void {
    this.asked = "none";
    this.passenger = false;
    this.key = NOT_SET;
  }

  /**
   * Once a frame while he sits at a seat: when the table moved him (a passenger took the wheel) the seat follows: the wheel is his at the driver's seat, the camera follows the car at any.
   * The first look only learns where he sits.
   */
  follow(): void {
    const desk = this.host.desk();
    if (desk === null) return;
    const car = desk.myCar();
    const key = car < 0 ? -1 : car * MAX_SEATS + desk.mySeat();
    if (this.key !== NOT_SET && key !== this.key && key >= 0) this.take(car, desk.mySeat());
    this.key = key;
  }

  /** The seat follows car `car`, his place in it `seat`: at the driver's he drives it. */
  take(car: number, seat: number): void {
    const { seat: view } = this.host;
    if (seat === SEAT_DRIVER) this.host.adopt(car);
    view.focus(car);
    if (seat === SEAT_DRIVER) view.mode = "drive";
  }
}
