import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { once } from "../kernel/scalar.ts";
import { detCos, detSin } from "../kernel/physics-core.js";
import {
  LAMP_BULB_UV,
  makeLampUnit,
  mergeToned,
  PAINT_COLOR_TONE,
  PAINTED_ATTRIBUTE,
  toned,
  TRIM_BLACK,
  TRIM_CHROME,
  TRIM_FINISH,
  type LampKind,
} from "./car-materials.ts";
import { CAR_STYLE_IDS, CAR_STYLES, type BodyStyle } from "./car-variants.ts";
import { GRILLE_SEAT, MIRROR_REACH, MIRROR_ROOT, PART_KIND, partGeometry, PLATE_RISE, type PartKind } from "./part-geometry.ts";
import { makeChassisGeometry } from "./car-chassis-mesh.ts";
import { glassX, makeBumperGeometry, makeHoodGeometry, makeTrunkGeometry } from "./car-mesh.ts";
import { bootPivot } from "./hinge-spec.ts";
import { DRIVER_SIDE, FITTING_ATTRIBUTE, FITTING_TONE } from "./constants.ts";
import { windshieldPoint } from "./car-glass.ts";

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
/** A glass-mounted foot's rows of vertices up its height, so its lean follows the pane's bend at the belt instead of cutting through it. */
const GLASS_FOOT_ROWS = 4;
/** The stalk from the foot to the cap: [h, d] (m). */
const MIRROR_STALK = [0.028, 0.034] as const;
/** The glass on the cap's rear face: its share of the cap's w and h, and how far (m) behind the face it stands. */
const MIRROR_GLASS = { share: [0.82, 0.74], proud: 0.002 } as const;
/** The cap's centre over the seat (m), as the platform mirror's. */
const MIRROR_CAP_Y = 0.01;
/** Mirror feet and stalks: black plastic, unless the mirror is chrome. */
const MIRROR_FITTING = [0x1c1e22, 0.5, 0.3] as const;

/** A tear cap's section at its rear face as a share of its nose's, as the reference's sedan mirror sweeps in toward its glass. */
const MIRROR_TEAR = 0.6;

/** `geo` (a centred w x h x d rounded box, outward +`sign`) tapered linearly to `MIRROR_TEAR` at its rear face (z -d/2), its inner face held; normals by the taper's inverse transpose. */
function tearCap(geo: THREE.BufferGeometry, sign: number, w: number, d: number): THREE.BufferGeometry {
  const pos = geo.getAttribute("position");
  const nrm = geo.getAttribute("normal");
  const ds = (1 - MIRROR_TEAR) / d;
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const s = MIRROR_TEAR + ds * (z + d / 2);
    n.set(nrm.getX(i) / s, nrm.getY(i) / s, nrm.getZ(i) - (ds * (x + (sign * w) / 2) * nrm.getX(i) + ds * y * nrm.getY(i)) / s).normalize();
    pos.setXYZ(i, s * x - sign * (w / 2) * (1 - s), s * y, z);
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  return geo;
}

/**
 * `style`'s own mirror on side `sign`: a foot on the skin at the arm root, a stalk out to the cap where the cap leaves room, the cap in its
 * finish with its outer face at `mirrorReach`, the glass on its rear face. Built at its real size, then divided by the seat's x-scale (kept
 * for the sim), so it draws unsquashed. A `lift` stands the cap, glass and stalk that far (m) higher than the seat, the foot growing up to meet them.
 */
function styleMirror(style: BodyStyle, sign: number): THREE.BufferGeometry {
  const spec: MirrorSpec = style.door.mirror!;
  const reach = style.door.mirrorReach;
  const [w, h, d] = spec.size ?? MIRROR_CAP_SIZE;
  const scaleX = reach / MIRROR_REACH;
  const root = MIRROR_ROOT * scaleX;
  const lift = spec.lift ?? 0;
  const capY = MIRROR_CAP_Y + lift;
  const fitting = (geo: THREE.BufferGeometry) => (spec.finish === "chrome" ? finished(geo, "chrome") : dark(geo, ...MIRROR_FITTING));
  // RoundedBoxGeometry comes unindexed; the other pieces are indexed, and a merge takes one kind.
  const rounded = spec.cap === "box" ? null : mergeVertices(new RoundedBoxGeometry(w, h, d, 2, MIRROR_CAP_ROUND * Math.min(w, h, d)));
  const capShape = rounded ? (spec.cap === "tear" ? tearCap(rounded, sign, w, d) : rounded) : new THREE.BoxGeometry(w, h, d);
  // A black housing is gloss (the references' piano black), not the grilles' and bumpers' satin plastic.
  const cap = spec.finish === "black" ? dark(capShape, TRIM_BLACK, TRIM_FINISH.gloss.roughness, TRIM_FINISH.gloss.metalness) : finished(capShape, spec.finish);
  const parts = [cap.translate(sign * (reach - w / 2), capY, 0)];
  const footOut = MIRROR_FOOT.out + MIRROR_FOOT_SINK;
  const footRows = spec.mount === "glass" ? GLASS_FOOT_ROWS : 1;
  const foot = fitting(new THREE.BoxGeometry(footOut, h * MIRROR_FOOT.share + lift, spec.stalk ?? d * MIRROR_FOOT.share, 1, footRows, 1)).translate(sign * (root - MIRROR_FOOT_SINK + footOut / 2), MIRROR_CAP_Y + lift / 2, 0);
  parts.push(spec.mount === "glass" ? alongGlass(foot, style, sign) : foot);
  const [stalkFrom, stalkTo] = [root + MIRROR_FOOT.out, reach - w + MIRROR_FOOT.out / 2];
  if (stalkTo > stalkFrom) parts.push(fitting(new THREE.BoxGeometry(stalkTo - stalkFrom, ...MIRROR_STALK)).translate((sign * (stalkFrom + stalkTo)) / 2, capY, 0));
  const tear = spec.cap === "tear";
  const [glassW, glassH] = tear ? [w * MIRROR_TEAR * MIRROR_GLASS.share[0], h * MIRROR_TEAR * MIRROR_GLASS.share[1]] : [w * MIRROR_GLASS.share[0], h * MIRROR_GLASS.share[1]];
  const glassCx = tear ? sign * (reach - w / 2) - sign * (w / 2) * (1 - MIRROR_TEAR) : sign * (reach - w / 2);
  const glass = dark(new THREE.PlaneGeometry(glassW, glassH), 0x9aa8b4, 0.08, 0.7).rotateY(Math.PI);
  parts.push(glass.translate(glassCx, capY, -d / 2 - MIRROR_GLASS.proud));
  return mergeToned(parts, "style mirror").scale(1 / scaleX, 1, 1);
}

/** `geo` (seat space, real size) with each vertex's x moved by the door glass's lean away from the seat's x: a glass-mounted foot lies on the pane. */
function alongGlass(geo: THREE.BufferGeometry, style: BodyStyle, sign: number): THREE.BufferGeometry {
  const d = style.door;
  const [z0, y0] = [d.hingeZ - (d.mirrorZ ?? 0), d.hingeY + d.mirrorY];
  const x0 = glassX(z0, y0, style);
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + sign * (glassX(z0 + pos.getZ(i), y0 + pos.getY(i), style) - x0));
  geo.computeVertexNormals();
  return geo;
}

