import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { applyDrive, DRIVE, idleDrive, type DriveInput } from "./car-drive.ts";
import { DT, paint } from "./test-support.ts";
import { SURFACES } from "../world/catalog.ts";
import { FRICTION_G } from "../deform/physics-util.ts";

/**
 * A thrown-out driver's car freewheels (`DriveInput.neutral`, Main/owner 2026-10-03: "continues in neutral"): no thrust,
 * no lift-off engine braking, only rolling resistance and air drag; ordinary driving is untouched.
 */

const KPH = 1 / 3.6;
const SECS = 2.5;

/** A sedan on the flat doing 130 km/h, driven `SECS` s on `input`: its speed then (m/s). */
function run(input: DriveInput, secs = SECS): { speed: number; car: DeformableCar } {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
  car.spawnFacing(0, 0, 0, 130 * KPH);
  for (let i = 0; i < Math.round(secs / DT); i++) {
    applyDrive(car, input, DT);
    car.integrate(DT);
  }
  return { speed: car.velocity.length(), car };
}

describe("given a sedan doing 130 km/h on the flat, freewheeling in neutral (a thrown-out driver's car) versus lifting off the throttle", () => {
  const v0 = 130 * KPH;
  const lift = run(idleDrive());
  const free = run({ ...idleDrive(), neutral: true });

  it("when it runs 2.5 s with no pedals in neutral, then it sheds far less speed than with the lift-off engine braking (decelerations reported)", (t) => {
    const liftDecel = (v0 - lift.speed) / SECS;
    const freeDecel = (v0 - free.speed) / SECS;
    t.annotate(`130 km/h, ${SECS} s: lift-off ${liftDecel.toFixed(2)} m/s² (${(lift.speed / KPH).toFixed(0)} km/h left), neutral ${freeDecel.toFixed(2)} m/s² (${(free.speed / KPH).toFixed(0)} km/h left)`);
    // Rolling resistance (asphalt's Crr) + air drag alone: about 0.5 m/s² at this speed.
    const roll = SURFACES.asphalt.roll * FRICTION_G;
    expect(freeDecel > 0.3 * (roll + DRIVE.drag * v0 * v0) && freeDecel < 1.5 * (roll + DRIVE.drag * v0 * v0), `neutral sheds ${freeDecel.toFixed(2)} m/s²`).toBeTruthy();
    expect(liftDecel, `lift-off ${liftDecel.toFixed(2)} vs neutral ${freeDecel.toFixed(2)} m/s²`).toBeGreaterThan(5 * freeDecel);
    expect(free.speed, `${(free.speed / KPH).toFixed(0)} km/h left of 130`).toBeGreaterThan(0.9 * v0);
  });

  it("when the driver is thrown out, then the car is in neutral and a car on ordinary input is not", () => {
    expect(free.car.drive.neutral).toBe(true);
    expect(lift.car.drive.neutral).toBe(false);
  });

  it("when the car drives with neutral false or absent from the input, then ordinary driving is bit-identical either way", () => {
    const a = run({ ...idleDrive(), throttle: 0.6, steer: 0.2 });
    const b = run({ ...idleDrive(), throttle: 0.6, steer: 0.2, neutral: false });
    expect(a.speed).toBe(b.speed);
    expect(a.car.group.position.x).toBe(b.car.group.position.x);
    expect(a.car.group.position.z).toBe(b.car.group.position.z);
  });

  it("when a freewheeling car holds the brake, then it still brakes (neutral is only the no-pedals case)", () => {
    const braked = run({ ...idleDrive(), brake: 1, neutral: true }, 1);
    expect(braked.speed, `${(braked.speed / KPH).toFixed(0)} km/h after a second on the brake`).toBeLessThan(0.6 * v0);
  });
});
