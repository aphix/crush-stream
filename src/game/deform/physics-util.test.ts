import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { dtImpulseScale, TRANSFER } from "../kernel/physics-core.js";
import {
  CRASH,
  applyGroundFriction,
  leftoverCrumple,
  round4,
  snapshotPoints,
  vec3,
  clampSpeed,
  regionSoftness,
  crushGate,
  closingKeScale,
  forceTransfer,
  regionCrushBands,
  satPushCap,
  hypot2,
  hypot3,
} from "./physics-util.ts";
import { FINE_HZ, FRAME_HZ } from "../kernel/constants.ts";

describe("given the CRASH constants (the tuned crash-physics numbers, researched for a sedan and from NCAP crash tests)", () => {
  it("when the pulse length, crush distance and tyre friction values are read, then they sit in the published bands (pulse 0.09–0.16 s, crush 0.45–0.75 m, friction 0.9 at peak, 0.75 sliding, 0.4 scuffing)", () => {
    expect(CRASH.pulseSec >= 0.09 && CRASH.pulseSec <= 0.16).toBeTruthy();
    expect(CRASH.crushMeters >= 0.45 && CRASH.crushMeters <= 0.75).toBeTruthy();
    expect(CRASH.muPeak).toBe(0.9);
    expect(CRASH.muSlide).toBe(0.75);
    expect(CRASH.muScuff).toBe(0.4);
  });

  it("when the scuff, slide and peak tyre-friction values are compared, then a scuffing tyre is slipperier than a sliding one, which is slipperier than peak grip", () => {
    expect(CRASH.muScuff, "scuff must be slippier than a sliding tire").toBeLessThan(CRASH.muSlide);
    expect(CRASH.muSlide).toBeLessThan(CRASH.muPeak);
  });

  it("when the graze cutoff and the top mass speed are read, then the graze cutoff is between 1 and 3 m/s (above walking speed, below a parking-lot bump) and the top speed is between 40 and 80 m/s", () => {
    expect(CRASH.grazeMps > 1 && CRASH.grazeMps < 3).toBeTruthy();
    expect(CRASH.maxMassMps > 40 && CRASH.maxMassMps < 80).toBeTruthy();
  });

  it("when the crush distance is compared with the 1.5 m full leftover zone, then the two differ, a full 1.5 m zone reads fully left over and a crush-distance-long zone reads under half", () => {
    // leftoverCrumple uses /1.5 because rest nose-cell is ~1.6m. Using crushMeters as
    // that divisor would saturate leftover to 1 after only 0.65m of remaining length.
    expect(CRASH.crushMeters).not.toBe(1.5);
    expect(leftoverCrumple(1.5)).toBe(1);
    expect(leftoverCrumple(CRASH.crushMeters)).toBeLessThan(0.5);
  });
});

describe("given clampSpeed (limits a velocity to the top speed a part of the car may have)", () => {
  it("when it is given a NaN velocity, a 1e6 m/s velocity and a 20 m/s velocity, then the NaN one is zeroed, the huge one is cut to the top speed and the 20 m/s crash speed is kept", () => {
    const a = new THREE.Vector3(Number.NaN, 0, 4);
    clampSpeed(a);
    expect(a.length()).toBe(0);
    const b = new THREE.Vector3(0, 0, 1e6);
    clampSpeed(b);
    expect(Math.abs(b.length() - CRASH.maxMassMps)).toBeLessThan(1e-6);
    const c = new THREE.Vector3(0, 0, 20);
    clampSpeed(c);
    expect(c.z).toBe(20);
  });
});

describe("given leftoverCrumple (the fraction of the crush zone still unused, from the remaining nose length in metres)", () => {
  it("when the remaining length is 1.5 m or 0 m, then a full zone reads 1 and no remaining length reads 0", () => {
    expect(leftoverCrumple(1.5)).toBe(1);
    expect(leftoverCrumple(0)).toBe(0);
  });

  it("when the remaining length is 1.5 m, 0.3 m and 1.2 m, then 1.5 m reads 1 and 0.3 m reads less than 1.2 m, so more remaining length is more crumple left", () => {
    expect(leftoverCrumple(1.5)).toBe(1);
    expect(leftoverCrumple(0.3)).toBeLessThan(leftoverCrumple(1.2));
  });

  it("when the remaining length is negative or oversize, then the fraction clamps to 0 or 1 instead of becoming NaN", () => {
    expect(leftoverCrumple(-4)).toBe(0);
    expect(leftoverCrumple(99)).toBe(1);
  });

  it("when the remaining length is 1.499 m, then the fraction reads just under 1 (above 0.99) instead of rounding up to a full zone", () => {
    const a = leftoverCrumple(1.499);
    expect(a < 1 && a > 0.99, `got ${a}`).toBeTruthy();
  });
});

