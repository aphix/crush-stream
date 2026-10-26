import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { launch, makeCar, relaunchDamaged } from "../contact/crash-scenarios.test-util.ts";
import { satCars } from "../contact/sat.ts";
import { ACCEL_BOUND, H_CX, H_CZ, H_HX, H_HZ, HULL_STRIDE, LEVEL, readHull } from "../contact/hull-gap.ts";
import { applyDrive, type DriveInput } from "../vehicle/car-drive.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { QUIET_HZ, SLICES_PER_STEP } from "../kernel/constants.ts";
import { assignClass, CLASSES, carClass, VEHICLE_CLASS_IDS } from "../vehicle/vehicle-classes.ts";
import { newWorld, stepWorld, type World } from "./world-step.ts";
import { COARSE, dispose, FINE, missedByLone, parkedPair, run, type Row } from "./world-step-lone.test-util.ts";
import { WORK } from "./sim-phases.ts";

/**
 * The lone-car test on hulls (`contact/hull-gap.ts`): two intact cars that cannot meet over the step stay lone however near their centres are, and a pair that can
 * meet never does. Every row runs the same field twice, lone cars on and off (all-sliced), and reads what differs, at the phone's coarse 1/80 s step.
 */
const SPEED = 15;
const GAS: DriveInput = { throttle: 1, steer: 0, brake: 0, ebrake: false, boost: false };
const HEAD_Z = 0;
const HEAD_X = Math.PI / 2;
/** A pose that agrees with the all-sliced run's to this (m): the bar the wall rows of `world-step-lone.test.ts` hold. */
const SAME_M = 0.05;

interface Field {
  cars: DeformableCar[];
  w: World;
}

const dist = (a: DeformableCar, b: DeformableCar): number => Math.hypot(a.group.position.x - b.group.position.x, a.group.position.z - b.group.position.z);

function fieldOf(cars: DeformableCar[], lone: boolean): Field {
  const w = newWorld(cars);
  w.fine = FINE;
  w.lone = lone;
  return { cars, w };
}

/** Two sedans placed by `place`, with a pair parked far off to hold the step cut (`far`). */
function pairField(place: (a: DeformableCar, b: DeformableCar) => void, lone: boolean, far = true): Field {
  const a = makeCar("shape");
  const b = makeCar("shape");
  place(a, b);
  return fieldOf([a, b, ...(far ? parkedPair() : [])], lone);
}

/** Two sedans at `speed`, the second `apart` m to the right of the first and sliding toward it at `closing` m/s. */
const abeam =
  (apart: number, closing: number, speed = SPEED) =>
  (a: DeformableCar, b: DeformableCar): void => {
    launch(a, 0, 0, HEAD_Z, 0, speed);
    launch(b, apart, 0, HEAD_Z, -closing, speed);
  };

/** `n` sedans in `cols` columns, `along` m nose to tail and `across` m abeam, all at `speed`. */
function convoy(n: number, cols: number, along: number, across: number, speed: number, lone: boolean): Field {
  const cars = Array.from({ length: n }, () => makeCar("shape"));
  for (const [i, car] of cars.entries()) launch(car, (i % cols - (cols - 1) / 2) * across, -Math.floor(i / cols) * along, HEAD_Z, 0, speed);
  return fieldOf(cars, lone);
}

/** `steps` coarse steps of `w` with the throttle held on every car. */
function drive(w: World, steps: number): Row[] {
  return run(w, steps, COARSE, () => {
    for (const car of w.cars) applyDrive(car, GAS, COARSE);
  });
}

