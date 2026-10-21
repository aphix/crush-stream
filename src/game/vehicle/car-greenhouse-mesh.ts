import * as THREE from "three";
import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import type { BodyStyle } from "./car-variants.ts";
import { aPillarTopZ, beltX, beltY, cantDrop } from "./car-lines.ts";
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

export function makeRoofGeometry(style: BodyStyle): THREE.BufferGeometry {
  const [z0, z1] = style.roofZ;
  const lip = cantDrop(style);
  const segs = 16;
  const rings: Pt[][] = [];
  const zs: number[] = [];
  for (let s = 0; s <= segs; s++) {
    const z = lerp(z0, z1, s / segs);
    const { y, x } = roofAt(z, style);
    rings.push([
      { x: -(x + 0.08), y: y - lip },
      { x: -(x + 0.07), y: y - 0.03 },
      { x: -x, y },
      { x: -x * ROOF_SHOULDER[0], y: y + ROOF_SHOULDER[1] },
      { x: 0, y: y + ROOF_CROWN },
      { x: x * ROOF_SHOULDER[0], y: y + ROOF_SHOULDER[1] },
      { x, y },
      { x: x + 0.07, y: y - 0.03 },
      { x: x + 0.08, y: y - lip },
      { x: 0, y: y - 0.085 },
    ]);
    zs.push(z);
  }
  const geo = loftFromRings(rings, zs, 0.28, 0.72);
  ensureOutwardNormals(geo);
  return geo;
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

/** The fraction of a section side (m) that its fillet takes off each end. */
function filletShare(side: number): number {
  return Math.min(PILLAR_FILLET, PILLAR_FILLET_SHARE * side) / side;
}

/** A rectangle's outline in the unit square with elliptical-arc corners of radii `radiusU` x `radiusW` (unit fractions along each axis). */
function filletedUnitSection(radiusU: number, radiusW: number): Pt[] {
  const section: Pt[] = [];
  for (const corner of FILLET_CORNERS) {
    const centreU = corner.x === 1 ? 1 - radiusU : radiusU;
    const centreW = corner.y === 1 ? 1 - radiusW : radiusW;
    for (let step = 0; step <= PILLAR_FILLET_STEPS; step++) {
      const angle = corner.startAngle + (step / PILLAR_FILLET_STEPS) * (Math.PI / 2);
      section.push({ x: centreU + radiusU * detCos(angle), y: centreW + radiusW * detSin(angle) });
    }
  }
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

/**
 * Chamfered pillar mapped onto four outer-face corners (+x side), thickness inward;
 * sign -1 mirrors to the left without flipping the winding.
 */
function roundedPillarFromCorners(
  sign: number,
  c: { fb: V3; rb: V3; rt: V3; ft: V3 },
  thick: number,
  hs = 1,
): THREE.BufferGeometry {
  const stations = Array.from({ length: hs + 1 }, (_, k) => k / hs);
  const at = (k: number, v: number, w: number) => lerp(lerp(c.rb[k]!, c.fb[k]!, w), lerp(c.rt[k]!, c.ft[k]!, w), v);
  const sections = stations.map((v) => filletedUnitSection(filletShare(thick), filletShare(Math.abs(at(2, v, 1) - at(2, v, 0)))));
  const geo = loftFromRings(sections, stations, 0, 1);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i);
    const w = pos.getY(i);
    const v = pos.getZ(i);
    const outer = at(0, v, w);
    const x = sign > 0 ? outer - (1 - u) * thick : -(outer - u * thick);
    pos.setXYZ(i, x, at(1, v, w), at(2, v, w));
  }
  ensureOutwardNormals(geo);
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

/** Header bars are this tall (m); the drawn bar's top never stands above the roof skin over its ends. */
const HEADER_HALF_HEIGHT = 0.03;

/** The painted fill between a side glass top dropped under the cant line and the cant line is this thick (m), like a pillar. */
const GLASS_FILL_THICK = 0.05;

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
  for (const sign of [-1, 1]) {
    parts.push(
      pillarFromCorners(
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
    const bz = (bp.rear + bp.front) * 0.5;
    const bTop = cantY(bz, style) + 0.05;
    const bX = cantX(bz, style) + 0.01;
    parts.push(
      pillarFromCorners(
        sign,
        {
          fb: [beltXAt(bp.front) + 0.01, belt(bp.front) - 0.02, bp.front],
          rb: [beltXAt(bp.rear) + 0.01, belt(bp.rear) - 0.02, bp.rear],
          rt: [bX, bTop, bp.rear + 0.015],
          ft: [bX, bTop, bp.front - 0.015],
        },
        0.05,
      ),
    );
    parts.push(
      pillarFromCorners(
        sign,
        {
          fb: [beltXAt(q.zRearBot), belt(q.zRearBot) - 0.02, q.zRearBot],
          rb: [rg.wBase / 2 + 0.02, rg.base[0], rg.base[1] - 0.01],
          rt: [rg.wTop / 2 + 0.02, rg.top[0] + 0.01, rg.top[1] - 0.01],
          ft: [cantX(q.zRearTop, style), cantY(q.zRearTop, style) + 0.03, q.zRearTop],
        },
        0.05,
      ),
    );
    const m = style.midPillarZ;
    if (m !== null) {
      const mTop = cantY(m, style) + 0.03;
      const mX = cantX(m, style) + 0.012;
      parts.push(
        pillarFromCorners(
          sign,
          {
            fb: [beltXAt(m + 0.04) + 0.012, belt(m + 0.04) - 0.02, m + 0.04],
            rb: [beltXAt(m - 0.04) + 0.012, belt(m - 0.04) - 0.02, m - 0.04],
            rt: [mX, mTop, m - 0.035],
            ft: [mX, mTop, m + 0.035],
          },
          0.04,
        ),
      );
    }
    // The belt rail runs from the C-pillar to the B-pillar along the sill, pitched with it and turned in plan where the sill narrows.
    const [railRear, railFront] = [belt(q.zRearBot), belt(bp.front)];
    const [railRearX, railFrontX] = [beltXAt(q.zRearBot), beltXAt(bp.front)];
    const railRun = bp.front - q.zRearBot;
    const railPlan = railFrontX === railRearX ? railRun : hypot2(railRun, railFrontX - railRearX);
    const rail = makeBar(source, 0.03, 0.03, hypot2(railPlan, railFront - railRear), 0, 0, 0).rotateX(-detAtan2(railFront - railRear, railPlan));
    if (railFrontX !== railRearX) rail.rotateY(sign * detAtan2(railFrontX - railRearX, railRun));
    parts.push(rail.translate(sign * ((railRearX + railFrontX) / 2 + 0.015), (railRear + railFront) / 2 + 0.005, q.zRearBot + railRun * 0.5));
    if (source === "drawn") parts.push(...glassTopFill(sign, style, aTopZ));
  }
  // The cage keeps its box until the rig derives the cabin cage.
  const headerY = (centre: number, z: number, width: number) => (source === "cage" ? centre : Math.min(centre, roofTopY(width / 2, z, style) - HEADER_HALF_HEIGHT));
  parts.push(makeBar(source, ws.wTop + 0.1, 2 * HEADER_HALF_HEIGHT, 0.08, 0, headerY(wsY + 0.03, wsZ - 0.02, ws.wTop + 0.1), wsZ - 0.02));
  parts.push(makeBar(source, rg.wTop + 0.12, 2 * HEADER_HALF_HEIGHT, 0.08, 0, headerY(rg.top[0] + 0.04, rg.top[1] - 0.02, rg.wTop + 0.12), rg.top[1] - 0.02));
  return parts;
}
