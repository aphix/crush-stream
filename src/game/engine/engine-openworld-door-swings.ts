import * as THREE from "three";
import { hypot2 } from "../kernel/physics-core.js";
import type { DeformableCar } from "../vehicle/car.ts";
import { MAX_ACTORS } from "../scenes/seat-table.ts";
import { ENTER_SECONDS } from "../present/onfoot-flow.ts";
import type { ActorPlace } from "./engine-openworld-acts.ts";
import { doorSpot } from "./onfoot-doors.ts";

/** A door swings this wide (rad) at this rate (rad/s) as a player gets in or out, and shuts once he is this far (m) from it. */
const DOOR_OPEN = 1.1;
const DOOR_RATE = 3.5;
const DOOR_CLOSE_DISTANCE = 4;
/** A door he climbed in through shuts this long (s) after he started: his climb, and a moment. */
const IN_HOLD_S = ENTER_SECONDS + 0.2;
/** A door he left by shuts after this long (s) when his place is not known here. */
const OUT_HOLD_S = 8;
const NO_CAR = -1;

const _spot = new THREE.Vector3();
const _place: ActorPlace = { x: 0, y: 0, z: 0, heading: 0 };

/** What the swings need of the engine. */
type SwingPorts = {
  cars(): readonly DeformableCar[];
  /** Where actor `actor` stands on foot, into `out`; false when he is not on foot. */
  place(actor: number, out: ActorPlace): boolean;
  /** Actor `actor` sits in a car: a door he left by shuts. */
  seated(actor: number): boolean;
};

/**
 * The doors of cars players get in and out by, at the machine that runs the cars: each player's own swing opens his door as he starts through it and shuts it once he has
 * climbed in or walked away, by `setDoorOpen` as a resident's door does. The hinge physics are not touched, and a guest sees the door in the host's snapshots.
 */
export class DoorSwings {
  private readonly ports: SwingPorts;
  private readonly car = new Int16Array(MAX_ACTORS).fill(NO_CAR);
  private readonly side = new Int8Array(MAX_ACTORS);
  private readonly leaving = new Uint8Array(MAX_ACTORS);
  private readonly angle = new Float64Array(MAX_ACTORS);
  private readonly target = new Float64Array(MAX_ACTORS);
  private readonly held = new Float64Array(MAX_ACTORS);

  constructor(ports: SwingPorts) {
    this.ports = ports;
  }

  /** Actor `actor` starts through the door at x sign `side` of car `car`, getting `leaving` out or in: it swings open from wherever it stands. */
  open(actor: number, car: number, side: number, leaving: boolean): void {
    const cars = this.ports.cars();
    const old = this.car[actor]!;
    if (old !== NO_CAR && (old !== car || this.side[actor] !== side)) cars[old]?.setDoorOpen(this.side[actor]!, 0);
    this.car[actor] = car;
    this.side[actor] = side;
    this.leaving[actor] = leaving ? 1 : 0;
    this.angle[actor] = Math.abs(cars[car]?.doorAngle(side) ?? 0);
    this.target[actor] = DOOR_OPEN;
    this.held[actor] = 0;
  }

  /** Actor `actor`'s trip is over: his door is sent shut from wherever it stands (it is never opened further). */
  release(actor: number): void {
    if (this.car[actor] !== NO_CAR) this.target[actor] = 0;
  }

  /** Every swing is forgotten: the open world was left, and the next session's cars are not this one's. */
  clear(): void {
    this.car.fill(NO_CAR);
  }

  /** Once a frame: each door eases to where it is going. */
  frame(wallDt: number): void {
    const cars = this.ports.cars();
    for (let actor = 0; actor < MAX_ACTORS; actor++) {
      const index = this.car[actor]!;
      if (index === NO_CAR) continue;
      const car = cars[index];
      if (car === undefined) {
        this.car[actor] = NO_CAR;
        continue;
      }
      const side = this.side[actor]!;
      if (this.target[actor]! > 0) {
        this.held[actor] = this.held[actor]! + wallDt;
        if (this.shouldShut(actor, car, side)) this.target[actor] = 0;
      }
      // A door the crash or a reset moved is eased from where it stands, not from where this swing last left it.
      if (this.target[actor] === 0) this.angle[actor] = Math.min(this.angle[actor]!, Math.abs(car.doorAngle(side)));
      const gap = this.target[actor]! - this.angle[actor]!;
      if (gap !== 0) {
        this.angle[actor] = this.angle[actor]! + Math.max(-DOOR_RATE * wallDt, Math.min(DOOR_RATE * wallDt, gap));
        car.setDoorOpen(side, this.angle[actor]!);
      }
      if (this.target[actor] === 0 && this.angle[actor] === 0) this.car[actor] = NO_CAR;
    }
  }

  private shouldShut(actor: number, car: DeformableCar, side: number): boolean {
    if (this.leaving[actor] === 0) return this.held[actor]! >= IN_HOLD_S;
    if (this.ports.seated(actor)) return true;
    if (!this.ports.place(actor, _place)) return this.held[actor]! >= OUT_HOLD_S;
    doorSpot(car, _spot, side);
    return hypot2(_spot.x - _place.x, _spot.z - _place.z) > DOOR_CLOSE_DISTANCE;
  }
}
