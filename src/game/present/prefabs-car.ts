import * as THREE from "three";
import { once } from "../kernel/scalar.ts";
import { MAT } from "../kernel/material-ids.ts";
import { PLATFORM_TYRE } from "../kernel/rig-spec.ts";
import { decimate } from "../vehicle/cage-mesh.ts";
import { doorSkinZ } from "../vehicle/car-door-mesh.ts";
import { DOOR_GLASS_SEAT } from "../vehicle/car-glass.ts";
import { wheelsOf } from "../vehicle/car-lines.ts";
import { bumperMaterial, makeWheelGeometry, makeWheelMaterial, treadNormalMap } from "../vehicle/car-materials.ts";
import { ownGeometry, STYLE_PRODUCTS, type StyleProduct } from "../vehicle/car-templates.ts";
import { CAR_STYLES, type BodyStyle, type CarStyleId } from "../vehicle/car-variants.ts";
import { bootPivot } from "../vehicle/hinge-spec.ts";
import { CLASSES, STYLE_CLASS } from "../vehicle/vehicle-classes.ts";
import { STYLE_WHEELS } from "../vehicle/wheel-batch.ts";
import { cyl, type Piece, type PrefabPart } from "./prefab-pieces.ts";

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

/** Parked cars' paint (white, silver, black, red, blue, green, tan, yellow, grey): a car's per-instance tint over its white paint. */
export const PARKED_PAINTS = [0xe9e9e6, 0xa9adb3, 0x1f2124, 0xa5231f, 0x2d4f8c, 0x2f5a3d, 0xb59f78, 0xd7b22e, 0x5f646b];

/** What a parked car is drawn in: the paint (white, so the placement's tint is the car's colour), dark glass, black for tyres and trim, chrome trim. */
const PARKED_PAINT = 0xffffff;
const PARKED_GLASS = 0x1f2226;
const PARKED_BLACK = 0x1d1e22;
const TRIM_HEX = { body: PARKED_PAINT, chrome: 0xc4c8ce, black: PARKED_BLACK } as const;
/** The parked tyre's prism sides: a wheel is a few pixels at a car park's distance. */
const PARKED_TYRE_SIDES = 8;

/** Where a product's origin sits in the car's frame (`DeformableCar`'s seats: the hood and boot lid on their hinges, doors, door glass and bumpers; the rest are drawn in the car's frame). */
type Seat = (style: BodyStyle) => readonly [x: number, y: number, z: number];
const AT_ORIGIN: Seat = () => [0, 0, 0];
/** The door skin's seat on the hinge of the `side` (-1 left, 1 right) door, and the door glass's on it. */
const doorAt = (side: 1 | -1): Seat => (s) => [side * s.door.hingeX, s.door.hingeY, s.door.hingeZ + doorSkinZ(s)];
const doorGlassAt = (side: 1 | -1): Seat => (s) => [side * (s.door.hingeX + DOOR_GLASS_SEAT.x), s.door.hingeY + DOOR_GLASS_SEAT.y, s.door.hingeZ + DOOR_GLASS_SEAT.z];

/**
 * The products a parked car draws (a light bar is not one), each with the vertices it keeps (`decimate`: the shell about the collision cage's size, the rest a few corners),
 * its seat, and its colour (a number, or a bumper's own trim).
 */
const PARKED_PRODUCTS: Partial<Record<StyleProduct, { vertices: number; hex: number | "front" | "rear"; seat: Seat }>> = {
  body: { vertices: 130, hex: PARKED_PAINT, seat: AT_ORIGIN },
  hood: { vertices: 16, hex: PARKED_PAINT, seat: (s) => [0, s.hood.origin[0], s.hood.origin[1]] },
  trunkLid: { vertices: 16, hex: PARKED_PAINT, seat: (s) => [0, ...bootPivot(s.boot)] },
  doorLeft: { vertices: 12, hex: PARKED_PAINT, seat: doorAt(-1) },
  doorRight: { vertices: 12, hex: PARKED_PAINT, seat: doorAt(1) },
  bumperFront: { vertices: 28, hex: "front", seat: (s) => [0, s.bumpers.front.seat.y, s.bumpers.front.seat.z] },
  bumperRear: { vertices: 28, hex: "rear", seat: (s) => [0, s.bumpers.rear.seat.y, -s.bumpers.rear.seat.z] },
  windshield: { vertices: 8, hex: PARKED_GLASS, seat: AT_ORIGIN },
  rearGlass: { vertices: 8, hex: PARKED_GLASS, seat: AT_ORIGIN },
  doorGlassLeft: { vertices: 4, hex: PARKED_GLASS, seat: doorGlassAt(-1) },
  doorGlassRight: { vertices: 4, hex: PARKED_GLASS, seat: doorGlassAt(1) },
  quarterGlassLeft: { vertices: 4, hex: PARKED_GLASS, seat: AT_ORIGIN },
  quarterGlassRight: { vertices: 4, hex: PARKED_GLASS, seat: AT_ORIGIN },
};

/** `g` decimated to about `vertices` of its own vertices, keeping their positions and normals (build-time, once per style). */
function decimated(g: THREE.BufferGeometry, vertices: number): THREE.BufferGeometry {
  const count = g.getAttribute("position").count;
  const index = g.index ? g.index.array : Uint32Array.from({ length: count }, (_, i) => i);
  const { source, tris } = decimate(g.getAttribute("position").array as Float32Array, index, new Uint8Array(count), vertices);
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal"] as const) {
    const from = g.getAttribute(name).array as Float32Array;
    const to = new Float32Array(source.length * 3);
    for (let k = 0; k < source.length; k++) for (let c = 0; c < 3; c++) to[k * 3 + c] = from[source[k]! * 3 + c]!;
    out.setAttribute(name, new THREE.BufferAttribute(to, 3));
  }
  out.setIndex(Array.from(tris));
  g.dispose();
  return out;
}

/**
 * `style`'s intact car as one cheap mesh (`PARKED_PRODUCTS` decimated at their seats, four prism tyres), centred on its footprint and standing on the ground, nose +Z:
 * the paint pieces white, so the placement's tint is the car's colour. A parked car is drawn only, so it carries none of the car's physics, skin or state.
 */
export function parkedCar(style: CarStyleId): Piece[] {
  const spec = CAR_STYLES[style];
  const centre = (spec.dims.overhang.front - spec.dims.overhang.rear) / 2;
  const pieces: Piece[] = [];
  for (const product of STYLE_PRODUCTS) {
    const part = PARKED_PRODUCTS[product];
    if (!part) continue;
    const [x, y, z] = part.seat(spec);
    const colour = typeof part.hex === "number" ? part.hex : TRIM_HEX[spec.bumpers[part.hex].trim ?? "black"];
    pieces.push([decimated(ownGeometry(spec, product), part.vertices).translate(x, y, z - centre), colour, MAT.DUMPSTER_STEEL]);
  }
  const scale = CLASSES[STYLE_CLASS[style]].wheelScale;
  const radius = spec.dims.wheel.radius * scale;
  const width = spec.dims.wheel.width * scale;
  for (const [x, , z] of wheelsOf(spec.dims)) {
    pieces.push([cyl(radius, radius, -width / 2, width / 2, PARKED_TYRE_SIDES).rotateZ(Math.PI / 2).translate(x, radius, z - centre), PARKED_BLACK, MAT.TYRE]);
  }
  return pieces;
}
