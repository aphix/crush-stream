import { describe, expect, it } from "vitest";
import { idleDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { blankAiCar, type AiCar } from "./derby-ai.ts";
import { assertSameNumbers } from "../vehicle/test-support.ts";
import { AI_SKILL, GUARD_BRAKE_IDX, GUARD_CONTEST_IDX, GUARD_COUNT, GUARD_DT_IDX, GUARD_GRIP_IDX, GUARD_LEAD_IDX, GUARD_RISK_IDX, GUARD_RIVALS_IDX, GUARD_TURN_IDX } from "./constants.ts";
import { guardContact } from "./contact-guard.ts";
import { QUIET_HZ } from "../kernel/constants.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { ARM_CLOSING } from "../contact/constants.ts";

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
    expect(Math.abs(clear.steer) > 0.1 && clear.brake === 0, `70 m off: steer ${clear.steer.toFixed(2)}, brake ${clear.brake.toFixed(2)}`).toBeTruthy();
    const close = guarded(me, [car(1, 0, 40, 30, -1)]);
    expect(close.throttle < 0.2 && close.brake > 0.5, `40 m off: throttle ${close.throttle.toFixed(2)}, brake ${close.brake.toFixed(2)}`).toBeTruthy();
    expect(firstMismatch(pedals(guarded(me, [car(1, 0, 300, 30, -1)])), [1, 0, 0]), "300 m off, closing at 60 m/s: 90 m in the time looked ahead").toBeUndefined();
  });

  it("when a stopped car is 47 m or 60 m dead ahead, then the guard steers away from the one at 47 m (the reach of its zone about 1.5 s ahead) and leaves the plan alone for the one at 60 m", () => {
    const met = guarded(me, [car(1, 0, 47, 0)]);
    expect(met.steer, `47 m: steer ${met.steer}`).not.toBe(0);
    expect(firstMismatch(pedals(guarded(me, [car(1, 0, 60, 0)])), [1, 0, 0]), "60 m: out of the zone through the time ahead").toBeUndefined();
  });

  it("when cars far out of reach are added around a car it is about to meet, then the pedals and steering stay exactly what they were with that car alone", () => {
    const meets = car(1, 0.8, 40, 30, -1);
    const alone = guarded(me, [meets]);
    expect(alone.brake, `the car in reach is braked for: ${alone.brake.toFixed(2)}`).toBeGreaterThan(0.5);
    const withFar = guarded(me, [car(2, -40, 500, 10, -1), meets, car(3, 30, -400, 25)]);
    assertSameNumbers(pedals(withFar), pedals(alone), "pedals with cars out of reach about");
  });

  it("when the car coming head-on at 40 m is one the driver means to hit, then the guard leaves the plan alone", () => {
    const spare = new Uint8Array(32);
    spare[1] = 1;
    expect(firstMismatch(pedals(guarded(me, [car(1, 0, 40, 30, -1)], spare)), [1, 0, 0])).toBeUndefined();
  });
});

describe("given a driver at 18 m/s asking 0.4 of lock toward a car 10 m ahead and 6 m to that side that crosses its path at 8 m/s, its hands still at 0.3 (its hands lag the ask)", () => {
  const me = car(0, 0, 0, 18);
  const crossing: AiCar = { ...blankAiCar(1), x: 6, z: 10, yaw: -Math.PI / 2, vx: -8 };
  it("when the guard checks the hands' input, then it brakes for the crossing car as it does with the hands caught up on the ask, where the arc of the hands' 0.3 alone finds nothing to brake for", () => {
    const caughtUp = guarded(me, [crossing], undefined, 0.4);
    expect(caughtUp.brake, `hands at the ask: brake ${caughtUp.brake.toFixed(2)}`).toBeGreaterThan(0.5);
    const lagging = guarded(me, [crossing], undefined, 0.3, 0.4);
    expect(lagging.brake > 0.5 && lagging.throttle === 0, `hands at 0.3 on an ask of 0.4: brake ${lagging.brake.toFixed(2)}, throttle ${lagging.throttle.toFixed(2)}`).toBeTruthy();
    expect(guarded(me, [crossing], undefined, 0.3).brake, "an ask of 0.3 steers clear of it").toBe(0);
  });
});

