import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { type CrashWorld, FREEWHEEL, launch, makeWorld, runWall, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { DeformableCar } from "./car.ts";
import type { DriveInput } from "./car-drive.ts";
import { LID } from "./constants.ts";
import { buildCar } from "./drawn-body.test-util.ts";
import { PART_KIND, type PartSeat } from "./part-geometry.ts";
import { spreadSagLift, TyreSkin } from "./car-tyre-skin.ts";
import { skinKernel } from "../deform/skin-kernel.ts";
import { TyreSagArena } from "../deform/tyre-sag-kernel.ts";
import { assertSameNumbers } from "./test-support.ts";
import { tyreClearance } from "./tyre-clearance.test-util.ts";
import { CLASSES, carClass } from "./vehicle-classes.ts";
import { must } from "../kernel/must.test-util.ts";
import { worstHoldOverRest } from "./skin-stretch.test-util.ts";
import { hiddenTwins, NOSE_HIT } from "./hidden-twins.test-util.ts";
import { makeShell } from "./car-panels.ts";

/** A car's tear hook, protected on the car: the hit that would tear the part is beside the point. */
type Tearable = { detachPart(p: unknown, impulse: number): void; parts: readonly { name: string }[] };

/** How far (m) the deferred-hold row raises the wheels under the held body: far past the hold's wheel slack. */
const RISE_M = 0.02;

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

/** The tyre's sag clearance (`SAG_CLEAR`): a corner the tyre does not carry rises to it over the tyre's surface at its own place and no further. */
const SAG_CLEAR_M = 0.01;
/** Where the deep corner is driven into the tyre's front: this share of the radius ahead of the hub, and this far (m) under it. */
const DEEP_AHEAD = 0.6;
const DEEP_UNDER_M = 0.1;
/** The lone carrier's place (the first row's): this share of the radius ahead of the hub and this far (m) over it, half way up the hold's fade over the hub. */
const CARRIER_AHEAD = 0.55;
const CARRIER_OVER_M = 0.02;
/** Where the points that rested under the tyre's top are driven: under the hub, this share of the radius ahead of it, inside the tread. */
const LOWER_HALF_AHEAD = 0.3;

type Placer = (hub: THREE.Vector3, r: number) => THREE.Vector3;

/** A pickup whose resting point `pick` chooses is placed by `corner` and every other point by `other`, then held off its tyres: how far under its target that point started, and how far over it it ended. */
function loneCorner(pick: (over: Float32Array, index: ArrayLike<number>) => number, corner: Placer, other: (vertex: number, rests: boolean, ...at: Parameters<Placer>) => THREE.Vector3): { under: number; over: number } {
  const car = buildCar("pickup", "truck");
  const mesh = car["body"] as THREE.Mesh;
  const skin = new TyreSkin(car.frame, mesh, car.deform.restSkin, true);
  const lift = CLASSES[carClass(car)].lift;
  car.group.updateMatrixWorld(true);
  skin.hold(car.group, car.wheels, 0, lift, true);
  const over = skin["over"][FRONT_RIGHT_WHEEL]!;
  const held = pick(over, mesh.geometry.index!.array);
  expect(held, "fixture: a skin point resting over the tyre").toBeGreaterThanOrEqual(0);
  const fromCar = new THREE.Matrix4().multiplyMatrices(car.group.matrixWorld.clone().invert(), car.wheels[FRONT_RIGHT_WHEEL]!.matrixWorld);
  const hub = new THREE.Vector3().setFromMatrixPosition(fromCar);
  const r = car.frame.rig.tyre.r;
  const toMesh = new THREE.Matrix4().multiplyMatrices(car.group.matrixWorld.clone().invert(), mesh.matrixWorld).invert();
  const positions = mesh.geometry.getAttribute("position");
  const start = corner(hub, r);
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const place = vertex === held ? start.clone() : other(vertex, !Number.isNaN(over[vertex]!), hub, r);
    positions.setXYZ(vertex, ...place.applyMatrix4(toMesh).toArray());
  }
  skin.hold(car.group, car.wheels, 0, lift, true);
  const drawn = new THREE.Vector3().fromBufferAttribute(positions, held).applyMatrix4(toMesh.clone().invert());
  const target = hub.y + Math.sqrt(r * r - (drawn.z - hub.z) ** 2) + SAG_CLEAR_M;
  return { under: target - start.y, over: drawn.y - target };
}