/** A style mirror's variant key: its spec and reach, and for a glass mount the style and seat, whose pane its foot follows. */
const mirrorKey = (style: BodyStyle): string | null => {
  const d = style.door;
  if (!d.mirror) return null;
  const seat = d.mirror.mount === "glass" ? `|${style.id}|${d.mirrorY}|${d.mirrorZ ?? 0}` : "";
  return `${JSON.stringify(d.mirror)}|${d.mirrorReach}${seat}`;
};

// ---- grille ----------------------------------------------------------------------------------------------------------------

type GrilleSpec = NonNullable<BodyStyle["grille"]>;

/** Grille build (m): the surround's `rim` width and depth, the dark backing set `backingSet` behind the face, its bars/slats `bar` wide at `pitch` (without a `count`), `barDepth` deep and standing `inset` behind the face; a mesh's finer `meshBar` at `meshPitch`; the badge's depth; a bezel's front stands `bezelProud` over the face. */
const GRILLE = { rim: 0.022, rimDepth: 0.03, backingSet: 0.012, bar: 0.012, pitch: 0.045, barDepth: 0.014, inset: 0.004, meshBar: 0.006, meshPitch: 0.03, badge: 0.008, bezelProud: 0.003 } as const;
/** Points along each rounded corner of a grille outline. */
const GRILLE_CORNER_STEPS = 4;
/** A hex grille's bars cross at ± this angle (rad) from the horizontal: a diamond lattice. */
const HEX_ANGLE = Math.PI / 3;
/** The platform grille's depth (m): a style grille without its own `z` puts its face where the platform box's was. */
const PLATFORM_GRILLE_DEPTH = 0.06;
/** The grille's dark backing: almost black, matte. */
const GRILLE_BACKING = [0x0b0c0e, 0.85, 0.1] as const;

/** `geo` with a trivial index where it has none: merged variants are all indexed. */
function indexed(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geo.getIndex()) geo.setIndex(Array.from({ length: geo.getAttribute("position").count }, (_, i) => i));
  return geo;
}

/** A grille outline [x, y] counter-clockwise round its centre: `w` wide at the top, `bottom` at the bottom, `h` tall, its corners rounded `r`. */
function grilleOutline(w: number, bottom: number, h: number, r: number): THREE.Vector2[] {
  const corners = [new THREE.Vector2(bottom / 2, -h / 2), new THREE.Vector2(w / 2, h / 2), new THREE.Vector2(-w / 2, h / 2), new THREE.Vector2(-bottom / 2, -h / 2)];
  if (r <= 0) return corners;
  return corners.flatMap((c, i) => {
    const a = corners[(i + 3) % 4]!.clone().sub(c).setLength(r).add(c);
    const b = corners[(i + 1) % 4]!.clone().sub(c).setLength(r).add(c);
    return Array.from({ length: GRILLE_CORNER_STEPS + 1 }, (_, k) => {
      const t = k / GRILLE_CORNER_STEPS;
      return a.clone().multiplyScalar((1 - t) ** 2).addScaledVector(c, 2 * t * (1 - t)).addScaledVector(b, t * t);
    });
  });
}

/** The span [t0, t1] of the line `c + t·d` inside the convex counter-clockwise outline `poly`, or null where it misses. */
function clipLine(poly: readonly THREE.Vector2[], c: THREE.Vector2, d: THREE.Vector2): readonly [number, number] | null {
  let [t0, t1] = [-Infinity, Infinity];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const e = poly[(i + 1) % poly.length]!.clone().sub(a);
    const inward = new THREE.Vector2(-e.y, e.x);
    const [num, den] = [inward.dot(c.clone().sub(a)), inward.dot(d)];
    if (Math.abs(den) < 1e-12) {
      if (num < 0) return null;
      continue;
    }
    if (den > 0) t0 = Math.max(t0, -num / den);
    else t1 = Math.min(t1, -num / den);
  }
  return t1 > t0 ? [t0, t1] : null;
}

/** Bars at `angle` (rad from the horizontal) across `poly`: `count` of them, or one every `pitch`, `bar` wide and `depth` deep, each clipped to the outline. */
function grilleBars(poly: readonly THREE.Vector2[], angle: number, count: number | undefined, bar: number, pitch: number, depth: number): THREE.BufferGeometry[] {
  const d = new THREE.Vector2(detCos(angle), detSin(angle));
  const across = new THREE.Vector2(-d.y, d.x);
  const reach = poly.map((p) => p.dot(across));
  const [lo, hi] = [Math.min(...reach), Math.max(...reach)];
  const n = count ?? Math.max(1, Math.round((hi - lo) / pitch) - 1);
  const bars: THREE.BufferGeometry[] = [];
  for (let k = 0; k < n; k++) {
    const c = across.clone().multiplyScalar(lo + ((k + 1) * (hi - lo)) / (n + 1));
    const span = clipLine(poly, c, d);
    if (!span) continue;
    const mid = c.addScaledVector(d, (span[0] + span[1]) / 2);
    bars.push(new THREE.BoxGeometry(span[1] - span[0], bar, depth).rotateZ(angle).translate(mid.x, mid.y, 0));
  }
  return bars;
}

/** `style.grille` in the grille seat's space (`GRILLE_SEAT` on the front bumper): a surround in its finish round a dark backing, its bars, slats or mesh in the finish, a chrome badge, a chrome bezel. */
function styleGrille(style: BodyStyle): THREE.BufferGeometry {
  const g: GrilleSpec = style.grille!;
  const seat = style.bumpers.front.seat;
  const [w, h] = g.size;
  const [bottom, round] = [g.bottom ?? w, g.round ?? 0];
  const face = g.z === undefined ? PLATFORM_GRILLE_DEPTH / 2 : g.z - seat.z - GRILLE_SEAT.z;
  const inner = grilleOutline(w - 2 * GRILLE.rim, bottom - 2 * GRILLE.rim, h - 2 * GRILLE.rim, Math.max(0, round - GRILLE.rim));
  const ring = new THREE.Shape(grilleOutline(w, bottom, h, round));
  ring.holes.push(new THREE.Path(inner));
  const surround = indexed(new THREE.ExtrudeGeometry(ring, { depth: GRILLE.rimDepth, bevelEnabled: false })).translate(0, 0, face - GRILLE.rimDepth);
  const fine = g.kind === "mesh" || g.kind === "hex";
  const angles = { bars: [0], slats: [Math.PI / 2], mesh: [0, Math.PI / 2], hex: [HEX_ANGLE, -HEX_ANGLE] }[g.kind];
  const fill = angles.flatMap((a) => (fine ? grilleBars(inner, a, g.count, GRILLE.meshBar, GRILLE.meshPitch, GRILLE.barDepth) : grilleBars(inner, a, g.count, GRILLE.bar, GRILLE.pitch, GRILLE.barDepth)));
  const barZ = face - GRILLE.inset - GRILLE.barDepth / 2;
  const parts = [
    dark(new THREE.ShapeGeometry(new THREE.Shape(inner)), ...GRILLE_BACKING).translate(0, 0, face - GRILLE.backingSet),
    finished(surround, g.rim ?? g.finish),
    ...fill.map((f) => finished(f.translate(0, 0, barZ), g.finish)),
  ];
  if (g.badge) parts.push(finished(new THREE.CylinderGeometry(g.badge, g.badge, GRILLE.badge, 24).rotateX(Math.PI / 2).translate(0, 0, face), "chrome"));
  if (g.bezel) {
    // ponytail: a uniform offset is exact for a rectangle; a trapezoid's slanted sides widen by sec(slope) of it, under 1 mm at a 3 cm bezel.
    const frame = new THREE.Shape(grilleOutline(w + 2 * g.bezel, bottom + 2 * g.bezel, h + 2 * g.bezel, round > 0 ? round + g.bezel : 0));
    frame.holes.push(new THREE.Path(grilleOutline(w, bottom, h, round)));
    parts.push(finished(indexed(new THREE.ExtrudeGeometry(frame, { depth: GRILLE.rimDepth + GRILLE.bezelProud, bevelEnabled: false })).translate(0, 0, face - GRILLE.rimDepth), "chrome"));
  }
  const geo = mergeToned(parts, "style grille");
  if (g.lean) geo.translate(0, 0, -face).rotateX(-g.lean).translate(0, 0, face);
  return geo.translate(0, g.y - seat.y - GRILLE_SEAT.y, 0);
}

