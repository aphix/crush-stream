import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { classCar } from "./ejection.test-util.ts";
import { launch, makeCar, makeWorld, Probe, run, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { layOnGround } from "./car-air-points.ts";

/**
 * The rigid step's rows meet a car's top with the other car's body points, and what the rows' impulse takes out of the pair is that
 * contact's crush (docs/UNIFIED_CONTACT.md): one contact, armed once, at the kernel's barrier speed for the closing it met.
 */

/** Closing speed (m/s) of each car's nose in the head-on: each car drives this fast at the other. */
const HEAD_ON_MPS = 40;
/** Equal-mass cars share a plastic exchange evenly: each takes half the closing, here the speed of one of them. */
const EQUAL_MASS_SHARE = HEAD_ON_MPS;
/** How far a car's barrier speed may sit from its share (the first slice's closing is read before the exchange, the cars' masses differ by their class). */
const SHARE_TOLERANCE = 0.1;
/** A T-bone's striker meets the flank of the car it hits: it must not climb it. The cage's own fit (cm) is the most a crush may lift it. */
const MOST_LIFT_M = 0.05;
/** Each sedan's launch speed (km/h) in the undriven head-on: the kill window's low side, its middle, and past it. */
const UNDRIVEN_KPH = [56, 58, 60] as const;
/** How far (relative) an undriven sedan's armed hit may sit from the speed it launched at: a head-on through both centres reads the whole of it. */
const LAUNCH_TOLERANCE = 0.02;

describe("given a sedan driving head-on into a monster truck, each at 40 m/s", () => {
  it("when the nose meets the truck's bonnet, then each car's crush is armed at its share of the closing (the speed it would crush a rigid wall with)", () => {
    const sedan = classCar("sedan");
    const truck = classCar("monster");
    launch(sedan, -5, 0, Math.PI / 2, HEAD_ON_MPS, 0);
    launch(truck, 5, 0, -Math.PI / 2, -HEAD_ON_MPS, 0);
    const world = makeWorld([sedan, truck], false, false);
    for (let frame = 0; frame < 6; frame++) tickWorld(world);
    for (const [name, car] of [["sedan", sedan], ["truck", truck]] as const) {
      const armed = car.deform["hitSpeed"];
      assert.ok(Math.abs(armed - EQUAL_MASS_SHARE) <= SHARE_TOLERANCE * EQUAL_MASS_SHARE, `${name}'s hit read ${armed.toFixed(1)} m/s, its share is ${EQUAL_MASS_SHARE} m/s`);
    }
  });
});

describe("given a sedan driving its nose into a parked sedan's door at 55 m/s", () => {
  it("when the nose is inside the door's side, then the striker is not carried up the flank", () => {
    const struck = classCar("sedan");
    const striker = classCar("sedan");
    launch(struck, 0, 0, 0, 0, 0);
    launch(striker, 6, 0, -Math.PI / 2, -55, 0);
    const world = makeWorld([striker, struck], false, false);
    let highest = 0;
    for (let frame = 0; frame < 12; frame++) {
      tickWorld(world);
      highest = Math.max(highest, striker.group.position.y);
    }
    assert.ok(highest <= MOST_LIFT_M, `the striker rose ${highest.toFixed(3)} m`);
  });
});

describe("given two sedans, undriven, driving head-on at each other at 56, 58 and 60 km/h each", () => {
  it("when their noses meet, then each car's hit is read at its launch speed and the nose crushes deeper the faster they meet", () => {
    let slower = 0;
    for (const kph of UNDRIVEN_KPH) {
      const a = makeCar();
      const b = makeCar();
      launch(a, -5, 0, Math.PI / 2, kph / 3.6, 0);
      launch(b, 5, 0, -Math.PI / 2, -kph / 3.6, 0);
      layOnGround(a);
      layOnGround(b);
      const world = makeWorld([a, b], false, false, null);
      const probe = new Probe(a, new THREE.Vector3(1, 0, 0));
      run(world, [probe, new Probe(b, new THREE.Vector3(-1, 0, 0))], 1.5);
      const crush = probe.finish().noseShortL;
      const want = kph / 3.6;
      for (const [name, car] of [["a", a], ["b", b]] as const) {
        const armed = car.deform.hitSpeedValue;
        assert.ok(Math.abs(armed - want) <= LAUNCH_TOLERANCE * want, `${kph} km/h: car ${name}'s hit read ${armed.toFixed(2)} m/s, it met at ${want.toFixed(2)}`);
      }
      assert.ok(crush > slower, `${kph} km/h: nose ${crush.toFixed(4)} m, the slower pair's ${slower.toFixed(4)} m`);
      slower = crush;
    }
  });
});
