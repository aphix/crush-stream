import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { detCos, detSin } from "../kernel/physics-core.js";
import { once } from "../kernel/scalar.ts";
import { MAT } from "../kernel/material-ids.ts";
import { DRIVER_SIDE, INTERIOR_MESH } from "./constants.ts";
import { mergeToned, toned } from "./car-materials.ts";
import { carTone, type Tone } from "./car-tones.ts";

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
 * The cage's interior box, the shape the first shared interior had with its wheel on the driver's side (`DRIVER_SIDE`): the cage
 * field reads its up-facing triangles through a gone pane, so the drawn kit can change without moving the sim. Built once, never disposed.
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
    toned(new THREE.TorusGeometry(0.11, 0.016, 8, 16), 0x2a2c32, 0.55, 0.2).rotateX(0.55).translate(DRIVER_SIDE * 0.22, 0.68, 0.36),
  ];
  for (const x of [-0.2, 0.2]) {
    parts.push(part(0.3, 0.08, 0.36, seat, x, 0.4, 0.06));
    parts.push(toned(new THREE.BoxGeometry(0.3, 0.32, 0.07), ...seat).rotateX(-0.12).translate(x, 0.58, 0.06 - 0.16));
  }
  for (const sign of [-1, 1]) parts.push(part(0.03, 0.5, 1.1, vinyl, sign * 0.4, 0.62, 0.02));
  return mergeToned(parts, INTERIOR_MESH);
});

/** Floor, tunnel and console, dash with its binnacle and screen, and the side trim behind and ahead of the doors, in `REF_CABIN` (the headliner is the drawn roof's inner face). */
export function cabinGeometry(): THREE.BufferGeometry {
  const parts = [
    box(1.56, 0.03, 1.42, carTone(MAT.CABIN_CARPET), 0, 0.315, -0.01),
    box(1.4, 0.03, 0.24, carTone(MAT.CABIN_CARPET), 0, 0.4, 0.62, -0.6),
    box(0.22, 0.2, 1.0, carTone(MAT.CABIN_HARD_PLASTIC), 0, 0.42, 0.05),
    box(0.2, 0.05, 0.36, carTone(MAT.CABIN_SOFT_TOUCH), 0, 0.545, -0.25),
    box(0.24, 0.3, 0.12, carTone(MAT.CABIN_HARD_PLASTIC), 0, 0.66, 0.48, -0.35),
    rounded(1.56, 0.18, 0.42, 0.04, carTone(MAT.DASH_PLASTIC)).translate(0, 0.73, 0.62),
    box(1.56, 0.05, 0.5, carTone(MAT.DASH_SOFT_TOUCH), 0, 0.835, 0.65, 0.08),
    box(1.3, 0.012, 0.01, carTone(MAT.CABIN_TRIM_BRIGHT), 0, 0.79, 0.41),
    box(0.36, 0.08, 0.16, carTone(MAT.DASH_SOFT_TOUCH), DRIVER_SIDE * 0.36, 0.89, 0.5),
    box(0.3, 0.06, 0.01, carTone(MAT.CABIN_SCREEN), DRIVER_SIDE * 0.36, 0.875, 0.42, -0.2),
    box(0.26, 0.15, 0.015, carTone(MAT.CABIN_SCREEN), 0, 0.93, 0.47, -0.25),
  ];
  for (const sign of [-1, 1]) {
    parts.push(box(0.03, 0.5, 0.7, carTone(MAT.CABIN_HARD_PLASTIC), sign * 0.785, 0.58, -0.37));
    parts.push(box(0.03, 0.35, 0.17, carTone(MAT.CABIN_HARD_PLASTIC), sign * 0.785, 0.48, 0.63));
  }
  return mergeToned(parts, "cabin");
}

