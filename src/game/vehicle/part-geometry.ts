import * as THREE from "three";
import { once } from "../kernel/scalar.ts";
import { PART_FAMILY } from "../kernel/physics-core.js";
import { INTERIOR_MESH, SMALL_PART_SEAT } from "./constants.ts";
import { loosePartsMaterial, mergeToned, toned } from "./car-materials.ts";
import { cabinGeometry, crashBarGeometry, doorCardGeometry, engineBayGeometry, frontSeatGeometry, rearSeatGeometry, wheelGeometry } from "./interior-geometry.ts";

/** A car's static parts, in `PartBatch.meshes` order: the cabin shell, door cards, mirrors, grille, tail trim, then the interior kit and the bay set (`CarCabin`). */
export const PART_KIND = {
  interior: 0,
  liningL: 1,
  liningR: 2,
  mirrorL: 3,
  mirrorR: 4,
  grille: 5,
  tailTrim: 6,
  seatFront: 7,
  seatRear: 8,
  wheel: 9,
  engineBay: 10,
  crashBar: 11,
} as const;
type PartKind = (typeof PART_KIND)[keyof typeof PART_KIND];
export const PART_KINDS: readonly PartKind[] = Object.values(PART_KIND);
/** Seats of each kind on one car (`PartBatch` sizes each kind's draw by it): two front seats, a crash bar at each end. */
export const PART_PER_CAR: readonly number[] = PART_KINDS.map((k) => (k === PART_KIND.seatFront || k === PART_KIND.crashBar ? 2 : 1));
/** The kinds the far distance cut takes with the cabin (`CarDetail`, by `INTERIOR_MESH`); the rest are small parts, cut at mid distance. */
const INTERIOR_KINDS: ReadonlySet<number> = new Set([PART_KIND.interior, PART_KIND.seatFront, PART_KIND.seatRear, PART_KIND.wheel, PART_KIND.engineBay]);

/** The mirror arm's inner end, out from its seat (m). */
export const MIRROR_ROOT = 0.02;
/** The mirror glass's reach from its seat (m): a car's `door.mirrorReach` scales the drawn mirror to it. */
export const MIRROR_REACH = 0.21;

function mirror(sign: number): THREE.BufferGeometry {
  const arm = toned(new THREE.BoxGeometry(0.12, 0.04, 0.05), 0x2a2c32, 0.5, 0.4);
  arm.translate(sign * (MIRROR_ROOT + 0.06), 0, 0);
  const cap = toned(new THREE.BoxGeometry(0.1, 0.08, 0.16), 0x1c1e22, 0.35, 0.55);
  cap.translate(sign * 0.16, 0.01, 0);
  const glass = toned(new THREE.PlaneGeometry(0.08, 0.06), 0x9aa8b4, 0.08, 0.7);
  glass.rotateY(sign * Math.PI * 0.5);
  glass.translate(sign * 0.212, 0.01, 0);
  return mergeToned([arm, cap, glass], PART_FAMILY.mirror);
}

/** Grille slats in front-bumper space; the headlamps sit on the body (`makeLampUnit`). */
function grille(): THREE.BufferGeometry {
  return toned(new THREE.BoxGeometry(0.72, 0.16, 0.06, 4, 2, 1), 0x1a1c20, 0.55, 0.45);
}

/**
 * Lower diffuser strip and the number plate, in rear-bumper space; the tail lamps sit on the body. The bumper's seat is 0.05 m inside the
 * body's tail station (2.06 against the profiles' 2.11), so the strip's rear face at -0.02 - 0.03 lay on the tail face and z-fought it;
 * centred at -0.04 its rear face stands 2 cm proud.
 */
function tailTrim(): THREE.BufferGeometry {
  const parts = [
    toned(new THREE.BoxGeometry(1.1, 0.05, 0.06), 0x15171a, 0.6, 0.3).translate(0, -0.12, -0.04),
    toned(new THREE.BoxGeometry(0.36, 0.11, 0.02), 0xd8d4cc, 0.6, 0.1).translate(0, 0.03, -0.08),
  ];
  return mergeToned(parts, "tail trim");
}

/** Built once, shared by every car; a car's dispose skips it (engine teardown frees only its GPU copy). */
const GEOMETRY = [
  once(cabinGeometry),
  once(() => doorCardGeometry(-1)),
  once(() => doorCardGeometry(1)),
  once(() => mirror(-1)),
  once(() => mirror(1)),
  once(grille),
  once(tailTrim),
  once(frontSeatGeometry),
  once(rearSeatGeometry),
  once(wheelGeometry),
  once(engineBayGeometry),
  once(crashBarGeometry),
] as const;

export const partGeometry = (kind: PartKind): THREE.BufferGeometry => GEOMETRY[kind]();

/**
 * A bare transform the part batch draws in the mesh's place; its `.geometry` keeps `Box3.setFromObject` and `boxShape` measuring it as the
 * mesh was. A torn part draws as a child mesh of its seat instead (`loosen`); the clone is kept across `fasten`, so its dents persist.
 */
export class PartSeat extends THREE.Object3D {
  readonly geometry: THREE.BufferGeometry;
  readonly kind: PartKind;
  /** Drawn only while this holds too (`PartBatch`): the bay under a gone hood, a crash bar under a gone bumper. */
  showIf: (() => boolean) | null = null;
  private looseMesh: THREE.Mesh | null = null;

  constructor(kind: PartKind) {
    super();
    this.kind = kind;
    this.geometry = partGeometry(kind);
    this.name = INTERIOR_KINDS.has(kind) ? INTERIOR_MESH : SMALL_PART_SEAT;
  }

  get loose(): boolean {
    return this.looseMesh?.parent === this;
  }

  loosen(): void {
    if (this.looseMesh === null) {
      this.looseMesh = new THREE.Mesh(this.geometry.clone(), loosePartsMaterial());
      this.looseMesh.castShadow = false;
      this.looseMesh.receiveShadow = false;
    }
    if (this.looseMesh.parent !== this) this.add(this.looseMesh);
  }

  /** Takes the clone off the seat without disposing it: its dents stay valid for a re-tear. */
  fasten(): void {
    if (this.looseMesh?.parent === this) this.remove(this.looseMesh);
  }

  /** Frees a torn part's clone even while it is off the seat. */
  dispose(): void {
    this.looseMesh?.geometry.dispose();
  }
}

/** A torn part shows on every camera, and each seat under it leaves the batch for its own mesh. */
export function looseOnCamera(object: THREE.Object3D): void {
  object.traverse((o) => {
    o.layers.enable(0);
    if (o instanceof PartSeat) o.loosen();
  });
}

/** A car's part seats: one of each kind indexed by kind, then each kind's further seats (`PART_PER_CAR`). */
export function carPartSeats(): PartSeat[] {
  const seats = PART_KINDS.map((kind) => new PartSeat(kind));
  for (const kind of PART_KINDS) for (let i = 1; i < PART_PER_CAR[kind]!; i++) seats.push(new PartSeat(kind));
  return seats;
}
