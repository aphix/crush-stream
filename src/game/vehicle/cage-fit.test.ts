import { describe, expect, it } from "vitest";
import { cageLift, cageOf } from "./car-cage-rig.ts";
import type { CarCage } from "./car-cage.ts";
import type { DeformableCar } from "./car.ts";
import { buildCar, cellI, cellJ, cellX, cellZ, drawnField, NX } from "./drawn-body.test-util.ts";
import { CAR_STYLE_IDS, CAR_STYLES } from "./car-variants.ts";
import { STYLE_CLASS } from "./vehicle-classes.ts";

/**
 * The cage the cars rest on and strike is the drawn body (docs/UNIFIED_CONTACT.md stage 3), and the body is mirror-symmetric: at rest its
 * cage reads the same at x and -x, and its top over the fender crest stands at the drawn one.
 */

/** How far (m) a style's cage may read off its own mirror at rest. */
const MIRROR_M = 0.005;

/** Bilinear height of the node field `field` at frame (x, z); NaN when any of the four nodes has none. */
function fieldAt(cage: CarCage, field: Float32Array, x: number, z: number): number {
  const { step, nu, nv, u0, v0 } = cage.style;
  const fu = (x - u0) / step;
  const fv = (z - v0) / step;
  const i = Math.floor(fu);
  const j = Math.floor(fv);
  if (i < 0 || j < 0 || i + 1 >= nu || j + 1 >= nv) return NaN;
  const a = fu - i;
  const b = fv - j;
  const k = j * nu + i;
  return (field[k]! * (1 - a) + field[k + 1]! * a) * (1 - b) + (field[k + nu]! * (1 - a) + field[k + nu + 1]! * a) * b;
}

/** Sample spacings (m) off the 5 cm lattice's own, so a grid off the mirror plane cannot hide between nodes. */
const SAMPLE_X = 0.0431;
const SAMPLE_Z = 0.0317;

/** The largest |height at x - height at -x| (m) of `field` over the plan, read where both are known, with where, and how many samples were compared and had a height at +x and at -x. */
function mirrorGap(cage: CarCage, field: Float32Array): { gap: number; at: string; compared: number; plusSamples: number; minusSamples: number } {
  const { v0, nv, step } = cage.style;
  let gap = 0;
  let at = "";
  let [compared, plusSamples, minusSamples] = [0, 0, 0];
  for (let z = v0 + 0.0173; z < v0 + (nv - 1) * step; z += SAMPLE_Z) {
    for (let x = 0.0137; x < 1.3; x += SAMPLE_X) {
      const plus = fieldAt(cage, field, x, z);
      const mirrored = fieldAt(cage, field, -x, z);
      plusSamples += Number.isFinite(plus) ? 1 : 0;
      minusSamples += Number.isFinite(mirrored) ? 1 : 0;
      if (!Number.isFinite(plus) || !Number.isFinite(mirrored)) continue;
      compared++;
      if (Math.abs(plus - mirrored) > gap) [gap, at] = [Math.abs(plus - mirrored), `x ±${x.toFixed(2)} z ${z.toFixed(2)}: ${mirrored.toFixed(3)} left, ${plus.toFixed(3)} right`];
    }
  }
  return { gap, at, compared, plusSamples, minusSamples };
}

describe("given every body style's cage at rest", () => {
  for (const id of CAR_STYLE_IDS) {
    it(`when a ${id}'s cage top and bottom are read at x and -x, then they agree within ${MIRROR_M * 1000} mm everywhere the plan has both`, (t) => {
      const car = buildCar(id, STYLE_CLASS[id]);
      car.spawnFacing(0, 0, 0, 0);
      const cage = cageOf(car);
      const top = mirrorGap(cage, cage.fields.top);
      const bottom = mirrorGap(cage, cage.fields.bottom);
      t.annotate(`top ${(top.gap * 1000).toFixed(1)} mm (${top.at}); bottom ${(bottom.gap * 1000).toFixed(1)} mm (${bottom.at})`);
      for (const [name, read] of [["top", top], ["bottom", bottom]] as const) {
        expect(read.compared, `${name}: samples with a height at x and -x`).toBeGreaterThan(1000);
        expect(read.minusSamples, `${name}: samples with a height at -x equal those at +x`).toBe(read.plusSamples);
      }
      expect(top.gap, `top: ${top.at}`).toBeLessThanOrEqual(MIRROR_M);
      expect(bottom.gap, `bottom: ${bottom.at}`).toBeLessThanOrEqual(MIRROR_M);
      car.dispose();
    });
  }
});

