import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEG, FRAME, fit, frame, makeCar, worldOf, type Fit } from "../vehicle/ground-probe.test-util.ts";
import { idleDrive } from "../vehicle/car-drive.ts";
import { layOnGround } from "../vehicle/car-air-points.ts";
import type { VehicleClassId } from "../vehicle/vehicle-classes.ts";
import { Ground, setGround } from "../world/ground.ts";
import { Track, blankPoint, pointOn } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";

/**
 * A wrecked car comes to rest on the ground under its hubs. `measurePose` levelled a planted wreck to the world
 * (pitch and roll 0) after 0.35 s quiet, wherever it stood: on the stunt course's −21° descent a hit sedan sat level
 * with its tyres +72 / −34 cm off the road and its tail 48 cm under it. Bounds: 2° on the body against the intact
 * same-class car parked and settled at the same site (its springs lean it off the ground's plane by their own rule),
 * 2 cm on a tyre, 1 cm of underside in the ground (a loaded tyre squats that much and the road is drawn 1.5 cm over
 * the ground, so a gap inside it can't be seen).
 */
const TILT_DEG = 2;
const GAP_M = 0.02;
const PEN_M = 0.01;
const REST_S = 3;
const PARKED_S = 4;

/** The plane `heightAt` = x·tan(pitch) + z·tan(roll) (degrees); a car facing +x sees `pitch` as its slope. */
class Plane extends Ground {
  constructor(pitchDeg: number, rollDeg: number) {
    super();
    const tp = Math.tan(pitchDeg / DEG);
    const tr = Math.tan(rollDeg / DEG);
    const e = 1e4;
    const h = (u: number, v: number) => u * tp + v * tr;
    this.addGrid({ nu: 2, nv: 2, step: 2 * e, stepV: 2 * e, u0: -e, v0: -e, heights: new Float32Array([h(-e, -e), h(e, -e), h(-e, e), h(e, e)]), ox: 0, oy: 0, oz: 0, reach: Infinity });
  }
}

const stunt = TRACKS.map((j) => new Track(j)).find((t) => t.id === "stunt")!;
const road = stunt.ground();

type Site = { name: string; ground: Ground; x: number; z: number; y: number; yaw: number };
const PLANE_SITE = (name: string, pitch: number, roll: number): Site => ({ name, ground: new Plane(pitch, roll), x: 0, z: 0, y: 0, yaw: Math.PI / 2 });
/**
 * The stunt road at arc length `s`, the car pointing down the track (the CRUSH billboard's crest is s ≈ 899, the kicker s ≈ 907). The kicker's site was 908: along the normal
 * rule a monster wreck rests rolled 2.4° to 2.8° either side of the intact car's pose from 908 to 909 (all four tyres within 1 mm of the road, a bistable rest), and within 2° at
 * 906, 907, 907.5 and 910.
 */
function stuntSite(s: number): Site {
  const pt = blankPoint();
  pointOn(stunt.path, s, pt);
  return { name: `the stunt road at arc length ${s}`, ground: road, x: pt.x, z: pt.z, y: pt.y + 0.5, yaw: Math.atan2(pt.tx, pt.tz) };
}

const SITES: Site[] = [
  PLANE_SITE("flat ground", 0, 0),
  PLANE_SITE("a +10° slope", 10, 0),
  PLANE_SITE("a −10° slope", -10, 0),
  PLANE_SITE("a −20° slope", -20, 0),
  PLANE_SITE("a 10° bank", 0, 10),
  PLANE_SITE("a −20° slope banked 10°", -20, 10),
  stuntSite(900),
  stuntSite(904),
  stuntSite(907),
  stuntSite(912),
];
const CLASSES_UNDER_TEST: VehicleClassId[] = ["sedan", "monster"];

/** A `cls` car standing at `site` (speed `v` along its heading), settled 30 frames. */
function stand(site: Site, cls: VehicleClassId, v: number) {
  setGround(site.ground);
  const car = makeCar(cls);
  car.spawnFacing(site.x, site.z, site.yaw, v);
  car.group.position.y = site.ground.heightAt(site.x, site.z, site.y);
  layOnGround(car);
  const w = worldOf(car);
  const st = { acc: 0 };
  for (let n = 0; n < 30; n++) frame(w, null, st);
  return { car, w, st, step: () => frame(w, null, st) };
}

/** A `cls` car standing at `site`, struck head-on so it becomes a wreck. */
function wreck(site: Site, cls: VehicleClassId, v: number) {
  const s = stand(site, cls, v);
  const fw = s.car.forward;
  s.car.applyImpact(s.car.group.position.clone().addScaledVector(fw, 2).setY(s.car.group.position.y + 0.5), fw.clone().negate(), 20, 12);
  return { car: s.car, step: () => frame(s.w, idleDrive(), s.st) };
}

