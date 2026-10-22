import * as THREE from "three";
import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import type { BodyStyle, PillarSpan, YZ } from "./car-variants.ts";
import { aPillarTopZ, aPostRearZ, bPillarBand, beltX, beltY, cantDrop, doorGlassFrontZ, pillarBands } from "./car-lines.ts";
import { quarterSillZs } from "./car-glass.ts";
import { splitCreases } from "./car-crease.ts";
import {
  ROOF_CROWN,
  ROOF_SHOULDER,
  cantX,
  cantY,
  ensureOutwardNormals,
  glassTopY,
  glassX,
  lerp,
  loftFromRings,
  roofAt,
  roofTopY,
  shoulderTop,
  type BodySource,
  type Pt,
  type V3,
} from "./car-mesh.ts";

/** The drawn roof's side runs this far (m) past the cant line: the side glass sits under it and the pillars, as proud of the glass, meet it flush. */
const ROOF_DRIP = 0.01;
/** The drawn roof's side rolls up from the cant line into its dome's edge through a quarter ellipse at these angles (rad, 0 at the cant line). */
const ROOF_ROLL = [0, Math.PI / 6, Math.PI / 3, Math.PI / 2] as const;
/** The drawn roof's side meets its flat underside near 90°: split there, so the side keeps its own normals instead of shading half down (a grey band). */
const ROOF_CREASE_DEGREES = 60;
/** The drawn headliner stands this far (m) inside the roof skin: a few mm, the skin's inner face, never past it. */
const HEADLINER_INSET = 0.004;
/** The skin points the headliner is inset from, past the left side's roll: right cant, crown, left cant (the dome bows 4 mm past the chords between). */
const HEADLINER_POINTS = [4, 2, 0] as const;
/** The roof's z segments: the cage's, and the drawn one's, fewer so its headliner keeps the body within its vertex budget (the chords sag 0.5 mm). */
const ROOF_SEGS = { cage: 16, drawn: 12 } as const;

/** The drawn roof's side (+x), cant line up to the dome's edge at (`x`, `y`): a quarter ellipse `ROOF_LIP_OUT + ROOF_DRIP` out and `lip` down. */
function roofRoll(x: number, y: number, lip: number): Pt[] {
  return ROOF_ROLL.map((a) => ({ x: x + (ROOF_LIP_OUT + ROOF_DRIP) * detCos(a), y: y - lip * (1 - detSin(a)) }));
}

/** `skin` (an open section, left side over the crown to the right side, its left cant at `cant`) and its `HEADLINER_POINTS` `inset` inside it. */
function shellRing(skin: Pt[], cant: number, inset: number): Pt[] {
  const inner: Pt[] = [];
  for (const offset of HEADLINER_POINTS) {
    const k = cant + offset;
    const tx = skin[k + 1]!.x - skin[k - 1]!.x;
    const ty = skin[k + 1]!.y - skin[k - 1]!.y;
    const len = hypot2(tx, ty);
    // Left to right over the crown, (-ty, tx) is the skin's outward normal.
    inner.push({ x: skin[k]!.x + (ty / len) * inset, y: skin[k]!.y - (tx / len) * inset });
  }
  return [...skin, ...inner];
}

/**
 * The roof panel. The cage keeps its knee-lip section down to a keel under the crown. The drawn roof's side rolls into the dome with
 * no shelf, and it is a thin shell: its inner face, inset `HEADLINER_INSET` from the skin's cants and crown, is the headliner
 * (`userData.shellTwins`: each inner vertex, then the skin vertex it is inset from).
 */
export function makeRoofGeometry(style: BodyStyle, source: BodySource = "drawn"): THREE.BufferGeometry {
  const [z0, z1] = style.roofZ;
  const lip = cantDrop(style);
  const segs = ROOF_SEGS[source];
  const rings: Pt[][] = [];
  const zs: number[] = [];
  for (let s = 0; s <= segs; s++) {
    const z = lerp(z0, z1, s / segs);
    const { y, x } = roofAt(z, style);
    const side: Pt[] =
      source === "cage"
        ? [
            { x: x + ROOF_LIP_OUT, y: y - lip },
            { x: x + ROOF_LIP_KNEE[0], y: y - ROOF_LIP_KNEE[1] },
          ]
        : roofRoll(x, y, lip).slice(0, -1);
    const skin = [
      ...side.map((p) => ({ x: -p.x, y: p.y })),
      { x: -x, y },
      { x: -x * ROOF_SHOULDER[0], y: y + ROOF_SHOULDER[1] },
      { x: 0, y: y + ROOF_CROWN },
      { x: x * ROOF_SHOULDER[0], y: y + ROOF_SHOULDER[1] },
      { x, y },
      ...[...side].reverse(),
    ];
    rings.push(source === "drawn" ? shellRing(skin, side.length, HEADLINER_INSET) : [...skin, { x: 0, y: y - 0.085 }]);
    zs.push(z);
  }
  const geo = loftFromRings(rings, zs, 0.28, 0.72);
  ensureOutwardNormals(geo);
  if (source === "cage") return geo;
  // The loft's rings, then each end cap's own copy of its ring (`loftFromRings`).
  const n = rings[0]!.length;
  const cant = (n - HEADLINER_POINTS.length - 5) / 2;
  const twins: number[] = [];
  for (const base of [...zs.map((_, s) => s * n), zs.length * n, zs.length * n + n + 1]) {
    for (let j = 0; j < HEADLINER_POINTS.length; j++) twins.push(base + n - HEADLINER_POINTS.length + j, base + cant + HEADLINER_POINTS[j]!);
  }
  const unsplit = geo.getAttribute("position").count;
  splitCreases(geo, ROOF_CREASE_DEGREES);
  // A crease's copy of a headliner vertex (`splitCreases` appends them) is a headliner vertex too.
  const pos = geo.getAttribute("position");
  const key = (v: number) => `${pos.getX(v)},${pos.getY(v)},${pos.getZ(v)}`;
  const skinOf = new Map<string, number>();
  for (let k = 0; k < twins.length; k += 2) skinOf.set(key(twins[k]!), twins[k + 1]!);
  for (let v = unsplit; v < pos.count; v++) {
    const skin = skinOf.get(key(v));
    if (skin !== undefined) twins.push(v, skin);
  }
  geo.userData.shellTwins = Int32Array.from(twins);
  return geo;
}

