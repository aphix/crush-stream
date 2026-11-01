import { describe, expect, it } from "vitest";
import { chase, type Fleer } from "./survival-players.test-util.ts";

/**
 * The opening of a Survival run on Havana itself (docs/SURVIVAL.md, "The ramp"), from the green with the pack's real aggression: the pack is mean
 * enough to land hits and dent the player in its first 10 s, and not so mean that it usually ends the run in its first 30. Five staged situations:
 * a scripted player of each kind (the one that keeps running round solids and cops, the ring tour, flat out with the wheel held, straight, held on the
 * boulevard line) with a seed of the pursuit rows; the seed moves the line of two of them and the dice of the drop-ins, which come after the first 10 s.
 */
const SITUATIONS: readonly { fleer: Fleer; seed: number }[] = [
  { fleer: "evade", seed: 13 },
  { fleer: "ring", seed: 5 },
  { fleer: "flee", seed: 20 },
  { fleer: "straight", seed: 9 },
  { fleer: "held", seed: 17 },
];
/** Seconds after the green by which a cop has hit the player and the run is still going. */
const HIT_BY = 10;
/** The runs of `evade` (the player that keeps running and does not drive into the monument on its own) that must still be going at `SURVIVE_T`: "probably" is 4 of 5. */
const SURVIVE_T = 30;
const SURVIVE_RUNS = 4;
const EVADE_SEEDS = [13, 5, 20, 9, 17] as const;

describe("given Havana's Survival course, the pack released at the green with its real aggression, and a scripted player that keeps running", () => {
  it(`when the run starts, then in each situation a cop has hit the player and dented it within ${HIT_BY} s, and the run is still going`, (t) => {
    const missed: string[] = [];
    for (const { fleer, seed } of SITUATIONS) {
      const c = chase(fleer, seed, HIT_BY);
      t.annotate(`${fleer} seed ${seed}: first cop contact ${c.firstTouch.toFixed(1)} s, dented ${c.hurtAt.toFixed(1)} s (crush ${c.crush.toFixed(2)} m, engine ${c.health.toFixed(2)}), ${c.ended ? `ended ${c.cause} at ${c.time.toFixed(1)} s` : "still running"}`);
      if (c.ended) missed.push(`${fleer} seed ${seed}: ended ${c.cause} at ${c.time.toFixed(1)} s`);
      else if (c.hurtAt < 0 || c.hurtAt > HIT_BY) missed.push(`${fleer} seed ${seed}: ${c.firstTouch < 0 ? "no cop touched it" : `first cop contact at ${c.firstTouch.toFixed(1)} s`}, dented ${c.hurtAt < 0 ? "never" : `at ${c.hurtAt.toFixed(1)} s`}`);
    }
    expect(missed.length, missed.join("; ")).toBe(0);
  });
  it(`when the player that keeps running is chased from the green at seeds ${EVADE_SEEDS.join(", ")}, then at least ${SURVIVE_RUNS} of the runs are still going ${SURVIVE_T} s in`, (t) => {
    let going = 0;
    for (const seed of EVADE_SEEDS) {
      const c = chase("evade", seed, SURVIVE_T);
      t.annotate(`seed ${seed}: ${c.ended ? `ended ${c.cause} at ${c.time.toFixed(1)} s` : "still going"}, ${c.touches} cop contacts, crush ${c.crush.toFixed(2)} m, engine ${c.health.toFixed(2)}`);
      if (!c.ended) going++;
    }
    expect(going, `${going} of ${EVADE_SEEDS.length} runs still going at ${SURVIVE_T} s`).toBeGreaterThanOrEqual(SURVIVE_RUNS);
  });
});
