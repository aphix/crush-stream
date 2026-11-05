import { describe, expect, it } from "vitest";
import { cageOf } from "./car-cage-rig.ts";
import type { CarCage } from "./car-cage.ts";
import { buildCar } from "./drawn-body.test-util.ts";
import { CAR_STYLE_IDS } from "./car-variants.ts";
import { STYLE_CLASS } from "./vehicle-classes.ts";

/**
 * The cage the cars rest on and strike is the drawn body (docs/UNIFIED_CONTACT.md stage 3), and the body is mirror-symmetric: at rest its
 * cage reads the same at x and -x.
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
