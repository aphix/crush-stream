import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { FREEWHEEL, launch, makeCar, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { layOnGround } from "./car-air-points.ts";
import type { DriveInput } from "./car-drive.ts";
import { buildCar } from "./drawn-body.test-util.ts";
import { assertSameNumbers } from "./test-support.ts";
import { setGround } from "../world/ground.ts";

const KPH = 1 / 3.6;
const FRAMES = 300;
const POSE_TOLERANCE = 1e-8;
const GAS: DriveInput = { throttle: 1, steer: 0, brake: 0, ebrake: false, boost: false };

afterEach(() => setGround(null));

/** A sedan driven into a wall at 50 km/h and on; `unseen` keeps `setPartsUnseen` on for every frame. */
function drive(unseen: boolean) {
  const car = makeCar("shape");
  launch(car, 6.2, 0, -Math.PI / 2, -50 * KPH, 0);
  layOnGround(car);
  const w = makeWorld([car], true, false, FREEWHEEL);
  w.pedals.set(car, GAS);
  car.setPartsUnseen(unseen);
  for (let f = 0; f < FRAMES; f++) tickWorld(w);
  return car;
}

function poses(car: ReturnType<typeof drive>): number[] {
  const out: number[] = [];
  for (const [i, o] of car.partObjects().entries()) {
    if (!car.partOn(i)) continue;
    o.position.toArray(out, out.length);
    o.quaternion.toArray(out, out.length);
    o.scale.toArray(out, out.length);
  }
  return out;
}

describe("given a wreck driven on while no camera sees it", () => {
  // mutation: sed -i 's/    if (!onRoad || !this.unseen || p.region !== null) return false;/    return false;/' src/game/vehicle/part-pose-wait.ts
  it("when it is driven, then far fewer part poses are written than when seen, and every one is owed", () => {
    const seen = drive(false);
    const hidden = drive(true);
    expect(hidden.partWrites, `${hidden.partWrites} writes against ${seen.partWrites}`).toBeLessThan(0.5 * seen.partWrites);
    expect(hidden.partsOwed, "poses left owed").toBe(true);
  });

  // mutation: sed -i 's/^    this.poseOwed();$/    this.wait.owed = false;/' src/game/vehicle/car-parts.ts
  it("when it is seen again and settled, then every part stands as in a run that was seen throughout", () => {
    const seen = drive(false);
    const hidden = drive(true);
    hidden.setPartsUnseen(false);
    hidden.settleParts();
    expect(hidden.partsOwed, "nothing owed").toBe(false);
    assertSameNumbers(poses(hidden), poses(seen), "part poses", POSE_TOLERANCE);
  });
});

/** A car struck at 50 km/h whose left door moved (jammed open) after `unseen` frames of the run began; every part is as seen unless a pose was left owed. */
function doorMovedWhileUnseen(unseen: boolean) {
  const car = drive(unseen);
  car.setDoorOpen(-1, 0.9);
  return car;
}

describe("given a wreck whose door moved while no camera saw it", () => {
  // mutation: sed -i '/this.wait.owed) this.poseOwed();/{N;/const o = this.parts\[slot\]/s/^[^\n]*\n//}' src/game/vehicle/car-parts.ts
  it("when its parts' boxes are read for the dummies' world, then they are the seen car's", () => {
    const seen = doorMovedWhileUnseen(false);
    const hidden = doorMovedWhileUnseen(true);
    for (let slot = 0; slot < 8; slot++) {
      if (seen.looseBody(slot) !== null) continue;
      const a = new THREE.Box3();
      const b = new THREE.Box3();
      const oa = seen.partBox(slot, a);
      const ob = hidden.partBox(slot, b);
      assertSameNumbers([...b.min.toArray(), ...b.max.toArray(), ...ob.matrixWorld.elements], [...a.min.toArray(), ...a.max.toArray(), ...oa.matrixWorld.elements], `part ${slot}`, POSE_TOLERANCE);
    }
  });
});

describe("given a wreck whose door moved while no camera saw it and whose mirror is then torn off", () => {
  // mutation: sed -i '/this.wait.owed) this.poseOwed();/{N;/The part leaves in the pose/s/^[^\n]*\n//}' src/game/vehicle/car-parts.ts
  it("when the mirror leaves, then its place and velocity are those of a car that was seen", () => {
    const leave = (unseen: boolean): number[] => {
      const car = doorMovedWhileUnseen(unseen);
      car.breakMirror(-1, new THREE.Vector3(0, 1, 0));
      const out: number[] = [];
      const parts = car.snapshot().parts as { detached: boolean; pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number } }[];
      for (const p of parts) if (p.detached) out.push(p.pos.x, p.pos.y, p.pos.z, p.vel.x, p.vel.y, p.vel.z);
      return out;
    };
    const seen = leave(false);
    expect(seen.length, "a part left").toBeGreaterThan(1);
    assertSameNumbers(leave(true), seen, "the torn mirror's pose", POSE_TOLERANCE);
  });
});

