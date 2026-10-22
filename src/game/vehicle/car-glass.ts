import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PART_FAMILY } from "../kernel/physics-core.js";
import type { GlassName } from "./car-core.ts";
import { CAR_STYLES, type BodyStyle, type GlassQuad, type YZ } from "./car-variants.ts";
import { glassTopY, glassX, lerp } from "./car-mesh.ts";
import { aPillarTopZ, bPillarBand, beltY, doorGlassFrontZ } from "./car-lines.ts";

// Glass panes on the shared platform: windshield, rear glass, door and quarter glass, filling the greenhouse `car-greenhouse-mesh.ts` builds.

/** The panes in the order a car adds them (`addGlass`): the order of its glass state's 2-bit fields (`glassBits`). */
export const GLASS_NAMES: readonly GlassName[] = ["windshield", "rear", "doorL", "doorR", "quarterL", "quarterR"];

const SEDAN = CAR_STYLES.sedan;
/** The door glass pane's origin in door space (right door; the left mirrors x): the pane is parented to its door there. */
export const DOOR_GLASS_SEAT = { x: -0.02, y: 0.52, z: -0.28 } as const;

const _pt = new THREE.Vector3();

/** Point of raked quad `q` in car space: `xn` −1…1 across, `t` 0…1 base to top, bowed by `bow` along z at the centre line. */
function quadPoint(q: GlassQuad, xn: number, t: number, bow: number): THREE.Vector3 {
  const w = lerp(q.wBase, q.wTop, t);
  return _pt.set(xn * w * 0.5, lerp(q.base[0], q.top[0], t), lerp(q.base[1], q.top[1], t) + bow * (1 - xn * xn));
}

/** Raked glass quad (windshield / rear glass), bowed by `bow` along z at the centre line. */
function makeGlassQuad(q: GlassQuad, segX: number, segY: number, bow: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= segY; j++) {
    const t = j / segY;
    for (let i = 0; i <= segX; i++) {
      const p = quadPoint(q, (i / segX) * 2 - 1, t, bow);
      positions.push(p.x, p.y, p.z);
      uvs.push(i / segX, t);
    }
  }
  const row = segX + 1;
  for (let j = 0; j < segY; j++) {
    for (let i = 0; i < segX; i++) {
      const a = j * row + i;
      indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** The windshield's quad on `style`: its base and widths, its top edge. */
function windshieldQuad(style: BodyStyle): GlassQuad {
  const { base, wBase, wTop } = style.windshield;
  return { base, top: style.windshieldTop, wBase, wTop };
}

export function makeWindshield(style: BodyStyle = SEDAN): THREE.BufferGeometry {
  return makeGlassQuad(windshieldQuad(style), 10, 8, 0.02);
}

/** Glass quad `q` drawn in by its `frame` ([side, bottom, top], m: sides across, bottom and top along its slope). */
function framedQuad(q: GlassQuad, [side, bottom, top]: readonly [number, number, number]): GlassQuad {
  const len = Math.hypot(q.top[0] - q.base[0], q.top[1] - q.base[1]);
  const at = (t: number): YZ => [lerp(q.base[0], q.top[0], t), lerp(q.base[1], q.top[1], t)];
  const [t0, t1] = [bottom / len, 1 - top / len];
  return { base: at(t0), top: at(t1), wBase: lerp(q.wBase, q.wTop, t0) - 2 * side, wTop: lerp(q.wBase, q.wTop, t1) - 2 * side };
}

/** A black frit band: rows of points (each row the same length) as a strip grid wound like `makeGlassQuad`'s, every vertex coloured black. */
function fritBand(rows: readonly THREE.Vector3[][]): THREE.BufferGeometry {
  const n = rows[0]!.length;
  const geo = new THREE.BufferGeometry().setFromPoints(rows.flat());
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(rows.flatMap((row, j) => row.flatMap((_, i) => [i / (n - 1), j / (rows.length - 1)])), 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(rows.length * n * 3), 3));
  const indices: number[] = [];
  for (let j = 0; j < rows.length - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      indices.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
    }
  }
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Chords along a frit's top and bottom edges: the 1.5 cm bow sags 1 mm off a quarter-width chord, under the band's own width. */
const FRIT_CHORDS = 4;

/** A framed rear glass: its pane drawn in by the `frame`, the band out to the outline its black frit, both bowed alike (vertex colour: the pane's material tints it). */
function framedGlass(q: GlassQuad, frame: readonly [number, number, number], segX: number, segY: number, bow: number): THREE.BufferGeometry {
  const inner = framedQuad(q, frame);
  const pane = makeGlassQuad(inner, segX, segY, bow);
  pane.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(pane.getAttribute("position").count * 3).fill(1), 3));
  const along = (g: GlassQuad, t: number) => Array.from({ length: FRIT_CHORDS + 1 }, (_, i) => quadPoint(g, (i / FRIT_CHORDS) * 2 - 1, t, bow).clone());
  // The sides take no bow (it is zero at the pane's edges): one chord each.
  const side = (xn: number) => [0, 1].map((t) => [quadPoint(q, xn, t, bow).clone(), quadPoint(inner, xn, t, bow).clone()]);
  const bands = [
    fritBand([along(q, 0), along(inner, 0)]),
    fritBand([along(inner, 1), along(q, 1)]),
    fritBand(side(1).map(([outer, clear]) => [clear!, outer!])),
    fritBand(side(-1)),
  ];
  const geo = mergeGeometries([pane, ...bands], false);
  if (!geo) throw new Error("Failed to merge the framed rear glass");
  return geo;
}

