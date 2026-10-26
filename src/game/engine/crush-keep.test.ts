import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FREEWHEEL, launch, makeWorld, runWall, tickWorld, type CrashWorld } from "../contact/crash-scenarios.test-util.ts";
import { pushCar } from "../contact/pair-contact.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { assignClass, type VehicleClassId } from "../vehicle/vehicle-classes.ts";
import type { CarStyleId } from "../vehicle/car-variants.ts";
import type { DriveInput } from "../vehicle/car-drive.ts";
import { paint } from "../vehicle/test-support.ts";
import { carLayout } from "../net/car-pose.ts";
import { ensureFrames, makeSnapshot } from "../net/codec.ts";
import { FLIGHT } from "../vehicle/car-flight.ts";
import { PART_STATE } from "../vehicle/part-state.ts";

/**
 * A dent is permanent (owner, flag 8JSS-CGEY): a nose-crushed wreck that is shoved, thawed, woken or restored from a keyframe draws the
 * crush it had, to `KEEP`, at its next skin bake. The drawn nose is read from the body skin baked from its masses as they stand.
 */

const KEEP = 0.002;
/** The front band (m from the nose, above the sill) whose mean inward travel is the drawn nose crush. */
const BAND = 0.4;
const SILL_Y = 0.5;
/** An overlap push (`pushApart` → `pushCar`) of a driven wreck rammed from behind, along its struck end: five pushes of 6 mm. */
const PUSHES = 5;
const PUSH_M = 0.006;
/** Its driver keeps the gas down (a racer wreck on the move, as the flag's hatch was). */
const GAS: DriveInput = { throttle: 1, steer: 0, brake: 0, ebrake: false, boost: false };

const STYLES: [CarStyleId, VehicleClassId][] = [
  ["hatchback", "hatch"],
  ["wagon", "suv"],
  ["pickup", "truck"],
];

function styled(style: CarStyleId, cls: VehicleClassId): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, style);
  assignClass(car, cls);
  return car;
}

/** A car of `style` 1.5 s after a 50 km/h square wall hit: a frozen, nose-crushed wreck. */
function wreck(style: CarStyleId, cls: VehicleClassId): DeformableCar {
  const car = styled(style, cls);
  runWall(50, 1, "front", { car });
  assert.ok(car.deform.frozen, `${style}: the wreck did not freeze`);
  return car;
}

/** Mean inward travel (m) of the skin's front band, from a bake of the masses as they stand now. */
function drawnNose(car: DeformableCar): number {
  car.deform.bakeSkin();
  car.deform.flushSkin(car.body.geometry, true);
  return noseAsDrawn(car);
}

/** Mean inward travel (m) of the front band of the skin as last written to the mesh. */
function noseAsDrawn(car: DeformableCar): number {
  const rest = car.deform.restSkin;
  const at = car.body.geometry.getAttribute("position").array;
  let front = -Infinity;
  for (let i = 2; i < rest.length; i += 3) front = Math.max(front, rest[i]!);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < rest.length; i += 3) {
    if (rest[i + 2]! < front - BAND || rest[i + 1]! < SILL_Y) continue;
    sum += rest[i + 2]! - at[i + 2]!;
    n++;
  }
  return sum / n;
}

function ticks(w: CrashWorld, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) tickWorld(w);
}

function assertKept(label: string, before: number, after: number): void {
  assert.ok(before > 0.05, `${label}: the fixture crushed the nose only ${(before * 1000).toFixed(1)} mm`);
  assert.ok(Math.abs(after - before) <= KEEP, `${label}: the drawn nose crush went ${(before * 1000).toFixed(1)} → ${(after * 1000).toFixed(1)} mm`);
}