/**
 * Each lengthwise edge of a greenhouse rail or the A-post is cut by one 45° chamfer (`PILLAR_FILLET_STEPS` = 1 chord of a quarter
 * circle of radius `PILLAR_FILLET`, m; at most `PILLAR_FILLET_SHARE` of the section side it cuts), so the vertex normals roll round the
 * edge in two 45° steps instead of turning 90° at once; the section never grows past the box.
 */
const PILLAR_FILLET = 0.007;
const PILLAR_FILLET_SHARE = 0.45;
const PILLAR_FILLET_STEPS = 1;
/** A drawn post's (B, C, divider) corners round at this share of its depth in `POST_ROUND_STEPS` chords: a curved section, 30° a chord, its depth sides all but rounded off. */
const POST_ROUND = 0.45;
const POST_ROUND_STEPS = 3;
/** Quarter-circle corners of the unit section, counter-clockwise from the corner at (1, 0): the corner, the arc's centre sign and its start angle (rad). */
const FILLET_CORNERS = [
  { x: 1, y: 0, startAngle: -Math.PI / 2 },
  { x: 1, y: 1, startAngle: 0 },
  { x: 0, y: 1, startAngle: Math.PI / 2 },
  { x: 0, y: 0, startAngle: Math.PI },
] as const;

/** The fraction of a section side (m) that a fillet of `radius` takes off each end; none on a side of no length. */
function filletShare(side: number, radius = PILLAR_FILLET): number {
  return side > 0 ? Math.min(radius, PILLAR_FILLET_SHARE * side) / side : 0;
}

/** A crowned pillar's outer face bulges this far (m) at its middle over its edges, through points at these shares of its flat between the corners: it reads curved, not a flat box. */
const PILLAR_CROWN = 0.008;
const CROWN_POINTS = [0.25, 0.5, 0.75] as const;

/**
 * A rectangle's outline in the unit square with elliptical-arc corners of radii `radiusU` x `radiusW` (unit fractions along each
 * axis), `steps` chords each; `crownU` (a unit fraction of u) bulges its outer face (u = 1) out in a parabola, 0 at its edges.
 */
function filletedUnitSection(radiusU: number, radiusW: number, steps = PILLAR_FILLET_STEPS, crownU = 0): Pt[] {
  const section: Pt[] = [];
  for (const corner of FILLET_CORNERS) {
    const centreU = corner.x === 1 ? 1 - radiusU : radiusU;
    const centreW = corner.y === 1 ? 1 - radiusW : radiusW;
    for (let step = 0; step <= steps; step++) {
      const angle = corner.startAngle + (step / steps) * (Math.PI / 2);
      section.push({ x: centreU + radiusU * detCos(angle), y: centreW + radiusW * detSin(angle) });
    }
    // The outer face runs from this corner's last point to the next one's first, its crown points spread over the flat between the arcs.
    if (crownU > 0 && corner.x === 1 && corner.y === 0) for (const w of CROWN_POINTS) section.push({ x: 1, y: radiusW + w * (1 - 2 * radiusW) });
  }
  if (crownU > 0) for (const p of section) if (p.x > 0.5) p.x += crownU * (1 - (2 * p.y - 1) ** 2);
  return section;
}

/**
 * Box mapped onto four outer-face corners (+x side), thickness inward;
 * sign -1 mirrors to the left without flipping the winding.
 */
function boxFromCorners(
  sign: number,
  c: { fb: V3; rb: V3; rt: V3; ft: V3 },
  thick: number,
  hs = 1,
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(1, 1, 1, 1, hs, 1);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) + 0.5;
    const v = pos.getY(i) + 0.5;
    const w = pos.getZ(i) + 0.5;
    const at = (k: number) => lerp(lerp(c.rb[k]!, c.fb[k]!, w), lerp(c.rt[k]!, c.ft[k]!, w), v);
    const outer = at(0);
    const x = sign > 0 ? outer - (1 - u) * thick : -(outer - u * thick);
    pos.setXYZ(i, x, at(1), at(2));
  }
  return geo;
}

/** A pillar section's outer-face rear and front points at one station along it (+x side), and the plan direction [x share, z share] its depth runs in along (absent: straight in, -x). */
type Rail = { rear: V3; front: V3; inward?: readonly [number, number] };

/**
 * Pillar lofted through `rails` (belt to top), thickness inward, its unit `section` at each rail's width (default: corners rounded at
 * `radius` (m) in `steps` chords, the outer face bulged `crown` (m)); sign -1 mirrors to the left without flipping the winding.
 * Its end caps share the end rings; `open`: both ends are buried (in the body, the roof's side), so it draws no caps.
 */
