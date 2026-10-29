import { must } from "../kernel/must.test-util.ts";
import { describe, expect, it } from "vitest";
import { blankAiCar } from "../ai/derby-ai.ts";
import { RacerSight } from "../ai/cop-sight.ts";
import type { HunterWorld } from "../ai/cop-brain.ts";
import { PoliceBrain } from "../ai/police.ts";
import { RaceBrain } from "../ai/race-ai.ts";
import { racerSeeing } from "./race-police-sight.test-util.ts";
import { blankPoint, blankProjection, Track } from "./track.ts";
import fourCount from "./tracks/four-count.json" with { type: "json" };
import city from "./tracks/city.json" with { type: "json" };

const track = new Track(fourCount);
/** A seeded Four-Count police race's racer at 128.26 s: on the skip-city shortcut, 151 m off the main road, driving +x at 52 m/s. */
const SHORTCUT_RACER = { x: 401.4, z: 39.3 };
/** The two stakeout spots put on the road then, 225 m and 245 m behind it (the main road's arc puts them 167 m and 198 m "ahead"). */
const SPOTS = [
  { x: 182.8, z: -14.5 },
  { x: 162.8, z: -17.4 },
];

describe("given a racer on Four-Count's skip-city shortcut, off the main road's corridor, and the spots a stakeout put on the road behind it", () => {
  it("when the spots are checked from the racer, then neither the game nor the check these tests use sees them: an off-road racer sees the ahead range round it, not the main road's arc", () => {
    const sight = new RacerSight(track, 1);
    sight.watch([{ ...blankAiCar(0), ...SHORTCUT_RACER }]);
    const proj = blankProjection();
    for (const spot of SPOTS) {
      const gameHidden = sight.hiddenAt(spot.x, spot.z, track.project(spot.x, spot.z, -1, proj).s, true);
      expect(gameHidden, `the game reads (${spot.x}, ${spot.z}) as out of sight`).toBe(true);
      expect(racerSeeing(track, [SHORTCUT_RACER], spot.x, spot.z).sees, `the judge reads (${spot.x}, ${spot.z}) as out of sight`).toBe(false);
    }
    const round = sight.range.ahead - 10;
    expect(racerSeeing(track, [SHORTCUT_RACER], SHORTCUT_RACER.x - round, SHORTCUT_RACER.z).sees, "a spot inside the ahead range round it is seen").toBe(true);
  });
});

/** Racers on the grid: the player's car and seven AI. */
const FIELD = 8;

/**
 * The spots one stakeout's two cops are put on, on `on`: the field strung out `gap` m apart behind the leader at `lead` m (racer 7 at `seventh`,
 * when given), the stakeout for racer `target`, in the first patrol beat.
 */
function stakeout(on: Track, lead: number, gap: number, target: number, seed: number, seventh?: { x: number; z: number }) {
  const pt = blankPoint();
  const cars = Array.from({ length: FIELD + 2 }, (_, i) => blankAiCar(i));
  for (let i = 0; i < FIELD; i++) {
    const p = on.pointAt(lead - i * gap, pt);
    Object.assign(cars[i]!, { x: p.x, z: p.z });
  }
  if (seventh) Object.assign(cars[FIELD - 1]!, seventh);
  const hunt = new Uint8Array(cars.length);
  hunt[target] = 1;
  const parks: { x: number; z: number }[] = [];
  const world: HunterWorld = { park: (_id, x, _y, z) => parks.push({ x, z }), store: () => {}, down: () => false, speed: () => 0, sirens: () => {}, hidden: () => true };
  // Past a third of the lap the stakeouts are armed: the first beat parks one.
  new PoliceBrain(on, new RaceBrain(on, FIELD), FIELD, 2, seed).update(0, 0.25, cars, hunt, on.length / 2, world);
  return { parks, racers: cars.slice(0, FIELD) };
}

// Each layout's spots, parked blind to all but the target, are seen by another racer (the shortcut racer, or the pack ahead of the back marker).
const COURSE_TRACKS: Record<string, Track> = { "four-count": track, city: new Track(city) };
const LAYOUTS = [
  { course: "four-count", why: "the stakeout for the leader, racer 7 on the skip-city shortcut", lead: 1904, gap: 20, target: 0, seed: 1, seventh: SHORTCUT_RACER },
  { course: "four-count", why: "the stakeout for the back marker of a pack 20 m apart", lead: 1500, gap: 20, target: 6, seed: 2, seventh: SHORTCUT_RACER },
  { course: "city", why: "the stakeout for the back marker of a pack 15 m apart", lead: 200, gap: 15, target: 6, seed: 1 },
];

describe("given a field of 8 racers strung out on the road and a stakeout of two cops parked for one of them", () => {
  for (const l of LAYOUTS) {
    it(`when ${l.course} parks ${l.why}, then both cops are put on the road and no racer sees either spot`, () => {
      const on = COURSE_TRACKS[l.course];
      must(on, `the ${l.course} track`);
      const { parks, racers } = stakeout(on, l.lead, l.gap, l.target, l.seed, l.seventh);
      expect(parks.length, "both cops parked").toBe(2);
      for (const p of parks) {
        const seen = racerSeeing(on, racers, p.x, p.z);
        expect(seen.sees, `cop put on the road at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) in sight of ${seen.text}`).toBe(false);
      }
    });
  }
});