export function makeRearGlass(style: BodyStyle = SEDAN): THREE.BufferGeometry {
  const { frame } = style.rearGlass;
  return frame ? framedGlass(style.rearGlass, frame, 8, 6, -0.015) : makeGlassQuad(style.rearGlass, 8, 6, -0.015);
}

/** A side pane's edge z at the belt (`bot`) and at the top, rear → front; a kneed front edge (`front`, z at a height share) gets a row at its knee (`kneeT`). */
type SideSpan = { bot: readonly [number, number]; top: readonly [number, number]; front?: (t: number) => number; kneeT?: number };

/** The side panes run this far (m) in under the B-pillar's edges. */
const PANE_TUCK = 0.01;

/** Door glass: from in under the drawn B-pillar's front edge (`bPillarBand`) at the belt and the top up to the A-pillar, from its foot on the belt to its top on the cant line, kneed onto the A-post at `aPillarKnee`. */
function doorSpan(style: BodyStyle): SideSpan {
  const band = bPillarBand(style);
  const span: SideSpan = { bot: [band.belt[1] - PANE_TUCK, style.aPillarFoot], top: [band.top[1] - PANE_TUCK, aPillarTopZ(style)] };
  const knee = style.aPillarKnee;
  if (knee === undefined) return span;
  const [footY, topY] = [beltY(style.aPillarFoot, style), glassTopY(aPillarTopZ(style), style)];
  return { ...span, front: (t) => doorGlassFrontZ(lerp(footY, topY, t), footY, topY, style), kneeT: (knee - footY) / (topY - footY) };
}

/** Quarter glass: from the C-pillar forward to in under the drawn B-pillar's rear edge. */
function quarterSpan(style: BodyStyle): SideSpan {
  const band = bPillarBand(style);
  return { bot: [style.quarter.zRearBot, band.belt[0] + PANE_TUCK], top: [style.quarter.zRearTop, band.top[0] + PANE_TUCK] };
}

/** A side pane is this many columns long, rear to front: its belt edge is a polyline through the belt at their z. */
const SIDE_PANE_COLUMNS = 6;

/** The quarter glass's belt edge, rear to front: the z of each of its columns (its sill is `beltY` there, straight between). */
export function quarterSillZs(style: BodyStyle): number[] {
  const [rear, front] = quarterSpan(style).bot;
  return Array.from({ length: SIDE_PANE_COLUMNS + 1 }, (_, i) => lerp(rear, front, i / SIDE_PANE_COLUMNS));
}

