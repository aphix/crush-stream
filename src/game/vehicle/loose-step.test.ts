import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CRASH } from "../deform/physics-util.ts";
import { GRAVITY, FINE_HZ, FRAME_HZ, QUIET_HZ } from "../kernel/constants.ts";
import { newWorld, stepWorld, type World } from "../engine/world-step.ts";
import { Ground, setGround } from "../world/ground.ts";
import { armSolids, Surface } from "../world/surfaces.ts";
import { DeformableCar } from "./car.ts";
import type { DetachPart, LooseBody } from "./car-core.ts";
import { carFrame } from "./car-rig.ts";
import { CAR_STYLES } from "./car-variants.ts";
import { crownY } from "./car-cage-rig.ts";
import { SKIN } from "./car-surfaces.ts";
import { MU_BODY, RESTITUTION, invInertia } from "./car-air-body.ts";
import { AIR_DENSITY, boxShape, newLooseShape, partMass, PLATE_CN_BROADSIDE, stepLoose } from "./loose-step.ts";
import { corner, highest, LIES_FLAT, lowest, RESTS, thinAxisUp } from "./loose-step.test-util.ts";
import { assertSameDigest, paint } from "./test-support.ts";

const H = 1 / QUIET_HZ;

/** A flat road at height `raise`, under everything. */
class RaisedRoad extends Ground {
  constructor(raise: number) {
    super();
    this.addPlane(raise, -1e7, 1e7, -1e7, 1e7, Infinity);
  }
}

/** The farthest the box reaches along the unit direction `dir` from the origin (m). */
function farthest(part: LooseBody, dir: THREE.Vector3): number {
  let far = -Infinity;
  for (let k = 0; k < part.shape.count; k++) far = Math.max(far, corner(part, k).dot(dir));
  return far;
}

/** A loose slab (a bumper's size: 1.7 across, 0.3 high, 0.5 deep) with its middle at (0, `y`, 0) and velocity `v`. */
function slab(y: number, v: THREE.Vector3): LooseBody {
  const object = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.3, 0.5));
  object.position.set(0, y, 0);
  return { object, velocity: v.clone(), angular: new THREE.Vector3(), radius: 0.4, shape: newLooseShape() };
}

/** A torn part thrown along the road at the speed a racer drops it, stepped for `seconds` on ground raised by `raise` m. */
function slideRaised(raise: number, seconds: number): THREE.Vector3 {
  setGround(new RaisedRoad(raise));
  try {
    const p = slab(raise + 0.15, new THREE.Vector3(30, 0, 0));
    for (let t = 0; t < seconds; t += H) stepLoose(p, H, -1);
    return p.object.position.clone().sub(new THREE.Vector3(0, raise, 0));
  } finally {
    setGround(null);
  }
}

describe("given a torn part sliding along a road", () => {
  it("when the road is raised (a dam, a bridge, a crest), then the part slides, slows and stops exactly as it does on a road at ground level", () => {
    const low = slideRaised(0, 6);
    const high = slideRaised(18, 6);
    assert.ok(Math.abs(high.x - low.x) < 1e-6 && Math.abs(high.y - low.y) < 1e-6, `raised road: ${high.x.toFixed(2)} m along, level road: ${low.x.toFixed(2)} m`);
  });
});

/** Car B's plan x: parked beside car A (at the origin), a body width and a metre between their flanks (both sedans). */
const B_X = 2 * carFrame(CAR_STYLES.sedan).half.x + 1;

type Lot = { w: World; cars: DeformableCar[]; part: DetachPart };

/** Car A parked at the origin and, with `withB`, car B parked at `B_X` beside it, both facing +z; A's front bumper torn off (at rest). */
function lot(withB: boolean): Lot {
  const scene = new THREE.Scene();
  const a = new DeformableCar(paint(), scene);
  a.spawnFacing(0, 0, 0, 0);
  const cars = [a];
  if (withB) {
    const b = new DeformableCar(paint(), scene);
    b.spawnFacing(B_X, 0, 0, 0);
    cars.push(b);
  }
  const w = newWorld(cars);
  // The slices a step takes with two cars in reach, on open road too: the stop's last slice (v0 h / 2 moved, v0² / 2a owed) differs with the slice, so only one cut compares the two lots.
  w.plan = 2;
  const part = a["parts"].find((p) => p.name === "bumperF")!;
  a["detachPart"](part, 0, new THREE.Vector3());
  part.angular.set(0, 0, 0);
  return { w, cars, part };
}

