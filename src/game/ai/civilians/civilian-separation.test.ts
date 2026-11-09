import { describe, expect, it } from "vitest";
import { firstMismatch } from "../../kernel/compare-arrays.test-util.ts";
import { hypot2 } from "../../kernel/physics-core.js";
import { BODY_GAP, MAX_OFFSET, PAIR_RANGE } from "./civilian-crowd-constants.ts";
import { CrowdSeparation } from "./civilian-separation.ts";

/** What the relaxation leaves of an overlap (m) in a chain of three, a few millimetres at most. */
const RESIDUAL = 0.005;
/** Float32 spots round to this (m). */
const FLOAT_ERROR = 1e-4;
const WALK = 1.4;

type Body = { x: number; z: number; velocityX?: number; velocityZ?: number; fixed?: boolean };

function place(separation: CrowdSeparation, bodies: readonly Body[]): void {
  for (const [index, body] of bodies.entries()) {
    separation.present[index] = 1;
    separation.fixed[index] = body.fixed === true ? 1 : 0;
    separation.brainX[index] = body.x;
    separation.brainZ[index] = body.z;
    separation.velocityX[index] = body.velocityX ?? 0;
    separation.velocityZ[index] = body.velocityZ ?? 0;
  }
}

function resolved(bodies: readonly Body[]): CrowdSeparation {
  const separation = new CrowdSeparation(bodies.length);
  place(separation, bodies);
  separation.resolve();
  return separation;
}

const gapBetween = (separation: CrowdSeparation, first: number, second: number): number => hypot2(separation.drawX[first]! - separation.drawX[second]!, separation.drawZ[first]! - separation.drawZ[second]!);
const offsetOf = (separation: CrowdSeparation, body: number): number => hypot2(separation.drawX[body]! - separation.brainX[body]!, separation.drawZ[body]! - separation.brainZ[body]!);

describe("given two civilians standing on one spot", () => {
  const separation = resolved([{ x: 3, z: 4 }, { x: 3, z: 4 }]);

  it("when they are placed, then they stand a body's width apart, each within the bound of where the brain has them", () => {
    expect(gapBetween(separation, 0, 1), "gap between them").toBeGreaterThanOrEqual(BODY_GAP - RESIDUAL);
    expect(Math.max(offsetOf(separation, 0), offsetOf(separation, 1)), "furthest from the brain's spot").toBeLessThanOrEqual(MAX_OFFSET + FLOAT_ERROR);
  });
});

describe("given two civilians walking at each other on one line, 0.2 m apart", () => {
  const separation = resolved([
    { x: 0, z: 0, velocityZ: WALK },
    { x: 0, z: 0.2, velocityZ: -WALK },
  ]);

  it("when they are placed, then they are a body's width apart and have stepped to each other's sides, not stood off along the line", () => {
    expect(gapBetween(separation, 0, 1), "gap between them").toBeGreaterThanOrEqual(BODY_GAP - RESIDUAL);
    expect(Math.abs(separation.drawX[0]! - separation.drawX[1]!), "sideways gap").toBeGreaterThan(0.2);
  });

  it("when they are listed, then their closing speed is the sum of their paces", () => {
    expect(separation.pairClosing[0], "closing speed").toBeCloseTo(2 * WALK, 5);
    expect(separation.pairDistance[0], "brain distance").toBeCloseTo(0.2, 5);
  });
});

describe("given two civilians walking apart", () => {
  it("when they are listed, then they are not closing", () => {
    const separation = resolved([
      { x: 0, z: 0, velocityZ: -WALK },
      { x: 0, z: 1, velocityZ: WALK },
    ]);
    expect(separation.pairClosing[0], "closing speed").toBeCloseTo(-2 * WALK, 5);
  });
});

describe("given three civilians standing 0.3 m apart in a row", () => {
  it("when they are placed, then every pair is a body's width apart", () => {
    const separation = resolved([{ x: 0, z: 0 }, { x: 0.3, z: 0 }, { x: 0.6, z: 0 }]);
    for (const [first, second] of [[0, 1], [1, 2], [0, 2]] as const) expect(gapBetween(separation, first, second), `gap between ${first} and ${second}`).toBeGreaterThanOrEqual(BODY_GAP - RESIDUAL);
  });
});

describe("given twelve civilians on one spot", () => {
  it("when they are placed, then none is drawn further from the brain's spot than the bound", () => {
    const separation = resolved(Array.from({ length: 12 }, () => ({ x: 0, z: 0 })));
    for (let body = 0; body < 12; body++) expect(offsetOf(separation, body), `offset of ${body}`).toBeLessThanOrEqual(MAX_OFFSET + FLOAT_ERROR);
  });
});

describe("given a civilian and a body that does not give way, 0.3 m apart", () => {
  it("when the other is a walker, then the civilian steps clear and the walker stays where he is", () => {
    const separation = resolved([{ x: 0, z: 0, velocityZ: WALK }, { x: 0, z: 0.3, fixed: true }]);
    expect(gapBetween(separation, 0, 1), "gap between them").toBeGreaterThanOrEqual(BODY_GAP - RESIDUAL);
    expect(separation.drawX[1], "walker's drawn x").toBe(0);
    expect(separation.drawZ[1], "walker's drawn z").toBe(Math.fround(0.3));
  });

  it("when the other is first in the list (a civilian seated), then the one walking is the one that moves", () => {
    const separation = resolved([{ x: 0, z: 0, fixed: true }, { x: 0, z: 0.3, velocityZ: -WALK }]);
    expect(gapBetween(separation, 0, 1), "gap between them").toBeGreaterThanOrEqual(BODY_GAP - RESIDUAL);
    expect(separation.drawX[0], "seated one's drawn x").toBe(0);
    expect(separation.drawZ[0], "seated one's drawn z").toBe(0);
  });
});

describe("given two civilians either side of a grid line, a fifth of a metre apart", () => {
  it("when they are placed, then they are still found and parted", () => {
    const separation = resolved([{ x: -0.1, z: 0 }, { x: 0.1, z: 0 }]);
    expect(separation.pairCount, "pairs").toBe(1);
    expect(gapBetween(separation, 0, 1), "gap between them").toBeGreaterThanOrEqual(BODY_GAP - RESIDUAL);
  });
});

describe("given two civilians further apart than the pair reach", () => {
  it("when they are placed, then they are not a pair and are not moved", () => {
    const separation = resolved([{ x: 0, z: 0 }, { x: PAIR_RANGE + 1, z: 0 }]);
    expect(separation.pairCount, "pairs").toBe(0);
    expect(offsetOf(separation, 0) + offsetOf(separation, 1), "offsets").toBe(0);
  });
});

describe("given a crowd placed, moved apart and placed again as it was", () => {
  it("when it is resolved the third time, then every drawn spot is exactly what the first gave", () => {
    const crowd = [{ x: 0, z: 0, velocityZ: WALK }, { x: 0, z: 0.2, velocityZ: -WALK }, { x: 0.2, z: 0.1 }];
    const apart = crowd.map((body, index) => ({ ...body, x: body.x + 50 * (index + 1) }));
    const separation = new CrowdSeparation(crowd.length);
    place(separation, crowd);
    separation.resolve();
    const first = [...separation.drawX, ...separation.drawZ];
    place(separation, apart);
    separation.resolve();
    place(separation, crowd);
    separation.resolve();
    expect(firstMismatch([...separation.drawX, ...separation.drawZ], first), "drawn spots").toBeUndefined();
  });
});
