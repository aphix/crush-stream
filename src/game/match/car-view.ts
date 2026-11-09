import type { DeformableCar } from "../vehicle/car.ts";
import { carGear, carRpm } from "../vehicle/vehicle-classes.ts";
import { KPH_PER_MS } from "../kernel/constants.ts";
import { quantize } from "../kernel/scalar.ts";
import type { DriftView } from "../vehicle/car-drive.ts";
import type { RaceView } from "./types.ts";

/**
 * Damage arc 0-1 (1 = untouched): the weaker of the two things that stop a car, the engine block (`drivetrainHealth`:
 * its crush travel against the travel that kills it, 0 once dead) and the wheels still on (a quarter each). One scalar the
 * driver can read at a glance; a car that has lost two wheels reads at most half, whatever its engine says.
 */
function carDamage(car: DeformableCar): number {
  const d = car.deform;
  return Math.min(d.drivetrainHealth, d.wheelsOn / 4);
}

/**
 * The resolutions a gauge is published at, finer than its display can show (the speed digits are whole km/h or mph; the dial's needle, the damage arc, the nitro bar and its glow move a pixel or so in a step), so the HUD
 * changes, and React renders, only when something on screen does, not on every float the sim writes.
 */
const SPEED_STEP_KPH = 1;
const DIAL_STEP = 0.01;
const BOOSTING_STEP = 0.05;
const DRIFT_SECONDS_STEP = 0.05;

/** A cue or a hold (0-1) at the resolution a bar shows. */
export function gaugeLevel(level: number): number {
  return quantize(level, DIAL_STEP);
}

/** A boost meter (0-1) at the same; null (no meter) stays null. */
export function gaugeMeter(meter: number | null): number | null {
  return meter === null ? null : gaugeLevel(meter);
}

/** A slide's read-out at the resolution it is shown at: its seconds (the pay shown is whole per cent of them), the pay it has made. */
export function gaugeDrift(drift: DriftView): DriftView {
  return { s: quantize(drift.s, DRIFT_SECONDS_STEP), clean: drift.clean, paid: quantize(drift.paid, DIAL_STEP) };
}

/** The gauge fields of a `RaceView` that come straight off the car: speed, gear, revs, damage, wheels, boost burn. */
export function carGauge(car: DeformableCar): Pick<RaceView, "speedKph" | "gear" | "rpm" | "damage" | "wheelsOff" | "boosting"> {
  return {
    speedKph: quantize(car.velocity.length() * KPH_PER_MS, SPEED_STEP_KPH),
    gear: carGear(car),
    rpm: quantize(carRpm(car), DIAL_STEP),
    damage: quantize(carDamage(car), DIAL_STEP),
    wheelsOff: 4 - car.deform.wheelsOn,
    boosting: quantize(car.drive.boostK, BOOSTING_STEP),
  };
}