describe("given a racer at 25 m/s planning full throttle at a crossing 20 m ahead (0.8 s), a rival crossing its way there at a right angle", () => {
  const me = car(0, 0, 0, 25);
  /** A rival `x` m short of the crossing, doing `speed` m/s across the racer's way. */
  const rival = (x: number, speed: number): AiCar => ({ ...blankAiCar(1), x, z: 20, yaw: -Math.PI / 2, vx: -speed });
  /** The guard's take on the plan for the racer at will to win `risk` (0 leading … 1 last) whose difficulty lets it contest a crossing it reaches up to `contest` s after the rival (at the back of the field), both cars racers. */
  const atPlace = (risk: number, contest: number, o: AiCar): DriveInput => {
    const out: DriveInput = { ...idleDrive(), throttle: 1 };
    const tune = new Float64Array(GUARD_COUNT);
    tune[GUARD_BRAKE_IDX] = 20;
    tune[GUARD_LEAD_IDX] = 11;
    tune[GUARD_TURN_IDX] = 1.5;
    tune[GUARD_RISK_IDX] = risk;
    tune[GUARD_RIVALS_IDX] = 2;
    tune[GUARD_CONTEST_IDX] = contest * risk;
    guardContact(me, [me, o], 2, new Uint8Array(32), tune, out);
    return out;
  };
  /** Whether the guard changed the plan (braked, or steered clear): the car gave way. */
  const givesWay = (out: DriveInput): boolean => firstMismatch(pedals(out), [1, 0, 0]) !== undefined;
  const cases = [
    { it: "when both reach it together (the rival 20 m off at 25 m/s), then last place at medium holds its plan (it contests the crossing), where last place at hard gives way as the leader does", o: rival(20, 25), mediumGoes: true, mediumRisk: 1 },
    { it: "when the racer gets there first by a hair (the rival 22 m off at 25 m/s, 0.08 s behind), then last place at medium holds its plan, where at hard (not clearly first) it gives way as the leader does", o: rival(22, 25), mediumGoes: true, mediumRisk: 1 },
    { it: "when the rival gets there 0.32 s first (12 m off at 25 m/s), then last place at medium still goes for it (it misjudges), where at hard it gives way as the leader does", o: rival(12, 25), mediumGoes: true, mediumRisk: 1 },
    { it: "when the rival clearly gets there first (1 m off at 8 m/s, 0.68 s before the racer), then a medium car in the front half of the field (0.4 of the will to win) gives way exactly as the leader does, as last place at hard does", o: rival(1, 8), mediumGoes: false, mediumRisk: 0.4 },
    { it: "when the rival crawls across (1 m off at 3 m/s: backing out or turning round, not racing), then last place at medium gives way exactly as the leader does", o: rival(1, 3), mediumGoes: false, mediumRisk: 1 },
    {
      it: "when the rival comes in only 45° off (a car sweeping round a corner beside it, not crossing), reaching the point together, then last place at medium gives way exactly as the leader does",
      o: { ...blankAiCar(1), x: 20 * Math.SQRT1_2, z: 20 + 20 * Math.SQRT1_2, yaw: (-3 * Math.PI) / 4, vx: -25 * Math.SQRT1_2, vz: -25 * Math.SQRT1_2 },
      mediumGoes: false,
      mediumRisk: 1,
    },
  ];
  for (const testCase of cases) {
    it(testCase.it, () => {
      const lead = atPlace(0, 0, testCase.o);
      expect(givesWay(lead), `the leader: ${pedals(lead).join(", ")}`).toBeTruthy();
      assertSameNumbers(pedals(atPlace(1, AI_SKILL.hard.contest[1], testCase.o)), pedals(lead), "hard against the leader");
      // Every medium car's roll: the least window for a car that goes, the most for one that gives way.
      const medium = atPlace(testCase.mediumRisk, AI_SKILL.medium.contest[testCase.mediumGoes ? 0 : 1], testCase.o);
      if (testCase.mediumGoes) expect(givesWay(medium), `medium: ${pedals(medium).join(", ")}`).toBeFalsy();
      else assertSameNumbers(pedals(medium), pedals(lead), "medium against the leader");
    });
  }
});

