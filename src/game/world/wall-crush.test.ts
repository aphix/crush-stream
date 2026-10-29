import { describe, expect, it } from "vitest";
import { setGround } from "./ground.ts";
import { frame, makeWorld } from "./race-world.test-util.ts";
import { placeProps, propColliders } from "./placements.ts";
import { Track } from "./track.ts";
import oval from "./tracks/oval.json" with { type: "json" };
import { SimPacer } from "../engine/sim-pace.ts";

/**
 * Owner, 2026-10-05: "something seems much less likely to crush and eject correctly at higher speeds". A device whose 1/240 s
 * steps do not fit the frame steps at 1/80 s (`SimPacer`, adaptive), and a hit that falls between two steps of 0.69 m of
 * travel at 55 m/s decided the crash: the same hit into the same wall killed the engine at one approach phase and spared it at
 * another (engine block 0.274 m to 0.484 m, the kill at 0.45 m). The whole stack headless (`race-world.test-util.ts`) with the
 * engine's own pacer holding each floor: a lone sedan, gas held, into the oval's straight wall.
 */
const track = new Track(oval);
const colliders = propColliders(placeProps(track));

type Wall = { fx: number; fz: number; ox: number; oz: number; run: number };

/** How far (m) the car's middle starts inside the far wall's road face: its 2.3 m tail is then 1 m clear of that wall, which is solid. */
const START_INSET = 3.3;

/** The oval's longest straight left wall with no prop within 4 m of a car crossing the road to it: its face point, the unit toward it and the run across the road. */
function straightWall(): Wall {
  const p = track.path;
  let best: Wall | null = null;
  for (let k = 0; k < p.count; k++) {
    let straight = true;
    for (let j = -12; j <= 12 && straight; j++) {
      const a = (k + j + p.count) % p.count;
      if (!p.wallL[a] || Math.abs(p.tx[k]! * p.tz[a]! - p.tz[k]! * p.tx[a]!) > 0.01) straight = false;
    }
    if (!straight) continue;
    const limit = p.half[k]! + p.runL[k]!;
    const run = limit + p.half[k]! + p.runR[k]! - START_INSET;
    const ox = p.tz[k]!;
    const oz = -p.tx[k]!;
    const fx = p.x[k]! + ox * limit;
    const fz = p.z[k]! + oz * limit;
    const clear = colliders.every((c) => {
      const t = Math.max(0, Math.min(1, ((c.x - (fx - ox * run)) * ox + (c.z - (fz - oz * run)) * oz) / run));
      return Math.hypot(c.x - (fx - ox * run * (1 - t)), c.z - (fz - oz * run * (1 - t))) >= c.r + 4;
    });
    if (clear && (!best || run > best.run)) best = { fx, fz, ox, oz, run };
  }
  if (!best) throw new Error("the oval has no clear straight wall");
  return best;
}

const WALL = straightWall();
/** What the sim does with the car in the 3 s after it is launched. */
type Hit = { travel: number; killed: boolean; thrown: boolean };

/** A sedan launched at `speed` from the road's far edge (`phase` of one 1/80 s step of travel closer), gas held, stepped by a pacer on the 1/80 s floor or the 1/240 s one. */
function play(speed: number, coarse: boolean, phase: number): Hit {
  const w = makeWorld();
  try {
    w.race.enter();
    w.race.command({ type: "quit" });
    w.race.command({ type: "options", options: { trackId: "oval", laps: 3, aiCount: 0, noReset: true } });
    w.race.reseed(1);
    w.race.command({ type: "start" });
    w.seat.mode = "drive";
    w.seat.carIndex = 0;
    w.seat.intent.analogGas = true;
    w.seat.intent.gas = 1;
    const pace = new SimPacer();
    pace.pin = coarse;
    const state = { acc: 0 };
    for (let n = 0; w.race.phase !== "racing" && n < 60 * 30; n++) frame(w, state, undefined, pace);
    expect(w.race.phase).toBe("racing");
    const car = w.cars[0]!;
    const back = WALL.run - (phase * speed) / 80;
    car.spawnFacing(WALL.fx - WALL.ox * back, WALL.fz - WALL.oz * back, Math.atan2(WALL.ox, WALL.oz), speed);
    for (let n = 0; n < 60 * 3; n++) frame(w, state, undefined, pace);
    return { travel: car.deform.engineTravel, killed: !car.deform.drivetrainAlive, thrown: car.driverOut !== null };
  } finally {
    w.race.exit();
    setGround(null);
  }
}

const played = new Map<string, Hit>();
/** `play`, once per distinct hit: the kill test of each floor and the floors' comparison read the same 64 runs. */
function hit(speed: number, coarse: boolean, phase: number): Hit {
  const key = `${speed} ${coarse} ${phase}`;
  const known = played.get(key);
  if (known) return known;
  const fresh = play(speed, coarse, phase);
  played.set(key, fresh);
  return fresh;
}

const SPEEDS = [30, 40, 55, 66];
const PHASES = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
/** Mean gap (m of engine block travel) between the floors over every hit: the 1/80 s grid's phase scatter averages out, a step-size dependence does not (measured 0.016 m, 0.020 m with dents kept). */
const SAME_MEAN = 0.025;
/** Worst gap (m) between the floors in any one hit: a sixth of the 0.45 m that kills (measured 0.063 m, 0.068 m with dents kept). */
const SAME_WORST = 0.075;

describe(`given a sedan flat out into the oval's straight wall at 30 to 66 m/s, from ${PHASES.length} approach phases against the step grid`, () => {
  const floorCases = [
    { it: "when the pacer steps at 1/240 s, then every hit kills the engine and throws the driver", coarse: false },
    { it: "when the pacer steps at 1/80 s, then every hit kills the engine and throws the driver", coarse: true },
  ] as const;
  for (const testCase of floorCases) {
    it(testCase.it, () => {
      const missed: string[] = [];
      for (const speed of SPEEDS) {
        for (const phase of PHASES) {
          const h = hit(speed, testCase.coarse, phase);
          if (!h.killed || !h.thrown) missed.push(`${speed} m/s phase ${phase}: block ${h.travel.toFixed(3)} m, killed ${h.killed}, thrown ${h.thrown}`);
        }
      }
      expect(missed).toHaveLength(0);
    });
  }

  it(`when the pacer steps at 1/80 s instead of 1/240 s, then the engine block travels as far: within ${SAME_MEAN} m on average and ${SAME_WORST} m hit for hit`, () => {
    const apart: string[] = [];
    let sum = 0;
    for (const speed of SPEEDS) {
      for (const phase of PHASES) {
        const fine = hit(speed, false, phase);
        const coarse = hit(speed, true, phase);
        const gap = Math.abs(coarse.travel - fine.travel);
        sum += gap;
        if (gap > SAME_WORST) apart.push(`${speed} m/s phase ${phase}: ${fine.travel.toFixed(3)} m at 1/240 s, ${coarse.travel.toFixed(3)} m at 1/80 s`);
      }
    }
    expect(apart).toHaveLength(0);
    const mean = sum / (SPEEDS.length * PHASES.length);
    expect(mean, `mean gap ${mean.toFixed(4)} m over ${SPEEDS.length * PHASES.length} hits`).toBeLessThanOrEqual(SAME_MEAN);
  });
});
