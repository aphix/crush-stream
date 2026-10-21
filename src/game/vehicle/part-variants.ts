import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { once } from "../kernel/scalar.ts";
import {
  INSTANCE_PART_VARIANT_ATTRIBUTE,
  makeLampUnit,
  mergeToned,
  PAINT_COLOR_TONE,
  PAINTED_ATTRIBUTE,
  PART_VARIANT_ATTRIBUTE,
  toned,
  TRIM_BLACK,
  TRIM_CHROME,
  TRIM_FINISH,
  type LampKind,
} from "./car-materials.ts";
import { CAR_STYLE_IDS, CAR_STYLES, type BodyStyle } from "./car-variants.ts";
import { GRILLE_SEAT, MIRROR_REACH, MIRROR_ROOT, PART_KIND, partGeometry, type PartKind } from "./part-geometry.ts";
import { makeChassisGeometry } from "./car-chassis-mesh.ts";

/**
 * A style's own drawn part where its spec asks for one (`door.mirror`, `grille`, `lamps.units`), in the seat's space: the seat, and the
 * platform geometry the sim measures (`PartSeat.geometry`), stay as they were. Each kind's variants share one batch draw (`variantBatchGeometry`).
 */

type Finish = "black" | "chrome" | "body";

/** A finish's tone [sRGB, roughness, metalness] and its `painted` flag (body: the paint tone, the instance colour multiplies in). */
function finishTone(finish: Finish): { color: number; roughness: number; metalness: number; painted: number } {
  if (finish === "chrome") return { color: TRIM_CHROME, ...TRIM_FINISH.chrome, painted: 0 };
  if (finish === "black") return { color: TRIM_BLACK, ...TRIM_FINISH.plastic, painted: 0 };
  return { color: PAINT_COLOR_TONE.getHex(), ...TRIM_FINISH.paint, painted: 1 };
}

function finished(geo: THREE.BufferGeometry, finish: Finish): THREE.BufferGeometry {
  const t = finishTone(finish);
  return withPainted(toned(geo, t.color, t.roughness, t.metalness), t.painted);
}

function withPainted(geo: THREE.BufferGeometry, painted: number): THREE.BufferGeometry {
  geo.setAttribute(PAINTED_ATTRIBUTE, new THREE.BufferAttribute(new Float32Array(geo.getAttribute("position").count).fill(painted), 1));
  return geo;
}

/** A dark unpainted piece: mirror feet and stalks, grille backing. */
function dark(geo: THREE.BufferGeometry, color: number, roughness: number, metalness: number): THREE.BufferGeometry {
  return withPainted(toned(geo, color, roughness, metalness), 0);
}

// ---- mirrors ---------------------------------------------------------------------------------------------------------------

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
/** Mirror feet and stalks: black plastic, unless the mirror is chrome. */
const MIRROR_FITTING = [0x1c1e22, 0.5, 0.3] as const;

/**
 * `style`'s own mirror on side `sign`: a foot on the skin at the arm root, a stalk out to the cap where the cap leaves room, the cap in its
 * finish with its outer face at `mirrorReach`, the glass on its rear face. Built at its real size, then divided by the seat's x-scale (kept
 * for the sim), so it draws unsquashed.
 */
function styleMirror(style: BodyStyle, sign: number): THREE.BufferGeometry {
  const spec: MirrorSpec = style.door.mirror!;
  const reach = style.door.mirrorReach;
  const [w, h, d] = spec.size ?? MIRROR_CAP_SIZE;
  const scaleX = reach / MIRROR_REACH;
  const root = MIRROR_ROOT * scaleX;
  const fitting = (geo: THREE.BufferGeometry) => (spec.finish === "chrome" ? finished(geo, "chrome") : dark(geo, ...MIRROR_FITTING));
  // RoundedBoxGeometry comes unindexed; the other pieces are indexed, and a merge takes one kind.
  const capShape = spec.cap === "rounded" ? mergeVertices(new RoundedBoxGeometry(w, h, d, 2, MIRROR_CAP_ROUND * Math.min(w, h, d))) : new THREE.BoxGeometry(w, h, d);
  const parts = [finished(capShape, spec.finish).translate(sign * (reach - w / 2), MIRROR_CAP_Y, 0)];
  const footOut = MIRROR_FOOT.out + MIRROR_FOOT_SINK;
  parts.push(fitting(new THREE.BoxGeometry(footOut, h * MIRROR_FOOT.share, d * MIRROR_FOOT.share)).translate(sign * (root - MIRROR_FOOT_SINK + footOut / 2), MIRROR_CAP_Y, 0));
  const [stalkFrom, stalkTo] = [root + MIRROR_FOOT.out, reach - w + MIRROR_FOOT.out / 2];
  if (stalkTo > stalkFrom) parts.push(fitting(new THREE.BoxGeometry(stalkTo - stalkFrom, ...MIRROR_STALK)).translate((sign * (stalkFrom + stalkTo)) / 2, MIRROR_CAP_Y, 0));
  const glass = dark(new THREE.PlaneGeometry(w * MIRROR_GLASS.share[0], h * MIRROR_GLASS.share[1]), 0x9aa8b4, 0.08, 0.7).rotateY(Math.PI);
  parts.push(glass.translate(sign * (reach - w / 2), MIRROR_CAP_Y, -d / 2 - MIRROR_GLASS.proud));
  return mergeToned(parts, "style mirror").scale(1 / scaleX, 1, 1);
}