const firstResting = (over: Float32Array): number => Array.from(over).findIndex((rest) => !Number.isNaN(rest));
const farAndLow = (vertex: number): THREE.Vector3 => new THREE.Vector3(FAR_POINT[0] + FAR_SPREAD_X * (vertex % 5), FAR_POINT[1], FAR_POINT[2] + FAR_SPREAD_Z * (vertex % FAR_SPREAD_COUNT));

describe("given a pickup's skin of which one point is driven deep into its front tyre's front, under the hub, and the rest is far and low", () => {
  it("when the skin is held off the tyres, then that corner rises no higher than the clearance over the tyre's surface at its own place", () => {
    const { under, over } = loneCorner(firstResting, (hub, r) => new THREE.Vector3(hub.x, hub.y - DEEP_UNDER_M, hub.z + DEEP_AHEAD * r), farAndLow);
    expect(under, "fixture: the corner starts deep under its target").toBeGreaterThan(10 * SAG_CLEAR_M);
    expect(over, `${(over * 1000).toFixed(1)} mm over its target`).toBeLessThanOrEqual(0.001);
  });
});

/** The first resting point with a triangle whose other two corners rested off the tyre: a panel the crush can tie to the tyre's lower half. */
function restingBesideUnheld(over: Float32Array, index: ArrayLike<number>): number {
  for (let t = 0; t < index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const [v, a, b] = [index[t + k]!, index[t + ((k + 1) % 3)]!, index[t + ((k + 2) % 3)]!];
      if (!Number.isNaN(over[v]!) && Number.isNaN(over[a]!) && Number.isNaN(over[b]!)) return v;
    }
  }
  return -1;
}

