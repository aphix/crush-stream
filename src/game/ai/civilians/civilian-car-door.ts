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

function smoothstepBetween(from: number, to: number, value: number): number {
  if (value <= from) return 0;
  if (value >= to) return 1;
  const progress = (value - from) / (to - from);
  return progress * progress * (3 - 2 * progress);
}

/** How far the driver's door stands open (0 shut, 1 at `CAR_DOOR.openRad`) `clock` seconds into activity `activity`; 0 for any other activity. Pure in the clock: the host sets the car's door by it, the drawing's hand follows it. */
export function carDoorOpenness(activity: number, clock: number): number {
  const times = activity === ACTIVITY.carIn ? DOOR_TIMES.carIn : activity === ACTIVITY.carOut ? DOOR_TIMES.carOut : null;
  if (times === null) return 0;
  return smoothstepBetween(times.openFrom, times.openTo, clock) * (1 - smoothstepBetween(times.closeFrom, times.closeTo, clock));
}
