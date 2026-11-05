import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CAGES, type BodyPartName } from "../kernel/rig-spec.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { paint } from "../vehicle/test-support.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import { RES_SLOTS, type DeformRig, type MassNode } from "./deform-rig.ts";

const DT = 1 / FINE_HZ;
const NAMES = CAGES.map((c) => c.name);

/** A car whose nose took a 40 m/s hit 2 m ahead, then 50 steps on: cages moved, sensors compressed. */
function crashed(): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene());
  car.spawn(0, 0, 0);
  car.group.updateMatrixWorld(true);
  const hit = car.group.position.clone().addScaledVector(car.forward, 2.05);
  hit.y = 0.4;
  car.applyImpact(hit, car.forward.clone().negate(), 40, 40);
  for (let i = 0; i < 50; i++) car.step(DT);
  return car;
}

/** The plain definitions the memoised ones replaced, read off the car's own cages and sensors. */
function plainStrain(car: DeformableCar, name: BodyPartName): number {
  const cage = car.deform["cageByPart"].get(name)!;
  let max = 0;
  for (let a = 0; a < 8; a++) {
    for (let b = a + 1; b < 8; b++) max = Math.max(max, Math.abs(cage.corners[a]!.distanceTo(cage.corners[b]!) - cage.restCorners[a]!.distanceTo(cage.restCorners[b]!)));
  }
  return max;
}

function plainCompression(car: DeformableCar, name: BodyPartName): number {
  let max = 0;
  for (const s of car.deform["sensors"]) if (car.deform["cages"][s.partIndex]?.spec.name === name && s.compression > max) max = s.compression;
  return max;
}

describe("given a car that has taken a hard nose hit", () => {
  it("when every cage's strain and every part's compression are read, then each equals the plain definition, bit for bit, on the first read and on repeats", () => {
    const car = crashed();
    let moved = 0;
    for (const name of NAMES) {
      const strain = plainStrain(car, name);
      if (strain > 0.001) moved++;
      for (let again = 0; again < 3; again++) {
        expect(car.deform.cageStrain(name), `strain of ${name}`).toBe(strain);
        expect(car.deform.partCompression(name), `compression of ${name}`).toBe(plainCompression(car, name));
      }
    }
    expect(moved, `${moved} cages strained: the hit moved nothing`).toBeGreaterThanOrEqual(2);
    expect(NAMES.some((name) => car.deform.partCompression(name) > 0.05), "no part is compressed: the hit did nothing").toBeTruthy();
  });

  it("when a cage's corner moves between two reads, then the second read measures the new corners, not the earlier read's", () => {
    const car = crashed();
    const name: BodyPartName = "doorLeft";
    const before = car.deform.cageStrain(name);
    const corner = car.deform["cageByPart"].get(name)!.corners[3]!;
    corner.x += 0.07;
    const after = car.deform.cageStrain(name);
    expect(after).toBe(plainStrain(car, name));
    expect(after, "a moved corner leaves the strain as it was").not.toBe(before);
    corner.x -= 0.07;
    expect(car.deform.cageStrain(name), "back where it was, the same answer").toBe(before);
  });

  it("when a corner reads NaN, then the strain is whatever the plain definition says, on every read", () => {
    const car = crashed();
    const name: BodyPartName = "bonnet";
    car.deform["cageByPart"].get(name)!.corners[0]!.y = NaN;
    for (let i = 0; i < 3; i++) expect(Object.is(car.deform.cageStrain(name), plainStrain(car, name))).toBe(true);
  });

  it("when a part name no cage has is asked for, then the strain and the compression are 0", () => {
    const car = crashed();
    expect(car.deform.cageStrain("nope" as BodyPartName)).toBe(0);
    expect(car.deform.partCompression("nope" as BodyPartName)).toBe(0);
  });
});