describe("given 16 sedans in two columns, 5 m nose to tail and 3.5 m abeam, at 15 m/s with the throttle held (the old reach's 6.3 m holds every one of them)", () => {
  /** The convoy run 3 s (240 coarse steps) lone and sliced once for the file: the first row reads its first second, the second its end. */
  let runs: { on: Field; off: Field; rows: Row[]; cut: Row[] } | undefined;
  const convoyRuns = (): NonNullable<typeof runs> => {
    if (runs) return runs;
    const on = convoy(16, 2, 5, 3.5, SPEED, true);
    const off = convoy(16, 2, 5, 3.5, SPEED, false);
    runs = { on, off, rows: drive(on.w, 240), cut: drive(off.w, 240) };
    return runs;
  };
  after(() => {
    if (runs) dispose([...runs.on.cars, ...runs.off.cars]);
  });

  it("when lone cars run, then every step is one slice of every car (16 car-slices) and no step is cut; with them off the same field cuts every step to 3 slices (48)", () => {
    const rows = convoyRuns().rows.slice(0, 80);
    assert.ok(rows.every((r) => r.slices === 1 && r.loners === 0 && r.carSlices === 16 && r.missed === 0), `slices per step ${[...new Set(rows.map((r) => r.slices))]}, car-slices ${[...new Set(rows.map((r) => r.carSlices))]}`);
    const cut = convoyRuns().cut.slice(0, 80);
    assert.ok(cut.every((r) => r.slices === SLICES_PER_STEP && r.carSlices === 16 * SLICES_PER_STEP), "the old test cut every step of the convoy");
  });

  it("when it runs for 3 s lone and sliced, then every car ends within 0.15 m and 0.1 m/s of where the sliced car does", () => {
    const { on, off } = convoyRuns();
    for (const [i, car] of on.cars.entries()) {
      const ref = off.cars[i]!;
      const gap = dist(car, ref);
      assert.ok(gap < 0.15 && Math.abs(car.velocity.length() - ref.velocity.length()) < 0.1, `car ${i}: ${gap.toFixed(3)} m apart`);
    }
  });

  it("when it drives at 40 m/s with 0.56 m between bumpers (a step of 0.5 m, as much as the gap), then it is one slice a step and ends within 0.15 m of the sliced field with no car crashed", () => {
    const on = convoy(8, 2, 5, 3.5, 40, true);
    const off = convoy(8, 2, 5, 3.5, 40, false);
    const rows = drive(on.w, 240);
    drive(off.w, 240);
    assert.ok(rows.every((r) => r.slices === 1 && r.missed === 0), "every step was one slice");
    for (const [i, car] of on.cars.entries()) {
      const ref = off.cars[i]!;
      assert.ok(!car.crashed && !ref.crashed, `car ${i} crashed`);
      assert.ok(dist(car, ref) < 0.15, `car ${i} drifted from the sliced run`);
    }
    dispose([...on.cars, ...off.cars]);
  });
});

/** The lone mask of the two cars (bits 0 and 1) in the first step, `trim` run on them after the launch. */
function firstMask(apart: number, closing: number, trim?: (a: DeformableCar, b: DeformableCar) => void): number {
  const f = pairField((a, b) => {
    abeam(apart, closing)(a, b);
    trim?.(a, b);
  }, true);
  const rows = run(f.w, 1, COARSE);
  dispose(f.cars);
  return rows[0]!.loners & 0b11;
}

/** Whether cars abeam `apart` m, closing at `closing` m/s, are both lone. */
const lone = (apart: number, closing: number, trim?: (a: DeformableCar, b: DeformableCar) => void): boolean => firstMask(apart, closing, trim) === 0b11;

/** The smallest centre to centre distance (m, to 0.1 mm) at which still cars abeam are both lone: the clearance the test asks. Bisected once for the file. */
let clearance: number | undefined;
function stillClearance(): number {
  if (clearance !== undefined) return clearance;
  let lo = 1;
  let hi = 8;
  while (hi - lo > BISECT_M) {
    const mid = (lo + hi) / 2;
    if (lone(mid, 0)) hi = mid;
    else lo = mid;
  }
  return (clearance = hi);
}

/** The bisection's resolution (m), and how near (m) a clearance must match the hull rule's: each row reads the two distances either side of that band. */
const BISECT_M = 1e-4;
const MATCH_M = 0.002;
/** The most the clearance may ask beyond the mirrors meeting (m): the lattice's outline and the lean of two bodies (about 0.19 m) and the slack (0.03 m). */
const MOST_BEYOND = 0.25;
/** The least it asks beyond them (m): each car's outline half lattice step and level-bar lean (`OUTLINE_REACH`, `LEVEL`), less a hair. */
const LEAST_BEYOND = 0.17;
/** The least a spin of 3 rad/s grows the clearance by (m). */
const SPIN_GROWS = 0.08;