/** The front bumper's drawn fittings in the grille seat's space: the style's grille (or the platform's) and its front bumper lamps. */
function frontFittings(style: BodyStyle): THREE.BufferGeometry {
  const grille = style.grille ? styleGrille(style) : withPainted(partGeometry(PART_KIND.grille).clone(), 0);
  if (!style.lamps.shapes?.front) return grille;
  const { seat } = style.bumpers.front;
  return mergeToned([grille, bothSides(builtLamp(style, "front").body).translate(0, -seat.y - GRILLE_SEAT.y, -seat.z - GRILLE_SEAT.z)], "front bumper fittings");
}

/** The platform plate's rear face (m) behind its seat: `tailTrim`'s centre 0.08 back plus half its 0.02 depth. */
const PLATFORM_PLATE_OUT = 0.09;
/** The platform plate's roughness and metalness: a recoloured plate keeps its sheen. */
const PLATE_SHEEN = [0.6, 0.1] as const;

/** The rear bumper's drawn trim in its space: the plate (at the bumper's `plate` height, its face and colour seated by `plateFace`) and the style's rear bumper lamps. */
function rearFittings(style: BodyStyle): THREE.BufferGeometry {
  const { seat, plate, plateFace } = style.bumpers.rear;
  const trim = withPainted(partGeometry(PART_KIND.tailTrim).clone(), 0).translate(0, plate === undefined ? 0 : plate - seat.y - PLATE_RISE, plateFace?.out === undefined ? 0 : PLATFORM_PLATE_OUT - plateFace.out);
  if (plateFace?.color !== undefined) toned(trim, plateFace.color, ...PLATE_SHEEN);
  if (!style.lamps.shapes?.rear) return trim;
  const lamps = bothSides(builtLamp(style, "rear").body).translate(0, -seat.y, seat.z);
  return mergeToned([trim, lamps], "rear bumper fittings");
}

const frontKey = (style: BodyStyle): string | null =>
  style.grille || style.lamps.shapes?.front ? `${style.id}|${JSON.stringify(style.grille)}|${JSON.stringify(style.lamps.shapes?.front)}|${JSON.stringify(style.bumpers.front)}` : null;
const rearKey = (style: BodyStyle): string | null =>
  style.lamps.shapes?.rear || style.bumpers.rear.plate !== undefined || style.bumpers.rear.plateFace ? `${style.id}|${JSON.stringify(style.lamps.shapes?.rear)}|${JSON.stringify(style.bumpers.rear)}` : null;

// ---- lamps -----------------------------------------------------------------------------------------------------------------

type LampShapes = NonNullable<BodyStyle["lamps"]["shapes"]>;
type LampShape = NonNullable<LampShapes["head"]>;
type LampLoop = LampShape["loops"][number];
type LampPoint = LampLoop["points"][number];
type LampTone = LampShape["lens"];

/** Lamp build (m): how far proud of the skin the lens, cells and inlays (strips, rounds) stand; the bezel lip's width, its default crest over the lens and how deep its foot sinks into the skin; the segments round a round. */
const LAMP_SHAPE = { lens: 0.003, cell: 0.0045, inlay: 0.006, bezel: 0.008, recess: 0.006, sink: 0.001, segments: 16 } as const;
/** The longest step (m) along a lamp outline before the skin is met again: a 2 cm chord on a 30 cm corner sags 0.2 mm. */
const LAMP_STEP = 0.02;
/** The longest edge (m) a lens fill keeps before it is split and met on the skin again: a 5 cm chord on a 30 cm corner sags 1 mm, under the lens's 3 mm. */
const LAMP_FILL_STEP = 0.05;
/** Skin kept (m) round a lamp's met points for meeting the points between them: a ray there only needs the skin near the lamp. */
const LAMP_SKIN_MARGIN = 0.1;
/** How far out (m) along the skin normal a point between met points starts its ray back to the skin: past the sag of a lens triangle's chord round a corner (40 cm on a 30 cm radius sags 7 cm). */
const LAMP_RECAST = 0.1;
/** How deep (m) behind the end plane an end-face lamp point may meet the skin: the end face's own curve round its corners; deeper is a hole (an open boot) seen through. */
const LAMP_FACE_DEPTH = 0.25;
/** x offsets (m) an end-face point tries in turn where it falls in a shut-line gap (between a lid and the body): the gap is a few cm. */
const LAMP_SEAM_NUDGE = [0, 0.01, -0.01, 0.02, -0.02, 0.03, -0.03, 0.04, -0.04] as const;
/** Edge-splitting passes a lens fill gets at most: each halves its longest edges, a lens 1 m long reaches `LAMP_FILL_STEP` in five. */
const LAMP_REFINE_PASSES = 8;
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
const lampEndZ = (kind: LampKind, style: BodyStyle): number => (kind === "head" ? style.profile[style.profile.length - 1]!.z : style.profile[0]!.z);

/** `geo` in lamp `tone`; a lit head lens under its `bulb` samples that bulb's emissive texel instead of the plain white. */
function lampTone(geo: THREE.BufferGeometry, tone: LampTone, kind: LampKind, bulb?: BodyStyle["lamps"]["bulb"]): THREE.BufferGeometry {
  toned(geo, tone === "lit" ? LAMP_TONE[kind] : SHAPE_TONE[tone], 0, 0);
  const uv = geo.getAttribute("uv").array as Float32Array;
  uv.fill(tone === "lit" ? LAMP_TEXEL.lens : LAMP_TEXEL.housing);
  if (tone === "lit" && kind === "head" && bulb) for (let i = 0; i < uv.length; i += 2) uv.set(LAMP_BULB_UV[bulb], i);
  return geo;
}

/** A bumper lamp's tone in the part batch (never lit): chrome in the trim's finish, the rest glossy in their colour. */
function bumperTone(geo: THREE.BufferGeometry, tone: LampTone, kind: LampKind): THREE.BufferGeometry {
  return tone === "chrome" ? finished(geo, "chrome") : dark(geo, tone === "lit" ? LAMP_TONE[kind] : SHAPE_TONE[tone], 0.3, 0.1);
}

/** A lamp point met on the skin: where, the skin's outward normal there, and whether it lies on the boot lid. */
interface SkinPoint {
  p: THREE.Vector3;
  n: THREE.Vector3;
  lid: boolean;
}

/** Triangles over skin points. */
interface Patch {
  points: SkinPoint[];
  index: number[];
}

