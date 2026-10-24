/**
 * The rest-ripple check (geometry only): the drawn panels of an undeformed car, outer and inner skins apart, scored for surface noise
 * a reference does not show. A panel here is a mesh the car draws (hood, boot, each door, the bumpers) or a zone of the body (roof,
 * the rest); each face of it is the car's outer skin or its inner one (the underside, the cabin side), told once on the shut car by
 * whether a ray along its normal leaves the car. Three readings per panel and skin, each over its triangles alone:
 * - `rippleDeg`: at a vertex or one of its neighbours, a convex fold and a concave fold both turning between RIPPLE_MIN_DEG and
 *   RIPPLE_MAX_DEG (the smaller of the two): a smooth panel, even a sharply creased one, folds one way along a line, so a gentle fold
 *   each way side by side is a wave. The panel's worst vertex.
 * - `shadeDeg`: the drawn normal against the normal of the triangles that use that vertex (a normal the surface does not give).
 * - `seamDeg`: at a position drawn twice (a split vertex), the angle between its drawn normals beyond the angle between the faces
 *   there (a shading seam where the surface has none).
 * Flags are the vertices past the mild levels, the panel's worst promoted; each is a ring of its own colour in the shots.
 */
import * as THREE from "three";
import { FITTING_ATTRIBUTE, K, boxOf, deg, r1, surfaceOf } from "./contour-core.mjs";

/** A vertex's weld key: positions equal to 0.01 mm are one vertex. */
const WELD = 1e5;
/** A ray along a face's normal that reaches another panel within this (m) puts the face on the inside. */
const RAY_MAX = 3;
/** A fold smaller than this (degrees) is not a fold; a ripple is one each way at least this big. One past RIPPLE_MAX_DEG is a crisp edge, a design's, and no wave. */
const RIPPLE_MIN_DEG = 3;
const RIPPLE_MAX_DEG = 15;
/** Flag levels (mild, bad), degrees, per reading. */
export const RIPPLE_FLAG = { rippleDeg: [6, 12], shadeDeg: [10, 20], seamDeg: [8, 16] };
/** At most this many flags per panel and skin. */
const FLAGS_PER_SKIN = 12;

/** The meshes of the panels: name and mesh. */
function panelMeshes(car) {
  const look = car.lookMeshes();
  const list = [["hood", look.hood], ["boot", look.trunk], ["doorL", look.doors[0]], ["doorR", look.doors[1]], ["bumperF", look.bumpers[0]], ["bumperR", look.bumpers[1]], ["body", look.body]];
  return list.filter(([, m]) => m?.isMesh);
}

/** A mesh's world positions, drawn normals, triangle corners and merged-fitting mask (`FITTING_ATTRIBUTE`). */
function meshData(mesh) {
  mesh.updateWorldMatrix(true, false);
  const g = mesh.geometry;
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const fitAttr = g.getAttribute(FITTING_ATTRIBUTE);
  const index = g.index;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const v = new THREE.Vector3();
  const p = new Float64Array(pos.count * 3);
  const n = new Float64Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).toArray(p, i * 3);
    v.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize().toArray(n, i * 3);
  }
  const tris = index ? Uint32Array.from({ length: index.count }, (_, k) => index.getX(k)) : Uint32Array.from({ length: pos.count }, (_, k) => k);
  const fit = new Uint8Array(tris.length / 3);
  if (fitAttr) for (let t = 0; t < fit.length; t++) fit[t] = fitAttr.getX(tris[t * 3]) > 0 ? 1 : 0;
  return { p, n, tris, fit };
}

/** Unit normal and area of triangle `t` of `d`, into `out` (x, y, z) and returned (area). */
function faceOf(d, t, out) {
  const [i, j, k] = [d.tris[t * 3] * 3, d.tris[t * 3 + 1] * 3, d.tris[t * 3 + 2] * 3];
  const [ax, ay, az] = [d.p[j] - d.p[i], d.p[j + 1] - d.p[i + 1], d.p[j + 2] - d.p[i + 2]];
  const [bx, by, bz] = [d.p[k] - d.p[i], d.p[k + 1] - d.p[i + 1], d.p[k + 2] - d.p[i + 2]];
  const [cx, cy, cz] = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
  const len = Math.hypot(cx, cy, cz);
  if (len > 0) [out[0], out[1], out[2]] = [cx / len, cy / len, cz / len];
  else out.fill(0);
  return len / 2;
}

