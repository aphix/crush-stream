import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PART_FAMILY, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import type { GlassName } from "./car-core.ts";
import { CAR_STYLES, type BodyStyle, type GlassBow, type GlassQuad, type YZ } from "./car-variants.ts";
import { ROCKER, followedHoodTopY, glassTopY, glassX, hoodRearZ, lerp, makeHoodGeometry, roofTopY, sampleSlice, sectionPoints, shoulderDrop, sideX } from "./car-mesh.ts";
import { aPillarTopZ, bPillarBand, beltY, doorGlassFrontZ, REAR_GLASS_BOW, rockerAt, sideBowZ, WINDSHIELD_BOW } from "./car-lines.ts";
import { doorSkinStand } from "./car-door-mesh.ts";
import { FITTING_ATTRIBUTE, GLASS_ATTRIBUTE, MATTE_PRIVACY } from "./constants.ts";
import { mergeToned } from "./car-materials.ts";

// Glass panes on the shared platform: windshield, rear glass, door and quarter glass, filling the greenhouse `car-greenhouse-mesh.ts` builds.

/** The panes in the order a car adds them (`addGlass`): the order of its glass state's 2-bit fields (`glassBits`). */
export const GLASS_NAMES: readonly GlassName[] = ["windshield", "rear", "doorL", "doorR", "quarterL", "quarterR"];

const SEDAN = CAR_STYLES.sedan;
/** The door glass pane's origin in door space (right door; the left mirrors x): the pane is parented to its door there. */
export const DOOR_GLASS_SEAT = { x: -0.02, y: 0.52, z: -0.28 } as const;

const _pt = new THREE.Vector3();

/** A raked pane with its bow resolved, `fall`: how far (m) its point at car `x`, `t` up from the base, sits under the flat quad, `ahead`: how far (z, m) its row `t` stands forward of it, and `roundTop`: with `round`, only its top corners round (a windshield's base corners sit square on the cowl). */
type BowedQuad = GlassQuad & { bow: GlassBow; fall: (x: number, t: number) => number; ahead?: (t: number) => number; roundTop?: boolean };

/** Point of raked quad `q` in car space: `xn` −1…1 across, `t` 0…1 base to top, bowed along z at the centre line (none at the edges). */
function quadPoint(q: BowedQuad, xn: number, t: number): THREE.Vector3 {
  const x = xn * lerp(q.wBase, q.wTop, t) * 0.5;
  return _pt.set(x, lerp(q.base[0], q.top[0], t) - q.fall(x, t), lerp(q.base[1], q.top[1], t) + lerp(q.bow.base, q.bow.top, t) * (1 - xn * xn) + (q.ahead?.(t) ?? 0));
}

/** How far (m) a raked pane whose top edge lies at `topZ` falls under its flat quad at car `x`, `t` up from its base: its top edge follows `share` of the roof's dome across the car (none at the centre line; default the style's), fading to the base. */
export function domeFall(style: BodyStyle, topZ: number, share = style.domeFall ?? 1): (x: number, t: number) => number {
  const crown = roofTopY(0, topZ, style);
  return (x, t) => share * t * (crown - roofTopY(x, topZ, style));
}

/** A seated pane's base (`windshield.seat`) stands this far (m) over the drawn hood's top: clear of it, closer than the eye reads as a gap. */
const WINDSHIELD_SEAT = 0.002;
/** The seat's ray starts this far (m) over the pane's highest base, clear of any hood top under it. */
const HOOD_PROBE_LIFT = 0.1;

/** A seated style's drawn hood as the car places it (its hinge origin), built once per style object: the pane's seat reads its top as drawn. */
const HOOD_PROBES = new WeakMap<BodyStyle, THREE.Mesh>();
const HOOD_PROBE_MATERIAL = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const _hoodRay = new THREE.Raycaster();
const _hoodFrom = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

/** Height (car frame, m) of `style`'s drawn hood's top at (`x`, `z`), read from its mesh with a ray down from `ceiling`; the bend's formula (`followedHoodTopY`) where no hood lies (past its width). */
function drawnHoodTopY(style: BodyStyle, x: number, z: number, ceiling: number): number {
  let probe = HOOD_PROBES.get(style);
  if (probe === undefined) {
    probe = new THREE.Mesh(makeHoodGeometry(style), HOOD_PROBE_MATERIAL);
    probe.position.set(0, style.hood.origin[0], style.hood.origin[1]);
    probe.updateMatrixWorld(true);
    HOOD_PROBES.set(style, probe);
  }
  _hoodRay.set(_hoodFrom.set(x, ceiling, z), _down);
  return _hoodRay.intersectObject(probe)[0]?.point.y ?? followedHoodTopY(x, z, style);
}

