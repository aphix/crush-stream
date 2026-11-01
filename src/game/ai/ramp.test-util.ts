import { beforeEach, type TestContext } from "vitest";
import { RAMP } from "./hunter.ts";

/** `RAMP.hold` as shipped, read before any test moves it. */
const SHIPPED_HOLD = RAMP.hold;

/** Run the test with the pack's aggression 1 from the green (the end of the ramp, today's pack); the shipped ramp is back when the test ends. */
export function fullAggression(t: TestContext): void {
  Reflect.set(RAMP, "hold", -Infinity);
  t.onTestFinished(() => void Reflect.set(RAMP, "hold", SHIPPED_HOLD));
}

/** Every test of the file runs at full aggression, so the rows that pin the full pack (its schedule, attack geometry, rams) stand; `onRamp` puts the shipped ramp back for the ramp's own rows. */
export function atFullAggression(): void {
  beforeEach(fullAggression);
}

/** The shipped ramp, from the green. */
export function onRamp(): void {
  Reflect.set(RAMP, "hold", SHIPPED_HOLD);
}
