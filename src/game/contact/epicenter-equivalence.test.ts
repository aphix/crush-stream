import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { EPICENTER,  loadEpicenter, epicenterValues } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import { layOnGround } from "../vehicle/car-air-points.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { WORK } from "../engine/sim-phases.ts";
import { FREEWHEEL, launch, makeCar, makeWorld, PARKED, Probe, run, type CrashResult } from "./crash-scenarios.test-util.ts";

/**
 * `activation: epicenter` against `whole` on the crash rows: the same staged hit run twice, once per mode, through the engine's own step. A wreck that
 * has sat quiet past `relockHold` is frozen (its structure step is only a clock), so what the player sees of the crash (crush depth per region,
 * the parts torn off, the engine's travel, the wheels popped) must come out as it does when every wreck runs the whole solve.
 *
 * Mutations seen (the row each one fails): `relockHold` 0.2 fails only the re-hit row (car 2's nose crush 0.022 against 0.043: the window's one-shots a freeze inside it skips show on the next hit, not the first); `thaw` leaving the cached centre and inertia fails the re-hit row (tail crush 0.004 against 0.020); `feedOverlap` without its `thaw` fails the thaw row (`epicenter-thaw.test.ts`).
 */

const KPH = 1 / 3.6;
/** Sim seconds past the first contact: the wreck is frozen for all but the first 0.35 s of it. */
const AFTER = 5;
/** Crush (m) of one region that may differ between the modes: the larger of 1 cm and 10 % of the crush. */
const tolerance = (whole: number): number => Math.max(0.01, 0.1 * Math.abs(whole));

const saved = epicenterValues();
afterEach(() => loadEpicenter(saved));

type Ran = { results: CrashResult[]; frozenCarSlices: number; freezes: number; thaws: number; breaches: number; cars: DeformableCar[] };

type Kind = "owner head-on" | "t-bone" | "wall" | "re-hit";

function stage(kind: Kind, on: boolean, nudge = 0): Ran {
  loadEpicenter(EPICENTER_AT_LOAD);
  EPICENTER.on = on ? 1 : 0;
  EPICENTER.frozenCheck = 1;
  const a = makeCar("shape");
  const b = kind === "wall" ? null : makeCar("shape");
  const c = kind === "re-hit" ? makeCar("shape") : null;
  if (kind === "owner head-on") {
    launch(a, -5, 0, Math.PI / 2, 20, 0);
    launch(b!, 5, 0, -Math.PI / 2, -20, 0);
  } else if (kind === "t-bone" || kind === "re-hit") {
    launch(a, 0, 0, 0, 0, 0);
    launch(b!, 6, 0, -Math.PI / 2, -50 * KPH, 0);
  } else launch(a, 6.2, 0, -Math.PI / 2, -50 * KPH, 0);
  // The re-hit: a third car meets the parked one from the other side 1.5 s after the first, when its wreck has sat quiet and is frozen.
  if (c) launch(c, -(2.3 + 50 * KPH * 1.5), 0, Math.PI / 2, 50 * KPH, 0);
  layOnGround(a);
  if (nudge) a.deform.translateMasses(nudge, 0, 0, 0);
  if (b) layOnGround(b);
  if (c) layOnGround(c);
  const cars = c ? [a, b!, c] : b ? [a, b] : [a];
  const w = makeWorld(cars, kind === "wall", false, FREEWHEEL);
  for (const car of cars) w.pedals.set(car, (kind === "t-bone" || kind === "re-hit") && car === a ? PARKED : FREEWHEEL);
  const probes = [new Probe(a, kind === "wall" ? a.velocity : new THREE.Vector3(kind === "t-bone" || kind === "re-hit" ? -1 : 1, 0, 0))];
  if (b) probes.push(new Probe(b, new THREE.Vector3(-1, 0, 0)));
  if (c) probes.push(new Probe(c, new THREE.Vector3(1, 0, 0)));
  run(w, probes, AFTER);
  const work = w.world.phases.work;
  return { results: probes.map((p) => p.finish()), frozenCarSlices: work[WORK.frozenCarSlices]!, freezes: work[WORK.freezes]!, thaws: work[WORK.thaws]!, breaches: cars.reduce((n, c) => n + c.deform.frozenBreaches, 0), cars };
}

const REGIONS = ["noseShortL", "noseShortR", "noseMaxL", "noseMaxR", "tailShort", "tailMax", "engineMax", "doorMaxL", "doorMaxR", "roofMax", "cellShift", "cabinIntrusion", "engineTravel"] as const;