/** One front seat about its H-point (+z ahead): bolstered cushion and back, inserts, headrest, base on the rails. The back and headrest, which show through the glass, are rounded; the rest are boxes. */
export function frontSeatGeometry(): THREE.BufferGeometry {
  const parts = [
    box(0.5, 0.1, 0.5, carTone(MAT.SEAT_LEATHER), 0, -0.12, 0.1, -0.1),
    box(0.3, 0.012, 0.4, carTone(MAT.SEAT_CLOTH), 0, -0.068, 0.1, -0.1),
    onBack(rounded(0.5, 0.66, 0.11, 0.04, carTone(MAT.SEAT_LEATHER)), 0, 0.36, 0.165),
    onBack(box(0.3, 0.5, 0.012, carTone(MAT.SEAT_CLOTH), 0, 0, 0), 0, 0.36, 0.108),
    onBack(rounded(0.26, 0.17, 0.09, 0.04, carTone(MAT.SEAT_LEATHER)), 0, 0.82, 0.165),
    box(0.4, 0.08, 0.4, carTone(MAT.SEAT_BASE), 0, -0.21, 0.08),
  ];
  for (const sign of [-1, 1]) {
    parts.push(box(0.07, 0.07, 0.46, carTone(MAT.SEAT_LEATHER), sign * 0.215, -0.06, 0.1, -0.1));
    parts.push(onBack(box(0.07, 0.56, 0.08, carTone(MAT.SEAT_LEATHER), 0, 0, 0), sign * 0.215, 0.34, 0.13));
  }
  return mergeToned(parts, "front seat");
}

/** The rear bench about its middle H-point (+z ahead), `REF_CABIN` wide: cushion, back and two outboard headrests. */
export function rearSeatGeometry(): THREE.BufferGeometry {
  const parts = [
    rounded(1.3, 0.1, 0.42, 0.04, carTone(MAT.SEAT_LEATHER)).rotateX(-0.08).translate(0, -0.12, 0.08),
    onBack(rounded(1.3, 0.58, 0.1, 0.04, carTone(MAT.SEAT_LEATHER)), 0, 0.31, 0.16),
    box(1.2, 0.1, 0.35, carTone(MAT.SEAT_BASE), 0, -0.22, 0.05),
  ];
  for (const sign of [-1, 1]) {
    parts.push(onBack(box(0.24, 0.13, 0.08, carTone(MAT.SEAT_LEATHER), 0, 0, 0), sign * 0.36, 0.7, 0.17));
    parts.push(onBack(box(0.38, 0.44, 0.01, carTone(MAT.SEAT_CLOTH), 0, 0, 0), sign * 0.33, 0.3, 0.108));
  }
  return mergeToned(parts, "rear seat");
}

/** Rim, hub, three spokes and the column (+z, into the dash), facing the driver down -z. */
export function wheelGeometry(): THREE.BufferGeometry {
  const parts = [
    toned(new THREE.TorusGeometry(0.18, 0.02, 6, 16), ...carTone(MAT.STEERING_RIM)),
    toned(new THREE.CylinderGeometry(0.06, 0.065, 0.05, 12), ...carTone(MAT.STEERING_HUB)).rotateX(Math.PI / 2).translate(0, 0, 0.01),
    box(0.26, 0.03, 0.015, carTone(MAT.STEERING_HUB), 0, -0.01, 0.005),
    box(0.03, 0.12, 0.015, carTone(MAT.STEERING_HUB), 0, -0.1, 0.005),
    toned(new THREE.CylinderGeometry(0.035, 0.045, 0.3, 8), ...carTone(MAT.STEERING_COLUMN)).rotateX(Math.PI / 2).translate(0, 0, 0.18),
    box(0.1, 0.09, 0.16, carTone(MAT.STEERING_COLUMN), 0, -0.02, 0.14),
  ];
  return mergeToned(parts, "steering wheel");
}

/**
 * Door card in door-group space (hinge at the A-pillar): panel, armrest, sill cap, speaker and pull. The armrest spans the first lining's box
 * exactly and everything else stands strictly inside it: a torn door's loose box (`boxShape`) is sim.
 */
