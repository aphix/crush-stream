import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
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

function stage(kind: Kind, on: boolean): Ran {
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
  for (const kind of ["owner head-on", "t-bone", "wall", "re-hit"] as const) {
    it(`when the ${kind} is run in epicenter mode, then every car's crush per region is the whole solve's within 10 % or 1 cm, the same parts are off and wheels popped, and the wreck was frozen for most of it`, () => {
      const whole = stage(kind, false);
      const epi = stage(kind, true);
      assert.equal(whole.frozenCarSlices, 0, "whole mode froze a car");
      assert.equal(epi.breaches, 0, "a frozen car was written to without a thaw");
      assert.ok(epi.frozenCarSlices > (kind === "re-hit" ? 0.25 : 0.5) * AFTER * 240 * epi.results.length, `epicenter froze only ${epi.frozenCarSlices} car-slices (a vacuous row otherwise)`);
      assert.ok(epi.freezes >= epi.results.length && epi.freezes - epi.thaws <= epi.results.length, `freezes ${epi.freezes} thaws ${epi.thaws}`);
      if (kind === "re-hit") assert.ok(epi.thaws >= 1, "the third car's hit never thawed the frozen wreck");
      for (const [i, w] of whole.results.entries()) {
        const e = epi.results[i]!;
        for (const key of REGIONS) assert.ok(Math.abs(e[key] - w[key]) <= tolerance(w[key]), `car ${i} ${key}: epicenter ${e[key].toFixed(4)} against whole ${w[key].toFixed(4)}`);
        // Where each car ended up: the body within 1 cm (a frozen wreck takes no seat step toward its cell: measured 7.4 mm after 5 s for the owner's head-on, under 2 mm for the T-bone, wall and re-hit), every body mass within 1 cm of its place in the frame once the whole car's shift (the cell's: that same seat step) is taken out (measured 7.4 mm at the head-on's nose: the relaxation the whole path still does after the window, the clamp's springback; the others under 1 mm), every mass (the planted hubs' stand included) within 1.2 cm in the world.
        const cw = whole.cars[i]!;
        const ce = epi.cars[i]!;
        assert.ok(cw.group.position.distanceTo(ce.group.position) <= 0.01, `car ${i} body ${cw.group.position.distanceTo(ce.group.position)} m apart`);
        const cell = cw.deform.masses.findIndex((m) => m.name === "cell");
        const shift = cw.deform.masses[cell]!.local.clone().sub(ce.deform.masses[cell]!.local);
        for (const [k, m] of cw.deform.masses.entries()) {
          const o = ce.deform.masses[k]!;
          if (!m.hub) assert.ok(m.local.clone().sub(o.local).sub(shift).length() <= 0.01, `car ${i} ${m.name} local ${m.local.clone().sub(o.local).sub(shift).length()} m apart beyond the whole car's shift`);
          assert.ok(m.world.distanceTo(o.world) <= 0.012, `car ${i} ${m.name} world ${m.world.distanceTo(o.world)} m apart`);
        }
        assert.equal(e.detached.join(), w.detached.join(), `car ${i} torn parts`);
        assert.equal(e.hubsPopped.join(), w.hubsPopped.join(), `car ${i} popped wheels`);
        assert.equal(e.drivetrainAlive, w.drivetrainAlive, `car ${i} drivetrain`);
        assert.equal(e.lampsOut.join(), w.lampsOut.join(), `car ${i} lamps`);
      }
    });
  }
});
