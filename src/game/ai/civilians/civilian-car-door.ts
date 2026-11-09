import { detCos, detSin } from "../../kernel/physics-core.js";
import { DRIVER_SIDE } from "../../vehicle/constants.ts";
import { ACTIVITY } from "./civilian-activity.ts";

/**
 * Getting into or out of a car by the driver's door (`DRIVER_SIDE`). Car space, all metres from the seat's H-point (`BodyStyle.seats.front`):
 * `across` outward on the driver's side, `along` toward the front. The person stands on the door spot, `outFromSeat` out and `behindSeat`
 * back from the H-point, her root (the feet's middle) on the ground, facing the car: car yaw less `DRIVER_SIDE` quarter turns.
 * Her seat top is `surfaceY` = the H-point's world height less `CAR_DOOR.hipOverSeat`.
 */
export const CAR_DOOR = {
  outFromSeat: 1.05,
  behindSeat: 0.4,
  /** The door's front edge on the body side, which it swings about, `openRad` at full open. */
  hinge: { across: 0.54, along: 0.45 },
  openRad: 0.8,
  /** The outer handle and the middle of the outer panel (their `up` over the ground), the inner handle (`aboveSeat` over the seat top). */
  outsideHandle: { across: 0.57, along: -0.4, up: 0.98 },
  outsidePanel: { across: 0.56, along: 0.03, up: 0.9 },
  insideHandle: { across: 0.42, along: -0.3, aboveSeat: 0.3 },
  /** A seated person's feet: ahead of her hips, and up from the ground to the cabin floor. */
  footAhead: 0.62,
  floorRise: 0.12,
  /** The hip joint stands this far over the seat top (a thigh's half thickness). */
  hipOverSeat: 0.075,
} as const;

/** Seconds into the clip (`ACTIVITY.carIn`, `ACTIVITY.carOut`) the door starts and stops opening, and starts and stops closing. */
const DOOR_TIMES = {
  carIn: { openFrom: 0.3, openTo: 1, closeFrom: 1.8, closeTo: 2.6 },
  carOut: { openFrom: 0.2, openTo: 0.75, closeFrom: 1.55, closeTo: 2.3 },
} as const;

/** The door spot a car at (`carX`, `carZ`) facing `carYaw` on ground `groundY` gives a person: world x and z, her yaw, her feet's height and her seat top's. */
export type DoorSpot = { x: number; z: number; yaw: number; feetY: number; surfaceY: number };

/** Into `out`: the door spot of a car (`seatFront` = its `BodyStyle.seats.front`: the H-point's across, up and along). Pure, so every peer fills the same spot. */
export function carDoorSpot(carX: number, carZ: number, carYaw: number, groundY: number, seatFront: readonly [number, number, number], out: DoorSpot): void {
  const across = DRIVER_SIDE * (seatFront[0] + CAR_DOOR.outFromSeat);
  const along = seatFront[2] - CAR_DOOR.behindSeat;
  const sine = detSin(carYaw);
  const cosine = detCos(carYaw);
  out.x = carX + across * cosine + along * sine;
  out.z = carZ - across * sine + along * cosine;
  out.yaw = carYaw - DRIVER_SIDE * (Math.PI / 2);
  out.feetY = groundY;
  out.surfaceY = groundY + seatFront[1] - CAR_DOOR.hipOverSeat;
}

/** What the door's openness reads of a civilian's pose: her activity and the seconds into it. */
type DoorClock = { activity: number; clock: number };

/**
 * `out[at]` = how far the driver's door stands open (0 shut, 1 at `CAR_DOOR.openRad`) `pose.clock` seconds into activity `pose.activity`; 0 for any other activity. Pure in the clock. It takes the pose and an
 * output slot, not numbers, so the drawing's frame, which asks it for every civilian at a car, allocates nothing.
 */
export function carDoorOpennessOf(pose: DoorClock, out: Float64Array, at: number): void {
  const times = pose.activity === ACTIVITY.carIn ? DOOR_TIMES.carIn : pose.activity === ACTIVITY.carOut ? DOOR_TIMES.carOut : null;
  if (times === null) {
    out[at] = 0;
    return;
  }
  const opening = Math.min(1, Math.max(0, (pose.clock - times.openFrom) / (times.openTo - times.openFrom)));
  const closing = Math.min(1, Math.max(0, (pose.clock - times.closeFrom) / (times.closeTo - times.closeFrom)));
  out[at] = opening * opening * (3 - 2 * opening) * (1 - closing * closing * (3 - 2 * closing));
}

const askedClock: DoorClock = { activity: 0, clock: 0 };
const asked = new Float64Array(1);

/** `carDoorOpennessOf` for a host that has the activity and the clock as numbers: the door it sets a car's by. */
export function carDoorOpenness(activity: number, clock: number): number {
  askedClock.activity = activity;
  askedClock.clock = clock;
  carDoorOpennessOf(askedClock, asked, 0);
  return asked[0]!;
}
