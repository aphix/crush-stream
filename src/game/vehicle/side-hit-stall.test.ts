import { describe, expect, it } from "vitest";
import { FREEWHEEL, launch, makeCar, makeWorld, tickWorld, type CrashWorld } from "../contact/crash-scenarios.test-util.ts";
import { firePiston } from "../scenes/piston-rig.test-util.ts";
import { applyDrive, DRIVE, type DriveInput, idleDrive } from "./car-drive.ts";
import { layOnGround } from "./car-air-points.ts";
import type { DeformableCar } from "./car.ts";
import { DT } from "./test-support.ts";

// A side hit leaves the drive whole: the gas, the boost, the brakes and the handbrake answer right after it as before it.

const FULL_GAS: DriveInput = { throttle: 1, steer: 0, brake: 0, ebrake: false, boost: true };
const FULL_BRAKE: DriveInput = { throttle: 0, steer: 0, brake: 1, ebrake: false, boost: false };
const HANDBRAKE_AT_LOCK: DriveInput = { throttle: 0, steer: 1, brake: 0, ebrake: true, boost: false };

/** The speed of the t-bone's struck sedan on its +z heading (km/h). */
const STRUCK_KPH = 60;
/** The bullet's speed (km/h): a hard hit on the struck door. */
const BULLET_KPH = 55;
/** Seconds after the hit the struck sedan's speed is read. */
const AFTER_HIT_S = 1;
/** Seconds the bullet has to meet the struck sedan. */
const MEET_WITHIN_S = 2;

const alongSpeed = (car: DeformableCar) => car.velocity.x * car.fwdFlat.x + car.velocity.z * car.fwdFlat.z;

/** The struck sedan's speed along its nose `AFTER_HIT_S` after the t-bone's first crash flag, rolling in neutral up to the hit and on `after` from it. */
function speedAfterTBone(after: DriveInput): number {
  const struckCar = makeCar("shape");
  const bullet = makeCar("shape");
  launch(struckCar, 0, -(STRUCK_KPH / 3.6) * 0.2, 0, 0, STRUCK_KPH / 3.6);
  launch(bullet, 6, 0, -Math.PI / 2, -BULLET_KPH / 3.6, 0);
  layOnGround(struckCar);
  layOnGround(bullet);
  const world = makeWorld([struckCar, bullet], false, false);
  world.pedals.set(struckCar, FREEWHEEL);
  world.pedals.set(bullet, FREEWHEEL);
  let waited = 0;
  let since = -1;
  while (since < AFTER_HIT_S) {
    tickWorld(world);
    if (since < 0 && struckCar.crashed) {
      since = 0;
      world.pedals.set(struckCar, after);
    } else if (since >= 0) since += DT * world.clock.timeScale;
    else expect((waited += DT), `the bullet never met the struck sedan in ${MEET_WITHIN_S} s`).toBeLessThan(MEET_WITHIN_S);
  }
  return alongSpeed(struckCar);
}

/** An uncrashed sedan rolling on the flat ground at `kph` on its +z heading, its wheels read. */
function rollingCar(kph: number): { car: DeformableCar; world: CrashWorld } {
  const car = makeCar("shape");
  launch(car, 0, 0, 0, 0, kph / 3.6);
  layOnGround(car);
  const world = makeWorld([car], false, false, null);
  tickWorld(world);
  return { car, world };
}

/** Holds `pedals` on a sedan rolling at `kph` for `seconds` of frames: the speed it loses along its nose. */
function speedLostUnder(kph: number, pedals: DriveInput, seconds: number): number {
  const { car, world } = rollingCar(kph);
  world.pedals.set(car, pedals);
  const before = alongSpeed(car);
  for (let t = 0; t < seconds; t += DT) tickWorld(world);
  return before - alongSpeed(car);
}

describe("given a parked car struck on its side at 50 km/h by a 858 kg piston", () => {
  it("when the gas and the boost are pressed right after, then the drive reads them", () => {
    const car = makeCar("shape");
    firePiston(car, "right", { speedKph: 50, massKg: 858, hardness: 1, after: 0.3 });
    applyDrive(car, FULL_GAS, DT);
    expect(car.drive.throttle, "the gas the drive and a clip see").toBe(1);
    expect(car.drive.boost, "the boost the drive and a clip see").toBe(true);
  });
});

describe("given a sedan rolling on flat ground", () => {
  it("when the gas is held, then it gains speed", () => {
    const { car, world } = rollingCar(20);
    world.pedals.set(car, FULL_GAS);
    const before = alongSpeed(car);
    for (let t = 0; t < 1; t += DT) tickWorld(world);
    expect(alongSpeed(car), `${before.toFixed(2)} -> ${alongSpeed(car).toFixed(2)} m/s`).toBeGreaterThan(before + 1);
  });

  it("when the brake pedal is held, then it slows by the brakes' pull, not just the engine's lift-off braking", () => {
    const coast = speedLostUnder(60, idleDrive(), 0.5);
    const braked = speedLostUnder(60, FULL_BRAKE, 0.5);
    expect(coast, "the lift-off engine braking acts").toBeGreaterThan(0);
    expect(braked, `braked ${braked.toFixed(2)} m/s vs coasting ${coast.toFixed(2)} m/s, the brake being 1/${DRIVE.coast} of the lift-off pull`).toBeGreaterThan(0.9 * (coast / DRIVE.coast));
  });

  it("when the handbrake is pulled at full lock, then it grips and kicks the tail out", () => {
    const { car, world } = rollingCar(60);
    world.pedals.set(car, HANDBRAKE_AT_LOCK);
    for (let t = 0; t < DRIVE.ebrakeIn * 3; t += DT) tickWorld(world);
    expect(car.drive.ebrakeK, "the handbrake's grip").toBe(1);
    expect(car.drive.drift, `drift ${car.drive.drift.toFixed(2)}`).toBeGreaterThan(0);
  });
});

describe(`given a sedan t-boned at its door by a ${BULLET_KPH} km/h car while rolling at ${STRUCK_KPH} km/h`, () => {
  it("when the gas is held from the hit on, then a second later it runs faster than the same hit with the gas lifted", () => {
    const gas = speedAfterTBone(FULL_GAS);
    const lifted = speedAfterTBone(idleDrive());
    expect(gas, `${gas.toFixed(2)} m/s on the gas vs ${lifted.toFixed(2)} m/s lifted`).toBeGreaterThan(lifted + 0.5);
  });
});