/** Distance along the ray (o, dir) to the first of `data`'s triangles it meets from the front within RAY_MAX, skipping triangle `skip` of data[`own`]; Infinity if none. */
function firstHit(o, dir, data, own, skip) {
  let best = Infinity;
  for (const [m, d] of data.entries()) {
    for (let t = 0; t < d.tris.length / 3; t++) {
      if (m === own && t === skip) continue;
      const [i, j, k] = [d.tris[t * 3] * 3, d.tris[t * 3 + 1] * 3, d.tris[t * 3 + 2] * 3];
      const [e1x, e1y, e1z] = [d.p[j] - d.p[i], d.p[j + 1] - d.p[i + 1], d.p[j + 2] - d.p[i + 2]];
      const [e2x, e2y, e2z] = [d.p[k] - d.p[i], d.p[k + 1] - d.p[i + 1], d.p[k + 2] - d.p[i + 2]];
      const [px, py, pz] = [dir[1] * e2z - dir[2] * e2y, dir[2] * e2x - dir[0] * e2z, dir[0] * e2y - dir[1] * e2x];
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const [tx, ty, tz] = [o[0] - d.p[i], o[1] - d.p[i + 1], o[2] - d.p[i + 2]];
      const u = (tx * px + ty * py + tz * pz) / det;
      if (u < 0 || u > 1) continue;
      const [qx, qy, qz] = [ty * e1z - tz * e1y, tz * e1x - tx * e1z, tx * e1y - ty * e1x];
      const w = (dir[0] * qx + dir[1] * qy + dir[2] * qz) / det;
      if (w < 0 || u + w > 1) continue;
      const dist = (e2x * qx + e2y * qy + e2z * qz) / det;
      if (dist > 0 && dist < best && dist < RAY_MAX) best = dist;
    }
  }
  return best;
}

/**
 * The shut car's panels with each triangle's skin (`inner`: 0 outer, 1 inner) and zone (the body's roof: over its side glass's top).
 * Call it on the car as built, before any pose.
 */
export function panelsOf(car) {
  const roofY = boxOf(surfaceOf(car), [K.side]).max.y;
  const meshes = panelMeshes(car);
  const data = meshes.map(([, m]) => meshData(m));
  const n = [0, 0, 0];
  const panels = [];
  for (const [m, [name, mesh]] of meshes.entries()) {
    const d = data[m];
    const count = d.tris.length / 3;
    const inner = new Uint8Array(count);
    const zone = new Uint8Array(count);
    for (let t = 0; t < count; t++) {
      if (d.fit[t]) continue;
      faceOf(d, t, n);
      const [i, j, k] = [d.tris[t * 3] * 3, d.tris[t * 3 + 1] * 3, d.tris[t * 3 + 2] * 3];
      const c = [(d.p[i] + d.p[j] + d.p[k]) / 3, (d.p[i + 1] + d.p[j + 1] + d.p[k + 1]) / 3, (d.p[i + 2] + d.p[j + 2] + d.p[k + 2]) / 3];
      const o = [c[0] + n[0] * 1e-4, c[1] + n[1] * 1e-4, c[2] + n[2] * 1e-4];
      inner[t] = Number.isFinite(firstHit(o, n, data, m, t)) ? 1 : 0;
      zone[t] = name === "body" && c[1] > roofY ? 1 : 0;
    }
    panels.push({ name, mesh, inner, zone });
  }
  return panels;
}

const angleOf = (a, b) => deg(Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))));