const mirrorKey = (style: BodyStyle): string | null => (style.door.mirror ? `${JSON.stringify(style.door.mirror)}|${style.door.mirrorReach}` : null);

// ---- grille ----------------------------------------------------------------------------------------------------------------

type GrilleSpec = NonNullable<BodyStyle["grille"]>;

/** Grille build (m): the surround's `rim` width and depth, the dark backing set `recess` behind the face, its bars/slats `bar` wide, `pitch` apart, `depth` deep, standing `inset` behind the face. */
const GRILLE = { rim: 0.022, rimDepth: 0.03, backing: 0.03, recess: 0.012, bar: 0.012, pitch: 0.045, barDepth: 0.014, inset: 0.004, meshBar: 0.006, meshPitch: 0.03 } as const;
/** The platform grille's depth (m): a style grille without its own `z` puts its face where the platform box's was. */
const PLATFORM_GRILLE_DEPTH = 0.06;
/** The grille's dark backing: almost black, matte. */
const GRILLE_BACKING = [0x0b0c0e, 0.85, 0.1] as const;

/** Bars across (`across` true: horizontal, spanning `w`) or slats up, `bar` wide at `pitch`, filling a [w, h] field centred at the origin. */
function grillePattern(w: number, h: number, across: boolean, bar: number, pitch: number, depth: number): THREE.BufferGeometry[] {
  const span = across ? h : w;
  const n = Math.max(1, Math.round(span / pitch) - 1);
  return Array.from({ length: n }, (_, k) => {
    const at = -span / 2 + ((k + 1) * span) / (n + 1);
    return across ? new THREE.BoxGeometry(w, bar, depth).translate(0, at, 0) : new THREE.BoxGeometry(bar, h, depth).translate(at, 0, 0);
  });
}

/** `style.grille` in the grille seat's space (`GRILLE_SEAT` on the front bumper): a surround in its finish round a dark backing, bars, slats or a mesh of both in the finish. */
function styleGrille(style: BodyStyle): THREE.BufferGeometry {
  const g: GrilleSpec = style.grille!;
  const seat = style.bumpers.front.seat;
  const [w, h] = g.size;
  const cy = g.y - seat.y - GRILLE_SEAT.y;
  const face = g.z === undefined ? PLATFORM_GRILLE_DEPTH / 2 : g.z - seat.z - GRILLE_SEAT.z;
  const [iw, ih] = [w - 2 * GRILLE.rim, h - 2 * GRILLE.rim];
  const rimZ = face - GRILLE.rimDepth / 2;
  const rims = [
    new THREE.BoxGeometry(w, GRILLE.rim, GRILLE.rimDepth).translate(0, (h - GRILLE.rim) / 2, rimZ),
    new THREE.BoxGeometry(w, GRILLE.rim, GRILLE.rimDepth).translate(0, -(h - GRILLE.rim) / 2, rimZ),
    new THREE.BoxGeometry(GRILLE.rim, ih, GRILLE.rimDepth).translate((w - GRILLE.rim) / 2, 0, rimZ),
    new THREE.BoxGeometry(GRILLE.rim, ih, GRILLE.rimDepth).translate(-(w - GRILLE.rim) / 2, 0, rimZ),
  ];
  const fill =
    g.kind === "mesh"
      ? [...grillePattern(iw, ih, true, GRILLE.meshBar, GRILLE.meshPitch, GRILLE.barDepth), ...grillePattern(iw, ih, false, GRILLE.meshBar, GRILLE.meshPitch, GRILLE.barDepth)]
      : grillePattern(iw, ih, g.kind === "bars", GRILLE.bar, GRILLE.pitch, GRILLE.barDepth);
  const barZ = face - GRILLE.inset - GRILLE.barDepth / 2;
  const parts = [
    dark(new THREE.BoxGeometry(iw, ih, GRILLE.backing), ...GRILLE_BACKING).translate(0, 0, face - GRILLE.recess - GRILLE.backing / 2),
    ...rims.map((r) => finished(r, g.finish)),
    ...fill.map((f) => finished(f.translate(0, 0, barZ), g.finish)),
  ];
  return mergeToned(parts, "style grille").translate(0, cy, 0);
}