describe("given two sedans abeam at 15 m/s, the step cut by a pair parked far off", () => {
  it("when their lateral closing speed is 0, then they stay lone from the distance their mirrors meet plus 0.17 to 0.25 m, and stay in the slices below it", () => {
    const s = stillClearance();
    const sedan = makeCar("shape");
    /** The mirrors' tips of two sedans side by side meet at this centre distance (m): each car's own (`mirrorBaseX` + its door's `mirrorReach`). */
    const meet = 2 * (sedan.mirrorBaseX + sedan.style.door.mirrorReach);
    assert.ok(s >= meet + LEAST_BEYOND && s <= meet + MOST_BEYOND, `lone from ${s.toFixed(3)} m apart`);
    assert.equal(firstMask(s - 0.01, 0), 0, "10 mm inside the clearance neither is lone");
    assert.equal(firstMask(s + 0.01, 0), 0b11, "10 mm outside it both are");
  });

  for (const closing of [1, 2, 4]) {
    it(`when one closes on the other at ${closing} m/s (below a crash's 5.5 m/s), then the clearance grows by exactly the step's travel (${closing} m/s of 1/80 s)`, () => {
      const grown = stillClearance() + closing * COARSE;
      assert.ok(!lone(grown - MATCH_M, closing), `lone ${MATCH_M * 1000} mm inside the still clearance plus the step's travel (${grown.toFixed(4)} m)`);
      assert.ok(lone(grown + MATCH_M, closing), `held ${MATCH_M * 1000} mm outside the still clearance plus the step's travel (${grown.toFixed(4)} m)`);
    });
  }

  for (const closing of [6, 20]) {
    it(`when one closes on the other at ${closing} m/s (a crash's closing: the hit-ahead mark of \`nearHit\` holds the pair too), then the clearance is never less than the hull rule's: the 0-speed one and the step's travel`, () => {
      const rule = stillClearance() + closing * COARSE;
      assert.ok(!lone(rule - MATCH_M, closing), `lone ${MATCH_M * 1000} mm inside the hull rule's ${rule.toFixed(3)} m`);
    });
  }

  it("when one car is leaving the other (negative closing), then the clearance does not shrink below the 0-speed one", () => {
    const s = stillClearance();
    assert.ok(!lone(s - MATCH_M, -10), "separating speed buys clearance: lone inside the still one");
    assert.ok(lone(s + MATCH_M, -10), "separating speed costs clearance: held outside the still one");
  });

  it(`when one is spinning at 3 rad/s (its rim moves 7 m/s), then the clearance grows by what the rim travels in a step, at least ${SPIN_GROWS} m`, () => {
    const at = stillClearance() + SPIN_GROWS - BISECT_M;
    assert.ok(!lone(at, 0, (a) => a.angular.set(0, 3, 0)), `the spinning pair is lone at ${at.toFixed(4)} m`);
  });
});

describe("given two sedans abeam at a hull-clear distance the circle of the old test would hold, the step cut by a pair parked far off", () => {
  const APART = 3.2;
  it("when both are whole, then they are lone from 3.2 m apart; each of the four breaks of the hull's description holds them both in the slices", () => {
    assert.equal(firstMask(APART, 0), 0b11, "the whole pair");
    assert.equal(firstMask(APART, 0, (a) => (a["doorParts"][0]!.swing!.latched = false)), 0, "a door ajar swings out past the hull");
    assert.equal(firstMask(APART, 0, (a) => (a["parts"][0]!.detached = true)), 0, "a torn part flies on its own");
    assert.equal(firstMask(APART, 0, (a) => {
      a.group.rotation.z = 0.12;
      a.refreshBasis();
    }), 0, "a leaning body's plan reaches past the level box");
    assert.equal(firstMask(APART, 0, (a) => (a.airborne = true)), 0, "a car in the air meets what is under it");
  });

  it("when one has crashed, or stands on the other's roof, then they stay in the slices (the plan box is no description of them)", () => {
    assert.equal(firstMask(APART, 0, (a) => (a.crashed = true)), 0, "a crashed car");
    assert.equal(firstMask(APART, 0, (a, b) => (a.restsOn = b)), 0, "a car standing on another");
  });

  it("when both are wrecks (their masses move the hull) lying still, then neither is lone", () => {
    const a = makeCar("shape");
    const b = makeCar("shape");
    launch(a, -20, 0, HEAD_X, 12, 0);
    launch(b, 20, 0, -HEAD_X, -12, 0);
    const crash = newWorld([a, b]);
    crash.fine = FINE;
    run(crash, 160, COARSE);
    assert.ok(a.deform.massActive && b.deform.massActive, "the head-on made two wrecks");
    relaunchDamaged(a, 0, 0, HEAD_Z, 0, 0);
    relaunchDamaged(b, APART, 0, HEAD_Z, 0, 0);
    const far = parkedPair();
    const rows = run(fieldOf([a, b, ...far], true).w, 1, COARSE);
    assert.equal(rows[0]!.loners & 0b11, 0, "two wrecks 3.2 m abeam");
    dispose([a, b, ...far]);
  });

  it("when the pair is lone and a pair parked far off holds the cut, then the pair passes test only the parked pair (once a slice) and never the lone pair", () => {
    const f = pairField(abeam(APART, 0), true);
    const before = f.w.phases.work[WORK.pairTests]!;
    const rows = run(f.w, 10, COARSE);
    assert.ok(rows.every((r) => (r.loners & 0b11) === 0b11 && r.slices === SLICES_PER_STEP), "the pair is lone in a cut step");
    assert.equal(f.w.phases.work[WORK.pairTests]! - before, 10 * SLICES_PER_STEP, "pair tests: the parked pair in every slice, the lone pair in none");
    dispose(f.cars);
  });
});

