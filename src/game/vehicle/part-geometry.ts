import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { once } from "../kernel/scalar.ts";
import { PART_FAMILY } from "../kernel/physics-core.js";
import { INTERIOR_MESH, SMALL_PART_SEAT } from "./constants.ts";
import {
  INSTANCE_MIRROR_VARIANT_ATTRIBUTE,
  loosePartsMaterial,
  MIRROR_VARIANT_ATTRIBUTE,
  mergeToned,
  PAINT_COLOR_TONE,
  PAINTED_ATTRIBUTE,
  toned,
  TRIM_BLACK,
  TRIM_CHROME,
  TRIM_FINISH,
} from "./car-materials.ts";
import { CAR_STYLE_IDS, CAR_STYLES, type BodyStyle } from "./car-variants.ts";

/** The seven static parts of a car, in `PartBatch.meshes` order. */
export const PART_KIND = { interior: 0, liningL: 1, liningR: 2, mirrorL: 3, mirrorR: 4, grille: 5, tailTrim: 6 } as const;
type PartKind = (typeof PART_KIND)[keyof typeof PART_KIND];
export const PART_KINDS: readonly PartKind[] = Object.values(PART_KIND);

/** The mirror arm's inner end, out from its seat (m). */
export const MIRROR_ROOT = 0.02;
/** The mirror glass's reach from its seat (m): a car's `door.mirrorReach` scales the platform mirror to it (the seat's x-scale, which the sim's boxes read). */
export const MIRROR_REACH = 0.21;

function mirror(sign: number): THREE.BufferGeometry {
  const arm = toned(new THREE.BoxGeometry(0.12, 0.04, 0.05), 0x2a2c32, 0.5, 0.4);
  arm.translate(sign * (MIRROR_ROOT + 0.06), 0, 0);
  const cap = toned(new THREE.BoxGeometry(0.1, 0.08, 0.16), 0x1c1e22, 0.35, 0.55);
  cap.translate(sign * 0.16, 0.01, 0);
  const glass = toned(new THREE.PlaneGeometry(0.08, 0.06), 0x9aa8b4, 0.08, 0.7);
  glass.rotateY(sign * Math.PI * 0.5);
  glass.translate(sign * 0.212, 0.01, 0);
  return withPainted(mergeToned([arm, cap, glass], PART_FAMILY.mirror), 0);
}

type MirrorSpec = NonNullable<BodyStyle["door"]["mirror"]>;

/** A style mirror's cap [w out from the door, h, d along the car] (m) where its spec gives none: a mid-size car's housing. */
const MIRROR_CAP_SIZE = [0.16, 0.1, 0.08] as const;
/** A rounded cap's edge radius, of its smallest side: housings read round without turning into a pill. */
const MIRROR_CAP_ROUND = 0.35;
/** The foot's pad (m): out from the skin, and its share of the cap's height and depth. */
const MIRROR_FOOT = { out: 0.018, share: 0.7 } as const;
/** The foot's inner face sits this far (m) into the skin, so no crack shows where the skin curves away from the pad. */
const MIRROR_FOOT_SINK = 0.002;
/** The stalk from the foot to the cap: [h, d] (m). */
const MIRROR_STALK = [0.028, 0.034] as const;
/** The glass on the cap's rear face: its share of the cap's w and h, and how far (m) behind the face it stands. */
const MIRROR_GLASS = { share: [0.82, 0.74], proud: 0.002 } as const;
/** The cap's centre over the seat (m), as the platform mirror's. */
const MIRROR_CAP_Y = 0.01;

function withPainted(geo: THREE.BufferGeometry, painted: number): THREE.BufferGeometry {
  geo.setAttribute(PAINTED_ATTRIBUTE, new THREE.BufferAttribute(new Float32Array(geo.getAttribute("position").count).fill(painted), 1));
  return geo;
}

/**
 * `style`'s own mirror on side `sign`, in seat space: a foot on the skin at the arm root, a stalk out to the cap where the cap leaves room,
 * the cap in its finish with its outer face at `mirrorReach`, the glass on its rear face. Built at its real size, then divided by the seat's
 * x-scale (kept for the sim), so it draws unsquashed.
 */