export function doorCardGeometry(sign: number): THREE.BufferGeometry {
  const parts = [
    box(0.018, 0.06, 0.52, carTone(MAT.DOOR_ARMREST), -sign * 0.024, 0.02, -0.28),
    box(0.016, 0.5, 0.52, carTone(MAT.DOOR_CARD), -sign * 0.0235, 0, -0.28),
    box(0.014, 0.08, 0.52, carTone(MAT.DOOR_ARMREST), -sign * 0.0225, 0.21, -0.28),
    toned(new THREE.CylinderGeometry(0.06, 0.06, 0.008, 16), ...carTone(MAT.SPEAKER_CONE)).rotateZ(Math.PI / 2).translate(-sign * 0.0285, -0.15, -0.4),
    box(0.008, 0.02, 0.12, carTone(MAT.CABIN_TRIM_BRIGHT), -sign * 0.0285, 0.06, -0.3),
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
    box(1.5, 0.02, 0.83, carTone(MAT.BAY_UNDERTRAY), 0, 0.37, 1.485),
    box(1.5, 0.34, 0.03, carTone(MAT.FIREWALL_STEEL), 0, 0.54, 1.085),
    box(1.3, 0.05, 0.06, carTone(MAT.COWL_PLASTIC), 0, 0.68, 1.12),
    rounded(0.52, 0.24, 0.46, 0.03, carTone(MAT.ENGINE_CAST_IRON)).translate(0, 0.5, 1.34),
    rounded(0.3, 0.05, 0.38, 0.02, carTone(MAT.ENGINE_COVER), 2).translate(0, 0.685, 1.32),
    box(0.2, 0.006, 0.02, carTone(MAT.ENGINE_ALUMINIUM), 0, 0.711, 1.24),
    box(0.2, 0.006, 0.02, carTone(MAT.ENGINE_ALUMINIUM), 0, 0.711, 1.4),
    along(toned(new THREE.CylinderGeometry(0.06, 0.06, 0.34, 14), ...carTone(MAT.INTAKE_PIPE))).translate(0, 0.64, 1.6),
    along(toned(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 12), ...carTone(MAT.INTAKE_PIPE))).rotateY(0.9).translate(0.22, 0.62, 1.66),
    rounded(0.24, 0.15, 0.26, 0.03, carTone(MAT.AIRBOX)).translate(0.43, 0.6, 1.66),
    box(1.2, 0.26, 0.05, carTone(MAT.RADIATOR_CORE), 0, 0.5, 1.85),
    box(1.36, 0.04, 0.07, carTone(MAT.RADIATOR_TANK), 0, 0.66, 1.85),
    along(toned(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 18), ...carTone(MAT.FAN_PLASTIC))).translate(0, 0.53, 1.8),
    rounded(0.18, 0.16, 0.22, 0.02, carTone(MAT.BATTERY_CASE)).translate(-0.44, 0.53, 1.66),
    box(0.03, 0.02, 0.03, carTone(MAT.BATTERY_TERMINAL), -0.49, 0.62, 1.6),
    box(0.03, 0.02, 0.03, carTone(MAT.ENGINE_ALUMINIUM), -0.39, 0.62, 1.6),
    along(toned(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 16), ...carTone(MAT.BRAKE_BOOSTER))).translate(-0.48, 0.6, 1.16),
    rounded(0.16, 0.08, 0.14, 0.02, carTone(MAT.FUSE_BOX)).translate(0.48, 0.62, 1.2),
    toned(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 10), ...carTone(MAT.RESERVOIR)).translate(0.3, 0.62, 1.15),
    along(toned(new THREE.CylinderGeometry(0.022, 0.022, 0.36, 8), ...carTone(MAT.RUBBER_HOSE))).rotateY(-0.5).translate(-0.18, 0.6, 1.62),
  ];
  for (const sign of [-1, 1]) {
    parts.push(rounded(0.2, 0.3, 0.78, 0.03, carTone(MAT.INNER_FENDER_STEEL)).translate(sign * 0.65, 0.52, 1.47));
    parts.push(toned(new THREE.CylinderGeometry(0.07, 0.08, 0.06, 12), ...carTone(MAT.STRUT_TOWER_STEEL)).translate(sign * 0.6, 0.69, 1.2));
    parts.push(box(0.08, 0.1, 0.8, carTone(MAT.CRASH_BAR_STEEL), sign * 0.5, 0.43, 1.47));
    parts.push(rounded(0.13, 0.08, 0.42, 0.025, carTone(MAT.ENGINE_ALUMINIUM)).rotateZ(sign * 0.35).translate(sign * 0.2, 0.64, 1.34));
    parts.push(along(toned(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 8), ...carTone(MAT.EXHAUST_MANIFOLD))).translate(sign * 0.31, 0.47, 1.34));
    for (const z of [1.2, 1.3, 1.4, 1.5]) parts.push(toned(new THREE.CylinderGeometry(0.018, 0.018, 0.08, 6), ...carTone(MAT.INTAKE_RUNNER)).rotateZ(sign * 1.1).translate(sign * 0.12, 0.69, z));
    parts.push(rounded(0.24, 0.1, 0.1, 0.03, carTone(MAT.LAMP_HOUSING)).translate(sign * 0.5, 0.52, 1.86));
  }
  return mergeToned(parts, "engine bay");
}