describe("given a driver at 20 m/s straight on, with a stopped car 12 m ahead and 2.9 m to one side", () => {
  const me = car(0, 0, 0, 20);
  const beside = (yaw: number): AiCar => ({ ...blankAiCar(1), x: 2.9, z: 12, yaw });
  it("when it lies across the way (60° off), its end pokes into the path, so the guard brakes; lying along it (a parallel car) leaves the plan alone", () => {
    const across = guarded(me, [beside(Math.PI / 3)]);
    expect(across.brake > 0.5 && across.throttle === 0, `across: brake ${across.brake.toFixed(2)}, throttle ${across.throttle.toFixed(2)}`).toBeTruthy();
    expect(guarded(me, [beside(0)]).brake, "along").toBe(0);
  });
});

describe("given a racer planning full throttle with a stopped rival racer in its way (a racer is a car of the first `GUARD_RIVALS_IDX`)", () => {
  /** The guard's take on the plan for `self` with `other` (car 1 of 2) among `rivals` racers (0: `other` is traffic). */
  const racerGuard = (self: AiCar, other: AiCar, rivals: number): DriveInput => {
    const out: DriveInput = { ...idleDrive(), throttle: 1 };
    const tune = new Float64Array(GUARD_COUNT);
    tune[GUARD_BRAKE_IDX] = 20;
    tune[GUARD_LEAD_IDX] = 11;
    tune[GUARD_TURN_IDX] = 1.5;
    tune[GUARD_RIVALS_IDX] = rivals;
    guardContact(self, [self, other], 2, new Uint8Array(32), tune, out);
    return out;
  };
  const me = car(0, 0, 0, 20);
  it("when the rival is stopped 12 m ahead at 20 m/s, then the guard does not brake for it (it is passed round at speed), where it brakes for the same stopped car as traffic", () => {
    const racer = racerGuard(me, car(1, 0, 12, 0), 2);
    expect(racer.brake === 0 && racer.throttle === 1, `racer ahead: brake ${racer.brake.toFixed(2)}, throttle ${racer.throttle.toFixed(2)}`).toBeTruthy();
    const traffic = racerGuard(me, car(1, 0, 12, 0), 0);
    expect(traffic.brake > 0.5 && traffic.throttle === 0, `traffic ahead: brake ${traffic.brake.toFixed(2)}, throttle ${traffic.throttle.toFixed(2)}`).toBeTruthy();
  });
  it("when the rival crawls 3 m/s the same way (CRAWL: no longer stopped), then the guard brakes for it", () => {
    const crawling = racerGuard(me, car(1, 0, 12, 3), 2);
    expect(crawling.brake, `brake ${crawling.brake.toFixed(2)}`).toBeGreaterThan(0.5);
  });
  it("when the racer itself is at 2.9 m/s or 3.5 m/s, then the stopped rival is driven round either way: the plan stands, gas on and no brake (owner: route round anything that holds you back and slam the gas)", () => {
    for (const v of [2.9, 3.5]) {
      const out = racerGuard(car(0, 0, 0, v), car(1, 0, 6.3, 0), 2);
      expect(out.throttle === 1 && out.brake === 0, `at ${v} m/s: throttle ${out.throttle.toFixed(2)}, brake ${out.brake.toFixed(2)}`).toBeTruthy();
    }
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
    expect(brakeWith(0), "uncapped arc").toBe(0);
    expect(brakeWith(10), `capped arc: brake ${brakeWith(10).toFixed(2)}`).toBeGreaterThan(0.5);
  });
});