/** Point of a side pane in car space: `s` 0…1 rear to front, `t` 0…1 belt to top, leaning in with the tumblehome. */
function sidePoint(sign: number, style: BodyStyle, span: SideSpan, s: number, t: number): THREE.Vector3 {
  const zt = lerp(span.top[0], span.top[1], s);
  const zb = lerp(span.bot[0], span.bot[1], s);
  const z = span.front ? lerp(lerp(span.bot[0], span.top[0], t), span.front(t), s) : lerp(zb, zt, t);
  const y = lerp(beltY(zb, style), glassTopY(zt, style), t);
  return _pt.set(sign * glassX(z, y, style), y, z);
}

/** Side glass from the belt to the roof cant (`sidePoint`). Positions are relative to `origin`. */
function makeSideGlassPane(sign: number, style: BodyStyle, span: SideSpan, origin: readonly [number, number, number]): THREE.BufferGeometry {
  const segS = SIDE_PANE_COLUMNS;
  // Belt to top in thirds, and the front edge's knee.
  const ts = [0, 1 / 3, 2 / 3, 1];
  if (span.kneeT !== undefined && span.kneeT > 0 && span.kneeT < 1 && !ts.includes(span.kneeT)) ts.splice(ts.findIndex((t) => t > span.kneeT!), 0, span.kneeT);
  const segT = ts.length - 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const t of ts) {
    for (let i = 0; i <= segS; i++) {
      const s = i / segS;
      const p = sidePoint(sign, style, span, s, t);
      positions.push(p.x - origin[0], p.y - origin[1], p.z - origin[2]);
      uvs.push(s, t);
    }
  }
  const row = segS + 1;
  for (let j = 0; j < segT; j++) {
    for (let i = 0; i < segS; i++) {
      const a = j * row + i;
      // Face outward (+x on the right) so the pane front-faces a viewer outside.
      if (sign > 0) indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
      else indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Door glass in pane-local space: car.ts parents it to the door at `DOOR_GLASS_SEAT` (x mirrored on the left). */
export function makeSideGlass(sign: number, style: BodyStyle = SEDAN): THREE.BufferGeometry {
  const d = style.door;
  const o = DOOR_GLASS_SEAT;
  return makeSideGlassPane(sign, style, doorSpan(style), [sign * (d.hingeX + o.x), d.hingeY + o.y, d.hingeZ + o.z]);
}

/** Quarter glass from the B-pillar back to the C-pillar, on the body (car local). */
export function makeRearSideGlass(sign: number, style: BodyStyle = SEDAN): THREE.BufferGeometry {
  return makeSideGlassPane(sign, style, quarterSpan(style), [0, 0, 0]);
}

/**
 * Every pane's four corners on `style` in car space, at rest and before a class lift, in `GLASS_NAMES` order: for each,
 * (across 0, base), (across 1, base), (across 0, top), (across 1, top), xyz each (across: left to right on the windshield
 * and rear glass, rear to front on a side pane). The thrown dummies' world fits a slab to each (`RagdollSystem`).
 */
export function glassCorners(style: BodyStyle): Float32Array {
  const out = new Float32Array(GLASS_NAMES.length * 12);
  const quads = [windshieldQuad(style), style.rearGlass];
  for (let p = 0; p < GLASS_NAMES.length; p++) {
    const name = GLASS_NAMES[p]!;
    const sign = name.endsWith("L") ? -1 : 1;
    for (let k = 0; k < 4; k++) {
      const across = k & 1;
      const t = k >> 1;
      const v = p < 2 ? quadPoint(quads[p]!, across * 2 - 1, t, 0) : sidePoint(sign, style, name.startsWith(PART_FAMILY.door) ? doorSpan(style) : quarterSpan(style), across, t);
      v.toArray(out, p * 12 + k * 3);
    }
  }
  return out;
}