function roundedPillarAlong(
  sign: number,
  rails: readonly Rail[],
  thick: number,
  {
    radius = PILLAR_FILLET,
    steps = PILLAR_FILLET_STEPS,
    open = false,
    crown = 0,
    section = (width: number) => filletedUnitSection(filletShare(thick, radius), filletShare(width, radius), steps, crown / thick),
  }: { radius?: number; steps?: number; open?: boolean; crown?: number; section?: (width: number) => Pt[] } = {},
): THREE.BufferGeometry {
  const last = rails.length - 1;
  const stations = rails.map((_, k) => k / last);
  const sections = rails.map(({ rear, front }) => section(hypot2(hypot2(front[0] - rear[0], front[1] - rear[1]), front[2] - rear[2])));
  const geo = loftFromRings(sections, stations, 0, 1, false);
  if (open) {
    // The loft's rings and side triangles come first, its caps' centres and fans after.
    const ring = sections[0]!.length;
    geo.setIndex(Array.from(geo.index!.array.subarray(0, last * ring * 6)));
    for (const name of ["position", "uv"]) {
      const attribute = geo.getAttribute(name);
      geo.setAttribute(name, new THREE.Float32BufferAttribute(attribute.array.slice(0, rails.length * ring * attribute.itemSize), attribute.itemSize));
    }
  }
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i);
    const w = pos.getY(i);
    const { rear, front, inward = [1, 0] } = rails[Math.round(pos.getZ(i) * last)]!;
    const depth = (sign > 0 ? 1 - u : u) * thick;
    pos.setXYZ(i, sign * (lerp(rear[0], front[0], w) - depth * inward[0]), lerp(rear[1], front[1], w), lerp(rear[2], front[2], w) + depth * inward[1]);
  }
  ensureOutwardNormals(geo);
  return geo;
}

/** A drawn post's unit section (u across its `thick` depth, the outer face at 1; w across its `width`): `POST_ROUND` corners, the outer face crowned. */
export function postSection(thick: number, width: number): Pt[] {
  const radius = POST_ROUND * thick;
  return filletedUnitSection(filletShare(thick, radius), filletShare(width, radius), POST_ROUND_STEPS, PILLAR_CROWN / thick);
}

/**
 * Drawn post (`postSection`) mapped onto four outer-face corners (+x side), its depth straight in, or square to its face in plan when
 * `square` (the C-pillar, whose face turns toward the tail); sign -1 mirrors to the left without flipping the winding.
 */
function roundedPillarFromCorners(sign: number, c: { fb: V3; rb: V3; rt: V3; ft: V3 }, thick: number, square = false): THREE.BufferGeometry {
  const rails = [0, 1].map((v): Rail => {
    const rear: V3 = [lerp(c.rb[0], c.rt[0], v), lerp(c.rb[1], c.rt[1], v), lerp(c.rb[2], c.rt[2], v)];
    const front: V3 = [lerp(c.fb[0], c.ft[0], v), lerp(c.fb[1], c.ft[1], v), lerp(c.fb[2], c.ft[2], v)];
    const [dx, dz] = [front[0] - rear[0], front[2] - rear[2]];
    return square ? { rear, front, inward: [dz / hypot2(dx, dz), dx / hypot2(dx, dz)] } : { rear, front };
  });
  return roundedPillarAlong(sign, rails, thick, { open: true, section: (width) => postSection(thick, width) });
}

/** The drawn A-post's depth inward (m): a slim post, not a slab. */
const A_POST_THICK = 0.03;
/** Stations along the drawn A-post: its rails run straight up to the cant line, so all but the last spread evenly up to it and the last runs up into the roof. */
const A_POST_STATIONS = 6;
/** The A-post's last station under the roof stands this far (m) under the cant line, so none of its points reaches into the roof. */
const A_POST_CANT_CLEAR = 0.005;
/** Halvings that find where the A-post's rails reach the cant line: 20 put it within a micron. */
const A_POST_CANT_STEPS = 20;
/** The drawn A-post stands this far (m) off the windshield's edge and the side glass, outward, so neither glass shows through it. */
const A_POST_LIFT = 0.004;
/** A drawn pillar's top runs this far (m) up past the cant line, buried in the roof's side. */
const PILLAR_TOP_RISE = 0.03;
/** The sail (the panel between the A-post and the door glass) is this thick (m), on the side glass plane. */
const SAIL_THICK = 0.02;
/** A sail narrower than this (m) at every station is not drawn. */
const SAIL_MIN = 0.005;
/** Where the door glass runs under the post the sail thins to this (m), never to nothing, so its faces keep their normals. */
const SAIL_EDGE = 0.001;
/** Stations along the sail, base to its top. */
const SAIL_STATIONS = 3;

/**
 * The drawn A-post's rails and its sail's, base to top. The post's front rail runs along the windshield's edge (carried down the
 * edge's line to the belt when the belt lies under the windshield's base, so its foot lies level in the cowl); its rear rail runs
 * `aPostRearZ` behind it in side view, across the side glass's lean from the door glass's foot to its top-front corner; its depth runs
 * square to its face in plan. The sail fills from the post's rear edge to the door glass's front edge (`doorGlassFrontZ`) up to the
 * glass's knee (or the post's top), so no glass layout leaves a hole or a sliver.
 */