describe("given hypot2 and hypot3 (two- and three-term vector lengths that replays and contact digests depend on)", () => {
  it("when they are compared with Math.hypot over special values (signs, ±0, NaN, Infinity, extremes) and 20000 seeded random triples, then every result is bit-identical to Math.hypot's", () => {
    const special = [0, -0, 1, -1, 3, 4, 1e-300, 5e-324, 1.7e308, -1.7e308, Infinity, -Infinity, NaN, 0.1, 1 / 3];
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed / 2147483647 - 0.5) * 10 ** ((seed % 13) - 6);
    };
    const cases: number[][] = [];
    for (const a of special) for (const b of special) cases.push([a, b, special[(cases.length * 7) % special.length]!]);
    for (let i = 0; i < 20000; i++) cases.push([rnd(), rnd(), rnd()]);
    for (const [a, b, c] of cases) {
      expect(Object.is(hypot2(a!, b!), Math.hypot(a!, b!)), `hypot2(${a}, ${b}) ${hypot2(a!, b!)} vs ${Math.hypot(a!, b!)}`).toBeTruthy();
      expect(Object.is(hypot3(a!, b!, c!), Math.hypot(a!, b!, c!)), `hypot3(${a}, ${b}, ${c}) ${hypot3(a!, b!, c!)} vs ${Math.hypot(a!, b!, c!)}`).toBeTruthy();
    }
  });
});

describe("given applyGroundFriction (slows the ground-plane part of a velocity by Coulomb friction)", () => {
  it("when a car moving 10 m/s along x and 3 m/s up slides for 0.1 s with friction coefficient 1, then its ground speed drops by μ·g·dt = 0.981 m/s and its vertical speed is unchanged", () => {
    const v = new THREE.Vector3(10, 3, 0);
    applyGroundFriction(v, 0.1, 1, true);
    // drop = 1 * 9.81 * 0.1 = 0.981, speed was 10
    expect(Math.abs(v.x - (10 * (10 - 0.981)) / 10)).toBeLessThan(1e-6);
    expect(v.y).toBe(3);
    expect(v.z).toBe(0);
  });

  it("when the car is airborne, or the time step is zero, then its velocity is left unchanged", () => {
    const a = new THREE.Vector3(5, 1, 2);
    applyGroundFriction(a, 0.2, 0.9, false);
    expect(a.x, "a.x").toBe(5);
    expect(a.y, "a.y").toBe(1);
    expect(a.z, "a.z").toBe(2);
    const b = new THREE.Vector3(5, 1, 2);
    applyGroundFriction(b, 0, 0.9, true);
    expect(b.x, "b.x").toBe(5);
    expect(b.y, "b.y").toBe(1);
    expect(b.z, "b.z").toBe(2);
  });

  it("when the ground speed is below the stopping threshold, then the ground-plane speed is zeroed and the vertical speed is kept", () => {
    const v = new THREE.Vector3(1e-6, -4, -1e-6);
    applyGroundFriction(v, 0.016, 0.75, true);
    expect(v.x).toBe(0);
    expect(v.z).toBe(0);
    expect(v.y).toBe(-4);
  });

  it("when a car moving 8 m/s up and 6 m/s along the ground slides for 1/60 s with sliding friction, then only its ground speed drops (to between 5.8 and 6 m/s) and its vertical speed stays 8", () => {
    const v = new THREE.Vector3(0, 8, 6);
    applyGroundFriction(v, 1 / FRAME_HZ, CRASH.muSlide, true);
    expect(v.y).toBe(8);
    expect(v.z < 6 && v.z > 5.8).toBeTruthy();
  });
});

describe("given round4 (rounds a number to four decimals, halves upward)", () => {
  it("when 1.23444 and 1.23445 are rounded, then they give 1.2344 and 1.2345", () => {
    expect(round4(1.23444)).toBe(1.2344);
    expect(round4(1.23445)).toBe(1.2345);
  });
});

describe("given vec3 (snapshots a vector as plain x, y, z numbers rounded to four decimals)", () => {
  it("when a vector (0.12345, -2, 8) is snapshotted, then it gives x 0.1235, y -2 and z 8", () => {
    const v = vec3(new THREE.Vector3(0.12345, -2, 8));
    expect(v.x, "x").toBe(0.1235);
    expect(v.y, "y").toBe(-2);
    expect(v.z, "z").toBe(8);
  });
});

