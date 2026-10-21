import * as THREE from "three";
import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import type { BodyStyle, PillarSpan } from "./car-variants.ts";
import { aPillarTopZ, aPostRearZ, beltX, beltY, cantDrop, doorGlassFrontZ, pillarBands } from "./car-lines.ts";
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

/** The drawn roof's side (+x), cant line up to the dome's edge at (`x`, `y`): a quarter ellipse `ROOF_LIP_OUT + ROOF_DRIP` out and `lip` down. */
function roofRoll(x: number, y: number, lip: number): Pt[] {
  return ROOF_ROLL.map((a) => ({ x: x + (ROOF_LIP_OUT + ROOF_DRIP) * detCos(a), y: y - lip * (1 - detSin(a)) }));
}

/** The roof panel. The cage keeps its knee-lip section; the drawn roof's side rolls into the dome with no shelf. */
export function makeRoofGeometry(style: BodyStyle, source: BodySource = "drawn"): THREE.BufferGeometry {
  const [z0, z1] = style.roofZ;
  const lip = cantDrop(style);
  const segs = 16;
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
    rings.push([
      ...side.map((p) => ({ x: -p.x, y: p.y })),
      { x: -x, y },
      { x: -x * ROOF_SHOULDER[0], y: y + ROOF_SHOULDER[1] },
      { x: 0, y: y + ROOF_CROWN },
      { x: x * ROOF_SHOULDER[0], y: y + ROOF_SHOULDER[1] },
      { x, y },
      ...[...side].reverse(),
      { x: 0, y: y - 0.085 },
    ]);
    zs.push(z);
  }
  const geo = loftFromRings(rings, zs, 0.28, 0.72);
  ensureOutwardNormals(geo);
  return source === "cage" ? geo : splitCreases(geo, ROOF_CREASE_DEGREES);
}

/**
 * Each lengthwise edge of a greenhouse pillar, rail or header is cut by one 45° chamfer (`PILLAR_FILLET_STEPS` = 1 chord of a
 * quarter circle of radius `PILLAR_FILLET`, m; at most `PILLAR_FILLET_SHARE` of the section side it cuts), so the section is an
 * octagon and the vertex normals roll round the edge in two 45° steps instead of turning 90° at once. A chamfer's middle sits
 * r / √2 = 4.95 mm inside the sharp corner it replaces: within the 5 mm silhouette allowance; the section never grows past the box.
 */
const PILLAR_FILLET = 0.007;
const PILLAR_FILLET_SHARE = 0.3;
const PILLAR_FILLET_STEPS = 1;
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

/** A crowned pillar's outer face bulges this far (m) at its middle over its edges, through points at these shares of its width: it reads curved, not a flat box. */
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
    // The outer face runs from this corner's last point to the next one's first.
    if (crownU > 0 && corner.x === 1 && corner.y === 0) for (const w of CROWN_POINTS) section.push({ x: 1, y: w });
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

/** A pillar section's outer-face rear and front points at one station along it (+x side). */
type Rail = { rear: V3; front: V3 };

/**
 * Pillar lofted through `rails` (belt to top), thickness inward, its corners rounded at `radius` (m) in `steps` chords, its outer
 * face bulged `crown` (m); sign -1 mirrors to the left without flipping the winding. `ownCaps`: its end caps get their own rings
 * (`loftFromRings`); a pillar whose ends are buried in the body and the roof shares them.
 */
function roundedPillarAlong(
  sign: number,
  rails: readonly Rail[],
  thick: number,
  { radius = PILLAR_FILLET, steps = PILLAR_FILLET_STEPS, ownCaps = true, crown = 0 } = {},
): THREE.BufferGeometry {
  const last = rails.length - 1;
  const stations = rails.map((_, k) => k / last);
  const sections = rails.map((r) => filletedUnitSection(filletShare(thick, radius), filletShare(Math.abs(r.front[2] - r.rear[2]), radius), steps, crown / thick));
  const geo = loftFromRings(sections, stations, 0, 1, ownCaps);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i);
    const w = pos.getY(i);
    const { rear, front } = rails[Math.round(pos.getZ(i) * last)]!;
    const outer = lerp(rear[0], front[0], w);
    const x = sign > 0 ? outer - (1 - u) * thick : -(outer - u * thick);
    pos.setXYZ(i, x, lerp(rear[1], front[1], w), lerp(rear[2], front[2], w));
  }
  ensureOutwardNormals(geo);
  return geo;
}