/** The part with its object at (x, y, z), its axes the world's, moving at `vel`, then the world run `seconds` through the engine's step (`stepWorld`: the cars move its loose parts). */
function throwPart(l: Lot, x: number, y: number, z: number, vel: THREE.Vector3, seconds: number): void {
  l.part.object.position.set(x, y, z);
  l.part.object.quaternion.identity();
  l.part.angular.set(0, 0, 0);
  l.part.velocity.copy(vel);
  for (let t = 0; t < seconds; t += H) stepWorld(l.w, H);
}

/** Its plan speed (m/s). */
const planSpeed = (p: DetachPart): number => Math.hypot(p.velocity.x, p.velocity.z);

/** A part sliding at this speed (m/s) along the road. */
const SLIDE_V = 8;

/** Where the bumper slides: beside B's flank (and clear of A's), along +z from z = 0. */
const SLIDE_X = B_X - carFrame(CAR_STYLES.sedan).half.x - 0.3;

/** How far (m) a part sliding straight may drift sideways: a millimetre. */
const STRAIGHT = 1e-3;

/** Where the bumper lies while the parked cars settle on their springs: out of B's reach, which wakes a sleeper and settles it through the speculative gap it slept in. */
const SETTLE_X = -20;

/** The parked cars settled, then the bumper let down on the road at `SLIDE_X` and left to lie, then sliding at `SLIDE_V`, run twice its stopping time; the part after it. */
function slide(withB: boolean): DetachPart {
  const l = lot(withB);
  throwPart(l, SETTLE_X, 0.3, 0, new THREE.Vector3(), 1);
  throwPart(l, SLIDE_X, 0.3, 0, new THREE.Vector3(), 1);
  const o = l.part.object.position;
  throwPart(l, o.x, o.y, 0, new THREE.Vector3(0, 0, SLIDE_V), (2 * SLIDE_V) / (MU_BODY * GRAVITY));
  return l.part;
}

/**
 * That it stopped, straight along its line, in the distance its slide friction and the wind on its broad face (square to its slide) give to within
 * one step's travel: v' = -(μ g + k v²), k = ½ρ C_N A / m (`blow`), so d = ln(1 + k v²/(μ g)) / 2k (g: the sim's own gravity, the weight its friction presses with).
 */
function assertSlideStop(part: DetachPart): void {
  const travelled = part.object.position.z;
  const [, mid, big] = part.shape.half.toArray().sort((a, b) => a - b);
  const k = (0.5 * AIR_DENSITY * PLATE_CN_BROADSIDE * 4 * mid! * big!) / partMass(part);
  const stop = Math.log(1 + (k * SLIDE_V ** 2) / (MU_BODY * GRAVITY)) / (2 * k);
  assert.equal(planSpeed(part), 0, "plan speed after twice its stopping time");
  assert.ok(Math.abs(travelled - stop) <= SLIDE_V * H, `slid ${travelled.toFixed(3)} m; at μ ${MU_BODY} and the wind's k ${k.toFixed(4)}/m: ${stop.toFixed(3)} m ± one step's ${(SLIDE_V * H).toFixed(3)} m`);
  assert.ok(Math.abs(part.object.position.x - SLIDE_X) < STRAIGHT, `it slides straight along its line (${part.object.position.x - SLIDE_X} m off)`);
}

describe("given a front bumper torn off a parked car, sliding along the road at 8 m/s", () => {
  it("when it slides on open road, then it stops in the distance its slide friction gives at its speed", () => {
    assertSlideStop(slide(false));
  });

  it("when it slides past the flank of a second car parked beside it, then it stops in the distance its slide friction gives at its speed, the same as on open road", () => {
    const beside = slide(true);
    assertSlideStop(beside);
    assert.equal(beside.object.position.z, slide(false).object.position.z, "distance beside the parked car vs on open road");
  });
});

/** The part dropped this high (m) over car B's roof crown. */
const DROP = 0.5;
/** Pushed across the roof at this speed (m/s): its slide friction stops it after v²/(2 μ g) ≈ 2.2 m, past the roof's edge. */
const PUSH_V = 5;
/**
 * How long (s) the pushed bumper is run: it drops 1.3 m off the roof's edge, lands on an end of its U and rolls over its shell onto its back
 * (at 2 rad/s, 1.5-2.1 s), at rest on the road 2.2 s after the push; as one box it was at rest within 2 s.
 */
const OFF_ROOF_S = 3;

/**
 * The bumper dropped onto parked car B's roof, left `rest` s, then pushed off it sideways for `slide` s: how it rests on the roof (`onRoof`: its
 * middle stands over B's roof, its plan within B's half width, and its top, the face it lies on, no lower than the crown less a top's skin)
 * and its lowest point at the end. A torn bumper is a U in plan (its swept ends and seam cover): lying face down across the roof its ends hang
 * down the roof's sides (0.54 m on the sedan), so neither its lowest point nor its box's middle (1.036 m up under a 1.332 m crown, flying as
 * its shell: ticket B) says whether the roof holds it; its top does.
 */