describe("given snapshotPoints (turns particle position and life arrays into the list of live particles, up to a cap)", () => {
  it("when two of three particles are alive but the cap is 1, then it reports only the first live particle, with its x and remaining life", () => {
    const r = snapshotPoints([1, 2, 3], [4, 5, 6], [7, 8, 9], [0.2, 0, 0.9], false, 1);
    expect(r.count).toBe(1);
    expect(r.items[0]!.x).toBe(1);
    expect(r.items[0]!.life).toBe(0.2);
  });

  it("when the positions come packed as interleaved x, y, z values, then the particles read as (10, 20, 30) and x 40, not as parallel arrays", () => {
    const r = snapshotPoints([10, 20, 30, 40, 50, 60], null, null, [1, 1], true, 8);
    expect(r.items[0]!.x).toBe(10);
    expect(r.items[0]!.y).toBe(20);
    expect(r.items[0]!.z).toBe(30);
    expect(r.items[1]!.x).toBe(40);
  });

  it("when every particle is dead, then the count is 0 and the item list is empty", () => {
    const r = snapshotPoints([1], [2], [3], [0], false, 16);
    expect(r.count).toBe(0);
    expect(r.items.length).toBe(0);
  });

  it("when two packed particles are given and only the second is alive, then it reads at (9, 8, 7), the index counted in steps of three", () => {
    const r = snapshotPoints([1, 2, 3, 9, 8, 7], null, null, [0, 1], true, 8);
    expect(r.count).toBe(1);
    expect(r.items[0]!.x).toBe(9);
    expect(r.items[0]!.y).toBe(8);
    expect(r.items[0]!.z).toBe(7);
  });
});

describe("given a sedan's crash zones (soft bumper and rails over a rigid high-strength-steel cabin cage)", () => {
  it("when each region's softness is compared, then the bumper is more than 0.6 softer than the cabin, the rail is softer than the roof, the wheel hub is under 0.15 and the engine is between the rail and the cabin", () => {
    expect(regionSoftness("bumperFL")).toBeGreaterThan(regionSoftness("cell") + 0.6);
    expect(regionSoftness("railL")).toBeGreaterThan(regionSoftness("roof"));
    expect(regionSoftness("hubFL")).toBeLessThan(0.15);
    expect(regionSoftness("engineL")).toBeLessThan(regionSoftness("railL"));
    expect(regionSoftness("engineL")).toBeGreaterThan(regionSoftness("cell"));
  });

  it("when a 5 m/s tap hits, then the cabin does not yield at all but the bumper may yield a little", () => {
    expect(crushGate(5, regionSoftness("cell"))).toBe(0);
    expect(crushGate(5, regionSoftness("bumperFL"))).toBeGreaterThan(0);
  });

  it("when the closing speed is 20 m/s instead of 5 m/s, then the energy scale is more than 8 times larger and a fine step gets under 30 % of the impulse scale of a frame step", () => {
    expect(closingKeScale(20)).toBeGreaterThan(closingKeScale(5) * 8);
    expect(dtImpulseScale(1 / FINE_HZ)).toBeLessThan(dtImpulseScale(1 / FRAME_HZ) * 0.3);
  });
});

describe("given force transfer bands (the crush distances at which a region passes more of a hit on to the cabin)", () => {
  it("when the bumper's bands are compared with the cabin's, then the bumper's max is over twice the cabin's, its middle is larger, and its yield lies below its middle and its middle below its max", () => {
    const bumper = regionCrushBands("bumperFL");
    const cell = regionCrushBands("cell");
    expect(bumper.max).toBeGreaterThan(cell.max * 2);
    expect(bumper.middle).toBeGreaterThan(cell.middle);
    expect(bumper.yield < bumper.middle && bumper.middle < bumper.max).toBeTruthy();
  });

  it("when the crush is read at rest, just under the middle, at the middle, just under the max, at the max, and packed, then the transfer steps 0.1, 0.1, 0.5, 0.5, 0.62, and 1 when packed", () => {
    const b = regionCrushBands("bumperFL");
    expect(forceTransfer(0, b, false)).toBe(TRANSFER.belowMiddle);
    expect(forceTransfer(b.middle - 1e-4, b, false)).toBe(TRANSFER.belowMiddle);
    expect(forceTransfer(b.middle, b, false)).toBe(TRANSFER.atMiddle);
    expect(forceTransfer(b.max - 1e-4, b, false)).toBe(TRANSFER.atMiddle);
    expect(forceTransfer(b.max, b, false)).toBe(TRANSFER.above);
    expect(forceTransfer(0, b, true)).toBe(TRANSFER.packed);
    expect(forceTransfer(b.max * 4, b, true)).toBe(TRANSFER.packed);
  });

  it("when a region is packed (fully compressed), then all of the force goes through (1), while an unpacked region at max crush passes less than that", () => {
    const b = regionCrushBands("railL");
    expect(forceTransfer(0, b, true)).toBe(1);
    expect(forceTransfer(b.max, b, false)).toBeLessThan(1);
  });

  it("when the crush is just under the middle (0.999 of it), then the transfer is the 0.1 step, and exactly at the middle it is the 0.5 step", () => {
    const b = regionCrushBands("wingFL");
    expect(forceTransfer(b.middle * 0.999, b, false)).toBe(TRANSFER.belowMiddle);
    expect(forceTransfer(b.middle, b, false)).toBe(TRANSFER.atMiddle);
  });
});

describe("given satPushCap (the cap on one step's push), where slow motion must not rocket the cars", () => {
  it("when the step is a fine slice instead of a frame, then the push cap is under 35 % of the frame step's", () => {
    expect(satPushCap(1 / FINE_HZ)).toBeLessThan(satPushCap(1 / FRAME_HZ) * 0.35);
  });
});