const grilleKey = (style: BodyStyle): string | null => (style.grille ? `${JSON.stringify(style.grille)}|${style.bumpers.front.seat.y}|${style.bumpers.front.seat.z}` : null);

// ---- lamps -----------------------------------------------------------------------------------------------------------------

type LampShape = NonNullable<NonNullable<BodyStyle["lamps"]["shapes"]>["head"]>;
type LampLoop = LampShape["loops"][number];
type LampTone = LampShape["lens"];

/** Lamp build (m): how far proud of the skin the lens, cells and inlays (strips, rounds) stand, the bezel's width and default rise over the lens, the segments round a round. */
const LAMP_SHAPE = { lens: 0.003, cell: 0.0045, inlay: 0.006, bezel: 0.008, recess: 0.006, segments: 16 } as const;
/** The lit lenses (sRGB): head white, tail red; the other tones (`SHAPE_TONE`) never glow. */
const LAMP_TONE = { head: 0xf4f1e8, tail: 0xc4121c } as const;
const SHAPE_TONE: Record<Exclude<LampTone, "lit">, number> = { clear: 0xd8dde2, red: 0x8a0c12, amber: 0xff9a1a, smoked: 0x2a1a1c, dark: 0x0e0f11, chrome: TRIM_CHROME };
/** u on the lamp emissive mask (`lampEmissiveMap`): the dark housing texel and the lit lens texel. */
const LAMP_TEXEL = { housing: 0.25, lens: 0.75 } as const;
/** How far out (m) a lamp point's ray starts to meet the skin: past any body. */
export const LAMP_PROBE_REACH = 5;

/** Lamp `kind`'s rest rotation on `style` (lens toward +z in lamp space): heads face forward, tails back, upright in the corners beside a tailgate. */
export function lampRest(kind: LampKind, style: BodyStyle, out: THREE.Quaternion): THREE.Quaternion {
  return out.setFromEuler(new THREE.Euler(0, kind === "head" ? 0 : Math.PI, kind === "tail" && style.boot.kind === "tailgate" ? Math.PI / 2 : 0));
}

/** The end face's z a `kind` lamp seats on (the profile's nose or tail station). */
export const lampEndZ = (kind: LampKind, style: BodyStyle): number => (kind === "head" ? style.profile[style.profile.length - 1]!.z : style.profile[0]!.z);

function lampTone(geo: THREE.BufferGeometry, tone: LampTone, kind: LampKind): THREE.BufferGeometry {
  toned(geo, tone === "lit" ? LAMP_TONE[kind] : SHAPE_TONE[tone], 0, 0);
  (geo.getAttribute("uv").array as Float32Array).fill(tone === "lit" ? LAMP_TEXEL.lens : LAMP_TEXEL.housing);
  return geo;
}

/** The drawn body skin a lamp's 2-number points are met on: from outside along the end axis, or from outboard for a side point. */
class LampSkin {
  private readonly mesh: THREE.Mesh;
  private readonly ray = new THREE.Raycaster();
  private readonly style: BodyStyle;
  private readonly kind: LampKind;

  constructor(style: BodyStyle, kind: LampKind) {
    this.style = style;
    this.kind = kind;
    this.mesh = new THREE.Mesh(makeChassisGeometry(style));
  }

  at(p: readonly number[], side = false): THREE.Vector3 {
    if (p.length === 3) return new THREE.Vector3(p[0], p[1], p[2]);
    const axis = this.kind === "head" ? 1 : -1;
    if (side) this.ray.set(new THREE.Vector3(LAMP_PROBE_REACH, p[1], p[0]), new THREE.Vector3(-1, 0, 0));
    else this.ray.set(new THREE.Vector3(p[0], p[1], lampEndZ(this.kind, this.style) + axis * LAMP_PROBE_REACH), new THREE.Vector3(0, 0, -axis));
    const hit = this.ray.intersectObject(this.mesh, false)[0];
    if (!hit) throw new Error(`${this.style.id}: no skin under its ${this.kind} lamp point ${p.join()}${side ? " (side)" : ""}`);
    return hit.point;
  }