function aPostRails(style: BodyStyle): { post: Rail[]; sail: Rail[] | null } {
  const { base, wBase, wTop } = style.windshield;
  const [topY, topZ] = style.windshieldTop;
  const run = hypot2(topZ - base[1], topY - base[0]);
  const [uz, uy] = [(topZ - base[1]) / run, (topY - base[0]) / run];
  const [footZ, aTopZ] = [style.aPillarFoot, aPillarTopZ(style)];
  const [footY, aTopY] = [beltY(footZ, style), cantY(aTopZ, style) + PILLAR_TOP_RISE];
  const edgeFoot = Math.min(0, (footY - base[0]) / (topY - base[0]));
  const glassTop = glassTopY(aTopZ, style);
  const cantTop = cantY(aTopZ, style);
  const glassPlaneX = (y: number) => lerp(beltX(footZ, style), cantX(aTopZ, style), THREE.MathUtils.clamp((y - footY) / (cantTop - footY), 0, 1));
  const railAt = (t: number): Rail => {
    const y = lerp(footY, aTopY, t);
    const postZ = aPostRearZ(y, style);
    const edge = lerp(edgeFoot, 1, t);
    const [frontY, frontZ] = [lerp(base[0], topY, edge) - A_POST_LIFT * uz, lerp(base[1], topZ, edge) + A_POST_LIFT * uy];
    const [frontX, rearX] = [lerp(wBase, wTop, edge) / 2 + A_POST_LIFT, glassPlaneX(y) + A_POST_LIFT];
    const roofZ = THREE.MathUtils.clamp(postZ, style.roofZ[0], style.roofZ[1]);
    const rear: V3 = [underRoofSide(rearX, y, roofZ, style), y, postZ];
    const front: V3 = [underRoofSide(frontX, frontY, frontZ, style), frontY, frontZ];
    // Square to the face after the roof's tuck: squaring it before shears the top stations' corners past 35°.
    const [dx, dz] = [front[0] - rear[0], front[2] - rear[2]];
    return { rear, front, inward: [dz / hypot2(dx, dz), dx / hypot2(dx, dz)] };
  };
  // Every point of the station's section stays under the cant line wherever the roof spans, on either side (`roundedPillarAlong`'s left
  // mapping takes its depth from u, the right's from 1 - u).
  const underCant = (t: number) => {
    const { rear, front, inward = [1, 0] } = railAt(t);
    return postSection(A_POST_THICK, hypot2(hypot2(front[0] - rear[0], front[1] - rear[1]), front[2] - rear[2])).every(({ x: u, y: w }) =>
      [u, 1 - u].every((depth) => {
        const [y, z] = [lerp(rear[1], front[1], w), lerp(rear[2], front[2], w) + depth * A_POST_THICK * inward[1]];
        return z < style.roofZ[0] || z > style.roofZ[1] || y < cantY(z, style) - A_POST_CANT_CLEAR;
      }),
    );
  };
  let [shownTop, heldFrom] = [0, 1];
  for (let k = 0; k < A_POST_CANT_STEPS; k++) {
    const mid = (shownTop + heldFrom) / 2;
    if (underCant(mid)) shownTop = mid;
    else heldFrom = mid;
  }
  const post = [...Array.from({ length: A_POST_STATIONS - 1 }, (_, k) => railAt((k / (A_POST_STATIONS - 2)) * shownTop)), railAt(1)];
  const sail: Rail[] = [];
  let sailWidth = 0;
  for (let k = 0; k < SAIL_STATIONS; k++) {
    const y = lerp(footY, style.aPillarKnee ?? aTopY, k / (SAIL_STATIONS - 1));
    const front = postRearmost(railAt((y - footY) / (aTopY - footY)), A_POST_THICK);
    const sailZ = Math.min(doorGlassFrontZ(y, footY, glassTop, style), front[2] - SAIL_EDGE);
    const rear: V3 = [glassX(sailZ, y, style), y, sailZ];
    sail.push({ rear, front });
    sailWidth = Math.max(sailWidth, hypot2(front[0] - rear[0], front[2] - rear[2]));
  }
  return { post, sail: sailWidth > SAIL_MIN ? sail : null };
}

/** The point of `rail`'s drawn post section (`postSection`, +x side) on its rear side furthest back: where the sail behind the post meets it. */
function postRearmost({ rear, front, inward = [1, 0] }: Rail, thick: number): V3 {
  const width = hypot2(hypot2(front[0] - rear[0], front[1] - rear[1]), front[2] - rear[2]);
  let rearmost: V3 = [rear[0], rear[1], Infinity];
  for (const p of postSection(thick, width)) {
    const depth = (1 - p.x) * thick;
    if (p.y < 1e-6 && rear[2] + depth * inward[1] < rearmost[2]) rearmost = [rear[0] - depth * inward[0], rear[1], rear[2] + depth * inward[1]];
  }
  return rearmost;
}

/** The cage roof's side lip: from the cant line `ROOF_LIP_OUT` (m) past the roof's half-width up to its knee, `ROOF_LIP_KNEE` [past the half-width, under the roof] (m), then in to the dome's edge. */
const ROOF_LIP_OUT = 0.08;
const ROOF_LIP_KNEE = [0.07, 0.03] as const;
/** A pillar's top stops this far (m) inside the roof's surface, so the two never fight over a pixel. */
const ROOF_TUCK = 0.002;

