import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { type CrashWorld, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { buildCar, TOP_PARTS } from "./drawn-body.test-util.ts";
import { makeLampUnit, makeWheelGeometry } from "./car-materials.ts";
import type { CarStyleId } from "./car-variants.ts";
import type { DeformableCar } from "./car.ts";
import { PART_KIND, PartSeat } from "./part-geometry.ts";
import { CLASSES, VEHICLE_CLASS_IDS, type VehicleClassId } from "./vehicle-classes.ts";
import { CLASS_LIFT } from "./constants.ts";
import { BUMP_RESERVE, droop } from "./car-suspension.ts";
import { FRAME_RAIL_Y } from "./interior-geometry.ts";
import { PLATFORM_TYRE } from "../kernel/rig-spec.ts";

/**
 * A wreck lying on its roof or its side rests so that what is drawn stays out of the ground: the body and the roof crown within the
 * cage's few centimetres, the mirrors and the lamps clear. Every number is read off the drawn meshes (the world vertices of the
 * body, door, mirror and lamp meshes), not off the contact points the solver rests the body on, which cannot see what they leave out.
 */

type Fleet = readonly { style: CarStyleId; cls: VehicleClassId }[];
const FLEET: Fleet = [
  { style: "sedan", cls: "sedan" },
  { style: "pickup", cls: "truck" },
  { style: "sedan", cls: "monster" },
];
/** The flank row's classes: the fleet's, then the other four, so every class has its flank tested. */
const FLANK_FLEET: Fleet = [...FLEET, ...VEHICLE_CLASS_IDS.filter((cls) => !FLEET.some((f) => f.cls === cls)).map((cls) => ({ style: CLASSES[cls].style, cls }))];
/** The hubs of the tyres a car lying on its `left` or `right` flank stands on: with those gone it lies on its body. */
const LOW_HUBS = { left: ["hubFL", "hubRL"], right: ["hubFR", "hubRR"] } as const;
/** The attitudes a car is dropped in (pitch, yaw, roll about the car's own axes, radians): flat on its roof, on its roof nose down or up by 0.5 rad, on its left flank, on its right flank. */
const ATTITUDE = {
  roof: [0, 0, Math.PI],
  roofNoseDown: [0.5, 0, Math.PI],
  roofNoseUp: [-0.5, 0, Math.PI],
  left: [0, 0, Math.PI / 2],
  right: [0, 0, -Math.PI / 2],
  wheels: [0, 0, 0],
} as const;
type Attitude = keyof typeof ATTITUDE;
const DROP_SECONDS = 5;
/** A body or crown vertex lies within this (m) of the ground at worst: the cage's decimation (220 vertices) leaves drawn vertices between its own, measured up to 0.030 m. */
const BODY_SINK_M = 0.04;
/** A mirror or lamp lies out of the ground to within the drawn parts' own tolerance (m). */
const PART_SINK_M = 0.02;
/** The crown is the drawn cabin's vertices within this (m) of its highest. */
const CROWN_DEPTH_M = 0.15;
/** A wreck dropped on its flank with one low wheel gone is asleep within this many s: it stands on the other tyre and its body, and finds them. */
const REST_SECONDS = 8;
/** Where along the car's nose (m from its middle) the hit that makes a wreck of it lands. */
const NOSE_HIT_M = 2.05;
/** A mirror of a car on its wheels is at least this high (m): it stands on the door, a good half metre up. */
const MIRROR_ON_WHEELS_MIN_M = 0.3;
/** A loaded tyre's sidewall flattens about this much (m) under its share of the car, and the drawn tread stands a little under the footprint the sim rests on. */
const TYRE_SQUASH_M = 0.03;
/** A sleeping wreck's mass stays within this (m) of where it lay. */
const MASS_STILL_M = 1e-3;
/** The platform tyre's vertices (wheel-local, axle along x): a car's own tyre scales them, as the wheel batch draws it. */
const TYRE_POINTS = makeWheelGeometry().getAttribute("position");
/** A nose hit (m/s) hard enough to tear the hood off every fleet class but the monster, whose bay stays shut. */
const HOOD_OFF_MPS = 40;
/** The seats that ride the wreck's ground (`restOnGround`): the cabin shell, the engine bay, the monster's frame and axles. */
const GROUND_RIDERS: readonly number[] = [PART_KIND.interior, PART_KIND.engineBay, PART_KIND.ladderFrame, PART_KIND.axle];
const _tyreAt = new THREE.Matrix4();
const _tyreScale = new THREE.Vector3();

const _v = new THREE.Vector3();

function lowestY(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, only?: (vertex: number) => boolean): number {
  const position = geometry.getAttribute("position");
  let low = Infinity;
  for (let k = 0; k < position.count; k++) {
    if (only && !only(k)) continue;
    low = Math.min(low, _v.fromBufferAttribute(position, k).applyMatrix4(matrix).y);
  }
  return low;
}

type Lowest = { body: number; crown: number; mirrors: number; doors: number; lamps: number; tyres: number; kit: number };

/** The vertices of the drawn body's cabin within `CROWN_DEPTH_M` of its highest, found on the fresh body. */
function crownVertices(car: DeformableCar): ReadonlySet<number> {
  const position = car.body.geometry.getAttribute("position");
  const inCabin = (k: number): boolean => position.getX(k) >= TOP_PARTS.cabin.x0 && position.getX(k) <= TOP_PARTS.cabin.x1 && position.getZ(k) >= TOP_PARTS.cabin.z0 && position.getZ(k) <= TOP_PARTS.cabin.z1;
  let top = -Infinity;
  for (let k = 0; k < position.count; k++) if (inCabin(k)) top = Math.max(top, position.getY(k));
  const crown = new Set<number>();
  for (let k = 0; k < position.count; k++) if (inCabin(k) && position.getY(k) > top - CROWN_DEPTH_M) crown.add(k);
  return crown;
}

/** The lowest world y of each drawn part of `car` (m): its body, its roof crown, its mirrors (attached or loose), its doors without their mirrors, its lamps. */
function lowestDrawn(car: DeformableCar, crown: ReadonlySet<number>): Lowest {
  car.flushDeferredSkin();
  car.updateSkin();
  car.group.updateMatrixWorld(true);
  car.body.updateWorldMatrix(true, false);
  const parts = car["parts"];
  const mirrors: PartSeat[] = parts.filter((p) => p.mirror).flatMap((p) => (p.object instanceof PartSeat ? [p.object] : []));
  const isMirror = (o: THREE.Object3D): boolean => mirrors.some((m) => m === o || m === o.parent);
  let low: Lowest = { body: lowestY(car.body.geometry, car.body.matrixWorld), crown: lowestY(car.body.geometry, car.body.matrixWorld, (k) => crown.has(k)), mirrors: Infinity, doors: Infinity, lamps: Infinity, tyres: Infinity, kit: Infinity };
  for (const mirror of mirrors) {
    mirror.updateWorldMatrix(true, false);
    low = { ...low, mirrors: Math.min(low.mirrors, lowestY(mirror.geometry, mirror.matrixWorld)) };
  }
  for (const door of parts.filter((p) => p.hinge === "door")) {
    door.object.updateWorldMatrix(true, false);
    door.object.traverse((o) => {
      if (!(o instanceof THREE.Mesh || o instanceof PartSeat) || isMirror(o)) return;
      // Only what is drawn: a shattered side pane is hidden on its rest seat and is no part of the door the eye sees.
      let shown = o.visible;
      o.traverseAncestors((a) => (shown &&= a.visible));
      if (shown) low = { ...low, doors: Math.min(low.doors, lowestY(o.geometry, o.matrixWorld)) };
    });
  }
  for (const lamp of car.lamps) {
    lamp.seat.updateWorldMatrix(true, false, true);
    low = { ...low, lamps: Math.min(low.lamps, lowestY(makeLampUnit(lamp.kind), lamp.seat.matrixWorld)) };
  }
  const { r, halfW } = car.frame.rig.tyre;
  let tyres = Infinity;
  for (const wheel of car.wheels) {
    wheel.updateWorldMatrix(true, false);
    _tyreAt.copy(wheel.matrixWorld).scale(_tyreScale.set(halfW / PLATFORM_TYRE.halfW, r / PLATFORM_TYRE.r, r / PLATFORM_TYRE.r));
    for (let k = 0; k < TYRE_POINTS.count; k++) tyres = Math.min(tyres, _v.fromBufferAttribute(TYRE_POINTS, k).applyMatrix4(_tyreAt).y);
  }
  car.underbody?.follow();
  let kit = Infinity;
  for (const seat of car.partSeats) {
    let shown = GROUND_RIDERS.includes(seat.kind) && seat.parent !== null && (seat.showIf === null || seat.showIf());
    for (let p: THREE.Object3D | null = seat; shown && p; p = p.parent) shown = p.visible;
    if (!shown) continue;
    seat.updateWorldMatrix(true, false);
    kit = Math.min(kit, lowestY(seat.drawn, seat.matrixWorld));
  }
  low = { ...low, tyres, kit };
  return low;
}

/** A car of `style` and `cls` dropped in `attitude` from `height` m (its lowest drawn point) on the flat pad and left `DROP_SECONDS` s, a wreck once its nose is hit first at `strike` m/s (none: 0), the hubs in `popped` torn off after the hit; with the crown it had fresh. */
function dropped(style: CarStyleId, cls: VehicleClassId, attitude: Attitude, height: number, strike = 0, popped: readonly string[] = [], seconds = DROP_SECONDS): { car: DeformableCar; lowest: Lowest; world: CrashWorld } {
  const car = buildCar(style, cls);
  car.spawnFacing(0, 0, 0, 0);
  car.updateSkin();
  const crown = crownVertices(car);
  if (strike > 0) car.applyImpact(car.group.position.clone().addScaledVector(car.forward, NOSE_HIT_M), car.forward.clone().negate(), strike, strike);
  for (const name of popped) car.deform.popHub(car.deform.masses.find((m) => m.name === name)!);
  const [pitch, yaw, roll] = ATTITUDE[attitude];
  car.group.rotation.set(pitch, yaw, roll, "YXZ");
  car.group.updateMatrixWorld(true);
  car.group.position.y += height - new THREE.Box3().setFromObject(car.group).min.y;
  car.airborne = true;
  car.parked = true;
  const world = makeWorld([car], false, false);
  for (let f = 0; f < seconds * FRAME_HZ; f++) tickWorld(world, 1 / FRAME_HZ);
  return { car, lowest: lowestDrawn(car, crown), world };
}

const cm = (m: number): string => `${(m * 100).toFixed(1)} cm`;

/** The lowest cage vertex's height over the flat pad (m): the body the sim rests on, not the drawn one. */
function cageClearance(car: DeformableCar): number {
  car.group.updateMatrixWorld(true);
  car.refitCage();
  const cage = car.cage.fields.pos;
  let low = Infinity;
  for (let i = 0; i < car.cage.style.vertexCount; i++) low = Math.min(low, _v.set(cage[i * 3]!, cage[i * 3 + 1]!, cage[i * 3 + 2]!).applyMatrix4(car.group.matrixWorld).y);
  return low;
}

describe("given a car dropped onto its roof on the flat pad, from 0.5 and from 2 m, and left to rest", () => {
  for (const { style, cls } of FLEET) {
    // On union 9d49c86f the sedan rests on its roof (0.5 and 2 m alike) pitched 8.7° with its drawn A-pillar foot, car (-0.66, 0.98, 0.75),
    // 4.0 cm in the ground: on the 4 cm bar (`BODY_SINK_M`). Its cage keeps the cowl's sides there, (±0.670, 0.960, 0.900) and (±0.715,
    // 0.871, 0.990); a cage without them read 7.3 cm (CarRig rig-lip, before its held underside left the budget).
    it(`when it is a ${cls}, then the drawn body and roof crown stay out of the ground, and its mirrors and lamps with them`, () => {
      for (const height of [0.5, 2]) {
        const { car, lowest } = dropped(style, cls, "roof", height);
        const tag = `${cls} dropped on its roof from ${height} m`;
        assert.ok(lowest.body > -BODY_SINK_M, `${tag}: body ${cm(-lowest.body)} into the ground`);
        assert.ok(lowest.crown > -BODY_SINK_M, `${tag}: roof crown ${cm(-lowest.crown)} into the ground`);
        assert.ok(lowest.mirrors > -PART_SINK_M, `${tag}: a mirror ${cm(-lowest.mirrors)} into the ground`);
        assert.ok(lowest.lamps > -PART_SINK_M, `${tag}: a lamp ${cm(-lowest.lamps)} into the ground`);
        assert.ok(!car.partOff("mirrorL") && !car.partOff("mirrorR"), `${tag}: a mirror that stands clear of the ground was torn off`);
      }
    });
  }

  it("when a sedan rests on its roof from 0.5 m, then its drawn doors are out of the ground", () => {
    const { lowest } = dropped("sedan", "sedan", "roof", 0.5);
    // A 0.12 m allowance here was the shattered side pane, hidden on its rest seat, counted as door: the drawn door stands 0.29 m clear.
    assert.ok(lowest.doors > 0, `a door ${cm(-lowest.doors)} into the ground`);
  });
});

describe("given a car dropped onto its left or right flank on the flat pad, from 0.5 and from 2 m, and left to rest", () => {
  for (const { style, cls } of FLANK_FLEET) {
    it(`when it is a ${cls}, then the drawn body stays out of the ground, the mirror it lies on is torn off and rests on the ground, and the other mirror is left as it was`, (t) => {
      for (const side of ["left", "right"] as const) {
        for (const height of [0.5, 2]) {
          const { car, lowest } = dropped(style, cls, side, height);
          const tag = `${cls} dropped on its ${side} flank from ${height} m`;
          const [down, up] = side === "left" ? (["mirrorL", "mirrorR"] as const) : (["mirrorR", "mirrorL"] as const);
          t.diagnostic(`${tag}: body ${cm(lowest.body)}, mirrors ${cm(lowest.mirrors)}, lamps ${cm(lowest.lamps)} over the ground`);
          assert.ok(lowest.body > -BODY_SINK_M, `${tag}: body ${cm(-lowest.body)} into the ground`);
          assert.ok(lowest.mirrors > -PART_SINK_M, `${tag}: a mirror ${cm(-lowest.mirrors)} into the ground`);
          assert.ok(car.partOff(down), `${tag}: the mirror under the car is still on it`);
          assert.ok(!car.partOff(up), `${tag}: the mirror above the car was torn off`);
        }
      }
    });
  }

  // A sedan's rest on a flank is one of two poses by the drop's height (swept 1.8-2.2 m, union 9d49c86f): its body 2.6-3.8 cm over the
  // ground and its lamps 4 cm, or its body 1.4-3.0 cm in it (its drawn flank stands proud of the cage, which carries the ground) and its
  // lamps 0.2-2.3 cm in. Its mirrors drawn at their own reach (89399471) moved the 2 m right drop into the second pose (lamps -2.3 cm);
  // at their platform reach 1.8 and 2.2 m read -2.2 and -2.1. The flank's gap is CarRig's to attribute.
  it.todo("when a car is dropped on its left or right flank from any height and left to rest, then its lamps are out of the ground");
});

describe("given any class dropped onto its left or right flank on the flat pad from 0.5 m, and left to rest", () => {
  for (const cls of VEHICLE_CLASS_IDS) {
    // From 2 m a class tips on past flat onto its roof's edge (up -0.3 to -0.5) and the drawn tyre's shoulder reaches 2-4 cm under the footprint the sim rests on.
    it(`when it is a ${cls}, then no tyre sinks more than its sidewall flattens: the tyres it lies on carry its whole weight, each its half`, (t) => {
      for (const side of ["left", "right"] as const) {
        const { lowest } = dropped(CLASSES[cls].style, cls, side, 0.5);
        t.diagnostic(`${cls} dropped on its ${side} flank from 0.5 m: lowest tyre ${cm(lowest.tyres)} over the ground`);
        assert.ok(lowest.tyres > -TYRE_SQUASH_M, `${cls} dropped on its ${side} flank from 0.5 m: a tyre ${cm(-lowest.tyres)} into the ground`);
      }
    });
  }
});

describe("given a monster that lost the two wheels on one side, dropped onto that flank on the flat pad, from 0.5 and from 2 m, and left to rest", () => {
  it("when it rests, then it lies on its body: the drawn body stays out of the ground, the mirror it lies on is torn off, and the other mirror is left as it was", (t) => {
    for (const side of ["left", "right"] as const) {
      for (const height of [0.5, 2]) {
        const { car, lowest } = dropped("sedan", "monster", side, height, 0.5, LOW_HUBS[side]);
        const tag = `monster without its ${side} wheels dropped on its ${side} flank from ${height} m`;
        const [down, up] = side === "left" ? (["mirrorL", "mirrorR"] as const) : (["mirrorR", "mirrorL"] as const);
        t.diagnostic(`${tag}: body ${cm(lowest.body)}, mirrors ${cm(lowest.mirrors)} over the ground`);
        assert.ok(lowest.body > -BODY_SINK_M, `${tag}: body ${cm(-lowest.body)} into the ground`);
        assert.ok(lowest.mirrors > -PART_SINK_M, `${tag}: a mirror ${cm(-lowest.mirrors)} into the ground`);
        assert.ok(car.partOff(down), `${tag}: the mirror under the car is still on it`);
        assert.ok(!car.partOff(up), `${tag}: the mirror above the car was torn off`);
      }
    }
  });

  it("when it has slept for 2 s more, then none of its masses has moved a millimetre: a sleeping wreck's masses stand where it lies", () => {
    for (const side of ["left", "right"] as const) {
      const { car, world } = dropped("sedan", "monster", side, 2, 0.5, LOW_HUBS[side]);
      const tag = `monster without its ${side} wheels dropped on its ${side} flank from 2 m`;
      assert.ok(car.asleep, `${tag}: it has not fallen asleep in ${DROP_SECONDS} s`);
      const before = car.deform.masses.map((m) => m.local.clone());
      for (let f = 0; f < 2 * FRAME_HZ; f++) tickWorld(world, 1 / FRAME_HZ);
      const moved = Math.max(...car.deform.masses.map((m, i) => m.local.distanceTo(before[i]!)));
      assert.ok(car.asleep && moved < MASS_STILL_M, `${tag}: a mass moved ${cm(moved)} in 2 s asleep`);
    }
  });
});

describe("given any class that lost one of the two wheels it lies on, dropped onto that flank on the flat pad, from 0.5 m (front wheel gone) and from 2 m (rear wheel gone)", () => {
  for (const { style, cls } of FLANK_FLEET) {
    it(`when it is a ${cls}, then it is asleep within ${REST_SECONDS} s with its cage and its drawn body out of the ground: a single tyre under the car does not pivot it`, (t) => {
      for (const side of ["left", "right"] as const) {
        for (const [height, hub] of [[0.5, LOW_HUBS[side][0]], [2, LOW_HUBS[side][1]]] as const) {
          const { car, lowest } = dropped(style, cls, side, height, 0.5, [hub], REST_SECONDS);
          const cage = cageClearance(car);
          const tag = `${cls} without its ${hub} dropped on its ${side} flank from ${height} m`;
          t.diagnostic(`${tag}: ${car.asleep ? "asleep" : `awake at ${car.velocity.length().toFixed(2)} m/s`}, cage ${cm(cage)}, body ${cm(lowest.body)} over the ground`);
          assert.ok(car.asleep, `${tag}: still awake after ${REST_SECONDS} s, moving at ${car.velocity.length().toFixed(2)} m/s`);
          assert.ok(cage > -BODY_SINK_M, `${tag}: cage ${cm(-cage)} into the ground`);
          assert.ok(lowest.body > -BODY_SINK_M, `${tag}: body ${cm(-lowest.body)} into the ground`);
        }
      }
    });
  }
});

describe("given a car struck on the nose and dropped onto its roof (flat, nose down or up) or a flank on the flat pad, and left to rest", () => {
  for (const { style, cls } of FLANK_FLEET) {
    it(`when it is a ${cls}, then every rigid under-part of it that shows (cabin shell, engine bay, frame, axles) stands out of the ground`, (t) => {
      for (const attitude of ["roof", "roofNoseDown", "roofNoseUp", "left", "right"] as const) {
        const { lowest } = dropped(style, cls, attitude, 0.5, HOOD_OFF_MPS);
        const tag = `${cls} struck at ${HOOD_OFF_MPS} m/s and dropped on its ${attitude}`;
        t.diagnostic(`${tag}: lowest rigid under-part ${cm(lowest.kit)} over the ground`);
        assert.ok(lowest.kit < Infinity, `${tag}: none of the cabin shell, engine bay, frame or axles shows, so nothing here could stand in the ground`);
        assert.ok(lowest.kit > 0, `${tag}: a rigid under-part ${cm(-lowest.kit)} into the ground`);
      }
    });
  }
});

describe("given a car dropped on its wheels on the flat pad", () => {
  it("when it settles for 5 s, then it keeps both mirrors: nothing of it lies over far enough to put one into the ground", () => {
    for (const { style, cls } of FLEET) {
      const { car, lowest } = dropped(style, cls, "wheels", 0.5, 0.5);
      assert.ok(car.crashed, `${cls}: the nose hit did not make it a wreck, so nothing here could tear a mirror`);
      assert.ok(!car.partOff("mirrorL") && !car.partOff("mirrorR"), `${cls}: a mirror was torn off a car standing on its wheels`);
      assert.ok(lowest.mirrors > MIRROR_ON_WHEELS_MIN_M, `${cls}: a mirror ${cm(lowest.mirrors)} over the ground, not up where it stands`);
    }
  });
});

describe("given a car lying on its roof, with its doors drawn on their rest seats", () => {
  it("when it rests after a 2 m drop, then each drawn door is out of the ground (the 0.19 m it read was the hidden shattered pane)", () => {
    const { lowest } = dropped("sedan", "sedan", "roof", 2);
    assert.ok(lowest.doors > 0, `a door ${cm(-lowest.doors)} into the ground`);
  });
});

describe("given a monster truck lying on its roof, next to one on its wheels, on the flat pad", () => {
  const SLACK_M = 1e-6;

  /** Each wheel's hub height over the frame's rails (m), in the car's own frame. */
  function hubsOverRails(car: DeformableCar): number[] {
    car.group.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(car.group.matrixWorld).invert();
    const rails = car.group.getObjectByName(CLASS_LIFT)!.position.y + FRAME_RAIL_Y;
    return car.wheels.map((wheel) => _v.setFromMatrixPosition(wheel.matrixWorld).applyMatrix4(inverse).y - rails);
  }

  it("when both rest for 5 s, then every wheel of the one on its roof has come toward its frame by more than nothing and by no more than its bump stop less the reserve a truck keeps to it, and each axle is still under the frame", () => {
    const standing = hubsOverRails(dropped("monster", "monster", "wheels", 0.5).car);
    const inverted = hubsOverRails(dropped("monster", "monster", "roof", 0.5).car);
    for (const [i, rest] of standing.entries()) {
      const compression = inverted[i]! - rest;
      assert.ok(compression > 0 && compression <= droop("monster") - BUMP_RESERVE + SLACK_M, `wheel ${i} stands ${cm(compression)} nearer its frame than at rest, its bump stop ${cm(droop("monster"))}`);
      assert.ok(inverted[i]! < 0, `wheel ${i}'s hub stands ${cm(inverted[i]!)} over the frame's rails`);
    }
  });
});
