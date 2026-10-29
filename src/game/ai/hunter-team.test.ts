import { describe, expect, it } from "vitest";
import { MAX_CARS } from "../scenes/fleet.ts";
import { humanSlot } from "../match/survival.ts";
import { copsWanted, HUNT, huntCap, huntUnits } from "./hunter.ts";
import type { AiCar } from "./derby-ai.ts";
import { BEAT, FAR, rig, spec } from "./hunter-rig.test-util.ts";

describe("given the pack a Survival run builds for its humans", () => {
  const n = spec.formation.length;

  for (const humans of [1, 2, 4]) {
    it(`when ${humans} human${humans > 1 ? "s" : ""} are being hunted, then the pack grows ${humans}-fold in the cops it wants and never passes the cap the cars allow`, () => {
      const r = rig({ humans, think: true });
      const cap = huntCap(humans, r.count);
      // The formation is the course's own; the rest of the wanted count drops in, one every `HUNT.gap`.
      expect(r.brain.hunting, "the formation launches at the green, whatever the team's size").toBe(n);
      const early = HUNT.every * 2 + 2;
      r.run(early);
      // Drops come one every `HUNT.gap` from the green, the first at once: what has had time to arrive by `early`.
      const reachable = n + Math.floor(early / HUNT.gap) + 1;
      expect(r.brain.hunting, `hunting at ${early} s`).toBe(Math.min(copsWanted(early, n, humans, r.count), reachable));
      expect(copsWanted(early, n, humans, r.count), "wanted: scaled by the humans, up to the cap").toBe(Math.min(cap, humans * (n + 2)));
      r.run(300);
      expect(r.brain.hunting, "at the cap in the end").toBe(cap);
      expect(r.brain.hunting, "never more than a human's cap each").toBeLessThanOrEqual(humans * HUNT.cap);
      expect(humans + r.brain.hunting + (HUNT.units - HUNT.cap), "the car list holds the pack, its wrecks and the humans").toBeLessThanOrEqual(MAX_CARS);
    });
  }

  it("when the team has one human, then the pack is the one a lone player has always met: the cap of 12 and the 16 units", () => {
    expect(huntUnits(1, MAX_CARS - 1)).toBe(HUNT.units);
    expect(huntCap(1, HUNT.units)).toBe(HUNT.cap);
    expect(copsWanted(10_000, n)).toBe(HUNT.cap);
  });

  it("when the humans run up to a room's eight, then the units and the cap still fit the car list with every human in it", () => {
    for (let humans = 1; humans <= 8; humans++) {
      const units = huntUnits(humans, MAX_CARS - humans);
      expect(humans + units, `${humans} humans + ${units} units`).toBeLessThanOrEqual(MAX_CARS);
      expect(huntCap(humans, units), `${humans} humans: the cap never falls under a lone player's`).toBeGreaterThanOrEqual(HUNT.cap);
    }
  });
});

describe("given two humans far apart and a pack hunting them", () => {
  /** Human 0 on the start line, human 1 on the far side of the course. */
  const apart = (k: number) => (k === 0 ? spec.start : { x: spec.start.x + 140, z: spec.start.z - 160 });

  it("when each cop picks a player car to chase, then it is the nearer human: the counts after each human are the cops nearer it", () => {
    const r = rig({ humans: 2, at: apart, think: true });
    r.run(40);
    const hunting = r.cars.slice(2).filter((c) => c.x !== FAR);
    for (const c of hunting) r.brain.think(c, r.cars, BEAT);
    const nearer = (c: AiCar): number => (Math.hypot(c.x - r.cars[0]!.x, c.z - r.cars[0]!.z) <= Math.hypot(c.x - r.cars[1]!.x, c.z - r.cars[1]!.z) ? 0 : 1);
    const expected = [hunting.filter((c) => nearer(c) === 0).length, hunting.filter((c) => nearer(c) === 1).length];
    expect(expected[0]! > 0 && expected[1]! > 0, `both humans have cops nearer them (${expected})`).toBeTruthy();
    expect(r.brain.copsOn(0)).toBe(expected[0]);
    expect(r.brain.copsOn(1)).toBe(expected[1]);
  });

  it("when a human is no longer free, then every cop is after the other one", () => {
    const r = rig({ humans: 2, at: apart, think: true });
    r.run(40);
    const hunting = r.cars.slice(2).filter((c) => c.x !== FAR);
    r.hunt[0] = 0;
    for (const c of hunting) r.brain.think(c, r.cars, BEAT);
    expect(r.brain.copsOn(0)).toBe(0);
    expect(r.brain.copsOn(1)).toBe(r.brain.hunting);
  });

  it("when the pack drops cops in, then none lands within a drop-in's distance of either human", () => {
    const r = rig({ humans: 2, at: apart, think: true });
    r.run(300);
    expect(r.drops.length, "cops dropped in after the formation").toBeGreaterThan(spec.formation.length);
    for (const d of r.drops.slice(spec.formation.length)) {
      for (const h of [0, 1]) {
        const gap = Math.hypot(d.x - r.cars[h]!.x, d.z - r.cars[h]!.z);
        expect(gap, `drop at ${d.t.toFixed(1)} s landed ${gap.toFixed(1)} m from human ${h}`).toBeGreaterThanOrEqual(HUNT.dropMin - 1e-6);
      }
    }
  });
});

/** How near a parked human a spot is in the camera's view (m): inside it a wreck is seen and never put away; the drop-in spots (`HUNT.dropMin` from every human) are all outside it. */
const VIEW = 60;

describe("given a hosted Survival run with every cop that comes into view wrecked and the humans parked", () => {
  for (const humans of [1, 2, 4]) {
    it(`when ${humans} human${humans > 1 ? "s" : ""} wait out 150 s, then the pack never goes more than ${HUNT.gap} s without dropping a cop in, though every unit ends up a wreck in view`, () => {
      const slots = Array.from({ length: humans }, (_, k) => humanSlot(spec.start, k));
      const r = rig({ humans, hidden: (x, z) => slots.every((s) => Math.hypot(s.x - x, s.z - z) >= VIEW), think: true });
      // A cop that is on the road is wrecked beside the first human: in view, so it is never put away.
      const wreckTheCops = (): void => {
        for (let i = humans; i < r.cars.length; i++) {
          if (r.cars[i]!.x === FAR || r.down.has(i)) continue;
          Object.assign(r.cars[i]!, { x: slots[0]!.x, z: slots[0]!.z });
          r.down.add(i);
        }
      };
      const arrivals: number[] = [];
      for (let t = BEAT; t <= 150; t += BEAT) {
        const before = r.drops.length;
        r.run(t);
        for (const d of r.drops.slice(before)) arrivals.push(d.t);
        wreckTheCops();
      }
      const wait = arrivals.reduce((worst, t, i) => Math.max(worst, t - (arrivals[i - 1] ?? 0)), 150 - (arrivals.at(-1) ?? 0));
      expect(arrivals.length, `${arrivals.length} cops dropped in from ${r.count} units: the units were never used up and used again`).toBeGreaterThan(r.count);
      expect(wait, `${wait.toFixed(2)} s without a drop-in`).toBeLessThanOrEqual(HUNT.gap + 1e-9);
    });
  }
});
