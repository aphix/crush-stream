import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { CAR_STYLE_IDS, type CarStyleId } from "./car-variants.ts";
import { shadowOnlyMaterial } from "./car-materials.ts";
import { DT, paint } from "./test-support.ts";

/**
 * A car's hood, boot lid, doors and bumpers lie on the body's own shell until a crash moves them, so the sun's shadow of an
 * undamaged car is one decimated shell of all of them per style (`restCaster`, drawn by `PartBatch.casters`). They and the body
 * draw into the shadow map themselves only once the car has been hit, a door is open, or a part is off.
 */

/** The share of the whole car's shadow the caster may leave lit, or shade beyond it (the bumpers stand a texel proud of the body). */
const UNDAMAGED_MISSING_MAX = 0.012;
/** A style's caster triangles: under a quarter of its body and flush parts, so the shadow pass costs less than the body casting did. */
const CASTER_TRIANGLES_MAX = 1200;

/** The sun's shadow box over its map (`WorldStage`: 48 m over 1024 texels): one texel in metres. */
const TEXEL = 48 / 1024;
/** The mask's side, in texels: 7.5 m, past any car's footprint. */
const MASK_SIDE = 160;
/** From the ground to the sun (`WorldStage` / `RaceField` sun offset). */
const TO_SUN = new THREE.Vector3(-10, 22, 9).normalize();
const AXIS_U = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), TO_SUN).normalize();
const AXIS_V = new THREE.Vector3().crossVectors(TO_SUN, AXIS_U).normalize();

/** The side three draws into the shadow map: the opposite face unless the material says otherwise. */
const SHADOW_SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide } as const;

const _world = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const;
const _edgeA = new THREE.Vector3();
const _edgeB = new THREE.Vector3();
const _normal = new THREE.Vector3();

/** Fill `mask` with the triangles of `mesh` the shadow pass draws, projected along the sun onto texels centred on `centre`. */
function fillMask(mesh: THREE.Mesh, centre: THREE.Vector3, mask: Uint8Array): void {
  const material = mesh.material as THREE.Material;
  const side = material.shadowSide ?? SHADOW_SIDE[material.side];
  const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const index = mesh.geometry.index;
  const count = index ? index.count : position.count;
  const centreU = centre.dot(AXIS_U);
  const centreV = centre.dot(AXIS_V);
  mesh.updateWorldMatrix(true, false);
  const p = [0, 0, 0, 0, 0, 0];
  for (let t = 0; t < count; t += 3) {
    for (let k = 0; k < 3; k++) {
      const corner = _world[k]!.fromBufferAttribute(position, index ? index.getX(t + k) : t + k).applyMatrix4(mesh.matrixWorld);
      p[k * 2] = (corner.dot(AXIS_U) - centreU) / TEXEL + MASK_SIDE / 2;
      p[k * 2 + 1] = (corner.dot(AXIS_V) - centreV) / TEXEL + MASK_SIDE / 2;
    }
    _normal.crossVectors(_edgeA.subVectors(_world[1]!, _world[0]!), _edgeB.subVectors(_world[2]!, _world[0]!));
    const towardSun = _normal.dot(TO_SUN);
    if ((towardSun > 0 && side === THREE.BackSide) || (towardSun < 0 && side === THREE.FrontSide)) continue;
    const det = (p[2]! - p[0]!) * (p[5]! - p[1]!) - (p[4]! - p[0]!) * (p[3]! - p[1]!);
    if (Math.abs(det) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(p[0]!, p[2]!, p[4]!)));
    const maxX = Math.min(MASK_SIDE - 1, Math.ceil(Math.max(p[0]!, p[2]!, p[4]!)));
    const minY = Math.max(0, Math.floor(Math.min(p[1]!, p[3]!, p[5]!)));
    const maxY = Math.min(MASK_SIDE - 1, Math.ceil(Math.max(p[1]!, p[3]!, p[5]!)));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const qx = x + 0.5 - p[0]!;
        const qy = y + 0.5 - p[1]!;
        const a = (qx * (p[5]! - p[1]!) - (p[4]! - p[0]!) * qy) / det;
        const b = ((p[2]! - p[0]!) * qy - qx * (p[3]! - p[1]!)) / det;
        if (a >= 0 && b >= 0 && a + b <= 1) mask[y * MASK_SIDE + x] = 1;
      }
    }
  }
}

/** The texels of the sun's shadow map the meshes fill (1 = shadowed), around `centre`. */
function sunCoverage(meshes: readonly THREE.Mesh[], centre: THREE.Vector3): Uint8Array {
  const mask = new Uint8Array(MASK_SIDE * MASK_SIDE);
  for (const mesh of meshes) fillMask(mesh, centre, mask);
  return mask;
}

/** Texels `whole` fills that `part` leaves lit, and the texels `whole` fills. */
function uncovered(whole: Uint8Array, part: Uint8Array): { missing: number; of: number } {
  let missing = 0;
  let of = 0;
  for (let i = 0; i < whole.length; i++) {
    if (!whole[i]) continue;
    of++;
    if (!part[i]) missing++;
  }
  return { missing, of };
}

