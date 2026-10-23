import * as THREE from "three";
import { once } from "../kernel/scalar.ts";
import { PART_FAMILY } from "../kernel/physics-core.js";
import { INTERIOR_MESH, SMALL_PART_SEAT, UNDERBODY_SEAT } from "./constants.ts";
import { loosePartsMaterial, mergeToned, PAINTED_ATTRIBUTE, toned } from "./car-materials.ts";
import { cabinGeometry, crashBarGeometry, doorCardGeometry, engineBayGeometry, frontSeatGeometry, ladderFrameGeometry, rearSeatGeometry, solidAxleGeometry, wheelGeometry } from "./interior-geometry.ts";

/** A car's static parts, in `PartBatch.meshes` order: the cabin shell, door cards, mirrors, grille, tail trim, then the interior kit and the bay set (`CarCabin`), then a lifted truck's undercarriage (`CarUnderbody`), then the wipers on the windshield. */
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
  ladderFrame: 12,
  axle: 13,
  wipers: 14,
} as const;
export type PartKind = (typeof PART_KIND)[keyof typeof PART_KIND];
export const PART_KINDS: readonly PartKind[] = Object.values(PART_KIND);
/** Seats of each kind on one car (`PartBatch` sizes each kind's draw by it): two front seats, a crash bar at each end, two axles. */
export const PART_PER_CAR: readonly number[] = PART_KINDS.map((k) => (k === PART_KIND.seatFront || k === PART_KIND.crashBar || k === PART_KIND.axle ? 2 : 1));
/** The kinds the far distance cut takes with the cabin (`CarDetail`, by `INTERIOR_MESH`); the rest are small parts, cut at mid distance, bar the undercarriage (`UNDERBODY_SEAT`), which no cut takes. */
const INTERIOR_KINDS: ReadonlySet<number> = new Set([PART_KIND.interior, PART_KIND.seatFront, PART_KIND.seatRear, PART_KIND.wheel, PART_KIND.engineBay]);
const UNDERBODY_KINDS: ReadonlySet<number> = new Set([PART_KIND.ladderFrame, PART_KIND.axle]);
/** The interior kit seen only through the glass: the mid cut takes it with the glass, as it takes the seated driver (`CarDetail`). */
export const BEHIND_GLASS: ReadonlySet<number> = new Set([PART_KIND.seatFront, PART_KIND.seatRear, PART_KIND.wheel]);

/** The mirror arm's inner end, out from its seat (m). */
export const MIRROR_ROOT = 0.02;
/** The mirror glass's reach from its seat (m): a car's `door.mirrorReach` scales the platform mirror to it (the seat's x-scale, which the sim's boxes read). */
export const MIRROR_REACH = 0.21;
/** The grille seat on the front bumper (m, bumper space): the platform grille's centre, which the sim's box keeps for every style while the grille is attached. */
export const GRILLE_SEAT = { y: 0.1, z: 0.06 } as const;

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

/** The platform grille in front-bumper space; the headlamps sit on the body (`makeLampUnit`). A style's own grille: `part-variants.ts`. */
function grille(): THREE.BufferGeometry {
  return toned(new THREE.BoxGeometry(0.72, 0.16, 0.06, 4, 2, 1), 0x1a1c20, 0.55, 0.45);
}

/** The plate's centre over the rear bumper's seat (m) where the bumper sets no `plate` height. */
export const PLATE_RISE = 0.03;
/**
 * The number plate in rear-bumper space; the tail lamps sit on the body, a style's bumper lamps and diffuser join it (`part-variants.ts`).
 * The bumper's seat is 0.05 m inside the body's tail station, so the plate stands 8 cm behind the seat, 2 cm proud of the tail face.
 */
function tailTrim(): THREE.BufferGeometry {
  return toned(new THREE.BoxGeometry(0.36, 0.11, 0.02), 0xd8d4cc, 0.6, 0.1).translate(0, PLATE_RISE, -0.08);
}

/** The platform wipers: two black blades 0.55 m long side by side at the seat; every style draws its own, laid on its windshield (`styleWipers`). */
function wipers(): THREE.BufferGeometry {
  return mergeToned([-0.3, 0.3].map((x) => toned(new THREE.BoxGeometry(0.55, 0.012, 0.022), 0x121316, 0.6, 0.3).translate(x, 0, 0)), "platform wipers");
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
  once(ladderFrameGeometry),
  once(solidAxleGeometry),
  once(wipers),
] as const;

export const partGeometry = (kind: PartKind): THREE.BufferGeometry => GEOMETRY[kind]();

/**
 * A bare transform the part batch draws in the mesh's place; its `.geometry` keeps `Box3.setFromObject` and `boxShape` measuring it as the
 * mesh was. A torn part draws as a child mesh of its seat instead (`loosen`); the clone is kept across `fasten`, so its dents persist.
 */
export class PartSeat extends THREE.Object3D {
  /** The shape the sim measures while attached; `drawn` is what shows (a style's own part, `drawnPart`), in the same seat space, and what a torn seat flies as. */
  readonly geometry: THREE.BufferGeometry;
  drawn: THREE.BufferGeometry;
  /** `drawn`'s variant among its kind's batch draws (`partBatchGeometries`); 0 for the platform part. */
  variant = 0;
  /** The paint (linear) its `painted` vertices take: its panel's (a mirror's door, the grille's body). */
  readonly tint = new THREE.Color(1, 1, 1);
  readonly kind: PartKind;
  /** Drawn only while this holds too (`PartBatch`): the bay under a gone hood, a crash bar under a gone bumper. */
  showIf: (() => boolean) | null = null;
  private looseMesh: THREE.Mesh | null = null;

  constructor(kind: PartKind) {
    super();
    this.kind = kind;
    this.geometry = partGeometry(kind);
    this.drawn = this.geometry;
    this.name = INTERIOR_KINDS.has(kind) ? INTERIOR_MESH : UNDERBODY_KINDS.has(kind) ? UNDERBODY_SEAT : SMALL_PART_SEAT;
    // Each writer of a static seat's pose calls `updateMatrix`; mirrors are posed every frame (`PoseBlend`, `posePart`), axles by `CarUnderbody.follow`.
    this.matrixAutoUpdate = kind === PART_KIND.mirrorL || kind === PART_KIND.mirrorR || kind === PART_KIND.axle;
  }

  get loose(): boolean {
    return this.looseMesh?.parent === this;
  }

  loosen(): void {
    if (this.looseMesh === null) {
      // A torn seat flies and collides as drawn (owner ruling); only an attached one is the platform's to the sim.
      const geo = this.drawn.clone();
      geo.computeBoundingBox();
      this.looseMesh = new THREE.Mesh(geo, loosePartsMaterial());
      this.looseMesh.castShadow = false;
      this.looseMesh.receiveShadow = false;
    }
    this.paintLoose(this.looseMesh.geometry);
    if (this.looseMesh.parent !== this) this.add(this.looseMesh);
  }

  /** The torn mesh has no instance colour: its `painted` vertices take the tint in their own colour. */
  private paintLoose(geo: THREE.BufferGeometry): void {
    const painted = this.drawn.getAttribute(PAINTED_ATTRIBUTE);
    if (!painted) return;
    const from = this.drawn.getAttribute("color");
    const to = geo.getAttribute("color") as THREE.BufferAttribute;
    for (let i = 0; i < painted.count; i++) {
      if (painted.getX(i) > 0.5) to.setXYZ(i, from.getX(i) * this.tint.r, from.getY(i) * this.tint.g, from.getZ(i) * this.tint.b);
    }
    to.needsUpdate = true;
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
