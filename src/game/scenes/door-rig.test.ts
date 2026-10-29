import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { makeCar, runWall } from "../contact/crash-scenarios.test-util.ts";
import { _lane, hitMirror } from "../contact/door-contact.ts";
import { DOOR_OPEN_MAX, HINGE_TEAR_J, MIRROR_BREAK_J, MIRROR_FOLD_MAX, SLAM_TEAR_J } from "../vehicle/car-core.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { CAR_STYLE_IDS, type CarStyleId } from "../vehicle/car-variants.ts";
import { DoorRig, type DoorScenario, type RamShot } from "./door-rig.ts";
import { drawnBox, fireRam, laneBox, LANE_PART, overlapMetres, parkedStyle, partName } from "./door-rig.test-util.ts";
import { assertSameDigest } from "../vehicle/test-support.ts";

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
      expect(r.mirrorFoldDeg, `mirror folded only ${r.mirrorFoldDeg}°`).toBeGreaterThan(MIRROR_FOLD_MAX * R2D - 1);
      expect(r.ramStopped, "the folded mirror's stop should have stopped the ram").toBeTruthy();
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
      expect(Math.abs(r.doorDeg - DOOR_OPEN_MAX * R2D), `door at ${r.doorDeg}°, not on its stop`).toBeLessThan(0.5);
      expect(r.hingeLoadJ > 0 && r.hingeLoadJ < HINGE_TEAR_J, `hinge load ${r.hingeLoadJ} J`).toBeTruthy();
      expect(r.ramStopped, "the strap should have stopped the ram").toBeTruthy();
    },
  },
  { scenario: "overOpen", level: "above the hinge tear threshold", kph: 15, kg: 300, off: ["door", "mirror"], check: () => {} },
  {
    scenario: "shut",
    level: "with low force, which re-closes the door",
    kph: 4,
    kg: 300,
    off: [],
    check: (r) => expect(r.doorDeg, `door left ${r.doorDeg}° open`).toBeLessThan(0.01),
  },
  { scenario: "shut", level: "with high force, which slams the door off", kph: 40, kg: 300, off: ["door", "mirror"], check: () => {} },
];

/** The cars the sketch cases run on: the sedan the rows were written on (`makeCar`), then every other style, the muscle (coupe) with its short bullet mirror among them. */
const SKETCH_CARS = CAR_STYLE_IDS.map((id) => ({ name: id === "coupe" ? "muscle (coupe)" : id, park: id === "sedan" ? makeCar : () => parkedStyle(id) }));

for (const sketchCar of SKETCH_CARS) {
  describe(`given a ram on a lane beside a parked ${sketchCar.name} (mirror: A grazes the shut door's mirror; overOpen: B drives the open door past its stop; shut: C drives the open door shut)`, () => {
    for (const side of [-1, 1] as const) {
      const suffix = side < 0 ? "L" : "R";
      for (const c of CASES) {
        it(`when the ${c.scenario} ram hits the ${suffix} side ${c.level}, then the parts that come off are [${c.off.join(", ")}] and the body does not move more than 1 mm`, () => {
          const r = fireRam(sketchCar.park(), c.scenario, { kph: c.kph, kg: c.kg, side });
          assertSameDigest([...r.detached].sort(), c.off.map((p) => p + suffix).sort(), `detached [${[...r.detached].sort()}]`);
          const doorOn = !c.off.includes("door");
          if (doorOn && c.scenario !== "overOpen") expect(r.latched, "door should be shut and latched").toBeTruthy();
          expect(r.bodyParticleMm, `control particles moved ${r.bodyParticleMm} mm`).toBeLessThanOrEqual(BODY_TOL_MM);
          expect(r.bodyVertexMm, `skinned vertices moved ${r.bodyVertexMm} mm`).toBeLessThanOrEqual(BODY_TOL_MM);
          c.check(r);
        });
      }
    }
  });
}

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
    expect(!soft.partOff("doorR") && soft.doorHinge(1).latched && soft.doorHinge(1).theta === 0).toBeTruthy();
    expect(swing(0.5, -omegaFor(1.15, SLAM_TEAR_J)).partOff("doorR"), "1.15× slam energy kept the door on").toBeTruthy();
  });

  it("when it is flung open onto its stop at 0.9× and then 1.2× the hinge limit, then the first stays on at the stop and the second tears the door off together with its mirror", () => {
    const soft = swing(0.5, omegaFor(0.9, HINGE_TEAR_J));
    expect(!soft.partOff("doorR")).toBe(true);
    expect(Math.abs(soft.doorHinge(1).theta - DOOR_OPEN_MAX), `door at ${soft.doorHinge(1).theta * R2D}°`).toBeLessThan(0.05);
    const hard = swing(0.5, omegaFor(1.2, HINGE_TEAR_J));
    expect(hard.partOff("doorR") && hard.partOff("mirrorR"), "door and its mirror should leave together").toBeTruthy();
  });
});