function roofDrop(l: Lot, at: number, rest: number, slide: number): { onRoof: boolean; middle: THREE.Vector3; top: number; restSpeed: number; end: THREE.Vector3; endLow: number; roofY: number } {
  const b = l.cars[1]!;
  const roofY = b.group.position.y + crownY(b);
  throwPart(l, at, roofY + DROP, b.group.position.z, new THREE.Vector3(), rest);
  const middle = l.part.shape.centre.clone().applyQuaternion(l.part.object.quaternion).add(l.part.object.position);
  const top = highest(l.part);
  const onRoof = Math.abs(middle.x - b.group.position.x) < b.frame.half.x && top >= roofY - SKIN;
  const restSpeed = l.part.velocity.length();
  const o = l.part.object.position;
  throwPart(l, o.x, o.y, o.z, new THREE.Vector3(PUSH_V, 0, 0), slide);
  return { onRoof, middle, top, restSpeed, end: l.part.object.position.clone(), endLow: lowest(l.part), roofY };
}

describe("given a front bumper torn off a parked car and dropped 0.5 m onto the roof of a second car parked beside it", () => {
  it("when it lands, then it rests on the roof; when pushed across it at 5 m/s, then it slides off the roof's edge and comes to rest on the road", () => {
    const l = lot(true);
    const { onRoof, middle, top, restSpeed, end, endLow, roofY } = roofDrop(l, B_X, 1, OFF_ROOF_S);
    assert.ok(onRoof, `its middle at x ${(middle.x - B_X).toFixed(3)} m off B's, its top ${top.toFixed(3)} m up, roof crown ${roofY.toFixed(3)} m (a point ${SKIN} m under a top stands on it)`);
    assert.ok(restSpeed <= 2 * GRAVITY * H, `its speed resting on the roof: ${restSpeed.toFixed(4)} m/s, at most the jitter a step's gravity gives (${(2 * GRAVITY * H).toFixed(4)} m/s)`);
    const flank = B_X + l.cars[1]!.frame.half.x;
    assert.ok(end.x > flank, `ended at x ${end.x.toFixed(2)}, B's flank at ${flank.toFixed(2)}`);
    assert.ok(endLow >= -RESTS && endLow <= RESTS, `ended with its lowest point ${endLow.toFixed(3)} m over the road`);
    assert.equal(planSpeed(l.part), 0, "plan speed on the road");
  });
});

/** Car B pushed into the bumper lying beside it at this speed (m/s), toward A. */
const PUSH_INTO = 2;
/** Shoved by B at `PUSH_INTO` for a second, the bumper moves at least this far (m): B's flank carries it (0.53 m). */
const SHOVED = 0.3;

/** The parked cars settled with the bumper away (`SETTLE_X`), then the bumper woken, let down beside B's flank at `SLIDE_X` and left 2 s: it falls asleep within B's roof's reach. */
function besideB(): Lot {
  const l = lot(true);
  throwPart(l, SETTLE_X, 0.3, 0, new THREE.Vector3(), 1);
  l.part.shape.asleep = false;
  throwPart(l, SLIDE_X, 0.3, 0, new THREE.Vector3(), 2);
  return l;
}

/** Of `steps` world steps (`H`), how many had a slice step the bumper because something stirred it (`stirredBodies`). */
function stirredSteps(l: Lot, steps: number): number {
  const k = l.cars[0]!["parts"].indexOf(l.part);
  let n = 0;
  for (let s = 0; s < steps; s++) {
    stepWorld(l.w, H);
    if (l.cars[0]!.stirredBodies[k] !== 0) n++;
  }
  return n;
}

describe("given a front bumper torn off a parked car, asleep on the road a hand's width off the flank of a second car parked beside it (within its roof's reach)", () => {
  it("when the second car stays parked, then for 2 s no slice steps the bumper (a still roof is no stir) and its pose stays as it was", () => {
    const l = besideB();
    assert.ok(l.part.shape.asleep, "it fell asleep beside B");
    const at = l.part.object.position.clone();
    const turn = l.part.object.quaternion.clone();
    const n = stirredSteps(l, 2 * QUIET_HZ);
    assert.ok(n === 0, `stirred in ${n} of ${2 * QUIET_HZ} steps`);
    assert.ok(l.part.object.position.equals(at) && l.part.object.quaternion.equals(turn), `pose moved ${l.part.object.position.distanceTo(at)} m`);
  });

  it(`when the second car is pushed into it at ${PUSH_INTO} m/s, then the bumper wakes in the push's first step and is shoved at least ${SHOVED} m in a second`, () => {
    const l = besideB();
    const at = l.part.object.position.clone();
    l.cars[1]!.velocity.set(-PUSH_INTO, 0, 0);
    assert.equal(stirredSteps(l, 1), 1, "stirred in the push's first step");
    stirredSteps(l, QUIET_HZ - 1);
    const moved = l.part.object.position.distanceTo(at);
    assert.ok(moved >= SHOVED, `shoved ${moved.toFixed(3)} m`);
  });
});