describe("given a staged hit run once per activation mode", () => {
  const testCases = [
    { it: "when the owner head-on is run in epicenter mode, then every car's crush per region is the whole solve's within 10 % or 1 cm, the same parts are off and wheels popped, and the wreck was frozen for most of it", kind: "owner head-on" },
    { it: "when the t-bone is run in epicenter mode, then every car's crush per region is the whole solve's within 10 % or 1 cm, the same parts are off and wheels popped, and the wreck was frozen for most of it", kind: "t-bone" },
    { it: "when the wall is run in epicenter mode, then every car's crush per region is the whole solve's within 10 % or 1 cm, the same parts are off and wheels popped, and the wreck was frozen for most of it", kind: "wall" },
    { it: "when the re-hit is run in epicenter mode, then every car's crush per region is the whole solve's within 10 % or 1 cm, the same parts are off and wheels popped, and the wreck was frozen for most of it", kind: "re-hit" },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const { kind } = testCase;
      const whole = stage(kind, false);
      const epi = stage(kind, true);
      expect(whole.frozenCarSlices, "whole mode froze a car").toBe(0);
      expect(epi.breaches, "a frozen car was written to without a thaw").toBe(0);
      expect(epi.frozenCarSlices, `epicenter froze only ${epi.frozenCarSlices} car-slices (a vacuous row otherwise)`).toBeGreaterThan((kind === "re-hit" ? 0.25 : 0.5) * AFTER * 240 * epi.results.length);
      expect(epi.freezes >= epi.results.length && epi.freezes - epi.thaws <= epi.results.length, `freezes ${epi.freezes} thaws ${epi.thaws}`).toBeTruthy();
      if (kind === "re-hit") expect(epi.thaws, "the third car's hit never thawed the frozen wreck").toBeGreaterThanOrEqual(1);
      for (const [i, w] of whole.results.entries()) {
        const e = epi.results[i]!;
        for (const key of REGIONS) expect(Math.abs(e[key] - w[key]), `car ${i} ${key}: epicenter ${e[key].toFixed(4)} against whole ${w[key].toFixed(4)}`).toBeLessThanOrEqual(tolerance(w[key]));
        // Where each car ended up: the body within 1 cm (a frozen wreck takes no seat step toward its cell: measured 7.4 mm after 5 s for the owner's head-on, under 2 mm for the T-bone, wall and re-hit), every body mass within 1 cm of its place in the frame once the whole car's shift (the cell's: that same seat step) is taken out (measured 7.4 mm at the head-on's nose: the relaxation the whole path still does after the window, the clamp's springback; the others under 1 mm), every mass (the planted hubs' stand included) within 1.2 cm in the world.
        const cw = whole.cars[i]!;
        const ce = epi.cars[i]!;
        expect(cw.group.position.distanceTo(ce.group.position), `car ${i} body ${cw.group.position.distanceTo(ce.group.position)} m apart`).toBeLessThanOrEqual(0.01);
        const cell = cw.deform.masses.findIndex((m) => m.name === "cell");
        const shift = cw.deform.masses[cell]!.local.clone().sub(ce.deform.masses[cell]!.local);
        for (const [k, m] of cw.deform.masses.entries()) {
          const o = ce.deform.masses[k]!;
          if (!m.hub) expect(m.local.clone().sub(o.local).sub(shift).length(), `car ${i} ${m.name} local ${m.local.clone().sub(o.local).sub(shift).length()} m apart beyond the whole car's shift`).toBeLessThanOrEqual(0.01);
          expect(m.world.distanceTo(o.world), `car ${i} ${m.name} world ${m.world.distanceTo(o.world)} m apart`).toBeLessThanOrEqual(0.012);
        }
        expect(e.detached.join(), `car ${i} torn parts`).toBe(w.detached.join());
        expect(e.hubsPopped.join(), `car ${i} popped wheels`).toBe(w.hubsPopped.join());
        expect(e.drivetrainAlive, `car ${i} drivetrain`).toBe(w.drivetrainAlive);
        expect(e.lampsOut.join(), `car ${i} lamps`).toBe(w.lampsOut.join());
      }
    });
  }
});

describe("given the same staged hits run twice in whole mode, one with a car's masses nudged 1 micrometre", () => {
  const testCases = [
    { it: "when the owner head-on is run, then no mass ends more than 1 mm apart (the 1.2 cm bar of the epicenter rows is a real bar, not a chaotic one)", kind: "owner head-on" },
    { it: "when the t-bone is run, then no mass ends more than 1 mm apart (the 1.2 cm bar of the epicenter rows is a real bar, not a chaotic one)", kind: "t-bone" },
    { it: "when the wall is run, then no mass ends more than 1 mm apart (the 1.2 cm bar of the epicenter rows is a real bar, not a chaotic one)", kind: "wall" },
    { it: "when the re-hit is run, then no mass ends more than 1 mm apart (the 1.2 cm bar of the epicenter rows is a real bar, not a chaotic one)", kind: "re-hit" },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const { kind } = testCase;
      const plain = stage(kind, false);
      const nudged = stage(kind, false, 1e-6);
      let worst = 0;
      for (const [i, c] of plain.cars.entries()) for (const [k, m] of c.deform.masses.entries()) worst = Math.max(worst, m.world.distanceTo(nudged.cars[i]!.deform.masses[k]!.world));
      expect(worst, `a 1 um nudge moved a mass ${(worst * 1000).toFixed(3)} mm`).toBeLessThanOrEqual(0.001);
    });
  }
});
