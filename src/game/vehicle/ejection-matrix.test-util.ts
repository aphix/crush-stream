import { describe, expect, it } from "vitest";
import { collide as collideOnce, ejectBar, strikerShare, type Hit, type Outcome } from "./ejection.test-util.ts";
import { VEHICLE_CLASS_IDS, type VehicleClassId } from "./vehicle-classes.ts";

/**
 * Who is thrown, and what the engine is left with, for every striker × struck class pair of the three hits, through the
 * sandbox engine step at the HUD's defaults (squash 0.32, buckle 0.45, realism 0.25, a fleet's kill limits). Expected
 * outcomes are the calibration's (docs/CRUSH_CALIBRATION.md): the crush grows with the speed that reaches the
 * struck end (a car's share of the closing is M/(m+M), so a T-bone or rear-end striker feels half the closing a
 * head-on car does), a lethal head-on kills and throws both drivers, and a door or tail hit spares the struck car's
 * engine by design (the block moves along the car, not across it); a lethal T-bone still throws the struck driver out of his door. Each
 * hit is its own test file (`ejection-matrix.test.ts` head-on, `-tbone`, `-rear`), so the three run side by side. Not a test file itself.
 */
const CLASSES = VEHICLE_CLASS_IDS.filter((id) => id !== "police" && id !== "muscle");
const PAIRS = CLASSES.flatMap((a) => CLASSES.map((b) => [a, b] as const));

/** Closing speed (m/s): a head-on is this per car, a T-bone or rear-end this on the striker alone. A survivable head-on keeps a hatchback's share against a monster truck (22 × 2900/4290 = 14.9 m/s) under its 15.6 m/s alive bar. */
const SURVIVABLE: Record<Hit, number> = { "head-on": 11, "t-bone": 20, "rear-end": 20 };
const LETHAL: Record<Hit, number> = { "head-on": 40, "t-bone": 55, "rear-end": 55 };
/** A lethal T-bone's struck driver stays in when the striker's share of the closing is under his alive bar (`ejectBar`): a sedan into a monster truck is 55 × 1400/4300 = 17.9 m/s against 20.9, a hatchback 17.8. */
const struckStays = (a: VehicleClassId, b: VehicleClassId): boolean => LETHAL["t-bone"] * strikerShare(a, b) < ejectBar(b);

const label = (hit: Hit, a: VehicleClassId, b: VehicleClassId, mps: number): string => `${hit} ${a} into ${b} at ${mps} m/s`;

/** Health may only fall as the speed rises: a faster hit leaves at most this much more (a tolerance for the sim's own jitter). */
const HEALTH_JITTER = 0.02;

/** Each hit, pair and speed is played once: the lethal and the sweep rows read the same 40 and 55 m/s crashes. */
const played = new Map<string, [Outcome, Outcome]>();
function collide(hit: Hit, a: VehicleClassId, b: VehicleClassId, mps: number): [Outcome, Outcome] {
  const key = `${hit} ${a} ${b} ${mps}`;
  let out = played.get(key);
  if (!out) played.set(key, (out = collideOnce(hit, a, b, mps)));
  return out;
}

export function ejectionMatrix(hit: Hit): void {
  describe(`given every striker and struck class pair (police and muscle left out) in a ${hit} hit, at the HUD's default crush settings`, () => {
    it(`when a ${hit} hits at the survivable ${SURVIVABLE[hit]} m/s, then nobody is thrown and both engines stay near whole, for every class pair`, () => {
      for (const [a, b] of PAIRS) {
        const [striker, struck] = collide(hit, a, b, SURVIVABLE[hit]);
        for (const [who, o] of [["striker", striker], ["struck", struck]] as const) {
          const where = `${label(hit, a, b, SURVIVABLE[hit])}, ${who}`;
          expect(o.thrown, `${where}: thrown`).toBe(false);
          expect(o.alive && o.health >= 0.6, `${where}: health ${o.health.toFixed(2)}`).toBeTruthy();
        }
      }
    });

    it(`when a ${hit} hits at the lethal ${LETHAL[hit]} m/s, then it kills ${hit === "head-on" ? "and throws both drivers" : hit === "t-bone" ? "and throws both drivers (the struck one unless he outweighs the striker past his bar), and spares the struck car's engine" : "and throws the striker's driver, and spares the struck car's engine and driver"}, for every class pair`, () => {
      for (const [a, b] of PAIRS) {
        const [striker, struck] = collide(hit, a, b, LETHAL[hit]);
        const where = label(hit, a, b, LETHAL[hit]);
        expect(striker.thrown, `${where}: striker not thrown (health ${striker.health.toFixed(2)}, block ${striker.travel.toFixed(3)} m)`).toBe(true);
        expect(striker.health, `${where}: striker health ${striker.health.toFixed(2)}`).toBeLessThanOrEqual(0.2);
        if (hit === "head-on") {
          expect(struck.thrown, `${where}: struck not thrown (health ${struck.health.toFixed(2)}, block ${struck.travel.toFixed(3)} m)`).toBe(true);
          expect(struck.health, `${where}: struck health ${struck.health.toFixed(2)}`).toBeLessThanOrEqual(0.2);
        } else {
          expect(struck.thrown, `${where}: struck ${struck.thrown ? "thrown" : "not thrown"}`).toBe(hit === "t-bone" && !struckStays(a, b));
          expect(struck.alive && struck.health >= 0.8, `${where}: struck health ${struck.health.toFixed(2)}`).toBeTruthy();
        }
      }
    });

    it(`when a ${hit} is made faster, then it never leaves a striker or a head-on car healthier, nor un-throws a driver, for every class pair`, () => {
      const speeds = hit === "head-on" ? [15, 20, 25, 30, 40, 55] : [30, 35, 40, 45, 55];
      for (const [a, b] of PAIRS) {
        let prev: [Outcome, Outcome] | null = null;
        let prevMps = 0;
        for (const mps of speeds) {
          const now = collide(hit, a, b, mps);
          if (prev) {
            const cars = hit === "head-on" ? [0, 1] : [0];
            for (const k of cars) {
              const where = `${hit} ${a} into ${b}, ${k === 0 ? "striker" : "struck"}: ${prevMps} → ${mps} m/s`;
              expect(now[k]!.health, `${where}: health ${prev[k]!.health.toFixed(2)} → ${now[k]!.health.toFixed(2)}`).toBeLessThanOrEqual(prev[k]!.health + HEALTH_JITTER);
              expect(now[k]!.thrown || !prev[k]!.thrown, `${where}: thrown at ${prevMps} m/s, not at ${mps}`).toBeTruthy();
            }
          }
          prev = now;
          prevMps = mps;
        }
      }
    });
  });
}
