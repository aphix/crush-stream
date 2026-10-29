import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import type { DeformableCar } from "./car.ts";
import { COMPASS, judge, report, type Kind, type Run, type Site } from "./ground-judge.test-util.ts";
import { bodyPointDepth, drive, drop } from "./ground-probe.test-util.ts";
import { VEHICLE_CLASS_IDS, type VehicleClassId } from "./vehicle-classes.ts";
import { FleetRamps, RAMP } from "../scenes/fleet-ramps.ts";
import { collideOn } from "../scenes/ramp-collide.test-util.ts";
import { setGround } from "../world/ground.ts";
import { Track } from "../world/track.ts";
import { parseTrack } from "../world/track-schema.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { useStiffSprings } from "./stiff-springs.test-util.ts";

/**
 * The owner's drop matrix, generalising ramp.test.ts's wedge: a car dropped 0.5 m onto each site at every heading, brake
 * and handbrake held for 3 s, must sit ON the ground, whatever the ground is (the judge: ground-judge.test-util.ts). A new
 * site is one line in a table below.
 */

const SEDAN = ["sedan"] as const;
const SEDAN_MONSTER = ["sedan", "monster"] as const;

/**
 * No cell may break a bound (docs/UNIFIED_CONTACT.md Stage 1 closes the ramp cells: a car perched across a wedge's edge or corner,
 * one ground point per tyre). The judge departs from its first form in two ways, measured on 7ec7db6 (336 ramp cells of the 2166):
 * - Ramp drops run 6 s, not 3: a car dropped across an edge is still sliding or rolling at 3 s, so a pose read at 3 s is a frame of
 *   a motion. 6 s changed the verdict of 4 cells.
 * - A car rolled past 60° rests on its side or roof, where no tyre, pose or slide bound applies (its tyres are metres up). Its whole
 *   hull (underside, bumpers, beltline and roof corners, as the drawn body carries them) must still be out of the ground and of the
 *   walls.
 * A face the car lies on yields by its crush (`Fit.crush`); its stock-face hull probes read that much too deep, so pen and overlap
 * allow it. Ground under the hubs that is not one plane is not excused: the pose bounds carry its spread and twist (the judge).
 */

// (a) The fleet's jump ramps, exactly as fleet-ramps.test.ts `scene()` builds them (no slab).
const ramps = new FleetRamps(new THREE.Scene());
ramps.place(0, null);
const collideRamps = collideOn(ramps);
const collide = (c: DeformableCar, h: number) => collideRamps(c, 0, h);
const MID = RAMP.start + RAMP.len / 2;

/** The +z ramp: the fleet lays its two ramps as mirror images either side of the run, so the other's cells are these reflected. */
function rampSites(): Site[] {
  const sites: Site[] = [];
  const add = (name: string, kind: Kind, x: number, z: number, classes: readonly VehicleClassId[]) =>
    sites.push({
      name: `ramp+z ${name}`,
      kind,
      classes,
      // 6 s: a car dropped on a ridge or an edge can still be rolling off it at 3 s (it is not at rest to judge).
      runs: (cls) => COMPASS.map(([h, yaw]): Run => [h, drop(ramps, cls, x, z, yaw, { collide, seconds: 6 })]),
    });
  add("mid-face", "plain", 0, MID, SEDAN);
  // The top: the car's tail hangs over the 1.2 m back wall, so there is no level pose to hold it to (edge).
  add("top (h 1.10)", "edge", 0, RAMP.start + 0.4, SEDAN);
  add("low end (h 0.08)", "plain", 0, RAMP.start + RAMP.len - 0.3, SEDAN);
  // Straddling the side edge: left wheels on the slope, right wheels on the flat beside it.
  const lips = [
    { lip: "front lip", z: RAMP.start + RAMP.len - 0.8 },
    { lip: "mid-face", z: MID },
    { lip: "rear lip", z: RAMP.start + 1 },
  ] as const;
  const edges = [
    { where: "on edge", x: RAMP.halfW },
    { where: "0.4 in", x: RAMP.halfW - 0.4 },
    { where: "0.4 out", x: RAMP.halfW + 0.4 },
  ] as const;
  for (const { lip, z } of lips) {
    for (const { where, x } of edges) {
      add(`${lip}: ${where}`, "edge", x, z, SEDAN_MONSTER);
    }
  }
  return sites;
}

// (b) The stunt course's crest and banks and the rally hairpin are ground-fit-road.test.ts, run beside this file.
const oval = new Track(TRACKS.find((j) => parseTrack(j).id === "oval")!);

