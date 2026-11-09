import { describe, expect, it } from "vitest";
import { pooledCar } from "../contact/crash-scenarios.test-util.ts";
import { KPH_PER_MS } from "../kernel/constants.ts";
import { carGauge, gaugeDrift, gaugeLevel, gaugeMeter } from "./car-view.ts";

const CRUISE_MS = 10;
/** A speed change under half a km/h cannot move a whole-km/h display from its reading at a km/h boundary's middle. */
const WITHIN_A_DIGIT_MS = 0.05 / KPH_PER_MS;
const A_DIGIT_MS = 1.2 / KPH_PER_MS;

describe("given a car's gauge published for the HUD", () => {
  it("when the car's speed moves less than the display's digit, then the published speed is the same number, and when it moves a digit, it is not", () => {
    const car = pooledCar(0);
    car.velocity.set(CRUISE_MS, 0, 0);
    const cruising = carGauge(car).speedKph;
    car.velocity.set(CRUISE_MS + WITHIN_A_DIGIT_MS, 0, 0);
    expect(carGauge(car).speedKph, "speed after a change under the display's digit").toBe(cruising);
    car.velocity.set(CRUISE_MS + A_DIGIT_MS, 0, 0);
    expect(carGauge(car).speedKph, "speed after a change of a digit").not.toBe(cruising);
  });

  it("when the gauge is read, then the speed is a whole km/h and the dial, the damage and the nitro are to the hundredth", () => {
    const car = pooledCar(0);
    car.velocity.set(CRUISE_MS + 0.123, 0, 0);
    const gauge = carGauge(car);
    expect(gauge.speedKph, "speed in km/h").toBe(Math.round(gauge.speedKph));
    expect(gauge.rpm * 100, "revs in hundredths").toBeCloseTo(Math.round(gauge.rpm * 100), 9);
    expect(gauge.damage * 100, "damage in hundredths").toBeCloseTo(Math.round(gauge.damage * 100), 9);
  });

  it("when a meter, a cue and a slide are published, then each is at its display's resolution, and no meter stays none", () => {
    expect(gaugeLevel(0.4949), "a cue").toBeCloseTo(0.49, 9);
    expect(gaugeMeter(0.4951), "a meter").toBeCloseTo(0.5, 9);
    expect(gaugeMeter(null), "no meter").toBeNull();
    const drift = gaugeDrift({ s: 1.234, clean: false, paid: 0.5678 });
    expect(drift.s, "seconds of slide").toBeCloseTo(1.25, 9);
    expect(drift.clean, "clean").toBe(false);
    expect(drift.paid, "pay made").toBeCloseTo(0.57, 9);
  });
});