describe("given two sedans abeam at 15 m/s a race lane's gap apart (up to 2.4 m: past their drawn mirrors' reach), the step cut by a pair parked far off", () => {
  it("when they are their mirrors' meeting plus the most the clearance asks, and then 2.4 m apart, then both step lone in every step, no overlap is missed, and they end where the sliced run puts them", () => {
    const sedan = makeCar("shape");
    const meet = 2 * (sedan.mirrorBaseX + sedan.style.door.mirrorReach);
    dispose([sedan]);
    assert.ok(meet + MOST_BEYOND < 2.4, `the clearance ends by ${(meet + MOST_BEYOND).toFixed(3)} m`);
    for (const apart of [meet + MOST_BEYOND, 2.4]) {
      const on = pairField(abeam(apart, 0), true);
      const off = pairField(abeam(apart, 0), false);
      const rows = run(on.w, 80, COARSE);
      run(off.w, 80, COARSE);
      const masks = [...new Set(rows.map((r) => r.loners & 0b11))].join();
      assert.ok(
        rows.every((r) => (r.loners & 0b11) === 0b11 && r.slices === SLICES_PER_STEP && r.missed === 0),
        `${apart} m apart: lone masks seen ${masks}, missed ${rows.reduce((n, r) => n + r.missed, 0)}`,
      );
      samePose(on, off);
      dispose([...on.cars, ...off.cars]);
    }
  });
});

describe("given a car of each class leaning as far as the level bar lets it (a roll and a pitch of 0.048)", () => {
  for (const cls of VEHICLE_CLASS_IDS) {
    it(`when it is a ${cls}, then every vertex of its cage lies inside its hull box`, () => {
      const car = makeCar("shape");
      assignClass(car, cls);
      launch(car, 0, 0, HEAD_Z, 0, 0);
      car.group.rotation.set(LEVEL - 0.002, 0, LEVEL - 0.002, "YXZ");
      car.refreshBasis();
      const hull = new Float64Array(HULL_STRIDE);
      assert.ok(readHull(car, hull, 0), "a car under the level bar is read");
      const pos = car.cage.fields.pos;
      const v = new THREE.Vector3();
      let wide = 0;
      let long = 0;
      for (let k = 0; k < car.cage.style.vertexCount; k++) {
        v.set(pos[k * 3]!, pos[k * 3 + 1]! + CLASSES[carClass(car)].lift, pos[k * 3 + 2]!).applyMatrix4(car.group.matrixWorld);
        const dx = v.x - hull[H_CX]!;
        const dz = v.z - hull[H_CZ]!;
        wide = Math.max(wide, Math.abs(dx * car.rightFlat.x + dz * car.rightFlat.z));
        long = Math.max(long, Math.abs(dx * car.fwdFlat.x + dz * car.fwdFlat.z));
      }
      assert.ok(wide <= hull[H_HX]! && long <= hull[H_HZ]!, `cage ${wide.toFixed(3)} x ${long.toFixed(3)} m inside the box ${hull[H_HX]!.toFixed(3)} x ${hull[H_HZ]!.toFixed(3)} m`);
      dispose([car]);
    });
  }
});

