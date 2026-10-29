import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { beginFakeFall, type DeformableCar } from "./car.ts";
import { FREEWHEEL, makeCar, makeWorld, runPair, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { carFellOffRim, edgeAction, FLEET_MIN_SEP, fleetEmptied, layoutFleet, respawnSlot, RESPAWN_S } from "../scenes/fleet.ts";
import { DISC_GROUND, DISC_RADIUS, FLAT_GROUND, setGround, type Ground } from "../world/ground.ts";
import { mulberry32 } from "../world/placements.ts";
import { assertSameDigest, assertSameNumbers } from "./test-support.ts";

const G_FRAME2 = 9.6 / 3600;

/** Car at (x, 0) heading +X at `vx` m/s; a wreck (`wreck`) moves on its masses. */
function launch(x: number, vx: number, wreck: boolean): DeformableCar {
  const car = makeCar("shape");
  car.spawnFacing(x, 0, Math.PI / 2, 0);
  car.velocity.set(vx, 0, 0);
  car.speed = vx;
  car.spawnSpeed = vx;
  car.deform.bindKinematic(car.group, car.velocity, car.angular);
  if (wreck) car.deform.armMasses(car.group, car.velocity, car.angular);
  return car;
}

/** Worst change (m) of any mass-pair distance from rest: how far the body is bent or stretched. */
function shapeErr(car: DeformableCar): number {
  const ms = car.deform.masses;
  let worst = 0;
  for (let i = 0; i < ms.length; i++) {
    for (let j = i + 1; j < ms.length; j++) {
      worst = Math.max(worst, Math.abs(ms[i]!.world.distanceTo(ms[j]!.world) - ms[i]!.rest.distanceTo(ms[j]!.rest)));
    }
  }
  return worst;
}

/** Every mass and group position, frame by frame, for an exact replay diff. */
function record(cars: DeformableCar[], frames: number): number[] {
  const w = makeWorld(cars, false, false);
  const out: number[] = [];
  for (let f = 0; f < frames; f++) {
    tickWorld(w);
    for (const c of cars) {
      out.push(c.group.position.x, c.group.position.y, c.group.position.z);
      for (const m of c.deform.masses) out.push(m.world.x, m.world.y, m.world.z);
    }
  }
  return out;
}

function fleetCrash(ground: Ground): number[] {
  setGround(ground);
  const slots = layoutFleet(6, 12, 16, mulberry32(7));
  const cars = slots.map((s) => {
    const c = makeCar("shape");
    c.spawn(s.x, s.z, s.speed);
    return c;
  });
  return record(cars, 200);
}

describe("given the fleet course's disc-shaped ground (a round pad with a rim past which the ground ends)", () => {
  afterEach(() => setGround(null));

  for (const wreck of [false, true]) {
    it(`when a ${wreck ? "wreck sliding" : "car driven"} goes past the rim at 16 m/s, then it stays in one piece until its lowest point is 10 mm under the disc's top off the rim, and is vaporized (removed) in that frame`, () => {
      setGround(DISC_GROUND);
      const car = launch(40, 16, wreck);
      const w = makeWorld([car], false, false, FREEWHEEL);
      const p = car.group.position;
      let prevY = 0;
      let prevD = 0;
      let worstJerk = 0;
      let worstShape = 0;
      let frame = 0;
      let fellOffAt = -1;
      let onDiscFrames = 0;
      // `CrashEngine.stepEdge`'s order: physics for the frame, then the edge rule.
      for (; frame < 300; frame++) {
        tickWorld(w);
        for (const m of car.deform.masses) assert.ok(Number.isFinite(m.world.x + m.world.y + m.world.z), `mass NaN at frame ${frame}`);
        assert.ok(Number.isFinite(p.x + p.y + p.z), `group NaN at frame ${frame}`);
        const d = p.y - prevY;
        // A pop is any frame whose height change departs from the last one by more than gravity's share.
        if (frame > 2) worstJerk = Math.max(worstJerk, Math.abs(d - prevD));
        prevD = d;
        prevY = p.y;
        if (!car.falling) worstShape = Math.max(worstShape, shapeErr(car));
        const fellOff = carFellOffRim(car);
        if (!fellOff && Math.hypot(p.x, p.z) < DISC_RADIUS) onDiscFrames++;
        const act = edgeAction(fellOff, car.vaporized, false, 0);
        if (act === "vaporize") {
          fellOffAt = frame;
          break;
        }
      }
      assert.ok(fellOffAt > 0 && onDiscFrames > 0, `no vaporize (frame ${fellOffAt}), ${onDiscFrames} frames on the disc`);
      assert.ok(Math.hypot(p.x, p.z) > DISC_RADIUS - 2, "vaporized before it reached the rim");
      assert.ok(p.y > -1 && p.y < 0.01, `vaporized at y ${p.y.toFixed(3)} m: the first frame its lowest point was 10 mm under, not a fall of metres`);
      assert.ok(worstJerk <= G_FRAME2 * 1.05, `height popped ${worstJerk.toFixed(4)} m/frame² (gravity ${G_FRAME2.toFixed(4)})`);
      // Measured 0.000 m driven, ≈0.1 m for the wreck (its nose tips over the rim first; 0.03 before the rim).
      assert.ok(worstShape < 0.2, `body bent ${worstShape.toFixed(3)} m while falling`);
    });
  }

  it("when a wreck moving at (3, −2, 5) m/s and spinning is swapped for the fake fall, then the fake flies on at its body's spin and at its centre's velocity", () => {
    const car = launch(0, 0, true);
    const spin = new THREE.Vector3(0.4, -1.1, 0.7);
    const dynamic = car.deform.masses.filter((m) => m.dynamic);
    const mass = dynamic.reduce((s, n) => s + n.mass, 0);
    const c = new THREE.Vector3();
    for (const m of dynamic) c.addScaledVector(m.world, m.mass / mass);
    car.velocity.set(3, -2, 5);
    car.angular.copy(spin);
    const com = new THREE.Vector3(0, car.frame.comY, 0).applyQuaternion(car.group.quaternion).add(car.group.position);
    // The wreck's body turns about its masses' centroid; the intact body about `frame.comY`: the velocity there is v + spin × (centre − centroid).
    const want = car.velocity.clone().add(spin.clone().cross(com.clone().sub(c)));
    beginFakeFall(car);
    assert.ok(car.falling && !car.deform.massActive);
    assert.ok(car.angular.distanceTo(spin) < 1e-9, `spin ${car.angular.toArray()} vs ${spin.toArray()}`);
    assert.ok(car.velocity.distanceTo(want) < 1e-9, `velocity ${car.velocity.toArray()} vs ${want.toArray()}`);
  });

  it("when a vaporized car is stepped for 30 frames, then it is out of the sim: its group and masses stay put", () => {
    setGround(DISC_GROUND);
    const car = launch(60, 10, false);
    car.group.position.y = -25;
    car.resetVisual();
    car.vaporized = true;
    const before = record([car], 1);
    assertSameNumbers(record([car], 30).slice(-before.length), before, "vaporized car");
  });

  const rimCases = [
    { it: "when it sits on the disc 2 cm under its top, then it stays (a sunk car on the pad is no fall)", x: 0, y: -0.02, flipped: false, expectedFellOff: false },
    { it: "when it stands on the disc on its wheels, then it stays", x: 0, y: 0, flipped: false, expectedFellOff: false },
    { it: "when it is off the rim and its lowest point is 5 mm under the disc's top, then it stays", x: 60, y: -0.005, flipped: false, expectedFellOff: false },
    { it: "when it is off the rim and its lowest point is 20 mm under the disc's top, then it has fallen off", x: 60, y: -0.02, flipped: false, expectedFellOff: true },
    { it: "when it hangs off the rim on its roof with the roof's lowest corner 0.36 m under the disc's top, then it has fallen off", x: 60, y: 1, flipped: true, expectedFellOff: true },
    { it: "when it lies on its roof on the disc, then it stays", x: 0, y: 1, flipped: true, expectedFellOff: false },
  ];
  for (const testCase of rimCases) {
    it(`given a car beside the fleet disc, ${testCase.it}`, () => {
      setGround(DISC_GROUND);
      const car = makeCar();
      car.group.position.set(testCase.x, testCase.y, 0);
      if (testCase.flipped) car.group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
      assert.equal(carFellOffRim(car), testCase.expectedFellOff, "fell off the rim");
    });
  }

  it(`when a car has fallen off the rim, then it is vaporized at once, and only the driven car respawns ${RESPAWN_S} s later while an AI car stays gone`, () => {
    assert.equal(edgeAction(false, false, true, 0), null);
    assert.equal(edgeAction(true, false, false, 0), "vaporize");
    assert.equal(edgeAction(true, false, true, 0), "vaporize");
    assert.equal(edgeAction(true, true, true, RESPAWN_S - 0.1), null);
    assert.equal(edgeAction(true, true, true, RESPAWN_S + 0.1), "respawn");
    assert.equal(edgeAction(true, true, false, 60), null, "an AI car stays gone");
  });

  it("when a car respawns, then it is on the disc along the bearing it fell from, facing the centre, and clear of other cars", () => {
    const free = respawnSlot(60, 0, []);
    assert.ok(free.x > 30 && Math.abs(free.z) < 1e-9, "on the bearing it fell from");
    const parked = [{ x: free.x, z: free.z }];
    const s = respawnSlot(60, 0, parked);
    for (const slot of [free, s]) {
      assert.ok(Math.hypot(slot.x, slot.z) < DISC_RADIUS - 5);
      // Nose (sin yaw, cos yaw) points at the origin.
      assert.ok(Math.sin(slot.yaw) * -slot.x + Math.cos(slot.yaw) * -slot.z > Math.hypot(slot.x, slot.z) * 0.999);
    }
    assert.ok(Math.hypot(s.x - free.x, s.z - free.z) >= FLEET_MIN_SEP);
  });

  it("when a fleet crash and a head-on pair are replayed on the disc and on the flat pad, then the two grounds give exactly the same results inside the rim", () => {
    assertSameNumbers(fleetCrash(DISC_GROUND), fleetCrash(FLAT_GROUND), "fleet crash");
    setGround(DISC_GROUND);
    const disc = runPair(48, 48, "head-on");
    setGround(FLAT_GROUND);
    assertSameDigest(disc, runPair(48, 48, "head-on"), "head-on");
  });

  it("when 5 cars drive straight out from the centre on 5 bearings and never meet, then they all vaporize past the rim and the loop's empty-disc rule fires within 10 s", () => {
    const n = 5;
    const cars: DeformableCar[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      const car = launch(0, 0, false);
      car.spawnFacing(Math.sin(a) * 10, Math.cos(a) * 10, a, 0);
      car.velocity.set(Math.sin(a) * 20, 0, Math.cos(a) * 20);
      car.speed = 20;
      car.spawnSpeed = 20;
      car.deform.bindKinematic(car.group, car.velocity, car.angular);
      cars.push(car);
    }
    setGround(DISC_GROUND);
    const w = makeWorld(cars, false, false, FREEWHEEL);
    const vaporAt: number[] = [];
    let firedAt = -1;
    // `CrashEngine.stepEdge`'s order, 60 frames a second: physics, the edge rule per car, then the empty-disc rule.
    for (let frame = 0; frame < 600 && firedAt < 0; frame++) {
      tickWorld(w);
      const now = frame / 60;
      for (let i = 0; i < n; i++) {
        const car = cars[i]!;
        const act = edgeAction(carFellOffRim(car), car.vaporized, false, now - (vaporAt[i] ?? 0));
        if (act === "vaporize") {
          car.vaporized = true;
          vaporAt[i] = now;
        }
      }
      if (fleetEmptied(cars, vaporAt, now)) firedAt = frame;
    }
    assert.ok(firedAt >= 0, "the disc emptied but the loop never fired");
    assert.ok(cars.every((c) => c.vaporized), "every car left the sim");
    assert.ok(firedAt / 60 < 10, `fired at ${(firedAt / 60).toFixed(2)} s`);
  });
});