/** A skin a lamp is met on: `geo` moved `offset` into the car frame; `lid` for the boot lid's; `mirror` its left half mirrored onto the right (x negated). */
interface SkinSource {
  geo: THREE.BufferGeometry;
  offset: THREE.Vector3;
  lid: boolean;
  mirror: boolean;
}

/** The skin meshes' material, only ever raycast: both faces met. Shared, never disposed. */
const SKIN_PROBE_MATERIAL = once(() => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));

/** `src`'s triangles in the car frame as a raycastable mesh: those whose bounds meet `box`, or all of them. */
function skinMesh(src: SkinSource, box: THREE.Box3 | null): THREE.Mesh {
  const pos = src.geo.getAttribute("position");
  const index = src.geo.getIndex();
  const n = index ? index.count : pos.count;
  const keep: number[] = [];
  const tri = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const bounds = new THREE.Box3();
  const scale = new THREE.Vector3(src.mirror ? -1 : 1, 1, 1);
  for (let t = 0; t < n; t += 3) {
    for (let k = 0; k < 3; k++) tri[k]!.fromBufferAttribute(pos, index ? index.getX(t + k) : t + k).add(src.offset).multiply(scale);
    if (box && !box.intersectsBox(bounds.setFromPoints(tri))) continue;
    for (const v of tri) keep.push(v.x, v.y, v.z);
  }
  // Double-sided: a panel wound inward (a gate's outer skin over its hollow) is still met from outside; `cast` turns its normal out.
  return new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(keep, 3)), SKIN_PROBE_MATERIAL());
}

/**
 * The skin a lamp's points are met on, the first hit winning (the lid over the body): an [x, y] from outside along the end axis, a side
 * [z, y] from outboard, an [x, y, z] by the nearer of both. After `narrow`, only the skin near the lamp is kept for the points between.
 * `reach`: the longest step along an outline and how far out a point between met points starts its ray (`LAMP_STEP`, `LAMP_RECAST`).
 */
class LampSkin {
  private readonly ray = new THREE.Raycaster();
  private readonly sources: readonly SkinSource[];
  private readonly zEnd: number;
  private readonly axis: number;
  private readonly what: string;
  private readonly reach: { step: number; recast: number };
  private readonly lids = new Set<THREE.Object3D>();
  private meshes: THREE.Mesh[];

  constructor(sources: readonly SkinSource[], zEnd: number, axis: number, what: string, reach = { step: LAMP_STEP, recast: LAMP_RECAST }) {
    this.sources = sources;
    this.zEnd = zEnd;
    this.axis = axis;
    this.what = what;
    this.reach = reach;
    this.meshes = this.meshesNear(null);
  }

  private meshesNear(box: THREE.Box3 | null): THREE.Mesh[] {
    this.lids.clear();
    return this.sources.map((s) => {
      const mesh = skinMesh(s, box);
      if (s.lid) this.lids.add(mesh);
      return mesh;
    });
  }

  narrow(points: readonly SkinPoint[]): void {
    this.meshes = this.meshesNear(new THREE.Box3().setFromPoints(points.map((s) => s.p)).expandByScalar(LAMP_SKIN_MARGIN));
  }

  private cast(from: THREE.Vector3, dir: THREE.Vector3, far: number): SkinPoint | null {
    this.ray.set(from, dir);
    this.ray.far = far;
    const hit = this.ray.intersectObjects(this.meshes, false)[0];
    if (!hit) return null;
    const n = hit.face!.normal.clone();
    if (n.dot(dir) > 0) n.negate();
    return { p: hit.point, n, lid: this.lids.has(hit.object) };
  }

  /** An end-face [x, y] met within `LAMP_FACE_DEPTH` of the end plane, nudged across a shut-line gap (`LAMP_SEAM_NUDGE`) where it falls in one. */
  private end(x: number, y: number): SkinPoint | null {
    for (const dx of LAMP_SEAM_NUDGE) {
      const hit = this.cast(new THREE.Vector3(x + dx, y, this.zEnd + this.axis * LAMP_PROBE_REACH), new THREE.Vector3(0, 0, -this.axis), LAMP_PROBE_REACH + LAMP_FACE_DEPTH);
      if (hit) return hit;
    }
    return null;
  }

  at(p: LampPoint, side = false): SkinPoint {
    const out = (z: number, y: number) => this.cast(new THREE.Vector3(LAMP_PROBE_REACH, y, z), new THREE.Vector3(-1, 0, 0), Infinity);
    let hit: SkinPoint | null;
    if (p.length === 3) {
      const q = new THREE.Vector3(p[0], p[1], p[2]);
      const [a, b] = [this.end(q.x, q.y), out(q.z, q.y)];
      hit = a && (!b || a.p.distanceToSquared(q) <= b.p.distanceToSquared(q)) ? a : b;
    } else hit = side ? out(p[0], p[1]) : this.end(p[0], p[1]);
    if (!hit) throw new Error(`${this.what}: no skin under lamp point ${p.join()}${side ? " (side)" : ""}`);
    return hit;
  }

  /** `q` met on the skin along `-n` from `reach.recast` out, no deeper than as far again inside; `q` itself where the skin is missed (a shut-line gap). */
  onto(q: THREE.Vector3, n: THREE.Vector3, lid: boolean): SkinPoint {
    return this.cast(q.clone().addScaledVector(n, this.reach.recast), n.clone().negate(), 2 * this.reach.recast) ?? { p: q, n, lid };
  }

  /** `points` with blends met between them until no step is longer than `reach.step` (`closed`: round the loop). */
  densify(points: readonly SkinPoint[], closed: boolean): SkinPoint[] {
    const out: SkinPoint[] = [];
    for (let i = 0; i < (closed ? points.length : points.length - 1); i++) {
      const [a, b] = [points[i]!, points[(i + 1) % points.length]!];
      out.push(a);
      const k = Math.ceil(a.p.distanceTo(b.p) / this.reach.step);
      for (let j = 1; j < k; j++) out.push(this.onto(a.p.clone().lerp(b.p, j / k), a.n.clone().lerp(b.n, j / k).normalize(), 2 * j < k ? a.lid : b.lid));
    }
    if (!closed) out.push(points[points.length - 1]!);
    return out;
  }
}

/** `patch` with every triangle wound to face out along its points' skin normals. */
function facingOut(patch: Patch): Patch {
  const { points, index } = patch;
  const [e1, e2, n] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [points[index[t]!]!, points[index[t + 1]!]!, points[index[t + 2]!]!];
    n.crossVectors(e1.subVectors(b.p, a.p), e2.subVectors(c.p, a.p));
    if (n.dot(a.n) + n.dot(b.n) + n.dot(c.n) < 0) [index[t + 1], index[t + 2]] = [index[t + 2]!, index[t + 1]!];
  }
  return patch;
}

/**
 * `ring` (a densified outline) filled: triangulated unwrapped round the corner ([x plus the distance back from the end face, y], so a
 * wrapping lamp lies flat), then every edge longer than `fillStep` (`LAMP_STEP` across a lid's seam, so the lid's share ends at its edge)
 * split at its midpoint met on the skin, until none is (a split edge splits both its triangles, so no crack opens).
 */