/** Crowned pillar mapped onto four outer-face corners (+x side), thickness inward; sign -1 mirrors to the left without flipping the winding. */
function roundedPillarFromCorners(
  sign: number,
  c: { fb: V3; rb: V3; rt: V3; ft: V3 },
  thick: number,
  hs = 1,
): THREE.BufferGeometry {
  const rails = Array.from({ length: hs + 1 }, (_, k): Rail => {
    const v = k / hs;
    return {
      rear: [lerp(c.rb[0], c.rt[0], v), lerp(c.rb[1], c.rt[1], v), lerp(c.rb[2], c.rt[2], v)],
      front: [lerp(c.fb[0], c.ft[0], v), lerp(c.fb[1], c.ft[1], v), lerp(c.fb[2], c.ft[2], v)],
    };
  });
  return roundedPillarAlong(sign, rails, thick, { ownCaps: false, crown: PILLAR_CROWN });
}

/** The drawn A-post's depth inward (m): a slim post, not a slab. */
const A_POST_THICK = 0.03;
/** Stations along the drawn A-post, base to top: enough for the roof to bend its top (each costs the skin a ring a frame). */
const A_POST_STATIONS = 3;
/** The drawn A-post stands this far (m) off the windshield's edge and the side glass, outward, so neither glass shows through it. */
const A_POST_LIFT = 0.004;
/** A drawn pillar's top runs this far (m) up past the cant line, buried in the roof's side. */
const PILLAR_TOP_RISE = 0.03;
/** The drawn A-post's corners are cut at this radius (m), one chord each (the body's smooth normals round them; each chord more costs the skin 4 vertices a station). */
const A_POST_ROUND = 0.012;
/** The sail (the panel between the A-post and the door glass) is this thick (m), on the side glass plane. */
const SAIL_THICK = 0.02;
/** A sail narrower than this (m) at every station is not drawn. */
const SAIL_MIN = 0.005;
/** Where the door glass runs under the post the sail thins to this (m), never to nothing, so its faces keep their normals. */
const SAIL_EDGE = 0.001;

/**
 * The drawn A-post's rails and its sail's, base to top. The post runs along the windshield's edge, `aPostRearZ` behind it in side
 * view; the door glass's front edge (`doorGlassFrontZ`) under it is covered, and where that edge lies further back the sail fills the
 * gap at the same height up to the glass's knee (or the post's top), so no style's glass layout leaves a hole or a sliver.
 */
