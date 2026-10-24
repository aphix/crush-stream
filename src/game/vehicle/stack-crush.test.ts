import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { FLIGHT } from "./car-flight.ts";
import { paint } from "./test-support.ts";
import { makeWorld, tickWorld, type CrashWorld } from "../contact/crash-scenarios.test-util.ts";
import { FACE_LEFT, FACE_NOSE, FACE_RIGHT, FACE_TAIL, FACE_TOP, faceMax, faceStrength, IMPRINT_NONE } from "../deform/load-crush.ts";
import { crownY, keelY } from "./car-cage-rig.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { assignClass, STYLE_CLASS } from "./vehicle-classes.ts";
import type { CarStyleId } from "./car-variants.ts";

/**
 * Load crush (docs/LOAD_CRUSH.md): a face yields under the load on it, so a stack of cars crushes each roof by the
 * weight above it, and a car dropped on its roof, nose, tail or flank crushes that face by its own weight and drop.
 * Headless, through the engine's own step (`stepWorld`), on the flat pad.
 */
/** Belly-to-roof gap of a car above (m): its belly starts this far over the drawn roof of the car below. */
const GAP = 0.02;
/** What a stack is built of: the car, whether each is turned 180° from the one under it, and whether it is read once the roofs stop crushing (else once every car stands still). */
interface StackRig {
  readonly style: CarStyleId;
  readonly turn: boolean;
  readonly still: boolean;
}
/** The stacks of the crush claims: wagons, whose long flat roof carries the car above, each turned from the one under it (an aligned stack of the sedan, whose roof sits 0.45 m behind its belly pan, leans). */
const WAGONS: StackRig = { style: "wagon", turn: true, still: false };
/** The pair of the stillness row: aligned sedans, read once both stand still. */
const SEDAN_PAIR: StackRig = { style: "sedan", turn: false, still: true };
/** A stack has settled once no roof's crush moves `SETTLE_SINK` in `STILL_S`: the crush the claims read is done. It has done so within this many seconds of the drop (measured about 1 s). */
const SETTLE_S = 8;
const SETTLE_SINK = 1e-3;
/** The pair's top car ends every frame under this speed plus spin (a belly rest, not a gravity step short of it). */
const STILL_SPEED = 1e-3;
const STILL_S = 0.5;

function makeCar(style: CarStyleId): DeformableCar {
  const c = new DeformableCar(paint(), new THREE.Scene(), null, style);
  assignClass(c, STYLE_CLASS[style]);
  return c;
}

/** Run `w` until no roof's crush moves `SETTLE_SINK` over `STILL_S`: the stack the claims are about has crushed what it will. One whose roofs keep crushing fails here, not as a wrong number below. */
function settle(w: CrashWorld, cars: readonly DeformableCar[], hz: number): void {
  let from = cars.map(roofSink);
  for (let f = 1; f <= SETTLE_S * hz; f++) {
    tickWorld(w, 1 / hz);
    if (f % Math.round(STILL_S * hz) !== 0) continue;
    const now = cars.map(roofSink);
    if (now.every((s, i) => Math.abs(s - from[i]!) < SETTLE_SINK)) return;
    from = now;
  }
  throw new Error(`the roofs were still crushing after ${SETTLE_S} s`);
}

/** Run `w` until every car's speed and spin stay under `STILL_SPEED` for `STILL_S`: the pair the stillness row reads. One that never does fails here, not as a wrong number below. */
function settleStill(w: CrashWorld, cars: readonly DeformableCar[], hz: number): void {
  let still = 0;
  for (let f = 0; f < SETTLE_S * hz; f++) {
    tickWorld(w, 1 / hz);
    still = cars.some((c) => c.velocity.length() + c.angular.length() > STILL_SPEED) ? 0 : still + 1;
    if (still >= STILL_S * hz) return;
  }
  throw new Error(`the stack did not stand still within ${SETTLE_S} s`);
}

