import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { makeCar, runWall } from "../contact/crash-scenarios.test-util.ts";
import { _lane, hitMirror } from "../contact/door-contact.ts";
import { DOOR_OPEN_MAX, HINGE_TEAR_J, MIRROR_BREAK_J, MIRROR_FOLD_MAX, SLAM_TEAR_J } from "../vehicle/car-core.ts";
import { DeformableCar } from "../vehicle/car.ts";
import type { CarStyleId } from "../vehicle/car-variants.ts";
import { DoorRig, type DoorScenario, type RamShot } from "./door-rig.ts";
import { fireRam } from "./door-rig.test-util.ts";
import { assertSameDigest, paint } from "../vehicle/test-support.ts";

/** The door swing integrates at its own 120 Hz, a finer step than the quiet one: the test pins one second of it, not the shipped step. */
const SWING_HZ = 120;

/**
 * Door/mirror knock scenes (docs/DOOR_RIG.md, sketch docs/door-mirror-sketch.png). A ram on a lane
 * beside a parked car: A grazes the shut door's mirror, B drives the open door past its stop,
 * C drives the open door shut. The ram only meets the door and mirror colliders, so the body
 * (control particles and skinned vertices) must not move at all; 1 mm is the tolerance.
 */

const BODY_TOL_MM = 1;
const R2D = 180 / Math.PI;
/** Ram mass (kg) at `kph` carrying `share` × the mirror's break energy. */
const kgFor = (share: number, kph: number): number => (2 * share * MIRROR_BREAK_J) / (kph / 3.6) ** 2;

type Case = {
  scenario: DoorScenario;
  level: string;
  kph: number;
  kg: number;
  /** Parts off the car, as door/mirror without the L/R suffix. */
  off: ("door" | "mirror")[];
  check: (r: RamShot) => void;
};

const CASES: Case[] = [
  {
    scenario: "mirror",
    level: "carrying 0.8× the mirror's break energy, where its fold stop holds",
    kph: 4,
    kg: kgFor(0.8, 4),
    off: [],
    check: (r) => {
      assert.ok(r.mirrorFoldDeg > MIRROR_FOLD_MAX * R2D - 1, `mirror folded only ${r.mirrorFoldDeg}°`);
      assert.ok(r.ramStopped, "the folded mirror's stop should have stopped the ram");
    },
  },
  { scenario: "mirror", level: "carrying 1.25× the mirror's break energy", kph: 4, kg: kgFor(1.25, 4), off: ["mirror"], check: () => {} },
  { scenario: "mirror", level: "as a fast heavy ram", kph: 50, kg: 1500, off: ["mirror"], check: () => {} },
  {
    scenario: "overOpen",
    level: "below the hinge tear threshold",
    kph: 5,
    kg: 120,
    off: [],
    check: (r) => {
      assert.ok(Math.abs(r.doorDeg - DOOR_OPEN_MAX * R2D) < 0.5, `door at ${r.doorDeg}°, not on its stop`);
      assert.ok(r.hingeLoadJ > 0 && r.hingeLoadJ < HINGE_TEAR_J, `hinge load ${r.hingeLoadJ} J`);
      assert.ok(r.ramStopped, "the strap should have stopped the ram");
    },
  },
  { scenario: "overOpen", level: "above the hinge tear threshold", kph: 15, kg: 300, off: ["door", "mirror"], check: () => {} },
  {
    scenario: "shut",
    level: "with low force, which re-closes the door",
    kph: 4,
    kg: 300,
    off: [],
    check: (r) => assert.ok(r.doorDeg < 0.01, `door left ${r.doorDeg}° open`),
  },
  { scenario: "shut", level: "with high force, which slams the door off", kph: 40, kg: 300, off: ["door", "mirror"], check: () => {} },
];

