import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FREEWHEEL, launch, makeCar, makeWorld, tickWorld, type CrashWorld } from "../contact/crash-scenarios.test-util.ts";
import { firePiston } from "../scenes/piston-rig.test-util.ts";
import type { PistonId } from "../scenes/piston-rig.ts";
import { DRIVE, type DriveInput, idleDrive } from "./car-drive.ts";
import { layOnGround } from "./car-air-points.ts";
import type { DeformableCar } from "./car.ts";
import { FUEL_CUTOFF_G, STALL_S } from "./constants.ts";
import { DT } from "./test-support.ts";

// docs/UNIFIED_CONTACT.md stage 4, T-bone fuel cut-off: a side hit hard enough to trip the crash sensor cuts the fuel for a few
// seconds and the engine restarts; a head-on hit of the same speed, or a side tap under the sensor, does not. The cut removes the
// gas and the boost only: the tyres, the brakes, the handbrake and the lift-off engine braking run as they do for a running car.

const FULL_GAS: DriveInput = { throttle: 1, steer: 0, brake: 0, ebrake: false, boost: true };
const FULL_BRAKE: DriveInput = { throttle: 0, steer: 0, brake: 1, ebrake: false, boost: false };
const HANDBRAKE_AT_LOCK: DriveInput = { throttle: 0, steer: 1, brake: 0, ebrake: true, boost: false };

function struck(id: PistonId, kph: number) {
  const car = makeCar("shape");
  firePiston(car, id, { speedKph: kph, massKg: 858, hardness: 1, after: 0.3 });
  return car;
}

/** The speed of the t-bone's struck sedan on its +z heading (km/h): the staging of the slide rows. */
const STRUCK_KPH = 60;
/** Seconds after the hit the slide is followed: far past the stop of either. */
const SLIDE_WATCH_S = 4;
/** Seconds the bullet has to meet the struck sedan: a bullet slower than the passing car's window never does. */
const MEET_WITHIN_S = 2;

type Slide = { metres: number; stalledAtHit: number };

/**
 * The metres the struck sedan travels from the first crash flag, rolling in neutral up to the hit and on the zero pedals after it; and the fuel
 * left cut at the slice after the hit's, before the drive counts it down. With `fuelRestored` the cut is cleared before every slice: the same hit on a car whose engine runs.
 */
function slideAfterTBone(bulletKph: number, fuelRestored = false): Slide {
  const struckCar = makeCar("shape");
  const bullet = makeCar("shape");
  launch(struckCar, 0, -(STRUCK_KPH / 3.6) * 0.2, 0, 0, STRUCK_KPH / 3.6);
  launch(bullet, 6, 0, -Math.PI / 2, -bulletKph / 3.6, 0);
  layOnGround(struckCar);
  layOnGround(bullet);
  const world = makeWorld([struckCar, bullet], false, false);
  world.pedals.set(struckCar, FREEWHEEL);
  world.pedals.set(bullet, FREEWHEEL);
  const stepSlice = world.world.beforeSlice!;
  let stalledAtHit = -1;
  world.world.beforeSlice = (slice) => {
    if (stalledAtHit < 0 && struckCar.crashed) stalledAtHit = struckCar.stalledS;
    if (fuelRestored) struckCar.stalledS = 0;
    return stepSlice(slice);
  };
  let metres = 0;
  let waited = 0;
  let since = -1;
  let x = 0;
  let z = 0;
  while (since < SLIDE_WATCH_S) {
    tickWorld(world);
    const at = struckCar.group.position;
    if (since < 0 && struckCar.crashed) {
      since = 0;
      world.pedals.set(struckCar, idleDrive());
    } else if (since >= 0) {
      since += DT * world.clock.timeScale;
      metres += Math.hypot(at.x - x, at.z - z);
    } else assert.ok((waited += DT) < MEET_WITHIN_S, `the ${bulletKph} km/h bullet never met the struck sedan in ${MEET_WITHIN_S} s`);
    x = at.x;
    z = at.z;
  }
  return { metres, stalledAtHit };
}

/** The bullet (km/h) the edge search starts from: the cut-and-running row's hit. */
const SEARCH_FROM_KPH = 55;
/** The widest step (km/h) the search gallops by before it calls the cut stuck. */
const SEARCH_STEP_MAX = 32;