/** How far (m) the car's roof mass stands under its own rest height. */
function roofSink(c: DeformableCar): number {
  return c.roofRestY - c.deform.massLocal("roof").y;
}

function run(w: CrashWorld, seconds: number, hz = 60): void {
  for (let f = 0; f < seconds * hz; f++) tickWorld(w, 1 / hz);
}

/** `n` cars one above the other, bottom first: the bottom on the ground, the rest falling from `GAP` over the drawn roof below. */
function stack(n: number, hz = 60, rig: StackRig = WAGONS): { cars: DeformableCar[]; w: CrashWorld } {
  const cars: DeformableCar[] = [];
  for (let i = 0; i < n; i++) {
    const c = makeCar(rig.style);
    c.spawnFacing(0, 0, rig.turn && i % 2 === 1 ? Math.PI : 0, 0);
    if (i > 0) {
      const under = cars[i - 1]!;
      c.group.position.y = under.group.position.y + crownY(under) - keelY(c) + GAP;
    }
    c.airborne = i > 0;
    c.parked = true;
    cars.push(c);
  }
  const w = makeWorld(cars, false, false);
  if (rig.still) settleStill(w, cars, hz);
  else settle(w, cars, hz);
  return { cars, w };
}

/** One car `h` m over the ground (its lowest drawn point), turned (pitch, yaw, roll) as given, then dropped. */
const ORIENT: Record<"roof" | "nose" | "tail" | "left" | "right" | "corner", [number, number, number]> = {
  roof: [0, 0, Math.PI],
  nose: [Math.PI / 2, 0, 0],
  tail: [-Math.PI / 2, 0, 0],
  left: [0, 0, Math.PI / 2],
  right: [0, 0, -Math.PI / 2],
  corner: [Math.PI / 3, 0, Math.PI / 4],
};
function drop(kind: keyof typeof ORIENT, h: number, hz = 60): DeformableCar {
  const c = new DeformableCar(paint(), new THREE.Scene());
  c.spawnFacing(0, 0, 0, 0);
  const [rx, ry, rz] = ORIENT[kind];
  c.group.rotation.set(rx, ry, rz, "YXZ");
  c.group.updateMatrixWorld(true);
  c.group.position.y += h - new THREE.Box3().setFromObject(c.group).min.y;
  c.airborne = true;
  c.parked = true;
  run(makeWorld([c], false, false), 5, hz);
  return c;
}

const _roofMid = new THREE.Vector3();
/** The stack's claims (a settled stack, and again 5 s on): each roof crushed more than the one above it, the top car's roof not at all, the bottom roof in the FMVSS 216 band, the base car where it was set, and every other car still on the roof under it. */
function assertStands(cars: readonly DeformableCar[]): void {
  const sink = cars.map(roofSink);
  for (let i = 1; i < 4; i++) assert.ok(sink[i - 1]! > sink[i]! + 0.02, `car ${i - 1} (${sink[i - 1]!.toFixed(3)} m) is not under a clearly worse roof than car ${i} (${sink[i]!.toFixed(3)} m)`);
  assert.ok(sink[3]! < 0.002, `the top car's roof is crushed ${sink[3]!.toFixed(3)} m with nothing on it`);
  assert.ok(sink[0]! > 0.12 && sink[0]! < 0.26, `the bottom roof took ${sink[0]!.toFixed(3)} m under three cars (FMVSS 216 band: 0.12-0.26 m with the drop's overshoot)`);
  assert.ok(Math.hypot(cars[0]!.group.position.x, cars[0]!.group.position.z) < 0.02, `the base car slid ${Math.hypot(cars[0]!.group.position.x, cars[0]!.group.position.z).toFixed(3)} m on the pad`);
  // A car stands while its origin is within half the roof's length of the middle of the roof under it (the lower roof's `roofZ` span, turned with the car).
  for (let i = 1; i < 4; i++) {
    const lower = cars[i - 1]!;
    const [rear, front] = lower.style.roofZ;
    _roofMid.set(0, 0, 0.5 * (rear + front)).applyQuaternion(lower.group.quaternion).add(lower.group.position);
    const off = Math.hypot(cars[i]!.group.position.x - _roofMid.x, cars[i]!.group.position.z - _roofMid.z);
    assert.ok(off < 0.5 * (front - rear), `car ${i} stands ${off.toFixed(3)} m from the middle of the roof under it, which carries it within ${(0.5 * (front - rear)).toFixed(3)} m`);
  }
}

