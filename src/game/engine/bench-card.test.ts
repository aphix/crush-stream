import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { INITIAL_HUD, type CrashHudState } from "../hud/hud-store.ts";
import { DECIMALS, hudSettings, roundCard } from "./bench-card.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

/** A card as the bench sent it before the card was shortened: a real one, from a phone (strip, Ultra, 28 cars; 17.9 kB, the HUD's whole state in it). */
const OLD = JSON.parse(readFileSync(new URL("./bench-card.fixture.json", import.meta.url), "utf8")) as { hud: CrashHudState; result: Record<string, unknown> };

/** The card as `engine-bench.ts` `payload` writes it now. */
const NEW = { ...OLD, hud: hudSettings(OLD.hud, INITIAL_HUD), result: roundCard(OLD.result) };

/** Every number in `value` with the dot path it sits under (array elements take their array's name). */
function numbers(value: unknown, path: string[] = []): { key: string; n: number }[] {
  if (typeof value === "number") return [{ key: path.at(-1)!, n: value }];
  if (Array.isArray(value)) return value.flatMap((v) => numbers(v, path));
  if (typeof value === "object" && value !== null) return Object.entries(value).flatMap(([k, v]) => numbers(v, [...path, k]));
  return [];
}

describe("given a real bench card from a phone", () => {
  test("when the card is written for the wire, then its JSON is 9 kB or less (it was 17.9 kB)", () => {
    expect(JSON.stringify(OLD).length, "the fixture is the old, whole card").toBeGreaterThan(17_000);
    const bytes = JSON.stringify(NEW).length;
    expect(bytes, `${bytes} bytes`).toBeLessThanOrEqual(9 * 1024);
  });

  test("when the numbers are rounded, then each one named in the table is a multiple of its unit, within half a unit of what was measured", () => {
    const before = numbers(OLD.result);
    const after = numbers(NEW.result);
    expect(after.length).toBe(before.length);
    let checked = 0;
    for (const [i, { key, n }] of after.entries()) {
      const decimals = DECIMALS[key];
      if (decimals === undefined) {
        expect(n, `${key} is not in the table and keeps every digit`).toBe(before[i]!.n);
        continue;
      }
      checked++;
      const unit = 10 ** -decimals;
      expect(Math.abs(n - before[i]!.n), `${key}: ${before[i]!.n} -> ${n}`).toBeLessThanOrEqual(unit / 2 + 1e-9);
      expect(Number(n.toFixed(decimals)), `${key}: ${n} has more than ${decimals} decimals`).toBe(n);
    }
    expect(checked, `${checked} numbers were rounded`).toBeGreaterThan(100);
  });

  test("when the card is written, then only the numbers change: every key and non-number is as it was, and rounding twice is rounding once", () => {
    const shape = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x: unknown) => (typeof x === "number" ? 0 : x)));
    expect(JSON.stringify(shape(NEW.result))).toBe(JSON.stringify(shape(OLD.result)));
    expect(JSON.stringify(roundCard(NEW.result))).toBe(JSON.stringify(NEW.result));
  });
});

describe("given the HUD's state at the end of a bench", () => {
  test("when the HUD is at its defaults, then the card carries nothing of it", () => {
    expect(Object.keys(hudSettings(INITIAL_HUD, INITIAL_HUD)), "settings kept at defaults").toHaveLength(0);
  });

  test("when a setting differs from its default, then it is kept, and the readouts (the race, the board, the clock) never are", () => {
    const hud = { ...INITIAL_HUD, squash: 0.5, night: true, elapsed: 12, race: {} as CrashHudState["race"], derbyBoard: [{ id: 1, name: "x", score: 1, alive: true, out: false, clock: 0, watched: false }] };
    const kept = hudSettings(hud, INITIAL_HUD);
    expect(firstMismatch(Object.keys(kept).sort(), ["night", "squash"]), "kept keys").toBeUndefined();
    expect(kept.squash, "squash").toBe(0.5);
    expect(kept.night, "night").toBe(true);
  });

  test("when the real card's HUD is cut, then what is left are the four settings it differed in", () => {
    expect(firstMismatch(Object.keys(NEW.hud).sort(), ["cageCount", "carCount", "fxTier", "seat"])).toBeUndefined();
  });
});
