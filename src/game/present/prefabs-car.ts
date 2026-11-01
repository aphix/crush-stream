import * as THREE from "three";
import { once } from "../kernel/scalar.ts";
import { PLATFORM_TYRE } from "../kernel/rig-spec.ts";
import { bumperMaterial, makeWheelGeometry, makeWheelMaterial, treadNormalMap } from "../vehicle/car-materials.ts";
import { ownGeometry } from "../vehicle/car-templates.ts";
import { CAR_STYLES, type CarStyleId } from "../vehicle/car-variants.ts";
import { CLASSES, STYLE_CLASS } from "../vehicle/vehicle-classes.ts";
import { STYLE_WHEELS } from "../vehicle/wheel-batch.ts";
import type { PrefabPart } from "./prefab-pieces.ts";

/** The wheel batch's material, one for every thrown wheel and never disposed (as the batch's lanes' are not). */
const wheelMaterial = once((): THREE.Material => {
  const m = makeWheelMaterial();
  m.normalMap = treadNormalMap();
  return m;
});

/** `style`'s front bumper as the car draws it, resting on its lower edge at the middle of its depth. */
export function frontBumper(style: CarStyleId): PrefabPart[] {
  const spec = CAR_STYLES[style].bumpers.front;
  const geometry = ownGeometry(CAR_STYLES[style], "bumperFront");
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  return [{ geometry, material: bumperMaterial(spec.trim, 0, 0), shared: false }];
}

/** `style`'s wheel as the batch draws it, lying on its face (axle up) at the class's tyre size: radius and width scaled by `wheelScale`. */
export function lyingWheel(style: CarStyleId): PrefabPart[] {
  const { radius, width } = CAR_STYLES[style].dims.wheel;
  const scale = CLASSES[STYLE_CLASS[style]].wheelScale;
  const across = (width / 2 / PLATFORM_TYRE.halfW) * scale;
  const round = (radius / PLATFORM_TYRE.r) * scale;
  const geometry = makeWheelGeometry(STYLE_WHEELS[style].design).rotateZ(Math.PI / 2).scale(round, across, round);
  geometry.computeBoundingBox();
  geometry.translate(0, -geometry.boundingBox!.min.y, 0);
  return [{ geometry, material: wheelMaterial(), shared: false }];
}