function aPostRails(style: BodyStyle): { post: Rail[]; sail: Rail[] | null } {
  const { base, wBase, wTop } = style.windshield;
  const [topY, topZ] = style.windshieldTop;
  const run = hypot2(topZ - base[1], topY - base[0]);
  const [uz, uy] = [(topZ - base[1]) / run, (topY - base[0]) / run];
  const [footZ, aTopZ] = [style.aPillarFoot, aPillarTopZ(style)];
  const [footY, aTopY] = [beltY(footZ, style), cantY(aTopZ, style) + PILLAR_TOP_RISE];
  const post: Rail[] = [];
  for (let k = 0; k < A_POST_STATIONS; k++) {
    const t = k / (A_POST_STATIONS - 1);
    const y = lerp(footY, aTopY, t);
    const postZ = aPostRearZ(y, style);
    const rear: V3 = [underRoofSide(glassX(postZ, y, style) + A_POST_LIFT, y, postZ, style), y, postZ];
    const [frontY, frontZ] = [lerp(base[0], topY, t) - A_POST_LIFT * uz, lerp(base[1], topZ, t) + A_POST_LIFT * uy];
    const front: V3 = [underRoofSide(lerp(wBase, wTop, t) / 2 + A_POST_LIFT, frontY, frontZ, style), frontY, frontZ];
    post.push({ rear, front });
  }
  const glassTop = glassTopY(aTopZ, style);
  const sail: Rail[] = [];
  let sailWidth = 0;
  for (let k = 0; k < A_POST_STATIONS; k++) {
    const y = lerp(footY, style.aPillarKnee ?? aTopY, k / (A_POST_STATIONS - 1));
    const [postZ, glassZ] = [aPostRearZ(y, style), doorGlassFrontZ(y, footY, glassTop, style)];
    const sailZ = Math.min(glassZ, postZ - SAIL_EDGE);
    sail.push({ rear: [glassX(sailZ, y, style), y, sailZ], front: [glassX(postZ, y, style), y, postZ] });
    sailWidth = Math.max(sailWidth, postZ - glassZ);
  }
  return { post, sail: sailWidth > SAIL_MIN ? sail : null };
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

/** A filleted bar along z: `sectionX` x `sectionY` section, `length` long, centred on the origin. */
function makeRoundedBar(sectionX: number, sectionY: number, length: number): THREE.BufferGeometry {
  const section = filletedUnitSection(filletShare(sectionX), filletShare(sectionY)).map((p) => ({ x: (p.x - 0.5) * sectionX, y: (p.y - 0.5) * sectionY }));
  const geo = loftFromRings([section, section], [-length / 2, length / 2], 0, 1);
  ensureOutwardNormals(geo);
  return geo;
}

export function makeBox(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(x, y, z);
  return geo;
}

/** A `width` x `height` x `depth` bar centred on (`x`, `y`, `z`): the cage's plain box, the drawn body's chamfered bar along its longer side (x or z). */
function makeBar(source: BodySource, width: number, height: number, depth: number, x: number, y: number, z: number): THREE.BufferGeometry {
  if (source === "cage") return makeBox(width, height, depth, x, y, z);
  const alongX = width > depth;
  const bar = makeRoundedBar(alongX ? depth : width, height, alongX ? width : depth);
  return (alongX ? bar.rotateY(Math.PI / 2) : bar).translate(x, y, z);
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
  // The drawn B-pillar takes the style's bands; else the `bPillar` band, its top 3 cm narrower.
  const bSpan = source === "drawn" ? style.pillars?.b : undefined;
  const bBands = bSpan ? pillarBands(bSpan, (bp.rear + bp.front) / 2) : { belt: [bp.rear, bp.front] as const, top: [bp.rear + 0.015, bp.front - 0.015] as const };
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
        ? pillar(roundedPillarAlong(sign, aPost.post, A_POST_THICK, { radius: A_POST_ROUND, ownCaps: false, crown: PILLAR_CROWN }), "a")
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
    const bz = bSpan?.z?.[1] ?? (bp.rear + bp.front) * 0.5;
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
    parts.push(
      pillar(
        pillarFromCorners(
          sign,
          {
            fb: [beltXAt(q.zRearBot), belt(q.zRearBot) - 0.02, q.zRearBot],
            rb: [rg.wBase / 2 + 0.02, rg.base[0], rg.base[1] - 0.01],
            rt: [rg.wTop / 2 + 0.02, rg.top[0] + 0.01, rg.top[1] - 0.01],
            ft: [topX(q.zRearTop, cantY(q.zRearTop, style) + PILLAR_TOP_RISE, ROOF_DRIP, cantX(q.zRearTop, style)), cantY(q.zRearTop, style) + PILLAR_TOP_RISE, q.zRearTop],
          },
          0.05,
        ),
        "rear",
      ),
    );
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
    if (aPost?.sail) parts.push(pillar(roundedPillarAlong(sign, aPost.sail, SAIL_THICK, { ownCaps: false }), "sail"));
    // The belt rail runs from the C-pillar to the B-pillar along the sill, pitched with it and turned in plan where the sill narrows.
    const [railRear, railFront] = [belt(q.zRearBot), belt(bp.front)];
    const [railRearX, railFrontX] = [beltXAt(q.zRearBot), beltXAt(bp.front)];
    const railRun = bp.front - q.zRearBot;
    const railPlan = railFrontX === railRearX ? railRun : hypot2(railRun, railFrontX - railRearX);
    const rail = makeBar(source, 0.03, 0.03, hypot2(railPlan, railFront - railRear), 0, 0, 0).rotateX(-detAtan2(railFront - railRear, railPlan));
    if (railFrontX !== railRearX) rail.rotateY(sign * detAtan2(railFrontX - railRearX, railRun));
    parts.push(rail.translate(sign * ((railRearX + railFrontX) / 2 + 0.015), (railRear + railFront) / 2 + 0.005, q.zRearBot + railRun * 0.5));
    rail.name = "beltRail";
    if (source === "drawn") parts.push(...glassTopFill(sign, style, aTopZ));
  }
  // The cage keeps its header boxes until the rig derives the cabin cage; the drawn roof covers both glass tops, so it draws none.
  if (source === "cage") {
    parts.push(makeBox(ws.wTop + 0.1, 2 * HEADER_HALF_HEIGHT, HEADER_DEPTH, 0, wsY + 0.03, wsZ - 0.02));
    parts.push(makeBox(rg.wTop + 0.12, 2 * HEADER_HALF_HEIGHT, HEADER_DEPTH, 0, rg.top[0] + 0.04, rg.top[1] - 0.02));
  }
  return parts;
}