describe("given a ram on a lane beside a parked car (mirror: A grazes the shut door's mirror; overOpen: B drives the open door past its stop; shut: C drives the open door shut)", () => {
  for (const side of [-1, 1] as const) {
    const suffix = side < 0 ? "L" : "R";
    for (const c of CASES) {
      it(`when the ${c.scenario} ram hits the ${suffix} side ${c.level}, then the parts that come off are [${c.off.join(", ")}] and the body does not move more than 1 mm`, () => {
        const r = fireRam(makeCar(), c.scenario, { kph: c.kph, kg: c.kg, side });
        assertSameDigest([...r.detached].sort(), c.off.map((p) => p + suffix).sort(), `detached [${[...r.detached].sort()}]`);
        const doorOn = !c.off.includes("door");
        if (doorOn && c.scenario !== "overOpen") assert.ok(r.latched, "door should be shut and latched");
        assert.ok(r.bodyParticleMm <= BODY_TOL_MM, `control particles moved ${r.bodyParticleMm} mm`);
        assert.ok(r.bodyVertexMm <= BODY_TOL_MM, `skinned vertices moved ${r.bodyVertexMm} mm`);
        c.check(r);
      });
    }
  }
});

describe("given a car's right door swung from half a radian open at a chosen opening rate", () => {
  const inertia = makeCar().doorHinge(1).spec.inertia;
  /** Opening rate (rad/s) whose swing carries `share` × `energy` (J). */
  const omegaFor = (share: number, energy: number): number => Math.sqrt((2 * share * energy) / inertia);
  const swing = (theta: number, omega: number) => {
    const car = makeCar();
    car.setDoorOpen(1, theta);
    car.doorHinge(1).omega = omega;
    for (let i = 0; i < SWING_HZ; i++) car.swingHinges(1 / SWING_HZ);
    return car;
  };

  // 1.15×: the margin 1.1× had over the swing's losses from half a radian on the shorter, lighter door the row was written for.
  it("when it is swung shut at 0.9× and then 1.15× the slam limit, then the first latches shut and the second tears the door off", () => {
    const soft = swing(0.5, -omegaFor(0.9, SLAM_TEAR_J));
    assert.ok(!soft.partOff("doorR") && soft.doorHinge(1).latched && soft.doorHinge(1).theta === 0);
    assert.ok(swing(0.5, -omegaFor(1.15, SLAM_TEAR_J)).partOff("doorR"), "1.15× slam energy kept the door on");
  });

  it("when it is flung open onto its stop at 0.9× and then 1.2× the hinge limit, then the first stays on at the stop and the second tears the door off together with its mirror", () => {
    const soft = swing(0.5, omegaFor(0.9, HINGE_TEAR_J));
    assert.ok(!soft.partOff("doorR"));
    assert.ok(Math.abs(soft.doorHinge(1).theta - DOOR_OPEN_MAX) < 0.05, `door at ${soft.doorHinge(1).theta * R2D}°`);
    const hard = swing(0.5, omegaFor(1.2, HINGE_TEAR_J));
    assert.ok(hard.partOff("doorR") && hard.partOff("mirrorR"), "door and its mirror should leave together");
  });
});

describe("given a car driven at 64 km/h head-on into a wall", () => {
  it("when the crash settles, then both doors stay on and both hinges are shut, latched and unloaded", () => {
    const car = makeCar();
    const r = runWall(64, 1, "front", { car });
    assert.ok(!r.detached.some((p) => p.startsWith("door")), `detached ${r.detached.join(",")}`);
    for (const side of [-1, 1]) {
      const h = car.doorHinge(side);
      assert.ok(h.latched && h.theta === 0 && h.load === 0, `side ${side} hinge ${JSON.stringify(h)}`);
    }
  });
});

/** A parked car of style `id` facing +Z. */
function parkedStyle(id: CarStyleId): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
  car.spawnFacing(0, 0, 0, 0);
  return car;
}

/** The heavy ram the lid lanes are pinned with (kg): a car's mass, so the tail crushes as a rear-ender's does. */
const LID_RAM_KG = 1500;