describe("given a stack of cars dropped one on the next on the flat pad, each roof yielding under the weight above it", () => {
  it("when a stack of four settles, then each roof is crushed more than the one above it, the top car's roof not at all, the bottom roof 0.12 to 0.26 m, every car still stands on the roof under it, and the stack still stands so 5 s on", () => {
    const { cars, w } = stack(4);
    assertStands(cars);
    run(w, 5);
    assertStands(cars);
  });

  it("when the stack has two, three and four cars, then the bottom roof is crushed more with each car added, so it takes the weight above it and not just the car on it", () => {
    const bottom = [2, 3, 4].map((n) => roofSink(stack(n).cars[0]!));
    assert.ok(bottom[0]! > 0.02, `one car on a roof crushed it ${bottom[0]!.toFixed(3)} m`);
    assert.ok(bottom[1]! > bottom[0]! + 0.02 && bottom[2]! > bottom[1]! + 0.02, `bottom roof under 1, 2, 3 cars: ${bottom.map((b) => b.toFixed(3)).join(", ")} m`);
  });

  it("when a stack of four settles while simulated at 60, 144 and 240 Hz, then every roof is crushed the same amount at all three rates", () => {
    const sinks = [60, 144, 240].map((hz) => stack(4, hz).cars.map(roofSink));
    for (let i = 0; i < 3; i++) {
      const v = sinks.map((s) => s[i]!);
      assert.ok(Math.max(...v) - Math.min(...v) < 0.04 * Math.max(...v) + 0.002, `car ${i}'s roof at 60/144/240 Hz: ${v.map((x) => x.toFixed(3)).join(" / ")} m`);
    }
  });

  it("when a settled stack of four is restored from a clip keyframe into fresh cars, then the roofs show the crush they had live, carry on from it for 3 s, and the crushed cars are wrecks", () => {
    const { cars: live, w } = stack(4);
    assert.ok(live.slice(0, 3).every((c) => c.crashed), "a load-crushed car is not a wreck (it would not ride the replay's and netplay's wreck sections)");
    // The keyframe: pose, flight and solver state of each car (`engine-record` writes the same three), into fresh cars.
    const restored = live.map((src) => {
      const c = makeCar(WAGONS.style);
      c.spawnFacing(0, 0, 0, 0);
      const sim = new Float64Array(src.solverSize());
      src.solverState(sim, false);
      const flight = new Float64Array(FLIGHT);
      src.flight(flight, 0, false);
      c.group.position.copy(src.group.position);
      c.group.quaternion.copy(src.group.quaternion);
      c.velocity.copy(src.velocity);
      c.angular.copy(src.angular);
      c.crashed = src.crashed;
      c.solverState(sim, true);
      c.flight(flight, 0, true);
      c.refreshBasis();
      return c;
    });
    for (const [i, c] of live.entries()) assert.ok(Math.abs(roofSink(restored[i]!) - roofSink(c)) < 0.0005, `car ${i}: restored roof ${roofSink(restored[i]!).toFixed(4)} m, live ${roofSink(c).toFixed(4)} m`);
    const rw = makeWorld(restored, false, false);
    run(w, 3);
    run(rw, 3);
    for (const [i, c] of live.entries()) assert.ok(Math.abs(roofSink(restored[i]!) - roofSink(c)) < 0.002, `car ${i} 3 s on: restored roof ${roofSink(restored[i]!).toFixed(4)} m, live ${roofSink(c).toFixed(4)} m`);
  });
});