/** A hood (the torn panel's own box: wide, long and thin) let go this high (m) over the road, tumbling. */
const HOOD_DROP = 1;
/** Within this long (s) it has settled. */
const SETTLES_S = 3;

/** The hood of a parked car, torn off, let go `HOOD_DROP` m up with a spin, run `SETTLES_S` s at steps of `dt`. */
function dropHood(dt: number): DetachPart {
  const l = lot(false);
  const hood = l.cars[0]!["parts"].find((p) => p.name === "hood")!;
  l.cars[0]!["detachPart"](hood, 0, new THREE.Vector3());
  hood.object.position.set(SLIDE_X, HOOD_DROP, 0);
  hood.velocity.set(0, 0, 0);
  hood.angular.set(2.5, 1.1, 3.1);
  for (let t = 0; t < SETTLES_S; t += dt) stepLoose(hood, dt, -1);
  return hood;
}

describe("given a torn hood let go a metre over the road, spinning", () => {
  it("when three seconds have passed, then its lowest point rests on the road (within a centimetre) and its thin axis is up", () => {
    const hood = dropHood(H);
    const up = thinAxisUp(hood);
    assert.ok(up > LIES_FLAT, `its thin axis is ${up.toFixed(3)} up`);
    const low = lowest(hood);
    assert.ok(low >= -1e-9 && low <= RESTS, `its lowest point is ${low.toFixed(4)} m over the road`);
  });

  it(`when a slab slides at 8 m/s along the road at steps of 1/${FRAME_HZ} s and of 1/${FINE_HZ} s, then the two slide as far as each other to within 5 %`, () => {
    const far = (dt: number): number => {
      const part = slab(0.15, new THREE.Vector3(0, 0, SLIDE_V));
      for (let t = 0; t < (2 * SLIDE_V) / (CRASH.muSlide * GRAVITY); t += dt) stepLoose(part, dt, -1);
      return part.object.position.z;
    };
    const coarse = far(1 / FRAME_HZ);
    const fine = far(1 / FINE_HZ);
    assert.ok(Math.abs(coarse - fine) <= 0.05 * fine, `${coarse.toFixed(3)} m at 1/${FRAME_HZ} s, ${fine.toFixed(3)} m at 1/${FINE_HZ} s`);
  });
});

/** A wall (a thin box prism 0.3 m thick, 12 m wide, 2 m high) across the road with its near face at z = `WALL_Z`. */
const WALL_Z = 5;
const WALL_HALF_THICK = 0.15;
/** The slab starts at z 0 (its depth is 0.5 m) so it has to slide `WALL_GAP` m before its front meets the wall's face. */
const WALL_GAP = WALL_Z - 0.25;
/** The speed (m/s) it is meant to arrive with: the road's sliding friction takes `2 μ g gap` off the square of its launch speed. */
const ARRIVES_AT = 6;
const WALL_LAUNCH = Math.sqrt(ARRIVES_AT * ARRIVES_AT + 2 * CRASH.muSlide * GRAVITY * WALL_GAP);

/** A slab launched at the wall's face along the road, `wall` armed or not: how far its front reaches (m) in 4 s. */
function slideToWall(wall: boolean): number {
  const walls = new Surface();
  walls.addPrism({ x: 0, z: WALL_Z + WALL_HALF_THICK, yaw: 0, hx: 6, hz: WALL_HALF_THICK, base: 0, top: 2, id: 0 });
  armSolids(wall ? walls : null);
  try {
    const part = slab(0.15, new THREE.Vector3(0, 0, WALL_LAUNCH));
    for (let t = 0; t < 4; t += H) stepLoose(part, H, -1);
    return farthest(part, new THREE.Vector3(0, 0, 1));
  } finally {
    armSolids(null);
  }
}

describe("given a torn part sliding along the road into a wall", () => {
  it("when it meets the wall at 6 m/s (the same launch with no wall slides on past the wall's face), then it stops at the wall: its far end is no more than a centimetre inside the wall's face", () => {
    const free = slideToWall(false);
    assert.ok(free > WALL_Z + WALL_HALF_THICK * 2, `with no wall the slab's front reaches z ${free.toFixed(3)} m, past the wall's back face at ${WALL_Z + 2 * WALL_HALF_THICK} m: the launch reaches the wall`);
    const reach = slideToWall(true);
    assert.ok(reach <= WALL_Z + RESTS, `its far end reached z ${reach.toFixed(3)} m, the wall's face is at ${WALL_Z} m`);
    // It bounces off the face at `RESTITUTION` of its closing speed and slides back until the road's friction stops it (the road's grip, not 1, scales μ: twice the grip-1 distance is the bound).
    const rebound = (RESTITUTION * ARRIVES_AT) ** 2 / (2 * CRASH.muSlide * GRAVITY);
    assert.ok(reach > WALL_Z - 2 * rebound, `its far end stopped at z ${reach.toFixed(3)} m, further from the wall's face (${WALL_Z} m) than a rebound slides (${rebound.toFixed(3)} m)`);
  });
});