  loop(l: LampLoop): THREE.Vector3[] {
    return l.points.map((p) => this.at(p, l.side));
  }
}

/** A filled outline on the skin (`points` round it): triangulated unwrapped round the corner (x plus the distance back from the end face), facing out. */
function lampFill(points: readonly THREE.Vector3[], zEnd: number, outward: THREE.Vector3): THREE.BufferGeometry {
  const flat = points.map((p) => new THREE.Vector2(p.x + Math.abs(p.z - zEnd), p.y));
  const index = THREE.ShapeUtils.triangulateShape(flat, []).flat();
  const geo = new THREE.BufferGeometry().setFromPoints([...points]);
  geo.setIndex(index);
  geo.computeVertexNormals();
  const n = geo.getAttribute("normal");
  let facing = 0;
  for (let i = 0; i < n.count; i++) facing += n.getX(i) * outward.x + n.getY(i) * outward.y + n.getZ(i) * outward.z;
  if (facing < 0) {
    for (let t = 0; t < index.length; t += 3) [index[t + 1], index[t + 2]] = [index[t + 2]!, index[t + 1]!];
    geo.setIndex(index);
    geo.computeVertexNormals();
  }
  return geo;
}

/** `geo`'s vertices moved `by` along their normals. */
function lifted(geo: THREE.BufferGeometry, by: number): THREE.BufferGeometry {
  const [pos, n] = [geo.getAttribute("position"), geo.getAttribute("normal")];
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + n.getX(i) * by, pos.getY(i) + n.getY(i) * by, pos.getZ(i) + n.getZ(i) * by);
  return geo;
}

/** The skin's outward normal at `p`: the nearest lens vertex's. */
function normalNear(lens: readonly THREE.BufferGeometry[], p: THREE.Vector3): THREE.Vector3 {
  let best = Infinity;
  const out = new THREE.Vector3(0, 0, 1);
  for (const g of lens) {
    const [pos, n] = [g.getAttribute("position"), g.getAttribute("normal")];
    for (let i = 0; i < pos.count; i++) {
      const d = (pos.getX(i) - p.x) ** 2 + (pos.getY(i) - p.y) ** 2 + (pos.getZ(i) - p.z) ** 2;
      if (d >= best) continue;
      best = d;
      out.set(n.getX(i), n.getY(i), n.getZ(i));
    }
  }
  return out;
}

/** A ribbon `width` wide along `points` on the skin (closed: round a loop), standing `proud` off it. */
function lampRibbon(points: readonly THREE.Vector3[], lens: readonly THREE.BufferGeometry[], width: number, proud: number, closed: boolean): THREE.BufferGeometry {
  const n = points.length;
  const verts: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const [prev, next] = closed ? [points[(i + n - 1) % n]!, points[(i + 1) % n]!] : [points[Math.max(0, i - 1)]!, points[Math.min(n - 1, i + 1)]!];
    const normal = normalNear(lens, points[i]!);
    const across = new THREE.Vector3().crossVectors(normal, next.clone().sub(prev)).normalize().multiplyScalar(width / 2);
    const at = points[i]!.clone().addScaledVector(normal, proud);
    verts.push(at.clone().sub(across), at.clone().add(across));
  }
  const index: number[] = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [a0, a1, b0, b1] = [2 * i, 2 * i + 1, 2 * ((i + 1) % n), 2 * ((i + 1) % n) + 1];
    index.push(a0, b0, a1, a1, b0, b1);
  }
  const geo = new THREE.BufferGeometry().setFromPoints(verts);
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/**
 * `style`'s own `kind` lamp on side `side` (`lamps.shapes`), in lamp space at its seat's rest: its lens loops filled a few mm proud of the
 * skin, a bezel round each standing `recess` over the lens, its cells, strips and rounds over the lens in their tones.
 */
