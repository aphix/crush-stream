import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { setGround } from "./ground.ts";
import { frame, FRAME, makeWorld, type World } from "./race-world.test-util.ts";
import { blankPoint, blankProjection, Track } from "./track.ts";
import oval from "./tracks/oval.json" with { type: "json" };
import { RESPAWN_DELAY } from "../match/session.ts";
import { DRIVE } from "../vehicle/car-drive.ts";
import { CLASSES, carClass } from "../vehicle/vehicle-classes.ts";
import { ejectionVelocity } from "../vehicle/ejection.ts";
import { standingBite } from "../vehicle/wheel-bite.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { assertSameNumbers } from "../vehicle/test-support.ts";
import type { CarRecord } from "../match/types.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

/**
 * Owner, 2026-10-03: "if your guy flies out of the car in race mode you can't drive any more (it continues in neutral
 * and does the 3 second reset or goes to DNF)", and "AI cars follow the same rules as players". The whole race stack
 * headless (`race-world.test-util.ts`): the player's car through the real seat, the rivals through the race AI.
 */
const track = new Track(oval);
const proj = blankProjection();
const pt = blankPoint();
/** The player (car 0) and the first AI rival (car 1) are the cars the tests throw. */
const PLAYER = 0;
const RIVAL = 1;

const w: World = makeWorld();
beforeAll(() => {
  w.race.enter();
});
afterAll(() => {
  w.race.exit();
  setGround(null);
});

/** A race on the oval with three AI rivals; the player's seat drives. */
function start(noReset: boolean): { acc: number } {
  watch.car = null;
  watch.drove = true;
  const r = w.race;
  r.command({ type: "quit" });
  r.command({ type: "options", options: { trackId: "oval", laps: 3, aiCount: 3, noReset, aggression: 0.35 } });
  r.reseed(1);
  w.ejections.length = 0;
  r.command({ type: "start" });
  return { acc: 0 };
}

/** The player's seat steers for the centreline 14 m ahead and holds the gas; held back (no input) until the green light. */
function drivePlayer(): void {
  const car = w.cars[PLAYER]!;
  const p = track.project(car.group.position.x, car.group.position.z, -1, proj);
  track.pointAt(p.s + 14, pt);
  let a = Math.atan2(pt.x - car.group.position.x, pt.z - car.group.position.z) - Math.atan2(car.fwdFlat.x, car.fwdFlat.z);
  a -= Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
  const racing = w.race.phase === "racing";
  const intent = w.seat.intent;
  w.seat.mode = "drive";
  w.seat.carIndex = PLAYER;
  intent.analogWheel = true;
  intent.analogGas = true;
  intent.wheel = racing ? Math.max(-1, Math.min(1, a * 3)) : 0;
  intent.gas = racing ? 1 : 0;
}

/** Before each step: whether `applyDrive` is about to run the watched car's input. */
function sampleDrive(): void {
  if (watch.car) watch.drove = drives(watch.car);
}

/** One rendered frame with the player driving. */
function tick(state: { acc: number }): void {
  drivePlayer();
  frame(w, state, sampleDrive);
}

/** Frames until the race clock reads `t` s. */
function runTo(state: { acc: number }, t: number): void {
  for (let n = 0; w.race.time < t && n < 60 * (t + 10); n++) tick(state);
}

const rec = (id: number): CarRecord => w.race.snapshot()!.cars.find((c) => c.id === id)!;

/** The car the row watches, and whether `applyDrive` ran its input on the frame's last step (sampled before the step: its physics moves the wheels after). */
const watch: { car: DeformableCar | null; drove: boolean } = { car: null, drove: true };

/** `applyDrive` runs a car's input: drivetrain alive, a wheel down, and bite; else it zeroes the pedals. */
function drives(car: DeformableCar): boolean {
  return car.deform.drivetrainAlive && car.wheelsDown !== 0 && standingBite(car) > 0;
}

/**
 * The car's last applied pedals and wheel: all zero and freewheeling is neutral. A car with nothing to drive on the frame's last step reads idle
 * instead (`applyDrive`'s idle state: pedals zero, nothing driven): its drivetrain is dead, no wheel is on the ground, or the wheels down have
 * no bite (`standingBite`: on a side, a roof or against a wall), sampled before the step. A side hit's fuel cut (`stalledS`) is no idle state.
 */
function neutral(car: DeformableCar): boolean {
  const d = car.drive;
  const nothingToDrive = watch.car === car && !watch.drove;
  return d.throttle === 0 && d.brake === 0 && d.steer === 0 && !d.ebrake && !d.boost && (d.neutral || nothingToDrive);
}

type Who = { name: string; id: number };
const WHO: Who[] = [
  { name: "the player's car", id: PLAYER },
  { name: "an AI rival's car", id: RIVAL },
];

