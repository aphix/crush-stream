import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { launch, makeWorld, tickWorld, PARKED } from "./crash-scenarios.test-util.ts";
import { satCars } from "./sat.ts";
import { CAGE_STEP } from "../vehicle/car-cage.ts";
import { fleetClass, fleetStyle } from "../scenes/fleet.ts";
import { assignClass } from "../vehicle/vehicle-classes.ts";
import { EPICENTER, epicenterValues, loadEpicenter } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import { FRAME_HZ, KPH_PER_MS } from "../kernel/constants.ts";

/** Two fleet cars after a 72 km/h flank hit must not rest inside each other (the owner's capture had 10-21 cm). */
const STYLE_INDEX = { sedan: 0, hatchback: 1, wagon: 2, coupe: 3, pickup: 4 } as const;
type Style = keyof typeof STYLE_INDEX;
const FRAME = 1 / FRAME_HZ;
/** Seconds run: the hit is over and both cars have stopped well before. */
const RUN_SECONDS = 6;
/** Start of the striker (m) from the parked car's centre, on its line of approach. */
const START_X = -12;
const STRIKE_KPH = 72;
/** The most (m) two resting cars overlap: the resolution of the cage outlines. */
const REST_OVERLAP = CAGE_STEP;
const STILL_MPS = 0.05;
/** How far (m) the rested struck wreck is shoved back into the striker: past the outlines' 2.5 cm, short of a crash. */
const SHOVE = 0.08;
/** Thaws the pair may take over the run: the hit's own and a few contacts, not one a slice (1440). */
const MAX_THAWS = 40;

const _n = new THREE.Vector3();
const _p = new THREE.Vector3();

function fleetCar(style: Style): DeformableCar {
  const index = STYLE_INDEX[style];
  const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: style }, new THREE.Scene(), null, fleetStyle(index));
  car.deform.setMode("shape");
  car.deform.squash = 0.32;
  car.deform.buckle = 0.45;
  assignClass(car, fleetClass(index));
  return car;
}

function restOverlap(striker: Style, struck: Style, shove = 0): { depth: number; speed: number; breaches: number; thaws: number } {
  const a = fleetCar(striker);
  const b = fleetCar(struck);
  const w = makeWorld([a, b], false, false);
  w.pedals.set(b, PARKED);
  launch(a, START_X, 0, Math.PI / 2, STRIKE_KPH / KPH_PER_MS, 0);
  launch(b, 0, 0, 0, 0, 0);
  for (let f = 0; f < RUN_SECONDS * FRAME_HZ; f++) tickWorld(w, FRAME);
  if (shove > 0) {
    const away = _n.copy(b.group.position).sub(a.group.position).setY(0).normalize().multiplyScalar(-shove);
    b.group.position.add(away);
    b.deform.translateMasses(away.x, away.z, 0, 0);
    for (let f = 0; f < RUN_SECONDS * FRAME_HZ; f++) tickWorld(w, FRAME);
  }
  const out = {
    depth: satCars(a, b, _n, _p, 0) ?? 0,
    speed: Math.max(a.velocity.length(), b.velocity.length()),
    breaches: a.deform.frozenBreaches + b.deform.frozenBreaches,
    thaws: a.deform.thaws + b.deform.thaws,
  };
  a.dispose();
  b.dispose();
  return out;
}

describe("given two fleet cars, one struck on its flank by the other at 72 km/h and left to rest", () => {
  const saved = epicenterValues();
  afterEach(() => loadEpicenter(saved));
  const cases: readonly [Style, Style][] = [
    ["sedan", "pickup"],
    ["pickup", "sedan"],
    ["sedan", "wagon"],
    ["coupe", "pickup"],
  ];
  for (const [striker, struck] of cases) {
    it(`when a ${striker} strikes a parked ${struck}, then both stop and overlap by no more than ${REST_OVERLAP * 100} cm`, () => {
      const { depth, speed } = restOverlap(striker, struck);
      expect(speed, `still moving at ${speed.toFixed(3)} m/s`).toBeLessThan(STILL_MPS);
      expect(depth, `they rest ${(depth * 100).toFixed(1)} cm into each other`).toBeLessThanOrEqual(REST_OVERLAP);
    });
  }

  it("when the relock is on and the rested, relocked pickup is shoved 8 cm back into the sedan, then the overlap is out again with no frozen-state breach and no thaw every slice", () => {
    loadEpicenter(EPICENTER_AT_LOAD);
    EPICENTER.on = 1;
    EPICENTER.frozenCheck = 1;
    const { depth, speed, breaches, thaws } = restOverlap("sedan", "pickup", SHOVE);
    expect(speed, `still moving at ${speed.toFixed(3)} m/s`).toBeLessThan(STILL_MPS);
    expect(depth, `they rest ${(depth * 100).toFixed(1)} cm into each other`).toBeLessThanOrEqual(REST_OVERLAP);
    expect(breaches, "a frozen-state breach").toBe(0);
    expect(thaws, `${thaws} thaws in ${RUN_SECONDS} s: the pair thaws every slice`).toBeLessThanOrEqual(MAX_THAWS);
  });
});
