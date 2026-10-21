import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { detCos, detSin } from "../kernel/physics-core.js";
import { once } from "../kernel/scalar.ts";
import { INTERIOR_MESH } from "./constants.ts";
import { mergeToned, toned } from "./car-materials.ts";
import type { BodyStyle } from "./car-variants.ts";

type Tone = readonly [color: number, roughness: number, metalness: number];

const CARPET: Tone = [0x121417, 0.98, 0];
const TRIM: Tone = [0x16191d, 0.85, 0.05];
const SOFT: Tone = [0x1d2026, 0.7, 0];
const ACCENT: Tone = [0x6c7178, 0.35, 0.85];
const GLOSS: Tone = [0x07090c, 0.12, 0.3];
const HEADLINER: Tone = [0x4c4f55, 0.95, 0];
const LEATHER: Tone = [0x1b1f25, 0.62, 0];
const INSERT: Tone = [0x262a31, 0.8, 0];
const RIM: Tone = [0x1a1c20, 0.55, 0];
const HUB: Tone = [0x22252a, 0.4, 0.3];
const BLACK: Tone = [0x111214, 0.7, 0.4];
const STEEL: Tone = [0x5d6064, 0.5, 0.8];
const PLASTIC: Tone = [0x18191c, 0.6, 0.05];
const ENGINE: Tone = [0x24262a, 0.55, 0.6];
const ALU: Tone = [0x9ea2a8, 0.32, 0.9];

/** Seat backs and the seated driver lean back this far from upright (rad): a 1.74 m dummy's crown clears a 1.28 m roof. */
export const SEAT_RECLINE = 0.44;
/** The steering wheel's centre from the driver's H-point (m, car axes) and its plane's lean from vertical (rad, top away from him). */
export const WHEEL_AT = [0, 0.3, 0.34] as const;
export const WHEEL_TILT = 0.44;
/** The hands' grips on the rim, in the wheel's own frame (m): nine and three o'clock. */
export const WHEEL_GRIP = [0.175, 0, -0.01] as const;
/** The cabin the shell is drawn for (m, car space); `interiorFit` maps it onto each car's. */
export const REF_CABIN = { halfX: 0.8, floor: 0.3, roof: 1.3, rear: -0.72, front: 1.03 } as const;
/** The engine bay the bay set is drawn for (m, car space): a car's bay box maps onto it. Its top is the platform hood's underside at the bay's middle. */
export const REF_BAY = { halfX: 0.75, floor: 0.36, top: 0.709, rear: 1.07, front: 1.9 } as const;
/** The bay opens this far (m) ahead of the hood's cowl edge or the windshield's foot, whichever is further forward, and stops this far inside the hood's nose edge. */
const BAY_CLEAR = { rear: 0.04, front: 0.08 } as const;
/** The trough's floor (m, car y): deep enough that the bay set stands tall in it, clear of the body's floor pan at 0.145. */
const BAY_FLOOR = 0.28;

/** The drawn body's engine bay trough under the hood, as a tub [zRear, zFront, floorY] (`BodyStyle.tubs`): drawn only, the cage's deck stays closed. */
export function bayTub(style: BodyStyle): readonly [number, number, number] {
  return [Math.max(style.hood.z0, style.windshield.base[1]) + BAY_CLEAR.rear, style.hood.z1 - BAY_CLEAR.front, BAY_FLOOR];
}

/** A flat-toned box at (x, y, z), tipped `rx` (rad) about x first. */
const box = (w: number, h: number, d: number, tone: Tone, x: number, y: number, z: number, rx = 0): THREE.BufferGeometry =>
  toned(new THREE.BoxGeometry(w, h, d), ...tone).rotateX(rx).translate(x, y, z);

/** A flat-toned rounded box about the origin, indexed (three builds it unindexed) so it merges with the boxes. */
const rounded = (w: number, h: number, d: number, r: number, tone: Tone, segments = 1): THREE.BufferGeometry =>
  mergeVertices(toned(new RoundedBoxGeometry(w, h, d, segments, r), ...tone));

/** Along the reclined back (up) and out behind it, from the H-point. */
const UP = new THREE.Vector3(0, detCos(SEAT_RECLINE), -detSin(SEAT_RECLINE));
const BACK = new THREE.Vector3(0, -detSin(SEAT_RECLINE), -detCos(SEAT_RECLINE));