/** Height (m) of the windshield's base at column `xn` (−1…1): `base[0]`, or with `windshield.seat` the drawn hood's top there along the pane's bow (`WINDSHIELD_SEAT` over it, read off the hood's mesh), never above `base[0]`. A hood ending in front of the glass seats it on its rear edge. */
export function windshieldBaseY(style: BodyStyle, xn: number): number {
  const { base, wBase, bow = WINDSHIELD_BOW, seat } = style.windshield;
  if (seat !== true) return base[0];
  const x = (Math.abs(xn) * wBase) / 2;
  const zGlass = base[1] + bow.base * (1 - xn * xn);
  return Math.min(base[0], drawnHoodTopY(style, x, Math.max(zGlass, hoodRearZ(x, style)), base[0] + HOOD_PROBE_LIFT) + WINDSHIELD_SEAT);
}

/** The windshield's base as its side edge stands, [y, z]: the A-post and the door glass's knee run along that edge. */
export function windshieldSideBase(style: BodyStyle): YZ {
  return [windshieldBaseY(style, 1), style.windshield.base[1]];
}

/** The windshield pane's side edge (+x half-width, m) `t` up its slant (0 base .. 1 top, carried on past the base): straight, or on its top corner's arc where `windshield.round` rounds it; the A-post's front rail follows it. */
export function windshieldSideX(style: BodyStyle, t: number): number {
  const { base, wBase, wTop, round } = style.windshield;
  const half = lerp(wBase, wTop, t) / 2;
  if (round === undefined) return half;
  const rT = round / hypot2(style.windshieldTop[0] - base[0], style.windshieldTop[1] - base[1]);
  const dt = THREE.MathUtils.clamp((t - 1 + rT) / rT, 0, 1);
  return half * (1 - (2 * round * (1 - Math.sqrt(1 - dt * dt))) / Math.min(wBase, wTop));
}

/** How a raked pane is drawn: its grid (columns across, rows up), and `facing`, the way its outward normal runs along z. */
type QuadDraw = { segX: number; segY: number; facing: 1 | -1 };
const WINDSHIELD_DRAW: QuadDraw = { segX: 10, segY: 8, facing: 1 };
const REAR_GLASS_DRAW: QuadDraw = { segX: 8, segY: 6, facing: -1 };

