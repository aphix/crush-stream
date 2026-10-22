/**
 * Surface contour diagnostics' shared core (geometry only, never airflow): the built car's drawn surface as world triangles with
 * their mesh kinds, exact plane cuts of it, the per-style intended edges a score leaves alone, the cool-to-warm turn colours and the
 * three-quarter camera the shots use. `contour-sections.mjs`, `contour-ribbons.mjs` and `contour-zebra.mjs` build on it.
 */
import * as THREE from "three";

/** Mesh kinds of the surface: glass (windshield, rear, side), trim and bumper tell seams from turns. */
export const K = { body: 0, windshield: 1, rear: 2, side: 3, trim: 4, bumper: 5 };
export const GLASS = new Set([K.windshield, K.rear, K.side]);

export const deg = (r) => (r * 180) / Math.PI;
export const r1 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
export const mm = (m) => (m === null || m === undefined ? null : Math.round(m * 1000));

/** The car's drawn surface as world triangles (9 floats each) with their mesh kind. */
export function surfaceOf(car) {
  car.group.updateMatrixWorld(true);
  const look = car.lookMeshes();
  const meshes = [];
  const shown = (o) => {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  const add = (mesh, kind) => {
    if (mesh?.isMesh && shown(mesh) && !meshes.some(([m]) => m === mesh)) meshes.push([mesh, kind]);
  };
  for (const pane of car.glassPanes) add(pane.mesh, pane.name === "windshield" ? K.windshield : pane.name === "rear" ? K.rear : K.side);
  for (const m of look.bumpers) add(m, K.bumper);
  add(look.body, K.body);
  add(look.hood, K.body);
  add(look.trunk, K.body);
  for (const m of look.doors) add(m, K.body);
  car.group.traverse((o) => {
    if (o.isMesh && o.name === "windowTrim") add(o, K.trim);
  });
  const tris = [];
  const kinds = [];
  const v = new THREE.Vector3();
  for (const [mesh, kind] of meshes) {
    const pos = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.index;
    const n = index ? index.count : pos.count;
    for (let t = 0; t + 2 < n; t += 3) {
      for (let c = 0; c < 3; c++) {
        v.fromBufferAttribute(pos, index ? index.getX(t + c) : t + c).applyMatrix4(mesh.matrixWorld);
        tris.push(v.x, v.y, v.z);
      }
      kinds.push(kind);
    }
  }
  return { tri: Float64Array.from(tris), kind: Uint8Array.from(kinds) };
}

/** The box (world) of the surface's triangles of `kinds`, optionally only those with z on one side (`zSign`). */
export function boxOf(s, kinds, zSign = 0) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let t = 0; t < s.kind.length; t++) {
    if (!kinds.includes(s.kind[t])) continue;
    for (let c = 0; c < 3; c++) {
      v.fromArray(s.tri, t * 9 + c * 3);
      if (zSign === 0 || Math.sign(v.z) === zSign) box.expandByPoint(v);
    }
  }
  return box;
}

/** In-plane axes per cut axis: x cuts read (z, y), y cuts (x, z), z cuts (x, y). */
export const PLANE = { 0: [2, 1], 1: [0, 2], 2: [0, 1] };

/** Every triangle cut by the plane `axis` = `value`: segments [u0, v0, u1, v1] in the plane's axes, and each one's mesh kind. */
export function cut(s, axis, value) {
  const [ui, vi] = PLANE[axis];
  const seg = [];
  const kind = [];
  const d = [0, 0, 0];
  for (let t = 0; t < s.kind.length; t++) {
    const o = t * 9;
    for (let c = 0; c < 3; c++) d[c] = s.tri[o + c * 3 + axis] - value || 1e-12;
    if ((d[0] > 0 && d[1] > 0 && d[2] > 0) || (d[0] < 0 && d[1] < 0 && d[2] < 0)) continue;
    const pts = [];
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      if (d[a] * d[b] >= 0) continue;
      const k = d[a] / (d[a] - d[b]);
      const pa = o + a * 3;
      const pb = o + b * 3;
      pts.push(s.tri[pa + ui] + k * (s.tri[pb + ui] - s.tri[pa + ui]), s.tri[pa + vi] + k * (s.tri[pb + vi] - s.tri[pa + vi]));
    }
    if (pts.length !== 4) continue;
    seg.push(...pts);
    kind.push(s.kind[t]);
  }
  return { seg: Float64Array.from(seg), kind: Uint8Array.from(kind) };
}

/** A sample's world point from a cut on `axis` at `value` (its in-plane `u`, `v`). */
export function world(axis, value, s) {
  const p = [0, 0, 0];
  const [ui, vi] = PLANE[axis];
  p[axis] = value;
  p[ui] = s.u;
  p[vi] = s.v;
  return p;
}

/** Margin (m) round an intended edge's box: its own rounding and the cuts' spacing. */
const INTENDED_MARGIN = 0.03;

/**
 * The style's intended edges, as world boxes a score leaves alone: crisp on purpose, not lumps. From the style's own data: the roof
 * spoiler (`roof.spoiler`: its z and y span, its half-width) and the roof rails (`roof.rails`: their x and z span, standing on the
 * roof). Each `{ name, box }`.
 */