/** The drawn roof section's half-width (m) at height `y` over a station at (`roofX`, `roofY`): along its rolled side, the dome's edge over it, none under the cant line. */
function roofOutlineX(y: number, roofY: number, roofX: number, lip: number): number {
  if (y <= roofY - lip) return Infinity;
  const roll = roofRoll(roofX, roofY, lip);
  for (let k = 1; k < roll.length; k++) {
    const [a, b] = [roll[k - 1]!, roll[k]!];
    if (y <= b.y) return lerp(a.x, b.x, (y - a.y) / (b.y - a.y));
  }
  return roofX;
}

/** `x` held `ROOF_TUCK` in under the drawn roof's side at (`y`, `z`); unchanged off the roof's z span or under its cant line. */
function underRoofSide(x: number, y: number, z: number, style: BodyStyle): number {
  if (z < style.roofZ[0] || z > style.roofZ[1]) return x;
  const roof = roofAt(z, style);
  return Math.min(x, roofOutlineX(y, roof.y, roof.x, cantDrop(style)) - ROOF_TUCK);
}

/** The side glass's plane at (`y`, `z`), its lean from the belt to the cant line carried on past both, `proud` (m) out off it. */
function onGlassPlane(z: number, y: number, style: BodyStyle, proud: number): number {
  const [belt, cant] = [beltY(z, style), cantY(z, style)];
  return lerp(beltX(z, style), cantX(z, style), (y - belt) / (cant - belt)) + proud;
}

/** Holds every vertex of `geo` over the roof's z span inside the roof's section (in under its lip, under its skin), so a pillar's top runs into the roof, not through it; names it `name`. */
function insideRoof(geo: THREE.BufferGeometry, style: BodyStyle, name: string): THREE.BufferGeometry {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z < style.roofZ[0] || z > style.roofZ[1]) continue;
    const x = pos.getX(i);
    const half = underRoofSide(Math.abs(x), pos.getY(i), z, style);
    pos.setXY(i, Math.sign(x) * half, Math.min(pos.getY(i), roofTopY(half, z, style) - ROOF_TUCK));
  }
  geo.name = name;
  return geo;
}

export function makeBox(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(x, y, z);
  return geo;
}

/** The cage's header bars are this tall (m). */
const HEADER_HALF_HEIGHT = 0.03;
/** The cage's header bars are this deep (m) along z. */
const HEADER_DEPTH = 0.08;

/** The painted fill between a side glass top dropped under the cant line and the cant line is this thick (m), like a pillar. */
const GLASS_FILL_THICK = 0.05;

/** A divider the style doesn't size: 8 cm wide at the belt, 7 at the top, upright at `midPillarZ`. */
const DIVIDER: PillarSpan = { width: [0.08, 0.07] };

/** Painted fill from the side glass top up to the cant line, C-pillar to A-pillar, on the glass plane (drawn only): a style's DLO that drops under its roof. */
function glassTopFill(sign: number, style: BodyStyle, aTopZ: number): THREE.BufferGeometry[] {
  const stations = style.glassTop;
  if (stations === undefined || typeof stations === "number") return [];
  const zRear = style.quarter.zRearTop;
  const zs = [zRear, ...stations.map(([z]) => z).filter((z) => z > zRear && z < aTopZ), aTopZ];
  const rings = zs.map((z): Pt[] => {
    const low = glassTopY(z, style);
    const lowX = glassX(z, low, style);
    const [high, highX] = [cantY(z, style), cantX(z, style)];
    return [
      { x: sign * lowX, y: low },
      { x: sign * highX, y: high },
      { x: sign * (highX - GLASS_FILL_THICK), y: high },
      { x: sign * (lowX - GLASS_FILL_THICK), y: low },
    ];
  });
  const fill = loftFromRings(rings, zs, 0, 1);
  ensureOutwardNormals(fill);
  return [fill];
}

/** The drawn belt rail stands this far (m) out of the side glass's plane, flush with the pillars' outer faces at the belt, and as far in. */
export const RAIL_PROUD = 0.01;
/** The drawn belt rail's top stands this far (m) over the quarter glass's belt edge, just covering it; its foot is buried `RAIL_FOOT` under it. */
export const RAIL_LIP = 0.005;
const RAIL_FOOT = 0.025;
/** A sill column off the straight line through its neighbours by less than this (m) is no bend: the rail spends no ring there. */
const RAIL_STRAIGHT = 1e-4;
/** Both builds' belt rail goes by this name (its rows pick it by it). */
const BELT_RAIL = "beltRail";

/**
 * The drawn belt rail: the quarter glass's sill seal on the glass plane, along the pane's own belt edge (column by column) on into
 * the B-pillar, so it never stands off the sill; its depth runs square to the sill in plan where the sill turns in. Its ends are
 * buried in the C- and B-pillars.
 */
function drawnBeltRail(sign: number, style: BodyStyle): THREE.BufferGeometry {
  const sill = quarterSillZs(style);
  const columns = style.bPillar.front > sill.at(-1)! ? [...sill, style.bPillar.front] : sill;
  const zs = columns.filter((z, k) => {
    if (k === 0 || k === columns.length - 1) return true;
    const [behind, ahead] = [columns[k - 1]!, columns[k + 1]!];
    const t = (z - behind) / (ahead - behind);
    return [beltX, beltY].some((line) => Math.abs(line(z, style) - lerp(line(behind, style), line(ahead, style), t)) > RAIL_STRAIGHT);
  });
  const rails = zs.map((z, k): Rail => {
    const [outer, y] = [beltX(z, style) + RAIL_PROUD, beltY(z, style)];
    const [behind, ahead] = [zs[Math.max(k - 1, 0)]!, zs[Math.min(k + 1, zs.length - 1)]!];
    const [dx, dz] = [beltX(ahead, style) - beltX(behind, style), ahead - behind];
    const run = hypot2(dx, dz);
    return { rear: [outer, y - RAIL_FOOT, z], front: [outer, y + RAIL_LIP, z], inward: [dz / run, dx / run] };
  });
  const rail = roundedPillarAlong(sign, rails, 2 * RAIL_PROUD);
  rail.name = BELT_RAIL;
  return rail;
}