describe("given the contact guard called every step for one car (its held push and braking demand kept between calls), a stopped car dead ahead that is then taken away", () => {
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
    expect(Math.abs(on.steer) > 0.03 && on.brake === 0, `contact: steer ${on.steer.toFixed(2)}, brake ${on.brake.toFixed(2)}`).toBeTruthy();
    const soon = run(tune, CLEAR, 0.1);
    expect(Math.abs(soon.steer), `0.1 s after the contact: steer ${soon.steer.toFixed(3)}`).toBeGreaterThan(0.02);
    const later = run(tune, CLEAR, 2);
    expect(later.steer, `2 s after: steer ${later.steer}`).toBe(0);
  });

  it("when the car it brakes for goes out of reach, then the brake is still on 0.1 s later and off within a second", () => {
    const tune = tuned();
    const on = run(tune, [BRAKE_FOR], 0.5);
    expect(on.brake, `contact: brake ${on.brake.toFixed(2)}`).toBeGreaterThan(0.5);
    const soon = run(tune, CLEAR, 0.1);
    expect(soon.brake, `0.1 s after: brake ${soon.brake.toFixed(2)}`).toBeGreaterThan(0.2);
    const later = run(tune, CLEAR, 1);
    expect(later.brake === 0 && later.throttle > 0.9, `1 s after: brake ${later.brake}, throttle ${later.throttle}`).toBeTruthy();
  });

  it("when a call with no step (dt 0, a one-off) comes after the contact, then it holds nothing: the plan comes back as it was", () => {
    const tune = tuned();
    run(tune, [STEER_FROM], 0.5);
    const once = call(tune, CLEAR, 0);
    expect(firstMismatch(pedals(once), [1, 0, 0])).toBeUndefined();
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
    expect(across, "steps the wheel was pushed toward the car it steers from").toBe(0);
    expect(out.steer, `after 0.5 s: steer ${out.steer.toFixed(3)}`).toBeLessThan(-0.03);
  });

  it("when it has steered clear of a stopped car 0.3 m left of centre and then brakes for a car 0.3 m right of centre 20 m ahead at 15 m/s, then the push turns away from the one it brakes for instead of keeping its side toward it", () => {
    const tune = tuned();
    run(tune, [car(1, 0.3, 47, 0)], 0.3);
    const braked = run(tune, [car(1, -0.3, 20, 15)], 0.3);
    expect(braked.brake > 0.5 && braked.steer > 0, `braking: brake ${braked.brake.toFixed(2)}, steer ${braked.steer.toFixed(4)}`).toBeTruthy();
  });
});

describe("given a clean driver whose plan creeps straight at a stopped car 3 m ahead (bumper to bumper), the guard called every step, its brake taking speed off at the class's 20 m/s² and its throttle gaining up to 3 m/s² back to the crawl", () => {
  it("when it creeps at 0.5, 1 or 1.5 m/s (all under the derby's hit speed), then it never meets the car closing faster than the touch that arms a crash", () => {
    const STEP = 1 / QUIET_HZ;
    for (const crawl of [0.5, 1, 1.5]) {
      const tune = new Float64Array(GUARD_COUNT);
      tune[GUARD_BRAKE_IDX] = 20;
      tune[GUARD_LEAD_IDX] = 11;
      tune[GUARD_TURN_IDX] = 1.5;
      tune[GUARD_DT_IDX] = STEP;
      const me = car(0, 0, 0, crawl);
      const stopped = car(1, 0, 7.6, 0);
      let met = -1;
      for (let t = 0; t < 10 && met < 0; t += STEP) {
        const out: DriveInput = { ...idleDrive(), throttle: 1 };
        guardContact(me, [me, stopped], 2, new Uint8Array(32), tune, out);
        me.vz = out.brake > 0 ? Math.max(0, me.vz - out.brake * 20 * STEP) : Math.min(crawl, me.vz + out.throttle * 3 * STEP);
        me.z += me.vz * STEP;
        if (stopped.z - me.z <= 4.6) met = me.vz;
      }
      expect(met, `${crawl} m/s: met it at ${met.toFixed(2)} m/s (-1: never)`).toBeLessThanOrEqual(ARM_CLOSING);
    }
  });
});
