import { describe, expect, it } from "vitest";
import { FREEWHEEL, launch, makeWorld, runWall, tickWorld, type CrashWorld } from "../contact/crash-scenarios.test-util.ts";
import { makeBox, solidFace, strikeCar } from "../contact/external-contact.ts";
import { pushCar } from "../contact/pair-contact.ts";
import { DeformableCar } from "../vehicle/car.ts";
import type { VehicleClassId } from "../vehicle/vehicle-classes.ts";
import type { CarStyleId } from "../vehicle/car-variants.ts";
import type { DriveInput } from "../vehicle/car-drive.ts";
import { makeCar } from "../vehicle/ground-probe.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
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

/** The front bumper's travel (m) a 50 km/h square wall hit leaves (measured 0.408-0.410); moved whole by the wall while it crushed, a hatch stood 0.389 m in and a wagon 0.378 m. */
const FIRST_HIT_CRUSH_MIN = 0.4;
const FIRST_HIT_CRUSH_MAX = 0.42;

/** A car of `style` 1.5 s after a 50 km/h square wall hit: a frozen, nose-crushed wreck. */
function wreck(style: CarStyleId, cls: VehicleClassId): DeformableCar {
  const car = makeCar(cls);
  runWall(50, 1, "front", { car });
  expect(car.deform.frozen, `${style}: the wreck did not freeze`).toBeTruthy();
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
  for (let t = 0; t < seconds; t += 1 / FRAME_HZ) tickWorld(w);
}

function assertKept(label: string, before: number, after: number): void {
  expect(before, `${label}: the fixture crushed the nose only ${(before * 1000).toFixed(1)} mm`).toBeGreaterThan(0.05);
  expect(Math.abs(after - before), `${label}: the drawn nose crush went ${(before * 1000).toFixed(1)} → ${(after * 1000).toFixed(1)} mm`).toBeLessThanOrEqual(KEEP);
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
      for (let t = 0; t < 6 && !car.asleep; t += 1 / FRAME_HZ) tickWorld(w);
      expect(car.asleep, `${style}: the wreck never fell asleep`).toBeTruthy();
      car.wake();
      ticks(w, 0.5);
      assertKept(`${style} woken`, before, drawnNose(car));
    });

    it("when it is restored from a keyframe onto a fresh car of its style and replayed 1 s, then that car draws the nose crush it had", () => {
      const car = wreck(style, cls);
      const before = drawnNose(car);
      const copy = makeCar(cls);
      restoreInto(car, copy);
      assertKept(`${style} restored`, before, drawnNose(copy));
      ticks(makeWorld([copy], false, false, FREEWHEEL), 1);
      assertKept(`${style} replayed`, before, drawnNose(copy));
    });
  });

  describe(`given a ${style} that hits a wall at 50 km/h nose first`, () => {
    it("when its crash window has closed, then the hit crushed its front bumper in by 0.40 to 0.42 m (the wall never held the crushing car out whole)", () => {
      const car = wreck(style, cls);
      const bumper = car.deform.masses.find((m) => m.name === "bumperFL")!;
      const crush = bumper.rest.z - bumper.local.z;
      expect(crush, `${style}: the front bumper stands ${(crush * 1000).toFixed(1)} mm in`).toBeGreaterThanOrEqual(FIRST_HIT_CRUSH_MIN);
      expect(crush, `${style}: the front bumper stands ${(crush * 1000).toFixed(1)} mm in`).toBeLessThanOrEqual(FIRST_HIT_CRUSH_MAX);
    });
  });

  describe(`given a ${style} that hits a wall at 50 km/h nose first and is held on it by its driver once the hit's crash window closes`, () => {
    it("when it settles there 3 s, then its drawn nose never jumps more than 2 mm between frames, its next bake included", () => {
      const car = makeCar(cls);
      launch(car, 6.2, 0, -Math.PI / 2, -50 / 3.6, 0);
      const w = makeWorld([car], true, false, FREEWHEEL);
      for (let t = 0; t < 3 && (!car.crashed || car.deform.crushing); t += 1 / FRAME_HZ) tickWorld(w);
      expect(car.crashed && !car.deform.crushing, `${style}: the hit's crash window never closed`).toBeTruthy();
      w.pedals.set(car, GAS);
      let last = noseAsDrawn(car);
      let worst = 0;
      for (let t = 0; t < 3; t += 1 / FRAME_HZ) {
        tickWorld(w);
        const now = noseAsDrawn(car);
        worst = Math.max(worst, Math.abs(now - last));
        last = now;
      }
      worst = Math.max(worst, Math.abs(drawnNose(car) - last));
      expect(worst, `${style}: the drawn nose jumped ${(worst * 1000).toFixed(1)} mm between frames`).toBeLessThanOrEqual(KEEP);
    });

    it("when it is held there 3 s more, then the wall holds it whole and its nose crush grows by no more than 2 mm", () => {
      const { car, w } = closedWindowAtWall(style, cls, 50);
      w.pedals.set(car, GAS);
      ticks(w, 0.5);
      const before = drawnNose(car);
      ticks(w, 3);
      assertKept(`${style} leaned on the wall`, before, drawnNose(car));
    });

    it("when a wreck of a 20 km/h hit is then driven into the wall at 3 m/s, then its nose is crushed further by more than 5 mm", () => {
      const { car, w } = closedWindowAtWall(style, cls, 20);
      ticks(w, 1);
      const before = drawnNose(car);
      car.velocity.x -= 3;
      ticks(w, 1);
      expect(drawnNose(car) - before, `${style}: a fresh 3 m/s hit on a settled wreck left its nose as it was`).toBeGreaterThan(0.005);
    });
  });

  describe(`given a ${style} that a 50 km/h plate has crushed and let settle`, () => {
    it("when a second 50 km/h plate shot meets the wreck, then the plate neither springs its nose back out nor leaves it dented less than 2 mm", () => {
      const car = makeCar(cls);
      const w = makeWorld([car], false, false, FREEWHEEL);
      const nose = () => car.deform.masses.find((m) => m.name === "bumperFL")!.local.z;
      plateShot(car, w, 50);
      const first = nose();
      expect(rest0(cls) - first, `${style}: the first plate shot did not dent the nose`).toBeGreaterThan(0.1);
      plateShot(car, w, 50);
      expect(nose() - first, `${style}: the second shot left the nose ${((nose() - first) * 1000).toFixed(1)} mm out of the dent of the first`).toBeLessThanOrEqual(KEEP);
    });
  });
}