describe("given a car driven at 64 km/h head-on into a wall", () => {
  it("when the crash settles, then both doors stay on and both hinges are shut, latched and unloaded", () => {
    const car = makeCar();
    const r = runWall(64, 1, "front", { car });
    expect(!r.detached.some((p) => p.startsWith("door")), `detached ${r.detached.join(",")}`).toBe(true);
    for (const side of [-1, 1]) {
      const h = car.doorHinge(side);
      expect(h.latched && h.theta === 0 && h.load === 0, `side ${side} hinge ${JSON.stringify(h)}`).toBeTruthy();
    }
  });
});

/**
 * F's head springs the shut lid's latch by crushing the tail at it `LID_LATCH_CRUSH_M` (2 cm): 6 km/h with 20 kg dents it 1.5 cm and leaves it latched, 12 km/h
 * with 100 kg dents it 2.2 cm and springs it. These replace the rows that pinned 15 km/h latched and 30 km/h sprung with a 1500 kg ram: those were measured on
 * the headless pickup, when only the whole tail's crush (30-50 kJ, which carried the car 3-6 m) could spring a lid; the owner's ruling is that a lane knocks its
 * part and does not push the car.
 */
const LATCH_GENTLE = { kph: 6, kg: 20 } as const;
const LATCH_HARD = { kph: 12, kg: 100 } as const;