/** The readings of the triangles `keep` selects of mesh data `d` (`fan`: every triangle of the same skin, in the zone or not; `other` selects the other skin's; `hidden`: the skin is the inner one): `{ripple, shade, seam}` each `{deg, at: [x, y, z]}` at its worst vertex (null where none), the flags and the vertex count. */
function readSkin(d, keep, fan, other, hidden) {
  const vert = d.p.length / 3;
  const tris = [];
  const fanTris = [];
  for (let t = 0; t < keep.length; t++) {
    if (keep[t]) tris.push(t);
    if (fan[t]) fanTris.push(t);
  }
  const fn = new Float64Array(keep.length * 3);
  const fa = new Float64Array(keep.length);
  const f = [0, 0, 0];
  for (const t of fanTris) {
    fa[t] = faceOf(d, t, f);
    fn.set(f, t * 3);
  }
  // Drawn normal against the triangles that use the vertex: the skin's whole fan there, so a vertex on a zone's edge is not read against half its faces.
  const sum = new Float64Array(vert * 3);
  const used = new Uint8Array(vert);
  for (const t of fanTris) {
    for (let c = 0; c < 3; c++) {
      const i = d.tris[t * 3 + c];
      for (let a = 0; a < 3; a++) sum[i * 3 + a] += fn[t * 3 + a] * fa[t];
    }
  }
  for (const t of tris) for (let c = 0; c < 3; c++) used[d.tris[t * 3 + c]] = 1;
  // A vertex the other skin uses too (a rim, a window edge) has one drawn normal for both: not read.
  const shared = new Uint8Array(vert);
  for (let t = 0; t < other.length; t++) if (other[t]) for (let c = 0; c < 3; c++) shared[d.tris[t * 3 + c]] = 1;
  const shade = { deg: 0, at: null };
  const flags = [];
  const point = (i) => [d.p[i * 3], d.p[i * 3 + 1], d.p[i * 3 + 2]];
  for (let i = 0; i < vert; i++) {
    if (!used[i] || shared[i]) continue;
    const len = Math.hypot(sum[i * 3], sum[i * 3 + 1], sum[i * 3 + 2]);
    if (len === 0) continue;
    const ang = angleOf([sum[i * 3] / len, sum[i * 3 + 1] / len, sum[i * 3 + 2] / len], [d.n[i * 3], d.n[i * 3 + 1], d.n[i * 3 + 2]]);
    if (ang >= RIPPLE_FLAG.shadeDeg[0]) flags.push({ kind: "shade", deg: ang, p: point(i) });
    if (ang > shade.deg) Object.assign(shade, { deg: ang, at: point(i) });
  }
  // Welded vertices, their faces and edges.
  const weld = new Int32Array(vert).fill(-1);
  const byKey = new Map();
  const wp = [];
  for (let i = 0; i < vert; i++) {
    if (!used[i]) continue;
    const key = `${Math.round(d.p[i * 3] * WELD)},${Math.round(d.p[i * 3 + 1] * WELD)},${Math.round(d.p[i * 3 + 2] * WELD)}`;
    let w = byKey.get(key);
    if (w === undefined) {
      w = wp.length;
      byKey.set(key, w);
      wp.push(point(i));
    }
    weld[i] = w;
  }
  const faces = wp.map(() => []);
  const indices = wp.map(() => new Set());
  const edges = new Map();
  for (const t of tris) {
    const ws = [0, 1, 2].map((c) => weld[d.tris[t * 3 + c]]);
    if (new Set(ws).size < 3) continue;
    for (let c = 0; c < 3; c++) {
      faces[ws[c]].push(t);
      indices[ws[c]].add(d.tris[t * 3 + c]);
      const [a, b] = [ws[c], ws[(c + 1) % 3]];
      const key = a < b ? a * 1e7 + b : b * 1e7 + a;
      let e = edges.get(key);
      if (!e) edges.set(key, (e = { a: Math.min(a, b), b: Math.max(a, b), tris: [] }));
      e.tris.push(t);
    }
  }
  // A seam: split drawn normals the faces round the position do not account for. On the hidden skin a vertex the outer skin uses too is drawn
  // by the outer faces (its normal is theirs, as for shade): not read there.
  const seam = { deg: 0, at: null };
  for (const [w, set] of indices.entries()) {
    const ids = [...set].filter((id) => !(hidden && shared[id]));
    if (ids.length < 2) continue;
    let jump = 0;
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) jump = Math.max(jump, angleOf([d.n[ids[a] * 3], d.n[ids[a] * 3 + 1], d.n[ids[a] * 3 + 2]], [d.n[ids[b] * 3], d.n[ids[b] * 3 + 1], d.n[ids[b] * 3 + 2]]));
    }
    let spread = 0;
    for (let a = 0; a < faces[w].length; a++) {
      for (let b = a + 1; b < faces[w].length; b++) {
        const [ta, tb] = [faces[w][a], faces[w][b]];
        spread = Math.max(spread, angleOf([fn[ta * 3], fn[ta * 3 + 1], fn[ta * 3 + 2]], [fn[tb * 3], fn[tb * 3 + 1], fn[tb * 3 + 2]]));
      }
    }
    const ang = jump - spread;
    if (ang >= RIPPLE_FLAG.seamDeg[0]) flags.push({ kind: "seam", deg: ang, p: wp[w] });
    if (ang > seam.deg) Object.assign(seam, { deg: ang, at: wp[w] });
  }
  // Folds: each interior edge's turn between its two faces, convex (+) or concave (-) seen from outside.
  const convex = new Float64Array(wp.length);
  const concave = new Float64Array(wp.length);
  const near = wp.map(() => []);
  for (const e of edges.values()) {
    near[e.a].push(e.b);
    near[e.b].push(e.a);
    if (e.tris.length !== 2) continue;
    const [ta, tb] = e.tris;
    const turn = angleOf([fn[ta * 3], fn[ta * 3 + 1], fn[ta * 3 + 2]], [fn[tb * 3], fn[tb * 3 + 1], fn[tb * 3 + 2]]);
    if (turn < RIPPLE_MIN_DEG || turn > RIPPLE_MAX_DEG) continue;
    // The far corner of face b from the edge: below face a's plane seen from outside is a convex fold.
    let far = null;
    for (let c = 0; c < 3; c++) {
      const w = weld[d.tris[tb * 3 + c]];
      if (w !== e.a && w !== e.b) far = wp[w];
    }
    const side = (far[0] - wp[e.a][0]) * fn[ta * 3] + (far[1] - wp[e.a][1]) * fn[ta * 3 + 1] + (far[2] - wp[e.a][2]) * fn[ta * 3 + 2];
    const arr = side < 0 ? convex : concave;
    for (const w of [e.a, e.b]) arr[w] = Math.max(arr[w], turn);
  }
  const ripple = { deg: 0, at: null };
  for (let w = 0; w < wp.length; w++) {
    let [up, down] = [convex[w], concave[w]];
    for (const u of near[w]) [up, down] = [Math.max(up, convex[u]), Math.max(down, concave[u])];
    const ang = Math.min(up, down);
    if (ang >= RIPPLE_FLAG.rippleDeg[0]) flags.push({ kind: "ripple", deg: ang, p: wp[w] });
    if (ang > ripple.deg) Object.assign(ripple, { deg: ang, at: wp[w] });
  }
  return { ripple, shade, seam, flags, verts: wp.length, tris: tris.length };
}