/** `dst` set as a keyframe holds `src`: pose, net state, solver state and parts, as `ClipSim.spawn` restores a car. */
function restoreInto(src: DeformableCar, dst: DeformableCar): void {
  const snap = makeSnapshot();
  ensureFrames(snap, 1, carLayout(src));
  const f = snap.cars[0]!;
  src.deform.readNetState(f.deform);
  src.readPartNetState(f.parts);
  const fl = new Float64Array(FLIGHT);
  const sim = new Float64Array(src.solverSize());
  const parts = new Float64Array(PART_STATE);
  src.flight(fl, 0, false);
  src.solverState(sim, false);
  src.partState(parts, false);
  dst.spawnFacing(src.group.position.x, src.group.position.z, src.yaw, 0);
  dst.writeNetState(f.deform, f.parts);
  dst.solverState(sim, true);
  dst.partState(parts, true);
  dst.flight(fl, 0, true);
}

for (const [style, cls] of STYLES) {
  describe(`given a ${style} 1.5 s after a 50 km/h nose hit, frozen`, () => {
    it("when it is driven on and rammed from behind by overlap pushes along its struck end, then left to settle, then its next bake draws the nose crush it had", () => {
      const car = wreck(style, cls);
      const before = drawnNose(car);
      const w = makeWorld([car], false, false, GAS);
      const back = car.fwdFlat.clone().negate();
      for (let k = 0; k < PUSHES; k++) {
        pushCar(car, back.x, 0, back.z, PUSH_M);
        tickWorld(w);
      }
      ticks(w, 1);
      assertKept(`${style} shoved`, before, drawnNose(car));
    });

    it("when it is thawed and stepped, or put to sleep and woken, then its next bake draws the nose crush it had", () => {
      const car = wreck(style, cls);
      const before = drawnNose(car);
      const w = makeWorld([car], false, false, FREEWHEEL);
      car.deform.thaw();
      ticks(w, 0.5);
      assertKept(`${style} thawed`, before, drawnNose(car));
      for (let t = 0; t < 6 && !car.asleep; t += 1 / 60) tickWorld(w);
      assert.ok(car.asleep, `${style}: the wreck never fell asleep`);
      car.wake();
      ticks(w, 0.5);
      assertKept(`${style} woken`, before, drawnNose(car));
    });

    it("when it is restored from a keyframe onto a fresh car of its style and replayed 1 s, then that car draws the nose crush it had", () => {
      const car = wreck(style, cls);
      const before = drawnNose(car);
      const copy = styled(style, cls);
      restoreInto(car, copy);
      assertKept(`${style} restored`, before, drawnNose(copy));
      ticks(makeWorld([copy], false, false, FREEWHEEL), 1);
      assertKept(`${style} replayed`, before, drawnNose(copy));
    });
  });

  describe(`given a ${style} that hits a wall at 50 km/h nose first and is held on it by its driver once the hit's crash window closes`, () => {
    // The pickup still pops 2.1 mm at the freeze step itself (no drift before it: its front masses' car-frame z re-derived from the wall-held world).
    const todo = style === "pickup" ? "the freeze step's own re-derive moves the pickup's nose 2.1 mm" : undefined;
    it("when it settles there 3 s, then its drawn nose never jumps more than 2 mm between frames, its next bake included", { todo }, () => {
      const car = styled(style, cls);
      launch(car, 6.2, 0, -Math.PI / 2, -50 / 3.6, 0);
      const w = makeWorld([car], true, false, FREEWHEEL);
      for (let t = 0; t < 3 && (!car.crashed || car.deform.crushing); t += 1 / 60) tickWorld(w);
      assert.ok(car.crashed && !car.deform.crushing, `${style}: the hit's crash window never closed`);
      w.pedals.set(car, GAS);
      let last = noseAsDrawn(car);
      let worst = 0;
      for (let t = 0; t < 3; t += 1 / 60) {
        tickWorld(w);
        const now = noseAsDrawn(car);
        worst = Math.max(worst, Math.abs(now - last));
        last = now;
      }
      worst = Math.max(worst, Math.abs(drawnNose(car) - last));
      assert.ok(worst <= KEEP, `${style}: the drawn nose jumped ${(worst * 1000).toFixed(1)} mm between frames`);
    });
  });
}