/** `geo` leaned back with the seat, its centre `up` along the back and `back` behind it. */
function onBack(geo: THREE.BufferGeometry, x: number, up: number, back: number): THREE.BufferGeometry {
  return geo
    .rotateX(-SEAT_RECLINE)
    .translate(x + UP.x * up + BACK.x * back, UP.y * up + BACK.y * back, UP.z * up + BACK.z * back);
}

/**
 * The cage's interior box, byte-for-byte the shape the first shared interior had: the cage field reads its up-facing triangles
 * through a gone pane, so the drawn kit can change without moving the sim. Built once, never disposed.
 */
export const cageInterior = once((): THREE.BufferGeometry => {
  const dark = [0x14161c, 0.94, 0.04] as const;
  const vinyl = [0x1a1e24, 0.9, 0.05] as const;
  const seat = [0x1c2228, 0.88, 0.06] as const;
  const part = (w: number, h: number, d: number, tone: readonly [number, number, number], x: number, y: number, z: number) =>
    toned(new THREE.BoxGeometry(w, h, d), ...tone).translate(x, y, z);
  const parts = [
    part(0.84, 0.04, 1.28, dark, 0, 0.34, 0.02),
    part(0.82, 0.2, 0.24, dark, 0, 0.6, 0.48),
    part(0.78, 0.02, 1.05, vinyl, 0, 1.08, 0.02),
    part(0.8, 0.55, 0.04, vinyl, 0, 0.62, -0.62),
    toned(new THREE.TorusGeometry(0.11, 0.016, 8, 16), 0x2a2c32, 0.55, 0.2).rotateX(0.55).translate(-0.22, 0.68, 0.36),
  ];
  for (const x of [-0.2, 0.2]) {
    parts.push(part(0.3, 0.08, 0.36, seat, x, 0.4, 0.06));
    parts.push(toned(new THREE.BoxGeometry(0.3, 0.32, 0.07), ...seat).rotateX(-0.12).translate(x, 0.58, 0.06 - 0.16));
  }
  for (const sign of [-1, 1]) parts.push(part(0.03, 0.5, 1.1, vinyl, sign * 0.4, 0.62, 0.02));
  return mergeToned(parts, INTERIOR_MESH);
});

/** Floor, tunnel and console, dash with its binnacle and screen, headliner and the side trim behind and ahead of the doors, in `REF_CABIN`. */
export function cabinGeometry(): THREE.BufferGeometry {
  const parts = [
    box(1.56, 0.03, 1.42, CARPET, 0, 0.315, -0.01),
    box(1.4, 0.03, 0.24, CARPET, 0, 0.4, 0.62, -0.6),
    box(0.22, 0.2, 1.0, TRIM, 0, 0.42, 0.05),
    box(0.2, 0.05, 0.36, SOFT, 0, 0.545, -0.25),
    box(0.24, 0.3, 0.12, TRIM, 0, 0.66, 0.48, -0.35),
    rounded(1.56, 0.18, 0.42, 0.04, TRIM).translate(0, 0.73, 0.62),
    box(1.56, 0.05, 0.5, SOFT, 0, 0.835, 0.65, 0.08),
    box(1.3, 0.012, 0.01, ACCENT, 0, 0.79, 0.41),
    box(0.36, 0.08, 0.16, SOFT, -0.36, 0.89, 0.5),
    box(0.3, 0.06, 0.01, GLOSS, -0.36, 0.875, 0.42, -0.2),
    box(0.26, 0.15, 0.015, GLOSS, 0, 0.93, 0.47, -0.25),
    box(1.44, 0.025, 1.22, HEADLINER, 0, 1.287, -0.1),
  ];
  for (const sign of [-1, 1]) {
    parts.push(box(0.03, 0.5, 0.7, TRIM, sign * 0.785, 0.58, -0.37));
    parts.push(box(0.03, 0.35, 0.17, TRIM, sign * 0.785, 0.48, 0.63));
  }
  return mergeToned(parts, "cabin");
}

