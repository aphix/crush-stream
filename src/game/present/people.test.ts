import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { FREEWHEEL, launch, makeCar, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { PART_SLOTS } from "../vehicle/part-state.ts";
import type { FigureStrike } from "../scenes/figure-strike.ts";
import { GUARD_DOWN, LawnGuard, SHOT_RING } from "../scenes/lawn-guard.ts";
import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { TRACK_ID } from "../world/constants.ts";
import { setGround } from "../world/ground.ts";
import type { DriverLook } from "./driver-look.ts";
import { VIP_LOOK } from "./dummy-dress.ts";
import { GroundsArt } from "./grounds-art.ts";
import { GuardSquad, People, VIP_SLOT, VipEscort, nukeFlash } from "./people.ts";
import { drawnTriangles } from "../vehicle/drawn-body.test-util.ts";
import { PARTS } from "./ragdoll-body.ts";
import { DummyMesh } from "./ragdoll-mesh.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { driverSeat } from "../vehicle/interior.ts";
import { JOINTS } from "./ragdoll-body.ts";

/** Once the Konami code is in, a man in a suit walks out of the White House to the car, rides with the player and is thrown out with the driver when it crashes. */
const json = TRACKS.find((j) => parseTrack(j).id === TRACK_ID.nationalMall)!;
const track = new Track(json);
const spec = track.json.guards!;
const ground = track.ground();
setGround(ground);
const FRAME = 1 / FRAME_HZ;
/** The North Lawn, 40 m in front of the North Portico. */
const NORTH_LAWN = { x: -990, z: -1104 };
/** A spot out on the Ellipse's road past the south fence, off the grounds. */
const OFF_GROUNDS = { x: -1000, z: -760 };

/** A popped wheel's leave speed (m/s): 9.43 measured off a 2 × 80 km/h sedan head-on. It is let go at his chest's height, its middle this far (m) from him. */
const WHEEL_LEAVE_MPS = 9.4;
const CHEST_M = 1.1;
const WHEEL_GAP_M = 0.5;

/** The VIP's escort over a car parked on the lawn: `seconds` of frames, the secret out or not; the throws it asked for. */
function escort(secretOut: boolean, seconds: number) {
  const vip = new VipEscort(spec, ground, new People(1), 0);
  const car = makeCar();
  launch(car, NORTH_LAWN.x, NORTH_LAWN.z, 0, 0, 0);
  const cars = [car];
  const throws: { car: number; look: DriverLook }[] = [];
  const throwPassenger = (i: number, look: DriverLook): void => void throws.push({ car: i, look });
  const figures: FigureStrike[] = [];
  const throwFigure = (strike: FigureStrike): void => void figures.push({ ...strike });
  let boardedAt = -1;
  for (let t = 0; t < seconds; t += FRAME) {
    vip.frame(FRAME, secretOut, 0, cars, throwPassenger, throwFigure);
    if (boardedAt < 0 && vip.ridingIn === 0) boardedAt = t;
  }
  return { vip, car, cars, throws, throwPassenger, throwFigure, figures, boardedAt };
}

describe("given the National Mall's VIP and the player's car parked on the White House's North Lawn", () => {
  it("when the course's secret is out, then he walks out of the house to the passenger door and gets in, and when the driver is thrown out he is thrown with him, once: a portly blond man in a blue suit", () => {
    const { vip, car, cars, throws, throwPassenger, throwFigure, boardedAt } = escort(true, 40);
    expect(boardedAt > 5 && boardedAt < 35, `boarded ${boardedAt.toFixed(1)} s after the car stopped (a walk of some 40 m)`).toBeTruthy();
    expect(throws.length, "nobody thrown while the car is whole").toBe(0);
    car.driverOut = "windshield";
    vip.frame(FRAME, true, 0, cars, throwPassenger, throwFigure);
    vip.frame(FRAME, true, 0, cars, throwPassenger, throwFigure);
    expect(throws.length, "thrown once with the driver").toBe(1);
    expect(throws[0]!.car, "out of the player's car").toBe(0);
    expect(throws[0]!.look.woman, "a man").toBe(false);
    expect(throws[0]!.look.hair, "his swept blond hair").toBe(VIP_LOOK.hair);
    expect(throws[0]!.look.shirt, "his navy jacket").toBe(VIP_LOOK.shirt);
    expect(throws[0]!.look.pants, "his navy trousers").toBe(VIP_LOOK.pants);
    expect(throws[0]!.look.portly, "portly").toBe(true);
    expect(vip.ridingIn, "no longer riding").toBe(-1);
  });

  it("when he rides, then his hips are on the passenger seat (the driver's seat mirrored across the car), and they ride a crushed cabin", () => {
    const { vip, car, cars, throwPassenger, throwFigure, boardedAt } = escort(true, 40);
    expect(boardedAt, "control: he boarded").toBeGreaterThan(0);
    const mesh: DummyMesh = vip["people"]["mesh"];
    const joint = (j: number) => new THREE.Vector3(JOINTS[j]![2], JOINTS[j]![3], JOINTS[j]![4]);
    const hips = () => mesh.partPoint(0, 6, joint(5), new THREE.Vector3()).add(mesh.partPoint(0, 8, joint(7), new THREE.Vector3())).multiplyScalar(0.5);
    const seat = () => {
      const h = driverSeat(car.style).hip;
      car.interior.updateWorldMatrix(true, false);
      return new THREE.Vector3(-h.x, h.y, h.z).applyMatrix4(car.interior.matrixWorld);
    };
    expect(hips().distanceTo(seat()), `hips ${hips().distanceTo(seat()).toFixed(3)} m off the passenger H-point`).toBeLessThan(1e-3);
    car.interior.scale.x = 0.8;
    car.interior.position.set(0.05, -0.03, 0.02);
    vip.frame(FRAME, true, 0, cars, throwPassenger, throwFigure);
    expect(hips().distanceTo(seat()), `crushed cabin: hips ${hips().distanceTo(seat()).toFixed(3)} m off the passenger H-point`).toBeLessThan(1e-3);
  });

  it("when the secret is still in, then he never comes out, though the same car would draw him once it is", () => {
    expect(escort(false, 40).boardedAt, "never boards").toBe(-1);
    expect(escort(true, 40).boardedAt, "with the secret out he boards").toBeGreaterThan(0);
  });

  /** A second car at `mps` runs into the VIP two seconds into his walk; returns where he stood and what was thrown. */
  function runDownAt(mps: number) {
    const { vip, cars, throwPassenger, throwFigure, figures } = escort(true, 3);
    const where = { x: vip["x"], z: vip["z"] };
    expect(vip["phase"], "he is out on his walk").toBe("walking");
    const bullet = makeCar();
    launch(bullet, where.x, where.z, 0, 0, mps);
    cars.push(bullet);
    vip.frame(FRAME, true, 0, cars, throwPassenger, throwFigure);
    vip.frame(FRAME, true, 0, cars, throwPassenger, throwFigure);
    return { vip, figures, where };
  }

  it(`when a popped wheel at its leave speed (${WHEEL_LEAVE_MPS} m/s) reaches him as he walks, then he is thrown once where he stood, standing still, for the wheel to strike`, () => {
    const { vip, cars, throwPassenger, throwFigure, figures } = escort(true, 3);
    const where = { x: vip["x"], z: vip["z"] };
    const off = makeCar();
    launch(off, where.x + 40, where.z + 40, 0, 0, 0);
    const w = makeWorld([off], false, false, FREEWHEEL);
    off["dropWheel"](0, "hubFL");
    tickWorld(w);
    const wheel = off.looseBody(PART_SLOTS)!;
    wheel.object.position.set(where.x, ground.heightAt(where.x, where.z) + CHEST_M, where.z + WHEEL_GAP_M).sub(wheel.shape.centre.clone().applyQuaternion(wheel.object.quaternion));
    wheel.velocity.set(0, 0, -WHEEL_LEAVE_MPS);
    cars.push(off);
    vip.frame(FRAME, true, 0, cars, throwPassenger, throwFigure);
    expect(figures.length, "figures thrown").toBe(1);
    expect(vip["phase"], "his phase").toBe("thrown");
    expect(figures[0]!.loose, "by a loose part").toBe(true);
    expect(figures[0]!.car, "of the second car").toBe(1);
    expect(Math.hypot(figures[0]!.vx, figures[0]!.vy, figures[0]!.vz), "standing still").toBe(0);
  });

  it("when a car at 15 m/s is on him as he walks, then he is thrown once where he stood by the car, and is drawn no more", () => {
    const { vip, figures, where } = runDownAt(15);
    expect(figures.length, "figures thrown").toBe(1);
    expect(vip["phase"], "his phase").toBe("thrown");
    expect(figures[0]!.guard, "the VIP, not a guard").toBe(-1);
    expect(figures[0]!.car, "struck by the second car").toBe(1);
    expect(Math.abs(figures[0]!.x - where.x) < 1e-3 && Math.abs(figures[0]!.z - where.z) < 1e-3, "where he stood").toBeTruthy();
    expect((vip["people"]["mesh"]["shown"] >> 0) & 1, "his figure is hidden").toBe(0);
  });

  it("when a car at 1 m/s is on him as he walks, then he is left standing (a sedan runs him down from 1.12 m/s, `knocksDown`)", () => {
    const { vip, figures } = runDownAt(1);
    expect(figures.length, "figures thrown").toBe(0);
    expect(vip["phase"], "his phase").toBe("walking");
  });
});

/** A guard squad over the National Mall's lawn, its people's meshes, the car it fires on and a second car off the grounds. */
function lawn() {
  const people = new People(spec.count + 1);
  const squad = new GuardSquad(spec, ground, people);
  const guard = new LawnGuard(spec, 2);
  guard.reset(1);
  const car = makeCar();
  launch(car, NORTH_LAWN.x, NORTH_LAWN.z, 0, 0, 0);
  const bullet = makeCar();
  launch(bullet, OFF_GROUNDS.x, OFF_GROUNDS.z, 0, 0, 0);
  const cars = [car, bullet];
  const frames = (seconds: number, standDown: boolean): void => {
    guard.standDown = standDown;
    for (let t = 0; t < seconds; t += FRAME) {
      guard.step(cars, FRAME);
      squad.frame(guard, cars, () => {});
      people.update(FRAME);
    }
  };
  return { people, squad, guard, car, cars, bullet, frames };
}

/** Whether slot `slot` of the people's one mesh is drawn. */
const standing = (people: People, slot: number): boolean => ((people["mesh"]["shown"] >> slot) & 1) === 1;

describe("given the National Mall's guard squad, inside the house until the alarm goes up", () => {
  it("when nobody is out, then nothing of theirs is drawn; when the alarm sends them out, they are drawn; when it stands down and they are back inside, they are not", () => {
    const { people, frames } = lawn();
    frames(1, true);
    expect(people.group.visible, "a quiet lawn draws nothing").toBe(false);
    frames(4, false);
    expect(people.group.visible, "the squad out on the lawn is drawn").toBe(true);
    frames(20, true);
    expect(people.group.visible, "the squad back inside draws nothing").toBe(false);
  });

  it("when a car at speed runs guard 0 down, then he is drawn no more while the rest of the squad still is, and after a restart he stands in the ranks again", () => {
    const { people, squad, guard, bullet, frames } = lawn();
    frames(3, false);
    expect(standing(people, 1) && standing(people, 2), "guards 0 and 1 stand at their posts").toBeTruthy();
    launch(bullet, guard.guardX[0]!, guard.guardZ[0]!, 0, 0, 15);
    frames(2 * FRAME, false);
    expect(guard.mode[0], "the sim has him down").toBe(GUARD_DOWN);
    expect(!standing(people, 1), "he is no longer drawn").toBe(true);
    expect(standing(people, 2), "the next guard still is").toBeTruthy();
    launch(bullet, OFF_GROUNDS.x, OFF_GROUNDS.z, 0, 0, 0);
    squad.reset();
    guard.reset(1);
    frames(3, false);
    expect(standing(people, 1), "after the restart he stands again").toBeTruthy();
  });

  it("when a gun fires with nobody else out, then its flash goes out first, its tracer a moment later, and then nothing is drawn", () => {
    const { people } = lawn();
    people.fire(0, 0, 1, 0);
    people.update(FRAME);
    expect(people.group.visible, "the shot shows").toBe(true);
    expect(people["flashes"].visible && people["tracers"].visible, "flash and tracer both show").toBeTruthy();
    people.update(0.04);
    expect(!people["flashes"].visible && people["tracers"].visible, "the flash is out, the tracer still runs").toBeTruthy();
    people.update(0.2);
    expect(people.group.visible, "the shot is out").toBe(false);
    expect(!people["tracers"].visible, "the tracer is out").toBe(true);
  });

  /** The squad out and aiming at the parked car, then one shot of guard 0's at it drawn on its own frame: where its tracer ended and the sparks asked for. */
  function shotAtCar(hit: boolean) {
    const { people, squad, guard, car, cars, frames } = lawn();
    frames(3, false);
    const k = guard.shots % SHOT_RING;
    guard.shotGuard[k] = 0;
    guard.shotCar[k] = 0;
    guard.shotHit[k] = hit ? 1 : 0;
    guard.shots++;
    const sparked: { at: THREE.Vector3; normal: THREE.Vector3 }[] = [];
    squad.frame(guard, cars, (at, normal) => void sparked.push({ at: at.clone(), normal: normal.clone() }));
    const muzzle = people.muzzle(1, new THREE.Vector3()).clone();
    const tracer = people["tracerAt"] as Float32Array;
    const last = ((people["tracerNext"] as number) + 23) % 24;
    return { car, sparked, muzzle, tracerEnd: new THREE.Vector3().fromArray(tracer, last * 6 + 3) };
  }

  /** Distance (m) along the ray from `o` along `d` to the first of the triangles (9 numbers each: Moller-Trumbore); Infinity for none. */
  function firstTriangle(tris: Float32Array, o: THREE.Vector3, d: THREE.Vector3): number {
    const edge1 = new THREE.Vector3();
    const edge2 = new THREE.Vector3();
    const p = new THREE.Vector3();
    const rel = new THREE.Vector3();
    const q = new THREE.Vector3();
    let best = Infinity;
    for (let i = 0; i < tris.length; i += 9) {
      edge1.fromArray(tris, i + 3).sub(rel.fromArray(tris, i));
      edge2.fromArray(tris, i + 6).sub(rel.fromArray(tris, i));
      const det = edge1.dot(p.crossVectors(d, edge2));
      if (Math.abs(det) < 1e-12) continue;
      rel.copy(o).sub(q.fromArray(tris, i));
      const u = rel.dot(p) / det;
      q.crossVectors(rel, edge1);
      const v = d.dot(q) / det;
      const t = edge2.dot(q) / det;
      if (u >= 0 && v >= 0 && u + v <= 1 && t >= 0) best = Math.min(best, t);
    }
    return best;
  }

  it("when a hit shot lands on a car, then the sparks start on the car's surface facing the shooter, where its tracer ends, not inside the body", () => {
    const { car, sparked, muzzle, tracerEnd } = shotAtCar(true);
    expect(sparked.length, "one shower for the hit").toBe(1);
    const { at, normal } = sparked[0]!;
    const inside = car.group.position.clone().add(new THREE.Vector3(0, 0.7, 0));
    expect(muzzle.distanceTo(at), `the point is ${(muzzle.distanceTo(inside) - muzzle.distanceTo(at)).toFixed(2)} m nearer the shooter than the car's middle`).toBeLessThan(muzzle.distanceTo(inside) - 0.5);
    expect(normal.dot(muzzle.clone().sub(at)) > 0 && Math.abs(normal.length() - 1) < 1e-6, "the face's unit normal points at the shooter").toBeTruthy();
    // On the body: a ray from 5 cm off the point straight back at the car meets a drawn triangle of its body within a few cm of that.
    const turn = car.group.quaternion.clone().invert();
    const from = at.clone().addScaledVector(normal, 0.05).sub(car.group.position).applyQuaternion(turn);
    const way = normal.clone().negate().applyQuaternion(turn);
    const t = firstTriangle(drawnTriangles(car), from, way);
    expect(Math.abs(t - 0.05), `the body is ${t.toFixed(3)} m along the ray from 5 cm off the point`).toBeLessThan(0.05);
    expect(tracerEnd.distanceTo(at), "the tracer ends where the sparks start").toBeLessThan(1e-4);
  });

  it("when a shot misses the car, then its tracer flies past and no sparks fly", () => {
    const { sparked, tracerEnd, car } = shotAtCar(false);
    expect(sparked.length, "no sparks").toBe(0);
    expect(tracerEnd.distanceTo(car.group.position), "the tracer ends wide of the car").toBeGreaterThan(2);
  });
});

describe("given the VIP riding with the squad inside", () => {
  it("when he is in the passenger seat, then one figure is drawn, not the squad's empty places too, and he sits on the car's right (-x), across from the driver", () => {
    const art = new GroundsArt(spec, ground, new THREE.Group());
    const car = makeCar();
    launch(car, NORTH_LAWN.x, NORTH_LAWN.z, 0, 0, 0);
    const host = { sparks: () => {}, throwPassenger: () => {}, throwFigure: () => {} };
    for (let t = 0; t < 40; t += FRAME) art.frame(FRAME, null, true, [car], 0, host);
    const drawn = art["people"].group.children.find((c): c is DummyMesh => c instanceof DummyMesh)!;
    const slots = spec.count + 1;
    expect(drawn.count, "the draw ends after slot 0").toBe(drawn.instanceMatrix.count / slots);
    // The slot is the instance, so his place is the torso part's pose (`DummyMesh.partPoint` of its rest centre), not an instance matrix.
    const torso = drawn.partPoint(VIP_SLOT, 0, new THREE.Vector3().fromArray(PARTS[0]!.c), new THREE.Vector3());
    const local = torso.x - car.group.position.x;
    expect(local, `the VIP sits on the car's right (-x), across from the driver: car-local x ${local.toFixed(2)}`).toBeLessThan(-0.2);
  });

  it("when the next race starts, then he is back inside: no figure is drawn and, the secret in again, he does not come out", () => {
    const art = new GroundsArt(spec, ground, new THREE.Group());
    const car = makeCar();
    launch(car, NORTH_LAWN.x, NORTH_LAWN.z, 0, 0, 0);
    const host = { sparks: () => {}, throwPassenger: () => {}, throwFigure: () => {} };
    for (let t = 0; t < 40; t += FRAME) art.frame(FRAME, null, true, [car], 0, host);
    const drawn = art["people"].group.children.find((c): c is DummyMesh => c instanceof DummyMesh)!;
    expect(drawn.count, "riding: his one figure is drawn").toBe(drawn.instanceMatrix.count / (spec.count + 1));
    art.reset();
    for (let t = 0; t < 40; t += FRAME) art.frame(FRAME, null, false, [car], 0, host);
    expect(drawn.count, "nobody drawn").toBe(0);
  });
});

describe("given the secret's flash over a view", () => {
  it("when it is stopped before its peak, then the glare is gone at once and the sky picture never comes out", (t) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const glare = { style: { cssText: "" }, removed: false, cancelled: false, remove: () => void (glare.removed = true), animate: () => ({ cancel: () => void (glare.cancelled = true) }) };
    Object.defineProperty(globalThis, "document", { value: { createElement: () => glare }, configurable: true });
    t.onTestFinished(() => {
      Reflect.deleteProperty(globalThis, "document");
      vi.useRealTimers();
    });
    let peaked = false;
    const stop = nukeFlash({ appendChild: (node) => node }, () => void (peaked = true));
    stop();
    vi.advanceTimersByTime(10_000);
    expect(peaked, "the picture's moment never comes").toBe(false);
    expect(glare.removed && glare.cancelled, "the glare is taken down").toBeTruthy();
  });
});
