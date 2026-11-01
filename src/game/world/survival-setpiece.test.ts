import { describe, expect, it } from "vitest";
import { hash01 } from "../kernel/scalar.ts";
import { HunterBrain } from "../ai/hunter.ts";
import { holdLine, leaveSurvival, play, survivalWorld } from "./survival-run.test-util.ts";
import type { World } from "./race-world.test-util.ts";

/**
 * Survival's opening set piece, on the real Havana course with the whole stack (docs/SURVIVAL.md): five cops in a staggered
 * formation behind a player who holds the boulevard line at full throttle, like a human (it steers back to its line when shoved).
 * The friend's spec: several cops reach the embankment's foot within about half a second of each other and leave the ground at the
 * crest; and a player who brakes hard near the crest's left makes them overshoot and fly past. The seed rolls the human's
 * line (x = −6 ± 1.5 m) and how far ahead it looks (25–40 m), and pins the field's dice.
 *
 * On the aggression ramp the opening is two-part: the nearest two cops tap the player first (about 3 s in, `survival-opening`), and the other cops of the formation
 * (the flyers, `HUNT.opening`) fly the launch at full aggression, so the spec above holds for them; the tap is part of the scene.
 */
const SEED = 1;

/** The embankment's foot (z, m), and the band of z a flight from the crest begins in (the plateau's near edge is at z 18). */
const FOOT = 45;
const CREST: readonly [number, number] = [10, 35];
/** Where the braking player starts to brake (z, m), and the line he veers to: the crest's left. */
const BRAKE_AT = 85;
const LEFT = -9;
const WINDOW = 0.5;
/** A cop at a z over this (m) is put away (the pack stores a wrecked cop far off the course): its car, dropped in again elsewhere, is not one of the formation any more. */
const PARKED = 1000;
/** Race second the flyers are read at: the formation splits at the green. */
const SPLIT_READ = 2;

type Crossing = { car: number; t: number };

type Piece = {
  /** Race second each formation cop that drove there first crossed the foot, in order. */
  foot: Crossing[];
  /** The formation's cars that fly the opening at full aggression (the brain's `flies`). */
  flyers: number[];
  /** The cops that left the ground at the crest. */
  takeoffs: number[];
  /** Cops that got ahead of the player by 5 m or more. */
  passed: number;
  /** The player's farthest stray from his line before the foot (m). */
  stray: number;
  /** A cop hit the player before the foot (its car is crashed). */
  tapped: boolean;
};

/** The cars that fly the opening at full aggression now. */
function flyersOf(w: World): number[] {
  const brain: unknown = Reflect.get(w.race, "police");
  if (!(brain instanceof HunterBrain)) return [];
  const flies = brain["flies"];
  const cars: number[] = [];
  for (let u = 0; u < flies.length; u++) if (flies[u] === 1) cars.push(brain.first + u);
  return cars;
}

function setPiece(seed: number, brake: boolean): Piece {
  const w = survivalWorld(undefined, seed);
  try {
    const line = -6 + (hash01(seed, 1) - 0.5) * 3;
    const look = 25 + 15 * hash01(seed, 2);
    const foot = new Map<number, number>();
    const takeoffs = new Set<number>();
    const passed = new Set<number>();
    const flying = new Set<number>();
    const away = new Set<number>();
    const piece: Piece = { foot: [], flyers: [], takeoffs: [], passed: 0, stray: 0, tapped: false };
    const player = (ww: World): void => {
      const me = ww.cars[0]!;
      const z = me.group.position.z;
      if (brake && z < BRAKE_AT) holdLine(ww, LEFT, look, 0);
      else holdLine(ww, line, look, null);
      if (piece.flyers.length === 0 && ww.race.time > SPLIT_READ) piece.flyers = flyersOf(ww);
      // From the 300 m mark on: the first stretch is the player getting from the start (x 0) onto his line.
      if (z > FOOT && z < 300) piece.stray = Math.max(piece.stray, Math.abs(me.group.position.x - line));
      if (z > FOOT && me.crashed) piece.tapped = true;
      for (let i = 1; i <= 5; i++) {
        const c = ww.cars[i]!;
        const cz = c.group.position.z;
        if (cz > PARKED) away.add(i);
        if (away.has(i)) continue;
        if (!foot.has(i) && cz < FOOT) foot.set(i, ww.race.time);
        if (c.airborne && !flying.has(i) && cz > CREST[0] && cz < CREST[1]) takeoffs.add(i);
        if (c.airborne) flying.add(i);
        else flying.delete(i);
        if (cz < z - 5 && z < 200) passed.add(i);
      }
    };
    play(w, { seconds: 20, player, retry: false });
    piece.foot = [...foot.entries()].map(([car, t]) => ({ car, t })).sort((a, b) => a.t - b.t);
    piece.takeoffs = [...takeoffs];
    piece.passed = passed.size;
    return piece;
  } finally {
    leaveSurvival(w);
  }
}

/** The most cops that crossed the foot within `WINDOW` s of each other. */
function together(foot: readonly Crossing[]): number {
  return Math.max(0, ...foot.map((a) => foot.filter((b) => b.t >= a.t && b.t < a.t + WINDOW).length));
}

describe(`given Survival's opening scene on the Havana course (five cops in a staggered formation behind the player), rolled with seed ${SEED}`, () => {
  it("when the player holds the boulevard line at full throttle, then the flyers all reach the embankment's foot, three cops of the pack within half a second of each other, and three leave the ground at the crest", (t) => {
    const p = setPiece(SEED, false);
    const flyers = p.foot.filter((f) => p.flyers.includes(f.car));
    const times = (cs: readonly Crossing[]): string => cs.map((f) => `${f.car}@${f.t.toFixed(2)}`).join(" ");
    t.annotate(`flyers ${p.flyers.join(",")}; at the foot, in race seconds: flyers ${times(flyers)}; all that drove there ${times(p.foot)}; ${together(flyers)} flyers and ${together(p.foot)} cops within ${WINDOW} s; ${p.takeoffs.length} took off; the player strayed ${p.stray.toFixed(1)} m, tapped ${p.tapped}`);
    expect(p.flyers.length, `only ${p.flyers.length} formation cops fly the opening`).toBeGreaterThanOrEqual(3);
    expect(flyers.length, `${flyers.length} of the ${p.flyers.length} flyers reached the foot (${times(p.foot)})`).toBe(p.flyers.length);
    expect(together(p.foot), `only ${together(p.foot)} cops within ${WINDOW} s at the foot (${times(p.foot)})`).toBeGreaterThanOrEqual(3);
    expect(p.takeoffs.length, `only ${p.takeoffs.length} cops left the ground at the crest`).toBeGreaterThanOrEqual(3);
    expect(p.stray, `the pack shoved the player ${p.stray.toFixed(1)} m off his line`).toBeLessThan(6);
    expect(p.tapped, "no cop tapped the player before the foot: the ramp's opening lands a hit").toBeTruthy();
  });

  it("when the player brakes hard near the crest's left, then the cops overshoot and fly past", (t) => {
    const p = setPiece(SEED, true);
    t.annotate(`${p.passed} passed the player; ${p.takeoffs.length} took off at the crest`);
    expect(p.passed, `only ${p.passed} cops overshot the braking player`).toBeGreaterThanOrEqual(3);
    expect(p.takeoffs.length, `only ${p.takeoffs.length} cops flew off the crest`).toBeGreaterThanOrEqual(3);
  });
});