/** The deepest overlap (m) of any two cars at the start of any slice, the step of the first contact (a pair hit) and the pairs with a lone car overlapping unseen, over `steps` steps of `field`. */
function contactOf(field: Field, steps: number, before: (step: number) => void): { depth: number; first: number; missed: number } {
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  let depth = 0;
  let first = -1;
  let missed = 0;
  let step = 0;
  field.w.pairHit = () => {
    if (first < 0) first = step;
  };
  field.w.beforeSlice = () => {
    for (let i = 0; i < field.cars.length; i++) {
      for (let j = i + 1; j < field.cars.length; j++) depth = Math.max(depth, satCars(field.cars[i]!, field.cars[j]!, n, p, 0) ?? 0);
    }
    return false;
  };
  for (; step < steps; step++) {
    before(step);
    stepWorld(field.w, COARSE);
    missed += missedByLone(field.w);
  }
  return { depth, first, missed };
}

/** The first two cars of `on` and `off` end within `SAME_M` of each other. */
function samePose(on: Field, off: Field): void {
  for (const k of [0, 1]) {
    const d = dist(on.cars[k]!, off.cars[k]!);
    assert.ok(d < SAME_M, `car ${k} ends ${d.toFixed(3)} m from the sliced run's`);
  }
}

/** `make` run lone and sliced for `steps` steps (`before` ahead of each step of either): the first contact is in the same step, no pair with a lone car overlaps unseen, no deeper by more than 2 cm, the cars end alike. */
function matchesSliced(make: (lone: boolean) => Field, steps: number, before: (f: Field, lone: boolean) => void = () => undefined): void {
  const on = make(true);
  const off = make(false);
  const hitOn = contactOf(on, steps, () => before(on, true));
  const hitOff = contactOf(off, steps, () => before(off, false));
  assert.ok(hitOff.first > 0, "the sliced run met in the window");
  assert.equal(hitOn.first, hitOff.first, "first contact");
  assert.equal(hitOn.missed, 0, "pairs with a lone car that overlap at a step's end");
  assert.ok(hitOn.depth <= hitOff.depth + 0.02, `deepest overlap ${hitOn.depth.toFixed(3)} m against ${hitOff.depth.toFixed(3)} m`);
  samePose(on, off);
  dispose([...on.cars, ...off.cars]);
}

const SWIPES = [
  { lateral: 2, apart: 3.5 },
  { lateral: 6, apart: 3.5 },
  { lateral: 20, apart: 4.5 },
] as const;

describe("given two sedans abeam at 15 m/s with the right one sliding toward the left (a side-swipe), the step cut by a pair parked far off", () => {
  for (const { lateral, apart } of SWIPES) {
    it(`when it slides at ${lateral} m/s from ${apart} m apart, then the first contact is in the same step as the sliced run's, no deeper than it by more than 2 cm, and the cars end within 5 cm of it`, () => {
      matchesSliced((lone) => pairField(abeam(apart, lateral), lone), 160);
    });
  }
});

describe("given a sedan 5 m nose to tail behind another and 5 m/s faster, or a sedan turning into one abeam at full lock, the step cut by a pair parked far off", () => {
  for (const closing of [5, 12]) {
    it(`when the rear car is ${closing} m/s faster, then the first contact is in the same step as the sliced run's, no deeper by more than 2 cm, and the cars end within 5 cm of it`, () => {
      const rearEnd = (ahead: DeformableCar, rear: DeformableCar): void => {
        launch(ahead, 0, 5, HEAD_Z, 0, SPEED);
        launch(rear, 0, 0, HEAD_Z, 0, SPEED + closing);
      };
      matchesSliced((lone) => pairField(rearEnd, lone), 80);
    });
  }

  for (const speed of [15, 30]) {
    it(`when the right car steers across at full lock at ${speed} m/s from 3.5 m abeam, then the first contact is in the same step, no deeper by more than 2 cm, the cars end within 5 cm of the sliced run, and no car's velocity changes by more than ${ACCEL_BOUND} m/s^2 times a step before it`, () => {
      let worst = 0;
      matchesSliced(
        (lone) => pairField(abeam(3.5, 0, speed), lone),
        160,
        ({ cars: [a, b] }, lone) => {
          const v = [a!.velocity.clone(), b!.velocity.clone()];
          applyDrive(a!, GAS, COARSE);
          applyDrive(b!, { ...GAS, steer: -1 }, COARSE);
          if (lone) for (const [k, car] of [a!, b!].entries()) worst = Math.max(worst, car.velocity.distanceTo(v[k]!) / COARSE);
        },
      );
      assert.ok(worst <= ACCEL_BOUND, `the largest velocity change a step was ${worst.toFixed(1)} m/s^2`);
    });
  }
});

