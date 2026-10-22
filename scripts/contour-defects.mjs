/**
 * Exterior defects of the built car (geometry only): visible gaps and stand-offs at a part's free edge, and z-fighting surfaces.
 * Cheap and exact on the meshes, no renderer; findings are for the mesh's owner to take or leave (some overhangs are intended).
 *
 * The parts: the body, lids, door skins, bumpers, glass, window trim and light bar, the style's mirrors, grille, tail trim and wipers
 * (`partSeats`), and the lamp units (`LampBatch`), each its own part. The style's small fittings (`smallFittings`: exhaust tips, tow
 * hitch) are left out of every score.
 * - Free edges: each part's open edges (used by one of its triangles). An edge seen from outside (a ray off it, out of the car, meets
 *   nothing) is measured to the nearest other part within NEAR_M: `gapMm` where it stops short of that surface (an open seam you see
 *   into), `standMm` where it stands off it (an edge lifted over the next surface: a spoiler off the roof, a glass edge over the body).
 * - Z-fighting: two triangles (any parts, the same one too) facing the same way within ZF_ANGLE, within ZF_EPS of one plane, overlapping
 *   in it: `areaCm2` of overlap per place, `sepMm` the largest separation.
 * Places cluster within PLACE_M. Each carries the region it is in (front bumper, wheel arch, windshield base, roof rear, ...).
 * `suggest`: a fix where it is certain: z-fighting the separation is nil and one part is far smaller (push it out 1.5 mm); a stand-off
 * whose edges all stand off by one height on an intended roof part (the field and value that seat it). Nothing where it is unsure.
 */
import * as THREE from "three";
import { FITTING_ATTRIBUTE, GLASS, K, intendedEdges, mm, r1, smallFittings } from "./contour-core.mjs";

/** Spatial hash cell (m). */
const CELL = 0.05;
/** A free edge's neighbour is looked for this far (m); an edge shorter than EDGE_MIN (m) is skipped. */
const NEAR_M = 0.08;
const EDGE_MIN = 0.004;
/** A gap or stand-off under these (m) is a seam, not a defect; at FLAG_BAD × them it is bad. */
const GAP_MIN = 0.008;
const STAND_MIN = 0.004;
const FLAG_BAD = 2;
/**
 * Z-fighting: normals within this (degrees), every vertex of one within this (m) of the other's plane, overlap over this (m²). 2 mm
 * fights at the game's far chase distances (24-bit depth over a 0.1 m near plane), not only coincident faces.
 */
const ZF_ANGLE = 4;
const ZF_EPS = 0.002;
const ZF_AREA = 2e-6;
/** Two surfaces under this (m) apart are in one place (a true overlap): a geometric fix. Apart, a polygon offset is measured. */
const TRUE_OVERLAP_M = 0.00005;
/** The camera ranges (m) the offset must hold at: up close (garage, near chase), chase, derby and far camera. */
const OFFSET_RANGES = [5, 20, 80];
/** The race camera's lens and planes and its view (`depth-probe.ts`), which the measure's pixels stand for. */
const PROBE_LENS = { fov: 62, near: 0.1, far: 900, w: 1280, h: 800 };
/** depth-probe.ts's ladders, run on past their top for parts a few millimetres apart at 80 m. */
const FACTORS = [0, 1 / 128, 1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8];
const UNITS = [0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384];
/** A range whose detail covers fewer probe pixels than this is not measured: no suggestion from it. */
const OFFSET_MIN_PX = 40;
/** Findings closer than PLACE_M (m) are one place (a long run of them one place too); a z-fighting place under ZF_PLACE_CM2 (cm²) is left out. */
const PLACE_M = 0.15;
const ZF_PLACE_CM2 = 0.3;
const GAP_PLACE_M = 0.15;
/** A ray that meets nothing within this (m) has left the car. */
const ESCAPE_M = 6;
/**
 * The visibility rays start this far (m) off an open edge: under any skin it is tucked beneath (a pillar's top tucks 2 mm under the
 * roof, `ROOF_TUCK`), so a buried edge's rays meet that skin and it counts as covered.
 */