function lampFill(skin: LampSkin, ring: readonly SkinPoint[], zEnd: number, fillStep = LAMP_FILL_STEP): Patch {
  const points = [...ring];
  let index = THREE.ShapeUtils.triangulateShape(ring.map(({ p }) => new THREE.Vector2(p.x + Math.abs(p.z - zEnd), p.y)), []).flat();
  const key = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);
  for (let pass = 0; pass < LAMP_REFINE_PASSES; pass++) {
    const mid = new Map<string, number>();
    for (let t = 0; t < index.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const [a, b] = [index[t + k]!, index[t + ((k + 1) % 3)]!];
        const [pa, pb] = [points[a]!, points[b]!];
        if (mid.has(key(a, b)) || pa.p.distanceTo(pb.p) <= (pa.lid === pb.lid ? fillStep : LAMP_STEP)) continue;
        mid.set(key(a, b), points.push(skin.onto(pa.p.clone().lerp(pb.p, 0.5), pa.n.clone().add(pb.n).normalize(), pa.lid && pb.lid)) - 1);
      }
    }
    if (mid.size === 0) break;
    const next: number[] = [];
    for (let t = 0; t < index.length; t += 3) {
      let tri = [index[t]!, index[t + 1]!, index[t + 2]!];
      let cut = tri.map((a, k) => mid.get(key(a, tri[(k + 1) % 3]!)));
      const n = cut.filter((m) => m !== undefined).length;
      // Turned so the split edges come first: a one-split triangle halves, a two-split one makes three, a three-split one four.
      for (let r = 0; r < 3 && n > 0 && n < 3 && !(cut[0] !== undefined && (n === 1 || cut[1] !== undefined)); r++) {
        tri = [tri[1]!, tri[2]!, tri[0]!];
        cut = [cut[1], cut[2], cut[0]];
      }
      const [a, b, c] = tri as [number, number, number];
      const [ab, bc, ca] = cut;
      if (n === 0) next.push(a, b, c);
      else if (n === 1) next.push(a, ab!, c, ab!, b, c);
      else if (n === 2) next.push(ab!, b, bc!, a, ab!, bc!, a, bc!, c);
      else next.push(a, ab!, ca!, ab!, b, bc!, ca!, bc!, c, ab!, bc!, ca!);
    }
    index = next;
  }
  return facingOut({ points, index });
}

/** +1 where `loop` runs counter-clockwise seen from outside (along its skin normals), else -1. */
function loopSign(loop: readonly SkinPoint[]): number {
  const [area, normal, cross] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i < loop.length; i++) {
    area.add(cross.crossVectors(loop[i]!.p, loop[(i + 1) % loop.length]!.p));
    normal.add(loop[i]!.n);
  }
  return area.dot(normal) >= 0 ? 1 : -1;
}

/** Rows of points along `line` (densified), each `[out, up]` off its line point: out across the line (away from a closed loop's inside) and met on the skin again, so a bezel's foot hugs a curving corner; then up along the skin normal. Stitched into quads. `hug`: a row whose point misses the skin (off its edge) folds back onto the row before, never standing in the air. */
function lampRibbon(skin: LampSkin, line: readonly SkinPoint[], closed: boolean, rows: readonly (readonly [number, number])[], hug = false): Patch {
  const n = line.length;
  const sign = closed ? loopSign(line) : 1;
  const points: SkinPoint[] = [];
  for (let i = 0; i < n; i++) {
    const s = line[i]!;
    const [prev, next] = closed ? [line[(i + n - 1) % n]!, line[(i + 1) % n]!] : [line[Math.max(0, i - 1)]!, line[Math.min(n - 1, i + 1)]!];
    const out = new THREE.Vector3().crossVectors(next.p.clone().sub(prev.p), s.n).normalize().multiplyScalar(sign);
    let last = s;
    for (const [o, up] of rows) {
      const q = s.p.clone().addScaledVector(out, o);
      let at = o === 0 ? s : skin.onto(q, s.n, s.lid);
      if (hug && at.p === q) at = last;
      last = at;
      points.push({ p: at.p.clone().addScaledVector(at.n, up), n: at.n, lid: s.lid });
    }
  }
  const r = rows.length;
  const index: number[] = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n;
    for (let k = 0; k < r - 1; k++) index.push(i * r + k, j * r + k, i * r + k + 1, i * r + k + 1, j * r + k, j * r + k + 1);
  }
  return facingOut({ points, index });
}

/** A disc of radius `r` on the skin at `c`. */
function lampRound(c: SkinPoint, r: number): Patch {
  const e1 = new THREE.Vector3().crossVectors(c.n, Math.abs(c.n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
  const e2 = new THREE.Vector3().crossVectors(c.n, e1);
  const points = [c];
  const index: number[] = [];
  for (let k = 0; k < LAMP_SHAPE.segments; k++) {
    const a = (2 * Math.PI * k) / LAMP_SHAPE.segments;
    points.push({ p: c.p.clone().addScaledVector(e1, r * detCos(a)).addScaledVector(e2, r * detSin(a)), n: c.n, lid: c.lid });
    index.push(0, 1 + k, 1 + ((k + 1) % LAMP_SHAPE.segments));
  }
  return facingOut({ points, index });
}

/** `patch`'s triangles lifted `up` along their normals: [the body's share, the lid's] (a triangle touching the lid goes with it, so none of the body's lies under the lid's edge), each point one vertex per share. */
function patchGeometry(patch: Patch, up: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const shares = [0, 1].map(() => ({ pos: [] as number[], nrm: [] as number[], index: [] as number[], vertex: new Map<number, number>() }));
  const { points, index } = patch;
  for (let t = 0; t < index.length; t += 3) {
    const tri = [index[t]!, index[t + 1]!, index[t + 2]!];
    const share = shares[tri.some((i) => points[i]!.lid) ? 1 : 0]!;
    for (const i of tri) {
      let v = share.vertex.get(i);
      if (v === undefined) {
        const { p, n } = points[i]!;
        v = share.pos.push(p.x + n.x * up, p.y + n.y * up, p.z + n.z * up) / 3 - 1;
        share.nrm.push(n.x, n.y, n.z);
        share.vertex.set(i, v);
      }
      share.index.push(v);
    }
  }
  const [body, lid] = shares.map(({ pos, nrm, index: tris }) =>
    new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)).setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3)).setIndex(tris),
  );
  return [body!, lid!];
}

/** A lamp built on its skin (car frame, right side): the body's share and the boot lid's. */
interface BuiltLamp {
  body: THREE.BufferGeometry;
  lid: THREE.BufferGeometry;
}

type Piece = [Patch, number, LampTone];

