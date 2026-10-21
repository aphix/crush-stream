import * as THREE from "three";
import { PART_FAMILY } from "../kernel/physics-core.js";
import type { GlassName } from "./car-core.ts";
import { CAR_STYLES, type BodyStyle, type GlassQuad } from "./car-variants.ts";
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

export function makeRearGlass(style: BodyStyle = SEDAN): THREE.BufferGeometry {
  return makeGlassQuad(style.rearGlass, 8, 6, -0.015);
}

/** A side pane's edge z at the belt (`bot`) and at the top, rear → front; a kneed front edge (`front`, z at a height share) gets a row at its knee (`kneeT`). */
type SideSpan = { bot: readonly [number, number]; top: readonly [number, number]; front?: (t: number) => number; kneeT?: number };

/** The door glass rides its door, so its rear edge stays this far (m) inside the door's trailing edge at the belt and at the top. */
const DOOR_GLASS_INSET = { bot: 0.03, top: 0.05 } as const;
/** Under a B-pillar whose width the style sets, the side panes run this far (m) in under its edges. */
const PANE_TUCK = 0.01;

/** Door glass: from inside the door's trailing edge (or under the drawn B-pillar) at the belt up to the A-pillar, from its foot on the belt to its top on the cant line, kneed onto the A-post at `aPillarKnee`. */
function doorSpan(style: BodyStyle): SideSpan {
  const band = bPillarBand(style);
  const trailing = style.door.hingeZ - style.door.length;
  const [bot, top] = band ? [band[1] - PANE_TUCK, band[1] - PANE_TUCK] : [trailing + DOOR_GLASS_INSET.bot, trailing + DOOR_GLASS_INSET.top];
  const span: SideSpan = { bot: [bot, style.aPillarFoot], top: [top, aPillarTopZ(style)] };
  const knee = style.aPillarKnee;
  if (knee === undefined) return span;
  const [footY, topY] = [beltY(style.aPillarFoot, style), glassTopY(aPillarTopZ(style), style)];
  return { ...span, front: (t) => doorGlassFrontZ(lerp(footY, topY, t), footY, topY, style), kneeT: (knee - footY) / (topY - footY) };
}

/** Quarter glass: from the C-pillar forward to the B-pillar (under the drawn one when the style sets its width). */
function quarterSpan(style: BodyStyle): SideSpan {
  const band = bPillarBand(style);
  const front = band ? band[0] + PANE_TUCK : style.bPillar.rear;
  return { bot: [style.quarter.zRearBot, front], top: [style.quarter.zRearTop, front] };
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
  const segS = 6;
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