/** Every car's whole sim state: pose, velocities, each mass, its faces' load crush, the drivetrain. */
function simState(cars: readonly DeformableCar[]): number[] {
  return cars.flatMap((c) => [
    ...c.group.position.toArray(),
    ...c.group.quaternion.toArray(),
    ...c.velocity.toArray(),
    ...c.angular.toArray(),
    ...c.deform.masses.flatMap((m) => [...m.world.toArray(), ...m.vel.toArray()]),
    ...c.deform.crush,
    c.deform.drivetrainAlive ? 1 : 0,
    c.deform.engineTravel,
  ]);
}

describe("given two cars parked side by side and a bumper torn off one (loose parts are cosmetic)", () => {
  it("when the bumper lands on the other car's roof and is pushed off it, then both cars' sim state is bit for bit what it is with the bumper lying on open road", () => {
    const onCar = lot(true);
    const away = lot(true);
    const { onRoof, top, roofY } = roofDrop(onCar, B_X, 1, 2);
    roofDrop(away, 40, 1, 2);
    assert.ok(onRoof, `the bumper rested on the roof (its top ${top.toFixed(3)} m up, crown ${roofY.toFixed(3)} m)`);
    assertSameDigest(simState(onCar.cars), simState(away.cars), "every car's sim state with the bumper on the roof vs on open road");
  });
});

/** A slab (`slab`) let settle on the road: three seconds at `H`. */
function settled(): LooseBody {
  const part = slab(0.15, new THREE.Vector3(0, 0, 0));
  for (let t = 0; t < 3; t += H) stepLoose(part, H, -1);
  return part;
}

describe("given a torn part at rest on the road", () => {
  it("when nothing is near, then it sleeps and a step leaves its pose as it was", () => {
    const part = settled();
    assert.ok(part.shape.asleep, "it fell asleep");
    const at = part.object.position.clone();
    const turn = part.object.quaternion.clone();
    // Asleep it is not asked what is under it: the road dropped 20 m away leaves it where it lay.
    setGround(new RaisedRoad(-20));
    try {
      for (let k = 0; k < 60; k++) stepLoose(part, H, -1);
    } finally {
      setGround(null);
    }
    assert.ok(part.object.position.equals(at) && part.object.quaternion.equals(turn), "pose unchanged over a second");
    assert.ok(part.shape.asleep, "still asleep");
  });

  it("when a hit gives it speed, then it wakes and leaves the road", () => {
    const part = settled();
    const y = part.object.position.y;
    part.velocity.set(0, 3, 0);
    stepLoose(part, H, -1);
    assert.ok(!part.shape.asleep && part.object.position.y > y + 0.01, `woke and rose ${(part.object.position.y - y).toFixed(3)} m`);
  });

  it("when a moving solid is far, then it sleeps on, and when the solid is moved onto it, then it wakes and is put out of it", () => {
    const solids = new Surface();
    const plate = solids.addPrism({ x: 30, z: 30, yaw: 0, hx: 1, hz: 1, base: 0, top: 2, id: 0, moves: true });
    armSolids(solids);
    try {
      const part = settled();
      const at = part.object.position.clone();
      solids.movePrism(plate, 10, 10, 0, 0, 0);
      stepLoose(part, H, -1);
      assert.ok(part.shape.asleep, "a solid 10 m away leaves it asleep");
      solids.movePrism(plate, at.x + 0.9, at.z, 0, 0, 0);
      stepLoose(part, H, -1);
      assert.ok(part.object.position.distanceTo(at) > 0.05, `moved ${part.object.position.distanceTo(at).toFixed(3)} m`);
    } finally {
      armSolids(null);
    }
  });
});

/** The posts under a bumper-sized slab (`slab`): one under the middle of each end (x = ±0.85 m), so each meets one of its points. */
const POST_X = 0.85;
const POST_TOP = 0.5;
/** A post's half side (m): thin enough that no other point of the slab's ends stands over it. */
const POST_HALF = 0.03;
/** A roll (rad/s) about the line between the posts, under rest speed: from it the slab tips off them. */
const ROCK = 0.01;