describe("given a wreck whose door moved while no camera saw it", () => {
  // mutation: sed -i '/this.wait.owed) this.poseOwed();/{N;/return super.glassWorld/s/^[^\n]*\n//}' src/game/vehicle/car-parts.ts
  it("when the door pane's centre is read, as the ejection places a thrown driver from it, then it is where the seen car has it", () => {
    for (const pane of ["doorL", "doorR"] as const) {
      const seen = doorMovedWhileUnseen(false).glassWorld(pane, new THREE.Vector3());
      const hidden = doorMovedWhileUnseen(true).glassWorld(pane, new THREE.Vector3());
      assertSameNumbers(hidden.toArray(), seen.toArray(), `${pane} centre`, POSE_TOLERANCE);
    }
  });

  // mutation: sed -i '/this.wait.owed) this.poseOwed();/{N;/super.shatterGlass/s/^[^\n]*\n//}' src/game/vehicle/car-parts.ts
  it("when its door pane shatters, then the shards burst from where the seen car's pane bursts them", () => {
    const burst = (unseen: boolean): number[] => {
      const car = doorMovedWhileUnseen(unseen);
      const out: number[] = [];
      car["onGlass"] = (origin, vel) => void out.push(origin.x, origin.y, origin.z, vel.x, vel.y, vel.z);
      car.smashGlass("doorL");
      return out;
    };
    const seen = burst(false);
    expect(seen.length, "shards burst").toBeGreaterThan(0);
    assertSameNumbers(burst(true), seen, "shard origin and velocity", POSE_TOLERANCE);
  });
});

describe("given a wreck whose door moved while no camera saw it and a shot's ray is cast at it", () => {
  // mutation: sed -i '/^    this.poseOwed();$/{N;/updateMatrixWorld(true)/s/^[^\n]*\n//}' src/game/vehicle/car-parts.ts
  it("when the car is made ready for the ray, then every part's world matrix is the seen car's", () => {
    const seen = doorMovedWhileUnseen(false);
    seen.group.updateMatrixWorld(true);
    const hidden = doorMovedWhileUnseen(true);
    hidden.poseNow();
    for (const [i, o] of seen.partObjects().entries()) {
      if (!seen.partOn(i)) continue;
      assertSameNumbers(hidden.partObjects()[i]!.matrixWorld.elements, o.matrixWorld.elements, `part ${i} matrixWorld`, POSE_TOLERANCE);
    }
  });
});

/** A police car driven into a wall at 50 km/h and on, its sirens on and showing red; `unseen` as for `drive`. */
function policeDrive(unseen: boolean) {
  const car = buildCar("police", "sedan");
  launch(car, 6.2, 0, -Math.PI / 2, -50 * KPH, 0);
  layOnGround(car);
  const w = makeWorld([car], true, false, FREEWHEEL);
  w.pedals.set(car, GAS);
  car.setPartsUnseen(unseen);
  for (let f = 0; f < FRAMES; f++) tickWorld(w);
  car.setSirens(true);
  car.flashSirens(0);
  return car;
}

/** The first siren's index (`lampCount` ends with the bar's red and blue lenses). */
const redSiren = (car: ReturnType<typeof policeDrive>): number => car.lampCount - 2;

function sirenAt(car: ReturnType<typeof policeDrive>): number[] {
  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const kind = car.lampWorld(redSiren(car), pos, dir);
  expect(kind, "the siren is lit").toBe("red");
  return [...pos.toArray(), ...dir.toArray()];
}

function barWorld(car: ReturnType<typeof policeDrive>): number[] {
  const bar = car["lightBar"]!;
  bar.updateWorldMatrix(true, false);
  return [...bar.matrixWorld.elements];
}

describe("given a police wreck whose light bar moved while no camera saw it", () => {
  // mutation: sed -i '/^    this.poseOwed();$/{N;/return super.lampWorld(i, pos, dir, false);/s/^[^\n]*\n//}' src/game/vehicle/car-parts.ts
  it("when its lit siren is placed, then it is where the seen car's is", () => {
    const seen = policeDrive(false);
    const hidden = policeDrive(true);
    const before = barWorld(hidden);
    const target = barWorld(seen);
    expect(Math.max(...before.map((v, i) => Math.abs(v - target[i]!))), "control: the unseen bar stands elsewhere until it is settled").toBeGreaterThan(1e-3);
    assertSameNumbers(sirenAt(hidden), sirenAt(seen), "siren place and axis", POSE_TOLERANCE);
  });

  // mutation: sed -i 's/    if (!this.wait.owed || (kind !== "red" \&\& kind !== "blue")) return kind;/    if (!this.wait.owed) return kind;/' src/game/vehicle/car-parts.ts
  it("when its sirens are off and its siren lamps are asked for, then its poses stay owed", () => {
    const hidden = policeDrive(true);
    hidden.setSirens(false);
    expect(hidden.partsOwed, "control: poses are owed").toBe(true);
    for (const i of [redSiren(hidden), redSiren(hidden) + 1]) expect(hidden.lampWorld(i, new THREE.Vector3(), new THREE.Vector3()), "dark").toBe(null);
    expect(hidden.partsOwed, "still owed").toBe(true);
  });
});
