import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { growDrawn } from "../vehicle/car-parts.ts";
import { applyDrive, idleDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { PartSeat } from "../vehicle/part-geometry.ts";
import { shellBox } from "../vehicle/car-panels.ts";
import { CLASSES, carClass, STYLE_CLASS } from "../vehicle/vehicle-classes.ts";
import type { CarStyleId } from "../vehicle/car-variants.ts";
import { makeCar } from "../vehicle/ground-probe.test-util.ts";
import { DoorRig, type DoorScenario, type RamShot } from "./door-rig.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

/** Brakes off, no thrust: a freewheeling car (the road's rolling and air drag and the tyres' grip are all that act on it). */
const NEUTRAL: DriveInput = { ...idleDrive(), neutral: true };

/** One tyre step for each car whose drivetrain is alive, as the engine's `applyDrive` pass (a wreck's tyres are the wreck rules'). */
export function tyresStep(cars: readonly DeformableCar[], dt: number): void {
  for (const car of cars) if (car.deform.drivetrainAlive) applyDrive(car, NEUTRAL, dt);
}

/** A parked car of style `id` facing +Z, dressed in the class the game gives it (a monster's body rides its lift). */
export function parkedStyle(id: CarStyleId): DeformableCar {
  const car = makeCar(STYLE_CLASS[id]);
  car.spawnFacing(0, 0, 0, 0);
  return car;
}

/** The detachable each lane is for: a door's mirror, a door, a quarter panel, the trunk lid. */
export const LANE_PART: Readonly<Record<DoorScenario, "mirror" | "door" | "quarter" | "trunk">> = {
  mirror: "mirror",
  overOpen: "door",
  shut: "door",
  panelPush: "quarter",
  panelPull: "quarter",
  lidPop: "trunk",
  lidTear: "trunk",
};

/** The name of the detachable `part` on `side` (the lid has no side). */
export function partName(part: "mirror" | "door" | "quarter" | "trunk", side: -1 | 1): string {
  return part === "trunk" ? part : `${part}${side < 0 ? "L" : "R"}`;
}

/** Half the run's length along the car (m): every lane's head covers it, end to end. */
const RUN_HALF = 10;

/** `name`'s drawn box in the car's frame as the car stands now: a quarter panel's shell at its hinge, else what its part draws (a door without its mirror, a mirror's own pod). */
export function drawnBox(car: DeformableCar, name: string, out: THREE.Box3): THREE.Box3 {
  car.group.updateMatrixWorld(true);
  const part = car["parts"].find((p) => p.name === name)!;
  if (part.region) return shellBox(part.region, car.deform.restSkin, part.hingeT, car.group.position, car.group.quaternion, CLASSES[carClass(car)].lift, out);
  out.makeEmpty();
  const drawn = part.hinge === "door" ? part.object.children.filter((child) => !(child instanceof PartSeat)) : [part.object];
  for (const object of drawn) growDrawn(object, out);
  return out;
}

/** The volume a head on `lane` sweeps beside side `side`, over the whole run. */
export function laneBox(lane: DoorRig["lane"], side: -1 | 1, out: THREE.Box3): THREE.Box3 {
  const near = side * lane.inner;
  const far = side * (lane.inner + lane.width);
  return out.set(new THREE.Vector3(Math.min(near, far), lane.bottom, -RUN_HALF), new THREE.Vector3(Math.max(near, far), lane.top, RUN_HALF));
}

/** How far (m) boxes `a` and `b` overlap across the car's width and in height, whichever is less (negative: apart). Their length is not asked: every lane runs the car's whole length. */
export function overlapMetres(a: THREE.Box3, b: THREE.Box3): number {
  const across = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const up = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  return Math.min(across, up);
}

/**
 * Fire one shot on a parked car and run it out at 60 Hz the way the engine does (`tyres`: the car in neutral, its tyres on).
 * `stillWhen`: called once per step; once it says so and the ram has passed (its settle hold has begun) the shot ends there.
 */
export function fireRam(
  car: DeformableCar,
  scenario: DoorScenario,
  opts: {
    kph: number;
    kg: number;
    side?: -1 | 1;
    length?: number;
    shape?: DoorRig["shape"];
    carMoves?: boolean;
    tyres?: boolean;
    stillWhen?: (dt: number) => boolean;
    /** Called once the rig has set the car up for the shot and launched the ram, before the first step. */
    onFired?: (rig: DoorRig) => void;
    /** Called after each 60 Hz step's rig step. */
    onStep?: (rig: DoorRig) => void;
  },
): RamShot {
  const rig = new DoorRig();
  rig.attach(car);
  if (opts.length) rig.length = opts.length;
  rig.shape = opts.shape ?? null;
  rig.carMoves = opts.carMoves ?? false;
  rig.fire(scenario, opts.side ?? 1, opts.kph, opts.kg);
  opts.onFired?.(rig);
  const dt = 1 / FRAME_HZ;
  for (let t = 0; t < 30 && rig.phase !== "idle"; t += dt) {
    if (opts.tyres) tyresStep([car], dt);
    car.integrate(dt);
    rig.step(dt);
    opts.onStep?.(rig);
    car.stepBreakage(dt);
    car.updateSkin();
    const readoutHeld = opts.stillWhen?.(dt) ?? false;
    if (readoutHeld && rig.phase === "settle") break;
  }
  return rig.result();
}