/** `shape` met on `skin`: its lens loops filled, a bezel lip round each, its cells, strips and rounds, each in its tone (`tone`). */
function buildShape(shape: LampShape, skin: LampSkin, zEnd: number, tone: (geo: THREE.BufferGeometry, t: LampTone) => THREE.BufferGeometry): BuiltLamp {
  const meet = (l: LampLoop) => l.points.map((p) => skin.at(p, l.side));
  const [loops, cells, strips] = [shape.loops.map(meet), (shape.cells ?? []).map((c) => meet(c.loop)), (shape.strips ?? []).map((s) => meet(s.line))];
  const rounds = (shape.rounds ?? []).map((r) => skin.at(r.at, r.side));
  skin.narrow([...loops.flat(), ...cells.flat(), ...strips.flat(), ...rounds]);
  const rings = loops.map((l) => skin.densify(l, true));
  const pieces: Piece[] = [
    ...rings.map((r): Piece => [lampFill(skin, r, zEnd), LAMP_SHAPE.lens, shape.lens]),
    ...cells.map((c, i): Piece => [lampFill(skin, skin.densify(c, true), zEnd), LAMP_SHAPE.cell, shape.cells![i]!.tone]),
    ...strips.map((s, i): Piece => {
      const { width, tone: t } = shape.strips![i]!;
      return [lampRibbon(skin, skin.densify(s, false), false, [[-width / 2, 0], [width / 2, 0]]), LAMP_SHAPE.inlay, t];
    }),
    ...rounds.map((c, i): Piece => [lampRound(c, shape.rounds![i]!.r), LAMP_SHAPE.inlay, shape.rounds![i]!.tone]),
  ];
  if (shape.bezel) {
    const lip = [[0, LAMP_SHAPE.lens], [LAMP_SHAPE.bezel / 2, LAMP_SHAPE.lens + (shape.recess ?? LAMP_SHAPE.recess)], [LAMP_SHAPE.bezel, -LAMP_SHAPE.sink]] as const;
    for (const r of rings) pieces.push([lampRibbon(skin, r, true, lip), 0, shape.bezel === "chrome" ? "chrome" : "dark"]);
  }
  const body: THREE.BufferGeometry[] = [];
  const lid: THREE.BufferGeometry[] = [];
  for (const [patch, up, t] of pieces) {
    const [b, l] = patchGeometry(patch, up);
    body.push(tone(b, t));
    lid.push(tone(l, t));
  }
  return { body: mergeToned(body, "style lamp"), lid: mergeToned(lid, "style lamp on the lid") };
}

/** Each style's drawn body skin, its lamps as built (`builtLamp`, by which and side) and its lamp seats (`lampSeatAt`), once per style object. */
const BODY_SKIN = new WeakMap<BodyStyle, THREE.BufferGeometry>();
const BUILT = new WeakMap<BodyStyle, Map<string, BuiltLamp>>();
const SEATS = new WeakMap<BodyStyle, Map<string, THREE.Vector3>>();

function bodySkin(style: BodyStyle): THREE.BufferGeometry {
  if (!BODY_SKIN.has(style)) BODY_SKIN.set(style, makeChassisGeometry(style));
  return BODY_SKIN.get(style)!;
}

/** Lamp `kind`'s seat on side `side` of `style` (its lamp space origin, where it lights from): its `lamps` [x, y] met on the drawn skin from outside along the end axis (on the end plane where no skin is met), the left the right's mirror. */
export function lampSeatAt(style: BodyStyle, kind: LampKind, side: number): THREE.Vector3 {
  let seat = SEATS.get(style)?.get(kind);
  if (!seat) {
    const [x, y] = style.lamps[kind];
    const [zEnd, axis] = [lampEndZ(kind, style), kind === "head" ? 1 : -1];
    const ray = new THREE.Raycaster(new THREE.Vector3(x, y, zEnd + axis * LAMP_PROBE_REACH), new THREE.Vector3(0, 0, -axis));
    seat = ray.intersectObject(new THREE.Mesh(bodySkin(style)), false)[0]?.point ?? new THREE.Vector3(x, y, zEnd);
    if (!SEATS.has(style)) SEATS.set(style, new Map());
    SEATS.get(style)!.set(kind, seat);
  }
  return new THREE.Vector3(side * seat.x, seat.y, seat.z);
}

/**
 * `style`'s own `which` lamp met on its skin (car frame, right side): head and tail on the body, the share landing on the hood or boot lid
 * apart (that lid carries it); front and rear on that bumper's fascia. `side` -1 meets it on the left skin mirrored onto the right: the left
 * half's triangles are not the right's mirror (a quad split on one diagonal mirrors onto the other), and round a corner they part by cm.
 */
function builtLamp(style: BodyStyle, which: keyof LampShapes, side = 1): BuiltLamp {
  const id = `${which}${side}`;
  const cached = BUILT.get(style)?.get(id);
  if (cached) return cached;
  const front = which === "head" || which === "front";
  const kind: LampKind = front ? "head" : "tail";
  const zEnd = lampEndZ(kind, style);
  const mirror = side < 0;
  const body: SkinSource = { geo: bodySkin(style), offset: new THREE.Vector3(), lid: false, mirror };
  const bumper = which === "front" || which === "rear";
  const seat = style.bumpers[front ? "front" : "rear"].seat;
  const shape = style.lamps.shapes![which]!;
  const sources: SkinSource[] = bumper
    ? [{ geo: makeBumperGeometry(front, style), offset: new THREE.Vector3(0, seat.y, front ? seat.z : -seat.z), lid: false, mirror }, ...(shape.onBody ? [body] : [])]
    : [{ geo: front ? makeHoodGeometry(style) : makeTrunkGeometry(style), offset: new THREE.Vector3(0, ...(front ? style.hood.origin : bootPivot(style.boot))), lid: true, mirror }, body];
  const skin = new LampSkin(sources, zEnd, front ? 1 : -1, `${style.id} ${which} lamp${mirror ? " (left)" : ""}`);
  const built = buildShape(shape, skin, zEnd, (geo, t) => (bumper ? bumperTone(geo, t, kind) : lampTone(geo, t, kind, style.lamps.bulb)));
  if (!BUILT.has(style)) BUILT.set(style, new Map());
  BUILT.get(style)!.set(id, built);
  return built;
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

/** A right-side build on both sides: the right as built, the left mirrored. */
function bothSides(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const left = geo.clone();
  mirrorX(left);
  return mergeToned([geo.clone(), left], "both sides");
}

/** `style`'s own `kind` lamp on side `side` (its body share), in lamp space at its seat's rest. */
function styleLamp(style: BodyStyle, kind: LampKind, side: number): THREE.BufferGeometry {
  const geo = builtLamp(style, kind, side).body.clone();
  if (side < 0) mirrorX(geo);
  const rest = new THREE.Matrix4().compose(lampSeatAt(style, kind, side), lampRest(kind, style, new THREE.Quaternion()), new THREE.Vector3(1, 1, 1));
  return geo.applyMatrix4(rest.invert());
}

/** The share of `style`'s `kind` lamp on `side` its lid carries (a tail's on the boot lid, a head's on the hood), in that lid's space (the hood's origin, the boot's pivot). */
function lidLamp(style: BodyStyle, kind: LampKind, side: number): THREE.BufferGeometry {
  const [y, z] = kind === "head" ? style.hood.origin : bootPivot(style.boot);
  const share = builtLamp(style, kind, side).lid.clone();
  if (side < 0) mirrorX(share);
  return share.translate(0, -y, -z);
}

// ---- bumper seam covers ----------------------------------------------------------------------------------------------------

type SeamLine = NonNullable<BodyStyle["bumpers"]["front"]["edge"]>;

/** The seam cover's lift (m) off the body skin: over the sag of its chords (12 cm on a 35 cm corner sags 5 mm), well under the fascia's 6-9 cm. */
const SEAM_COVER_UP = 0.006;
/** Its seam's longest step (m), and how far out (m) a point between met points starts its ray: past the sag of a chord right across the corner. */
const SEAM_COVER_MESH = { step: 0.12, recast: 0.6 } as const;
/** Its band's rows across the seam, as fractions of the drop from the seam's top to under the fascia's top: the skin the fascia leaves bare, no more. */
const SEAM_COVER_BAND = [0, 1] as const;
/** On the end face the band runs at least this far (m) under the seam's lowest point, tucked under the fascia's top. */
const SEAM_COVER_TUCK = 0.02;
/** Its dark roll along the seam: this wide (m) out past the seam and down to this deep (m) in the skin, the shut line drawn in the mesh. */
const SEAM_COVER_ROLL = { out: 0.004, sink: 0.001 } as const;
const SEAM_COVERS = new WeakMap<BodyStyle, Map<boolean, THREE.BufferGeometry | null>>();

/** `parts` merged, each vertex carrying its part's `FITTING_TONE` (0: the bumper's own trim). */
function fittingsMerged(parts: readonly (readonly [THREE.BufferGeometry, number])[], what: string): THREE.BufferGeometry {
  for (const [geo, tone] of parts) geo.setAttribute(FITTING_ATTRIBUTE, new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute("position").count).fill(tone), 1));
  const out = mergeGeometries(parts.map(([geo]) => geo));
  if (!out) throw new Error(`Failed to merge the ${what}`);
  return out;
}