/** The slab laid level across the posts, rolling at `rock` about the line between them, stepped `seconds`: when it first slept (s, -1: never) and its lowest point (m). */
function onPosts(rock: number, seconds: number): { sleptAt: number; low: number } {
  const solids = new Surface();
  for (const sx of [-1, 1]) solids.addPrism({ x: sx * POST_X, z: 0, yaw: 0, hx: POST_HALF, hz: POST_HALF, base: 0, top: POST_TOP, id: sx < 0 ? 0 : 1 });
  armSolids(solids);
  try {
    const part = slab(POST_TOP + 0.15, new THREE.Vector3());
    part.angular.set(rock, 0, 0);
    let sleptAt = -1;
    for (let t = 0; t < seconds; t += H) {
      stepLoose(part, H, -1);
      if (part.shape.asleep && sleptAt < 0) sleptAt = t + H;
    }
    return { sleptAt, low: lowest(part) };
  } finally {
    armSolids(null);
  }
}

describe("given a torn bumper laid level across two posts, one under the middle of each end (two points, its weight over the line between them)", () => {
  it("when it is left still, then it sleeps where it lies within two seconds", () => {
    const { sleptAt, low } = onPosts(0, 2);
    assert.ok(sleptAt > 0, "it fell asleep on the posts");
    assert.ok(Math.abs(low - POST_TOP) < RESTS, `lowest point ${low.toFixed(3)} m, the posts' top ${POST_TOP} m`);
  });

  it("when it rolls at 0.01 rad/s about the line between the posts, then it does not sleep on them: it tips off and comes to rest on the road", () => {
    const { sleptAt, low } = onPosts(ROCK, 3);
    assert.ok(sleptAt > 0, "it fell asleep");
    assert.ok(Math.abs(low) < RESTS, `lowest point ${low.toFixed(3)} m over the road (the posts' top ${POST_TOP} m)`);
  });
});

describe("given a body with unequal inertias turned to any orientation", () => {
  it("when a vector goes through its world-frame inverse inertia, then it is what the body-frame inertia gives it turned to the world and back (within 1e-9)", () => {
    const shape = newLooseShape();
    shape.invI.set(3.1, 0.7, 1.9);
    let seed = 12345;
    const next = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
    let worst = 0;
    for (let k = 0; k < 100; k++) {
      const q = new THREE.Quaternion(next(), next(), next(), next() + 1.5).normalize();
      const x = new THREE.Vector3(next(), next(), next());
      const turn = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
      const want = x.clone().applyMatrix3(turn.clone().transpose()).multiply(shape.invI).applyMatrix3(turn);
      worst = Math.max(worst, invInertia(x.clone(), q, q.clone().invert(), shape.invI).distanceTo(want));
    }
    assert.ok(worst < 1e-9, `worst miss ${worst} over 100 orientations`);
  });
});

describe("given a front bumper torn off a car with no linear velocity spinning at 3 rad/s about y", () => {
  const SPIN = 3;
  /** The car spinning at `spin` rad/s about y, its bumper torn off with `push` (or the crash launch, undefined) at `impulse`; and where the bumper is about the car's centre of mass. */
  function tear(spin: number, push: THREE.Vector3 | undefined, impulse: number): { part: DetachPart; r: THREE.Vector3 } {
    const car = new DeformableCar(paint(), new THREE.Scene());
    car.spawnFacing(0, 0, 0, 0);
    car.angular.set(0, spin, 0);
    const part = car["parts"].find((p) => p.name === "bumperF")!;
    car["detachPart"](part, impulse, push);
    const com = new THREE.Vector3(0, car.frame.comY, 0).applyQuaternion(car.group.quaternion).add(car.group.position);
    return { part, r: part.object.position.clone().sub(com) };
  }

  it("when it is torn off with no kick, then it leaves at ω × r about the car's centre of mass: along +x for a bumper ahead of it", () => {
    const { part, r } = tear(SPIN, new THREE.Vector3(), 0);
    const want = new THREE.Vector3(0, SPIN, 0).cross(r);
    assert.ok(part.velocity.distanceTo(want) < 1e-9, `velocity ${part.velocity.toArray()} vs ω × r ${want.toArray()}`);
    assert.ok(part.velocity.x > 4, `a bumper ${r.z.toFixed(2)} m ahead of the centre is flung sideways at ${part.velocity.x.toFixed(2)} m/s`);
  });

  it("when it is torn off by the crash launch, then it leaves with the car's spin on top of the tumble and ω × r on top of the launch, as against the same car at rest", () => {
    const spun = tear(SPIN, undefined, 20);
    const still = tear(0, undefined, 20);
    const turn = new THREE.Vector3(0, SPIN, 0);
    assert.ok(spun.part.angular.distanceTo(still.part.angular.clone().add(turn)) < 1e-9, `spin ${spun.part.angular.toArray()} vs ${still.part.angular.toArray()} + ${turn.toArray()}`);
    const carried = spun.part.velocity.clone().sub(still.part.velocity);
    assert.ok(carried.distanceTo(turn.clone().cross(spun.r)) < 0.5, `carried ${carried.toArray()} vs ω × r ${turn.clone().cross(spun.r).toArray()}`);
    assert.ok(carried.x > 4, `carried ${carried.x.toFixed(2)} m/s sideways`);
  });
});