/** Raked glass quad (windshield / rear glass), bowed along z at the centre line; `userData.centre` is its bowed centre (`glassWorld`). */
function makeGlassQuad(q: BowedQuad, { segX, segY }: QuadDraw): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= segY; j++) {
    const t = j / segY;
    for (let i = 0; i <= segX; i++) {
      const p = quadPoint(q, (i / segX) * 2 - 1, t);
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
  const centre = quadPoint(q, 0, 0.5);
  // Not `toArray()`: growing a fresh array through that shared three function sends its stores megamorphic for every per-frame caller.
  geo.userData.centre = [centre.x, centre.y, centre.z];
  return geo;
}

/** The windshield's quad on `style`: its base and widths, its top edge, its bow; `windshield.round` rounds its top corners, the glass's own outline. */
function windshieldQuad(style: BodyStyle): BowedQuad {
  const { base, wBase, wTop, bow = WINDSHIELD_BOW, sideBow, seat, round } = style.windshield;
  const ahead = sideBow === undefined ? undefined : (t: number) => sideBowZ(sideBow, t);
  const dome = domeFall(style, style.windshieldTop[1], style.windshield.domeFall);
  // quadPoint lays x = xn * lerp(wBase, wTop, t) / 2: dividing it out gives the column's xn; the seat's drop fades to nothing at the top.
  const fall = seat !== true ? dome : (x: number, t: number) => dome(x, t) + (1 - t) * (base[0] - windshieldBaseY(style, x / (lerp(wBase, wTop, t) / 2)));
  return { base, top: style.windshieldTop, wBase, wTop, bow, fall, ahead, ...(round === undefined ? {} : { round, roundOutline: true, roundTop: true }) };
}

/** The rear glass's quad on `style`, its bow and fall resolved. */
function rearGlassQuad(style: BodyStyle): BowedQuad {
  return { ...style.rearGlass, bow: style.rearGlass.bow ?? REAR_GLASS_BOW, fall: domeFall(style, style.rearGlass.top[1]) };
}

/** Fixed-point steps solving where a bowed pane's side edge crosses a car z: the bow shifts a round corner's points under 2 cm, so three settle it. */
const SIDE_SOLVE_STEPS = 3;

/** Where raked quad `q`'s side edge (+x) crosses car `z`: `t` up its slant and `xn` across, on its top corners' arcs (a sail laps those; the lower ones sit at a deck's shut line). */
function sideAt(q: BowedQuad, z: number): { t: number; xn: number } {
  const { rS, rT } = q.round ? roundCorners(q, q.round) : { rS: 0, rT: 1 };
  let [t, xn] = [0, 1];
  for (let k = 0; k < SIDE_SOLVE_STEPS; k++) {
    const bow = lerp(q.bow.base, q.bow.top, t) * (1 - xn * xn);
    t = THREE.MathUtils.clamp((z - bow - q.base[1]) / (q.top[1] - q.base[1]), 0, 1);
    const dt = Math.max(t - 1 + rT, 0) / rT;
    xn = 2 * (1 - rS + rS * Math.sqrt(1 - dt * dt)) - 1;
  }
  return { t, xn };
}

/** The point (a fresh vector) on `style`'s drawn rear glass `inset` (m) in from its side edge (+x) where that edge crosses car `z`, round at the top corners. */
export function rearGlassInset(style: BodyStyle, z: number, inset: number): THREE.Vector3 {
  const q = rearGlassQuad(style);
  const { t, xn } = sideAt(q, z);
  return quadPoint(q, xn - (2 * inset) / lerp(q.wBase, q.wTop, t), t).clone();
}

/** The car z where `style`'s drawn rear glass's side edge (+x) stands `share` of the way round its top corner's arc (0 its side end, 1 its top end); null for square corners. */
export function rearGlassCornerZ(style: BodyStyle, share: number): number | null {
  const q = rearGlassQuad(style);
  if (!q.round) return null;
  const { rS, rT } = roundCorners(q, q.round);
  const angle = (share * Math.PI) / 2;
  const [t, xn] = [1 - rT + rT * detSin(angle), 1 - 2 * rS + 2 * rS * detCos(angle)];
  return lerp(q.base[1], q.top[1], t) + lerp(q.bow.base, q.bow.top, t) * (1 - xn * xn);
}

export function makeWindshield(style: BodyStyle = SEDAN): THREE.BufferGeometry {
  const quad = windshieldQuad(style);
  return quad.round ? roundedGlass(quad, quad.round, WINDSHIELD_DRAW) : makeGlassQuad(quad, WINDSHIELD_DRAW);
}

/** A point of `style`'s windshield in car space: `xn` −1…1 across, `t` 0…1 its base to its top, on its bow and its dome's fall (a fresh vector). */
export function windshieldPoint(style: BodyStyle, xn: number, t: number): THREE.Vector3 {
  return quadPoint(windshieldQuad(style), xn, t).clone();
}

/** Glass quad `q` drawn in by its `frame` ([side, bottom, top], m: sides across, bottom and top along its slope), bowed and fallen as `q`. */
function framedQuad(q: BowedQuad, [side, bottom, top]: readonly [number, number, number]): BowedQuad {
  const len = hypot2(q.top[0] - q.base[0], q.top[1] - q.base[1]);
  const at = (t: number): YZ => [lerp(q.base[0], q.top[0], t), lerp(q.base[1], q.top[1], t)];
  const [t0, t1] = [bottom / len, 1 - top / len];
  const ahead = q.ahead;
  return {
    base: at(t0),
    top: at(t1),
    wBase: lerp(q.wBase, q.wTop, t0) - 2 * side,
    wTop: lerp(q.wBase, q.wTop, t1) - 2 * side,
    bow: q.bow,
    fall: (x, t) => q.fall(x, lerp(t0, t1, t)),
    ahead: ahead && ((t) => ahead(lerp(t0, t1, t))),
  };
}

/** `geo`'s `GLASS_ATTRIBUTE` with every vertex `frit` (1 black frit, 0 clear) and none privacy. */
function glassTone(geo: THREE.BufferGeometry, frit: 0 | 1): THREE.BufferGeometry {
  const tone = new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute("position").count * 2), 2);
  if (frit) for (let i = 0; i < tone.count; i++) tone.setX(i, 1);
  return geo.setAttribute(GLASS_ATTRIBUTE, tone);
}

/** Marks every vertex of `geo`, a privacy pane's (`privacyGlass`): `glassMaterial` darkens it and floors its opacity (and roughens a `matte` one); a frit vertex stays black. */
export function privacyPane(geo: THREE.BufferGeometry, matte: boolean): void {
  if (!geo.hasAttribute(GLASS_ATTRIBUTE)) glassTone(geo, 0);
  const tone = geo.getAttribute(GLASS_ATTRIBUTE);
  for (let i = 0; i < tone.count; i++) tone.setY(i, matte ? MATTE_PRIVACY : 1);
}

/** A black frit band: rows of points (each row the same length) as a strip grid wound like `makeGlassQuad`'s, every vertex frit. */
function fritBand(rows: readonly THREE.Vector3[][]): THREE.BufferGeometry {
  const n = rows[0]!.length;
  const geo = new THREE.BufferGeometry().setFromPoints(rows.flat());
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(rows.flatMap((row, j) => row.flatMap((_, i) => [i / (n - 1), j / (rows.length - 1)])), 2));
  glassTone(geo, 1);
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

/** Chords along a frit's top and bottom edges: the 1.5 cm bow and the dome's fall each bend about 1 mm off a quarter-width chord, under the band's own width. */
const FRIT_CHORDS = 4;