describe("given a rear ram square into the tail of a parked car (F lidPop: lid shut; G lidTear: lid on its stop; docs/DOOR_RIG.md, Lids)", () => {
  for (const id of ["sedan", "hatchback", "wagon", "pickup"] as const) {
    it(`when F hits the ${id} at 15 and then 30 km/h, then the first leaves the lid latched and the second springs it, still on the car`, (t) => {
      const soft = parkedStyle(id);
      fireRam(soft, "lidPop", { kph: 15, kg: LID_RAM_KG });
      const hard = parkedStyle(id);
      fireRam(hard, "lidPop", { kph: 30, kg: LID_RAM_KG });
      t.diagnostic(`${id}: 15 km/h latched ${soft.lidHinge().latched}, 30 km/h latched ${hard.lidHinge().latched} at ${hard.lidAngle().toFixed(3)} rad`);
      assert.ok(soft.lidHinge().latched && !soft.lidOff(), `${id} lid sprang at 15 km/h`);
      assert.ok(!hard.lidHinge().latched && !hard.lidOff(), `${id} lid at 30 km/h: latched ${hard.lidHinge().latched}, off ${hard.lidOff()}`);
    });
  }

  // The ram meets the tail, not the lid: the lid tears once the crush passes its `tearT` in a hit of `tearMps` EBS or more.
  for (const id of ["sedan", "pickup"] as const) {
    it(`when G hits the ${id}'s open lid at 15 km/h and then a 5000 kg ram at 56 km/h, then the first leaves it on its stop and the second tears it off`, () => {
      const open = parkedStyle(id);
      fireRam(open, "lidTear", { kph: 15, kg: LID_RAM_KG });
      const h = open.lidHinge();
      const hard = parkedStyle(id);
      const torn = fireRam(hard, "lidTear", { kph: 56, kg: 5000 });
      assert.ok(!h.latched && h.theta === h.spec.stop && !open.lidOff(), `${id} 15 km/h: latched ${h.latched} at ${h.theta} rad, off ${open.lidOff()}`);
      assert.ok(torn.detached.includes("trunk") && hard.hasLoosePart(), `${id} 56 km/h lid stayed on: [${torn.detached}]`);
    });
  }
});

describe("given the Doors scene's lid state for the park (share key dlid)", () => {
  it("when the rig attaches a freshly reset car with lid 1 and then 2, then the first lid hangs unlatched on its stop and the second is off the car", () => {
    const rig = new DoorRig();
    const open = parkedStyle("sedan");
    rig.lid = 1;
    rig.attach(open);
    const h = open.lidHinge();
    assert.ok(!h.latched && h.theta === h.spec.stop && !open.lidOff(), `lid 1: latched ${h.latched} at ${h.theta} rad`);
    const torn = parkedStyle("sedan");
    rig.lid = 2;
    rig.attach(torn);
    assert.ok(torn.lidOff(), "lid 2 left the lid on");
  });
});

describe("given a mirror on a shut right door struck by a face that clears its base by half the cap's reach", () => {
  /** A 5 m/s, 300 kg striker whose inner edge stands `share` × the cap's reach out from the mirror's base and whose face is well past the cap; the mirror's fold (rad) after it. */
  const strikeMirror = (car: DeformableCar, share: number): number => {
    const d = car.style.door;
    Object.assign(_lane, {
      dir: 1,
      inner: car.mirrorBaseX + share * d.mirrorReach,
      width: 0.4,
      bottom: car.mirrorSpanY[1] - 0.02,
      top: car.mirrorSpanY[1] + 0.4,
      face: d.hingeZ - (d.mirrorZ ?? 0) + 2 * d.mirrorReach,
      length: 0.5,
      u: 5,
      kg: 300,
    });
    hitMirror(car, 1, _lane);
    return Math.abs(car.doorHinge(1).mirrorFold);
  };

  it("when the face has passed the cap, then the mirror folds just until its tip clears the face (acos of half) and not onto its stop, and the striker keeps its speed", () => {
    assert.ok(Math.acos(0.5) < MIRROR_FOLD_MAX, "acos(0.5) is past the stop: the clear branch is not the one under test");
    const fold = strikeMirror(makeCar(), 0.5);
    assert.ok(Math.abs(fold - Math.acos(0.5)) < 1e-9, `fold ${fold} rad, acos(0.5) ${Math.acos(0.5)} rad`);
    assert.equal(_lane.u, 5);
  });

  it("when the mirror is already folded onto its stop, then the strike leaves it there", () => {
    const car = makeCar();
    car.setMirrorFold(1, -MIRROR_FOLD_MAX);
    assert.equal(strikeMirror(car, 0.5), MIRROR_FOLD_MAX);
  });
});