function styleMirror(spec: MirrorSpec, reach: number, sign: number): THREE.BufferGeometry {
  const [w, h, d] = spec.size ?? MIRROR_CAP_SIZE;
  const scaleX = reach / MIRROR_REACH;
  const root = MIRROR_ROOT * scaleX;
  const [trim, tone] =
    spec.finish === "chrome" ? [TRIM_CHROME, TRIM_FINISH.chrome] : spec.finish === "black" ? [TRIM_BLACK, TRIM_FINISH.plastic] : [PAINT_COLOR_TONE.getHex(), TRIM_FINISH.paint];
  const fitting = spec.finish === "chrome" ? ([TRIM_CHROME, TRIM_FINISH.chrome] as const) : ([0x1c1e22, { roughness: 0.5, metalness: 0.3 }] as const);
  // RoundedBoxGeometry comes unindexed; the mirror's other parts are indexed, and a merge takes one kind.
  const capShape = spec.cap === "rounded" ? mergeVertices(new RoundedBoxGeometry(w, h, d, 2, MIRROR_CAP_ROUND * Math.min(w, h, d))) : new THREE.BoxGeometry(w, h, d);
  const cap = withPainted(toned(capShape, trim, tone.roughness, tone.metalness), spec.finish === "body" ? 1 : 0).translate(sign * (reach - w / 2), MIRROR_CAP_Y, 0);
  const footOut = MIRROR_FOOT.out + MIRROR_FOOT_SINK;
  const foot = toned(new THREE.BoxGeometry(footOut, h * MIRROR_FOOT.share, d * MIRROR_FOOT.share), fitting[0], fitting[1].roughness, fitting[1].metalness);
  foot.translate(sign * (root - MIRROR_FOOT_SINK + footOut / 2), MIRROR_CAP_Y, 0);
  const parts = [cap, withPainted(foot, 0)];
  const [stalkFrom, stalkTo] = [root + MIRROR_FOOT.out, reach - w + MIRROR_FOOT.out / 2];
  if (stalkTo > stalkFrom) {
    const stalk = toned(new THREE.BoxGeometry(stalkTo - stalkFrom, MIRROR_STALK[0], MIRROR_STALK[1]), fitting[0], fitting[1].roughness, fitting[1].metalness);
    parts.push(withPainted(stalk.translate(sign * (stalkFrom + stalkTo) / 2, MIRROR_CAP_Y, 0), 0));
  }
  const glass = toned(new THREE.PlaneGeometry(w * MIRROR_GLASS.share[0], h * MIRROR_GLASS.share[1]), 0x9aa8b4, 0.08, 0.7).rotateY(Math.PI);
  parts.push(withPainted(glass.translate(sign * (reach - w / 2), MIRROR_CAP_Y, -d / 2 - MIRROR_GLASS.proud), 0));
  return mergeToned(parts, "style mirror").scale(1 / scaleX, 1, 1);
}

const mirrorKey = (door: BodyStyle["door"]): string | null =>
  door.mirror ? `${door.mirror.cap}|${door.mirror.finish}|${door.mirror.size ?? MIRROR_CAP_SIZE}|${door.mirrorReach}` : null;

/** The drawn mirrors, [left, right] per variant: 0 the platform mirror (a style without `door.mirror`), then one per distinct spec and reach in the fleet table. */
const MIRROR_VARIANTS = once(() => {
  const variants: (readonly [THREE.BufferGeometry, THREE.BufferGeometry])[] = [[partGeometry(PART_KIND.mirrorL), partGeometry(PART_KIND.mirrorR)]];
  const byKey = new Map<string, number>();
  for (const id of CAR_STYLE_IDS) {
    const { door } = CAR_STYLES[id];
    const key = mirrorKey(door);
    if (key === null || byKey.has(key)) continue;
    byKey.set(key, variants.push([styleMirror(door.mirror!, door.mirrorReach, -1), styleMirror(door.mirror!, door.mirrorReach, 1)]) - 1);
  }
  return { variants, byKey };
});

/**
 * `style`'s mirror variant and its drawn geometry on side `sign`. A spec the fleet table does not hold (a row's or a tool's edited copy)
 * gets its own geometry under the platform variant's number: the batch draws it as the platform mirror, its torn part as its own.
 */
export function styleMirrorDrawn(style: BodyStyle, sign: number): { variant: number; geometry: THREE.BufferGeometry } {
  const { variants, byKey } = MIRROR_VARIANTS();
  const key = mirrorKey(style.door);
  const k = key === null ? 0 : byKey.get(key);
  if (k !== undefined) return { variant: k, geometry: variants[k]![sign < 0 ? 0 : 1] };
  return { variant: 0, geometry: styleMirror(style.door.mirror!, style.door.mirrorReach, sign) };
}

/** The part batch's mirror geometry on side `sign`: every variant, each vertex tagged with its own, and a per-instance variant for `capacity` cars. The batch owns it. */
export function mirrorBatchGeometry(sign: number, capacity: number): THREE.BufferGeometry {
  const parts = MIRROR_VARIANTS().variants.map((sides, k) => {
    const g = sides[sign < 0 ? 0 : 1].clone();
    g.setAttribute(MIRROR_VARIANT_ATTRIBUTE, new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count).fill(k), 1));
    return g;
  });
  const geo = mergeToned(parts, "mirror batch");
  geo.setAttribute(INSTANCE_MIRROR_VARIANT_ATTRIBUTE, new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
  return geo;
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
const GEOMETRY = [once(interior), once(() => lining(-1)), once(() => lining(1)), once(() => mirror(-1)), once(() => mirror(1)), once(grille), once(tailTrim)] as const;

export const partGeometry = (kind: PartKind): THREE.BufferGeometry => GEOMETRY[kind]();

/**
 * A bare transform the part batch draws in the mesh's place; its `.geometry` keeps `Box3.setFromObject` and `boxShape` measuring it as the
 * mesh was. A torn part draws as a child mesh of its seat instead (`loosen`); the clone is kept across `fasten`, so its dents persist.
 */
export class PartSeat extends THREE.Object3D {
  /** The shape the sim measures; `drawn` is what shows (a style's own mirror), in the same seat space. */
  readonly geometry: THREE.BufferGeometry;
  drawn: THREE.BufferGeometry;
  /** `drawn`'s variant in the batch's mirror geometry (`mirrorBatchGeometry`); 0 for every other kind. */
  variant = 0;
  /** The paint (linear) a `painted` mirror cap takes: its door's. */
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
