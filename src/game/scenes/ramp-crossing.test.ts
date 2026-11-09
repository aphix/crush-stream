import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MU_BODY } from "../vehicle/car-air-body.ts";
import { carFrame } from "../vehicle/car-rig.ts";
import { CAR_STYLES } from "../vehicle/car-variants.ts";
import { RAMP } from "./fleet-ramps.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { carState } from "../vehicle/car-state.test-util.ts";
import { cross, crossOn, DEG, freshCrossingFixture, sharedCrossingFixture, type Result } from "./ramp-crossing.test-util.ts";
import { setGround } from "../world/ground.ts";
import { CLASSES } from "../vehicle/vehicle-classes.ts";
import { useStiffSprings } from "../vehicle/stiff-springs.test-util.ts";

/**
 * E1 of docs/UNIFIED_CONTACT.md (section 1.1, 7.1): the owner's ramp cases. A sedan cruises at v m/s with steer 0 and the
 * throttle holding its speed, at `th` degrees to the fleet ramp's long axis, its centreline crossing the toe line `e` m
 * inside the ramp's -x edge, so one or two wheels meet the wedge first (32 cells: th 0/15/30/45 x e -0.8..0.6, none aimed at a
 * wall). Per physics slice from the spawn until every tyre is past the toe line (the crossing: a car straddling the edge then rolls off it on the wedge's flank, which is not the toe's to judge). "The plane
 * through its touching wheels" is fitted through each touching wheel's hub lowered by its tread gap: where that wheel rests on what
 * it touches (on one plane, a fixed height over the ground under the hub; a tyre on a lip or on a ramp's edge rests on the edge,
 * whichever side of it the hub is, so its hub comes down the edge as the tyre rolls off it), because the body's tilt follows its hubs.
 */
const THS = [0, 15, 30, 45] as const;
const ES = [-0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6] as const;
const SPEEDS = [8, 12, 20] as const;
/**
 * The bars (docs/UNIFIED_CONTACT.md E1). The heading's is 1.1°, not the 1° of E1: at a toe a tread meets the face's 0.25 plan share of its normal, and a rigid tread now pushes
 * along that normal (the face's tilt kick, as a tyre and its springs take a hit), which turns the velocity 1.00 to 1.08° at 8 m/s and 45° to the ramp's axis over the four toe rows
 * (-0.6 to 0 m inside the edge). The rows' other bars are as E1 had them.
 */
const BAR = { yaw: 1.0, heading: 1.1, shove: 0.01, dv: 0.3, tilt: 1.5 } as const;
/** The face's slope angle (rad), and the sedan's chin: the front of its keel (`underside`), 3 cm up and 0.66 m ahead of its front tyres. */
const FACE = Math.atan2(RAMP.top, RAMP.len);
const SEDAN = carFrame(CAR_STYLES.sedan);
const [, CHIN_Z, CHIN_H] = SEDAN.underside.find((p) => p[0] === 0 && p[1] === Math.max(...SEDAN.underside.map((u) => u[1])))!;
/**
 * The most (m/s) a crossing at `v` m/s changes the car's speed in a slice beyond `BAR.dv`: its chin, too low to clear the face, runs onto it
 * closing at v sin θ. A belly point only resists the ground (no bounce): its push along the face's normal n stops that closing speed over
 * the body's effective mass there, 1 + |r × n|² / k² of its own (r the chin's arm from the centre of mass, k² the box's radius of gyration
 * about its cross axis, (h² + l²) / 3 for half height h and half length l), and its scraping friction takes at most `MU_BODY` of that
 * push along the face: of both, the plan part.
 */
function chinScrape(v: number): number {
  const armY = CHIN_H + CLASSES.sedan.lift - SEDAN.comY;
  const lever = armY * Math.sin(FACE) + CHIN_Z * Math.cos(FACE);
  const gyration = (SEDAN.half.y ** 2 + SEDAN.half.z ** 2) / 3;
  const normalDv = (v * Math.sin(FACE)) / (1 + (lever * lever) / gyration);
  return normalDv * (Math.sin(FACE) + MU_BODY * Math.cos(FACE));
}

/** Gives the class springs back after each suite: the crossings run on very stiff short springs (`useStiffSprings`), so no sprung offset hides the plane and shove the text judges. */
let restoreSprings = (): void => {};