/** The speed (m/s) the owner's flagged clip's torn arch slid flat on the Mall's lawn at, for 2.6 s. */
const TORN_AT = 31;
/** A part's lowest point this high (m) over the road has left it. */
const LIFTED = 0.05;

/** Part `name` torn off a parked car and laid flat on the road (its box's thinnest axis up), sliding at `speed` along +z turned `yawDeg` toward +x. */
function laidFlat(name: string, speed: number, yawDeg = 0): DetachPart {
  const car = new DeformableCar(paint(), new THREE.Scene());
  car.spawnFacing(0, 0, 0, 0);
  const part = car["parts"].find((p) => p.name === name)!;
  car["detachPart"](part, 0, new THREE.Vector3());
  boxShape(part.shape, part.object);
  const h = part.shape.half.toArray();
  const thin = h[0]! <= h[1]! && h[0]! <= h[2]! ? 0 : h[1]! <= h[2]! ? 1 : 2;
  part.object.quaternion.setFromUnitVectors(new THREE.Vector3(thin === 0 ? 1 : 0, thin === 1 ? 1 : 0, thin === 2 ? 1 : 0), new THREE.Vector3(0, 1, 0));
  part.object.position.set(0, 0, 0);
  part.object.position.y -= lowest(part) - 0.001;
  const yaw = (yawDeg * Math.PI) / 180;
  part.velocity.set(speed * Math.sin(yaw), 0, speed * Math.cos(yaw));
  part.angular.set(0, 0, 0);
  part.shape.airborne = false;
  return part;
}

/** One slice of `part` as its car steps it (`stepLooseParts`): the wind on it at its mass. */
function stepTorn(part: DetachPart): void {
  stepLoose(part, H, -1, undefined, undefined, partMass(part));
}

describe(`given a torn sheet panel lying flat on the road, sliding at ${TORN_AT} m/s`, () => {
  const testCases = [
    { it: "when it slides, then the arch flare leaves the flat slide within a second, and at 2.6 s it has lost more than half its speed", part: "archFL" },
    { it: "when it slides, then the quarter panel leaves the flat slide within a second, and at 2.6 s it has lost more than half its speed", part: "quarterL" },
    { it: "when it slides, then the hood leaves the flat slide within a second, and at 2.6 s it has lost more than half its speed", part: "hood" },
    { it: "when it slides, then the trunk lid leaves the flat slide within a second, and at 2.6 s it has lost more than half its speed", part: "trunk" },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const part = laidFlat(testCase.part, TORN_AT);
      let left = Infinity;
      for (let t = H; t <= 2.6 + H / 2; t += H) {
        stepTorn(part);
        if (left === Infinity && (thinAxisUp(part) < LIES_FLAT || lowest(part) > LIFTED)) left = t;
      }
      assert.ok(left <= 1, `it left the flat slide (tilted past ${LIES_FLAT} or rose ${LIFTED} m) at ${left.toFixed(2)} s`);
      assert.ok(part.velocity.length() < TORN_AT / 2, `speed at 2.6 s: ${part.velocity.length().toFixed(1)} m/s`);
    });
  }

  it("when a door (a sheet five times as heavy for its size) slides so, then it stays flat: the wind over it cannot carry its weight at that speed", () => {
    const door = laidFlat("doorL", TORN_AT);
    let flattest = 1;
    for (let t = H; t <= 1 + H / 2; t += H) {
      stepTorn(door);
      flattest = Math.min(flattest, thinAxisUp(door));
    }
    assert.ok(flattest >= LIES_FLAT, `its thin axis turned to ${flattest.toFixed(3)} of up`);
    assert.ok(lowest(door) <= RESTS, `its lowest point is ${lowest(door).toFixed(3)} m over the road`);
  });
});

/** A 0.5 m stone kerb (the Mall pool's rim) across the road, its face at z `KERB_Z`. */
const KERB_Z = 3;
/** The share of its speed a panel keeps 0.05 s after meeting the kerb: `RESTITUTION` of the closing, less the road's friction over that time and, at 30°, the slide along the face the hit stops. */
const KERB_KEEPS = 0.15;
/** The arch flare's meets swept for a dead stop (the owner's report JRB7-K38W: torn panels stopped dead on a kerb): speeds (m/s) by yaws (°). */
const SWEEP_SPEEDS = [14, 16, 17, 18, 19, 20, 22] as const;
const SWEEP_YAWS = [20, 30, 40] as const;

