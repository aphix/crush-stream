import { describe, it } from "vitest";
import { Clock, FakeField, HOLD, makeTraffic, STEP_SECONDS } from "./traffic-world.test-util.ts";

/** The traffic's own main-thread cost per sim step: its slice start, every car's input and its step, with `movers` driving and 10 kerb cars standing (the cars' motion is not counted). Run: `TRAFFIC_PROBE=1 npx vitest run <this file>`. */
const SECONDS = 600;
const SIZES = [6, 12, 24] as const;
const MICROSECONDS = 1000;

describe.skipIf(process.env.TRAFFIC_PROBE === undefined)("given traffic with N movers and a few kerb cars", () => {
  for (const movers of SIZES) {
    it(`when ${movers} movers drive for ${SECONDS} s of sim, then the cost per step is printed`, () => {
      const field = new FakeField();
      field.cars[0]!.stand(0, 0, 0);
      const traffic = makeTraffic(field, { movers, kerb: 10 });
      const clock = new Clock();
      const costs = new Float64Array(Math.ceil(SECONDS / STEP_SECONDS));
      for (let step = 0; step < costs.length; step++) {
        let cost = 0;
        let mark = performance.now();
        traffic.drive(field.cars);
        cost += performance.now() - mark;
        for (let id = 0; id < field.cars.length; id++) {
          const car = field.cars[id]!;
          if (car.stored) continue;
          mark = performance.now();
          const input = field.seats.has(id) ? null : traffic.inputOf(id, STEP_SECONDS);
          cost += performance.now() - mark;
          car.run(input ?? HOLD, STEP_SECONDS);
        }
        clock.seconds += STEP_SECONDS;
        mark = performance.now();
        traffic.step(clock.seconds, STEP_SECONDS);
        costs[step] = cost + performance.now() - mark;
      }
      const sorted = Float64Array.from(costs).sort();
      const mean = costs.reduce((sum, cost) => sum + cost, 0) / costs.length;
      const percentile = sorted[Math.floor(sorted.length * 0.99)]!;
      console.info(
        `traffic ${movers} movers + 10 kerb: mean ${(mean * MICROSECONDS).toFixed(1)} us/step, p99 ${(percentile * MICROSECONDS).toFixed(1)} us, max ${(sorted[sorted.length - 1]! * MICROSECONDS).toFixed(1)} us; driving ${traffic.counts().driving}, kerb ${traffic.counts().kerb}`,
      );
    });
  }
});
