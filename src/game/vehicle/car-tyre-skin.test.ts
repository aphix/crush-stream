import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import type { PlanGrid } from "../deform/tyre-sag-kernel.ts";
import { type CrashWorld, FREEWHEEL, launch, makeWorld, runWall, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { DeformableCar } from "./car.ts";
import type { DriveInput } from "./car-drive.ts";
import { LID } from "./constants.ts";
import { buildCar } from "./drawn-body.test-util.ts";
import { PART_KIND, type PartSeat } from "./part-geometry.ts";
import { TyreSkin } from "./car-tyre-skin.ts";
import { skinKernel } from "../deform/skin-kernel.ts";
import { TyreSagArena } from "../deform/tyre-sag-kernel.ts";
import { assertSameNumbers } from "./test-support.ts";
import { tyreClearance } from "./tyre-clearance.test-util.ts";
import { CLASSES, carClass } from "./vehicle-classes.ts";
import { must } from "../kernel/must.test-util.ts";
import { worstHoldOverRest } from "./skin-stretch.test-util.ts";

/**
 * A crushed skin's triangles stretched across a front tyre: one corner held over the tyre, every other point of the skin far away and low. The held corner stands on the tyre at
 * its own place, so the plane of each triangle it belongs to dips under the arc between it and the low points: before the hold read triangles, a pickup's tyre stood 42 mm
 * through its drawn skin (the owner's fleet crash, once the cage refit at other steps).
 */
const FRONT_RIGHT_WHEEL = 1;
const CLEARANCE_M = 0.005;
/** The wheel is read at this many turns round the axle: the drawn tyre's points sit at fixed angles, and each takes the tyre's top in turn. */
const SPIN_STEPS = 64;
/** The point held over the tyre, crushed down beside the tyre's front (m, in the car's frame, before the hold), and where the rest of the skin stands (the middle of the car's nose). */
const HELD_POINT = [0.633, 0.4, 1.497] as const;
const FAR_POINT = [0.1, 0.37, 0.9] as const;
/** The far points stand apart (m) in turn: along z so that their fan of triangles from the held point covers the tyre's top, and along x so that none is degenerate. */
const FAR_SPREAD_Z = 0.1;
const FAR_SPREAD_X = 0.013;
const FAR_SPREAD_COUNT = 7;

describe("given a pickup's skin of which one point rests over its front tyre and the rest is far and low", () => {
  it("when the skin is held off the tyres, then every drawn triangle over the tyre keeps 5 mm over its top", () => {
    const car = buildCar("pickup", "truck");
    const mesh = car["body"] as THREE.Mesh;
    const skin = new TyreSkin(car.frame, mesh, car.deform.restSkin, true);
    const lift = CLASSES[carClass(car)].lift;
    car.group.updateMatrixWorld(true);
    skin.hold(car.group, car.wheels, 0, lift, true);
    const over = skin["over"][FRONT_RIGHT_WHEEL]!;
    const held = Array.from(over).findIndex((rest) => !Number.isNaN(rest));
    expect(held, "fixture: a skin point resting over the tyre").toBeGreaterThanOrEqual(0);
    const toMesh = new THREE.Matrix4().multiplyMatrices(car.group.matrixWorld.clone().invert(), mesh.matrixWorld).invert();
    const positions = mesh.geometry.getAttribute("position");
    const place = new THREE.Vector3();
    for (let vertex = 0; vertex < positions.count; vertex++) {
      place.fromArray(vertex === held ? HELD_POINT : FAR_POINT);
      if (vertex !== held) place.set(place.x + FAR_SPREAD_X * (vertex % 5), place.y, place.z + FAR_SPREAD_Z * (vertex % FAR_SPREAD_COUNT));
      place.applyMatrix4(toMesh);
      positions.setXYZ(vertex, place.x, place.y, place.z);
    }
    skin.hold(car.group, car.wheels, 0, lift, true);
    const toCar = new THREE.Matrix4().multiplyMatrices(car.group.matrixWorld.clone().invert(), mesh.matrixWorld);
    const triangles: number[] = [];
    const index = mesh.geometry.index!;
    for (let corner = 0; corner < index.count; corner++) {
      place.fromBufferAttribute(positions, index.getX(corner)).applyMatrix4(toCar);
      triangles.push(place.x, place.y, place.z);
    }
    let clearance = Infinity;
    for (let step = 0; step < SPIN_STEPS; step++) {
      car.wheels[FRONT_RIGHT_WHEEL]!.rotation.x = (step * 2 * Math.PI) / SPIN_STEPS;
      clearance = Math.min(clearance, tyreClearance(car, FRONT_RIGHT_WHEEL, Float32Array.from(triangles)));
    }
    expect(clearance, `${(clearance * 1000).toFixed(1)} mm`).toBeGreaterThanOrEqual(CLEARANCE_M);
  });
});

/** Owner: interior and engine shapes showed through a crushed hatch's bonnet. A corner hit folds the bonnet down onto the dash and the bay (drawn once the bonnet springs open). */
const HOOD_COVER_KPH = [55, 65, 70] as const;
/** The share of the car's width on the wall, from its left: the struck corner folds the bonnet down. */
const HOOD_COVER_OVERLAP = 0.4;
/** A body skin triangle that rests at least this high (m) is the roof over the cabin; under it are the floor and the sills a gone pane shows. */
const ROOF_REST_Y = 1.15;

/** The triangles (car frame, nine numbers each) of `mesh`, those whose rest corners (`rest`, null: all) all stand at least `minY`. */
function carTriangles(car: DeformableCar, mesh: THREE.Mesh, rest: Float32Array | null, minY: number): Float64Array {
  const toCar = new THREE.Matrix4().multiplyMatrices(car.group.matrixWorld.clone().invert(), mesh.matrixWorld);
  const positions = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.index!;
  const out: number[] = [];
  const place = new THREE.Vector3();
  for (let t = 0; t < index.count; t += 3) {
    const corners = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    if (rest && corners.some((v) => rest[v * 3 + 1]! < minY)) continue;
    for (const v of corners) {
      place.fromBufferAttribute(positions, v).applyMatrix4(toCar);
      out.push(place.x, place.y, place.z);
    }
  }
  return Float64Array.from(out);
}

/** The highest of `triangles` over plan point (x, z) among those facing up (the paint draws its front faces only), -Infinity where none is over it. */
function skinTopAt(triangles: Float64Array, x: number, z: number): number {
  let top = -Infinity;
  for (let i = 0; i < triangles.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = triangles.subarray(i, i + 9) as unknown as number[];
    if ((bz! - az!) * (cx! - ax!) - (bx! - ax!) * (cz! - az!) <= 0) continue;
    const den = (bz! - cz!) * (ax! - cx!) + (cx! - bx!) * (az! - cz!);
    const l1 = ((bz! - cz!) * (x - cx!) + (cx! - bx!) * (z - cz!)) / den;
    const l2 = ((cz! - az!) * (x - cx!) + (ax! - cx!) * (z - cz!)) / den;
    if (l1 < 0 || l2 < 0 || l1 + l2 > 1) continue;
    top = Math.max(top, l1 * ay! + l2 * by! + (1 - l1 - l2) * cy!);
  }
  return top;
}

describe(`given a hatchback driven into a wall with ${HOOD_COVER_OVERLAP * 100} % of its nose on it, at ${HOOD_COVER_KPH.join(", ")} km/h`, () => {
  for (const kph of HOOD_COVER_KPH) {
    it(`when it has come to rest after the ${kph} km/h hit, then no drawn vertex of its cabin shell or engine bay stands over the drawn bonnet or roof over it`, () => {
      const car = buildCar("hatchback", "hatch");
      runWall(kph, HOOD_COVER_OVERLAP, "front", { car });
      car.updateSkin();
      car.group.updateMatrixWorld(true);
      const hood = car["hood"] as THREE.Mesh;
      const covers = [carTriangles(car, car.body, car.deform.restSkin, ROOF_REST_Y)];
      if (!car["parts"].some((p) => p.detached && p.name === LID.hood)) covers.push(carTriangles(car, hood, null, -Infinity));
      const toCar = new THREE.Matrix4();
      const place = new THREE.Vector3();
      let worst = 0;
      let where = "";
      for (const seat of car.partSeats) {
        if (seat.kind !== PART_KIND.interior && seat.kind !== PART_KIND.engineBay) continue;
        if (seat.showIf && !seat.showIf()) continue;
        toCar.multiplyMatrices(car.group.matrixWorld.clone().invert(), seat.matrixWorld);
        const positions = seat.drawn.getAttribute("position");
        for (let v = 0; v < positions.count; v++) {
          place.fromBufferAttribute(positions, v).applyMatrix4(toCar);
          const top = Math.max(...covers.map((t) => skinTopAt(t, place.x, place.z)));
          if (top === -Infinity) continue;
          const over = place.y - top;
          if (over > worst) [worst, where] = [over, `${seat.kind === PART_KIND.interior ? "cabin shell" : "engine bay"} at (${place.x.toFixed(2)}, ${place.y.toFixed(2)}, ${place.z.toFixed(2)})`];
        }
      }
      expect(worst, `${kph} km/h: the ${where} stands ${(worst * 1000).toFixed(1)} mm over the drawn skin over it`).toBe(0);
    });
  }
});

/** The hold finds its lift again only when the skin is written, a part under it moves or a wheel moves past its slack; between, the drawn skin stands as the full hold drew it to within this (m). */
const DRAWN_SLACK_M = 0.002;
const FRAME = 1 / FRAME_HZ;
const FRAMES = 150;
/** A slalom: the steer swept through a full lock each second, so the front wheels turn under the skin every frame. */
const SLALOM_HZ = 1;
const MESHES = ["body", "hood"] as const;

type Pair = { fast: CrashWorld; full: CrashWorld; fastCar: DeformableCar; fullCar: DeformableCar };

/** Every tyre hold `car` has made from now on finds its lift and redraws whole, every frame, as before the hold kept its lift. */
function forceFullHold(car: DeformableCar): void {
  for (const skin of [car["bodyTyres"], car["hoodTyres"]]) {
    if (!skin || Object.getOwnPropertyDescriptor(skin, "held")?.get) continue;
    const noteWheel = skin["noteWheel"].bind(skin);
    const notePartPoses = skin["notePartPoses"].bind(skin);
    Object.assign(skin, { noteWheel: (w: number, e: ArrayLike<number> | null) => noteWheel(w, e) || true, notePartPoses: (group: THREE.Object3D, under: readonly PartSeat[]) => notePartPoses(group, under) || true });
    for (const flag of ["held", "crushed"]) Object.defineProperty(skin, flag, { get: () => true, set: () => undefined });
  }
}

/** Per mesh, the frames the fast hold left the skin alone where the full one redrew it, and the furthest (m) a drawn point of the two stood apart; `drives` slalom once the car is crashed. */
function compare(p: Pair, drives: readonly DriveInput[] = []): { skipped: Record<(typeof MESHES)[number], number>; apart: number } {
  const skipped = { body: 0, hood: 0 };
  let apart = 0;
  const version = (car: DeformableCar, mesh: (typeof MESHES)[number]): number => {
    const attr = car[mesh].geometry.getAttribute("position");
    must(attr instanceof THREE.BufferAttribute, "the position attribute is not a BufferAttribute");
    return attr.version;
  };
  for (let f = 0; f < FRAMES; f++) {
    for (const d of drives) {
      d.throttle = p.fastCar.crashed ? 0.5 : 0;
      d.steer = p.fastCar.crashed ? Math.sin((2 * Math.PI * SLALOM_HZ * f) / FRAME_HZ) : 0;
    }
    const before = MESHES.map((m) => [version(p.fastCar, m), version(p.fullCar, m)]);
    tickWorld(p.fast, FRAME);
    tickWorld(p.full, FRAME);
    forceFullHold(p.fullCar);
    for (const [k, mesh] of MESHES.entries()) {
      if (version(p.fastCar, mesh) === before[k]![0] && version(p.fullCar, mesh) !== before[k]![1]) skipped[mesh]++;
      const a = p.fastCar[mesh].geometry.getAttribute("position").array;
      const b = p.fullCar[mesh].geometry.getAttribute("position").array;
      for (let i = 0; i < a.length; i++) apart = Math.max(apart, Math.abs(a[i]! - b[i]!));
    }
  }
  expect(p.fastCar["bodyTyres"] && p.fastCar["hoodTyres"], "the car held its skin over its tyres").toBeTruthy();
  return { skipped, apart };
}

describe("given a wreck whose skin is held over its tyres and the parts under its bonnet", () => {
  it(`when a sedan is hit in its flank at 25 km/h and drives on in a slalom, then its drawn body and bonnet stand within ${DRAWN_SLACK_M * 1000} mm of the full hold's every frame, and the hold leaves its clear bonnet alone`, () => {
    const drives: DriveInput[] = [];
    const pair = (): { w: CrashWorld; car: DeformableCar } => {
      const car = buildCar("sedan", "sedan");
      const hitter = buildCar("sedan", "sedan");
      const w = makeWorld([car, hitter], false, false);
      const drive: DriveInput = { throttle: 0.5, steer: 0, brake: 0, ebrake: false, boost: false };
      drives.push(drive);
      w.pedals.set(car, drive);
      w.pedals.set(hitter, FREEWHEEL);
      launch(car, 0, 0, 0, 0, 0);
      launch(hitter, -5, 0, Math.PI / 2, 25 / 3.6, 0);
      return { w, car };
    };
    const [fast, full] = [pair(), pair()];
    const seen = compare({ fast: fast.w, full: full.w, fastCar: fast.car, fullCar: full.car }, drives);
    expect(fast.car.crashed, "the sedan was crashed").toBeTruthy();
    expect(seen.apart, `drawn ${(seen.apart * 1000).toFixed(2)} mm off the full hold`).toBeLessThanOrEqual(DRAWN_SLACK_M);
    expect(seen.skipped.hood, `the bonnet's hold skipped ${seen.skipped.hood} of ${FRAMES} frames`).toBeGreaterThan(FRAMES / 2);
  });

  it(`when a pickup meets another head-on at 50 km/h, then its drawn body and bonnet stand within ${DRAWN_SLACK_M * 1000} mm of the full hold's every frame through the crush and after`, () => {
    const crushable = (): DeformableCar => {
      const car = buildCar("pickup", "truck");
      car.deform.squash = 0.32;
      car.deform.buckle = 0.45;
      return car;
    };
    const [fastCar, fastOther, fullCar, fullOther] = [crushable(), crushable(), crushable(), crushable()];
    const fast = makeWorld([fastCar, fastOther], false, false);
    const full = makeWorld([fullCar, fullOther], false, false);
    for (const w of [fast, full]) for (const car of w.cars) w.pedals.set(car, FREEWHEEL);
    launch(fastCar, -5, 0, Math.PI / 2, 50 / 3.6, 0);
    launch(fastOther, 5, 0, -Math.PI / 2, -50 / 3.6, 0);
    launch(fullCar, -5, 0, Math.PI / 2, 50 / 3.6, 0);
    launch(fullOther, 5, 0, -Math.PI / 2, -50 / 3.6, 0);
    const seen = compare({ fast, full, fastCar, fullCar });
    expect(seen.apart, `drawn ${(seen.apart * 1000).toFixed(2)} mm off the full hold`).toBeLessThanOrEqual(DRAWN_SLACK_M);
  });
});

/** The wall hit the kernel row crushes a hatchback with: hard enough to fold the bonnet, on the nose's corner so a front tyre sits under the crush. */
const KERNEL_ROW_KPH = 65;

type HoldOutcome = { lift: Float32Array; positions: Float32Array; normals: Float32Array; plans: PlanGrid[]; held: boolean };
type KernelCalls = { sagPasses: number; raised: number; planGrids: number };
type CrushedMesh = { mesh: THREE.Mesh; rest: Float32Array; pushSide: boolean; written: Float32Array; under: readonly PartSeat[] };
type CrushedHatchback = { car: DeformableCar; meshes: CrushedMesh[] };

/** `run` with the kernel's tyre calls counted, and every sag pass read over tyres `tyreScale` times the car's (1: as they are). */
function countKernelCalls<T>(tyreScale: number, run: () => T): { calls: KernelCalls; result: T } {
  const calls: KernelCalls = { sagPasses: 0, raised: 0, planGrids: 0 };
  const realSag = TyreSagArena.prototype.sagPass;
  const realPlan = TyreSagArena.prototype.planGrid;
  TyreSagArena.prototype.sagPass = function (this: TyreSagArena, skin, pos, wheel, tyre) {
    const raised = realSag.call(this, skin, pos, wheel, { r: tyre.r * tyreScale, halfW: tyre.halfW });
    calls.sagPasses++;
    if (raised) calls.raised++;
    return raised;
  };
  TyreSagArena.prototype.planGrid = function (this: TyreSagArena, ...args: Parameters<TyreSagArena["planGrid"]>) {
    const grid = realPlan.apply(this, args);
    if (grid) calls.planGrids++;
    return grid;
  };
  try {
    return { calls, result: run() };
  } finally {
    TyreSagArena.prototype.sagPass = realSag;
    TyreSagArena.prototype.planGrid = realPlan;
  }
}

/** A fresh `TyreSkin` over `crushed` holds its written skin over `car`'s tyres, the plan grid and sag pass in the kernel or, with `inKernel` false, in JS. */
function holdWritten(car: DeformableCar, crushed: CrushedMesh, inKernel: boolean): HoldOutcome {
  const skin = new TyreSkin(car.frame, crushed.mesh, crushed.rest, crushed.pushSide);
  if (!inKernel) Object.defineProperty(skin, "kernel", { get: () => null });
  const positions = crushed.mesh.geometry.getAttribute("position");
  positions.array.set(crushed.written);
  skin.hold(car.group, car.wheels, 0, CLASSES[carClass(car)].lift, true, crushed.under);
  return { lift: skin["lift"].slice(), positions: Float32Array.from(positions.array), normals: Float32Array.from(crushed.mesh.geometry.getAttribute("normal").array), plans: [...skin["plans"]], held: skin["held"] };
}

/** Every wheel's plan grid in `plans` is `expected`'s, array for array. */
function assertSamePlans(plans: readonly PlanGrid[], expected: readonly PlanGrid[], label: string): void {
  expect(plans.length, `${label} plan grids`).toBe(expected.length);
  for (const [wheel, plan] of plans.entries()) {
    const want = expected[wheel]!;
    const at = `${label} wheel ${wheel} plan`;
    assertSameNumbers(plan.box, want.box, `${at} boxes`);
    assertSameNumbers(plan.den, want.den, `${at} determinants`);
    assertSameNumbers(plan.start, want.start, `${at} cell starts`);
    assertSameNumbers(plan.tris, want.tris, `${at} filed triangles`);
    assertSameNumbers([plan.x0, plan.z0, plan.nx, plan.nz], [want.x0, want.z0, want.nx, want.nz], `${at} extent`);
  }
}

/** A hatchback crushed by the wall hit and settled, with its body's and bonnet's skins as the writer left them. */
function crushedHatchback(): CrushedHatchback {
  const car = buildCar("hatchback", "hatch");
  runWall(KERNEL_ROW_KPH, HOOD_COVER_OVERLAP, "front", { car });
  // The wall springs the hood and its struts lift it off the tyres: shut back onto its crash pose, it is the crushed bonnet the hold works on.
  car["setSwingOpen"](car["hoodPart"], 0);
  car.updateSkin();
  car.group.updateMatrixWorld(true);
  const underHood = car.partSeats.filter((seat) => seat.kind === PART_KIND.interior || seat.kind === PART_KIND.engineBay);
  return {
    car,
    meshes: [
      { mesh: car.body, rest: car.deform.restSkin, pushSide: true, written: car["bodyTyres"]!["written"].slice(), under: [] },
      { mesh: car["hood"], rest: car["hoodRest"], pushSide: false, written: car["hoodTyres"]!["written"].slice(), under: underHood },
    ],
  };
}

describe(`given a hatchback crushed against a wall at ${KERNEL_ROW_KPH} km/h, its body and bonnet skins as the writer left them`, () => {
  let fixture: CrushedHatchback;
  beforeAll(() => {
    fixture = crushedHatchback();
  });

  const skinCases = [
    { which: 0, label: "body", sagLifts: true },
    { which: 1, label: "bonnet", sagLifts: false },
  ] as const;
  for (const { which, label, sagLifts } of skinCases) {
    it(`when its ${label} is held in JS and in the kernel, then every lift, drawn position and normal is the same bit for bit`, () => {
      expect(skinKernel(), "the test preload loaded the kernel").toBeTruthy();
      const crushed = fixture.meshes[which]!;
      const reference = holdWritten(fixture.car, crushed, false);
      const { calls, result: outcome } = countKernelCalls(1, () => holdWritten(fixture.car, crushed, true));
      expect(calls.sagPasses > 0 && calls.planGrids > 0, `${calls.sagPasses} sag passes and ${calls.planGrids} plan grids ran in the kernel`).toBeTruthy();
      expect(calls.raised > 0, `${calls.raised} of ${calls.sagPasses} sag passes lifted a corner`).toBe(sagLifts);
      expect(reference.held && reference.lift.some((lift) => lift > 0), "the hold lifted the crushed skin: the row compares a hold that moved something").toBeTruthy();
      assertSameNumbers(outcome.lift, reference.lift, `${label} lift`);
      assertSameNumbers(outcome.positions, reference.positions, `${label} positions`);
      assertSameNumbers(outcome.normals, reference.normals, `${label} normals`);
      assertSamePlans(outcome.plans, reference.plans, label);
      expect(outcome.held).toBe(reference.held);
    });
  }

  it("when the kernel reads the body over tyres a fifth larger than the car's, then its lift is not the JS hold's, so the row can fail", () => {
    const crushed = fixture.meshes[0]!;
    const reference = holdWritten(fixture.car, crushed, false);
    const { result: outcome } = countKernelCalls(1.2, () => holdWritten(fixture.car, crushed, true));
    expect(outcome.lift.some((lift, point) => lift !== reference.lift[point]), "a sag pass over larger tyres must not match").toBeTruthy();
  });
});

/** Owner: the wall over a muscle's front right wheel grew and a cone of bare bay wall stood up through the fender, in a Fleet corner hit. This strike crushes that corner's arch and bay. */
const CORNER_HIT_KPH = 40;
/** The striker's heading off the muscle's nose (rad): from ahead and to its right. */
const CORNER_HIT_ANGLE = Math.PI / 4;
/** The point it drives at (m, the muscle's frame: its right front corner, -x, the rig's `hubFL` side) and how far out it starts. */
const CORNER = [-0.7, 2] as const;
const CORNER_RUN_IN_M = 4.5;
/** How far (m) past the envelope a drawn point may stand: the envelope reads the drawn tyre, the hold its own copy of it. */
const OVER_ENVELOPE_SLACK_M = 0.005;

describe(`given a hatchback driven at ${CORNER_HIT_KPH} km/h into a standing muscle car's right front corner, from 45 degrees off its nose`, () => {
  it("when the muscle's skin is held off its tyres through the hit, then no body point stands higher than its rest, the tyres' top or its neighbours ask", () => {
    const car = buildCar("coupe", "muscle");
    const striker = buildCar("hatchback", "hatch");
    launch(car, 0, 0, 0, 0, 0);
    const [vx, vz] = [Math.sin(CORNER_HIT_ANGLE) * (CORNER_HIT_KPH / 3.6), -Math.cos(CORNER_HIT_ANGLE) * (CORNER_HIT_KPH / 3.6)];
    launch(striker, CORNER[0] - Math.sin(CORNER_HIT_ANGLE) * CORNER_RUN_IN_M, CORNER[1] + Math.cos(CORNER_HIT_ANGLE) * CORNER_RUN_IN_M, Math.atan2(vx, vz), vx, vz);
    const world = makeWorld([car, striker], false, false, FREEWHEEL);
    let worst = { over: 0, at: "" };
    for (let f = 0; f < FRAMES; f++) {
      tickWorld(world, FRAME);
      const held = car["bodyTyres"] ? worstHoldOverRest(car) : worst;
      if (held.over > worst.over) worst = held;
    }
    expect(car.crashed, "the muscle's corner crushed").toBe(true);
    expect(worst.over, `${(worst.over * 1000).toFixed(0)} mm over: ${worst.at}`).toBeLessThanOrEqual(OVER_ENVELOPE_SLACK_M);
  });
});
