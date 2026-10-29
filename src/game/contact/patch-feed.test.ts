import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { launch, makeCar } from "./crash-scenarios.test-util.ts";
import { patch, satCars } from "./sat.ts";

/** A sedan's nose is 0.94 m across: the half width its flat face presses over a flat door. */
const NOSE_HALF = 0.47;

describe("given a sedan's nose driven 15 cm into a parked sedan's door", () => {
  it("when the pair's overlap is read, then its patch is as wide as the nose, so a bumper's corner is under the face as its middle is", () => {
    const struck = makeCar();
    const bullet = makeCar();
    launch(struck, 0, 0, 0, 0, 0);
    launch(bullet, 2.8, 0, -Math.PI / 2, 0, 0);
    const n = new THREE.Vector3();
    const p = new THREE.Vector3();
    const sink = satCars(bullet, struck, n, p, 0);
    assert.ok(sink !== null && sink > 0.05, `sink ${sink}`);
    assert.ok(patch.half > 0.75 * NOSE_HALF && patch.half < 1.25 * NOSE_HALF, `patch half width ${patch.half.toFixed(3)} m against the nose's ${NOSE_HALF} m`);
  });
});
