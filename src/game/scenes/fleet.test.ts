import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FLEET_MIN_SEP, LAMP_POSTS, LAMP_RING_R, MAX_CARS, fleetClass, fleetStyle, layoutDerby, layoutFleet, slotType } from "./fleet.ts";
import { scatterRampBalls, type RampBall } from "./engine-props.ts";
import { mulberry32 } from "../world/placements.ts";

describe("given a player's car pick, hatchback", () => {
  const hatchback = { cls: "sedan", style: "hatchback" } as const;
  it("when a field outside the stack is built, then only slot 0 is the pick and the rest are the fleet's cycle", () => {
    const first = slotType(0, hatchback, false);
    expect(first.cls).toBe(hatchback.cls);
    expect(first.style).toBe(hatchback.style);
    for (let i = 1; i < 12; i++) {
      const slot = slotType(i, hatchback, false);
      expect(slot.cls, `slot ${i} class`).toBe(fleetClass(i));
      expect(slot.style, `slot ${i} style`).toBe(fleetStyle(i));
    }
  });
  it("when the stack is built, then every slot is the pick", () => {
    for (let i = 0; i < 20; i++) {
      const slot = slotType(i, hatchback, true);
      expect(slot.cls, `slot ${i} class`).toBe(hatchback.cls);
      expect(slot.style, `slot ${i} style`).toBe(hatchback.style);
    }
  });
});

const fixedSpeedCases = [
  { it: "when the speed range is 0 to 0, then all 6 cars spawn parked at speed 0", count: 6, minSpeed: 0, maxSpeed: 0, seed: 3, expectedSpeed: 0 },
  { it: "when the speed range is 14 to 14, then all 5 cars spawn at exactly 14, not at a random speed between 0 and the maximum", count: 5, minSpeed: 14, maxSpeed: 14, seed: 9, expectedSpeed: 14 },
] as const;

describe("given a fleet of cars laid out around the arena (where each car spawns and how fast it moves)", () => {
  it("when 1 car and then 2 cars are laid out, then the single car spawns away from the centre and the pair sit opposite each other, more than twice the minimum separation apart", () => {
    const one = layoutFleet(1, 10, 10, mulberry32(1));
    expect(one.length).toBe(1);
    expect(Math.hypot(one[0]!.x, one[0]!.z)).toBeGreaterThan(8);

    const two = layoutFleet(2, 8, 12, mulberry32(2));
    expect(two.length).toBe(2);
    const d = Math.hypot(two[0]!.x - two[1]!.x, two[0]!.z - two[1]!.z);
    expect(d, `head-on pair only ${d.toFixed(2)} m apart`).toBeGreaterThan(FLEET_MIN_SEP * 2);
  });

  it("when 8 cars are laid out, then every pair spawns at least the minimum separation apart (within 5 cm)", () => {
    const slots = layoutFleet(8, 0, 20, mulberry32(7));
    expect(slots.length).toBe(8);
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const d = Math.hypot(slots[i]!.x - slots[j]!.x, slots[i]!.z - slots[j]!.z);
        expect(d, `pair ${i},${j} at ${d.toFixed(2)} m`).toBeGreaterThanOrEqual(FLEET_MIN_SEP - 0.05);
      }
    }
  });

  for (const testCase of fixedSpeedCases) {
    it(testCase.it, () => {
      const slots = layoutFleet(testCase.count, testCase.minSpeed, testCase.maxSpeed, mulberry32(testCase.seed));
      expect(slots.every((s) => s.speed === testCase.expectedSpeed)).toBeTruthy();
    });
  }

  it("when 99 cars and then 0 cars are asked for, then the fleet is capped at the maximum car count and never drops below 1 car", () => {
    expect(layoutFleet(99, 1, 2, mulberry32(4)).length).toBe(MAX_CARS);
    expect(layoutFleet(0, 1, 2, mulberry32(4)).length).toBe(1);
  });
});