describe("given one car resting on another car's roof by its belly", () => {
  it("when the pair has settled, then the top car ends every frame of the next 3 s at rest, not one slice of gravity short of it", () => {
    const { cars, w } = stack(2, 60, SEDAN_PAIR);
    let fastest = 0;
    for (let f = 0; f < 180; f++) {
      tickWorld(w, 1 / FRAME_HZ);
      fastest = Math.max(fastest, cars[1]!.velocity.length() + cars[1]!.angular.length());
    }
    assert.ok(fastest < STILL_SPEED, `the top car ends a frame at ${fastest.toExponential(2)} (speed plus spin)`);
  });
});

describe("given a car dropped onto one of its faces on the flat pad", () => {
  it("when it is dropped upside-down from 0.5, 1 and 2 m, then the roof crushes at 0.5 m, crushes more from higher, and no further than its packed depth", () => {
    const sink = [0.5, 1, 2].map((h) => roofSink(drop("roof", h)));
    assert.ok(sink[0]! > 0.1, `0.5 m onto the roof crushed it ${sink[0]!.toFixed(3)} m`);
    assert.ok(sink[1]! > sink[0]! + 0.03 && sink[2]! > sink[1]! + 0.03, `roof crush from 0.5 / 1 / 2 m: ${sink.map((s) => s.toFixed(3)).join(" / ")} m`);
    assert.ok(sink[2]! <= faceMax(FACE_TOP) + 0.001, `the roof crushed ${sink[2]!.toFixed(3)} m past its packed depth ${faceMax(FACE_TOP)} m`);
  });

  it("when it is dropped from 1 m on its nose, tail, left flank, right flank or a corner, then the struck face crushes and the opposite face does not", () => {
    const nose = drop("nose", 1).deform.crush;
    assert.ok(nose[FACE_NOSE]! > 0.02 && nose[FACE_TAIL] === 0, `nose drop: nose ${nose[FACE_NOSE]!.toFixed(3)} m, tail ${nose[FACE_TAIL]!.toFixed(3)} m`);
    const tail = drop("tail", 1).deform.crush;
    assert.ok(tail[FACE_TAIL]! > 0.02 && tail[FACE_NOSE] === 0, `tail drop: tail ${tail[FACE_TAIL]!.toFixed(3)} m, nose ${tail[FACE_NOSE]!.toFixed(3)} m`);
    const left = drop("left", 1).deform.crush;
    assert.ok(left[FACE_LEFT]! > 0.04 && left[FACE_RIGHT] === 0, `left drop: left ${left[FACE_LEFT]!.toFixed(3)} m, right ${left[FACE_RIGHT]!.toFixed(3)} m`);
    const right = drop("right", 1).deform.crush;
    assert.ok(right[FACE_RIGHT]! > 0.04 && right[FACE_LEFT] === 0, `right drop: right ${right[FACE_RIGHT]!.toFixed(3)} m, left ${right[FACE_LEFT]!.toFixed(3)} m`);
    const corner = drop("corner", 1).deform.crush;
    assert.ok(corner[FACE_NOSE]! + corner[FACE_LEFT]! + corner[FACE_RIGHT]! > 0.02 && corner[FACE_TAIL] === 0, `corner drop (nose, left): ${Array.from(corner, (x) => x.toFixed(3)).join(" / ")} m`);
  });

  it("when it is dropped on its nose and on its left flank from 0.5, 1 and 2 m, then the struck face crushes more from each higher drop", () => {
    for (const kind of ["nose", "left"] as const) {
      const face = kind === "nose" ? FACE_NOSE : FACE_LEFT;
      const d = [0.5, 1, 2].map((h) => drop(kind, h).deform.crush[face]!);
      assert.ok(d[1]! > d[0]! && d[2]! > d[1]!, `${kind} crush from 0.5 / 1 / 2 m: ${d.map((x) => x.toFixed(3)).join(" / ")} m`);
    }
  });
});