describe("given a rear ram square into the tail of a parked car (F lidPop: lid shut; G lidTear: lid on its stop; docs/DOOR_RIG.md, Lids)", () => {
  for (const id of CAR_STYLE_IDS) {
    it(`when F hits the ${id} with a 1.5 cm and then a 2.2 cm tail crush, then the first leaves the lid latched and the second springs it, still on the car`, () => {
      const soft = parkedStyle(id);
      fireRam(soft, "lidPop", LATCH_GENTLE);
      const hard = parkedStyle(id);
      fireRam(hard, "lidPop", LATCH_HARD);
      expect(soft.lidHinge().latched && !soft.lidOff(), `${id} lid sprang at ${LATCH_GENTLE.kph} km/h`).toBeTruthy();
      expect(!hard.lidHinge().latched && !hard.lidOff(), `${id} lid at ${LATCH_HARD.kph} km/h: latched ${hard.lidHinge().latched}, off ${hard.lidOff()}`).toBeTruthy();
    });
  }

  // G's head meets the open lid on its strap: under the hinge's tear energy it holds, past it the lid leaves and the tail is left alone.
  for (const id of CAR_STYLE_IDS) {
    it(`when G hits the ${id}'s open lid with 35 J and then 555 J, then the first leaves it on its stop and the second tears it off, the tail uncrushed`, () => {
      const open = parkedStyle(id);
      fireRam(open, "lidTear", { kph: 3, kg: 100 });
      const h = open.lidHinge();
      const hard = parkedStyle(id);
      const torn = fireRam(hard, "lidTear", { kph: 12, kg: 100 });
      expect(!h.latched && h.theta === h.spec.stop && !open.lidOff(), `${id} 35 J: latched ${h.latched} at ${h.theta} rad, off ${open.lidOff()}`).toBeTruthy();
      expect(torn.detached.includes("trunk") && hard.hasLoosePart(), `${id} 555 J lid stayed on: [${torn.detached}]`).toBeTruthy();
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
    expect(!h.latched && h.theta === h.spec.stop && !open.lidOff(), `lid 1: latched ${h.latched} at ${h.theta} rad`).toBeTruthy();
    const torn = parkedStyle("sedan");
    rig.lid = 2;
    rig.attach(torn);
    expect(torn.lidOff(), "lid 2 left the lid on").toBeTruthy();
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
    expect(Math.acos(0.5), "acos(0.5) is past the stop: the clear branch is not the one under test").toBeLessThan(MIRROR_FOLD_MAX);
    const fold = strikeMirror(makeCar(), 0.5);
    expect(Math.abs(fold - Math.acos(0.5)), `fold ${fold} rad, acos(0.5) ${Math.acos(0.5)} rad`).toBeLessThan(1e-9);
    expect(_lane.u).toBe(5);
  });

  it("when the mirror is already folded onto its stop, then the strike leaves it there", () => {
    const car = makeCar();
    car.setMirrorFold(1, -MIRROR_FOLD_MAX);
    expect(strikeMirror(car, 0.5)).toBe(MIRROR_FOLD_MAX);
  });
});

/** A hard shot on each lane (km/h, kg): one that takes off what the lane is for wherever its head meets it. */
const HARD_SHOTS = [
  { scenario: "mirror", kph: 60, kg: 3000 },
  { scenario: "overOpen", kph: 30, kg: 1500 },
  { scenario: "shut", kph: 40, kg: 300 },
  { scenario: "panelPush", kph: 30, kg: 1500 },
  { scenario: "panelPull", kph: 30, kg: 1500 },
  { scenario: "lidPop", ...LATCH_HARD },
  { scenario: "lidTear", kph: 12, kg: 100 },
] as const satisfies readonly { scenario: DoorScenario; kph: number; kg: number }[];

/** The lighter shots every lane is also fired at, to see what comes off at each. */
const SOFT_SHOTS = [
  { kph: 6, kg: 30 },
  { kph: 12, kg: 300 },
] as const;

/** How far (m) a head's lane must overlap a part's drawn box, across the car's width and in height, to be said to meet it. */
const MEETS_M = 0.01;

type DrawnShot = { shot: RamShot; lidLatched: boolean; overlap: (name: string) => number };
const drawnShots = new Map<string, DrawnShot>();

/** One shot at the right side of a parked, class-dressed `id`, with how far its head's lane overlaps each part's drawn box as the shot began. */
function shootDrawn(id: CarStyleId, scenario: DoorScenario, kph: number, kg: number): DrawnShot {
  const key = `${id}/${scenario}/${kph}/${kg}`;
  const cached = drawnShots.get(key);
  if (cached) return cached;
  const car = parkedStyle(id);
  const overlaps = new Map<string, number>();
  const shot = fireRam(car, scenario, {
    kph,
    kg,
    side: 1,
    onFired: (rig) => {
      const lane = laneBox(rig.lane, 1, new THREE.Box3());
      for (const part of car["parts"]) overlaps.set(part.name, overlapMetres(lane, drawnBox(car, part.name, new THREE.Box3())));
    },
  });
  const drawn = { shot, lidLatched: car.lidHinge().latched, overlap: (name: string) => overlaps.get(name) ?? -Infinity };
  drawnShots.set(key, drawn);
  return drawn;
}

const styleLanes = CAR_STYLE_IDS.flatMap((id) => HARD_SHOTS.map((hard) => ({ ...hard, id, part: LANE_PART[hard.scenario] })));

describe("given each lane's ram fired at the right side of a parked car of every style (docs/DOOR_RIG.md, Rig)", () => {
  for (const c of styleLanes) {
    it(`when ${c.scenario} is fired at the ${c.id}, then its head's lane meets the drawn ${c.part} by ${MEETS_M * 1000} mm or more`, () => {
      const metres = shootDrawn(c.id, c.scenario, c.kph, c.kg).overlap(partName(c.part, 1));
      expect(metres, `${c.id} ${c.scenario}: the head overlaps the drawn ${c.part} by ${metres} m`).toBeGreaterThanOrEqual(MEETS_M);
    });

    it(`when ${c.scenario} is fired at the ${c.id} at ${c.kph} km/h and ${c.kg} kg, then the ${c.part} ${c.scenario === "lidPop" ? "is sprung past its latch" : "comes off"}`, () => {
      const { shot, lidLatched } = shootDrawn(c.id, c.scenario, c.kph, c.kg);
      if (c.scenario === "lidPop") expect(!lidLatched && !shot.detached.includes("trunk"), `${c.id} F: lid latched ${lidLatched}, off [${shot.detached}]`).toBeTruthy();
      else expect(shot.detached.includes(partName(c.part, 1)), `${c.id} ${c.scenario}: off [${shot.detached}]`).toBeTruthy();
    });

    it(`when ${c.scenario} is fired at the ${c.id} at 6 km/h, 12 km/h and ${c.kph} km/h, then every part that comes off was met by the head`, () => {
      const unseen: string[] = [];
      for (const strength of [...SOFT_SHOTS, c]) {
        const drawn = shootDrawn(c.id, c.scenario, strength.kph, strength.kg);
        for (const name of drawn.shot.detached) {
          const door = `door${name.slice("mirror".length)}`;
          const carrier = name.startsWith("mirror") && drawn.shot.detached.includes(door) ? door : name;
          if (drawn.overlap(carrier) < MEETS_M) unseen.push(`${name} at ${strength.kph} km/h`);
        }
      }
      expect(unseen.join(", "), `${c.id} ${c.scenario}: parts off that the head never met`).toBe("");
    });
  }
});

describe("given a monster whose drawn body rides 0.87 m over its stock heights, its right door open 55°", () => {
  it("when B's head runs under the door's drawn height and then at it, then the first leaves the door alone and the second tears it off", () => {
    const under = fireRam(parkedStyle("monster"), "overOpen", { kph: 30, kg: 1500, shape: { bottom: 0.3, top: 0.75 } });
    const level = fireRam(parkedStyle("monster"), "overOpen", { kph: 30, kg: 1500, shape: { bottom: 1.3, top: 1.6 } });
    expect(under.detached.join(), "a head under the lifted door took something off").toBe("");
    expect(Math.abs(under.doorDeg - 55), `the door under the head moved to ${under.doorDeg}°`).toBeLessThan(0.5);
    expect(level.detached.includes("doorR"), `a head at the door's drawn height left [${level.detached}]`).toBeTruthy();
  });
});
