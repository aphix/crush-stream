import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runField } from "./derby-field.test-util.ts";
import { SPIN_RATE_BAR } from "./vertical-turn.test-util.ts";

/**
 * One fixed 10-car heat (seed 1) through the engine's stack for its first two minutes: the physics guards an AI field needs (no free
 * spin, no zip, no death in the first 8 s). The AI's choices are judged where they are made, staged and deterministic, not as shares
 * pooled over chaotic heats (owner, 2026-10-26):
 * - the winner, by last car standing or top score at the limit, and count-outs: `match/derby.test.ts` (time limit, survivor, count-out rows);
 * - tail-first hits (the rear share): `match/derby.test.ts` "a derby car that fights with its tail" and `derby-ai.test.ts` "backs toward a
 *   car parked broadside";
 * - handbrake swings, sideswipes and J-turns (the rates and the J-turn share): `derby-ai.test.ts` swing and sideswipe rows,
 *   `match/derby.test.ts` J-turn row;
 * - the deadlock breaker (the late-heat scoot share): `derby-ai.test.ts` "paces inside one 9 m pocket" and `match/derby.test.ts` wedge row.
 * The share of heats that ended before the limit (≥ 5 of 8) was a pooled statistic of the kill tuning; the kill and count-out rules
 * are pinned by their own rows.
 */
const SEED = 1;
/** The spin and contact-peak rows read the first two minutes (`runField`'s spin window). */
const WINDOW_S = 120;

describe(`given ten AI cars at the default aggression, one fixed heat (seed ${SEED}) played for its first ${WINDOW_S} s`, () => {
  const r = runField(10, SEED, undefined, WINDOW_S);
  const row =
    `seed ${r.seed}: deaths [${r.deaths.join(",")}]; spins contact ${r.contactSpins.length} free ${r.freeSpins.length}; ` +
    `zips ${r.zips.length} max ${(r.zipMax * 100).toFixed(1)} cm [${r.zips.join("; ")}]; contact peak ${r.contactPeak.rate.toFixed(2)} rad/s (${r.contactPeak.note})`;

  it("when the heat is played, then the AI's own driving never spins a car faster than 5 rad/s for 0.2 s", () => {
    assert.deepEqual(r.freeSpins, [], row);
  });

  // A zip is a car teleporting centimetres in one step: a physics defect, never noise.
  it("when the heat is played, then no car teleports a few centimetres in one physics step", () => {
    assert.deepEqual(r.zips, [], row);
  });

  it("when the heat is played, then nobody dies in the first 8 s (one hit never kills)", () => {
    assert.ok((r.deaths[0] ?? Infinity) > 8, row);
  });

  // The struck car's spin is the pair kernel's lever (`bodyContact`: dw = J·lever/I); what slows a spinning wreck is the tyres' yaw grip,
  // which the wreck split (`tyre-yaw.ts`, `followGroup`) still owns until Stage 5 makes the wreck one rigid body on the same solve.
  it("when the heat is played, then the turn rate over 0.1 s while cars are in contact never exceeds 6.5 rad/s, and no car spins in contact", { todo: "contact peaks over 6.5 rad/s (lever torque of the pair kernel; the tyres' yaw grip is the wreck's): Stage 5" }, () => {
    assert.deepEqual(r.contactSpins, [], row);
    assert.ok(r.contactPeak.rate <= 6.5, row);
  });
});

/** The window (match s) in which the control forces car 0 to turn, and how fast (rad/s): over the spin bar. No car is near it this early in the heat. */
const FORCED_SPIN_FROM = 1;
const FORCED_SPIN_TO = 3;
const FORCED_SPIN_RATE = SPIN_RATE_BAR + 1;

describe("given a heat in which car 0 is turned over the spin bar for two seconds with no car, prop or wall near it", () => {
  const forced = runField(
    10,
    SEED,
    {
      step: (cars, t, h) => {
        const car = cars[0]!;
        if (t < FORCED_SPIN_FROM || t > FORCED_SPIN_TO || car.deform.massActive) return;
        car.yaw += FORCED_SPIN_RATE * h;
        car.group.rotation.set(car.pitch, car.yaw, car.roll, "YXZ");
        car.refreshBasis();
      },
    },
    FORCED_SPIN_TO + 1,
  );

  it("when the heat is played past the window, then the free-spin row's measure reports it as a spin of car 0 that no contact explains", () => {
    const mine = forced.freeSpins.filter((note) => note.includes(" c0 "));
    assert.ok(mine.length > 0, `no free spin of c0 (free ${JSON.stringify(forced.freeSpins)}, contact ${JSON.stringify(forced.contactSpins)}): the row cannot see a spin`);
    const at = Number(/^t=([\d.]+)/.exec(mine[0]!)![1]);
    assert.ok(at >= FORCED_SPIN_FROM && at <= FORCED_SPIN_TO + 0.1, `the spin was counted at t=${at}, outside the window it was forced in`);
  });
});