/** How far (m) past the roof's packed depth its drawn top may sink: the imprint's own reach over the roof. */
const DRAWN_SLACK = 0.05;
/** Plan offset (m) of a car set down on a standing car's spot: the strip bench's slots 22 and 26 stood 23 and 19 mm apart, level, when 26's roof took an imprint plane 0.90 m under its crown from 22's belly (headless, 21.5 s after the staged crash). */
const SAME_SPOT_M = 0.02;

/** How far (m) the drawn body's top stands under its rest top once the owed skin is written: what a crushed roof leaves drawn. */
function drawnTopSink(c: DeformableCar): number {
  c.updateSkin();
  const pos = c.body.geometry.getAttribute("position").array as Float32Array;
  const rest = c.deform.restSkin;
  let top = -Infinity;
  let restTop = -Infinity;
  for (let i = 1; i < pos.length; i += 3) {
    top = Math.max(top, pos[i]!);
    restTop = Math.max(restTop, rest[i]!);
  }
  return restTop - top;
}

describe("given a car's roof another car presses, which takes the belly's imprint for good", () => {
  it("when a car settles on its roof, then the roof takes the imprint and its drawn top sinks no further than the roof's packed depth", () => {
    const lower = stack(2).cars[0]!;
    assert.notEqual(lower.deform.imprint[0], IMPRINT_NONE, "the control: a belly resting on the roof imprints it");
    const sink = drawnTopSink(lower);
    assert.ok(sink > 0.01 && sink <= faceMax(FACE_TOP) + DRAWN_SLACK, `the drawn roof sank ${sink.toFixed(3)} m`);
  });

  it("when a second car is set down on a wreck's spot, the second's belly inside its body, then the wreck's roof face is pressed but takes no imprint and its drawn top sinks no further than the roof's packed depth: a body inside the car is no belly on its roof, and the roof cut to it left the cabin open", () => {
    const struck = new DeformableCar(paint(), new THREE.Scene());
    struck.spawnFacing(0, 0, 0, 0);
    struck.crashed = true;
    const placed = new DeformableCar(paint(), new THREE.Scene());
    placed.spawnFacing(SAME_SPOT_M, SAME_SPOT_M, 0, 0);
    run(makeWorld([struck, placed], false, false), 0.25);
    assert.ok(struck.deform.crush[FACE_TOP]! > 0, "the control: the belly inside the body pressed the roof's face");
    const sink = drawnTopSink(struck);
    assert.ok(sink <= faceMax(FACE_TOP) + DRAWN_SLACK, `the drawn roof sank ${sink.toFixed(3)} m (imprint plane ${struck.deform.imprint[0]!.toFixed(3)} m)`);
    assert.equal(struck.deform.imprint[0], IMPRINT_NONE, `the roof took an imprint plane at ${struck.deform.imprint[0]!.toFixed(3)} m`);
  });
});

describe("given the roof's strength law (the load a roof carries at each crush depth, in car weights)", () => {
  it("when the strength is read at 127 mm and at the depths where 1, 2 and 3 car weights settle, then it carries 3 car weights at 127 mm (the FMVSS 216 roof test), 1, 2 and 3 settle at 31, 81 and 122 mm, and it is unbounded at its packed depth", () => {
    assert.ok(faceStrength(FACE_TOP, 0.127) >= 3 && faceStrength(FACE_TOP, 0.127) < 3.5, `strength at 127 mm: ${faceStrength(FACE_TOP, 0.127).toFixed(2)} W`);
    for (const [w, d] of [[1, 0.031], [2, 0.081], [3, 0.122]] as const) assert.ok(Math.abs(faceStrength(FACE_TOP, d) - w) < 0.03, `${w} W settles at ${d} m, strength there ${faceStrength(FACE_TOP, d).toFixed(3)} W`);
    assert.equal(faceStrength(FACE_TOP, faceMax(FACE_TOP)), Infinity);
  });
});