/** One side's seam cover in the car frame, right side (`mirror`: met on the left skin mirrored onto the right): a band met on the skin down from the seam, and its dark roll. */
function seamCoverSide(style: BodyStyle, front: boolean, top: SeamLine, edge: SeamLine, mirror: boolean): THREE.BufferGeometry {
  const { seat, fascia } = style.bumpers[front ? "front" : "rear"];
  const [zEnd, axis] = [lampEndZ(front ? "head" : "tail", style), front ? 1 : -1];
  const skin = new LampSkin([{ geo: bodySkin(style), offset: new THREE.Vector3(), lid: false, mirror }], zEnd, axis, `${style.id} ${front ? "front" : "rear"} bumper seam`, SEAM_COVER_MESH);
  const face = Math.min(seat.y + Math.max(...fascia.map(([y]) => y)), Math.min(...top.map(([, y]) => y)) - SEAM_COVER_TUCK);
  const drop = Math.max(...top.map(([, y]) => y)) - face;
  const seam = skin.densify([...top.map((p) => skin.at(p)), ...edge.map((p) => skin.at(p, true))], false);
  const band = lampRibbon(skin, seam, false, SEAM_COVER_BAND.map((f) => [axis * f * drop, SEAM_COVER_UP] as const), true);
  const roll = lampRibbon(skin, seam, false, [[0, SEAM_COVER_UP], [-axis * SEAM_COVER_ROLL.out, -SEAM_COVER_ROLL.sink]]);
  const [panel] = patchGeometry(band, 0);
  const [shut] = patchGeometry(roll, 0);
  return fittingsMerged([[panel, 0], [shut, FITTING_TONE.black]], "bumper seam cover");
}

/**
 * `front` bumper's seam cover in its group's space, both sides (null without its `top` and `edge`): the body skin from the seam down, met
 * `SEAM_COVER_UP` proud; on the end face from `top` to under the fascia's top, round the corner and down the side along `edge` to its foot.
 */
function seamCover(style: BodyStyle, front: boolean): THREE.BufferGeometry | null {
  const cached = SEAM_COVERS.get(style)?.get(front);
  if (cached !== undefined) return cached;
  const { seat, top, edge } = style.bumpers[front ? "front" : "rear"];
  let cover: THREE.BufferGeometry | null = null;
  if (top && edge) {
    const left = seamCoverSide(style, front, top, edge, true);
    mirrorX(left);
    cover = fittingsMerged([[seamCoverSide(style, front, top, edge, false), 0], [left, 0]], "bumper seam cover").translate(0, -seat.y, -(front ? seat.z : -seat.z));
  }
  if (!SEAM_COVERS.has(style)) SEAM_COVERS.set(style, new Map());
  SEAM_COVERS.get(style)!.set(front, cover);
  return cover;
}

/** `bumper` (its group's drawn geometry: the fascia, a rear one with its fittings) with `style`'s seam cover merged in; itself without one. */
export function withSeamCover(bumper: THREE.BufferGeometry, style: BodyStyle, front: boolean): THREE.BufferGeometry {
  const built = seamCover(style, front);
  if (!built) return bumper;
  const cover = built.clone();
  if (!bumper.hasAttribute(FITTING_ATTRIBUTE)) bumper.setAttribute(FITTING_ATTRIBUTE, new THREE.Float32BufferAttribute(new Float32Array(bumper.getAttribute("position").count), 1));
  for (const [name, attr] of Object.entries(bumper.attributes)) {
    if (!cover.hasAttribute(name)) cover.setAttribute(name, new THREE.Float32BufferAttribute(new Float32Array(cover.getAttribute("position").count * attr.itemSize), attr.itemSize));
  }
  const out = mergeGeometries([bumper, cover]);
  if (!out) throw new Error(`Failed to merge the ${style.id} bumper's seam cover`);
  return out;
}

/** No lamp on the lid: the lid slot's platform variant. Shared, never disposed. */
const noLidLamp = once(() =>
  lampTone(indexed(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([], 3)).setAttribute("normal", new THREE.Float32BufferAttribute([], 3))), "dark", "tail"),
);

const lampKey = (style: BodyStyle, kind: LampKind, side: number): string | null => {
  const shape = style.lamps.shapes?.[kind];
  return shape ? `${style.id}|${kind}|${side}|${JSON.stringify(shape)}|${JSON.stringify(style.lamps[kind])}${kind === "head" && style.lamps.bulb ? `|${style.lamps.bulb}` : ""}` : null;
};

/** The high-mount brake lamp, 1 m square (its seat scales it to `lamps.brake.size`): a dark housing, a lit red lens. Shared, never disposed. */
export const brakeLampUnit = once(() =>
  mergeToned([lampTone(new THREE.BoxGeometry(1, 1, 0.02).translate(0, 0, 0.004), "dark", "tail"), lampTone(new THREE.BoxGeometry(0.9, 0.8, 0.012).translate(0, 0, 0.01), "lit", "tail")], "brake lamp"),
);
/** A side marker, 1 m square (its seat scales it to a `lamps.sideMarkers` size): an unlit amber lens. Shared, never disposed. */
export const sideMarkerUnit = once(() => lampTone(new THREE.BoxGeometry(1, 1, 0.012).translate(0, 0, 0.004), "amber", "head"));

// ---- wipers ----------------------------------------------------------------------------------------------------------------

/** Where the parked blades lie: this far (m) up the windshield's slope from its base, over the cowl's lip. */
const WIPER_PARK_UP = 0.035;
/** Each blade's rubber [width up the glass, height off it] and its gap off the glass (m); the arm over it, and how far along the blade it reaches. */
const WIPER_BLADE = { w: 0.018, h: 0.01, gap: 0.004 } as const;
const WIPER_ARM = { w: 0.012, h: 0.008, reach: 0.85 } as const;
/** The pivot cap's edge (m), standing on the arm's root. */
const WIPER_PIVOT = 0.028;
/** Stations along a blade: it follows the glass's bow across the car. */
const WIPER_STATIONS = 8;
/** Where each of a pair's pivots stands across the glass's base width (car x over the width; the tips run toward `park`). */
const WIPER_PAIR_PIVOTS = [-0.44, -0.02] as const;
/** A style's wipers where it sets none: two blades, each 0.42 of the glass base, parked toward the driver. */
const WIPER_DEFAULT = { count: 2, length: 0.42, park: DRIVER_SIDE } as const;

/**
 * A tube of rectangular section swept along `centres`, each station's section spanned by its own `w` (across the tube, up the glass) and
 * `n` (out of the glass) unit axes: four sides and two end caps.
 */