describe("given a 3-lap oval race of 3 AI rivals, 5 s in, with one car's driver thrown out of his car", () => {
  for (const who of WHO) {
    it(`when ${who.name} loses its driver in a Respawn race, then it gets no pedals or wheel, coasts (rather than brakes), is reset ${RESPAWN_DELAY} s later with its driver back, and drives again`, () => {
      const state = start(false);
      runTo(state, 5);
      const car = w.cars[who.id]!;
      watch.car = car;
      const v0 = car.velocity.length();
      expect(v0, `${who.name} runs at ${v0.toFixed(1)} m/s before the throw`).toBeGreaterThan(8);
      expect(rec(who.id).status).toBe("racing");
      const t0 = w.race.time;
      car.driverOut = "windshield";
      let died = -1;
      let back = -1;
      let shedAt = NaN;
      let vAt = NaN;
      for (let n = 0; n < 60 * 8 && back < 0; n++) {
        tick(state);
        const t = w.race.time - t0;
        const r = rec(who.id);
        if (died < 0 && r.status === "respawning") died = t;
        if (died >= 0 && r.status === "racing") back = t;
        if (back < 0) {
          expect(neutral(car), `frame at +${t.toFixed(2)} s: throttle ${car.drive.throttle}, brake ${car.drive.brake}, steer ${car.drive.steer}, ebrake ${car.drive.ebrake}, boost ${car.drive.boost}, neutral ${car.drive.neutral}, drove ${watch.drove}`).toBeTruthy();
          expect(car.driverOut, "his seat stays empty until the reset").toBe("windshield");
          if (Number.isNaN(shedAt) && t >= 0.3) {
            shedAt = t;
            vAt = car.velocity.length();
          }
        }
      }
      expect(died >= 0 && died < 0.1, `the wreck rule took the car within ${(died * 1000).toFixed(0)} ms`).toBeTruthy();
      // A free roll (`DriveInput.neutral`): a player who only lets go of the pedals still sheds the lift-off drag (`DRIVE.coast` × the
      // class's brake), a thrown-out driver's car just rolling resistance and air drag, a twentieth of it.
      const liftOff = CLASSES[carClass(car)].brake * DRIVE.coast;
      const shed = (v0 - vAt) / shedAt;
      expect(shed, `${v0.toFixed(1)} -> ${vAt.toFixed(1)} m/s in ${shedAt.toFixed(2)} s: ${shed.toFixed(1)} m/s², lift-off would shed ${liftOff.toFixed(1)}`).toBeLessThan(0.25 * liftOff);
      expect(Math.abs(back - died - RESPAWN_DELAY), `reset ${(back - died).toFixed(3)} s after the wreck rule took the car (${RESPAWN_DELAY} s)`).toBeLessThan(0.1);
      expect(car.driverOut, "the driver is back in the car after the reset").toBe(null);
      expect(rec(who.id).deaths).toBe(1);
      // Driving resumes: the player's seat or the AI is back on the pedals within a moment.
      let drove = false;
      for (let n = 0; n < 60 * 3; n++) {
        tick(state);
        drove ||= car.drive.throttle > 0.3;
      }
      expect(drove, "pedals come back after the reset").toBeTruthy();
      expect(car.velocity.length(), `moving again: ${car.velocity.length().toFixed(1)} m/s`).toBeGreaterThan(3);
    });

    it(`when ${who.name} loses its driver in a No-reset race, then it gets no pedals, coasts, and is out of the race for good`, () => {
      const state = start(true);
      runTo(state, 5);
      const car = w.cars[who.id]!;
      watch.car = car;
      const t0 = w.race.time;
      car.driverOut = "doorL";
      for (let n = 0; n < 60 * 8; n++) {
        tick(state);
        expect(neutral(car), `frame at +${(w.race.time - t0).toFixed(2)} s: throttle ${car.drive.throttle}, brake ${car.drive.brake}, steer ${car.drive.steer}, ebrake ${car.drive.ebrake}, boost ${car.drive.boost}, neutral ${car.drive.neutral}, drove ${watch.drove}`).toBeTruthy();
      }
      expect(rec(who.id).status, "no resets: out of the race").toBe("out");
      expect(car.driverOut, "and he stays out").toBe("doorL");
      if (who.id === PLAYER) expect(w.race.hud().menu, "the player gets the wrecked menu").toBe("dead");
      expect(w.race.hud().you!.driverOut, "the HUD's DRIVER OUT flag is the player's own car's").toBe(w.cars[PLAYER]!.driverOut !== null);
    });
  }
});