/**
 * The first whole km/h of the bullet that cuts the struck sedan's fuel (`FUEL_CUTOFF_G`) and the slides either side of it: from
 * `SEARCH_FROM_KPH` the search gallops (1, 2, 4 km/h ...) toward the edge until the cut flips, then bisects the last step.
 */
function sensorEdge(): { edge: number; running: Slide; stalled: Slide } {
  let near = slideAfterTBone(SEARCH_FROM_KPH);
  const cuts = near.stalledAtHit > 0;
  const toward = cuts ? -1 : 1;
  let nearKph = SEARCH_FROM_KPH;
  let step = 1;
  let farKph = nearKph + toward;
  let far = slideAfterTBone(farKph);
  while (far.stalledAtHit > 0 === cuts) {
    step *= 2;
    assert.ok(step <= SEARCH_STEP_MAX, `the cut never flipped from ${SEARCH_FROM_KPH} km/h to ${farKph} km/h`);
    [nearKph, near] = [farKph, far];
    farKph = nearKph + toward * step;
    far = slideAfterTBone(farKph);
  }
  let [under, running]: [number, Slide] = cuts ? [farKph, far] : [nearKph, near];
  let [past, stalled]: [number, Slide] = cuts ? [nearKph, near] : [farKph, far];
  while (past - under > 1) {
    const mid = Math.floor((under + past) / 2);
    const slide = slideAfterTBone(mid);
    if (slide.stalledAtHit > 0) [past, stalled] = [mid, slide];
    else [under, running] = [mid, slide];
  }
  return { edge: past, running, stalled };
}

/** An uncrashed sedan rolling on the flat ground at `kph` on its +z heading with `stalledS` seconds of fuel cut, its wheels read. */
function rollingCar(kph: number, stalledS: number): { car: DeformableCar; world: CrashWorld } {
  const car = makeCar("shape");
  launch(car, 0, 0, 0, 0, kph / 3.6);
  layOnGround(car);
  const world = makeWorld([car], false, false, null);
  tickWorld(world);
  car.stalledS = stalledS;
  return { car, world };
}

const alongSpeed = (car: DeformableCar) => car.velocity.x * car.fwdFlat.x + car.velocity.z * car.fwdFlat.z;

/** Holds `pedals` on `car` for `seconds` of frames; the speed it loses along its nose and the world it ran in. */
function speedLostUnder(kph: number, stalledS: number, pedals: DriveInput, seconds: number): number {
  const { car, world } = rollingCar(kph, stalledS);
  world.pedals.set(car, pedals);
  const before = alongSpeed(car);
  for (let t = 0; t < seconds; t += DT) tickWorld(world);
  return before - alongSpeed(car);
}

describe("given a parked car struck by a 858 kg piston", () => {
  it("when it is hit on its side at 50 km/h, then the fuel is cut for the stall time", () => {
    assert.ok(struck("right", 50).stalledS > 0, "the side hit left the engine running");
  });

  it("when it is hit on its side at 8 km/h, below the crash sensor, then the engine keeps running", () => {
    assert.equal(struck("right", 8).stalledS, 0);
  });

  it("when it is hit on its nose at 50 km/h, then the engine keeps running (the cut-off is for side hits)", () => {
    assert.equal(struck("front", 50).stalledS, 0);
  });

  it("when the stall is read against the sensor's own threshold, then 50 km/h on the side is past it and 8 km/h is under it", () => {
    // The crush stroke the hit gets (`crushStroke`, squash 0.32) is affine in its barrier speed: average deceleration = ebs² / (2 · stroke).
    const stroke = (ebs: number) => (0.035 * ebs + 0.02) * (0.6 + 0.32);
    const decel = (kph: number) => (kph / 3.6) ** 2 / (2 * stroke(kph / 3.6)) / 9.81;
    assert.ok(decel(50) > FUEL_CUTOFF_G && decel(8) < FUEL_CUTOFF_G, `${decel(50).toFixed(1)} g and ${decel(8).toFixed(1)} g against ${FUEL_CUTOFF_G} g`);
  });
});