/** The sail is as deep (m) as the post it replaces; its two edges roll round at half that. */
const SAIL_DEPTH = 0.05;
/** Behind the side window's line the sail's foot sweeps out from the glass onto the haunch's shoulder over this run (m), in `SAIL_SWEEP_CHORDS`. */
export const SAIL_SWEEP = 0.15;
const SAIL_SWEEP_CHORDS = 2;
/** The sail's stations along the haunch stand at most this far apart (m): the shoulder turns under 1 cm along it, so its foot keeps to it between them. */
const SAIL_STEP = 0.35;
/** The sail's foot sits this far (m) under the shoulder it leaves, so where the two touch they never fight over a pixel. */
const SAIL_SINK = 0.002;
/** The sail's rear end stands this far (m) ahead of a deck lid's front edge. */
const SAIL_LID_SHUT = 0.004;
/** A sail section's Bézier control point lies this share of the foot-to-head run out along the foot's tangent. */
const SAIL_CONTROL = 0.5;
/** Points along a sail section's outer face (foot to head) and its inner face, and the chords each of its rounded edges spends (30° each). */
const SAIL_OUTER = 5;
const SAIL_INNER = 4;
const SAIL_EDGE_CHORDS = 6;
/** The triangle behind the quarter glass laps this far (m) over the glass's rear edge and this far under the sail's foot. */
const TIP_LAP = 0.01;
/** The triangle stands this far (m) out of the side glass's plane, over the quarter glass it laps. */
const TIP_PROUD = 0.004;

/**
 * The drawn C-pillar as a sail (`cPillar`): lofted along z through sections that each run as a quadratic Bézier from a foot to a head,
 * `SAIL_DEPTH` deep with rounded edges. The head follows the flat post's top edge (`rb` → `rt` → `ft`); the foot leaves the haunch's
 * shoulder along its tangent, then sweeps in onto the side window's line (`tip` up to the quarter glass's rear top corner), proud of the glass.
 */
function cPillarSail(sign: number, style: BodyStyle, { rb, rt, ft }: { rb: V3; rt: V3; ft: V3 }): THREE.BufferGeometry {
  const q = style.quarter;
  const [tipY, tipZ] = style.cPillar?.tip ?? [beltY(q.zRearBot, style), q.zRearBot];
  const [topY, topZ] = [glassTopY(q.zRearTop, style), q.zRearTop];
  const sweepZ = tipZ - SAIL_SWEEP;
  // Its rear end stops a shut line ahead of a deck lid's front edge: lying on over the lid, or flush with its face, the two skins would cross.
  const rear = style.boot.kind === "lid" ? Math.max(rb[2], style.boot.z0 + SAIL_LID_SHUT) : rb[2];
  const haunch = Math.max(1, Math.ceil((sweepZ - rear) / SAIL_STEP));
  const zs = [
    ...Array.from({ length: haunch }, (_, k) => lerp(rear, sweepZ, k / haunch)),
    ...Array.from({ length: SAIL_SWEEP_CHORDS + 1 }, (_, k) => lerp(sweepZ, tipZ, k / SAIL_SWEEP_CHORDS)),
    rt[2],
    topZ,
  ]
    .filter((z) => z >= rear && z <= topZ)
    .sort((a, b) => a - b)
    .filter((z, k, all) => k === 0 || z - all[k - 1]! > 1e-6);
  const r = SAIL_DEPTH / 2;
  const rings = zs.map((z): Pt[] => {
    // The head's rounded edge ends at the post's top corner (`r` over the section's end), buried in the roof's side like the post's top.
    const corner = z <= rt[2] ? [lerp(rb[0], rt[0], (z - rb[2]) / (rt[2] - rb[2])), lerp(rb[1], rt[1], (z - rb[2]) / (rt[2] - rb[2]))] : [lerp(rt[0], ft[0], (z - rt[2]) / (ft[2] - rt[2])), lerp(rt[1], ft[1], (z - rt[2]) / (ft[2] - rt[2]))];
    const head = [corner[0]!, corner[1]! - r] as const;
    // Where the window's line closes on the roof the section keeps a span of its depth, never folding to a point.
    const lineY = Math.min(z >= tipZ ? lerp(tipY, topY, (z - tipZ) / (topZ - tipZ)) : tipY, head[1]! - SAIL_DEPTH - r);
    const [upX, upY] = [cantX(z, style) - beltX(z, style), cantY(z, style) - beltY(z, style)];
    const up = [upX / hypot2(upX, upY), upY / hypot2(upX, upY)] as const;
    const shoulder = shoulderTop(z, style);
    const [tx, ty] = shoulder.tangent;
    // 0 on the window's line, 1 on the haunch: the foot's point and its tangent blend between the glass (its round edge's bottom on the line) and the shoulder.
    const f = THREE.MathUtils.smoothstep(tipZ - z, 0, SAIL_SWEEP);
    const p0 = [lerp(onGlassPlane(z, lineY, style, ROOF_DRIP) + up[0] * r, shoulder.x - SAIL_SINK * ty, f), lerp(lineY + up[1] * r, shoulder.y + SAIL_SINK * tx, f)] as const;
    const [dx, dy] = [lerp(up[0], tx, f), lerp(up[1], ty, f)];
    const reach = (SAIL_CONTROL * hypot2(head[0]! - p0[0], head[1]! - p0[1])) / hypot2(dx, dy);
    const c = [p0[0] + dx * reach, p0[1] + dy * reach] as const;
    // The section's point at `s` along its Bézier, `depth` in along its normal (+x side: the tangent turned down, into the body).
    const at = (s: number, depth: number, roll = 0): Pt => {
      const [ax, ay] = [2 * (1 - s) * (c[0] - p0[0]) + 2 * s * (head[0]! - c[0]), 2 * (1 - s) * (c[1] - p0[1]) + 2 * s * (head[1]! - c[1])];
      const run = hypot2(ax, ay);
      const [ux, uy] = [ax / run, ay / run];
      const [x, y] = [(1 - s) ** 2 * p0[0] + 2 * s * (1 - s) * c[0] + s * s * head[0]!, (1 - s) ** 2 * p0[1] + 2 * s * (1 - s) * c[1] + s * s * head[1]!];
      // A rounded edge: `roll` (0..π) turns from the outer face round past the end (forward at the head, back at the foot) to the inner face.
      const [along, inward] = [r * detSin(roll) * (s === 0 ? -1 : 1), roll === 0 ? depth : r - r * detCos(roll)];
      return { x: sign * (x + along * ux - inward * uy), y: y + along * uy + inward * ux };
    };
    const edge = (s: number) => Array.from({ length: SAIL_EDGE_CHORDS - 1 }, (_, j) => at(s, 0, (Math.PI * (j + 1)) / SAIL_EDGE_CHORDS));
    return [
      ...Array.from({ length: SAIL_OUTER }, (_, k) => at(k / (SAIL_OUTER - 1), 0)),
      ...edge(1),
      ...Array.from({ length: SAIL_INNER }, (_, k) => at(1 - k / (SAIL_INNER - 1), SAIL_DEPTH)),
      ...edge(0).reverse(),
    ];
  });
  const sail = loftFromRings(rings, zs, 0, 1);
  ensureOutwardNormals(sail);
  return sail;
}