/** A band of the fender's plan (car frame, m; |x| from x0 to x1, z from z0 to z1). */
type Band = { x0: number; x1: number; z0: number; z1: number };
/** The fender crest beside the hood, ahead of the cowl, inside the tyre's track; and the strip outboard of it that a tread over the hood meets. A band's bounds: the most (m) the cage may stand over and under the drawn top, and how many drawn cells may have no cage height. */
const FENDER_BANDS = [
  { name: "fender crest", band: { x0: 0.6, x1: 0.7, z0: 1.2, z1: 1.7 }, over: 0.016, under: 0.02, holes: 0 },
  { name: "fender strip a tread meets outboard of the crest", band: { x0: 0.7, x1: 0.75, z0: 1.45, z1: 1.75 }, over: 0.012, under: 0.018, holes: 2 },
] as const;

/** The most (over) and least (under) of the cage's top over the drawn top (m) in the cells of `band` both have a height at, and the drawn cells the cage has none for. */
function bandGap(car: DeformableCar, cage: CarCage, drawn: Float32Array, band: Band): { over: number; under: number; holes: number } {
  const lift = cageLift(car);
  let [over, under, holes] = [-Infinity, Infinity, 0];
  for (let j = cellJ(band.z0); j <= cellJ(band.z1); j++) {
    for (let i = cellI(-band.x1); i <= cellI(band.x1); i++) {
      const ax = Math.abs(cellX(i));
      if (ax < band.x0 || ax > band.x1) continue;
      const y = drawn[j * NX + i]!;
      const h = fieldAt(cage, cage.fields.top, cellX(i), cellZ(j));
      if (!Number.isFinite(y)) continue;
      if (!Number.isFinite(h)) {
        holes++;
        continue;
      }
      over = Math.max(over, h + lift - y);
      under = Math.min(under, h + lift - y);
    }
  }
  return { over, under, holes };
}

describe("given a body style whose drawn hood is inset at its fenders, at rest", () => {
  for (const id of CAR_STYLE_IDS.filter((s) => CAR_STYLES[s].hood.inset !== undefined)) {
    for (const { name, band, over: overBound, under: underBound, holes: holesBound } of FENDER_BANDS) {
      it(`when the ${id}'s cage top is read over its ${name}, then it stands at most ${overBound * 100} cm over the drawn top and ${underBound * 100} cm under, with at most ${holesBound} drawn cells without cage`, (t) => {
        const car = buildCar(id, STYLE_CLASS[id]);
        car.spawnFacing(0, 0, 0, 0);
        const cage = cageOf(car);
        const { over, under, holes } = bandGap(car, cage, drawnField(car).top, band);
        expect(Number.isFinite(over) && Number.isFinite(under), "the band has cells both have a height at").toBe(true);
        t.annotate(`${name}: over ${(over * 1000).toFixed(1)} mm, under ${(under * 1000).toFixed(1)} mm, ${holes} cells without cage`);
        expect(over, `cage over the drawn ${name}`).toBeLessThanOrEqual(overBound);
        expect(under, `cage under the drawn ${name}`).toBeGreaterThanOrEqual(-underBound);
        expect(holes, `drawn ${name} cells without cage`).toBeLessThanOrEqual(holesBound);
        car.dispose();
      });
    }
  }
});
