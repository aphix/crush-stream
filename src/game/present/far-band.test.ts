import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BAND_HYSTERESIS_M, FarBand, type BandCell } from "./far-band.ts";

const NEAR_M = 70;
const cell = (x: number, z: number, far: boolean): BandCell => ({ x, z, size: 96, near: new THREE.Object3D(), far: far ? new THREE.Object3D() : null });

describe("given a far band", () => {
  // mutation: sed -i 's/Math.max(Math.abs(eyeX - c.x) - half, 0)/Math.abs(eyeX - c.x)/' src/game/present/far-band.ts
  it("when a cell's square is 3 m from the eye while its centre is 71+ m away, then it is near", () => {
    const c = cell(100, 0, true);
    new FarBand([c], NEAR_M).frame(100 - 48 - 3, 0);
    expect(c.near.visible).toBe(true);
    expect(c.far!.visible).toBe(true);
  });

  // mutation: sed -i 's/d < this.nearM;/d < this.nearM + 1000;/' src/game/present/far-band.ts
  it("when the eye is outside nearM, then the cell is far: its near mesh hides and its far one shows", () => {
    const c = cell(0, 0, true);
    c.far!.visible = false;
    new FarBand([c], NEAR_M).frame(48 + NEAR_M + BAND_HYSTERESIS_M + 1, 0);
    expect(c.near.visible).toBe(false);
    expect(c.far!.visible).toBe(true);
  });

  // mutation: sed -i 's/d <= this.nearM + BAND_HYSTERESIS_M/d <= this.nearM/' src/game/present/far-band.ts
  it("when the eye moves between nearM and nearM + 8, then nothing flips either way", () => {
    const c = cell(0, 0, true);
    const band = new FarBand([c], NEAR_M);
    for (const gap of [NEAR_M - 1, NEAR_M + 3, NEAR_M + BAND_HYSTERESIS_M - 1, NEAR_M - 1]) {
      band.frame(48 + gap, 0);
      expect(c.near.visible, `${gap}`).toBe(true);
    }
    band.frame(48 + NEAR_M + BAND_HYSTERESIS_M + 1, 0);
    expect(c.near.visible).toBe(false);
    for (const gap of [NEAR_M + 3, NEAR_M + 1]) {
      band.frame(48 + gap, 0);
      expect(c.near.visible, `${gap}`).toBe(false);
    }
    band.frame(48 + NEAR_M - 1, 0);
    expect(c.near.visible).toBe(true);
  });

  // mutation: sed -i 's/      c.near.visible = true;$/      c.near.visible = false;/' src/game/present/far-band.ts
  it("when it is stopped, then every near mesh shows and every far one hides", () => {
    const a = cell(0, 0, true);
    const b = cell(500, 0, false);
    const band = new FarBand([a, b], NEAR_M);
    band.frame(0, 0);
    band.stop();
    expect([a.near.visible, a.far!.visible, b.near.visible]).toEqual([true, false, true]);
    band.frame(1000, 0);
    expect([a.near.visible, a.far!.visible]).toEqual([false, true]);
    band.stop();
    expect([a.near.visible, a.far!.visible]).toEqual([true, false]);
  });
});
