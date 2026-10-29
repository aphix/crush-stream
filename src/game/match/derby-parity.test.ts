import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DerbyBrain, type AiCar } from "../ai/derby-ai.ts";
import { DerbyMatch } from "./derby.ts";
import { aiRecoverDelay, applyDrive, BOOST, DriverSeat, mayRecoverFlipped, selfRightDelay } from "../vehicle/car-drive.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { HANDLING, SELF_RIGHT_SLOWEST } from "../vehicle/vehicle-classes.ts";
import { aiCar, DT } from "../vehicle/test-support.ts";

/** A car at rest at the origin, upside down (roll π) when `over`, its engine alive unless `dead`. */
function parked(over: boolean, dead = false): DeformableCar {
  const car = new DeformableCar({ body: 0xc5c8ce, accent: 0x9aa0a8, name: "Titanium" }, new THREE.Scene());
  car.spawnFacing(0, 0, 0, 0);
  if (over) car.group.rotation.set(0, 0, Math.PI, "YXZ");
  car.deform.drivetrainAlive = !dead;
  car.refreshBasis();
  return car;
}

/** Slices until `due` first says yes (null: not within `seconds`). */
function firstYes(due: () => boolean, seconds: number): number | null {
  for (let n = 1; n * DT <= seconds; n++) if (due()) return n;
  return null;
}

/** `fn` with the handling slider at `realism`, restored after. */
function atRealism<T>(realism: number, fn: () => T): T {
  const was = HANDLING.realism;
  HANDLING.realism = realism;
  try {
    return fn();
  } finally {
    HANDLING.realism = was;
  }
}

describe("given a derby AI car flipped onto its roof, which turns itself back over by the same rules as the player's self-right key R", () => {
  it("when the car's engine still runs, then the AI turns it back onto its wheels on the very slice the player's own self-right would fire", () => {
    const car = parked(true);
    expect(mayRecoverFlipped(car)).toBe(true);
    const wait = selfRightDelay();
    expect(Number.isFinite(wait) && wait > 1, `default realism self-right delay ${wait}`).toBeTruthy();
    expect(aiRecoverDelay(), "below the realistic end the AI waits the player's delay").toBe(wait);
    const up = car.group.matrixWorld.elements[5]!;
    const match = new DerbyMatch();
    const seat = new DriverSeat();
    seat.mode = "drive";
    const ai = firstYes(() => match.recoverDue(0, car, DT), wait + 1);
    const player = firstYes(() => seat.selfRight(up, 0, DT), wait + 1);
    expect(ai !== null && ai * DT >= wait - 1e-9 && ai * DT < wait + DT + 1e-9, `AI pressed R at ${ai} slices, delay ${wait} s`).toBeTruthy();
    expect(ai, "the AI's R and the player's self-right fire on the same slice").toBe(player);
  });

  it("when the car's drivetrain is dead, or the car is upright, or it is still sliding, then the AI never turns it over (the player's rules for recovering a flipped car)", () => {
    const wait = selfRightDelay();
    const dead = parked(true, true);
    expect(mayRecoverFlipped(dead)).toBe(false);
    const match = new DerbyMatch();
    expect(firstYes(() => match.recoverDue(0, dead, DT), wait * 3), "dead engine righted itself").toBe(null);
    const upright = parked(false);
    expect(firstYes(() => match.recoverDue(1, upright, DT), wait * 3), "upright car pressed R").toBe(null);
    const sliding = parked(true);
    sliding.velocity.set(0, 0, 6);
    expect(firstYes(() => match.recoverDue(2, sliding, DT), wait * 3), "a car still sliding pressed R").toBe(null);
  });

  it("when a second car flips while the first is 0.3 s short of its wait, then the first is turned over within about 0.3 s of that and the second only after its own full wait", () => {
    const wait = selfRightDelay();
    const match = new DerbyMatch();
    const a = parked(true);
    const b = parked(true);
    // Car 0 has lain 0.3 s short of the delay when car 1 first flips.
    const lead = Math.round((wait - 0.3) / DT);
    for (let n = 0; n < lead; n++) expect(match.recoverDue(0, a, DT)).toBe(false);
    let firedA = -1;
    let firedB = -1;
    for (let n = 1; n <= Math.ceil((wait + 1) / DT) && firedB < 0; n++) {
      if (match.recoverDue(0, a, DT) && firedA < 0) firedA = n;
      if (match.recoverDue(1, b, DT)) firedB = n;
    }
    expect(firedA > 0 && firedA <= Math.ceil(0.3 / DT) + 2, `car 0 pressed R ${firedA} slices after car 1 flipped`).toBeTruthy();
    expect(firedB, `car 1 pressed R after ${firedB} slices, on car 0's clock`).toBeGreaterThanOrEqual(lead + firedA - 3);
  });

  it("when the car rolls back onto its wheels for a moment and flips again just before the wait would end, then the wait starts over from the second flip", () => {
    const wait = selfRightDelay();
    const match = new DerbyMatch();
    const car = parked(true);
    for (let n = 0; n < Math.round((wait - 0.3) / DT); n++) match.recoverDue(0, car, DT);
    car.group.rotation.set(0, 0, 0, "YXZ");
    car.refreshBasis();
    expect(match.recoverDue(0, car, DT)).toBe(false);
    car.group.rotation.set(0, 0, Math.PI, "YXZ");
    car.refreshBasis();
    const again = firstYes(() => match.recoverDue(0, car, DT), wait + 1);
    expect(again !== null && again * DT >= wait - DT, `pressed R ${again} slices after flipping again`).toBeTruthy();
  });

  it("when the handling slider is at its realistic end, then the player must turn the car over by hand while the AI still does after the slider's slowest delay", () => {
    atRealism(1, () => {
      expect(selfRightDelay()).toBe(Infinity);
      expect(aiRecoverDelay()).toBe(SELF_RIGHT_SLOWEST);
      const car = parked(true);
      const up = car.group.matrixWorld.elements[5]!;
      const seat = new DriverSeat();
      seat.mode = "drive";
      expect(firstYes(() => seat.selfRight(up, 0, DT), 10), "the realistic end left R to the player").toBe(null);
      const match = new DerbyMatch();
      const slices = firstYes(() => match.recoverDue(0, car, DT), SELF_RIGHT_SLOWEST + 1);
      expect(slices !== null && Math.abs(slices * DT - SELF_RIGHT_SLOWEST) <= DT, `AI pressed R at ${slices} slices`).toBeTruthy();
    });
  });
});

