import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { idleDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { blankAiCar, type AiCar } from "./derby-ai.ts";
import { assertSameNumbers } from "../vehicle/test-support.ts";
import { GUARD_BRAKE_IDX, GUARD_COUNT, GUARD_DT_IDX, GUARD_GRIP_IDX, GUARD_LEAD_IDX, GUARD_TURN_IDX } from "./constants.ts";
import { guardContact } from "./contact-guard.ts";
import { QUIET_HZ } from "../kernel/constants.ts";

/** A car at (`x`, `z`) doing `speed` m/s along +z (`dir` 1) or −z (−1). */
function car(id: number, x: number, z: number, speed: number, dir: 1 | -1 = 1): AiCar {
  return { ...blankAiCar(id), x, z, yaw: dir === 1 ? 0 : Math.PI, vz: speed * dir };
}

/** What the guard makes of the plan "full throttle" for `self` among `others` (class brake 20 m/s², lead brake 11 m/s², lock 1.5 rad/s), the hands at `hands` of lock on the driver's ask of `asked`. */
function guarded(self: AiCar, others: AiCar[], spare = new Uint8Array(32), hands = 0, asked = hands): DriveInput {
  const out: DriveInput = { ...idleDrive(), throttle: 1, steer: hands };
  const tune = new Float64Array(GUARD_COUNT);
  tune[GUARD_BRAKE_IDX] = 20;
  tune[GUARD_LEAD_IDX] = 11;
  tune[GUARD_TURN_IDX] = 1.5;
  guardContact(self, [self, ...others], others.length + 1, spare, tune, out, asked);
  return out;
}

/** The plan's three pedals as `guarded` hands them back. */
const pedals = (out: DriveInput) => [out.throttle, out.brake, out.steer];

describe("given a driver planning full throttle straight on at 30 m/s, with the contact guard (the AI's last-moment collision avoidance) checking that plan", () => {
  const me = car(0, 0, 0, 30);

  it("when another car comes head-on at 30 m/s, then at 70 m it steers clear without braking, at 40 m it brakes instead, and at 300 m (out of the time it looks ahead) it leaves the plan alone", () => {
    const clear = guarded(me, [car(1, 0, 70, 30, -1)]);
    assert.ok(Math.abs(clear.steer) > 0.1 && clear.brake === 0, `70 m off: steer ${clear.steer.toFixed(2)}, brake ${clear.brake.toFixed(2)}`);
    const close = guarded(me, [car(1, 0, 40, 30, -1)]);
    assert.ok(close.throttle < 0.2 && close.brake > 0.5, `40 m off: throttle ${close.throttle.toFixed(2)}, brake ${close.brake.toFixed(2)}`);
    assert.deepEqual(pedals(guarded(me, [car(1, 0, 300, 30, -1)])), [1, 0, 0], "300 m off, closing at 60 m/s: 90 m in the time looked ahead");
  });

  it("when a stopped car is 47 m or 60 m dead ahead, then the guard steers away from the one at 47 m (the reach of its zone about 1.5 s ahead) and leaves the plan alone for the one at 60 m", () => {
    const met = guarded(me, [car(1, 0, 47, 0)]);
    assert.ok(met.steer !== 0, `47 m: steer ${met.steer}`);
    assert.deepEqual(pedals(guarded(me, [car(1, 0, 60, 0)])), [1, 0, 0], "60 m: out of the zone through the time ahead");
  });

  it("when cars far out of reach are added around a car it is about to meet, then the pedals and steering stay exactly what they were with that car alone", () => {
    const meets = car(1, 0.8, 40, 30, -1);
    const alone = guarded(me, [meets]);
    assert.ok(alone.brake > 0.5, `the car in reach is braked for: ${alone.brake.toFixed(2)}`);
    const withFar = guarded(me, [car(2, -40, 500, 10, -1), meets, car(3, 30, -400, 25)]);
    assertSameNumbers(pedals(withFar), pedals(alone), "pedals with cars out of reach about");
  });

  it("when the car coming head-on at 40 m is one the driver means to hit, then the guard leaves the plan alone", () => {
    const spare = new Uint8Array(32);
    spare[1] = 1;
    assert.deepEqual(pedals(guarded(me, [car(1, 0, 40, 30, -1)], spare)), [1, 0, 0]);
  });
});

describe("given a driver at 18 m/s asking 0.4 of lock toward a car 10 m ahead and 6 m to that side that crosses its path at 8 m/s, its hands still at 0.3 (`InputFade` lags the ask)", () => {
  const me = car(0, 0, 0, 18);
  const crossing: AiCar = { ...blankAiCar(1), x: 6, z: 10, yaw: -Math.PI / 2, vx: -8 };
  it("when the guard checks the hands' input, then it brakes for the crossing car as it does with the hands caught up on the ask, where the arc of the hands' 0.3 alone finds nothing to brake for", () => {
    const caughtUp = guarded(me, [crossing], undefined, 0.4);
    assert.ok(caughtUp.brake > 0.5, `hands at the ask: brake ${caughtUp.brake.toFixed(2)}`);
    const lagging = guarded(me, [crossing], undefined, 0.3, 0.4);
    assert.ok(lagging.brake > 0.5 && lagging.throttle === 0, `hands at 0.3 on an ask of 0.4: brake ${lagging.brake.toFixed(2)}, throttle ${lagging.throttle.toFixed(2)}`);
    assert.equal(guarded(me, [crossing], undefined, 0.3).brake, 0, "an ask of 0.3 steers clear of it");
  });
});

describe("given a driver at 20 m/s straight on, with a stopped car 12 m ahead and 2.9 m to one side", () => {
  const me = car(0, 0, 0, 20);
  const beside = (yaw: number): AiCar => ({ ...blankAiCar(1), x: 2.9, z: 12, yaw });
  it("when it lies across the way (60° off), its end pokes into the path, so the guard brakes; lying along it (a parallel car) leaves the plan alone", () => {
    const across = guarded(me, [beside(Math.PI / 3)]);
    assert.ok(across.brake > 0.5 && across.throttle === 0, `across: brake ${across.brake.toFixed(2)}, throttle ${across.throttle.toFixed(2)}`);
    assert.equal(guarded(me, [beside(0)]).brake, 0, "along");
  });
});

describe("given a driver at 25 m/s with 0.6 of lock on, and a stopped car 18 m ahead and 2 m to the side it turns toward", () => {
  const me = car(0, 0, 0, 25);
  const stopped: AiCar = { ...blankAiCar(1), x: 2, z: 18 };
  const brakeWith = (grip: number): number => {
    const out: DriveInput = { ...idleDrive(), throttle: 1, steer: 0.6 };
    const tune = new Float64Array(GUARD_COUNT);
    tune[GUARD_BRAKE_IDX] = 20;
    tune[GUARD_LEAD_IDX] = 11;
    tune[GUARD_TURN_IDX] = 1.5;
    tune[GUARD_GRIP_IDX] = grip;
    guardContact(me, [me, stopped], 2, new Uint8Array(32), tune, out);
    return out.brake;
  };
  it("when the arc of its lock is read at the full 0.9 rad/s, then it swings clear of the stopped car; held to the yaw rate its tyres give (10 grip: 0.42 rad/s) it does not, and the guard brakes", () => {
    assert.equal(brakeWith(0), 0, "uncapped arc");
    assert.ok(brakeWith(10) > 0.5, `capped arc: brake ${brakeWith(10).toFixed(2)}`);
  });
});

describe("given the contact guard called every step for one car (its held push and braking demand kept in the tune buffer), a stopped car dead ahead that is then taken away", () => {
  const STEP = 1 / QUIET_HZ;
  const me = car(0, 0, 0, 30);
  function tuned(): Float64Array {
    const tune = new Float64Array(GUARD_COUNT);
    tune[GUARD_BRAKE_IDX] = 20;
    tune[GUARD_LEAD_IDX] = 11;
    tune[GUARD_TURN_IDX] = 1.5;
    return tune;
  }
  /** One call of `dt` s on the plan "full throttle, straight on" with the cars `others`. */
  function call(tune: Float64Array, others: AiCar[], dt: number): DriveInput {
    tune[GUARD_DT_IDX] = dt;
    const out: DriveInput = { ...idleDrive(), throttle: 1 };
    guardContact(me, [me, ...others], others.length + 1, new Uint8Array(32), tune, out);
    return out;
  }
  /** A call every step for `seconds` with `others`; the last call's output. */
  function run(tune: Float64Array, others: AiCar[], seconds: number): DriveInput {
    let out = call(tune, others, STEP);
    for (let t = STEP; t < seconds; t += STEP) out = call(tune, others, STEP);
    return out;
  }
  /** Close enough that the guard brakes (it cannot steer clear in time), and far enough that it steers clear instead. */
  const BRAKE_FOR = car(1, 0, 22, 0);
  const STEER_FROM = car(1, 0, 47, 0);
  const CLEAR: AiCar[] = [];

  it("when the car it steers away from goes out of reach, then its steer push is still on 0.1 s later and gone within 2 s", () => {
    const tune = tuned();
    const on = run(tune, [STEER_FROM], 0.5);
    assert.ok(Math.abs(on.steer) > 0.03 && on.brake === 0, `contact: steer ${on.steer.toFixed(2)}, brake ${on.brake.toFixed(2)}`);
    const soon = run(tune, CLEAR, 0.1);
    assert.ok(Math.abs(soon.steer) > 0.02, `0.1 s after the contact: steer ${soon.steer.toFixed(3)}`);
    const later = run(tune, CLEAR, 2);
    assert.ok(later.steer === 0, `2 s after: steer ${later.steer}`);
  });

  it("when the car it brakes for goes out of reach, then the brake is still on 0.1 s later and off within a second", () => {
    const tune = tuned();
    const on = run(tune, [BRAKE_FOR], 0.5);
    assert.ok(on.brake > 0.5, `contact: brake ${on.brake.toFixed(2)}`);
    const soon = run(tune, CLEAR, 0.1);
    assert.ok(soon.brake > 0.2, `0.1 s after: brake ${soon.brake.toFixed(2)}`);
    const later = run(tune, CLEAR, 1);
    assert.ok(later.brake === 0 && later.throttle > 0.9, `1 s after: brake ${later.brake}, throttle ${later.throttle}`);
  });

  it("when a call with no step (dt 0, a one-off) comes after the contact, then it holds nothing: the plan comes back as it was", () => {
    const tune = tuned();
    run(tune, [STEER_FROM], 0.5);
    const once = call(tune, CLEAR, 0);
    assert.deepEqual(pedals(once), [1, 0, 0]);
  });

  it("when the stopped car ahead reads 0.3 m left of the path's centre on one step and 0.3 m right on the next (the look-ahead's jitter at speed), then the push keeps the side it took: the wheel never swings back across", () => {
    const tune = tuned();
    const left = car(1, 0.3, 47, 0);
    const right = car(1, -0.3, 47, 0);
    let out = call(tune, [left], STEP);
    let across = 0;
    for (let s = 1; s < 0.5 * QUIET_HZ; s++) {
      out = call(tune, [s % 2 === 0 ? left : right], STEP);
      if (out.steer > 0) across++;
    }
    assert.equal(across, 0, "steps the wheel was pushed toward the car it steers from");
    assert.ok(out.steer < -0.03, `after 0.5 s: steer ${out.steer.toFixed(3)}`);
  });

  it("when it has steered clear of a stopped car 0.3 m left of centre and then brakes for a car 0.3 m right of centre 20 m ahead at 15 m/s, then the push turns away from the one it brakes for instead of keeping its side toward it", () => {
    const tune = tuned();
    run(tune, [car(1, 0.3, 47, 0)], 0.3);
    const braked = run(tune, [car(1, -0.3, 20, 15)], 0.3);
    assert.ok(braked.brake > 0.5 && braked.steer > 0, `braking: brake ${braked.brake.toFixed(2)}, steer ${braked.steer.toFixed(4)}`);
  });
});