function styleLamp(style: BodyStyle, kind: LampKind, side: number): THREE.BufferGeometry {
  const shape = style.lamps.shapes![kind]!;
  const skin = new LampSkin(style, kind);
  const zEnd = lampEndZ(kind, style);
  const outward = (l: LampLoop) => (l.side ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, kind === "head" ? 1 : -1));
  const lens = shape.loops.map((l) => lampFill(skin.loop(l), zEnd, outward(l)));
  const parts = lens.map((g) => lampTone(lifted(g.clone(), LAMP_SHAPE.lens), shape.lens, kind));
  for (const cell of shape.cells ?? []) parts.push(lampTone(lifted(lampFill(skin.loop(cell.loop), zEnd, outward(cell.loop)), LAMP_SHAPE.cell), cell.tone, kind));
  for (const strip of shape.strips ?? []) parts.push(lampTone(lampRibbon(skin.loop(strip.line), lens, strip.width, LAMP_SHAPE.inlay, false), strip.tone, kind));
  for (const round of shape.rounds ?? []) {
    const at = skin.at(round.at, round.side);
    const normal = normalNear(lens, at);
    const disc = new THREE.CircleGeometry(round.r, LAMP_SHAPE.segments).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal));
    parts.push(lampTone(disc.translate(at.x + normal.x * LAMP_SHAPE.inlay, at.y + normal.y * LAMP_SHAPE.inlay, at.z + normal.z * LAMP_SHAPE.inlay), round.tone, kind));
  }
  if (shape.bezel) {
    const rise = LAMP_SHAPE.lens + (shape.recess ?? LAMP_SHAPE.recess);
    for (const l of shape.loops) parts.push(lampTone(lampRibbon(skin.loop(l), lens, LAMP_SHAPE.bezel, rise, true), shape.bezel === "chrome" ? "chrome" : "dark", kind));
  }
  const geo = mergeToned(parts, "style lamp");
  if (side < 0) mirrorX(geo);
  const [x, y] = style.lamps[kind];
  const rest = new THREE.Matrix4().compose(new THREE.Vector3(side * x, y, zEnd), lampRest(kind, style, new THREE.Quaternion()), new THREE.Vector3(1, 1, 1));
  return geo.applyMatrix4(rest.invert());
}

/** `geo` mirrored to the left side: x negated, its triangles' winding turned back. */
function mirrorX(geo: THREE.BufferGeometry): void {
  geo.scale(-1, 1, 1);
  const index = geo.getIndex()!;
  for (let t = 0; t < index.count; t += 3) {
    const b = index.getX(t + 1);
    index.setX(t + 1, index.getX(t + 2));
    index.setX(t + 2, b);
  }
}

const lampKey = (style: BodyStyle, kind: LampKind, side: number): string | null => {
  const shape = style.lamps.shapes?.[kind];
  return shape ? `${style.id}|${kind}|${side}|${JSON.stringify(shape)}|${JSON.stringify(style.lamps[kind])}` : null;
};

/** The high-mount brake lamp, 1 m square (its seat scales it to `lamps.brake.size`): a dark housing, a lit red lens. Shared, never disposed. */
export const brakeLampUnit = once(() =>
  mergeToned([lampTone(new THREE.BoxGeometry(1, 1, 0.02).translate(0, 0, 0.004), "dark", "tail"), lampTone(new THREE.BoxGeometry(0.9, 0.8, 0.012).translate(0, 0, 0.01), "lit", "tail")], "brake lamp"),
);
/** A side marker, 1 m square (its seat scales it to a `lamps.sideMarkers` size): an unlit amber lens. Shared, never disposed. */
export const sideMarkerUnit = once(() => lampTone(new THREE.BoxGeometry(1, 1, 0.012).translate(0, 0, 0.004), "amber", "head"));

// ---- the variant table -----------------------------------------------------------------------------------------------------

/** A batch drawn in style variants: its platform geometry, the sides its seats stand on, and a style's key (null: the platform part) and build. */
interface Slot {
  base: () => THREE.BufferGeometry;
  sides: readonly number[];
  key: (style: BodyStyle, side: number) => string | null;
  build: (style: BodyStyle, side: number) => THREE.BufferGeometry;
}

const SLOTS = {
  mirrorL: { base: () => partGeometry(PART_KIND.mirrorL), sides: [-1], key: mirrorKey, build: (style) => styleMirror(style, -1) },
  mirrorR: { base: () => partGeometry(PART_KIND.mirrorR), sides: [1], key: mirrorKey, build: (style) => styleMirror(style, 1) },
  grille: { base: () => partGeometry(PART_KIND.grille), sides: [0], key: grilleKey, build: styleGrille },
  head: { base: once(() => makeLampUnit("head")), sides: [-1, 1], key: (style, side) => lampKey(style, "head", side), build: (style, side) => styleLamp(style, "head", side) },
  tail: { base: once(() => makeLampUnit("tail")), sides: [-1, 1], key: (style, side) => lampKey(style, "tail", side), build: (style, side) => styleLamp(style, "tail", side) },
} as const satisfies Record<string, Slot>;
type SlotName = keyof typeof SLOTS;

