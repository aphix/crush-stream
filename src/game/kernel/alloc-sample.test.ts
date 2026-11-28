import { describe, expect, it } from "vitest";
import { FLAT_READS, untilQuiet } from "./alloc-sample.test-util.ts";

/** Seconds the rows let a reading stay above its bound: short enough to cost nothing. */
const WAIT_S = 0.03;
/** Wall ms one read of the rows takes, and one that alone outlasts the wait. */
const READ_MS = 3;
const SLOW_READ_MS = 40;
const BOUND = 16;
/** A real allocation's readings: within a few percent of themselves. */
const STEADY = [100, 103, 98, 101, 99];

const spend = (ms: number): void => {
  const end = performance.now() + ms;
  while (performance.now() < end);
};

describe("given a row that reads again until its reading is at most its bound", () => {
  it("when the first reading is within the bound, then it is read once and returned", () => {
    let reads = 0;
    const reading = untilQuiet(() => (++reads, BOUND), BOUND, WAIT_S);
    expect(reading, "the reading").toBe(BOUND);
    expect(reads, "reads").toBe(1);
  });

  it("when the reading falls to the bound after a few reads (cold code optimized), then the quiet reading is returned", () => {
    const readings = [400, 200, 90, 40, 12];
    const reading = untilQuiet((attempt) => readings[attempt]!, BOUND, WAIT_S);
    expect(reading, "the reading").toBe(12);
  });

  it("when the reading keeps falling above the bound for longer than the wait, then it is read on until it is quiet", () => {
    const reading = untilQuiet((attempt) => (spend(READ_MS), 1000 * 0.8 ** attempt), BOUND, WAIT_S);
    expect(reading, "the quiet reading").toBeLessThanOrEqual(BOUND);
  });

  it("when the reading stays above the bound within a few percent of itself (a real allocation), then it is read for the whole wait and the last reading is returned over the bound", () => {
    let reads = 0;
    const started = performance.now();
    const reading = untilQuiet((attempt) => (spend(READ_MS), reads++, STEADY[attempt % STEADY.length]!), BOUND, WAIT_S);
    expect(reading, "the last reading").toBeGreaterThan(BOUND);
    expect(performance.now() - started, "wall ms spent").toBeGreaterThanOrEqual(WAIT_S * 1000);
    expect(performance.now() - started, "wall ms spent").toBeLessThan(WAIT_S * 1000 * 10);
    expect(reads, "reads").toBeGreaterThan(FLAT_READS);
  });

  it("when each read alone outlasts the wait and stays above the bound, then it is still read the flat reads before it is called a real allocation", () => {
    let reads = 0;
    untilQuiet((attempt) => (spend(SLOW_READ_MS), reads++, STEADY[attempt % STEADY.length]!), BOUND, WAIT_S);
    expect(reads, "reads").toBe(FLAT_READS + 1);
  });
});