function sweptBar(centres: readonly THREE.Vector3[], ws: readonly THREE.Vector3[], ns: readonly THREE.Vector3[], width: number, height: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
  for (let i = 0; i < centres.length; i++) {
    for (const [a, b] of corners) {
      const p = centres[i]!.clone().addScaledVector(ws[i]!, (a * width) / 2).addScaledVector(ns[i]!, (b * height) / 2);
      positions.push(p.x, p.y, p.z);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < centres.length - 1; i++) {
    for (let k = 0; k < 4; k++) {
      const [a, b, c, d] = [i * 4 + k, i * 4 + ((k + 1) % 4), (i + 1) * 4 + ((k + 1) % 4), (i + 1) * 4 + k];
      index.push(a, b, c, a, c, d);
    }
  }
  const last = (centres.length - 1) * 4;
  index.push(0, 2, 1, 0, 3, 2, last, last + 1, last + 2, last, last + 2, last + 3);
  const geo = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)).setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/**
 * `style`'s wipers, in car space (their seat rides the windshield pane at its origin): each blade parked `WIPER_PARK_UP` up the glass from its
 * base, its rubber on the glass's bow across the car, its arm over it from the pivot, a cap on the pivot; black plastic. `userData.blades`:
 * each blade's pivot and tip on the glass.
 */
function styleWipers(style: BodyStyle): THREE.BufferGeometry {
  const { count, length, park } = { ...WIPER_DEFAULT, ...style.wipers };
  const { base, wBase, wTop } = style.windshield;
  const top = style.windshieldTop;
  const t = WIPER_PARK_UP / Math.hypot(top[0] - base[0], top[1] - base[1]);
  const half = (wBase + (wTop - wBase) * t) / 2;
  const pivots = count === 2 ? WIPER_PAIR_PIVOTS.map((s) => s * wBase) : [(-length * wBase) / 2];
  const parts: THREE.BufferGeometry[] = [];
  const blades: { pivot: number[]; tip: number[] }[] = [];
  for (const from of pivots) {
    const xs = Array.from({ length: WIPER_STATIONS + 1 }, (_, i) => park * (from + (length * wBase * i) / WIPER_STATIONS));
    const at = xs.map((x) => windshieldPoint(style, x / half, t));
    const ws = xs.map((x) => windshieldPoint(style, x / half, t + 0.01).sub(windshieldPoint(style, x / half, t)).normalize());
    const ns = at.map((p, i) => {
      const along = at[Math.min(i + 1, at.length - 1)]!.clone().sub(at[Math.max(i - 1, 0)]!);
      const n = along.cross(ws[i]!).normalize();
      return n.z < 0 ? n.negate() : n;
    });
    const lifted = (lift: number, upTo = 1) => at.slice(0, Math.round(WIPER_STATIONS * upTo) + 1).map((p, i) => p.clone().addScaledVector(ns[i]!, lift));
    const rubber = lifted(WIPER_BLADE.gap + WIPER_BLADE.h / 2);
    const arm = lifted(WIPER_BLADE.gap + WIPER_BLADE.h + WIPER_ARM.h / 2, WIPER_ARM.reach);
    parts.push(sweptBar(rubber, ws, ns, WIPER_BLADE.w, WIPER_BLADE.h), sweptBar(arm, ws, ns, WIPER_ARM.w, WIPER_ARM.h));
    parts.push(sweptBar([0, 1].map((k) => at[0]!.clone().addScaledVector(ns[0]!, WIPER_BLADE.gap + WIPER_BLADE.h + k * WIPER_PIVOT)), [ws[0]!, ws[0]!], [at[1]!.clone().sub(at[0]!).normalize(), at[1]!.clone().sub(at[0]!).normalize()], WIPER_PIVOT, WIPER_PIVOT));
    blades.push({ pivot: at[0]!.toArray(), tip: at[WIPER_STATIONS]!.toArray() });
  }
  const geo = mergeToned(
    parts.map((g) => dark(g, TRIM_BLACK, TRIM_FINISH.plastic.roughness, TRIM_FINISH.plastic.metalness)),
    "style wipers",
  );
  geo.userData.blades = blades;
  return geo;
}

/** A style's wipers' variant key: they lie on its own windshield (its data and its dome's fall), so every style draws its own. */
const wipersKey = (style: BodyStyle): string => `${style.id}|${JSON.stringify([style.windshield, style.windshieldTop, style.wipers ?? null])}`;

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
  grille: { base: () => partGeometry(PART_KIND.grille), sides: [0], key: frontKey, build: frontFittings },
  tailTrim: { base: () => partGeometry(PART_KIND.tailTrim), sides: [0], key: rearKey, build: rearFittings },
  head: { base: once(() => makeLampUnit("head")), sides: [-1, 1], key: (style, side) => lampKey(style, "head", side), build: (style, side) => styleLamp(style, "head", side) },
  tail: { base: once(() => makeLampUnit("tail")), sides: [-1, 1], key: (style, side) => lampKey(style, "tail", side), build: (style, side) => styleLamp(style, "tail", side) },
  boot: { base: noLidLamp, sides: [-1, 1], key: (style, side) => lampKey(style, "tail", side), build: (style, side) => lidLamp(style, "tail", side) },
  hood: { base: noLidLamp, sides: [-1, 1], key: (style, side) => lampKey(style, "head", side), build: (style, side) => lidLamp(style, "head", side) },
  wipers: { base: () => partGeometry(PART_KIND.wipers), sides: [0], key: wipersKey, build: styleWipers },
} as const satisfies Record<string, Slot>;
type SlotName = keyof typeof SLOTS;

const PART_SLOT: Partial<Record<PartKind, SlotName>> = {
  [PART_KIND.mirrorL]: "mirrorL",
  [PART_KIND.mirrorR]: "mirrorR",
  [PART_KIND.grille]: "grille",
  [PART_KIND.tailTrim]: "tailTrim",
  [PART_KIND.wipers]: "wipers",
};

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

/** Lamp slot `slot` (head, tail, or the share of the heads on the hood / the tails on the boot lid) on side `side` of `style`: its geometry and its variant in the lamp batch (`drawnVariant`). */
export function drawnLamp(style: BodyStyle, slot: LampKind | "hood" | "boot", side: number): { variant: number; geometry: THREE.BufferGeometry } {
  return drawnVariant(slot, style, side);
}

/**
 * Slot `name`'s variants as the batches draw them, one draw each (`painted` set on every one); null while no style in the fleet table draws
 * its own. One merged draw billed every instance the whole fleet's variants: 15 head-lamp units each, about 26k triangles per car.
 */
function variantGeometries(name: SlotName): THREE.BufferGeometry[] | null {
  const entry = VARIANTS().get(name)!;
  if (entry.geometries.length === 1) return null;
  return entry.geometries.map((geometry) => {
    const g = geometry.clone();
    if (!g.getAttribute(PAINTED_ATTRIBUTE)) withPainted(g, 0);
    return g;
  });
}

/** The part batch's geometries for `kind`, by variant (`variantGeometries`); null for a kind with one shape. */
export function partBatchGeometries(kind: PartKind): THREE.BufferGeometry[] | null {
  const name = PART_SLOT[kind];
  return name ? variantGeometries(name) : null;
}

/** The lamp batch's geometries for `slot`, by variant (`variantGeometries`); null while every style draws the platform unit (or, on a lid, none). */
export function lampBatchGeometries(slot: LampKind | "hood" | "boot"): THREE.BufferGeometry[] | null {
  return variantGeometries(slot);
}