describe("given two sedans driving head-on at 12 m/s each from 40 m, nothing else in the world", () => {
  it("when lone cars run, then the steps before the hulls near are one slice of two lone cars collapsed to the quiet step, and the crash ends within 5 cm of the sliced one", () => {
    const headOn = (a: DeformableCar, b: DeformableCar): void => {
      launch(a, -20, 0, HEAD_X, 12, 0);
      launch(b, 20, 0, -HEAD_X, -12, 0);
    };
    const on = pairField(headOn, true, false);
    const off = pairField(headOn, false, false);
    const rows = run(on.w, 120, COARSE);
    run(off.w, 120, COARSE);
    assert.ok(rows.slice(0, 20).every((r) => r.slices === 1 && r.loners === 0), "40 m apart the world is the quiet step");
    assert.ok(rows.some((r) => r.slices === SLICES_PER_STEP), "the hit's steps are cut");
    assert.ok(on.cars.every((c) => c.crashed), "both crashed");
    samePose(on, off);
    dispose([...on.cars, ...off.cars]);
  });
});

/** What a driver can ask of a car in one step: the pedals the handling rows use (full lock either way, the handbrake in a turn, the brake, throttle and boost). */
const PEDALS: readonly DriveInput[] = [
  { ...GAS, steer: 1 },
  { ...GAS, steer: -1, ebrake: true },
  { ...GAS, throttle: 0, brake: 1 },
  { ...GAS, boost: true },
];

describe("given a car of each class on open ground at 15 and at 40 m/s, driven with every pedal the handling rows use for 2 s in coarse steps", () => {
  for (const cls of VEHICLE_CLASS_IDS) {
    it(`when it is a ${cls}, then its velocity never changes by more than ${ACCEL_BOUND} m/s^2 times a step (the bound \`hullsClear\` budgets its position error from)`, () => {
      let worst = 0;
      for (const speed of [15, 40]) {
        for (const pedal of PEDALS) {
          const car = makeCar("shape");
          assignClass(car, cls);
          launch(car, 0, 0, HEAD_Z, 0, speed);
          const { w } = fieldOf([car], true);
          for (let s = 0; s < 2 * QUIET_HZ; s++) {
            const before = car.velocity.clone();
            applyDrive(car, pedal, COARSE);
            stepWorld(w, COARSE);
            worst = Math.max(worst, car.velocity.distanceTo(before) / COARSE);
          }
          dispose([car]);
        }
      }
      assert.ok(worst <= ACCEL_BOUND, `${cls}: the largest velocity change a step was ${worst.toFixed(1)} m/s^2`);
    });
  }
});

describe("given a car driven for 5 s with a sinusoidal steer in a world cut every step by a pair parked far off, lone in every step, sliced in every step, or flipping between the two at every step", () => {
  /** The car's pose after the drive; `lone(step)` says whether the world runs lone cars in that step. */
  function driven(lone: (step: number) => boolean): { x: number; z: number; speed: number; yaw: number } {
    const car = makeCar("shape");
    launch(car, 0, 0, HEAD_Z, 0, 20);
    const far = parkedPair();
    const { w } = fieldOf([car, ...far], false);
    const input: DriveInput = { ...GAS };
    run(w, Math.round(5 * QUIET_HZ), COARSE, (s) => {
      w.lone = lone(s);
      input.steer = 0.4 * Math.sin((s * COARSE * 2 * Math.PI) / 2.5);
      applyDrive(car, input, COARSE);
    });
    const out = { x: car.group.position.x, z: car.group.position.z, speed: car.velocity.length(), yaw: car.group.rotation.y };
    dispose([car, ...far]);
    return out;
  }

  it("when the three runs end, then the flipping car is within 0.15 m, 0.1 m/s and 0.01 rad of each of the other two (a flip changes the step's dt, not the car's path)", () => {
    const always = driven(() => true);
    const never = driven(() => false);
    const flipping = driven((s) => s % 2 === 0);
    for (const other of [always, never]) {
      const gap = Math.hypot(flipping.x - other.x, flipping.z - other.z);
      assert.ok(gap < 0.15 && Math.abs(flipping.speed - other.speed) < 0.1 && Math.abs(flipping.yaw - other.yaw) < 0.01, `${gap.toFixed(3)} m, ${(flipping.speed - other.speed).toFixed(3)} m/s, ${(flipping.yaw - other.yaw).toFixed(4)} rad`);
    }
  });
});