const PART_SLOT: Partial<Record<PartKind, SlotName>> = { [PART_KIND.mirrorL]: "mirrorL", [PART_KIND.mirrorR]: "mirrorR", [PART_KIND.grille]: "grille" };

/** Per slot: its variants (0 the platform geometry, then one per distinct key the fleet table asks for) and their keys. */
const VARIANTS = once(() => {
  const table = new Map<SlotName, { geometries: THREE.BufferGeometry[]; byKey: Map<string, number> }>();
  for (const [name, slot] of Object.entries(SLOTS) as [SlotName, Slot][]) {
    const entry = { geometries: [slot.base()], byKey: new Map<string, number>() };
    for (const id of CAR_STYLE_IDS) {
      for (const side of slot.sides) {
        const key = slot.key(CAR_STYLES[id], side);
        if (key !== null && !entry.byKey.has(key)) entry.byKey.set(key, entry.geometries.push(slot.build(CAR_STYLES[id], side)) - 1);
      }
    }
    table.set(name, entry);
  }
  return table;
});

/**
 * Slot `name`'s drawn geometry for `style` on side `side` and its variant in the batch. A spec the fleet table does not hold (a row's or a
 * tool's edited copy) gets its own geometry under the platform variant's number: the batch draws it as the platform part, a torn part as its own.
 */
function drawnVariant(name: SlotName, style: BodyStyle, side: number): { variant: number; geometry: THREE.BufferGeometry } {
  const slot: Slot = SLOTS[name];
  const key = slot.key(style, side);
  const entry = VARIANTS().get(name)!;
  if (key === null) return { variant: 0, geometry: entry.geometries[0]! };
  const k = entry.byKey.get(key);
  return k === undefined ? { variant: 0, geometry: slot.build(style, side) } : { variant: k, geometry: entry.geometries[k]! };
}

/** Part `kind`'s drawn geometry on `style` and its variant in the part batch (`drawnVariant`); the platform part for a kind no style draws its own way. */
export function drawnPart(kind: PartKind, style: BodyStyle): { variant: number; geometry: THREE.BufferGeometry } {
  const name = PART_SLOT[kind];
  return name ? drawnVariant(name, style, 0) : { variant: 0, geometry: partGeometry(kind) };
}

/** Lamp `kind` on side `side` of `style`: its unit geometry and its variant in the lamp batch (`drawnVariant`). */
export function drawnLamp(style: BodyStyle, kind: LampKind, side: number): { variant: number; geometry: THREE.BufferGeometry } {
  return drawnVariant(kind, style, side);
}

/** Slot `name`'s batch geometry: every variant, each vertex tagged with its own, and a per-instance variant for `capacity` instances (the batch owns it); null while no style in the fleet table draws its own. */
function variantBatchGeometry(name: SlotName, capacity: number): THREE.BufferGeometry | null {
  const entry = VARIANTS().get(name)!;
  if (entry.geometries.length === 1) return null;
  const parts = entry.geometries.map((geometry, k) => {
    const g = geometry.clone();
    const n = g.getAttribute("position").count;
    g.setAttribute(PART_VARIANT_ATTRIBUTE, new THREE.BufferAttribute(new Float32Array(n).fill(k), 1));
    if (!g.getAttribute(PAINTED_ATTRIBUTE)) withPainted(g, 0);
    return g;
  });
  const geo = mergeToned(parts, "part variants");
  geo.setAttribute(INSTANCE_PART_VARIANT_ATTRIBUTE, new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
  return geo;
}

/** The part batch's geometry for `kind` (`variantBatchGeometry`); null for a kind with one shape. */
export function partBatchGeometry(kind: PartKind, capacity: number): THREE.BufferGeometry | null {
  const name = PART_SLOT[kind];
  return name ? variantBatchGeometry(name, capacity) : null;
}

/** The lamp batch's geometry for `kind` (`variantBatchGeometry`); null while every style draws the platform unit. */
export function lampBatchGeometry(kind: LampKind, capacity: number): THREE.BufferGeometry | null {
  return variantBatchGeometry(kind, capacity);
}