/** The crash bar's half span (m) as built, before a car fits it between its wheels (`CarCabin`). */
export const CRASH_BAR_HALF = 0.65;

/** A bare bumper beam on the bumper's seat, its face where the bumper's was (+z out), so a crushed nose never pushes it past the body: shown once the bumper is gone. */
export function crashBarGeometry(): THREE.BufferGeometry {
  const parts = [rounded(2 * CRASH_BAR_HALF, 0.1, 0.06, 0.025, carTone(MAT.CRASH_BAR_STEEL)).translate(0, 0, -0.03)];
  for (const sign of [-1, 1]) parts.push(box(0.08, 0.08, 0.1, carTone(MAT.CRASH_BAR_STEEL), sign * 0.5, 0, -0.11));
  return mergeToned(parts, "crash bar");
}

/** The monster's half track (m): its axle tube runs hub to hub, and `CarUnderbody` scales it across another span. */
export const AXLE_HALF_SPAN = 1.195;
/** The coil-overs' line across the car (m), both axles: inboard under the flare, inside the arch lip's shadow and 11 cm clear of the tyre's inner face. */
const COILOVER_X = 0.68;
/** The frame's main rails: their middle's z and their length (m), the frame's whole length (`CarUnderbody.fit` shortens it with a crush). */
export const FRAME_RAIL_Z = -0.15;
export const FRAME_RAIL_LENGTH = 4.1;
/** The main rails' height (m, centre) in the body's space: the frame's reference level for what hangs below it. */
export const FRAME_RAIL_Y = 0.26;

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

/** A round bar from `a` to `b` (x, y, z). */
function rod(a: readonly number[], b: readonly number[], r: number, tone: Tone): THREE.BufferGeometry {
  _dir.set(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
  const geo = toned(new THREE.CylinderGeometry(r, r, _dir.length(), 8), ...tone);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, _dir.normalize()));
  return geo.translate((a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2, (a[2]! + b[2]!) / 2);
}

/** Turns a coil-over's spring shows (the coils' tone bands, the gaps' dark and set in), at its 0.36 m length. */
const SPRING_TURNS = 4;

/** A coil spring centred at (x, y, z) as open rings, coil and gap in turn: reads as wound wire without the wire's triangles. */
function coil(x: number, y: number, z: number): THREE.BufferGeometry[] {
  const bands = 2 * SPRING_TURNS - 1;
  const h = 0.36 / bands;
  return Array.from({ length: bands }, (_, i) =>
    // The gap between turns is the coil's shadow: the dark the brackets draw with.
    toned(new THREE.CylinderGeometry(i % 2 ? 0.075 : 0.085, i % 2 ? 0.075 : 0.085, h, 10, 1, true), ...carTone(i % 2 ? MAT.SUSPENSION_BRACKET : MAT.COIL_SPRING)).translate(x, y - 0.18 + (i + 0.5) * h, z),
  );
}

/**
 * The lifted truck's ladder frame in its body's space (the class lift's, the floor 0.34 up): rails and crossmembers up against the
 * floor, the transfer case, the steering box, the links' mounts, and each corner's coil-overs standing up into the wheel well from
 * their bracket on the rail, which the axle's shafts slide into.
 */