/**
 * Torn part `name` laid flat on the road, sliding at `speed` m/s turned `yawDeg` into a 0.5 m kerb: its speed as its farthest point meets the
 * kerb's face (`before`), its speed and its velocity along z (+ on toward the kerb) 0.05 s after (`after`, `away`).
 */
function kerbMeet(name: string, speed: number, yawDeg: number): { before: number; after: number; away: number } {
  const kerb = new Surface();
  kerb.addPrism({ x: 0, z: KERB_Z + 0.75, yaw: 0, hx: 20, hz: 0.75, base: 0, top: 0.5, id: 0 });
  armSolids(kerb);
  try {
    const part = laidFlat(name, speed, yawDeg);
    part.object.position.z = KERB_Z - 0.3 - part.shape.reach;
    let before = NaN;
    let after = NaN;
    let away = NaN;
    let hitAt = Infinity;
    for (let t = H; t <= 1 && Number.isNaN(after); t += H) {
      const now = part.velocity.length();
      stepTorn(part);
      if (hitAt === Infinity && farthest(part, new THREE.Vector3(0, 0, 1)) >= KERB_Z - 0.02) {
        hitAt = t;
        before = now;
      }
      if (t >= hitAt + 0.05) {
        after = part.velocity.length();
        away = part.velocity.z;
      }
    }
    return { before, after, away };
  } finally {
    armSolids(null);
  }
}

describe("given a torn panel lying flat on the road, sliding into a 0.5 m kerb", () => {
  const testCases = [
    { it: "when the arch flare meets it square at 15 m/s, then it bounces back off it", part: "archFL", speed: 15, yawDeg: 0 },
    { it: "when the quarter panel meets it square at 15 m/s, then it bounces back off it", part: "quarterL", speed: 15, yawDeg: 0 },
    { it: "when the quarter panel meets it square at 21 m/s, then it bounces back off it", part: "quarterL", speed: 21, yawDeg: 0 },
    { it: "when the quarter panel meets it at 30° and 18 m/s, then it bounces back off it", part: "quarterL", speed: 18, yawDeg: 30 },
  ] as const;
  for (const testCase of testCases) {
    it(`${testCase.it}, keeping at least ${KERB_KEEPS} of its speed`, () => {
      const { before, after, away } = kerbMeet(testCase.part, testCase.speed, testCase.yawDeg);
      assert.ok(after >= KERB_KEEPS * before, `${after.toFixed(2)} m/s 0.05 s after meeting it at ${before.toFixed(2)} m/s`);
      assert.ok(away < 0, `moving ${away.toFixed(2)} m/s along z: away from the kerb`);
    });
  }

  // As its drawn shell (ticket B) the arch flare's curved leading edge rides the kerb's face: at an angle it bounces back or vaults the kerb
  // by the slice it meets it in (as its box, union 44ab48b3, it bounced back at all of these). Either is what the owner asked for: it does
  // not stop dead there.
  it(`when the arch flare meets it at ${SWEEP_SPEEDS.join(", ")} m/s and ${SWEEP_YAWS.join(", ")}°, then it never stops dead at it: it bounces back or vaults it, keeping at least ${KERB_KEEPS} of its speed`, (t) => {
    const dead: string[] = [];
    const rows: string[] = [];
    for (const speed of SWEEP_SPEEDS) {
      for (const yaw of SWEEP_YAWS) {
        const { before, after, away } = kerbMeet("archFL", speed, yaw);
        rows.push(`${speed}/${yaw}: ${before.toFixed(2)} -> ${after.toFixed(2)} m/s, ${away < 0 ? "back" : "over"} (${away.toFixed(2)} along z)`);
        if (!(after >= KERB_KEEPS * before)) dead.push(`${speed} m/s at ${yaw}°: ${after.toFixed(2)} m/s 0.05 s after meeting it at ${before.toFixed(2)}`);
      }
    }
    t.diagnostic(rows.join("; "));
    assert.deepEqual(dead, []);
  });
  // The arch flare square at 21 m/s, as its box (ticket B): a knife edge in the slice it meets the kerb at. The 0.375 m arch (CarSedan
  // 20334982) vaults it at exactly 21 m/s (0.05 s on: 7.72 m/s up, 0.14 m/s on toward it, 17.5 rad/s) and bounces back at 19, 20, 20.5,
  // 21.5, 22 and 23; the 0.405 m arch bounced back at all seven.
  it.todo("when the arch flare meets it square at 21 m/s, then it bounces back off it at every speed about it, as its drawn U");
});