const standingCar = (style: CarStyleId): DeformableCar => {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, style);
  car.deform.setMode("shape");
  car.spawn(8, 12, 12);
  car.group.updateMatrixWorld(true);
  car.updateSkin();
  return car;
};

/** Every mesh of the car that is drawn into the sun's shadow map right now. */
const castingMeshes = (car: DeformableCar): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  car.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.castShadow) out.push(mesh);
  });
  return out;
};

/** The hit's contact held for `frames` frames, the engine's own per-frame calls. */
function hitAndSettle(car: DeformableCar, side: "nose" | "tail" | "right", speed: number, frames: number): void {
  const dir = side === "right" ? car.right : car.forward;
  const sign = side === "tail" ? -1 : 1;
  const at = car.group.position.clone().addScaledVector(dir, side === "right" ? 0.9 : 2.05 * sign);
  at.y = 0.5;
  const inward = dir.clone().multiplyScalar(side === "tail" ? 1 : -1);
  car.applyImpact(at, inward, speed, speed);
  for (let i = 0; i < frames; i++) {
    car.deform.notifyContact();
    car.deform.feedOverlap(at, inward, 0.1, 14, DT);
    car.deform.stepStructure(DT);
    car.syncPose(DT);
    car.stepBreakage(DT);
    car.updateSkin();
  }
}

const styleCases = [
  { it: "sedan", style: "sedan", bar: false },
  { it: "hatchback", style: "hatchback", bar: false },
  { it: "wagon", style: "wagon", bar: false },
  { it: "coupe", style: "coupe", bar: false },
  { it: "pickup", style: "pickup", bar: false },
  { it: "police car", style: "police", bar: true },
] as const;

describe("given a car that has not been in a crash", () => {
  for (const testCase of styleCases) {
    it(`when it is a ${testCase.it}, then only its rest caster${testCase.bar ? " and its light bar cast" : " casts"} a shadow and the shadow covers the ground the whole car's would, to within 1.2 % either way`, () => {
      const car = standingCar(testCase.style);
      const casting = castingMeshes(car);
      assert.equal(casting.length, testCase.bar ? 1 : 0, `${casting.length} meshes of its own cast`);
      assert.ok(car.restCasts, "the rest caster casts");
      const rest = new THREE.Mesh(car.restCaster, shadowOnlyMaterial());
      car.group.add(rest);
      const whole = sunCoverage([car.body, ...car.flushCasters], car.group.position);
      const caster = sunCoverage([rest], car.group.position);
      const gap = uncovered(whole, caster);
      const spill = uncovered(caster, whole);
      assert.ok(gap.of > 2000, `the whole car fills ${gap.of} texels`);
      assert.ok(gap.missing / gap.of <= UNDAMAGED_MISSING_MAX, `${gap.missing} of ${gap.of} texels left lit`);
      assert.ok(spill.missing / gap.of <= UNDAMAGED_MISSING_MAX, `${spill.missing} texels shaded beyond the car's ${gap.of}`);
    });
  }

  for (const style of CAR_STYLE_IDS) {
    it(`when it is a ${style}, then its shadow caster holds at most ${CASTER_TRIANGLES_MAX} triangles`, () => {
      const index = standingCar(style).restCaster.index;
      const triangles = index ? index.count / 3 : 0;
      assert.ok(triangles > 0 && triangles <= CASTER_TRIANGLES_MAX, `${triangles} triangles`);
    });
  }
});

const hitCases = [
  { it: "its nose is hit at 40 m/s", side: "nose", speed: 40, frames: 50 },
  { it: "its tail is hit at 30 m/s", side: "tail", speed: 30, frames: 45 },
  { it: "its right side is hit at 28 m/s", side: "right", speed: 28, frames: 45 },
] as const;

describe("given a car", () => {
  for (const testCase of hitCases) {
    it(`when ${testCase.it}, then its hood, boot lid, doors and bumpers cast shadows as they are`, () => {
      const car = standingCar("sedan");
      hitAndSettle(car, testCase.side, testCase.speed, testCase.frames);
      for (const part of car.flushCasters) assert.ok(part.castShadow, "a flush part does not cast after the hit, torn off or not");
    });
  }

  it("when a door is swung open, then its hood, boot lid, doors and bumpers cast shadows as they are", () => {
    const car = standingCar("sedan");
    car.setDoorOpen(1, 0.6);
    car.updateSkin();
    for (const part of car.flushCasters) assert.ok(part.castShadow, "a flush part does not cast with a door open");
  });

  it("when it is hit and then put back on the grid, then only its rest caster casts a shadow again", () => {
    const car = standingCar("sedan");
    hitAndSettle(car, "nose", 40, 50);
    car.spawn(8, 12, 12);
    car.group.updateMatrixWorld(true);
    car.updateSkin();
    const casting = castingMeshes(car);
    assert.ok(casting.length === 0 && car.restCasts, `${casting.length} meshes of its own cast`);
  });
});