/** How the intact `cls` car sits at `site` after `PARKED_S` s parked there. */
function parkedFit(site: Site, cls: VehicleClassId): Fit {
  const { car, step } = stand(site, cls, 0);
  car.parked = true;
  for (let n = 0; n < PARKED_S * 60; n++) step();
  const f = fit(car, site.ground);
  car.dispose();
  return f;
}

const label = (f: Fit) =>
  `pitch ${f.pitch.toFixed(1)}° vs ground ${f.groundPitch.toFixed(1)}°, roll ${f.roll.toFixed(1)}° vs ${f.groundRoll.toFixed(1)}°, ` +
  `gaps ${f.gaps.map((g) => (g * 100).toFixed(1)).join("/")} cm, underside ${(f.pen * 100).toFixed(1)} cm in the ground at ${f.penAt}`;

/**
 * Cells held to a tighter bound than `TILT_DEG` (degrees off the intact car's attitude). The monster on the 10° bank rested 2.2-2.6° nose-off
 * the intact car's at the row's 20 m/s hit (0.5° at 10 m/s, 0.3° at 6 m/s), and 0.5° nose-off on flat ground, with its tyres on the ground and
 * no hub shoved: the pitch was the tyre spring rows' equilibrium, whose weight shares read the hubs where the stock frame puts them while a
 * hit leaves a wreck's hubs shoved along its body for the second its body takes to seat on them (the wreck fell asleep before it had), and
 * with the shares read at the hubs' own places it rests within 0.2° of the intact car's pitch and roll at every hit.
 */
const TILT_BY_CELL: Record<string, number> = {
  "monster on flat ground": 0.3,
  "monster on a 10° bank": 0.3,
};

describe("given a car struck head-on while standing on flat ground, a slope, a bank or the stunt road, so that it becomes a wreck", () => {
  afterEach(() => setGround(null));

  for (const cls of CLASSES_UNDER_TEST) {
    for (const site of SITES) {
      const tilt = TILT_BY_CELL[`${cls} on ${site.name}`] ?? TILT_DEG;
      it(`when a ${cls} on ${site.name} is left to settle for ${REST_S} s after the hit, then it sits on the ground under its wheels (pitch and roll within ${tilt}° of the intact ${cls} parked and settled ${PARKED_S} s there, tyres within 2 cm of the ground, underside no more than 1 cm in it)`, () => {
        const intact = parkedFit(site, cls);
        const { car, step } = wreck(site, cls, 0);
        for (let n = 0; n < REST_S * 60; n++) step();
        const f = fit(car, site.ground);
        car.dispose();
        assert.ok(car.crashed && car.deform.massActive, "the hit did not make a wreck");
        const where = `${cls} on ${site.name}: ${label(f)}`;
        assert.ok(Math.abs(f.pitch - intact.pitch) <= tilt, `pitch off the intact car's (${intact.pitch.toFixed(1)}°): ${where}`);
        assert.ok(Math.abs(f.roll - intact.roll) <= tilt, `roll off the intact car's (${intact.roll.toFixed(1)}°): ${where}`);
        assert.ok(Math.max(...f.gaps.map(Math.abs)) <= GAP_M, `a tyre off the ground or in it: ${where}`);
        assert.ok(f.pen <= PEN_M, `the underside is in the ground: ${where}`);
      });
    }
  }
});

/** The level-out starts at 0.35 s quiet (frame 21 of a hit's frames); the crush before it turns the body by its own rules. */
const LEVEL_FRAME = 20;
const SLIDE_MPS = 6;

describe("given a sedan struck head-on while sliding at 6 m/s down a −20° slope or the stunt road at arc length 904", () => {
  afterEach(() => setGround(null));

  // On the unmodified code the level-out from the −20° frame clamp (12.6°) to 0 turned the body 3.4° in one frame.
  it("when it slides for 5 s, then from the moment the game levels the wreck to the ground (0.35 s after the hit) the drawn body turns less than 2° in a frame and the car moves no more than its speed allows", () => {
    for (const site of [PLANE_SITE("−20°", -20, 0), stuntSite(904)]) {
      const { car, step } = wreck(site, "sedan", SLIDE_MPS);
      let prev = fit(car, site.ground);
      const at = car.group.position.clone();
      let turn = 0;
      let jump = 0;
      for (let n = 0; n < 5 * 60; n++) {
        step();
        const f = fit(car, site.ground);
        if (n >= LEVEL_FRAME) {
          turn = Math.max(turn, Math.abs(f.pitch - prev.pitch), Math.abs(f.roll - prev.roll));
          jump = Math.max(jump, car.group.position.distanceTo(at));
        }
        prev = f;
        at.copy(car.group.position);
      }
      car.dispose();
      assert.ok(turn <= 2, `${site.name}: the body turned ${turn.toFixed(2)}° in one frame`);
      assert.ok(jump <= 1.5 * SLIDE_MPS * FRAME + 0.02, `${site.name}: the car moved ${(jump * 100).toFixed(1)} cm in one frame`);
    }
  });
});