/** The nose's z (m) on an intact car of `cls`. */
function rest0(cls: VehicleClassId): number {
  return makeCar(cls).deform.masses.find((m) => m.name === "bumperFL")!.rest.z;
}

/** A plate (open ends, as a piston head's) driven at `kph` into the nose of `car`, 0.4 s of contact, then 1 s to settle. */
function plateShot(car: DeformableCar, w: CrashWorld, kph: number): void {
  const box = makeBox();
  const v = kph / 3.6;
  const fwd = car.fwdFlat;
  const b = car.deform.masses.find((m) => m.name === "bumperFL")!.world;
  const x0 = b.x + fwd.x * 0.02;
  const z0 = b.z + fwd.z * 0.02;
  for (let t = 0; t < 0.4; t += 1 / FRAME_HZ) {
    solidFace(box, -fwd.x, -fwd.z, x0 - fwd.x * v * t, z0 - fwd.z * v * t, car.group.position.x, car.group.position.z, 1.5, 0.5);
    box.fixed = false;
    box.vx = -fwd.x * v;
    box.vz = -fwd.z * v;
    box.kg = 3000;
    strikeCar(car, box, 1 / FRAME_HZ, true, true, false);
    tickWorld(w);
  }
  ticks(w, 1);
}

/** A car of `cls` that hit the wall at `kph` nose first, its crash window closed, in a world that keeps the wall. */
function closedWindowAtWall(style: CarStyleId, cls: VehicleClassId, kph: number): { car: DeformableCar; w: CrashWorld } {
  const car = makeCar(cls);
  launch(car, 6.2, 0, -Math.PI / 2, -kph / 3.6, 0);
  const w = makeWorld([car], true, false, FREEWHEEL);
  for (let t = 0; t < 3 && (!car.crashed || car.deform.crushing); t += 1 / FRAME_HZ) tickWorld(w);
  expect(car.crashed && !car.deform.crushing, `${style}: the hit's crash window never closed`).toBeTruthy();
  return { car, w };
}