describe("given a derby AI car hunting a target by the player's boost rules", () => {
  /** A brain whose driver 0 hunts car 1, `z` m dead ahead (`foe` overrides it), nose first (tail spent, full aggression), past the opening hold and the 8 s opening caution. */
  function charging(z: number, me: Partial<AiCar> = {}, foe: Partial<AiCar> = {}): { brain: DerbyBrain; self: AiCar; all: AiCar[] } {
    const brain = new DerbyBrain();
    brain.setAggression(0, 1);
    const self = aiCar(0, { vz: 8, rear: 0.9, damage: 0.3, idle: 1000, ...me });
    const all = [self, aiCar(1, { z, vz: 0, ...foe })];
    brain.think(self, all, 9); // past the 8 s opening caution (`derby-opening.ts`), which would lift off a boosted charge
    brain.meter[0] = 1;
    return { brain, self, all };
  }

  it("when it charges a target ahead within 25 m, then it boosts and its boost meter drains at the same rate as the player's seat", () => {
    const { brain, self, all } = charging(18);
    expect(brain.tacticOf(0)).toBe("nose");
    const out = brain.think(self, all, 0.4);
    expect(out.boost).toBe(true);
    expect(Math.abs(brain.meter[0]! - (1 - 0.4 / BOOST.full)), `meter ${brain.meter[0]}`).toBeLessThan(1e-12);
    // The seat drains by the thrust its car applies (`drive.boostK`): at full thrust it drains as the AI's meter does.
    const seat = new DriverSeat();
    seat.mode = "drive";
    seat.sample(new Set(["ShiftLeft", "KeyW"]), null);
    const car = parked(false);
    car.drive.boostK = 1;
    seat.input(car, DT);
    seat.step(0.4);
    expect(brain.meter[0], "the AI's meter drains like the seat's at full thrust").toBe(seat.boost);
  });

  it("when the target is just inside 25 m, just outside 25 m, just outside or inside the last 8 m, or behind, head-on, off the nose, with an empty meter or tail first, then it boosts only at a target ahead within 25 m and outside the last 8 m, nose first", () => {
    const cases: readonly (readonly [string, number, boolean])[] = [
      ["inside 25 m", 24, true],
      ["outside 25 m", 26, false],
      ["outside the last 8 m", 9, true],
      ["inside the last 8 m", 7, false],
      ["behind", -18, false],
    ];
    for (const [label, z, boosts] of cases) {
      const { brain, self, all } = charging(z);
      expect(brain.think(self, all, DT).boost, label).toBe(boosts);
      expect(brain.tacticOf(0), `${label}: not a charge`).toBe("nose");
    }
    const faced = charging(18, {}, { yaw: Math.PI });
    expect(faced.brain.think(faced.self, faced.all, DT).boost, "boosted into a nose (head-on)").toBe(false);
    expect(faced.brain.tacticOf(0), "head-on case: not a charge").toBe("nose");
    const side = charging(18);
    side.all[1]!.x = 18;
    side.all[1]!.z = 2;
    expect(side.brain.think(side.self, side.all, DT).boost, "target off the nose").toBe(false);
    const empty = charging(18);
    empty.brain.meter[0] = 0;
    expect(empty.brain.think(empty.self, empty.all, DT).boost, "empty meter boosted").toBe(false);
    const tail = charging(18, { rear: 0, front: 0.9, damage: 0.6 });
    expect(tail.brain.think(tail.self, tail.all, DT).boost, `tail first (${tail.brain.tacticOf(0)}) boosted`).toBe(false);
  });

  it("when it is not boosting, then the meter refills at the player's seat rate and never goes past full", () => {
    const { brain, self, all } = charging(-18);
    brain.meter[0] = 0.2;
    brain.think(self, all, 0.9);
    expect(Math.abs(brain.meter[0]! - (0.2 + 0.9 / BOOST.recharge)), `meter ${brain.meter[0]}`).toBeLessThan(1e-12);
    brain.think(self, all, 60);
    expect(brain.meter[0]).toBe(1);
  });

  it("when a takedown is scored, then the attacker's meter is topped up by the player's takedown bonus, capped at full, and the victim earns nothing", () => {
    const match = new DerbyMatch();
    match.begin([{ id: 0, name: "a" }, { id: 1, name: "b" }], { start: 0, seed: 1 });
    expect(match.brain.meter[0], "a match starts with a full meter").toBe(1);
    match.brain.meter[0] = 0.3;
    expect(match.noteHit(0, 1, 6, 0, 6)).toBe(true);
    for (const id of match.consumeBoosts()) match.brain.addBoost(id, BOOST.takedown);
    expect(Math.abs(match.brain.meter[0]! - 0.7), `meter ${match.brain.meter[0]}`).toBeLessThan(1e-12);
    expect(match.brain.meter[1], "the victim earns nothing").toBe(1);
    match.brain.addBoost(0, BOOST.takedown);
    match.brain.addBoost(0, BOOST.takedown);
    expect(match.brain.meter[0]).toBe(1);
    const seat = new DriverSeat();
    seat.boost = 0.3;
    seat.addBoost(BOOST.takedown);
    expect(Math.abs(seat.boost - 0.7), "the seat takes the same bonus").toBeLessThan(1e-12);
  });

  it("when the derby match thinks for a boosting car, then the boost reaches the drive input while the throttle stays a share of the arena pace", () => {
    const match = new DerbyMatch();
    match.begin([{ id: 0, name: "a" }, { id: 1, name: "b" }], { start: 0, seed: 1 });
    match.brain.setAggression(0, 1);
    const snaps = match.snapshots(2);
    Object.assign(snaps[0]!, aiCar(0, { vz: 8, rear: 0.9, damage: 0.3 }));
    Object.assign(snaps[1]!, aiCar(1, { z: 18, vz: 0 }));
    match.think(snaps[0]!, snaps, 9); // past the 8 s opening caution
    match.brain.meter[0] = 1;
    const input = match.think(snaps[0]!, snaps, DT);
    expect(input.boost).toBe(true);
    expect(input.throttle > 0 && input.throttle < 0.5, `throttle ${input.throttle} is a share of the arena pace`).toBeTruthy();
    const car = parked(false);
    applyDrive(car, input, DT);
    expect(car.drive.boost, "applyDrive did not boost").toBe(true);
  });
});