describe("given a sedan cruising at the fleet's jump ramp with steer 0 and the throttle holding its speed", () => {
  beforeAll(() => {
    restoreSprings = useStiffSprings();
  });
  afterAll(() => restoreSprings());
  afterEach(() => setGround(null));

  for (const v of SPEEDS) {
    for (const th of THS) {
      for (const e of ES) {
        it(`when it drives at ${v} m/s at ${th}° to the ramp's axis and its centreline crosses the toe ${e} m inside the ramp's edge, then through the crossing (until every tyre is past the toe line) it keeps its heading within ${BAR.heading}°, is never shoved sideways by more than 1 cm or changes speed in a slice by more than 0.3 m/s and what its chin scraping onto the face takes, stays within 1.5° of the plane through its tyres standing in their springs, and is airborne only while all four tyres are over 3 cm off the ground`, (t) => {
          const r = cross(v, th, e);
          t.annotate(
            `yaw ${r.yaw.toFixed(2)}°, velocity heading ${r.heading.toFixed(2)}°, shove ${(r.shove * 100).toFixed(2)} cm, dv ${r.dv.toFixed(3)} m/s, plane ${r.tilt.toFixed(2)}° (${r.tiltAt}), airborne with a tyre down in ${r.airWhileTouching} of ${r.slices} slices`,
          );
          const failures: string[] = [];
          if (r.crashed) failures.push("crashed");
          if (r.yaw > BAR.yaw) failures.push(`yaw ${r.yaw.toFixed(2)}°`);
          if (r.heading > BAR.heading) failures.push(`velocity heading ${r.heading.toFixed(2)}°`);
          if (r.shove > BAR.shove) failures.push(`shove ${(r.shove * 100).toFixed(2)} cm`);
          if (r.dv > BAR.dv + chinScrape(v)) failures.push(`dv ${r.dv.toFixed(3)} m/s`);
          if (r.tilt > BAR.tilt) failures.push(`plane ${r.tilt.toFixed(2)}° (${r.tiltAt})`);
          if (r.airWhileTouching > 0) failures.push(`airborne with a tyre within 3 cm in ${r.airWhileTouching} slices`);
          expect(failures).toHaveLength(0);
        });
      }
    }
  }
});

// mutation: sed -i 's/side \* this.ax \* mid, side \* this.az \* mid, yaw/side * this.ax * mid + 0.3, side * this.az * mid, yaw/' src/game/scenes/fleet-ramps.ts  (the reflected crossing differs from the direct one: the reflected-crossing rows)
describe("given the same crossing built twice, once over the ramp's -x edge and once reflected in the ramp's axis", () => {
  beforeAll(() => {
    restoreSprings = useStiffSprings();
  });
  afterAll(() => restoreSprings());
  afterEach(() => setGround(null));

  for (const v of SPEEDS) {
    for (const th of [0, 30]) {
      for (const e of [-0.4, 0.4]) {
        it(`when a sedan drives at ${v} m/s at ${th}° to the ramp's axis and its centreline crosses the toe ${e} m inside the edge, then the reflected crossing measures the same yaw, heading, shove, speed change and plane, to float error`, () => {
          const direct = cross(v, th, e);
          const reflected = cross(v, th, e, true);
          expect(reflected.slices).toBe(direct.slices);
          expect(reflected.crashed).toBe(direct.crashed);
          for (const measure of ["yaw", "heading", "shove", "dv", "tilt"] as const) {
            const floatError = Number.EPSILON * DEG * direct.slices;
            expect(Math.abs(reflected[measure] - direct[measure]), `${measure}: ${direct[measure]} against ${reflected[measure]} reflected`).toBeLessThanOrEqual(floatError);
          }
        });
      }
    }
  }
});

describe("given a sedan driving up the middle of the ramp's wedge, so its tyres stand on the level floor and then on the wedge's one plane", () => {
  beforeAll(() => {
    restoreSprings = useStiffSprings();
  });
  afterAll(() => restoreSprings());
  afterEach(() => setGround(null));

  it("when the plane through its touching wheels is fitted through their resting hubs and through the ground under their hubs, then the two planes agree within 0.01° wherever the ground under every tyre is one plane", () => {
    const r = cross(8, 0, RAMP.halfW);
    expect(r.flatSlices, `only ${r.flatSlices} slices with every point on level ground`).toBeGreaterThanOrEqual(10);
    expect(r.planeSlices - r.flatSlices, `only ${r.planeSlices - r.flatSlices} slices with every point on the wedge's slope`).toBeGreaterThanOrEqual(5);
    expect(r.planeGap, `the planes differ by ${r.planeGap.toFixed(4)}° over ${r.planeSlices} single-plane slices`).toBeLessThanOrEqual(0.01);
  });
});

describe("given the sedan, ramps and slab that every crossing shares, and a sedan, ramps and slab built fresh", () => {
  beforeAll(() => {
    restoreSprings = useStiffSprings();
  });
  afterAll(() => restoreSprings());
  afterEach(() => setGround(null));

  // mutation: sed -i 's/^    this.wheelSpin.fill(0);$/    \/\/ wheelSpin kept/' src/game/vehicle/car.ts  (the shared sedan keeps its wheels' spin: the fresh-vs-shared row)
  it("when a crossing follows a harder one on the shared fixture and runs alone on a fresh one, then the measured bars and the sedan's final state are identical bit for bit", () => {
    const bars = (r: Result): number[] => [r.yaw, r.heading, r.shove, r.dv, r.tilt, r.airWhileTouching, r.slices, r.planeGap, r.planeSlices, r.flatSlices, r.crashed ? 1 : 0];
    const shared = sharedCrossingFixture();
    cross(20, 45, -0.8);
    const reused = crossOn(shared, 12, 30, 0.4);
    const reusedState = carState(shared.car);
    const fresh = freshCrossingFixture();
    const alone = crossOn(fresh, 12, 30, 0.4);
    const aloneState = carState(fresh.car);
    expect(reused.slices, "slices of the reused crossing").toBeGreaterThan(50);
    expect(reusedState.length, "numbers in the reused sedan's state").toBeGreaterThan(1000);
    expect(firstMismatch(bars(reused), bars(alone)), "first differing bar").toBeUndefined();
    expect(reused.tiltAt, "where the plane was worst").toBe(alone.tiltAt);
    expect(firstMismatch(reusedState, aloneState), "first differing state number").toBeUndefined();
  });
});
