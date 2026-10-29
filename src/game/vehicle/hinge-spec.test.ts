import { describe, expect, it } from "vitest";
import type { BootSpec } from "./car-variants.ts";
import { LIFTGATE, lidAccel, lidSpec } from "./hinge-spec.ts";

const LEVEL = { upY: 1, upZ: 0 };
// Boot lines (car frame m) of the new sedan, truck, hatch and SUV.
const DECK: BootSpec = { kind: "lid", z0: -1.65, z1: -2.06, origin: [0.97, -1.62] };
const DROP: BootSpec = { kind: "tailgate", y0: 0.58, origin: [1.19, -2.18], pivot: [0.58, -2.18] };
const HATCH: BootSpec = { kind: "tailgate", y0: 0.57, z0: -1.758, origin: [0.93, -1.6], pivot: [1.245, -1.095] };
const SUV: BootSpec = { kind: "tailgate", y0: 0.66, z0: -2.11, origin: [1.09, -2.088], pivot: [1.52, -1.6], swing: LIFTGATE };

describe("given a deck lid, a drop tailgate, a hatch and a liftgate hinged on each style's boot", () => {
  it("when a deck lid is read, then it opens about +x, its chord level and rearward, to its swing's rise", () => {
    const s = lidSpec(DECK);
    expect(s.dir).toBe(1);
    expect(s.uy === 0 && s.uz === -1, `chord (${s.uy}, ${s.uz})`).toBeTruthy();
    expect(Math.abs(lidSpec({ ...DECK, swing: LIFTGATE }).stop - LIFTGATE.rise)).toBeLessThan(1e-12);
    expect(s.stop > 0.9 && s.stop < 1.3, `a trunk lid opens ${s.stop} rad`).toBeTruthy();
    expect(s.lift, "torsion bars lift it").toBeGreaterThan(1);
  });

  it("when a tailgate hinges at its bottom edge, then it is a drop gate that opens about −x down to level", () => {
    const s = lidSpec(DROP);
    expect(s.dir).toBe(-1);
    expect(Math.abs(s.stop - Math.PI / 2), `stop ${s.stop}`).toBeLessThan(1e-9);
    expect(s.lift, "it hangs on its cables, no struts").toBe(0);
  });

  it("when a hatch or liftgate hinges at the roof, then its chord runs to the panel's bottom edge and it opens about +x", () => {
    const hatch = lidSpec(HATCH);
    const suv = lidSpec(SUV);
    expect(hatch.dir === 1 && suv.dir === 1).toBeTruthy();
    expect(hatch.lift, "gas struts").toBeGreaterThan(1);
    expect(suv.kg).toBe(LIFTGATE.kg);
    expect(Math.abs(hatch.length - Math.hypot(0.57 - 1.245, -1.758 + 1.095)), `hatch chord ${hatch.length}`).toBeLessThan(1e-12);
    expect(hatch.stop > 0.5 && suv.stop > 0.5, `stops ${hatch.stop}, ${suv.stop}`).toBeTruthy();
  });
});

describe("given an unlatched lid under gravity, its struts and the car's own acceleration", () => {
  const lid = lidSpec(DECK);

  it("when a shut deck lid is unlatched on a level car, then struts lift it, a bare lid falls shut, a balanced one stays", () => {
    expect(lidAccel(lid, 0, LEVEL.upY, LEVEL.upZ, 0)).toBeGreaterThan(0);
    expect(lidAccel({ ...lid, lift: 0 }, 0.3, LEVEL.upY, LEVEL.upZ, 0)).toBeLessThan(0);
    expect(lidAccel({ ...lid, lift: 1 }, 0.3, LEVEL.upY, LEVEL.upZ, 0)).toBe(0);
  });

  it("when the car is upside down, then even a balanced lid falls open", () => {
    expect(lidAccel({ ...lid, lift: 1 }, 0.3, -1, 0, 0)).toBeGreaterThan(0);
  });

  it("when the car brakes, then an open lid swings further open; when it accelerates, then it swings shut", () => {
    const balanced = { ...lid, lift: 1 };
    expect(lidAccel(balanced, 0.8, LEVEL.upY, LEVEL.upZ, -6)).toBeGreaterThan(0);
    expect(lidAccel(balanced, 0.8, LEVEL.upY, LEVEL.upZ, 6)).toBeLessThan(0);
  });

  it("when a drop gate is unlatched, then its weight lets it down, and once level it presses on its stop", () => {
    const gate = lidSpec(DROP);
    expect(lidAccel(gate, 0.1, LEVEL.upY, LEVEL.upZ, 0)).toBeGreaterThan(0);
    expect(lidAccel(gate, gate.stop, LEVEL.upY, LEVEL.upZ, 0)).toBeGreaterThan(0);
  });

  it("when a liftgate is unlatched shut, then its gas struts lift it", () => {
    const suv = lidSpec(SUV);
    expect(lidAccel(suv, 0, LEVEL.upY, LEVEL.upZ, 0)).toBeGreaterThan(0);
    expect(lidAccel(suv, suv.stop, LEVEL.upY, LEVEL.upZ, 0), "still pressing on its stop when open").toBeGreaterThan(0);
  });
});