describe("given a car's glazed cages (the windscreen's, the rear glass's and the doors')", () => {
  const TURN = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0.6, -0.2));
  const SHIFT = new THREE.Vector3(2, -0.5, 1);
  /** How far (m) one corner of the windscreen's aperture is pushed. */
  const PUSH = 0.03;

  it("when every corner of each turns 0.7 rad and shifts 2.3 m as one body, then the glass distortion reads 0 to 1e-9 m; when one windscreen aperture corner is then pushed 3 cm, it reads more than 1 cm and at most 3 cm", () => {
    const car = new DeformableCar(paint(), new THREE.Scene());
    for (const name of ["glassFront", "glassRear", "doorLeft", "doorRight"] as const) {
      const cage = name === "glassFront" ? car.deform["glassFrame"] : car.deform["cageByPart"].get(name)!;
      for (let i = 0; i < 8; i++) cage.corners[i]!.copy(cage.restCorners[i]!).applyQuaternion(TURN).add(SHIFT);
      expect(car.deform.glassDistortion(name), `${name} moved rigidly reads ${car.deform.glassDistortion(name)} m`).toBeLessThan(1e-9);
    }
    car.deform["glassFrame"].corners[3]!.x += PUSH;
    const pushed = car.deform.glassDistortion("glassFront");
    expect(pushed > PUSH / 3 && pushed <= PUSH, `one corner pushed ${PUSH} m reads ${pushed} m`).toBeTruthy();
  });

  it("when a cage holds no pane, then its glass distortion is 0", () => {
    expect(crashed().deform.glassDistortion("bonnet")).toBe(0);
  });

  /** The masses the eight corners from point row `first` follow (their A5 parents, weight above 0): a cage's, or the glass frame's (`first` = the cage count). */
  function parentsFrom(rig: DeformRig, first: number): MassNode[] {
    const found = new Set<MassNode>();
    for (let corner = 0; corner < 8; corner++) {
      const at = (rig["vertexCount"] + first * 8 + corner) * RES_SLOTS;
      for (let slot = 0; slot < RES_SLOTS; slot++) if (rig["resW"][at + slot]! > 0) found.add(rig["masses"][rig["resJ"][at + slot]! / 3]!);
    }
    return [...found];
  }
  const parentsOf = (rig: DeformRig, name: BodyPartName): MassNode[] => parentsFrom(rig, rig["cages"].findIndex((c) => c.spec.name === name));

  it("when each door cage's corners' and the glass frame's parent masses are listed, then every one is a cabin mass (its rest inside the cell cage's span above its floor), never a wing, a rail or the engine, the glass frame's never the roof mass, and only the glass frame's four cowl corners take the cell-holding clusters' rotation without their strain, whereas the bonnet's follow masses outside the cabin", () => {
    const rig = new DeformableCar(paint(), new THREE.Scene()).deform;
    const cell = rig["cageByPart"].get("chassisCell")!.spec;
    const inCabin = (m: MassNode): boolean => m.rest.z >= cell.min[2] && m.rest.z <= cell.max[2] && m.rest.y >= cell.min[1];
    const outside = (name: BodyPartName): string[] => parentsOf(rig, name).filter((m) => !inCabin(m)).map((m) => m.name).sort();
    for (const name of ["doorLeft", "doorRight"] as const) expect(outside(name), `${name}'s corners follow masses outside the cabin`).toHaveLength(0);
    const frame = parentsFrom(rig, rig["cages"].length);
    expect(frame.filter((m) => !inCabin(m)).map((m) => m.name), "the glass frame's corners follow masses outside the cabin").toHaveLength(0);
    expect(frame.map((m) => m.name), "the glass frame never follows the roof mass").not.toContain("roof");
    const corners = rig["cages"].length * 8;
    const turnOnly = Array.from(rig["cornerTurnOnly"]).flatMap((flag, corner) => (flag === 1 ? [corner - corners] : []));
    expect(turnOnly.join(), "the corners that take a turn without strain: the glass frame's cowl corners alone").toBe("4,5,6,7");
    expect(rig["cornerStart"][corners + 5]! - rig["cornerStart"][corners + 4]!, "the cowl corner's cluster maps").toBeGreaterThan(0);
    expect(outside("bonnet").length, "the control: the bonnet's corners follow the nose").toBeGreaterThan(0);
  });

  it("when the windscreen cage's corners' parents (the contact cage's) are listed, then they follow the cabin and the nose mass at the A-pillar foot's share, not the glass frame's roofless rule", () => {
    const rig = new DeformableCar(paint(), new THREE.Scene()).deform;
    const contact = parentsOf(rig, "glassFront").map((m) => m.name).sort();
    expect(contact, "the contact windscreen's parents").toEqual(["cell", "doorL", "doorR", "roof", "wingFL", "wingFR"]);
  });

  it("when every mass of a car at rest turns rigidly 0.5 degrees about the car's x, y or z axis and the skin is baked, then no glazed cage reads over 0.5 mm of aperture distortion: a cabin turning as one racks no glass", () => {
    for (const axis of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]) {
      const car = new DeformableCar(paint(), new THREE.Scene());
      const turn = new THREE.Quaternion().setFromAxisAngle(axis, (0.5 * Math.PI) / 180);
      for (const m of car.deform.masses) m.local.copy(m.rest).applyQuaternion(turn);
      car.deform.bakeSkin();
      for (const name of ["glassFront", "glassRear", "doorLeft", "doorRight"] as const) {
        const read = car.deform.glassDistortion(name);
        expect(read, `${name} read ${read} m after a 0.5 degree turn about (${axis.toArray().join(", ")})`).toBeLessThan(0.0005);
      }
    }
  });

  it("when a crashed car is reset, then its glass frame is back at rest and the windscreen reads no distortion: a respawned car is not cracked by its last life's frame", () => {
    const car = crashed();
    expect(car.deform.glassDistortion("glassFront"), "the control: the crash distorted the frame").toBeGreaterThan(0);
    car.deform.reset();
    expect(car.deform.glassDistortion("glassFront")).toBeLessThan(1e-9);
  });
});
