import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONTACT_HOLD, impactScale, phaseClock, PRE_IMPACT_LEAD } from "../match/phase.ts";
import { clipTimeline, simAt } from "./engine-highlights.ts";
import { crashCamEnd, CUTS } from "../present/engine-cine.ts";
import { TIMELINE_HZ } from "./constants.ts";

/** Canary: the time scale just before the cars meet, in multiples of the slow-mo's own scale; the ease is meant to have arrived (the exact rate lands within 1.2×, the timeline's step quantization costs a little more). */
const REACHED_CANARY = 2;
/** Canary: wall seconds the ease into the slow-mo may take (the 0.2 s of lead at the slow scale alone would crawl for 6 s). */
const EASE_WALL_CANARY = 2;
/** A hit plays in slow-mo when the time scale as the clip reaches it is at most this (the slow scale is 0.032; a hit left to the ease back out played at 0.70). */
const SLOW_ENOUGH = 0.05;

/** The first timeline step whose clip time reaches `t`. */
function stepAt(tl: { sim: Float64Array }, t: number): number {
  let k = 0;
  while (k < tl.sim.length - 1 && tl.sim[k]! < t) k++;
  return k;
}

/** Σ (i + 1) · a[i]: one number that moves when any value or its place does. */
function weighted(a: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * (i + 1);
  return s;
}

describe("given the highlight reel timeline of a 10 s clip whose first impact is at 4 s", () => {
  const tl = clipTimeline(4, 10, [], []);
  const contactStep = Math.round(tl.contact * TIMELINE_HZ);

  it("when the clip plays, then it runs at normal speed up to the lead before the hit and the slow-mo begins easing in there", () => {
    assert.ok(Math.abs(tl.onset - (4 - PRE_IMPACT_LEAD)) <= 1 / TIMELINE_HZ + 1e-9, `slow-mo began at wall ${tl.onset.toFixed(3)} s, not at ${4 - PRE_IMPACT_LEAD}`);
    assert.ok(Math.abs(simAt(tl, 2) - 2) < 1e-9, "1× before the hit");
    assert.ok(Math.abs(tl.impact + CUTS[0] - tl.onset) < 1e-9, `the crash cam began at ${tl.impact.toFixed(3)} s, so its first cut lands at ${(tl.impact + CUTS[0]).toFixed(3)} s, not as the slow-mo starts (${tl.onset.toFixed(3)} s)`);
  });

  it("when the slow-mo eases in, then the clip moves the lead's worth of game time between its start and the cars meeting, and the ease has reached the slow scale by then", () => {
    const played = simAt(tl, tl.contact) - simAt(tl, tl.onset);
    assert.ok(Math.abs(played - PRE_IMPACT_LEAD) <= 1 / TIMELINE_HZ + 1e-9, `${played.toFixed(4)} game s between slow-mo start and the hit, not ${PRE_IMPACT_LEAD}`);
    const slow = impactScale(phaseClock());
    assert.ok(tl.scale[contactStep - 1]! <= slow * REACHED_CANARY, `time scale ${tl.scale[contactStep - 1]} a step before the hit, slow scale ${slow}`);
    assert.ok(tl.contact - tl.onset < EASE_WALL_CANARY, `the ease took ${(tl.contact - tl.onset).toFixed(2)} wall s`);
    assert.equal(tl.phase[contactStep - 1], "approach");
    assert.equal(tl.phase[contactStep], "impact");
  });

  it("when the cars have met, then the clip holds the slow-motion over the hit, then catches up to the clip's last step", () => {
    // Three wall seconds into the slow-mo the clip has moved about 0.1 s (0.032×).
    const into = simAt(tl, tl.contact + 3) - simAt(tl, tl.contact);
    assert.ok(into > 0.05 && into < 0.15, `${into.toFixed(3)} clip s in 3 wall s of slow-mo`);
    assert.equal(simAt(tl, tl.wall), 10, "the timeline ends on the clip's last step");
    assert.ok(tl.wall > 16, `the clip played in ${tl.wall.toFixed(1)} wall s: no slow-mo hold`);
  });

  it("when it has one hit, with or without a throw in its slow-mo, then its timeline is the one a reel played before later hits had slow-mo of their own, to the bit", () => {
    const pin = (t: typeof tl): unknown[] => [t.wall, t.sim.length, t.contact, t.hold, weighted(t.sim), weighted(t.scale), t.phase.indexOf("slowmo"), t.phase.indexOf("aftermath")];
    assert.deepEqual(pin(tl), [17.541666666666668, 2106, 4.6, 8.391666666666667, 12936122.622336175, 1358162.5092070885, 567, 1308]);
    assert.deepEqual(pin(clipTimeline(4, 10, [4.05], [])), [20, 2401, 4.6, 10.933333333333334, 16370142.26882532, 1560823.1620817408, 567, 1613]);
  });
});

describe("given the highlight reel timeline of a pile-up whose hits land at 3.313, 3.946 and 4.133 clip s (the owner's flagged reel C04P-2WMS)", () => {
  const hits = [3.313, 3.946, 4.133];
  const tl = clipTimeline(hits[0]!, 6, [], hits.slice(1));

  it("when the clip plays, then every hit plays in slow-mo, the later ones dropped back to the slow scale after the first's hand-back", () => {
    const scales = hits.map((t) => tl.scale[stepAt(tl, t)]!);
    assert.ok(
      scales.every((s) => s <= SLOW_ENOUGH),
      `time scale at the hits ${scales.map((s) => s.toFixed(3)).join(" / ")}, slow enough at ${SLOW_ENOUGH}`,
    );
    const between = tl.scale.slice(stepAt(tl, 3.6), stepAt(tl, hits[1]! - PRE_IMPACT_LEAD));
    assert.ok(Math.max(...between) > 2 * SLOW_ENOUGH, `the clip never sped up between the first and second hit (at most ${Math.max(...between).toFixed(3)}×)`);
  });

  it("when its third hit lands while the second's slow-mo holds, then the slow-mo hands back CONTACT_HOLD wall s after the third", () => {
    const third = stepAt(tl, hits[2]!);
    const back = tl.phase.indexOf("aftermath", third);
    assert.ok(Math.abs((back - third) / TIMELINE_HZ - CONTACT_HOLD) <= 2 / TIMELINE_HZ, `handed back ${((back - third) / TIMELINE_HZ).toFixed(3)} wall s after the third hit`);
  });

  it("when it plays, then the crash cam's window runs to the last slow-mo's hand-back, so the later hits get its framing before the ride-along", () => {
    const back = tl.phase.indexOf("aftermath", stepAt(tl, hits[2]!));
    assert.ok(Math.abs(tl.impact + tl.hold - back / TIMELINE_HZ) < 1e-9, `the window's hold ends at ${(tl.impact + tl.hold).toFixed(3)} wall s, the last hand-back is at ${(back / TIMELINE_HZ).toFixed(3)} s`);
    const end = tl.impact + crashCamEnd(tl.hold);
    const walls = hits.slice(1).map((t) => stepAt(tl, t) / TIMELINE_HZ);
    assert.ok(
      walls.every((w) => w < end),
      `later hits at wall ${walls.map((w) => w.toFixed(2)).join(" / ")} s, the crash cam hands back at ${end.toFixed(2)} s`,
    );
  });
});