/** One front seat about its H-point (+z ahead): bolstered cushion and back, inserts, headrest, base on the rails. The back and headrest, which show through the glass, are rounded; the rest are boxes. */
export function frontSeatGeometry(): THREE.BufferGeometry {
  const parts = [
    box(0.5, 0.1, 0.5, LEATHER, 0, -0.12, 0.1, -0.1),
    box(0.3, 0.012, 0.4, INSERT, 0, -0.068, 0.1, -0.1),
    onBack(rounded(0.5, 0.66, 0.11, 0.04, LEATHER), 0, 0.36, 0.165),
    onBack(box(0.3, 0.5, 0.012, INSERT, 0, 0, 0), 0, 0.36, 0.108),
    onBack(rounded(0.26, 0.17, 0.09, 0.04, LEATHER), 0, 0.82, 0.165),
    box(0.4, 0.08, 0.4, PLASTIC, 0, -0.21, 0.08),
  ];
  for (const sign of [-1, 1]) {
    parts.push(box(0.07, 0.07, 0.46, LEATHER, sign * 0.215, -0.06, 0.1, -0.1));
    parts.push(onBack(box(0.07, 0.56, 0.08, LEATHER, 0, 0, 0), sign * 0.215, 0.34, 0.13));
  }
  return mergeToned(parts, "front seat");
}

/** The rear bench about its middle H-point (+z ahead), `REF_CABIN` wide: cushion, back and two outboard headrests. */
export function rearSeatGeometry(): THREE.BufferGeometry {
  const parts = [
    rounded(1.3, 0.1, 0.42, 0.04, LEATHER).rotateX(-0.08).translate(0, -0.12, 0.08),
    onBack(rounded(1.3, 0.58, 0.1, 0.04, LEATHER), 0, 0.31, 0.16),
    box(1.2, 0.1, 0.35, PLASTIC, 0, -0.22, 0.05),
  ];
  for (const sign of [-1, 1]) {
    parts.push(onBack(box(0.24, 0.13, 0.08, LEATHER, 0, 0, 0), sign * 0.36, 0.7, 0.17));
    parts.push(onBack(box(0.38, 0.44, 0.01, INSERT, 0, 0, 0), sign * 0.33, 0.3, 0.108));
  }
  return mergeToned(parts, "rear seat");
}

/** Rim, hub, three spokes and the column (+z, into the dash), facing the driver down -z. */
export function wheelGeometry(): THREE.BufferGeometry {
  const parts = [
    toned(new THREE.TorusGeometry(0.18, 0.02, 6, 16), ...RIM),
    toned(new THREE.CylinderGeometry(0.06, 0.065, 0.05, 12), ...HUB).rotateX(Math.PI / 2).translate(0, 0, 0.01),
    box(0.26, 0.03, 0.015, HUB, 0, -0.01, 0.005),
    box(0.03, 0.12, 0.015, HUB, 0, -0.1, 0.005),
    toned(new THREE.CylinderGeometry(0.035, 0.045, 0.3, 8), ...PLASTIC).rotateX(Math.PI / 2).translate(0, 0, 0.18),
    box(0.1, 0.09, 0.16, PLASTIC, 0, -0.02, 0.14),
  ];
  return mergeToned(parts, "steering wheel");
}

/**
 * Door card in door-group space (hinge at the A-pillar): panel, armrest, sill cap, speaker and pull. The armrest spans the first lining's box
 * exactly and everything else stands strictly inside it: a torn door's loose box (`boxShape`) is sim.
 */
export function doorCardGeometry(sign: number): THREE.BufferGeometry {
  const parts = [
    box(0.018, 0.06, 0.52, SOFT, -sign * 0.024, 0.02, -0.28),
    box(0.016, 0.5, 0.52, TRIM, -sign * 0.0235, 0, -0.28),
    box(0.014, 0.08, 0.52, SOFT, -sign * 0.0225, 0.21, -0.28),
    toned(new THREE.CylinderGeometry(0.06, 0.06, 0.008, 16), ...BLACK).rotateZ(Math.PI / 2).translate(-sign * 0.0285, -0.15, -0.4),
    box(0.008, 0.02, 0.12, ACCENT, -sign * 0.0285, 0.06, -0.3),
  ];
  return mergeToned(parts, "door card");
}

/**
 * The shared engine bay in `REF_BAY`, a dark mass wall to wall up to the hood's underside: undertray, firewall, aprons and strut
 * towers, rails, a dark block with bare-aluminium heads, intake and plenum, a black cover, exhaust manifolds, radiator and fan,
 * airbox, battery, booster, fuse box, tank, hoses and lamp backs.
 */
