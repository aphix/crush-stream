import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { bumperMaterial, makePaintMaterial, trimMaterial } from "../vehicle/car-materials.ts";
import { applyDetailMap, ensureRestFrame, REST_FRAME_ATTRIBUTES } from "../vehicle/car-detail-map.ts";
import { CAR_SPRAY, carPickText, NO_CAR_PICK, type CarPart, type CarPick } from "../match/look-data.ts";
import { applySpray, BARE_SPRAY, sprayUniforms, type SprayBitmap } from "./spray.ts";

/** What wearing a look changed on a car: its own lid and door paints, the spray's uniforms, and the colours it had before. */
type Worn = {
  uniforms: Record<string, THREE.IUniform>;
  hood: THREE.MeshPhysicalMaterial;
  trunk: THREE.MeshPhysicalMaterial;
  doors: THREE.MeshPhysicalMaterial;
  bumpers: readonly THREE.Mesh[];
  base: CarBase;
};

/** A car's own colours: its body and door paint, bumper trim and glass (sRGB). */
type CarBase = { body: number; doors: number; bumpers: number; glass: number };

const worn = new WeakMap<DeformableCar, Worn>();
const DEFAULT_PICK = carPickText(NO_CAR_PICK);
/** Rims as built: white is the instance tint (`WheelBatch`) that leaves the alloy as toned. */
const RIMS_AS_BUILT = 0xffffff;

/**
 * Car `car` in a player's colours (`pick`, null fields: its own paint) and spray (`spray`, a `CAR_SPRAY` bitmap, or none).
 * The first look a car wears gives its lids and doors their own paint, so each part takes its colour, and puts the spray
 * under the paint of all of them; a car that never wears one keeps the fleet's shared paint. Wearing `NO_CAR_PICK` with no
 * spray puts its own colours back.
 */
export function wearCarLook(car: DeformableCar, pick: CarPick, spray: SprayBitmap | null): void {
  let w = worn.get(car);
  if (!w) {
    if (carPickText(pick) === DEFAULT_PICK && !spray) return;
    w = firstWear(car);
    worn.set(car, w);
  }
  const m = car.lookMeshes();
  const c = lookColours(car, pick);
  m.bodyPaint.color.setHex(c.body);
  w.hood.color.setHex(c.hood);
  w.trunk.color.setHex(c.trunk);
  w.doors.color.setHex(c.doors);
  car.setPartPaint(c.body, c.doors);
  const ends = [car.style.bumpers.front, car.style.bumpers.rear];
  for (let i = 0; i < w.bumpers.length; i++) w.bumpers[i]!.material = pick.bumpers === null ? bumperMaterial(ends[i]!.trim, c.bumpers, c.body) : trimMaterial(c.bumpers);
  car.setGlassTint(c.glass);
  for (const wheel of car.wheels) {
    if (c.rims === RIMS_AS_BUILT) delete wheel.userData.rim;
    else wheel.userData.rim = new THREE.Color(c.rims);
  }
  w.uniforms.sprayMap!.value = spray?.texture ?? BARE_SPRAY;
}

/** Each part's colour (sRGB) as car `car` draws with `pick` on: a part not picked shows the car's own, the lids and doors the body's pick. */
export function lookColours(car: DeformableCar, pick: CarPick): Record<CarPart, number> {
  const base = worn.get(car)?.base ?? baseOf(car);
  const body = pick.body ?? base.body;
  return {
    body,
    doors: pick.doors ?? pick.body ?? base.doors,
    hood: pick.hood ?? body,
    trunk: pick.trunk ?? body,
    bumpers: pick.bumpers ?? base.bumpers,
    rims: pick.rims ?? RIMS_AS_BUILT,
    glass: pick.glass ?? base.glass,
  };
}

function baseOf(car: DeformableCar): CarBase {
  const m = car.lookMeshes();
  return {
    body: m.bodyPaint.color.getHex(),
    doors: (m.doors[0]!.material as THREE.MeshPhysicalMaterial).color.getHex(),
    bumpers: car.style.livery?.accent ?? car.paint.accent,
    glass: (m.glass[0]!.material as THREE.MeshStandardMaterial).color.getHex(),
  };
}

function firstWear(car: DeformableCar): Worn {
  const m = car.lookMeshes();
  const base = baseOf(car);
  const w: Worn = {
    uniforms: sprayUniforms(CAR_SPRAY, BARE_SPRAY, 1),
    hood: makePaintMaterial(base.body),
    trunk: makePaintMaterial(base.body),
    doors: makePaintMaterial(base.doors),
    bumpers: m.bumpers,
    base,
  };
  m.hood.material = w.hood;
  m.trunk.material = w.trunk;
  for (const door of m.doors) door.material = w.doors;
  for (const paint of [w.hood, w.trunk, w.doors]) applyDetailMap(paint, car.style);
  for (const paint of [m.bodyPaint, w.hood, w.trunk, w.doors]) {
    applySpray(paint, w.uniforms, REST_FRAME_ATTRIBUTES, "vSprayP = sprayPos;\nvSprayN = sprayNrm;\nvSprayRow = 0.0;", "car");
  }
  for (const mesh of [m.body, m.hood, m.trunk, ...m.doors]) ensureRestFrame(mesh, car.group);
  return w;
}