describe("given a pickup's skin of which one point is crushed into its front tyre's front just over the hub, the points that rested off the tyre are driven into its lower half, and the rest is high beside it", () => {
  it("when the skin is held off the tyres, then that corner rises no higher than the clearance over the tyre's surface at its own place: a panel tied to the tyre's lower half is not pried over its top", () => {
    const { under, over } = loneCorner(
      restingBesideUnheld,
      (hub, r) => new THREE.Vector3(hub.x, hub.y + CARRIER_OVER_M, hub.z + CARRIER_AHEAD * r),
      (vertex, rests, hub, r) => (rests ? farAndLow(vertex).setY(hub.y + 1) : new THREE.Vector3(hub.x, hub.y - DEEP_UNDER_M, hub.z + LOWER_HALF_AHEAD * r + FAR_SPREAD_X * (vertex % 5))),
    );
    expect(under, "fixture: the corner starts deep under its target").toBeGreaterThan(10 * SAG_CLEAR_M);
    expect(over, `${(over * 1000).toFixed(1)} mm over its target`).toBeLessThanOrEqual(0.001);
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
/** How much higher (m) the re-hold row lifts the class body: the points resting over the tyres are found again, and nothing else moves. */
const RELIFT_M = 0.02;
/** Half what that lift moves the held skin (m; measured 60.8 mm): a second hold that kept the first one's skin stands at least this far off. */
const RELIFT_MOVES_M = 0.03;

type HoldOutcome = { lift: Float32Array; positions: Float32Array; normals: Float32Array; held: boolean };
type KernelCalls = { sagPasses: number; raised: number };
type CrushedMesh = { mesh: THREE.Mesh; rest: Float32Array; pushSide: boolean; written: Float32Array; under: readonly PartSeat[] };
type CrushedHatchback = { car: DeformableCar; meshes: CrushedMesh[] };

/** `run` with the kernel's sag passes counted, and every sag pass read over tyres `tyreScale` times the car's (1: as they are). */
function countKernelCalls<T>(tyreScale: number, run: () => T): { calls: KernelCalls; result: T } {
  const calls: KernelCalls = { sagPasses: 0, raised: 0 };
  const realSag = TyreSagArena.prototype.sagPass;
  TyreSagArena.prototype.sagPass = function (this: TyreSagArena, skin, pos, wheel, again, tyre) {
    const raised = realSag.call(this, skin, pos, wheel, again, { r: tyre.r * tyreScale, halfW: tyre.halfW });
    calls.sagPasses++;
    if (raised) calls.raised++;
    return raised;
  };
  try {
    return { calls, result: run() };
  } finally {
    TyreSagArena.prototype.sagPass = realSag;
  }
}

/** A fresh `TyreSkin` over `crushed` holds its written skin over `car`'s tyres at the class lift `lift`, the sag pass in the kernel or, with `inKernel` false, in JS. */
function holdWritten(car: DeformableCar, crushed: CrushedMesh, inKernel: boolean, lift = CLASSES[carClass(car)].lift): HoldOutcome {
  const skin = new TyreSkin(car.frame, crushed.mesh, crushed.rest, crushed.pushSide);
  if (!inKernel) Object.defineProperty(skin, "kernel", { get: () => null });
  const positions = crushed.mesh.geometry.getAttribute("position");
  positions.array.set(crushed.written);
  skin.hold(car.group, car.wheels, 0, lift, true, crushed.under);
  return { lift: skin["lift"].slice(), positions: Float32Array.from(positions.array), normals: Float32Array.from(crushed.mesh.geometry.getAttribute("normal").array), held: skin["held"] };
}

/** The farthest (m) a drawn coordinate of `a` stands from `b`'s. */
function farthestApart(a: Float32Array, b: Float32Array): number {
  let far = 0;
  for (let i = 0; i < a.length; i++) far = Math.max(far, Math.abs(a[i]! - b[i]!));
  return far;
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
      expect(calls.sagPasses, `${calls.sagPasses} sag passes ran in the kernel`).toBeGreaterThan(0);
      expect(calls.raised > 0, `${calls.raised} of ${calls.sagPasses} sag passes lifted a corner`).toBe(sagLifts);
      expect(reference.held && reference.lift.some((lift) => lift > 0), "the hold lifted the crushed skin: the row compares a hold that moved something").toBeTruthy();
      assertSameNumbers(outcome.lift, reference.lift, `${label} lift`);
      assertSameNumbers(outcome.positions, reference.positions, `${label} positions`);
      assertSameNumbers(outcome.normals, reference.normals, `${label} normals`);
      expect(outcome.held).toBe(reference.held);
    });
  }

  it("when the kernel reads the body over tyres a fifth larger than the car's, then its lift is not the JS hold's, so the row can fail", () => {
    const crushed = fixture.meshes[0]!;
    const reference = holdWritten(fixture.car, crushed, false);
    const { result: outcome } = countKernelCalls(1.2, () => holdWritten(fixture.car, crushed, true));
    expect(outcome.lift.some((lift, point) => lift !== reference.lift[point]), "a sag pass over larger tyres must not match").toBeTruthy();
  });

  it(`when its body is held, then held again with the wheels still and the class lift ${RELIFT_M * 100} cm higher, then the drawn skin is a fresh hold's at that lift bit for bit`, () => {
    const crushed = fixture.meshes[0]!;
    const { car } = fixture;
    const lift = CLASSES[carClass(car)].lift;
    const atLift = holdWritten(car, crushed, true);
    const reference = holdWritten(car, crushed, true, lift + RELIFT_M);
    const skin = new TyreSkin(car.frame, crushed.mesh, crushed.rest, crushed.pushSide);
    const positions = crushed.mesh.geometry.getAttribute("position");
    positions.array.set(crushed.written);
    skin.hold(car.group, car.wheels, 0, lift, true, crushed.under);
    skin.hold(car.group, car.wheels, 0, lift + RELIFT_M, false, crushed.under);
    const moved = farthestApart(atLift.positions, reference.positions);
    expect(moved, `the higher lift moves the held skin ${(moved * 1000).toFixed(1)} mm: the row can fail`).toBeGreaterThan(RELIFT_MOVES_M);
    const apart = farthestApart(Float32Array.from(positions.array), reference.positions);
    expect(apart, `the second hold stands ${(apart * 1000).toFixed(2)} mm off a fresh hold at the higher lift`).toBe(0);
  });

  it(`when a wheel rises ${RISE_M * 1000} mm under the held body, then a hold no camera sees waits with the drawn skin as it was, and a car in view lays it that frame`, () => {
    const { car } = fixture;
    const crushed = fixture.meshes[0]!;
    const lift = CLASSES[carClass(car)].lift;
    const afterRise = (hidden: boolean): { owes: boolean; apart: number } => {
      const skin = new TyreSkin(car.frame, crushed.mesh, crushed.rest, crushed.pushSide);
      const positions = crushed.mesh.geometry.getAttribute("position");
      positions.array.set(crushed.written);
      skin.hold(car.group, car.wheels, 0, lift, true, crushed.under);
      const held = Float32Array.from(positions.array);
      for (const wheel of car.wheels) wheel.position.y += RISE_M;
      try {
        skin.hold(car.group, car.wheels, 0, lift, false, crushed.under, hidden);
      } finally {
        for (const wheel of car.wheels) wheel.position.y -= RISE_M;
      }
      return { owes: skin.owes, apart: farthestApart(Float32Array.from(positions.array), held) };
    };
    const hidden = afterRise(true);
    expect(hidden.owes, "the hidden car's hold waits").toBe(true);
    expect(hidden.apart, "and its skin stands as it was").toBe(0);
    const seen = afterRise(false);
    expect(seen.owes, "the car in view lays its hold").toBe(false);
    expect(seen.apart, `and the control moved the skin ${(seen.apart * 1000).toFixed(1)} mm: the row can fail`).toBeGreaterThan(0);
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

/**
 * Owner's five-car fleet capture, the coupe's cowl: a sag point whose third corner stands on the tyre with no room to rise, over two corners (weights 0.75 and 0.083) whose room to their own
 * targets is within a millimetre of each other. The corner picked to carry the third's share changed with that millimetre, and the other, 0.083 of the point, took 12 times the share (40 mm).
 */
const SPILL_BY_M = 0.0218;
const SPILL_WEIGHTS = [0.75, 0.083, 0.167] as const;
const SPILL_ROOM_M = 0.2137;
/** The room of the second corner is swept this far (m) either side of the first's, in steps this long: a lift moves at most a step of room, as no corner takes more than its room's share. */
const SPILL_SWEEP_M = 0.002;
const SPILL_STEP_M = 0.0001;

function spillOf(roomSecond: number): Float64Array {
  const lift = new Float64Array(3);
  spreadSagLift(SPILL_BY_M, SPILL_WEIGHTS, [1, 1, 1], [SPILL_ROOM_M, roomSecond, 0], [0, 0, 0], [0, 0, 0], lift);
  return lift;
}

describe("given a sag point whose third corner has no room to rise and whose first two corners' room differs by a millimetre", () => {
  it(`when the second corner's room sweeps ${SPILL_SWEEP_M * 1000} mm either side of the first's, then neither corner's lift moves more than twice a ${SPILL_STEP_M * 1000} mm step between steps`, () => {
    let worst = 0;
    let last = spillOf(SPILL_ROOM_M - SPILL_SWEEP_M);
    for (let at = -SPILL_SWEEP_M + SPILL_STEP_M; at <= SPILL_SWEEP_M + SPILL_STEP_M / 2; at += SPILL_STEP_M) {
      const lift = spillOf(SPILL_ROOM_M + at);
      worst = Math.max(worst, Math.abs(lift[0]! - last[0]!), Math.abs(lift[1]! - last[1]!));
      last = lift;
    }
    expect(worst, `a corner's lift moved ${(worst * 1000).toFixed(2)} mm between steps of ${SPILL_STEP_M * 1000} mm of room`).toBeLessThanOrEqual(2 * SPILL_STEP_M);
  });

  it("when the corners are lifted, then the point stands the lift it asked, the third corner's share carried by the other two", () => {
    for (const roomSecond of [SPILL_ROOM_M - SPILL_SWEEP_M, SPILL_ROOM_M, SPILL_ROOM_M + SPILL_SWEEP_M]) {
      const lift = spillOf(roomSecond);
      const point = SPILL_WEIGHTS[0] * lift[0]! + SPILL_WEIGHTS[1] * lift[1]! + SPILL_WEIGHTS[2] * lift[2]!;
      expect(point, `the point stands ${(point * 1000).toFixed(3)} mm of the ${SPILL_BY_M * 1000} mm it asked`).toBeCloseTo(SPILL_BY_M, 12);
      expect(lift[2], "the corner without room is not lifted").toBe(0);
    }
  });
});

/**
 * Owner's five-car fleet capture, the pickup's crushed row at 1019: a sag point nearly all on a corner the tyre holds down (weights 0.87, 0.07 liftable, the third beside the tread and unliftable),
 * no corner with room left. The third rule lifted the 7% corner by the whole shortfall each pass (24 mm a pass); that corner carries too little of the point to be lifted for it.
 */
const SLIVER_BY_M = 0.025;
const NO_ROOM = [0, 0, 0] as const;
const BESIDE_THIRD = [0, 0, 1] as const;

describe("given a sag point with no room under its corners' targets, the third corner unliftable and beside the tread", () => {
  it("when its liftable corner carries 7% of the point (the other 87% under the hub), then that corner is not lifted past its room", () => {
    const lift = new Float64Array(3);
    spreadSagLift(SLIVER_BY_M, [0.07, 0.87, 0.06], [1, 1, 0], NO_ROOM, [1, 0, 0], BESIDE_THIRD, lift);
    expect(lift[0], `the 7% corner is lifted ${(lift[0]! * 1000).toFixed(1)} mm`).toBe(0);
  });

  it("when its liftable corners carry 90% of it, then they are lifted past their room by the shortfall, the point standing the lift it asked", () => {
    const lift = new Float64Array(3);
    spreadSagLift(SLIVER_BY_M, [0.6, 0.3, 0.1], [1, 1, 0], NO_ROOM, [1, 1, 0], BESIDE_THIRD, lift);
    expect(0.6 * lift[0]! + 0.3 * lift[1]!, "the point stands the lift it asked, less its unliftable corner's share").toBeCloseTo(0.9 * SLIVER_BY_M * 0.9, 12);
  });
});

/** Of every this many frames: frame 0 is seen after an off-view hold (the engine's flush), frame 3 is seen at its own hold; the rest are off view. */
const SEEN_EVERY = 7;
const SEEN_AT_FLUSH = 0;
const SEEN_AT_HOLD = 3;

describe("given a sedan wreck driven in a slalom whose tyre holds are deferred while no camera sees it, beside an identical one held every frame", () => {
  it("when it comes into view, then its drawn body and bonnet positions are the twin's bit for bit, and off view they lag it", () => {
    const drives: DriveInput[] = [];
    const wreck = (): { w: CrashWorld; car: DeformableCar } => {
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
    const [every, lazy] = [wreck(), wreck()];
    let compared = 0;
    let flushed = 0;
    let lagged = 0;
    for (let f = 0; f < FRAMES; f++) {
      for (const d of drives) {
        d.throttle = every.car.crashed ? 0.5 : 0;
        d.steer = every.car.crashed ? Math.sin((2 * Math.PI * SLALOM_HZ * f) / FRAME_HZ) : 0;
      }
      const seenAt = f % SEEN_EVERY;
      lazy.car.setHoldDeferred(seenAt !== SEEN_AT_HOLD);
      tickWorld(every.w, FRAME);
      tickWorld(lazy.w, FRAME);
      if (seenAt === SEEN_AT_FLUSH) lazy.car.setHoldDeferred(false);
      if (seenAt === SEEN_AT_FLUSH && lazy.car.holdOwed) flushed++;
      if (seenAt === SEEN_AT_FLUSH) lazy.car.settleHold();
      if (seenAt === SEEN_AT_FLUSH || seenAt === SEEN_AT_HOLD) expect(lazy.car.holdOwed, `frame ${f}: a car in view has no hold owed`).toBe(false);
      const seen = seenAt === SEEN_AT_FLUSH || seenAt === SEEN_AT_HOLD;
      for (const mesh of MESHES) {
        const [a, b] = [lazy.car[mesh].geometry, every.car[mesh].geometry];
        if (!seen) {
          lagged += Number(farthestApart(a.getAttribute("position").array as Float32Array, b.getAttribute("position").array as Float32Array) > 0);
          continue;
        }
        assertSameNumbers(a.getAttribute("position").array, b.getAttribute("position").array, `frame ${f} ${mesh} positions`);
        compared++;
      }
    }
    expect(lazy.car.crashed, "the sedan was crashed").toBeTruthy();
    expect(flushed, "frames a hold was owed when the engine's flush came").toBeGreaterThan(0);
    expect(lagged, "off-view frames the deferred hold left the mesh behind the twin's").toBeGreaterThan(0);
    expect(compared, "meshes compared").toBeGreaterThan(MESHES.length * 10);
  });

  // What a hidden car's skins give the sim (a torn or hinged shell, a torn bonnet: their loose shapes and starts) must not depend on any camera.
  const positionsOf = (geometry: THREE.BufferGeometry): Float32Array => geometry.getAttribute("position").array as Float32Array;
  /** A side whose quarter panel is shut on both cars, or 0. */
  const shutSide = (lazy: DeformableCar, every: DeformableCar): number => [1, -1].find((s) => !lazy.quarterPanel(s).open && !every.quarterPanel(s).open) ?? 0;
  /** Twins whose hidden car owes its hold over a shut quarter panel, the panel's shell read off each car's skin differing now: a row on them can fail. */
  const owedOverShutPanel = (): { every: DeformableCar; lazy: DeformableCar; side: number } => {
    const twins = hiddenTwins((lazy, every) => {
      const side = shutSide(lazy, every);
      const region = side === 0 ? null : lazy.quarterPanel(side).region;
      if (!lazy.holdOwed || !region) return false;
      return farthestApart(positionsOf(makeShell(region, lazy.body.geometry)), positionsOf(makeShell(region, every.body.geometry))) > 0;
    });
    must(twins, "a frame came with the hidden car's hold owed over a shut quarter panel's skin");
    return { every: twins.every.car, lazy: twins.lazy.car, side: shutSide(twins.lazy.car, twins.every.car) };
  };
  const shellOf = (car: DeformableCar, side: number): Float32Array => positionsOf((car.quarterPanel(side).object as THREE.Mesh).geometry);

  // mutation: sed -i 's/^    this.layOwedHold();$//' src/game/vehicle/car-parts.ts  (both lays gone: the hidden car's shell tears off its stale skin, red)
  it("when a shut quarter panel is torn off a car no camera sees whose hold is owed, then the shell and its start are the held twin's bit for bit", () => {
    const { every, lazy, side } = owedOverShutPanel();
    for (const car of [every, lazy]) car.ripPanel(side, new THREE.Vector3(side * 3, 1, 0));
    assertSameNumbers(shellOf(lazy, side), shellOf(every, side), "the torn shell");
    assertSameNumbers(lazy.quarterPanel(side).object.position.toArray(), every.quarterPanel(side).object.position.toArray(), "where the shell starts");
  });

  // mutation: sed -i '/^  protected openPanel(p: DetachPart): void {$/{n;n;d;}' src/game/vehicle/car-parts.ts  (openPanel's lay gone: the first hinge copies the stale skin, red)
  it("when a shut quarter panel first hinges open on a car no camera sees whose hold is owed, then its shell is the held twin's bit for bit", () => {
    const { every, lazy, side } = owedOverShutPanel();
    for (const car of [every, lazy]) car.setPanelOpen(side, 0.3);
    assertSameNumbers(shellOf(lazy, side), shellOf(every, side), "the hinged shell");
  });

  // mutation: sed -i '/so no camera changes them\.$/{n;d;}' src/game/vehicle/car-parts.ts  (detachPart's lay gone: the bonnet tears off with its stale hold, red)
  it("when the bonnet is torn off a nose-crushed car no camera sees whose bonnet hold is owed, then it flies as the held twin's bit for bit", () => {
    const hoodOf = (car: DeformableCar): THREE.Mesh => car.lookMeshes().hood;
    const twins = hiddenTwins((lazy, every) => lazy.holdOwed && farthestApart(positionsOf(hoodOf(lazy).geometry), positionsOf(hoodOf(every).geometry)) > 0, NOSE_HIT);
    must(twins, "a frame came with the hidden car's bonnet hold owed and its bonnet skin behind the twin's");
    for (const { car } of [twins.every, twins.lazy]) {
      const torn = car as unknown as Tearable;
      torn.detachPart(torn.parts.find((p) => p.name === LID.hood), 0);
    }
    const [a, b] = [hoodOf(twins.lazy.car), hoodOf(twins.every.car)];
    assertSameNumbers(positionsOf(a.geometry), positionsOf(b.geometry), "the torn bonnet's skin (its loose shape)");
    assertSameNumbers(a.position.toArray(), b.position.toArray(), "where the bonnet starts");
  });

  // mutation: sed -i '/^    this.skinRewritten = true;$/{n;d;}' src/game/vehicle/car-tyre-skin.ts  (the owed lift outlives the reset and is laid over the rest skin, red)
  it("when a car no camera sees is reset while its hold is owed and a quarter panel is then torn off, then the shell is the held twin's bit for bit", () => {
    const { every, lazy, side } = owedOverShutPanel();
    for (const car of [every, lazy]) car.resetVisual();
    expect(lazy.holdOwed, "the reset drops the owed hold").toBe(false);
    for (const car of [every, lazy]) car.ripPanel(side, new THREE.Vector3(side * 3, 1, 0));
    assertSameNumbers(shellOf(lazy, side), shellOf(every, side), "the torn shell");
  });
});
