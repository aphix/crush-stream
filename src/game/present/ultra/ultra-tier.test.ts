import { describe, expect, it } from "vitest";
import { AutoFx } from "../auto-fx.ts";
import { describePost, FX_TIERS, type FxTier } from "../engine-post.ts";
import { benchPlan } from "../../engine/engine-bench-plan.ts";
import { firstMismatch } from "../../kernel/compare-arrays.test-util.ts";

/** A nearly idle main thread (ms per frame) and no GPU timer, as in `auto-fx.test.ts`: only the wall rate varies. */
const LIGHT_WORK_MS = 3;
const NO_GPU = -1;

/** A 30 fps spell in each race from this race-clock second to the next: long enough to step the tier down, early enough to climb back before the flag. */
const SPELL_FROM_S = 20;
const SPELL_TO_S = 30;

/** 60 Hz frames with the jitter the auto-tier tests use (30 fps while `slow` says so), fed until `seconds` have passed; every tier the policy asked for. */
function feed(fx: AutoFx, seconds: number, matchTime: (t: number) => number | null, slow: (clock: number | null) => boolean = () => false): FxTier[] {
  const out: FxTier[] = [];
  let t = 0;
  for (let i = 0; t < seconds * 1000; i++) {
    const clock = matchTime(t / 1000);
    const ms = slow(clock) ? 1000 / 30 : 16.8 + ((i * 7) % 8) * 0.1;
    t += ms;
    const tier = fx.frame(ms, LIGHT_WORK_MS, LIGHT_WORK_MS, NO_GPU, matchTime(t / 1000));
    if (tier !== null) out.push(tier);
  }
  return out;
}

describe("given the effects tiers a player can pick", () => {
  it("when the list is read, then Ultra is the top tier, above high", () => {
    expect(firstMismatch([...FX_TIERS], ["off", "minimal", "low", "high", "ultra"])).toBeUndefined();
  });

  it("when the post chain is described for Ultra, then the line names the high chain and what Ultra adds", () => {
    const line = describePost("ultra");
    expect(line.includes(describePost("high")), line).toBeTruthy();
    expect(line).toMatch(/ultra/i);
  });
});

describe("given the automatic tier on a hardware desktop that holds 60 fps", () => {
  it("when it runs ten minutes idle, then through three races (clock -4.5 s to 90 s, each with a 10 s spell at 30 fps) with idle between, then it steps down and climbs back to high in every race and never asks for Ultra", () => {
    const fx = new AutoFx(true, true);
    const idle = feed(fx, 600, () => null);
    const races: FxTier[][] = [];
    for (let m = 0; m < 3; m++) {
      races.push(feed(fx, 94.5, (t) => -4.5 + t, (clock) => clock !== null && clock >= SPELL_FROM_S && clock < SPELL_TO_S));
      races.push(feed(fx, 20, () => null));
    }
    const raced = races.flat();
    expect(idle.includes("high"), "the check never lifted the desktop to high").toBeTruthy();
    expect(![...idle, ...raced].includes("ultra"), `asked for ${[...idle, ...raced].join(", ")}`).toBe(true);
    for (let m = 0; m < 3; m++) expect(races[2 * m]!.at(-1), `race ${m + 1} never climbed back to the top of the ladder: asked for ${races[2 * m]!.join(", ")}`).toBe("high");
  });

  it("when the player picks Ultra by hand and then turns Auto back on, then the next frame leaves Ultra for the tier that held", () => {
    const fx = new AutoFx(true, true);
    expect(firstMismatch(feed(fx, 4, () => null), ["high"])).toBeUndefined();
    fx.auto = false;
    expect(feed(fx, 30, () => null), "Ultra is a manual pick: the policy leaves it alone").toHaveLength(0);
    fx.resume("ultra");
    expect(firstMismatch(feed(fx, 0.05, () => null), ["high"])).toBeUndefined();
  });
});

describe("given the bench page's query", () => {
  it("when it asks for a bench with ultra=1, then the plan has the Ultra arm, for the city, the strip and the Lab", () => {
    for (const bench of ["city", "strip", "lab"]) {
      expect(benchPlan(`?bench=${bench}&ultra=1`)!.ultra, bench).toBe(true);
    }
  });

  it("when ultra is absent, 0 or not 1, then the plan has no Ultra arm", () => {
    for (const q of ["?bench=city", "?bench=city&ultra=0", "?bench=city&ultra=yes", "?bench=strip&ultra="]) {
      expect(benchPlan(q)!.ultra, q).toBe(false);
    }
  });
});