/** A framed rear glass: its pane drawn in by the `frame`, the band out to the outline its black frit, both bowed and fallen alike (`glassTone`: the frit's vertices are black). */
function framedGlass(q: BowedQuad, frame: readonly [number, number, number], draw: QuadDraw): THREE.BufferGeometry {
  const inner = framedQuad(q, frame);
  const pane = makeGlassQuad(inner, draw);
  glassTone(pane, 0);
  const along = (g: BowedQuad, t: number) => Array.from({ length: FRIT_CHORDS + 1 }, (_, i) => quadPoint(g, (i / FRIT_CHORDS) * 2 - 1, t).clone());
  // The sides take no bow (it is zero at the pane's edges) and the fall bends them under 2 mm off a chord: one chord each.
  const side = (xn: number) => [0, 1].map((t) => [quadPoint(q, xn, t).clone(), quadPoint(inner, xn, t).clone()]);
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

/** Points each rounded corner's arc takes off each of its two edges. */
const ROUND_STEPS = 3;

/** A geometry of `points` ((s, t) on the pane, 0…1 across and up) at `at`'s positions, wound as `index`, every vertex `frit` (1 black frit, 0 clear). */
function paneGeometry(points: readonly (readonly [number, number])[], at: (s: number, t: number) => THREE.Vector3, index: number[], frit: 0 | 1): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry().setFromPoints(points.map(([s, t]) => at(s, t).clone()));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(points.flat(), 2));
  glassTone(geo, frit);
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** `round` (m) corners on `q`'s (s, t) square (the top ones only with `roundTop`): the zones' lines (`ROUND_STEPS + 1` per corner), `arc` mapping a corner-square point onto its quarter circle, `rim` a corner's arc from its horizontal-edge tangent point to its vertical-edge one. */
function roundCorners(q: BowedQuad, round: number) {
  const len = hypot2(q.top[0] - q.base[0], q.top[1] - q.base[1]);
  const [rS, rT] = [round / Math.min(q.wBase, q.wTop), round / len];
  const bottom = q.roundTop !== true;
  // A zone's lines, from its inner line out to the edge at 0 or 1.
  const zone = (r: number, edge: number) => Array.from({ length: ROUND_STEPS + 1 }, (_, k) => (edge ? 1 - r + (k * r) / ROUND_STEPS : r - (k * r) / ROUND_STEPS));
  const lines = (n: number, r: number, low = true) => [
    ...(low ? zone(r, 0).reverse() : [0]),
    ...Array.from({ length: n + 1 }, (_, k) => k / n).filter((s) => s > (low ? r : 0) + 0.5 / n && s < 1 - r - 0.5 / n),
    ...zone(r, 1),
  ];
  const arc = (s: number, t: number): [number, number] => {
    const [ds, dt] = [Math.max(rS - s, s - 1 + rS, 0) / rS, Math.max(bottom ? rT - t : 0, t - 1 + rT, 0) / rT];
    if (ds === 0 || dt === 0) return [s, t];
    const k = Math.max(ds, dt) / hypot2(ds, dt);
    return [s < 0.5 ? rS * (1 - ds * k) : 1 - rS * (1 - ds * k), t < 0.5 ? rT * (1 - dt * k) : 1 - rT * (1 - dt * k)];
  };
  const rim = (sEdge: number, tEdge: number): [number, number][] =>
    [...zone(rS, sEdge).map((s): [number, number] => [s, tEdge]), ...zone(rT, tEdge).reverse().slice(1).map((t): [number, number] => [sEdge, t])].map(([s, t]) => arc(s, t));
  return { rS, rT, bottom, lines, arc, rim };
}

/** The chrome bead takes every this-many'th point of a corner's arc: 34° chords on the coupe's 9 cm round (4 mm sag), which keeps the coupe under its triangle budget. */
const BEAD_ARC_STRIDE = 2;

/** The rounded pane's chrome outline in (s, t), counter-clockwise from its left edge's lower tangent point: each corner's arc (`BEAD_ARC_STRIDE`), and the grid's columns along the bottom and top (the bow and the dome's fall curve them). */
function roundedOutline(q: BowedQuad, round: number, segX: number): [number, number][] {
  const { rS, bottom, lines, rim } = roundCorners(q, round);
  const corner = (sEdge: number, tEdge: number) => rim(sEdge, tEdge).filter((_, k) => k % BEAD_ARC_STRIDE === 0);
  // `lines` runs the left corner zone, the columns, the right corner zone: only the columns lie between the arcs.
  const columns = lines(segX, rS).slice(ROUND_STEPS + 1, -(ROUND_STEPS + 1));
  return [
    ...(bottom ? corner(0, 0).reverse() : [[0, 0] as [number, number]]),
    ...columns.map((s): [number, number] => [s, 0]),
    ...(bottom ? corner(1, 0) : [[1, 0] as [number, number]]),
    ...corner(1, 1).reverse(),
    ...[...columns].reverse().map((s): [number, number] => [s, 1]),
    ...corner(0, 1),
  ];
}