export function intendedEdges(style, lift) {
  const out = [];
  const m = INTENDED_MARGIN;
  const spoiler = style.roof?.spoiler;
  if (spoiler) {
    out.push({ name: "roof spoiler", box: new THREE.Box3(new THREE.Vector3(-spoiler.halfWidth - m, spoiler.y[0] + lift - 0.08, spoiler.z[0] - m), new THREE.Vector3(spoiler.halfWidth + m, spoiler.y[1] + lift + m, spoiler.z[1] + m)) });
  }
  const rails = style.roof?.rails;
  if (rails) {
    for (const side of [1, -1]) {
      const [x0, x1] = [side * rails.x[0], side * rails.x[1]].sort((a, b) => a - b);
      out.push({ name: "roof rails", box: new THREE.Box3(new THREE.Vector3(x0 - m, -Infinity, rails.z[0] - m), new THREE.Vector3(x1 + m, Infinity, rails.z[1] + m)) });
    }
  }
  return out;
}

/** The name of the intended edge world point `p` ([x, y, z]) lies on, or null. */
export function intendedAt(edges, p) {
  for (const e of edges) if (e.box.containsPoint(_p.fromArray(p))) return e.name;
  return null;
}
const _p = new THREE.Vector3();

/**
 * The style's small fittings, which no score reads (owner: they are fine): world boxes from its data and the rear bumper's box. Each
 * `{ name, box }`. Listed here alone.
 */
export function smallFittings(style, rearBumper, lift) {
  const out = [];
  if (rearBumper.isEmpty()) return out;
  const z0 = rearBumper.min.z - 0.3;
  const z1 = rearBumper.min.z + 0.12;
  const ex = style.exhaust;
  if (ex) {
    const [w, h] = ex.size;
    for (const x of ex.tips === 2 ? [-ex.x, ex.x] : [ex.x]) {
      out.push({ name: "exhaust tip", box: new THREE.Box3(new THREE.Vector3(x - w / 2 - 0.015, ex.y + lift - h / 2 - 0.015, z0), new THREE.Vector3(x + w / 2 + 0.015, ex.y + lift + h / 2 + 0.015, z1)) });
    }
  }
  if (style.bumpers.rear.hitch) {
    out.push({ name: "tow hitch", box: new THREE.Box3(new THREE.Vector3(-0.07, rearBumper.min.y - 0.12, z0), new THREE.Vector3(0.07, rearBumper.min.y + 0.1, z1)) });
  }
  return out;
}

/** `s` without the triangles whose middle is in one of `boxes` (`smallFittings`). */
export function dropBoxes(s, boxes) {
  if (!boxes.length) return s;
  const keep = [];
  for (let t = 0; t < s.kind.length; t++) {
    const o = t * 9;
    _p.set((s.tri[o] + s.tri[o + 3] + s.tri[o + 6]) / 3, (s.tri[o + 1] + s.tri[o + 4] + s.tri[o + 7]) / 3, (s.tri[o + 2] + s.tri[o + 5] + s.tri[o + 8]) / 3);
    if (!boxes.some((b) => b.box.containsPoint(_p))) keep.push(t);
  }
  const tri = new Float64Array(keep.length * 9);
  for (const [i, t] of keep.entries()) tri.set(s.tri.subarray(t * 9, t * 9 + 9), i * 9);
  return { tri, kind: Uint8Array.from(keep, (t) => s.kind[t]) };
}

/** A sample's colour: glass blue, trim dark, an unscored body sample grey, a scored one cool (0°) to warm (60° and over) by its turn. */
export function sampleColour(p) {
  if (GLASS.has(p.kind)) return "rgb(70,130,200)";
  if (p.kind === K.trim) return "rgb(50,50,50)";
  if (p.turn === null || p.turn === undefined) return "rgb(160,160,160)";
  return turnColour(p.turn);
}

/** Cool (0°) to warm (60° and over). */
export function turnColour(turn) {
  const t = Math.min(1, turn / 60);
  const stops = [[40, 90, 255], [0, 190, 120], [240, 200, 0], [230, 20, 20]];
  const k = Math.min(2, Math.floor(t * 3));
  const f = t * 3 - k;
  const c = stops[k].map((a, i) => Math.round(a + f * (stops[k + 1][i] - a)));
  return `rgb(${c.join(",")})`;
}

/** A perspective camera on the car's left three-quarters, from behind (`rear`) or ahead, a little above the roof. */
export function threeQuarter(box, rear, W, H) {
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(24, W / H, 0.1, 100);
  const d = size.z * 1.55;
  cam.position.set(c.x + d * 0.55, c.y + size.y * 1.3, c.z + (rear ? -1 : 1) * d * 0.8);
  cam.lookAt(c.x, c.y - size.y * 0.1, c.z);
  cam.updateMatrixWorld(true);
  return cam;
}

/** `canvases` stacked top to bottom on one white canvas. */
export function stackCanvases(game, canvases) {
  const W = Math.max(...canvases.map((p) => p.width));
  const H = canvases.reduce((a, p) => a + p.height + 6, 0);
  const sheet = game.createCanvas(W, H);
  const ctx = sheet.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  let y = 0;
  for (const p of canvases) {
    ctx.drawImage(p, 0, y);
    y += p.height + 6;
  }
  return sheet;
}