describe("given a sedan rolling on flat ground with its fuel cut", () => {
  it("when the gas and the boost are held, then the pedals it reads are zero and its speed along the nose does not rise", () => {
    const { car, world } = rollingCar(20, STALL_S);
    world.pedals.set(car, FULL_GAS);
    const before = alongSpeed(car);
    let peak = before;
    for (let t = 0; t < STALL_S - 0.5; t += DT) {
      tickWorld(world);
      peak = Math.max(peak, alongSpeed(car));
      assert.equal(car.drive.throttle, 0, "the gas the drive and a clip see");
      assert.equal(car.drive.boost, false, "the boost the drive and a clip see");
    }
    assert.ok(peak <= before + 0.01, `${before.toFixed(2)} -> ${peak.toFixed(2)} m/s under full gas`);
  });

  it("when the same car's fuel is not cut and the gas is held, then it does gain speed (the staging's control)", () => {
    const { car, world } = rollingCar(20, 0);
    world.pedals.set(car, FULL_GAS);
    const before = alongSpeed(car);
    for (let t = 0; t < 1; t += DT) tickWorld(world);
    assert.ok(alongSpeed(car) > before + 1, `${before.toFixed(2)} -> ${alongSpeed(car).toFixed(2)} m/s`);
  });

  it("when the brake pedal is held, then it slows by the brakes' pull, not just the engine's lift-off braking", () => {
    const coast = speedLostUnder(60, STALL_S, idleDrive(), 0.5);
    const braked = speedLostUnder(60, STALL_S, FULL_BRAKE, 0.5);
    assert.ok(coast > 0, "the lift-off engine braking still acts");
    assert.ok(braked > 0.9 * (coast / DRIVE.coast), `braked ${braked.toFixed(2)} m/s vs coasting ${coast.toFixed(2)} m/s, the brake being 1/${DRIVE.coast} of the lift-off pull`);
  });

  it("when the handbrake is pulled at full lock, then it grips and kicks the tail out as it does on a running car", () => {
    const { car, world } = rollingCar(60, STALL_S);
    world.pedals.set(car, HANDBRAKE_AT_LOCK);
    for (let t = 0; t < DRIVE.ebrakeIn * 3; t += DT) tickWorld(world);
    assert.equal(car.drive.ebrakeK, 1, "the handbrake's grip");
    assert.ok(car.drive.drift > 0, `drift ${car.drive.drift.toFixed(2)}`);
  });

  it("when the stall time is out, then the fuel is back: stalledS is 0 and the gas pushes again", () => {
    const { car, world } = rollingCar(20, STALL_S);
    world.pedals.set(car, FULL_GAS);
    for (let t = 0; t < STALL_S + DT; t += DT) tickWorld(world);
    assert.equal(car.stalledS, 0, `still stalled after ${STALL_S} s`);
    const before = alongSpeed(car);
    for (let t = 0; t < 1; t += DT) tickWorld(world);
    assert.ok(car.drive.throttle > 0, "the gas is read again");
    assert.ok(alongSpeed(car) > before + 1, `${before.toFixed(2)} -> ${alongSpeed(car).toFixed(2)} m/s after the restart`);
  });
});

describe("given a sedan t-boned at its door while rolling at 60 km/h, its pedals zero after the hit", () => {
  it("when the bullet is just past the crash sensor, then the engine stalls and the struck car slides no farther than a running one's few metres", () => {
    const { edge, running, stalled } = sensorEdge();
    assert.equal(running.stalledAtHit, 0, `the hit just under the sensor (${edge - 1} km/h) leaves the engine running`);
    assert.equal(stalled.stalledAtHit, STALL_S, `the next km/h (${edge}) cuts the fuel`);
    // The two hits are one km/h apart, so the same tyres on the same slide: a dragged wreck went 4x as far.
    assert.ok(stalled.metres < 1.5 * running.metres, `stalled ${stalled.metres.toFixed(2)} m vs running ${running.metres.toFixed(2)} m`);
  });

  it("when the same 55 km/h hit is run with the fuel cut and with the engine running, then the zero-pedal slide is the same to the millimetre (the cut takes only the gas)", () => {
    const cut = slideAfterTBone(55);
    const running = slideAfterTBone(55, true);
    assert.ok(cut.stalledAtHit > 0, "the hit cuts the fuel");
    assert.ok(Math.abs(cut.metres - running.metres) < 0.001, `cut ${cut.metres.toFixed(3)} m vs running ${running.metres.toFixed(3)} m`);
  });
});