/** A round-outlined pane's frit corners stand this far (m) in behind its plane: a dark backing seen only through the gaps the body leaves round its arcs (the cabin showed there). */
const ROUND_BACKING_INSET = 0.01;

/**
 * An unframed pane whose clear glass has `round` (m) corners: its grid gains `ROUND_STEPS` lines through each corner's square, whose
 * points map onto the corner's quarter circle (each square ring about the circle's centre onto the circle of its size); a black frit
 * fan fills each square corner out to the arc, so the glass's outline stays square, while the chrome bead follows the arcs. With
 * `roundOutline` the fans stand `ROUND_BACKING_INSET` in behind the pane: the glass's outline is the arcs, the fans a backing.
 */
function roundedGlass(q: BowedQuad, round: number, { segX, segY, facing }: QuadDraw): THREE.BufferGeometry {
  const { rS, rT, bottom, lines, arc, rim: cornerRim } = roundCorners(q, round);
  const at = (s: number, t: number) => quadPoint(q, s * 2 - 1, t);
  const [ss, ts] = [lines(segX, rS), lines(segY, rT, bottom)];
  const row = ss.length;
  const grid: number[] = [];
  for (let j = 0; j < ts.length - 1; j++) {
    for (let i = 0; i < row - 1; i++) {
      const a = j * row + i;
      grid.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const pane = paneGeometry(ts.flatMap((t) => ss.map((s) => arc(s, t))), at, grid, 0);
  const fans = [0, 1].flatMap((sEdge) =>
    (bottom ? [0, 1] : [1]).map((tEdge) => {
      const rim = cornerRim(sEdge, tEdge);
      // Counter-clockwise in (s, t), as the grid's triangles are.
      const [[s0, t0], [s1, t1]] = [rim[0]!, rim[1]!];
      if ((s0 - sEdge) * (t1 - tEdge) - (t0 - tEdge) * (s1 - sEdge) < 0) rim.reverse();
      return paneGeometry([[sEdge, tEdge], ...rim], at, rim.slice(1).flatMap((_, k) => [0, k + 1, k + 2]), 1);
    }),
  );
  if (q.roundOutline) {
    // In along the pane's inward normal (the flat pane's: the bow and fall tilt it under a millimetre over a corner).
    const inward = new THREE.Vector3(0, q.base[1] - q.top[1], q.top[0] - q.base[0]).normalize().multiplyScalar(-facing * ROUND_BACKING_INSET);
    for (const fan of fans) fan.translate(inward.x, inward.y, inward.z);
  }
  const geo = mergeGeometries([pane, ...fans], false);
  if (!geo) throw new Error("Failed to merge the rounded rear glass");
  const centre = quadPoint(q, 0, 0.5);
  geo.userData.centre = [centre.x, centre.y, centre.z];
  return geo;
}

export function makeRearGlass(style: BodyStyle = SEDAN): THREE.BufferGeometry {
  const quad = rearGlassQuad(style);
  if (quad.frame) return framedGlass(quad, quad.frame, REAR_GLASS_DRAW);
  return quad.round ? roundedGlass(quad, quad.round, REAR_GLASS_DRAW) : makeGlassQuad(quad, REAR_GLASS_DRAW);
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
  const base = windshieldSideBase(style);
  return { ...span, front: (t) => doorGlassFrontZ(lerp(footY, topY, t), footY, topY, style, base), kneeT: (knee - footY) / (topY - footY) };
}

/** The drawn quarter glass's rear edge (`quarter.drawn`, else the cage's). */
export function drawnQuarter(style: BodyStyle): { zRearBot: number; zRearTop: number } {
  return style.quarter.drawn ?? style.quarter;
}

/** Quarter glass: from the C-pillar (the drawn one unless `quarter` is given) forward to in under the drawn B-pillar's rear edge. */
function quarterSpan(style: BodyStyle, quarter = drawnQuarter(style)): SideSpan {
  const band = bPillarBand(style);
  return { bot: [quarter.zRearBot, band.belt[0] + PANE_TUCK], top: [quarter.zRearTop, band.top[0] + PANE_TUCK] };
}

/** A side pane is drawn in this many bands, belt to top: straight between its rows, so a part meeting its edge samples it at the rows. */
export const SIDE_PANE_ROWS = 3;

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

/** A side pane's rows, belt to top (`t`): evenly (`SIDE_PANE_ROWS` bands), and the front edge's knee. */
function rowTs(span: SideSpan): number[] {
  const ts = Array.from({ length: SIDE_PANE_ROWS + 1 }, (_, k) => k / SIDE_PANE_ROWS);
  if (span.kneeT !== undefined && span.kneeT > 0 && span.kneeT < 1 && !ts.includes(span.kneeT)) ts.splice(ts.findIndex((t) => t > span.kneeT!), 0, span.kneeT);
  return ts;
}

/** Side glass from the belt to the roof cant (`sidePoint`). Positions are relative to `origin`. */
function makeSideGlassPane(sign: number, style: BodyStyle, span: SideSpan, origin: readonly [number, number, number]): THREE.BufferGeometry {
  const segS = SIDE_PANE_COLUMNS;
  const ts = rowTs(span);
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

/** The door glass's origin in car space: its pane (and trim) positions are relative to it. */
function doorGlassOrigin(sign: number, style: BodyStyle): [number, number, number] {
  const d = style.door;
  const o = DOOR_GLASS_SEAT;
  return [sign * (d.hingeX + o.x), d.hingeY + o.y, d.hingeZ + o.z];
}

/** Door glass in pane-local space: car.ts parents it to the door at `DOOR_GLASS_SEAT` (x mirrored on the left). */
export function makeSideGlass(sign: number, style: BodyStyle = SEDAN): THREE.BufferGeometry {
  return makeSideGlassPane(sign, style, doorSpan(style), doorGlassOrigin(sign, style));
}

/** Quarter glass from the B-pillar back to the C-pillar, on the body (car local). */
export function makeRearSideGlass(sign: number, style: BodyStyle = SEDAN): THREE.BufferGeometry {
  return makeSideGlassPane(sign, style, quarterSpan(style), [0, 0, 0]);
}

/** Window trim: its width (m) across, straddling the pane's edge: a 1 cm bright bead, as the references' window chrome. */
const TRIM_WIDTH = 0.01;
/** Window trim: its crest stands this far (m) over the glass, enough to catch a highlight. */
const TRIM_PROUD = 0.005;
/** Window trim: its two edges stand this far (m) over the glass, clear of it so they don't z-fight. */
const TRIM_EDGE = 0.001;
/** Window trim's cross-section, outer edge to inner edge: [offset (m) outward from the pane's edge, height (m) over the glass]. */
const TRIM_SECTION = [[TRIM_WIDTH / 2, TRIM_EDGE], [0, TRIM_PROUD], [-TRIM_WIDTH / 2, TRIM_EDGE]] as const;

/** A trim ribbon's mesh from `TRIM_SECTION` points at each vertex of a loop (`positions`); an open run (`closed` false) gets a wall at each end, appended to `positions`. `flip` when it winds the other way round to the winding that faces out. */
function ribbonGeometry(positions: number[], flip: boolean, closed = true): THREE.BufferGeometry {
  const sectionLength = TRIM_SECTION.length;
  const loopLength = positions.length / 3 / sectionLength;
  const indices: number[] = [];
  for (let k = 0; k < (closed ? loopLength : loopLength - 1); k++) {
    const a = k * sectionLength;
    const b = ((k + 1) % loopLength) * sectionLength;
    for (let o = 0; o < sectionLength - 1; o++) {
      const [p0, p1, q0, q1] = [a + o, a + o + 1, b + o, b + o + 1];
      if (flip) indices.push(p0, q0, p1, p1, q0, q1);
      else indices.push(p0, p1, q0, p1, q1, q0);
    }
  }
  if (!closed) {
    // End walls on copies of the end sections, so they shade flat.
    const runLength = positions.length;
    for (const atStart of [true, false]) {
      const base = positions.length / 3;
      const from = atStart ? 0 : runLength - sectionLength * 3;
      for (let i = from; i < from + sectionLength * 3; i++) positions.push(positions[i]!);
      indices.push(...(atStart !== flip ? [base + 2, base + 1, base] : [base, base + 1, base + 2]));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  // The chrome material's shader reads this attribute; 0 draws its own tone.
  geo.setAttribute(FITTING_ATTRIBUTE, new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3), 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Chrome bead round a side pane's border, built on the pane's own `span` and `origin` so it lines up with the glass and shares its parent. */
function makeSideGlassFrameFor(sign: number, style: BodyStyle, span: SideSpan, origin: readonly [number, number, number]): THREE.BufferGeometry {
  const ts = rowTs(span);
  const n = SIDE_PANE_COLUMNS;
  // Counter-clockwise in (z, y), which the outward offset below relies on.
  const loop: [number, number][] = [];
  for (let i = 0; i < n; i++) loop.push([i / n, 0]);
  for (let j = 0; j < ts.length - 1; j++) loop.push([1, ts[j]!]);
  for (let i = n; i > 0; i--) loop.push([i / n, 1]);
  for (let j = ts.length - 1; j > 0; j--) loop.push([0, ts[j]!]);
  const pts = loop.map(([s, t]) => sidePoint(sign, style, span, s, t).clone());
  const m = pts.length;
  const positions: number[] = [];
  for (let k = 0; k < m; k++) {
    const [p, prev, next] = [pts[k]!, pts[(k + m - 1) % m]!, pts[(k + 1) % m]!];
    const outZ = next.y - prev.y;
    const outY = prev.z - next.z;
    const len = hypot2(outZ, outY) || 1;
    for (const [out, proud] of TRIM_SECTION) {
      const z = p.z + (outZ / len) * out;
      const y = p.y + (outY / len) * out;
      positions.push(sign * (glassX(z, y, style) + proud) - origin[0], y - origin[1], z - origin[2]);
    }
  }
  // The left side mirrors the right's winding.
  return ribbonGeometry(positions, sign < 0);
}

type ChromeStrip = NonNullable<BodyStyle["chromeStrips"]>[number];

/** A chrome strip's polyline gets a point at least this often (m), so the strip follows the skin's curve. */
const STRIP_STEP = 0.1;

/** `points` with extra points between them so no run is longer than `STRIP_STEP`. */
function densified(points: ChromeStrip["points"]): [number, number][] {
  const dense: [number, number][] = [[points[0]![0], points[0]![1]]];
  for (let i = 1; i < points.length; i++) {
    const [from, to] = [points[i - 1]!, points[i]!];
    const runs = Math.ceil(hypot2(to[0] - from[0], to[1] - from[1]) / STRIP_STEP);
    for (let run = 1; run <= runs; run++) dense.push([lerp(from[0], to[0], run / runs), lerp(from[1], to[1], run / runs)]);
  }
  return dense;
}

/** A strip rides the door when all its points lie inside the door cut. */
function ridesDoor(strip: ChromeStrip, style: BodyStyle): boolean {
  const [zRear, zFront] = style.door.aperture;
  return strip.points.every(([z]) => z >= zRear && z <= zFront);
}

/** The door skin's outer half-width (m) at car-local `z` and height `y`: the body side line `makeDoorGeometry` follows, its stand-off there (`stand`, `doorSkinStand`) over it. */
function doorSkinX(z: number, y: number, style: BodyStyle, stand: (z: number, y: number) => number): number {
  const slice = sampleSlice(z, style.profile);
  return sideX(y, slice.hw, slice.yBelt, rockerAt(z, style), shoulderDrop(z, style)) + stand(z, y);
}

/** The drawn body's half-width (m) at car-local `z` and height `y`: its section ring's right side read up from the rocker, held at the rocker's below it and the deck crown's above. */
function bodySkinX(z: number, y: number, style: BodyStyle): number {
  const ring = sectionPoints(sampleSlice(z, style.profile), style, "drawn");
  let lower = ring[ring.length - 1 - ROCKER]!;
  for (let i = ring.length - ROCKER; i < ring.length; i++) {
    const upper = ring[i]!;
    if (y <= upper.y) return lerp(lower.x, upper.x, THREE.MathUtils.clamp((y - lower.y) / (upper.y - lower.y || 1), 0, 1));
    lower = upper;
  }
  return lower.x;
}

/** Chrome strip on side `sign` as an open ribbon: `TRIM_SECTION` across its polyline in the side view, its offsets scaled to the strip's width, stood proud of the skin at `skinX` (half-width, m, at z and y). Positions are relative to `origin`. */
function makeChromeStrip(sign: number, strip: ChromeStrip, skinX: (z: number, y: number) => number, origin: readonly [number, number, number]): THREE.BufferGeometry {
  const points = densified(strip.points);
  const widthScale = strip.width / TRIM_WIDTH;
  const positions: number[] = [];
  for (let k = 0; k < points.length; k++) {
    const [z, y] = points[k]!;
    const [prev, next] = [points[Math.max(k - 1, 0)]!, points[Math.min(k + 1, points.length - 1)]!];
    const len = hypot2(next[0] - prev[0], next[1] - prev[1]) || 1;
    for (const [out, proud] of TRIM_SECTION) {
      const edgeZ = z + ((next[1] - prev[1]) / len) * out * widthScale;
      const edgeY = y + ((prev[0] - next[0]) / len) * out * widthScale;
      positions.push(sign * (skinX(edgeZ, edgeY) + proud) - origin[0], edgeY - origin[1], edgeZ - origin[2]);
    }
  }
  return ribbonGeometry(positions, sign < 0, false);
}

/** Chrome trim round the door glass, in the glass's own space: car.ts parents it to the door at the pane's seat. */
export function makeSideGlassFrame(sign: number, style: BodyStyle): THREE.BufferGeometry {
  return makeSideGlassFrameFor(sign, style, doorSpan(style), doorGlassOrigin(sign, style));
}

/** The door's chrome strips in the glass's own space (as `makeSideGlassFrame`), merged; null for a style whose strips all ride the body. */
export function makeDoorChromeStrips(sign: number, style: BodyStyle): THREE.BufferGeometry | null {
  const strips = (style.chromeStrips ?? []).filter((strip) => ridesDoor(strip, style));
  if (strips.length === 0) return null;
  const stand = doorSkinStand(style);
  const origin = doorGlassOrigin(sign, style);
  return mergeToned(strips.map((strip) => makeChromeStrip(sign, strip, (z, y) => doorSkinX(z, y, style, stand), origin)), "door chrome strips");
}

/** Chrome ribbon round a raked pane's border: the points its own grid draws (`quadPoint`), offset outward in the pane's plane and stood proud along its outward normal. */
function makeQuadGlassFrame(q: BowedQuad, { segX, facing }: QuadDraw): THREE.BufferGeometry {
  const xs = Array.from({ length: segX + 1 }, (_, i) => (i / segX) * 2 - 1);
  // Counter-clockwise in (across, up), which the edge offsets below rely on.
  const at = (xn: number, t: number) => quadPoint(q, xn, t).clone();
  const pts =
    q.round && !q.frame
      ? roundedOutline(q, q.round, segX).map(([s, t]) => at(s * 2 - 1, t))
      : [...xs.map((xn) => at(xn, 0)), ...xs.map((xn) => at(xn, 1)).reverse()];
  // The flat pane's normal: the bow and the fall tilt it under a millimetre across the ribbon.
  const plane = new THREE.Vector3(0, q.base[1] - q.top[1], q.top[0] - q.base[0]).normalize();
  const outward = plane.clone().multiplyScalar(facing);
  const n = pts.length;
  const edgeOuts = pts.map((p, k) => pts[(k + 1) % n]!.clone().sub(p).cross(plane).normalize());
  const positions: number[] = [];
  for (let k = 0; k < n; k++) {
    const [before, after] = [edgeOuts[(k + n - 1) % n]!, edgeOuts[k]!];
    const bisector = before.clone().add(after).normalize();
    const reach = 1 / bisector.dot(before);
    for (const [offset, proud] of TRIM_SECTION) {
      const v = pts[k]!.clone().addScaledVector(bisector, offset * reach).addScaledVector(outward, proud);
      positions.push(v.x, v.y, v.z);
    }
  }
  // The unflipped winding faces against `plane`: the windshield faces out along it, the rear glass against it.
  return ribbonGeometry(positions, facing > 0);
}

/** The body's chrome trim, a geometry per thing it follows in a crush (car local): see `makeBodyGlassTrim`. */
type BodyGlassTrim = {
  /** Both quarter glasses' frames: the panes are rigid on the body. */
  quarters: THREE.BufferGeometry;
  /** The windshield's frame: it follows the windshield's skin. */
  windshield: THREE.BufferGeometry;
  /** The rear glass's frame, absent when the glass rides the tailgate (`rearOnBody` false); it follows the rear glass's skin. */
  rear: THREE.BufferGeometry | null;
  /** The body's chrome strips on both sides, absent for a style with none: they follow the body paint. */
  strips: THREE.BufferGeometry | null;
};

/** Chrome trim round the body's glass and along its sides, split by what each follows in a crush: the panes' frames and the strips on the skin. */
export function makeBodyGlassTrim(style: BodyStyle, rearOnBody: boolean): BodyGlassTrim {
  const quarters = mergeToned([-1, 1].map((sign) => makeSideGlassFrameFor(sign, style, quarterSpan(style), [0, 0, 0])), "quarter window trim");
  const strips = (style.chromeStrips ?? []).filter((strip) => !ridesDoor(strip, style)).flatMap((strip) => [-1, 1].map((sign) => makeChromeStrip(sign, strip, (z, y) => bodySkinX(z, y, style), [0, 0, 0])));
  return {
    quarters,
    windshield: makeQuadGlassFrame(windshieldQuad(style), WINDSHIELD_DRAW),
    rear: rearOnBody ? makeQuadGlassFrame(rearGlassQuad(style), REAR_GLASS_DRAW) : null,
    strips: strips.length === 0 ? null : mergeToned(strips, "body chrome strips"),
  };
}

/**
 * Every pane's four corners on `style` in car space, at rest and before a class lift, in `GLASS_NAMES` order: for each,
 * (across 0, base), (across 1, base), (across 0, top), (across 1, top), xyz each (across: left to right on the windshield
 * and rear glass, rear to front on a side pane). The thrown dummies' world fits a slab to each (`RagdollSystem`).
 */
export function glassCorners(style: BodyStyle): Float32Array {
  const out = new Float32Array(GLASS_NAMES.length * 12);
  // A raked pane's slab lies on its plane through its middle, where a dummy strikes it: its top corners' fall is drawn only.
  const quads = [windshieldQuad(style), rearGlassQuad(style)].map((q): BowedQuad => ({ ...q, fall: () => 0 }));
  for (let p = 0; p < GLASS_NAMES.length; p++) {
    const name = GLASS_NAMES[p]!;
    const sign = name.endsWith("L") ? -1 : 1;
    for (let k = 0; k < 4; k++) {
      const across = k & 1;
      const t = k >> 1;
      const v = p < 2 ? quadPoint(quads[p]!, across * 2 - 1, t) : sidePoint(sign, style, name.startsWith(PART_FAMILY.door) ? doorSpan(style) : quarterSpan(style, style.quarter), across, t);
      v.toArray(out, p * 12 + k * 3);
    }
  }
  return out;
}