describe("given the six lamp posts on the 16 m ring", () => {
  it("when fleets of 3 to 32 cars are laid out over 200 seeds, then no car spawns within 2 m of a post or has one within 2 m of its straight path to the centre", () => {
    const posts = Array.from({ length: LAMP_POSTS }, (_, k) => {
      const a = (k / LAMP_POSTS) * Math.PI * 2;
      return { x: Math.sin(a) * LAMP_RING_R, z: Math.cos(a) * LAMP_RING_R };
    });
    const clearance = (x: number, z: number): number => {
      const len2 = x * x + z * z;
      let least = Infinity;
      for (const p of posts) {
        const t = Math.max(0, Math.min(1, (p.x * x + p.z * z) / len2));
        least = Math.min(least, Math.hypot(p.x - x * t, p.z - z * t));
      }
      return least;
    };
    let worst = Infinity;
    let cases = 0;
    for (const n of [3, 5, 8, 14, 20, 32]) {
      for (let seed = 1; seed <= 200; seed++) {
        for (const s of layoutFleet(n, 10, 30, mulberry32(seed))) {
          worst = Math.min(worst, clearance(s.x, s.z));
          cases++;
        }
      }
    }
    expect(worst, `after ${cases} spawns the closest a post comes to a spawn's path is ${worst.toFixed(2)} m`).toBeGreaterThanOrEqual(2 - 1e-9);
  });

  it("when fleets of 2 to 32 cars are laid out over 200 seeds, then no car's straight path from its spawn comes within 2 m of a post before it meets another car or 2 s have passed", () => {
    const posts = Array.from({ length: LAMP_POSTS }, (_, k) => {
      const a = (k / LAMP_POSTS) * Math.PI * 2;
      return { x: Math.sin(a) * LAMP_RING_R, z: Math.cos(a) * LAMP_RING_R };
    });
    const APPROACH_S = 2;
    // Two cars have met when their centres are this close (m): half a car's length, so the latest a straight path can be said to end.
    const MEET_M = 2.2;
    let worst = Infinity;
    let where = "";
    let cases = 0;
    // Seed 0 stands for a random source that always gives 0: every one of the 48 tries lands on a post line, so every car is
    // placed by the even-ring last resort. The listed seeds are 32-car fleets of the real source where one car falls back to it (a scan of 1 to 5000).
    const lastResort = [374, 443, 679, 771, 1277, 1851, 1964, 1975, 2122, 2501, 2797, 2975, 3150, 3464, 3820];
    for (const n of [1, 2, 3, 5, 8, 12, 14, 20, 32]) {
      const seeds = [0, ...Array.from({ length: 200 }, (_, k) => k + 1), ...(n === 32 ? lastResort : [])];
      for (const seed of seeds) {
        const slots = layoutFleet(n, 10, 32, seed === 0 ? () => 0 : mulberry32(seed));
        const vel = slots.map((s) => {
          const r = Math.hypot(s.x, s.z);
          return { x: (-s.x / r) * s.speed, z: (-s.z / r) * s.speed };
        });
        for (let i = 0; i < n; i++) {
          const s = slots[i]!;
          // The first time (s) this car's centre is within MEET_M of another car's, both driving straight.
          let end = APPROACH_S;
          for (let j = 0; j < n; j++) {
            if (j === i) continue;
            const px = s.x - slots[j]!.x;
            const pz = s.z - slots[j]!.z;
            const wx = vel[i]!.x - vel[j]!.x;
            const wz = vel[i]!.z - vel[j]!.z;
            const a = wx * wx + wz * wz;
            const b = 2 * (px * wx + pz * wz);
            const disc = b * b - 4 * a * (px * px + pz * pz - MEET_M * MEET_M);
            if (a > 0 && disc >= 0) end = Math.min(end, Math.max(0, (-b - Math.sqrt(disc)) / (2 * a)));
          }
          const dx = vel[i]!.x * end;
          const dz = vel[i]!.z * end;
          const len2 = dx * dx + dz * dz;
          for (let k = 0; k < LAMP_POSTS; k++) {
            const t = len2 > 0 ? Math.max(0, Math.min(1, ((posts[k]!.x - s.x) * dx + (posts[k]!.z - s.z) * dz) / len2)) : 0;
            const d = Math.hypot(posts[k]!.x - (s.x + dx * t), posts[k]!.z - (s.z + dz * t));
            if (d < worst) {
              worst = d;
              where = `${n} cars seed ${seed} car ${i} post ${k}`;
            }
          }
          cases++;
        }
      }
    }
    expect(worst, `after ${cases} spawn paths the closest a post comes to one is ${worst.toFixed(2)} m (${where})`).toBeGreaterThanOrEqual(2 - 1e-9);
  });
});

describe("given a layout built from a seeded random source", () => {
  it("when it is laid out twice with the same seed and once with the next seed, then the same seed gives the same spawns and the next seed gives different ones, for 1, 2, 3, 8 and the maximum number of cars", () => {
    const spawns = (n: number, seed: number): string => JSON.stringify(layoutFleet(n, 10, 32, mulberry32(seed)));
    for (const n of [1, 2, 3, 8, MAX_CARS]) {
      const first = spawns(n, 0x3fa2c1);
      expect(spawns(n, 0x3fa2c1), `${n} cars, same seed`).toBe(first);
      expect(spawns(n, 0x3fa2c2), `${n} cars, next seed`).not.toBe(first);
    }
  });

  it("when the derby's start bearing and the ramp balls are scattered twice with seed 7 and once with seed 8, then seed 7 repeats itself and seed 8 differs, for both", () => {
    const bowl = (seed: number): string => JSON.stringify(layoutDerby(6, 40, mulberry32(seed)));
    expect(bowl(7)).toBe(bowl(7));
    expect(bowl(7)).not.toBe(bowl(8));
    const balls: RampBall[] = Array.from({ length: 3 }, () => ({ mesh: new THREE.Mesh(), radius: 0.78, intact: true, kicked: new Set<string>() }));
    const ring = (seed: number): string => {
      scatterRampBalls(balls, true, mulberry32(seed));
      return JSON.stringify(balls.map((b) => [b.radius, b.mesh.position.toArray()]));
    };
    expect(ring(7)).toBe(ring(7));
    expect(ring(7)).not.toBe(ring(8));
  });
});
