import * as THREE from "three";
import { once } from "../kernel/scalar.ts";
import { MAT } from "../kernel/material-ids.ts";
import { PLATFORM_TYRE } from "../kernel/rig-spec.ts";
import { DOOR_GLASS_SEAT } from "../vehicle/car-glass.ts";
import { wheelsOf } from "../vehicle/car-lines.ts";
import { bumperMaterial, makeWheelGeometry, makeWheelMaterial, treadNormalMap } from "../vehicle/car-materials.ts";
import { ownGeometry, STYLE_PRODUCTS, type StyleProduct } from "../vehicle/car-templates.ts";
import { CAR_STYLES, type BodyStyle, type CarStyleId } from "../vehicle/car-variants.ts";
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

/** Where a product's origin sits in the car's frame (`DeformableCar`'s seats: the door glass on its door's hinge and the bumpers; the rest are drawn in the car's frame). */
type Seat = (style: BodyStyle) => readonly [x: number, y: number, z: number];
const AT_ORIGIN: Seat = () => [0, 0, 0];
/** The door glass's seat on the hinge of the `side` (-1 left, 1 right) door. */
const doorGlassAt = (side: 1 | -1): Seat => (s) => [side * (s.door.hingeX + DOOR_GLASS_SEAT.x), s.door.hingeY + DOOR_GLASS_SEAT.y, s.door.hingeZ + DOOR_GLASS_SEAT.z];

/**
 * The products a parked car draws, each with its shape (a grid cell in m its vertices merge by, `clustered`; or a pane's `"quad"` on its four corners), its seat,
 * and its colour (a number, or a bumper's own trim). The hood, boot lid and door skins are not drawn: the body shell stands under them.
 */
const PARKED_PRODUCTS: Partial<Record<StyleProduct, { shape: number | "quad"; hex: number | "front" | "rear"; seat: Seat }>> = {
  body: { shape: 0.32, hex: PARKED_PAINT, seat: AT_ORIGIN },
  bumperFront: { shape: 0.18, hex: "front", seat: (s) => [0, s.bumpers.front.seat.y, s.bumpers.front.seat.z] },
  bumperRear: { shape: 0.18, hex: "rear", seat: (s) => [0, s.bumpers.rear.seat.y, -s.bumpers.rear.seat.z] },
  windshield: { shape: "quad", hex: PARKED_GLASS, seat: AT_ORIGIN },
  rearGlass: { shape: "quad", hex: PARKED_GLASS, seat: AT_ORIGIN },
  doorGlassLeft: { shape: "quad", hex: PARKED_GLASS, seat: doorGlassAt(-1) },
  doorGlassRight: { shape: "quad", hex: PARKED_GLASS, seat: doorGlassAt(1) },
  quarterGlassLeft: { shape: "quad", hex: PARKED_GLASS, seat: AT_ORIGIN },
  quarterGlassRight: { shape: "quad", hex: PARKED_GLASS, seat: AT_ORIGIN },
};

/** The index in `g` of the vertex with the highest `score`. */
function best(g: THREE.BufferGeometry, score: (v: THREE.Vector3) => number): number {
  const pos = g.getAttribute("position");
  const v = new THREE.Vector3();
  let at = 0;
  let most = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const s = score(v.fromBufferAttribute(pos, i));
    if (s > most) {
      most = s;
      at = i;
    }
  }
  return at;
}

/**
 * A near-flat pane as two triangles on its four extreme corners, facing as it does: the point farthest from its middle, the one farthest from that, then the farthest each side of the line
 * between them. A decimation tears a flat sheet into slivers; every point here is the pane's own, so none stands off its outline.
 */
function paneQuad(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute("position");
  const normal = g.getAttribute("normal");
  const middle = new THREE.Vector3();
  const facing = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    middle.add(v.fromBufferAttribute(pos, i));
    facing.add(v.fromBufferAttribute(normal, i));
  }
  middle.divideScalar(pos.count);
  const a = best(g, (p) => p.distanceToSquared(middle));
  const from = new THREE.Vector3().fromBufferAttribute(pos, a);
  const b = best(g, (p) => p.distanceToSquared(from));
  const along = new THREE.Vector3().fromBufferAttribute(pos, b).sub(from);
  const side = (p: THREE.Vector3): number => facing.dot(along.clone().cross(p.clone().sub(from)));
  const corners = [a, b, best(g, side), best(g, (p) => -side(p))];
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal"] as const) {
    const source = g.getAttribute(name);
    const to = new Float32Array(12);
    for (let k = 0; k < 4; k++) for (let c = 0; c < 3; c++) to[k * 3 + c] = source.getComponent(corners[k]!, c);
    out.setAttribute(name, new THREE.BufferAttribute(to, 3));
  }
  out.setIndex([0, 1, 2, 0, 3, 1]);
  g.dispose();
  return out;
}

/**
 * `g` with its vertices merged by the `cell`-metre grid they fall in, each merged vertex the mean of its cell's, and the triangles left with three distinct corners kept once (a thin
 * sheet folds onto itself into one face). Edge-collapse decimation tore the body's roof open and left shards; a grid merge keeps a closed shell closed.
 */
function clustered(g: THREE.BufferGeometry, cell: number): THREE.BufferGeometry {
  const pos = g.getAttribute("position");
  const slotOf = new Map<string, number>();
  const sums: number[] = [];
  const counts: number[] = [];
  const merged = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) / cell)},${Math.round(pos.getY(i) / cell)},${Math.round(pos.getZ(i) / cell)}`;
    let slot = slotOf.get(key);
    if (slot === undefined) {
      slot = counts.length;
      slotOf.set(key, slot);
      counts.push(0);
      sums.push(0, 0, 0);
    }
    merged[i] = slot;
    counts[slot]!++;
    for (let c = 0; c < 3; c++) sums[slot * 3 + c]! += pos.getComponent(i, c);
  }
  const position = Float32Array.from(sums, (sum, k) => sum / counts[Math.floor(k / 3)]!);
  const from = g.index ? g.index.array : Uint32Array.from({ length: pos.count }, (_, i) => i);
  const kept: number[] = [];
  const seen = new Set<string>();
  for (let t = 0; t < from.length; t += 3) {
    const [a, b, c] = [merged[from[t]!]!, merged[from[t + 1]!]!, merged[from[t + 2]!]!];
    if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((p, q) => p - q).join();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(a, b, c);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(position, 3));
  out.setIndex(kept);
  out.computeVertexNormals();
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
    const shaped = part.shape === "quad" ? paneQuad(ownGeometry(spec, product)) : clustered(ownGeometry(spec, product), part.shape);
    pieces.push([shaped.translate(x, y, z - centre), colour, MAT.DUMPSTER_STEEL]);
  }
  const scale = CLASSES[STYLE_CLASS[style]].wheelScale;
  const radius = spec.dims.wheel.radius * scale;
  const width = spec.dims.wheel.width * scale;
  for (const [x, , z] of wheelsOf(spec.dims)) {
    pieces.push([cyl(radius, radius, -width / 2, width / 2, PARKED_TYRE_SIDES).rotateZ(Math.PI / 2).translate(x, radius, z - centre), PARKED_BLACK, MAT.TYRE_STACK]);
  }
  return pieces;
}