export function engineBayGeometry(): THREE.BufferGeometry {
  const along = (geo: THREE.BufferGeometry): THREE.BufferGeometry => geo.rotateX(Math.PI / 2);
  const parts = [
    box(1.5, 0.02, 0.83, BLACK, 0, 0.37, 1.485),
    box(1.5, 0.34, 0.03, TRIM, 0, 0.54, 1.085),
    box(1.3, 0.05, 0.06, TRIM, 0, 0.68, 1.12),
    rounded(0.52, 0.24, 0.46, 0.03, ENGINE).translate(0, 0.5, 1.34),
    rounded(0.3, 0.05, 0.38, 0.02, PLASTIC, 2).translate(0, 0.685, 1.32),
    box(0.2, 0.006, 0.02, ALU, 0, 0.711, 1.24),
    box(0.2, 0.006, 0.02, ALU, 0, 0.711, 1.4),
    along(toned(new THREE.CylinderGeometry(0.06, 0.06, 0.34, 14), ...ALU)).translate(0, 0.64, 1.6),
    along(toned(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 12), ...ALU)).rotateY(0.9).translate(0.22, 0.62, 1.66),
    rounded(0.24, 0.15, 0.26, 0.03, PLASTIC).translate(0.43, 0.6, 1.66),
    box(1.2, 0.26, 0.05, BLACK, 0, 0.5, 1.85),
    box(1.36, 0.04, 0.07, ALU, 0, 0.66, 1.85),
    along(toned(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 18), ...PLASTIC)).translate(0, 0.5, 1.8),
    rounded(0.18, 0.16, 0.22, 0.02, PLASTIC).translate(-0.44, 0.53, 1.66),
    box(0.03, 0.02, 0.03, [0xa8231c, 0.5, 0.2], -0.49, 0.62, 1.6),
    box(0.03, 0.02, 0.03, ALU, -0.39, 0.62, 1.6),
    along(toned(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 16), ...ENGINE)).translate(-0.48, 0.6, 1.16),
    rounded(0.16, 0.08, 0.14, 0.02, PLASTIC).translate(0.48, 0.62, 1.2),
    toned(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 10), 0x5a5a56, 0.5, 0).translate(0.3, 0.62, 1.15),
    along(toned(new THREE.CylinderGeometry(0.022, 0.022, 0.36, 8), ...PLASTIC)).rotateY(-0.5).translate(-0.18, 0.6, 1.62),
  ];
  for (const sign of [-1, 1]) {
    parts.push(rounded(0.2, 0.3, 0.78, 0.03, TRIM).translate(sign * 0.65, 0.52, 1.47));
    parts.push(toned(new THREE.CylinderGeometry(0.07, 0.08, 0.06, 12), ...ALU).translate(sign * 0.6, 0.69, 1.2));
    parts.push(box(0.08, 0.1, 0.8, STEEL, sign * 0.5, 0.43, 1.47));
    parts.push(rounded(0.13, 0.08, 0.42, 0.025, ALU).rotateZ(sign * 0.35).translate(sign * 0.2, 0.64, 1.34));
    parts.push(along(toned(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 8), ...STEEL)).translate(sign * 0.31, 0.47, 1.34));
    for (const z of [1.2, 1.3, 1.4, 1.5]) parts.push(toned(new THREE.CylinderGeometry(0.018, 0.018, 0.08, 6), ...ALU).rotateZ(sign * 1.1).translate(sign * 0.12, 0.69, z));
    parts.push(rounded(0.24, 0.1, 0.1, 0.03, PLASTIC).translate(sign * 0.5, 0.52, 1.86));
  }
  return mergeToned(parts, "engine bay");
}

/** A bare bumper beam on the bumper's seat, its face where the bumper's was (+z out), so a crushed nose never pushes it past the body: shown once the bumper is gone. */
export function crashBarGeometry(): THREE.BufferGeometry {
  const parts = [rounded(1.3, 0.1, 0.06, 0.025, STEEL).translate(0, 0, -0.03)];
  for (const sign of [-1, 1]) parts.push(box(0.08, 0.08, 0.1, STEEL, sign * 0.5, 0, -0.11));
  return mergeToned(parts, "crash bar");
}