describe("given a braked car placed at every heading across a matrix of ground sites, on springs so stiff and short that no sag excuses a gap", () => {
  let restoreSprings = (): void => {};
  beforeAll(() => {
    restoreSprings = useStiffSprings();
  });
  afterAll(() => restoreSprings());
  afterEach(() => setGround(null));

  it("when the car sits on fleet ramp faces, ends, rear lips and straddling the side edges, then it sits on the ground at every heading", (t) => report(t, rampSites()));
});

describe("given a car braking on a flat straight", () => {
  afterEach(() => setGround(null));

  // The drawn nose dips under braking (car-load's weight transfer, kept) toward a keel only 3.2 cm over the road: the drawn
  // body bottoms out on the road (`Suspension.bottomOut`) instead of the springs pressing it 3.5 cm in (sedan/muscle/police).
  it("when it brakes from 30 m/s, then every class dips its nose and keeps its drawn keel and bumpers out of the road", () => {
    for (const cls of VEHICLE_CLASS_IDS) {
      const out = drive(oval, cls, 60, 180, () => 30, { lead: 35, brakeFrom: 100 });
      let pen = 0;
      let dive = 0;
      for (const f of out) {
        if (f.s < 100) continue;
        pen = Math.max(pen, f.pen);
        dive = Math.min(dive, f.pitch - f.groundPitch);
      }
      expect(pen, `${cls}: the drawn underside is ${(pen * 100).toFixed(1)} cm in the road while braking`).toBeLessThanOrEqual(0.01);
      expect(dive, `${cls}: the drawn nose dips only ${(-dive).toFixed(2)}° (the dive look is gone)`).toBeLessThanOrEqual(-0.5);
    }
  });
});

describe("given a car with its brakes off on the fleet ramp's face", () => {
  afterEach(() => setGround(null));

  // The control for the judge's slide measure (the rigid centre's travel): a car that really rolls down the face reads as a slide.
  it("when a sedan is rolling down the face at 3 m/s with its brakes off for 3 s, then its centre has travelled past the slide bound and the judge flags it", () => {
    const r = drop(ramps, "sedan", 0, MID, 0, { collide, seconds: 3, brake: false, speed: 3 });
    expect(r.slide, `the centre slid only ${r.slide.toFixed(2)} m down the face`).toBeGreaterThan(0.5);
    expect(judge("plain", r).includes("slide"), "the judge does not flag the slide").toBeTruthy();
  });
});

describe("given the judge's reading of a hull point in the fleet ramp", () => {
  afterEach(() => setGround(null));

  /** How far (m) the controls' points stand in from the face they enter by. */
  const IN = 0.05;

  // The controls for the judge's depth: a point is as deep as its shortest way out, wall or floor, so the judge goes red when it
  // reads a side face as its height under the top (a point 1 mm in a side face and 10 cm under the top is 1 mm in, not 10 cm).
  it("when a point stands 5 cm through the ramp's side face and 10 cm under its top, then it reads 5 cm in by that side", () => {
    setGround(ramps);
    const top = ramps.heightAt(RAMP.halfW - IN, MID, undefined);
    const { depth, side } = bodyPointDepth(RAMP.halfW - IN, top - 0.1, MID);
    expect(side && Math.abs(depth - IN) < 1e-6, `${side ? "side" : "floor"} ${(depth * 100).toFixed(2)} cm in`).toBeTruthy();
  });

  it("when a point stands 1 mm inside the side face and 10 cm under the top, then it reads 1 mm in, not 10 cm", () => {
    setGround(ramps);
    const top = ramps.heightAt(RAMP.halfW - 0.001, MID, undefined);
    const { depth, side } = bodyPointDepth(RAMP.halfW - 0.001, top - 0.1, MID);
    expect(side && Math.abs(depth - 0.001) < 1e-6, `${side ? "side" : "floor"} ${(depth * 100).toFixed(2)} cm in`).toBeTruthy();
  });

  it("when a point stands 5 cm under the ramp's top, in the middle of its face, then it reads 5 cm in under it", () => {
    setGround(ramps);
    const top = ramps.heightAt(0, MID, undefined);
    const { depth, side } = bodyPointDepth(0, top - IN, MID);
    expect(!side && Math.abs(depth - IN) < 1e-6, `${side ? "side" : "floor"} ${(depth * 100).toFixed(2)} cm in`).toBeTruthy();
  });
});