/** The triangle behind the quarter glass goes by this name. */
const C_PILLAR_TIP = "cPillarTip";
/** The gloss-black triangle on the side glass's plane between the quarter glass's rear edge and the side window's line down to `tip` ([y, z]) (drawn only). */
function cPillarTip(sign: number, style: BodyStyle, [tipY, tipZ]: YZ): THREE.BufferGeometry {
  const q = style.quarter;
  const [topY, topZ] = [glassTopY(q.zRearTop, style), q.zRearTop];
  const front = Math.max(q.zRearBot, q.zRearTop) + TIP_LAP;
  const zs = [tipZ, ...style.belt.y.map(([z]) => z).filter((z) => z > tipZ && z < front), front];
  const rings = zs.map((z): Pt[] => {
    const [low, high] = [beltY(z, style) - RAIL_FOOT, lerp(tipY, topY, Math.min((z - tipZ) / (topZ - tipZ), 1)) + TIP_LAP];
    const [lowX, highX] = [onGlassPlane(z, low, style, TIP_PROUD), onGlassPlane(z, high, style, TIP_PROUD)];
    return [
      { x: sign * lowX, y: low },
      { x: sign * highX, y: high },
      { x: sign * (highX - GLASS_FILL_THICK), y: high },
      { x: sign * (lowX - GLASS_FILL_THICK), y: low },
    ];
  });
  const tip = loftFromRings(rings, zs, 0, 1);
  ensureOutwardNormals(tip);
  tip.userData.blackout = true;
  return insideRoof(tip, style, C_PILLAR_TIP);
}

