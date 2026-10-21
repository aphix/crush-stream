import * as THREE from "three";
import { once } from "../kernel/scalar.ts";
import { PART_FAMILY } from "../kernel/physics-core.js";
import { INTERIOR_MESH, SMALL_PART_SEAT } from "./constants.ts";
import { loosePartsMaterial, mergeToned, PAINTED_ATTRIBUTE, toned } from "./car-materials.ts";

/** The seven static parts of a car, in `PartBatch.meshes` order. */
export const PART_KIND = { interior: 0, liningL: 1, liningR: 2, mirrorL: 3, mirrorR: 4, grille: 5, tailTrim: 6 } as const;
export type PartKind = (typeof PART_KIND)[keyof typeof PART_KIND];
export const PART_KINDS: readonly PartKind[] = Object.values(PART_KIND);

/** The mirror arm's inner end, out from its seat (m). */
export const MIRROR_ROOT = 0.02;
/** The mirror glass's reach from its seat (m): a car's `door.mirrorReach` scales the platform mirror to it (the seat's x-scale, which the sim's boxes read). */
export const MIRROR_REACH = 0.21;
/** The grille seat on the front bumper (m, bumper space): the platform grille's centre, which the sim's box keeps for every style. */
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

/** Cabin tub, dash, headliner, bulkhead, seats, side walls and steering wheel: one draw. */
function interior(): THREE.BufferGeometry {
  const dark = [0x14161c, 0.94, 0.04] as const;
  const vinyl = [0x1a1e24, 0.9, 0.05] as const;
  const seat = [0x1c2228, 0.88, 0.06] as const;
  const box = (w: number, h: number, d: number, tone: readonly [number, number, number], x: number, y: number, z: number) =>
    toned(new THREE.BoxGeometry(w, h, d), ...tone).translate(x, y, z);
  const parts = [
    box(0.84, 0.04, 1.28, dark, 0, 0.34, 0.02),
    box(0.82, 0.2, 0.24, dark, 0, 0.6, 0.48),
    box(0.78, 0.02, 1.05, vinyl, 0, 1.08, 0.02),
    box(0.8, 0.55, 0.04, vinyl, 0, 0.62, -0.62),
    toned(new THREE.TorusGeometry(0.11, 0.016, 8, 16), 0x2a2c32, 0.55, 0.2).rotateX(0.55).translate(-0.22, 0.68, 0.36),
  ];
  for (const x of [-0.2, 0.2]) {
    parts.push(box(0.3, 0.08, 0.36, seat, x, 0.4, 0.06));
    parts.push(toned(new THREE.BoxGeometry(0.3, 0.32, 0.07), ...seat).rotateX(-0.12).translate(x, 0.58, 0.06 - 0.16));
  }
  for (const sign of [-1, 1]) parts.push(box(0.03, 0.5, 1.1, vinyl, sign * 0.4, 0.62, 0.02));
  return mergeToned(parts, INTERIOR_MESH);
}

/** Inner door skin, in door-group space (hinge at the A-pillar). */
function lining(sign: number): THREE.BufferGeometry {
  const geo = toned(new THREE.BoxGeometry(0.018, 0.5, 0.52), 0x1a1e24, 0.9, 0.04);
  geo.translate(-sign * 0.024, 0, -0.28);
  return geo;
}

/** The platform grille in front-bumper space; the headlamps sit on the body (`makeLampUnit`). A style's own grille: `part-variants.ts`. */
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
const GEOMETRY = [once(interior), once(() => lining(-1)), once(() => lining(1)), once(() => mirror(-1)), once(() => mirror(1)), once(grille), once(tailTrim)] as const;

export const partGeometry = (kind: PartKind): THREE.BufferGeometry => GEOMETRY[kind]();

/**
 * A bare transform the part batch draws in the mesh's place; its `.geometry` keeps `Box3.setFromObject` and `boxShape` measuring it as the
 * mesh was. A torn part draws as a child mesh of its seat instead (`loosen`); the clone is kept across `fasten`, so its dents persist.
 */
export class PartSeat extends THREE.Object3D {
  /** The shape the sim measures; `drawn` is what shows (a style's own part, `drawnPart`), in the same seat space. */
  readonly geometry: THREE.BufferGeometry;
  drawn: THREE.BufferGeometry;
  /** `drawn`'s variant in the batch's geometry for its kind (`partBatchGeometry`); 0 for the platform part. */
  variant = 0;
  /** The paint (linear) its `painted` vertices take: its panel's (a mirror's door, the grille's body). */
  readonly tint = new THREE.Color(1, 1, 1);
  readonly kind: PartKind;
  private looseMesh: THREE.Mesh | null = null;

  constructor(kind: PartKind) {
    super();
    this.kind = kind;
    this.geometry = partGeometry(kind);
    this.drawn = this.geometry;
    this.name = kind === PART_KIND.interior ? INTERIOR_MESH : SMALL_PART_SEAT;
  }

  get loose(): boolean {
    return this.looseMesh?.parent === this;
  }

  loosen(): void {
    if (this.looseMesh === null) {
      const geo = this.drawn.clone();
      if (this.drawn !== this.geometry) {
        // The torn part flies as the box the sim knows (`boxShape`, `Box3.setFromObject`), whatever it draws.
        this.geometry.computeBoundingBox();
        geo.boundingBox = this.geometry.boundingBox!.clone();
      }
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