export function ladderFrameGeometry(): THREE.BufferGeometry {
  const parts = [box(0.24, 0.14, 0.3, carTone(MAT.TRANSFER_CASE), 0, 0.02, 0), box(0.14, 0.14, 0.18, carTone(MAT.STEERING_BOX), 0.36, 0.2, 1.6)];
  for (const z of [1.75, 0.635, -0.635, -2.1]) parts.push(box(0.9, 0.08, 0.08, carTone(MAT.FRAME_RAIL_STEEL), 0, 0.28, z));
  for (const sign of [-1, 1]) {
    parts.push(box(0.09, 0.16, FRAME_RAIL_LENGTH, carTone(MAT.FRAME_RAIL_STEEL), sign * 0.45, FRAME_RAIL_Y, FRAME_RAIL_Z));
    // The side reference's lower rails at the hubs' height, stopping short of the axle tubes, braced up to the main rails by a V.
    parts.push(box(0.07, 0.08, 2.4, carTone(MAT.FRAME_RAIL_STEEL), sign * 0.4, -0.13, 0));
    for (const z of [-0.15, 0.15]) parts.push(rod([sign * 0.4, -0.13, z], [sign * 0.45, 0.22, z + Math.sign(z) * 0.28], 0.03, carTone(MAT.FRAME_RAIL_STEEL)));
    for (const axle of [-1.385, 1.385]) {
      const mid = -Math.sign(axle);
      parts.push(box(0.32, 0.06, 0.34, carTone(MAT.SUSPENSION_BRACKET), sign * 0.6, 0.26, axle));
      parts.push(box(0.16, 0.05, 0.36, carTone(MAT.SUSPENSION_BRACKET), sign * COILOVER_X, 0.72, axle));
      parts.push(box(0.06, 0.3, 0.1, carTone(MAT.SUSPENSION_BRACKET), sign * 0.5, 0.05, axle + mid * 0.95));
      parts.push(box(0.06, 0.22, 0.08, carTone(MAT.SUSPENSION_BRACKET), sign * 0.35, 0.17, axle + mid * 0.75));
      for (const dz of [-0.12, 0.12]) {
        parts.push(toned(new THREE.CylinderGeometry(0.065, 0.065, 0.77, 10), ...carTone(MAT.SHOCK_BODY)).translate(sign * COILOVER_X, 0.335, axle + dz));
        parts.push(...coil(sign * COILOVER_X, 0.42, axle + dz));
      }
    }
  }
  return mergeToned(parts, "ladder frame");
}

/**
 * A solid axle about its hubs' midpoint, +x along the axle, +z toward the car's middle: the tube, knuckles and diff, the shock shafts
 * up into the frame's bodies, the trailing links and the driveshaft toward the frame, the tie rod outboard.
 */
export function solidAxleGeometry(): THREE.BufferGeometry {
  const half = AXLE_HALF_SPAN;
  const parts = [
    rod([-half + 0.05, 0, 0], [half - 0.05, 0, 0], 0.065, carTone(MAT.AXLE_HOUSING)),
    toned(new THREE.SphereGeometry(0.16, 12, 8), ...carTone(MAT.DIFF_CASE)).translate(0, 0, 0.02),
    rod([0, 0.05, 0.15], [0, 0.27, 1.25], 0.04, carTone(MAT.DRIVESHAFT)),
    rod([-0.8, 0.05, -0.18], [0.8, 0.05, -0.18], 0.025, carTone(MAT.CRASH_BAR_STEEL)),
  ];
  for (const sign of [-1, 1]) {
    parts.push(rod([sign * 0.82, 0, 0], [sign * 0.96, 0, 0], 0.11, carTone(MAT.AXLE_HOUSING)));
    parts.push(box(0.06, 0.05, 0.2, carTone(MAT.SUSPENSION_BRACKET), sign * 0.84, 0.05, -0.09));
    parts.push(rod([sign * 0.55, -0.02, 0.05], [sign * 0.5, 0.2, 0.95], 0.03, carTone(MAT.SUSPENSION_LINK)));
    parts.push(rod([sign * 0.22, 0.14, 0.1], [sign * 0.35, 0.32, 0.75], 0.03, carTone(MAT.SUSPENSION_LINK)));
    for (const dz of [-0.12, 0.12]) {
      parts.push(rod([sign * COILOVER_X, 0.06, dz], [sign * COILOVER_X, 0.45, dz], 0.025, carTone(MAT.SHOCK_ROD_CHROME)));
      parts.push(box(0.1, 0.06, 0.1, carTone(MAT.SUSPENSION_BRACKET), sign * COILOVER_X, 0.06, dz));
    }
  }
  return mergeToned(parts, "solid axle");
}