export function makeGreenhouseFrame(style: BodyStyle, source: BodySource = "drawn"): THREE.BufferGeometry[] {
  const pillarFromCorners = source === "cage" ? boxFromCorners : roundedPillarFromCorners;
  const parts: THREE.BufferGeometry[] = [];
  const [wsY, wsZ] = style.windshieldTop;
  const ws = style.windshield;
  const beltXAt = (z: number) => beltX(z, style);
  const belt = (z: number) => beltY(z, style);
  const bp = style.bPillar;
  const rg = style.rearGlass;
  const q = style.quarter;
  const aTopZ = aPillarTopZ(style);
  const aPost = source === "drawn" ? aPostRails(style) : null;
  const bBands = bPillarBand(style, source);
  const m = style.midPillarZ;
  const divider = (source === "drawn" ? style.pillars?.divider : undefined) ?? DIVIDER;
  const black = (source === "drawn" ? style.blackout : undefined) ?? {};
  // A drawn pillar runs into the roof (never through it), named and toned by its `blackout` key; the cage keeps its boxes.
  const pillar = (geo: THREE.BufferGeometry, name: keyof NonNullable<BodyStyle["blackout"]>) => {
    if (source === "cage") return geo;
    geo.userData.blackout = black[name] === true;
    return insideRoof(geo, style, name);
  };
  // A drawn pillar's top corner sits on the side glass's plane, `proud` off it, in under the roof's side; the cage keeps `cageX`.
  const topX = (z: number, y: number, proud: number, cageX: number) => (source === "cage" ? cageX : underRoofSide(onGlassPlane(z, y, style, proud), y, z, style));
  for (const sign of [-1, 1]) {
    parts.push(
      aPost
        ? pillar(roundedPillarAlong(sign, aPost.post, A_POST_THICK, { open: true, section: (width) => postSection(A_POST_THICK, width) }), "a")
        : boxFromCorners(
            sign,
            {
              fb: [ws.wBase / 2 + 0.02, ws.base[0] + 0.01, ws.base[1] - 0.03],
              rb: [beltXAt(style.aPillarFoot), belt(style.aPillarFoot), style.aPillarFoot],
              rt: [cantX(aTopZ, style), cantY(aTopZ, style) + 0.03, aTopZ],
              ft: [ws.wTop / 2 + 0.02, wsY + 0.02, wsZ],
            },
            0.05,
            2,
          ),
    );
    const [bRear, bFront] = bBands.belt;
    const [bTopRear, bTopFront] = bBands.top;
    const bz = (bTopRear + bTopFront) * 0.5;
    const bTop = cantY(bz, style) + (source === "cage" ? 0.05 : PILLAR_TOP_RISE);
    parts.push(
      pillar(
        pillarFromCorners(
          sign,
          {
            fb: [beltXAt(bFront) + 0.01, belt(bFront) - 0.02, bFront],
            rb: [beltXAt(bRear) + 0.01, belt(bRear) - 0.02, bRear],
            rt: [topX(bTopRear, bTop, ROOF_DRIP, cantX(bz, style) + 0.01), bTop, bTopRear],
            ft: [topX(bTopFront, bTop, ROOF_DRIP, cantX(bz, style) + 0.01), bTop, bTopFront],
          },
          0.05,
        ),
        "b",
      ),
    );
    const rearPillar = {
      fb: [beltXAt(q.zRearBot), belt(q.zRearBot) - 0.02, q.zRearBot],
      rb: [rg.wBase / 2 + 0.02, rg.base[0], rg.base[1] - 0.01],
      rt: [rg.wTop / 2 + 0.02, rg.top[0] + 0.01, rg.top[1] - 0.01],
      ft: [topX(q.zRearTop, cantY(q.zRearTop, style) + PILLAR_TOP_RISE, ROOF_DRIP, cantX(q.zRearTop, style)), cantY(q.zRearTop, style) + PILLAR_TOP_RISE, q.zRearTop],
    } as const;
    const sail = source === "drawn" ? style.cPillar : undefined;
    parts.push(pillar(source === "cage" ? boxFromCorners(sign, rearPillar, 0.05) : sail ? cPillarSail(sign, style, rearPillar) : roundedPillarFromCorners(sign, rearPillar, 0.05, true), "rear"));
    if (sail?.tip) parts.push(cPillarTip(sign, style, sail.tip));
    if (m !== null) {
      const topZ = divider.z?.[1] ?? m;
      const { belt: [dRear, dFront], top: [dTopRear, dTopFront] } = pillarBands(divider, m);
      const mTop = cantY(topZ, style) + PILLAR_TOP_RISE;
      parts.push(
        pillar(
          pillarFromCorners(
            sign,
            {
              fb: [beltXAt(dFront) + 0.012, belt(dFront) - 0.02, dFront],
              rb: [beltXAt(dRear) + 0.012, belt(dRear) - 0.02, dRear],
              rt: [topX(dTopRear, mTop, 0.012, cantX(topZ, style) + 0.012), mTop, dTopRear],
              ft: [topX(dTopFront, mTop, 0.012, cantX(topZ, style) + 0.012), mTop, dTopFront],
            },
            0.04,
          ),
          "divider",
        ),
      );
    }
    if (aPost?.sail) parts.push(pillar(roundedPillarAlong(sign, aPost.sail, SAIL_THICK), "sail"));
    // The belt rail runs from the C-pillar to the B-pillar along the sill: the cage's box pitched straight between its ends, the drawn seal along the quarter glass's sill.
    if (source === "drawn") {
      parts.push(drawnBeltRail(sign, style), ...glassTopFill(sign, style, aTopZ));
      continue;
    }
    const [railRear, railFront] = [belt(q.zRearBot), belt(bp.front)];
    const [railRearX, railFrontX] = [beltXAt(q.zRearBot), beltXAt(bp.front)];
    const railRun = bp.front - q.zRearBot;
    const railPlan = railFrontX === railRearX ? railRun : hypot2(railRun, railFrontX - railRearX);
    const rail = makeBox(0.03, 0.03, hypot2(railPlan, railFront - railRear), 0, 0, 0).rotateX(-detAtan2(railFront - railRear, railPlan));
    if (railFrontX !== railRearX) rail.rotateY(sign * detAtan2(railFrontX - railRearX, railRun));
    parts.push(rail.translate(sign * ((railRearX + railFrontX) / 2 + 0.015), (railRear + railFront) / 2 + 0.005, q.zRearBot + railRun * 0.5));
    rail.name = BELT_RAIL;
  }
  // The cage keeps its header boxes until the rig derives the cabin cage; the drawn roof covers both glass tops, so it draws none.
  if (source === "cage") {
    parts.push(makeBox(ws.wTop + 0.1, 2 * HEADER_HALF_HEIGHT, HEADER_DEPTH, 0, wsY + 0.03, wsZ - 0.02));
    parts.push(makeBox(rg.wTop + 0.12, 2 * HEADER_HALF_HEIGHT, HEADER_DEPTH, 0, rg.top[0] + 0.04, rg.top[1] - 0.02));
  }
  return parts;
}
