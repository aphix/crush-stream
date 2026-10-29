import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { buildCar } from "./drawn-body.test-util.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

/** How long (s) the dropped car is followed: it lands, bounces and settles on its roof well within it. */
const DROP_S = 6;

/**
 * Pins what a 2 m drop onto the roof does to a sedan's glass, each pane's peak frame distortion read as `evaluateBreakage` reads it
 * (0.03 m shatters a pane): the reference sedan (a fastback) keeps its rear glass, whose frame stands clear of the roof the drop crushes,
 * while its windshield and side glass go. The platform sedan lost its rear glass too.
 */
describe("given a sedan dropped onto its roof from 2 m", () => {
  it("when it lands and settles, then its windshield and side glass shatter and its rear glass holds", (t) => {
    const car = buildCar("sedan", "sedan");
    car.spawnFacing(0, 0, 0, 0);
    car.group.rotation.set(Math.PI, 0, 0, "YXZ");
    car.group.updateMatrixWorld(true);
    car.group.position.y += -new THREE.Box3().setFromObject(car.group).min.y + 2;
    car.airborne = true;
    const world = makeWorld([car], false, false, null);
    const peak = new Map<string, number>();
    for (let f = 0; f < DROP_S * FRAME_HZ; f++) {
      tickWorld(world, 1 / FRAME_HZ);
      for (const g of car.glassPanes) {
        const frame = g.skin ?? (g.parts.includes("doorLeft") ? "doorLeft" : "doorRight");
        peak.set(g.name, Math.max(peak.get(g.name) ?? 0, car.deform.glassDistortion(frame)));
      }
    }
    const states = car.glassPanes.map((g) => `${g.name} ${g.state}, peak ${(peak.get(g.name) ?? 0).toFixed(4)} m`).join("; ");
    t.annotate(states);
    const shattered = car.glassPanes.filter((g) => g.state === "shattered").map((g) => g.name).sort();
    expect(firstMismatch(shattered, ["doorL", "doorR", "quarterL", "quarterR", "windshield"]), states).toBeUndefined();
  });
});