const RAY_START_M = 0.0001;
/** The part batch kinds on the outside of the car. */
const EXTERIOR_PARTS = ["mirrorL", "mirrorR", "grille", "tailTrim", "wipers"];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Vector3();

/** Every exterior part of `stage`'s car as world triangles: `tri` (9 floats each), `part` (index into `names`), `kind` (`K`), skipping `skip` boxes. */
export function partsOf(stage, skip) {
  const car = stage.car;
  car.group.updateMatrixWorld(true);
  const look = car.lookMeshes();
  const entries = [];
  const shown = (o) => {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  const mesh = (m, name, kind) => {
    if (m?.isMesh && shown(m) && !entries.some((e) => e.src === m)) entries.push({ src: m, geo: m.geometry, matrix: m.matrixWorld, name, kind });
  };
  for (const pane of car.glassPanes) mesh(pane.mesh, `glass ${pane.name}`, pane.name === "windshield" ? K.windshield : pane.name === "rear" ? K.rear : K.side);
  for (const [i, m] of look.bumpers.entries()) mesh(m, i === 0 ? "front bumper" : "rear bumper", K.bumper);
  mesh(look.body, "body", K.body);
  mesh(look.hood, "hood", K.body);
  mesh(look.trunk, "boot lid", K.body);
  for (const [i, m] of look.doors.entries()) mesh(m, i === 0 ? "door L" : "door R", K.body);
  if (car.lightBar) mesh(car.lightBar, "light bar", K.body);
  car.group.traverse((o) => {
    if (o.isMesh && o.name === "windowTrim") mesh(o, "window trim", K.trim);
  });
  const kindName = new Map(Object.entries(stage.game.PART_KIND ?? {}).map(([k, v]) => [v, k]));
  for (const seat of car.partSeats) {
    const name = kindName.get(seat.kind);
    if (!EXTERIOR_PARTS.includes(name) || !seat.drawn?.getAttribute("position") || !shown(seat)) continue;
    seat.updateWorldMatrix(true, false);
    entries.push({ src: seat, geo: seat.drawn, matrix: seat.matrixWorld, name, kind: K.body });
  }
  const lamps = stage.lamps.draw;
  for (let i = 0; i < lamps.count; i++) entries.push({ src: null, geo: lamps.variants[lamps.variantAt(i)], matrix: lamps.matrixAt(i, new THREE.Matrix4()), name: `lamp unit ${i}`, kind: K.body });
  const tri = [];
  const part = [];
  const kind = [];
  for (const [pi, e] of entries.entries()) {
    const pos = e.geo.getAttribute("position");
    const fit = e.geo.getAttribute(FITTING_ATTRIBUTE);
    const index = e.geo.index;
    const n = index ? index.count : pos.count;
    for (let t = 0; t + 2 < n; t += 3) {
      _a.fromBufferAttribute(pos, index ? index.getX(t) : t).applyMatrix4(e.matrix);
      _b.fromBufferAttribute(pos, index ? index.getX(t + 1) : t + 1).applyMatrix4(e.matrix);
      _c.fromBufferAttribute(pos, index ? index.getX(t + 2) : t + 2).applyMatrix4(e.matrix);
      // A small fitting's own triangles only (merged into its bumper, `fit` > 0): the bumper round it stays whole, no false open edge.
      const own = fit && fit.getX(index ? index.getX(t) : t) > 0;
      if (own && skip.some((f) => f.box.containsPoint(_m.set((_a.x + _b.x + _c.x) / 3, (_a.y + _b.y + _c.y) / 3, (_a.z + _b.z + _c.z) / 3)))) continue;
      tri.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _c.x, _c.y, _c.z);
      part.push(pi);
      kind.push(e.kind);
    }
  }
  // Panels (the meshes: body, lids, doors, bumpers, glass, trim, light bar) take part in the free-edge gaps; the seated parts and lamp
  // units only in z-fighting (a wiper or mirror over the glass is no gap in it).
  const panelCount = entries.findIndex((e) => !e.src?.isMesh);
  return { tri: Float64Array.from(tri), part: Int32Array.from(part), kind: Uint8Array.from(kind), names: entries.map((e) => e.name), panels: panelCount < 0 ? entries.length : panelCount };
}

