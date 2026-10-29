import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { BootSpec } from "./car-variants.ts";
import { LIFTGATE, lidAccel, lidSpec } from "./hinge-spec.ts";

const LEVEL = { upY: 1, upZ: 0 };
// Boot lines (car frame m) of the new sedan, truck, hatch and SUV.
const DECK: BootSpec = { kind: "lid", z0: -1.65, z1: -2.06, origin: [0.97, -1.62] };
const DROP: BootSpec = { kind: "tailgate", y0: 0.58, origin: [1.19, -2.18], pivot: [0.58, -2.18] };
const HATCH: BootSpec = { kind: "tailgate", y0: 0.57, z0: -1.758, origin: [0.93, -1.6], pivot: [1.245, -1.095] };
const SUV: BootSpec = { kind: "tailgate", y0: 0.66, z0: -2.11, origin: [1.09, -2.088], pivot: [1.52, -1.6], swing: LIFTGATE };

describe("lid hinges from each style's boot", () => {
  it("when a deck lid is read, then it opens about +x, its chord level and rearward, to its swing's rise", () => {
    const s = lidSpec(DECK);
    assert.equal(s.dir, 1);
    assert.ok(s.uy === 0 && s.uz === -1, `chord (${s.uy}, ${s.uz})`);
    assert.ok(Math.abs(lidSpec({ ...DECK, swing: LIFTGATE }).stop - LIFTGATE.rise) < 1e-12);
    assert.ok(s.stop > 0.9 && s.stop < 1.3, `a trunk lid opens ${s.stop} rad`);
    assert.ok(s.lift > 1, "torsion bars lift it");
  });

  it("when a tailgate hinges at its bottom edge, then it is a drop gate that opens about −x down to level", () => {
    const s = lidSpec(DROP);
    assert.equal(s.dir, -1);
    assert.ok(Math.abs(s.stop - Math.PI / 2) < 1e-9, `stop ${s.stop}`);
    assert.equal(s.lift, 0, "it hangs on its cables, no struts");
  });

  it("when a hatch or liftgate hinges at the roof, then its chord runs to the panel's bottom edge and it opens about +x", () => {
    const hatch = lidSpec(HATCH);
    const suv = lidSpec(SUV);
    assert.ok(hatch.dir === 1 && suv.dir === 1);
    assert.ok(hatch.lift > 1, "gas struts");
    assert.equal(suv.kg, LIFTGATE.kg);
    assert.ok(Math.abs(hatch.length - Math.hypot(0.57 - 1.245, -1.758 + 1.095)) < 1e-12, `hatch chord ${hatch.length}`);
    assert.ok(hatch.stop > 0.5 && suv.stop > 0.5, `stops ${hatch.stop}, ${suv.stop}`);
  });
});

describe("the lid's swing law (gravity, struts, the car's acceleration)", () => {
  const lid = lidSpec(DECK);

  it("when a shut deck lid is unlatched on a level car, then struts lift it, a bare lid falls shut, a balanced one stays", () => {
    assert.ok(lidAccel(lid, 0, LEVEL.upY, LEVEL.upZ, 0) > 0);
    assert.ok(lidAccel({ ...lid, lift: 0 }, 0.3, LEVEL.upY, LEVEL.upZ, 0) < 0);
    assert.equal(lidAccel({ ...lid, lift: 1 }, 0.3, LEVEL.upY, LEVEL.upZ, 0), 0);
  });

  it("when the car is upside down, then even a balanced lid falls open", () => {
    assert.ok(lidAccel({ ...lid, lift: 1 }, 0.3, -1, 0, 0) > 0);
  });

  it("when the car brakes, then an open lid swings further open; when it accelerates, then it swings shut", () => {
    const balanced = { ...lid, lift: 1 };
    assert.ok(lidAccel(balanced, 0.8, LEVEL.upY, LEVEL.upZ, -6) > 0);
    assert.ok(lidAccel(balanced, 0.8, LEVEL.upY, LEVEL.upZ, 6) < 0);
  });

  it("when a drop gate is unlatched, then its weight lets it down, and once level it presses on its stop", () => {
    const gate = lidSpec(DROP);
    assert.ok(lidAccel(gate, 0.1, LEVEL.upY, LEVEL.upZ, 0) > 0);
    assert.ok(lidAccel(gate, gate.stop, LEVEL.upY, LEVEL.upZ, 0) > 0);
  });

  it("when a liftgate is unlatched shut, then its gas struts lift it", () => {
    const suv = lidSpec(SUV);
    assert.ok(lidAccel(suv, 0, LEVEL.upY, LEVEL.upZ, 0) > 0);
    assert.ok(lidAccel(suv, suv.stop, LEVEL.upY, LEVEL.upZ, 0) > 0, "still pressing on its stop when open");
  });
});