/**
 * The panels' rest-ripple readings on the car as it is now (shut, or posed open: `panelsOf` reads the shut car's skins and zones):
 * `{panels: {name: {outer, inner}}, flags}`; each skin `{verts, rippleDeg, shadeDeg, seamDeg}`, a flag `{p, level, score, colour: "ripple", panel, skin, kind}`.
 */
export function ripplesOf(panels) {
  const out = {};
  const flags = [];
  for (const panel of panels) {
    const d = meshData(panel.mesh);
    const zones = panel.name === "body" ? [["body", 0], ["roof", 1]] : [[panel.name, null]];
    for (const [name, zone] of zones) {
      out[name] = {};
      for (const [skin, inner] of [["outer", 0], ["inner", 1]]) {
        const keep = new Uint8Array(panel.inner.length);
        for (let t = 0; t < keep.length; t++) keep[t] = !d.fit[t] && panel.inner[t] === inner && (zone === null || panel.zone[t] === zone) ? 1 : 0;
        const fan = new Uint8Array(keep.length);
        for (let t = 0; t < fan.length; t++) fan[t] = !d.fit[t] && panel.inner[t] === inner ? 1 : 0;
        const other = new Uint8Array(keep.length);
        for (let t = 0; t < other.length; t++) other[t] = !d.fit[t] && panel.inner[t] !== inner ? 1 : 0;
        const r = readSkin(d, keep, fan, other, inner === 1);
        const count = (kind) => r.flags.filter((f) => f.kind === kind).length;
        out[name][skin] = { verts: r.verts, rippleDeg: r1(r.ripple.deg), rippleN: count("ripple"), shadeDeg: r1(r.shade.deg), shadeN: count("shade"), seamDeg: r1(r.seam.deg), seamN: count("seam") };
        const mine = r.flags.map((f) => ({ p: f.p, level: f.deg >= RIPPLE_FLAG[`${f.kind}Deg`][1] ? 2 : 1, score: f.deg, colour: "ripple", panel: name, skin, kind: f.kind }));
        mine.sort((a, b) => b.score - a.score);
        if (mine.length) mine[0] = { ...mine[0], level: 3 };
        flags.push(...mine.slice(0, FLAGS_PER_SKIN));
      }
    }
  }
  return { panels: out, flags };
}