/** A uniform grid of the triangles' boxes: `cells` maps a cell key to its triangle indices. */
function hashOf(s) {
  const cells = new Map();
  const n = s.part.length;
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const lo = [0, 1, 2].map((c) => Math.floor(Math.min(s.tri[o + c], s.tri[o + 3 + c], s.tri[o + 6 + c]) / CELL));
    const hi = [0, 1, 2].map((c) => Math.floor(Math.max(s.tri[o + c], s.tri[o + 3 + c], s.tri[o + 6 + c]) / CELL));
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) {
          const k = key(x, y, z);
          const list = cells.get(k);
          if (list) list.push(t);
          else cells.set(k, [t]);
        }
  }
  return cells;
}

const key = (x, y, z) => (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512);

function triangle(s, t, out) {
  const o = t * 9;
  out.a.set(s.tri[o], s.tri[o + 1], s.tri[o + 2]);
  out.b.set(s.tri[o + 3], s.tri[o + 4], s.tri[o + 5]);
  out.c.set(s.tri[o + 6], s.tri[o + 7], s.tri[o + 8]);
  return out;
}

/** Whether a ray from `p` along unit `d` meets any triangle within ESCAPE_M (marching the grid). */
function blocked(s, cells, p, d, stamp, tick) {
  const T = new THREE.Triangle();
  const ray = new THREE.Ray(p, d);
  const hit = new THREE.Vector3();
  for (let step = 0; step * CELL * 0.5 < ESCAPE_M; step++) {
    const x = p.x + d.x * step * CELL * 0.5;
    const y = p.y + d.y * step * CELL * 0.5;
    const z = p.z + d.z * step * CELL * 0.5;
    if (y < -0.2 || y > 4) return false;
    const list = cells.get(key(Math.floor(x / CELL), Math.floor(y / CELL), Math.floor(z / CELL)));
    if (!list) continue;
    for (const t of list) {
      if (stamp[t] === tick) continue;
      stamp[t] = tick;
      triangle(s, t, T);
      if (ray.intersectTriangle(T.a, T.b, T.c, false, hit) && hit.distanceTo(p) > 1e-4) return true;
    }
  }
  return false;
}

/** The nearest point (and its triangle) on a part other than `part` within NEAR_M of `p`, or null. */
function nearestOther(s, cells, p, part) {
  const T = new THREE.Triangle();
  const q = new THREE.Vector3();
  let best = null;
  const r = Math.ceil(NEAR_M / CELL);
  const [cx, cy, cz] = [Math.floor(p.x / CELL), Math.floor(p.y / CELL), Math.floor(p.z / CELL)];
  const seen = new Set();
  for (let x = cx - r; x <= cx + r; x++)
    for (let y = cy - r; y <= cy + r; y++)
      for (let z = cz - r; z <= cz + r; z++) {
        for (const t of cells.get(key(x, y, z)) ?? []) {
          if (s.part[t] === part || s.part[t] >= s.panels || seen.has(t)) continue;
          seen.add(t);
          triangle(s, t, T).closestPointToPoint(p, q);
          const d = q.distanceTo(p);
          if (d <= NEAR_M && (best === null || d < best.d)) best = { d, q: q.clone(), n: T.getNormal(new THREE.Vector3()), t };
        }
      }
  return best;
}

/** Points within `reach` (m) chained into places. */
function places(items, reach) {
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) if (items[i].p.distanceTo(items[j].p) < reach) parent[find(i)] = find(j);
  const groups = new Map();
  for (let i = 0; i < items.length; i++) {
    const g = find(i);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(items[i]);
  }
  return [...groups.values()];
}