describe("given a netplay peer's car parked on the grid of an oval race, as a human who sits still", () => {
  it("when the race runs for 14 s, then the peer keeps its car and is not reset by the rules (only the AI is), as this browser's driver would not be", () => {
    w.race.setSeats(new Map([[RIVAL, "Peer"]]));
    try {
      const state = start(false);
      runTo(state, 14);
      expect(w.race.racers[RIVAL]!.kind).toBe("remote");
      expect(w.cars[RIVAL]!.velocity.length(), "the peer sits still").toBeLessThan(1);
      expect(rec(RIVAL).status, "no still-for-8-s death").toBe("racing");
      expect(rec(RIVAL).deaths).toBe(0);
    } finally {
      w.race.setSeats(new Map());
    }
  });
});

/** The first rival, then the player, a head-on 8 m apart on the start straight, each at `mps` (the AI rival swerves out of the way from 14 m). */
function headOn(mps: number): void {
  const a = w.cars[PLAYER]!;
  const b = w.cars[RIVAL]!;
  const s0 = 40;
  track.pointAt(s0, pt);
  const yaw = Math.atan2(pt.tx, pt.tz);
  a.spawnFacing(pt.x, pt.z, yaw, mps);
  track.pointAt(s0 + 8, pt);
  b.spawnFacing(pt.x, pt.z, yaw + Math.PI, mps);
}

/**
 * What a head-on at 2×20 m/s (72 km/h each) does, frame by frame: when each driver left and when each car was reset.
 * At the default realism both engines survive it (vehicle/ejection.test.ts), so only the ejection rule stops the cars.
 */
function headOnRun(noReset: boolean): { out: number[]; reset: number[]; events: string; status: string[] } {
  const state = start(noReset);
  runTo(state, 1);
  headOn(20);
  const out = [-1, -1];
  const reset = [-1, -1];
  const cars = [w.cars[PLAYER]!, w.cars[RIVAL]!];
  for (let n = 0; n < 60 * 8; n++) {
    tick(state);
    for (const k of [0, 1]) {
      if (out[k]! < 0 && cars[k]!.driverOut !== null) out[k] = n;
      if (out[k]! >= 0 && reset[k]! < 0 && cars[k]!.driverOut === null) reset[k] = n;
      if (out[k]! >= 0 && reset[k]! < 0) expect(neutral(cars[k]!) || n === out[k], `car ${k} drives after its driver left (frame ${n})`).toBeTruthy();
    }
  }
  const status = [rec(PLAYER).status, rec(RIVAL).status];
  return { out, reset, events: JSON.stringify(w.ejections.map((e) => [e.car, e.exit, ...e.pos.toArray(), ...ejectionVelocity(e, new THREE.Vector3()).toArray()])), status };
}

describe("given the player's car and the first AI rival driving head-on at each other at 2×20 m/s (72 km/h each) on the oval's start straight, where both engines survive the crash", () => {
  it(`when the race is a Respawn race, then both drivers leave, both cars are reset ${RESPAWN_DELAY} s later, and they race on`, () => {
    const o = headOnRun(false);
    expect(o.out[0]! >= 0 && o.out[1]! >= 0, `both drivers leave: ${JSON.stringify(o.out)}`).toBeTruthy();
    for (const k of [0, 1]) {
      const secs = (o.reset[k]! - o.out[k]!) * FRAME;
      expect(Math.abs(secs - RESPAWN_DELAY), `car ${k} reset ${secs.toFixed(2)} s after the throw`).toBeLessThan(0.2);
    }
    expect(firstMismatch(o.status, ["racing", "racing"]), "and they race on").toBeUndefined();
  });

  it("when the race is a No-reset race, then both drivers leave and both cars are out of the race for good, never reset", () => {
    const o = headOnRun(true);
    expect(o.out[0]! >= 0 && o.out[1]! >= 0).toBeTruthy();
    expect(firstMismatch(o.reset, [-1, -1]), "no reset").toBeUndefined();
    expect(firstMismatch(o.status, ["out", "out"])).toBeUndefined();
  });

  /**
   * A car put back after a crash differs a hair from a fresh one (1e-2 m/s a few frames on, with or without the ejection
   * watch: `DeformableCar.resetVisual` leaves some wreck state), so exact repeatability is shown on worlds of their own.
   */
  const fresh = (): void => {
    w.race.exit();
    setGround(null);
    Object.assign(w, makeWorld());
    w.race.enter();
  };

  it("when the same Respawn race is run twice on worlds of their own, then the same drivers are thrown on the same frames with the same launch numbers, and the cars are reset on the same frames", () => {
    fresh();
    const first = headOnRun(false);
    fresh();
    const again = headOnRun(false);
    assertSameNumbers(again.out, first.out, "ejection frames");
    assertSameNumbers(again.reset, first.reset, "reset frames");
    expect(again.events).toBe(first.events);
    expect(first.events).not.toBe("[]");
  });
});