/** Where on the car `p` is, in the owner's words (`ctx`: the hubs, the side glass's bottom, the roof's and windshield's z). */
function regionOf(p, ctx) {
  for (const h of ctx.hubs) if (Math.abs(p.x) > 0.45 && Math.hypot(p.z - h.z, p.y - h.y) < 0.6 && Math.sign(p.x) === Math.sign(h.x)) return "wheel arch";
  if (p.y > ctx.belt) {
    if (p.z < ctx.roofRear - 0.05) return "roof rear / rear glass";
    if (p.z > ctx.roofFront - 0.05) return "windshield / A-pillar";
    return "roof / greenhouse";
  }
  if (p.z > ctx.front + 0.35) return p.y < ctx.belt - 0.2 ? "front bumper" : "nose";
  if (p.z < ctx.rear - 0.35) return p.y < ctx.belt - 0.2 ? "rear bumper" : "tail";
  if (p.z > ctx.wsBase - 0.3 && p.y > ctx.belt - 0.25) return "hood rear / windshield base";
  return "side";
}

/** Free-edge gaps and stand-offs seen from outside. */
function freeEdges(s, cells, ctx) {
  const items = [];
  const stamp = new Int32Array(s.part.length);
  let tick = 0;
  const q = 1 / 0.0002;
  const vkey = (x, y, z) => `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
  const edges = new Map();
  for (let t = 0; t < s.part.length; t++) {
    const o = t * 9;
    const ks = [0, 1, 2].map((c) => vkey(s.tri[o + c * 3], s.tri[o + c * 3 + 1], s.tri[o + c * 3 + 2]));
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      const k = `${s.part[t]}|${ks[i] < ks[j] ? `${ks[i]}|${ks[j]}` : `${ks[j]}|${ks[i]}`}`;
      const e = edges.get(k);
      if (e) e.n++;
      else edges.set(k, { n: 1, t, i, j });
    }
  }
  const centre = new THREE.Vector3();
  const T = new THREE.Triangle();
  for (const e of edges.values()) {
    if (e.n !== 1 || s.part[e.t] >= s.panels) continue;
    const o = e.t * 9;
    const a = new THREE.Vector3(s.tri[o + e.i * 3], s.tri[o + e.i * 3 + 1], s.tri[o + e.i * 3 + 2]);
    const b = new THREE.Vector3(s.tri[o + e.j * 3], s.tri[o + e.j * 3 + 1], s.tri[o + e.j * 3 + 2]);
    if (a.distanceTo(b) < EDGE_MIN) continue;
    const m = a.clone().add(b).multiplyScalar(0.5);
    const n = triangle(s, e.t, T).getNormal(new THREE.Vector3());
    if (n.dot(centre.set(m.x, Math.max(0.5, m.y * 0.6), m.z * 0.7).sub(m).negate()) < 0) n.negate();
    const near = nearestOther(s, cells, m, s.part[e.t]);
    if (near === null || near.d < Math.min(GAP_MIN, STAND_MIN)) continue;
    // Seen from outside: one of three rays off the edge, out of the car, meets nothing.
    const off = m.clone().addScaledVector(n, RAY_START_M);
    const side = b.clone().sub(a).normalize().cross(n).normalize();
    const seen = [n, n.clone().add(side).normalize(), n.clone().sub(side).normalize()].some((d) => !blocked(s, cells, off, d, stamp, ++tick));
    if (!seen) continue;
    const nq = near.n.dot(n) < 0 ? near.n.clone().negate() : near.n;
    const h = m.clone().sub(near.q).dot(nq);
    const lateral = Math.sqrt(Math.max(0, near.d * near.d - h * h));
    const stand = h > STAND_MIN && lateral < h;
    if (!stand && (lateral < GAP_MIN || near.d < GAP_MIN)) continue;
    items.push({ p: m, kind: stand ? "stand" : "gap", mm: stand ? h : near.d, part: s.names[s.part[e.t]], other: s.names[s.part[near.t]], to: near.q, glass: GLASS.has(s.kind[e.t]) });
  }
  return places(items, GAP_PLACE_M).map((g) => {
    const worst = g.reduce((x, y) => (y.mm > x.mm ? y : x));
    const kind = g.filter((x) => x.kind === "stand").length > g.length / 2 ? "stand" : "gap";
    const own = g.filter((x) => x.kind === kind);
    return {
      kind,
      at: worst.p.toArray().map((v) => Math.round(v * 1000) / 1000),
      p: worst.p,
      mm: mm(Math.max(...own.map((x) => x.mm))),
      edges: g.length,
      parts: [...new Set(g.map((x) => `${x.part} / ${x.other}`))].slice(0, 3),
      region: regionOf(worst.p, ctx),
      level: Math.max(...own.map((x) => x.mm)) >= (kind === "stand" ? STAND_MIN : GAP_MIN) * FLAG_BAD ? 2 : 1,
      heights: own.map((x) => x.mm),
      points: own.map((x) => ({ from: x.p, to: x.to })),
    };
  });
}

/** Area (m²) of the convex polygon `poly` ([[u, v], ...]). */
function area(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [a, b] = [poly[i], poly[(i + 1) % poly.length]];
    s += a[0] * b[1] - a[1] * b[0];
  }
  return Math.abs(s) / 2;
}

/** `poly` clipped by the convex counter-clockwise polygon `clip` (Sutherland-Hodgman). */
function clipPoly(poly, clip) {
  let out = poly;
  for (let i = 0; i < clip.length && out.length; i++) {
    const [a, b] = [clip[i], clip[(i + 1) % clip.length]];
    const inside = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    const cross = (p, q) => {
      const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
      const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
      const t = (ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / (ey * dx - ex * dy);
      return [p[0] + t * dx, p[1] + t * dy];
    };
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k++) {
      const [p, q] = [input[k], input[(k + 1) % input.length]];
      if (inside(q)) {
        if (!inside(p)) out.push(cross(p, q));
        out.push(q);
      } else if (inside(p)) out.push(cross(p, q));
    }
  }
  return out;
}

/** Z-fighting places: coplanar triangles overlapping. */
function zFighting(s, cells, ctx) {
  const cos = Math.cos((ZF_ANGLE * Math.PI) / 180);
  const n = s.part.length;
  const normals = new Float64Array(n * 3);
  const areas = new Float64Array(n);
  const T = new THREE.Triangle();
  const v = new THREE.Vector3();
  for (let t = 0; t < n; t++) {
    triangle(s, t, T).getNormal(v);
    normals.set([v.x, v.y, v.z], t * 3);
    areas[t] = T.getArea();
  }
  const done = new Set();
  const items = [];
  const U = new THREE.Triangle();
  const u = new THREE.Vector3();
  const w = new THREE.Vector3();
  for (const list of cells.values()) {
    for (let x = 0; x < list.length; x++) {
      const i = list[x];
      if (areas[i] < 1e-7) continue;
      for (let y = x + 1; y < list.length; y++) {
        const j = list[y];
        if (areas[j] < 1e-7) continue;
        const dot = normals[i * 3] * normals[j * 3] + normals[i * 3 + 1] * normals[j * 3 + 1] + normals[i * 3 + 2] * normals[j * 3 + 2];
        if (dot < cos) continue;
        const k = i < j ? i * n + j : j * n + i;
        if (done.has(k)) continue;
        done.add(k);
        triangle(s, i, T);
        triangle(s, j, U);
        const ni = v.set(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
        const sep = Math.max(...[U.a, U.b, U.c].map((p) => Math.abs(w.subVectors(p, T.a).dot(ni))));
        if (sep > ZF_EPS) continue;
        // In plane i's basis: u along an edge, its normal × u.
        u.subVectors(T.b, T.a).normalize();
        const bv = new THREE.Vector3().crossVectors(ni, u);
        const flat = (p) => [w.subVectors(p, T.a).dot(u), w.subVectors(p, T.a).dot(bv)];
        const P = [T.a, T.b, T.c].map(flat);
        const Q = [U.a, U.b, U.c].map(flat);
        const ccw = (poly) => ((poly[1][0] - poly[0][0]) * (poly[2][1] - poly[0][1]) - (poly[1][1] - poly[0][1]) * (poly[2][0] - poly[0][0]) < 0 ? poly.reverse() : poly);
        const overlap = area(clipPoly(ccw(Q), ccw(P)));
        if (overlap < ZF_AREA) continue;
        items.push({ p: T.getMidpoint(new THREE.Vector3()), area: overlap, sep, parts: [s.part[i], s.part[j]], tris: [i, j], areas: [areas[i], areas[j]], n: ni.clone() });
      }
    }
  }
  return places(items, PLACE_M)
    .map((g) => {
    const total = g.reduce((a, x) => a + x.area, 0);
    const worst = g.reduce((a, x) => (x.area > a.area ? x : a));
    const partSet = [...new Set(g.flatMap((x) => x.parts))];
    const partArea = new Map(partSet.map((p) => [p, 0]));
    for (const x of g) for (const [k, pi] of x.parts.entries()) partArea.set(pi, partArea.get(pi) + x.areas[k]);
    // Each part's triangles in the place, for the depth measure (`offsetNeeded`).
    const tris = new Map(partSet.map((pi) => [pi, new Set()]));
    for (const x of g) for (const [k, pi] of x.parts.entries()) tris.get(pi).add(x.tris[k]);
    return {
      tris,
      partIdx: partSet,
      at: worst.p.toArray().map((c) => Math.round(c * 1000) / 1000),
      p: worst.p,
      areaCm2: r1(total * 1e4),
      sepMm: Math.round(Math.max(...g.map((x) => x.sep)) * 1e5) / 100,
      parts: partSet.map((pi) => s.names[pi]),
      region: regionOf(worst.p, ctx),
      level: total * 1e4 >= 4 ? 2 : 1,
      smaller: partSet.length > 1 ? s.names[[...partArea].sort((a, b) => a[1] - b[1])[0][0]] : null,
      normal: worst.n.toArray().map((c) => Math.round(c * 1000) / 1000),
    };
    })
    .filter((z) => z.areaCm2 >= ZF_PLACE_CM2);
}

/** The material a detail draws with: the lamp units' one draw, the seated parts' one styled draw. */
const MATERIAL_OF = (name) => (name.startsWith("lamp unit") ? "LampBatch draw material (lamp-lights.ts)" : "PartBatch styled draw material (part-batch.ts)");

/**
 * The polygon offset a detail's material needs to show over the panel it fights: the place's own triangles of each, the panel drawn
 * first (`LessEqual`) and the detail after it (`Less`, offset), seen at each of OFFSET_RANGES (m) through the race camera's lens and
 * planes (`depth-probe.ts`: 62°, 0.1-900 m, a 1280 x 800 view), zoomed with a view offset so the place fills the probe's window. The
 * offset is tried up depth-probe's two ladders, alone: `factor` (pixels of the detail's depth slope, `polygonOffsetFactor`, scaled
 * back to the game's pixel) and `units` (24-bit depth steps, `polygonOffsetUnits`). Per range, the smallest that shows the detail on
 * 95 % of its own pixels (`crossing`), or null past the ladder.
 */
function offsetNeeded(probe, s, z, detailIdx, panelIdx) {
  const { port, crossing } = probe;
  // The browser's canvas depth is 24-bit (DEPTH24_STENCIL8); the headless canvas's is 32: draw into a target whose depth three makes
  // DEPTH_COMPONENT24, so a step is the game's.
  const target = new THREE.WebGLRenderTarget(port.W, port.H, { depthBuffer: true, stencilBuffer: false });
  const pixels = new Uint8Array(port.W * port.H * 4);
  const draw = (cam) => {
    port.renderer.setRenderTarget(target);
    port.renderer.setClearColor(0x000000, 1);
    port.renderer.clear();
    port.renderer.render(scene, cam);
    port.renderer.readRenderTargetPixels(target, 0, 0, port.W, port.H, pixels);
    port.renderer.setRenderTarget(null);
    port.renderer.setClearColor(0x000000, 0);
    return pixels;
  };
  const geometry = (set) => {
    const pos = new Float32Array(set.size * 9);
    let k = 0;
    for (const t of set) pos.set(s.tri.subarray(t * 9, t * 9 + 9), 9 * k++);
    return new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3));
  };
  const flat = (rgb, strict) => new THREE.MeshBasicMaterial({ color: rgb, side: THREE.DoubleSide, depthFunc: strict ? THREE.LessDepth : THREE.LessEqualDepth });
  const panel = new THREE.Mesh(geometry(z.tris.get(panelIdx)), flat(0xff0000, false));
  const detail = new THREE.Mesh(geometry(z.tris.get(detailIdx)), flat(0x00ff00, true));
  detail.material.polygonOffset = true;
  detail.renderOrder = 1;
  panel.frustumCulled = detail.frustumCulled = false;
  const scene = new THREE.Scene().add(panel, detail);
  const box = new THREE.Box3().setFromObject(detail);
  const centre = box.getCenter(new THREE.Vector3());
  const size = Math.max(box.getSize(new THREE.Vector3()).length(), 0.01);
  // Seen off its normal by 30°, toward the sky: as a chase or derby camera looks down onto a car's panels.
  const n = new THREE.Vector3().fromArray(z.normal).normalize();
  const view = n.clone().multiplyScalar(Math.cos(Math.PI / 6)).add(new THREE.Vector3(0, 1, 0).projectOnPlane(n).normalize().multiplyScalar(Math.sin(Math.PI / 6))).normalize();
  const share = (cam, mask) => {
    const rgba = draw(cam);
    let shown = 0;
    let all = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      all++;
      if (rgba[i * 4 + 1] > 127) shown++;
    }
    return all ? shown / all : 0;
  };
  const out = OFFSET_RANGES.map((range) => {
    const cam = new THREE.PerspectiveCamera(PROBE_LENS.fov, PROBE_LENS.w / PROBE_LENS.h, PROBE_LENS.near, PROBE_LENS.far);
    cam.position.copy(centre).addScaledVector(view, range);
    cam.lookAt(centre);
    cam.updateMatrixWorld(true);
    // The game's pixel there, and the zoom that makes the place span the probe's window.
    const gamePx = (2 * range * Math.tan((PROBE_LENS.fov * Math.PI) / 360)) / PROBE_LENS.h;
    const zoom = Math.max(1, (0.8 * port.H * gamePx) / size);
    const [W, H] = [PROBE_LENS.w * zoom, PROBE_LENS.h * zoom];
    cam.setViewOffset(W, H, W / 2 - port.W / 2, H / 2 - port.H / 2, port.W, port.H);
    // The detail's own pixels: drawn alone.
    panel.visible = false;
    detail.material.polygonOffsetFactor = detail.material.polygonOffsetUnits = 0;
    const own = draw(cam);
    const mask = new Uint8Array(port.W * port.H);
    for (let i = 0; i < mask.length; i++) mask[i] = own[i * 4 + 1] > 127 ? 1 : 0;
    panel.visible = true;
    // Up the ladder until the detail shows on 95 % of its pixels; past that every rung shows it too.
    const ladder = (values, set) => {
      const out = [];
      for (const v of values) {
        set(v);
        out.push(out.at(-1) >= 0.95 ? 1 : share(cam, mask));
      }
      return out;
    };
    const byFactor = ladder(FACTORS, (v) => {
      detail.material.polygonOffsetFactor = -v;
      detail.material.polygonOffsetUnits = 0;
    });
    const byUnits = ladder(UNITS, (v) => {
      detail.material.polygonOffsetFactor = 0;
      detail.material.polygonOffsetUnits = -v;
    });
    const f = crossing(FACTORS, byFactor, 0.95);
    const u = crossing(UNITS, byUnits, 0.95);
    return { rangeM: range, factor: f === null ? null : Math.round((f / zoom) * 1000) / 1000, units: u === null ? null : Math.round(u), pixels: mask.reduce((a, b) => a + b, 0) };
  });
  target.dispose();
  for (const m of [panel, detail]) {
    m.geometry.dispose();
    m.material.dispose();
  }
  return out;
}

/** The car's exterior defects and the fixes certain enough to suggest; `probe` ({ game, port, crossing }) measures z-fighting's offsets. */
export function defectsOf(stage, style, lift, rearBumper, belt, probe) {
  const car = stage.car;
  const skip = smallFittings(style, rearBumper, lift);
  const s = partsOf(stage, skip);
  const cells = hashOf(s);
  const hubs = car.wheels.map((w) => w.getWorldPosition(new THREE.Vector3()));
  const ctx = { hubs, belt, front: Math.max(...hubs.map((h) => h.z)), rear: Math.min(...hubs.map((h) => h.z)), roofRear: style.roofZ[0], roofFront: style.roofZ[1], wsBase: style.windshield.base[1] };
  const edges = freeEdges(s, cells, ctx);
  const zf = zFighting(s, cells, ctx);
  const suggest = [];
  // A place between exactly one detail (a lamp unit or a seated part) and one panel. Two surfaces in one place (under TRUE_OVERLAP_M
  // apart) are one too many: push the detail out. Apart, its material's polygon offset clears it at every range, measured.
  const detail = (name) => name.startsWith("lamp unit") || EXTERIOR_PARTS.includes(name);
  for (const z of zf) {
    const details = z.partIdx.filter((pi) => detail(s.names[pi]));
    if (z.partIdx.length !== 2 || details.length !== 1) continue;
    const [d, p] = [details[0], z.partIdx.find((pi) => pi !== details[0])];
    const reads = `z-fighting ${z.areaCm2} cm² at ${z.region}, ${z.sepMm} mm apart`;
    if (z.sepMm < TRUE_OVERLAP_M * 1000) {
      suggest.push({ fix: "push out", part: s.names[d], from: s.names[p], mm: 1, along: z.normal, at: z.at, reads, confidence: "high" });
      continue;
    }
    if (!probe) continue;
    const ranges = offsetNeeded(probe, s, z, d, p);
    // Certain only where every range was measured on enough pixels and cleared within the ladder.
    if (ranges.some((r) => r.pixels < OFFSET_MIN_PX || (r.factor === null && r.units === null))) continue;
    // A detail that already shows at every range without an offset fights nowhere it is drawn: nothing to fix.
    if (ranges.every((r) => r.factor === 0 || r.units === 0)) continue;
    const worst = (k) => (ranges.every((r) => r[k] !== null) ? Math.max(...ranges.map((r) => r[k])) : null);
    suggest.push({ fix: "polygonOffset", part: s.names[d], from: s.names[p], material: MATERIAL_OF(s.names[d]), polygonOffsetFactor: worst("factor") === null ? null : -worst("factor"), polygonOffsetUnits: worst("units") === null ? null : -worst("units"), ranges, at: z.at, reads, confidence: "high" });
  }
  const intended = intendedEdges(style, lift);
  for (const e of edges) {
    if (e.kind !== "stand" || e.heights.length < 3) continue;
    const mean = e.heights.reduce((a, b) => a + b, 0) / e.heights.length;
    const spread = Math.max(...e.heights) - Math.min(...e.heights);
    const spoiler = intended.find((x) => x.name === "roof spoiler" && x.box.containsPoint(e.p));
    if (spoiler && spread < 0.25 * mean) {
      const y = style.roof.spoiler.y;
      suggest.push({ fix: "field", field: "roof.spoiler.y", value: [Number((y[0] - mean).toFixed(3)), y[1]], at: e.at, reads: `spoiler stands ${Math.round(mean * 1000)} mm off the roof`, confidence: "high" });
    }
  }
  const strip = (x) => {
    const { p: _p, heights: _h, points: _q, tris: _t, partIdx: _i, ...rest } = x;
    return rest;
  };
  return { gaps: edges.map(strip), zfight: zf.map(strip), suggest, flags: [...edges.map((e) => ({ p: e.p.toArray(), level: e.level, colour: "gap" })), ...zf.map((z) => ({ p: z.p.toArray(), level: z.level, colour: "zfight" }))], skipped: skip.map((f) => f.name) };
}
