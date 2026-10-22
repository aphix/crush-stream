#!/usr/bin/env node
/**
 * Surface contour sections (geometry only, never airflow): the built car's drawn meshes cut by planes at fixed stations, scored per
 * region the owner marks (roof edge, A-pillar, rear pillar, rear bumper, lower lip), never as one smoothness score.
 *
 *   CAP=4G /home/aphix/crash-wt/slot-run /home/aphix/crash-wt/capped node --disable-warning=ExperimentalWarning \
 *     scripts/contour-sections.mjs --root <tree> --car <style> [--png <out.png>]
 *   ... scripts/contour-sections.mjs --root <tree> --all --sheet <out.png>     (every style: one JSON line each, one sheet)
 *
 * The surface: the body, lids, door skins, bumpers, glass panes and window trim as drawn (`lookMeshes`, `glassPanes`); no wheels,
 * lamps, mirrors or other batched parts. Each station cuts every triangle with a plane (exact, no renderer) and a fan of rays in that
 * plane, from outside toward a centre, keeps the outermost hit: the section's outer contour, a raw sample every 0.25°, never smoothed.
 * A ray that hits nothing is a miss and splits the contour; so does a jump over STEP_M between neighbouring hits (a ledge or an
 * overhang the fan cannot see under), whose length is reported as a step.
 *
 * `turn`: the direction change (degrees) across ARC_M of contour centred on a sample (the chords to the samples ARC_M/2 behind and ahead):
 * a corner of radius r turns ARC_M / r radians there, so 45° is a radius of about 5 cm and 25° about 9 cm. A window that crosses a
 * mesh change (glass to body, bumper to body: a seam or an intended crisp edge) is not scored.
 *
 * Regions and what each number catches:
 * - roofEdge (cuts across the roof at 25/50/75 % of `roofZ` and along it at 0, ±20 % and ±32 % of the body's width; the body
 *   above the side glass's top): `turnAcross` the hardest shoulder roll, `turnAlong` the hardest roof end, `ledgeMm` the largest
 *   step above the side glass (a roof cap overhanging what is under it), `shelfMm` how far the roof skin stands out past the side
 *   glass top below it, `crownMm` the roof's rise from 70 % of its half-width to the centre.
 * - aPillar / rearPillar (horizontal cuts at six heights through the side glass): the body run between the windshield (rear glass)
 *   and the side glass, each side. `widthMm` per height (the visible band, arc length glass edge to glass edge), `spreadPct` its
 *   (max − min) / median (a swollen or pinched band), `jumpMm` the largest change between neighbouring heights, `leanDeg` the band's
 *   lean from vertical, `turn` the hardest facet inside the band.
 * - bumper / lowerLip (horizontal cuts through the rear bumper's height: 35-80 % and its bottom 4-22 %; the contour behind the rear
 *   arch): `turn` the squarest wrap corner, `projSpreadMm` how much the bumper's outset over the face above it (the tail panel for
 *   the bumper, the bumper's middle for the lip) changes round the wrap (5th to 95th percentile of the rays), `stepMm` the largest
 *   change between neighbouring heights' contours.
 *
 * Prints one JSON line per car. `--curves <png>`: every car's section curves, raw samples coloured by turn. `--png`: the car in game
 * shading from the rear and the front three-quarters (its left side), rings at the flagged samples: yellow mild, orange bad, red the
 * region's worst; scores under it. `--sheet`: every car's panel and its section curves, stacked.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import * as THREE from "three";
import { CarStage, ViewPort, openGame } from "./trace-core.mjs";

/** Mesh kinds of the surface: glass (windshield, rear, side), trim and bumper tell seams from turns. */
const K = { body: 0, windshield: 1, rear: 2, side: 3, trim: 4, bumper: 5 };
const GLASS = new Set([K.windshield, K.rear, K.side]);
/** Fan ray spacing (degrees), the turn window (m) and the neighbour jump (m) that splits a contour as a step. */
const FAN_STEP = 0.25;
const ARC_M = 0.04;
const STEP_M = 0.05;
/** A pillar band wider than this (m) is not a pillar: the cut missed a glass edge at that height. */
const BAND_MAX_M = 0.6;
/** Flag levels: a turn this many degrees is mild, then bad; a pillar band this much over its median width (share) likewise. */
const TURN_FLAG = [25, 45];
const WIDTH_FLAG = [0.15, 0.3];
/** Stations: roof cuts along `roofZ`, pillar heights through the side glass, bumper and lip heights through the rear bumper. */
const ROOF_AT = [0.25, 0.5, 0.75];
/** Lengthwise roof cuts at these shares of the body's width off the centre line. */
const ROOF_ALONG = [0, 0.2, -0.2, 0.32, -0.32];
const PILLAR_AT = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9];
const BUMPER_AT = [0.35, 0.5, 0.65, 0.8];
const LIP_AT = [0.04, 0.1, 0.16, 0.22];
/** The tail panel's cut stands this far (m) over the bumper's top: the bumper's outset is measured from it. */
const TAIL_ABOVE = 0.05;
/** Neutral paint for the screenshots: the rings stand out on it. */
const PAINT = 0xa4a8ae;
const SHOT = [900, 560];
const RING = { 1: "rgba(255,220,0,0.9)", 2: "rgba(255,140,0,0.95)", 3: "rgba(230,20,20,1)" };

const deg = (r) => (r * 180) / Math.PI;
const r1 = (x) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const mm = (m) => (m === null ? null : Math.round(m * 1000));

/** The car's drawn surface as world triangles (9 floats each) with their mesh kind. */
function surfaceOf(car) {
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
function boxOf(s, kinds, zSign = 0) {
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
const PLANE = { 0: [2, 1], 1: [0, 2], 2: [0, 1] };

/** Every triangle cut by the plane `axis` = `value`: segments [u0, v0, u1, v1] in the plane's axes, and each one's mesh kind. */
function cut(s, axis, value) {
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

/**
 * Rays in the cut's plane from `R` m out toward (cu, cv), one every FAN_STEP degrees from `a0` to `a1`: each sample the outermost hit
 * along its ray ({ a, u, v, kind }) or a miss ({ a, miss: true }), in sweep order.
 */
function fan(c, cu, cv, R, a0, a1) {
  const out = [];
  const n = Math.round(Math.abs(a1 - a0) / FAN_STEP);
  const dir = Math.sign(a1 - a0);
  for (let i = 0; i <= n; i++) {
    const a = a0 + dir * i * FAN_STEP;
    const ca = Math.cos((a * Math.PI) / 180);
    const sa = Math.sin((a * Math.PI) / 180);
    const [ou, ov, du, dv] = [cu + R * ca, cv + R * sa, -ca, -sa];
    let best = Infinity;
    let hit = -1;
    for (let k = 0; k < c.kind.length; k++) {
      const [pu, pv, qu, qv] = [c.seg[k * 4], c.seg[k * 4 + 1], c.seg[k * 4 + 2], c.seg[k * 4 + 3]];
      const [eu, ev] = [qu - pu, qv - pv];
      const den = du * ev - dv * eu;
      if (Math.abs(den) < 1e-15) continue;
      const [wu, wv] = [pu - ou, pv - ov];
      const t = (wu * ev - wv * eu) / den;
      const sk = (wu * dv - wv * du) / den;
      if (t > 0 && t < best && sk >= 0 && sk <= 1) {
        best = t;
        hit = k;
      }
    }
    out.push(hit < 0 ? { a, miss: true } : { a, u: ou + best * du, v: ov + best * dv, r: R - best, kind: c.kind[hit] });
  }
  return out;
}

/** The fan's samples split into runs at misses and at jumps over STEP_M; `steps` each jump ({ len m, a, b: the samples either side }). */
function runsOf(samples) {
  const runs = [];
  const steps = [];
  let run = [];
  for (const s of samples) {
    if (s.miss) {
      if (run.length) runs.push(run);
      run = [];
      continue;
    }
    const last = run.at(-1);
    if (last && Math.hypot(s.u - last.u, s.v - last.v) > STEP_M) {
      steps.push({ len: Math.hypot(s.u - last.u, s.v - last.v), a: last, b: s });
      runs.push(run);
      run = [];
    }
    run.push(s);
  }
  if (run.length) runs.push(run);
  return { runs, steps };
}

/** Each run sample's `turn` (degrees across ARC_M, the chords to the samples ARC_M/2 behind and ahead), null at a run's ends or across a mesh change. */
function scoreTurns(run) {
  const cum = [0];
  for (let i = 1; i < run.length; i++) cum.push(cum[i - 1] + Math.hypot(run[i].u - run[i - 1].u, run[i].v - run[i - 1].v));
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < run.length; i++) {
    while (lo < i && cum[i] - cum[lo + 1] >= ARC_M / 2) lo++;
    while (hi < run.length - 1 && cum[hi] - cum[i] < ARC_M / 2) hi++;
    run[i].turn = null;
    if (cum[i] - cum[lo] < ARC_M / 2 || cum[hi] - cum[i] < ARC_M / 2) continue;
    let same = true;
    for (let k = lo; k <= hi && same; k++) same = run[k].kind === run[i].kind;
    if (!same) continue;
    const [au, av] = [run[i].u - run[lo].u, run[i].v - run[lo].v];
    const [bu, bv] = [run[hi].u - run[i].u, run[hi].v - run[i].v];
    run[i].turn = deg(Math.acos(Math.max(-1, Math.min(1, (au * bu + av * bv) / (Math.hypot(au, av) * Math.hypot(bu, bv))))));
  }
  return run;
}

/** A sample's world point from a cut on `axis` at `value`. */
function world(axis, value, s) {
  const p = [0, 0, 0];
  const [ui, vi] = PLANE[axis];
  p[axis] = value;
  p[ui] = s.u;
  p[vi] = s.v;
  return p;
}

/** Flags at the scored samples of one region: each sample at or over the mild turn, the worst as level 3. */
function turnFlags(samples, axis, value) {
  return samples.filter((s) => s.turn !== null && s.turn >= TURN_FLAG[0]).map((s) => ({ p: world(axis, value, s), level: s.turn >= TURN_FLAG[1] ? 2 : 1, score: s.turn }));
}

/** The flags of a region with its worst promoted to level 3, at most `cap` of them. */
function worstOf(flags, cap = 40) {
  if (!flags.length) return flags;
  const sorted = [...flags].sort((a, b) => b.score - a.score);
  sorted[0] = { ...sorted[0], level: 3 };
  return sorted.slice(0, cap);
}

function maxOf(values) {
  const v = values.filter((x) => x !== null && Number.isFinite(x));
  return v.length ? Math.max(...v) : null;
}

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
}

/**
 * Roof edge: transverse cuts through the roof (the contour above the side glass top) and lengthwise cuts down the roof's middle and
 * over its shoulders (its front and rear ends where it meets the glass or a cab wall). A ledge is a step in a contour above the side
 * glass top: the fan passing under a roof cap that overhangs what is below it.
 */
function roofEdge(s, style, belt, glassTop, width) {
  const [zr, zf] = style.roofZ;
  const flags = [];
  const turns = [];
  const shelves = [];
  const crowns = [];
  const ledges = [];
  const curves = [];
  const scoreCut = (axis, value, cu, cv, label, group) => {
    const samples = fan(cut(s, axis, value), cu, cv, 3, 0, 180);
    const { runs, steps } = runsOf(samples);
    for (const run of runs) scoreTurns(run);
    // The roof: body above the side glass top; lengthwise, within a quarter metre of the roof's ends.
    const roof = samples.filter((p) => !p.miss && !GLASS.has(p.kind) && p.kind !== K.trim && p.v > glassTop - 0.03 && (axis === 2 || (p.u > zr - 0.25 && p.u < zf + 0.25)));
    const region = roof.filter((p) => p.turn !== null);
    turns.push({ axis, turn: maxOf(region.map((p) => p.turn)) });
    flags.push(...turnFlags(region, axis, value));
    for (const st of steps) if (st.a.v > glassTop - 0.1 && st.b.v > glassTop - 0.1) ledges.push({ len: st.len, p: world(axis, value, st.a) });
    curves.push({ group, axis, label, samples });
    return { samples, roof };
  };
  for (const f of ROOF_AT) {
    const z = zr + f * (zf - zr);
    const { samples, roof } = scoreCut(2, z, 0, belt, `z ${z.toFixed(2)}`, "roof across");
    const hits = samples.filter((p) => !p.miss);
    for (const side of [1, -1]) {
      const own = roof.filter((p) => Math.sign(p.u) === side || Math.abs(p.u) < 0.02);
      if (!own.length) continue;
      const outer = Math.max(...own.map((p) => side * p.u));
      const glass = hits.filter((p) => p.kind === K.side && Math.sign(p.u) === side);
      if (glass.length) {
        const top = glass.reduce((a, p) => (p.v > a.v ? p : a));
        shelves.push(outer - side * top.u);
      }
      const centre = own.reduce((a, p) => (Math.abs(p.u) < Math.abs(a.u) ? p : a));
      const at = own.reduce((a, p) => (Math.abs(side * p.u - 0.7 * outer) < Math.abs(side * a.u - 0.7 * outer) ? p : a));
      crowns.push(centre.v - at.v);
    }
  }
  for (const f of ROOF_ALONG) scoreCut(0, f * width, (zr + zf) / 2, belt, `x ${(f * width).toFixed(2)}`, "roof along");
  const ledge = ledges.reduce((a, st) => (a === null || st.len > a.len ? st : a), null);
  if (ledge) flags.push({ p: ledge.p, level: ledge.len >= 0.08 ? 2 : 1, score: 300 + ledge.len * 1000 });
  return {
    score: {
      turnAcross: r1(maxOf(turns.filter((t) => t.axis === 2).map((t) => t.turn))),
      turnAlong: r1(maxOf(turns.filter((t) => t.axis === 0).map((t) => t.turn))),
      turnPerCut: turns.map((t) => r1(t.turn)),
      ledgeMm: mm(ledge?.len ?? 0),
      shelfMm: mm(maxOf(shelves)),
      crownMm: mm(crowns.length ? Math.min(...crowns) : null),
    },
    flags: worstOf(flags),
    curves,
  };
}

/** Pillars: horizontal cuts through the side glass's height, the body band between the windshield (rear glass) and the side glass. */
function pillars(s, glassBox, front) {
  const stations = [];
  const flagsTurn = [];
  const curves = [];
  const zc = (glassBox.min.z + glassBox.max.z) / 2;
  for (const f of PILLAR_AT) {
    const y = glassBox.min.y + f * (glassBox.max.y - glassBox.min.y);
    const c = cut(s, 1, y);
    const perSide = [];
    for (const side of [1, -1]) {
      // Sweep from straight ahead (+z) round this side to straight behind; in (x, z) the angle of +z is 90°.
      const samples = fan(c, 0, zc, 4, 90, side > 0 ? -90 : 270);
      const { runs } = runsOf(samples);
      for (const run of runs) scoreTurns(run);
      if (side > 0) curves.push({ group: front ? "A-pillar" : "rear pillar", axis: 1, label: `y ${y.toFixed(2)}`, samples });
      // In sweep order (misses kept): front, the first side glass sample and the last windshield sample before it; rear, the first rear
      // glass sample and the last side glass sample before it. The band between must be unbroken (no miss) and narrower than BAND_MAX_M.
      const first = samples.findIndex((p) => !p.miss && p.kind === (front ? K.side : K.rear));
      let last = -1;
      for (let i = 0; i < first; i++) if (!samples[i].miss && samples[i].kind === (front ? K.windshield : K.side)) last = i;
      if (first < 0 || last < 0 || samples.slice(last, first + 1).some((p) => p.miss)) {
        perSide.push(null);
        continue;
      }
      const band = samples.slice(last, first + 1);
      let width = 0;
      for (let i = 1; i < band.length; i++) width += Math.hypot(band[i].u - band[i - 1].u, band[i].v - band[i - 1].v);
      if (width > BAND_MAX_M) {
        perSide.push(null);
        continue;
      }
      const body = band.slice(1, -1).filter((p) => !GLASS.has(p.kind));
      const mid = band[Math.floor(band.length / 2)];
      flagsTurn.push(...turnFlags(body.filter((p) => p.turn !== null), 1, y));
      perSide.push({ width, mid: world(1, y, mid), turn: maxOf(body.map((p) => p.turn)) });
    }
    stations.push({ y, sides: perSide });
  }
  const widths = stations.flatMap((st) => st.sides.filter(Boolean).map((sd) => sd.width));
  const byHeight = stations.map((st) => {
    const w = st.sides.filter(Boolean).map((sd) => sd.width);
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null;
  });
  const med = median(widths);
  const flags = [...flagsTurn];
  for (const st of stations) {
    for (const sd of st.sides) {
      if (!sd || med === null) continue;
      const over = (sd.width - med) / med;
      if (over >= WIDTH_FLAG[0]) flags.push({ p: sd.mid, level: over >= WIDTH_FLAG[1] ? 2 : 1, score: 100 + over * 100 });
    }
  }
  let jump = null;
  for (let i = 1; i < byHeight.length; i++) if (byHeight[i] !== null && byHeight[i - 1] !== null) jump = Math.max(jump ?? 0, Math.abs(byHeight[i] - byHeight[i - 1]));
  // Lean: the band's middle z against height, least squares, per side, averaged.
  const leans = [1, -1].map((side) => {
    const pts = stations.map((st) => st.sides[side > 0 ? 0 : 1]).filter(Boolean).map((sd) => sd.mid);
    if (pts.length < 3) return null;
    const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const mz = pts.reduce((a, p) => a + p[2], 0) / pts.length;
    const slope = pts.reduce((a, p) => a + (p[1] - my) * (p[2] - mz), 0) / pts.reduce((a, p) => a + (p[1] - my) ** 2, 0);
    return deg(Math.atan(Math.abs(slope)));
  });
  const leansOk = leans.filter((l) => l !== null);
  return {
    score: {
      widthMm: byHeight.map(mm),
      spreadPct: widths.length && med ? r1((100 * (Math.max(...widths) - Math.min(...widths))) / med) : null,
      jumpMm: mm(jump),
      leanDeg: leansOk.length ? r1(leansOk.reduce((a, b) => a + b, 0) / leansOk.length) : null,
      turn: r1(maxOf(stations.flatMap((st) => st.sides.filter(Boolean).map((sd) => sd.turn)))),
    },
    flags: worstOf(flags),
    curves,
  };
}

/** Rear bumper and its lower lip: horizontal cuts, the contour behind the rear arch. */
function rearBand(s, bumperBox, at, refY, behindZ, hubZ, label) {
  const contours = [];
  const curves = [];
  const flags = [];
  const turns = [];
  const fanOf = (y) => {
    const samples = fan(cut(s, 1, y), 0, hubZ, 4, 0, -180);
    const { runs } = runsOf(samples);
    for (const run of runs) scoreTurns(run);
    return samples;
  };
  const ref = fanOf(refY);
  for (const f of at) {
    const y = bumperBox.min.y + f * (bumperBox.max.y - bumperBox.min.y);
    const samples = fanOf(y);
    contours.push(samples);
    curves.push({ group: label, axis: 1, label: `y ${y.toFixed(2)}`, samples });
    const region = samples.filter((p) => !p.miss && p.v < behindZ && p.turn !== null);
    turns.push(maxOf(region.map((p) => p.turn)));
    flags.push(...turnFlags(region, 1, y));
  }
  // Outset over the reference cut, ray by ray, round the wrap; its spread per station.
  let spread = null;
  let spreadAt = null;
  for (const [j, samples] of contours.entries()) {
    const d = [];
    for (let i = 0; i < samples.length; i++) {
      const [p, q] = [samples[i], ref[i]];
      // The band on the bumper, behind the arch, against the face above it (not glass), ray by ray.
      if (p.miss || q.miss || p.v >= behindZ || p.kind !== K.bumper || GLASS.has(q.kind)) continue;
      d.push({ d: p.r - q.r, p });
    }
    if (d.length < 10) continue;
    // The middle 90 % of the outsets round the wrap: a lip that widens or steps over a run of rays, not one ray grazing an edge.
    const sorted = [...d].sort((a, b) => a.d - b.d);
    const lo = sorted[Math.floor(sorted.length * 0.05)];
    const hi = sorted[Math.ceil(sorted.length * 0.95) - 1];
    if (spread === null || hi.d - lo.d > spread) {
      spread = hi.d - lo.d;
      spreadAt = { y: bumperBox.min.y + at[j] * (bumperBox.max.y - bumperBox.min.y), p: Math.abs(hi.d) > Math.abs(lo.d) ? hi.p : lo.p };
    }
  }
  if (spreadAt) flags.push({ p: world(1, spreadAt.y, spreadAt.p), level: spread >= 0.03 ? 2 : 1, score: 200 + spread * 1000 });
  let step = null;
  for (let j = 1; j < contours.length; j++) {
    for (let i = 0; i < contours[j].length; i++) {
      const [p, q] = [contours[j][i], contours[j - 1][i]];
      if (p.miss || q.miss || p.v >= behindZ || q.v >= behindZ) continue;
      step = Math.max(step ?? 0, Math.abs(p.r - q.r));
    }
  }
  return { score: { turn: r1(maxOf(turns)), turnPerStation: turns.map(r1), projSpreadMm: mm(spread), stepMm: mm(step) }, flags: worstOf(flags), curves };
}

/** Every region's scores and flags for the stage's built car. */
export function contourOf(stage) {
  const car = stage.car;
  const style = car.style;
  const s = surfaceOf(car);
  const glass = boxOf(s, [K.side]);
  const bumper = boxOf(s, [K.bumper], -1);
  const hubs = car.wheels.map((w) => w.getWorldPosition(new THREE.Vector3()));
  const hubZ = Math.min(...hubs.map((h) => h.z));
  const radius = Math.max(...car.wheels.map((w) => new THREE.Box3().setFromObject(w).getSize(new THREE.Vector3()).y / 2), 0.3);
  const behindZ = hubZ - radius * 1.05;
  const bodyBox = boxOf(s, [K.body]);
  const width = bodyBox.max.x - bodyBox.min.x;
  const regions = {
    roofEdge: roofEdge(s, style, glass.min.y, glass.max.y, width),
    aPillar: pillars(s, glass, true),
    rearPillar: pillars(s, glass, false),
    bumper: bumper.isEmpty() ? null : rearBand(s, bumper, BUMPER_AT, bumper.max.y + TAIL_ABOVE, behindZ, hubZ, "rear bumper"),
    lowerLip: bumper.isEmpty() ? null : rearBand(s, bumper, LIP_AT, bumper.min.y + 0.5 * (bumper.max.y - bumper.min.y), behindZ, hubZ, "lower lip"),
  };
  return regions;
}

/** A perspective camera on the car's left three-quarters, from behind (`rear`) or ahead, a little above the roof. */
function threeQuarter(box, rear, W, H) {
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(24, W / H, 0.1, 100);
  const d = size.z * 1.55;
  cam.position.set(c.x + d * 0.55, c.y + size.y * 1.3, c.z + (rear ? -1 : 1) * d * 0.8);
  cam.lookAt(c.x, c.y - size.y * 0.1, c.z);
  cam.updateMatrixWorld(true);
  return cam;
}

/** The car's panel: rear and front three-quarter views in game shading with the flags as rings, its scores in lines under them. */
async function panel(game, stage, port, style, regions) {
  const [W, H] = SHOT;
  const box = new THREE.Box3().setFromObject(stage.car.group);
  const lines = scoreLines(style, regions);
  const canvas = game.createCanvas(W * 2 + 10, H + 22 + lines.length * 18 + 8);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(`${style}: surface contour sections (left side shown; scores cover both sides)`, 6, 17);
  for (const [k, rear] of [true, false].entries()) {
    const cam = threeQuarter(box, rear, W, H);
    const rgba = port.draw(stage.scene, cam);
    const img = new game.ImageData(rgba, W, H);
    const tmp = game.createCanvas(W, H);
    tmp.getContext("2d").putImageData(img, 0, 0);
    const ox = k * (W + 10);
    ctx.fillStyle = "#eef0f2";
    ctx.fillRect(ox, 22, W, H);
    ctx.drawImage(tmp, ox, 22);
    const v = new THREE.Vector3();
    const all = Object.values(regions).flatMap((r) => r?.flags ?? []);
    for (const level of [1, 2, 3]) {
      for (const f of all) {
        if (f.level !== level || f.p[0] < -0.05) continue;
        v.fromArray(f.p).project(cam);
        const [u, w] = [ox + ((v.x + 1) / 2) * W, 22 + ((1 - v.y) / 2) * H];
        ctx.strokeStyle = RING[level];
        ctx.lineWidth = level === 3 ? 3 : 2;
        ctx.beginPath();
        ctx.arc(u, w, level === 3 ? 8 : 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.fillStyle = "#000";
    ctx.font = "14px sans-serif";
    ctx.fillText(rear ? "rear three-quarter" : "front three-quarter", ox + 6, 22 + H - 8);
  }
  ctx.font = "15px monospace";
  for (const [i, line] of lines.entries()) ctx.fillText(line, 6, H + 22 + 18 * (i + 1));
  return canvas;
}

/** A sample's colour: glass blue, trim dark, an unscored body sample grey, a scored one cool (0°) to warm (60° and over) by its turn. */
function sampleColour(p) {
  if (GLASS.has(p.kind)) return "rgb(70,130,200)";
  if (p.kind === K.trim) return "rgb(50,50,50)";
  if (p.turn === null || p.turn === undefined) return "rgb(160,160,160)";
  const t = Math.min(1, p.turn / 60);
  const stops = [[40, 90, 255], [0, 190, 120], [240, 200, 0], [230, 20, 20]];
  const k = Math.min(2, Math.floor(t * 3));
  const f = t * 3 - k;
  const c = stops[k].map((a, i) => Math.round(a + f * (stops[k + 1][i] - a)));
  return `rgb(${c.join(",")})`;
}

/** Plot axes per cut: across the roof (x right, y up), along it (front at the left, y up), the horizontal cuts in plan (front at the left, the car's left up). */
const PLOT_AXES = { 2: (p) => [p.u, p.v], 0: (p) => [-p.u, p.v], 1: (p) => [-p.v, p.u] };

/**
 * The car's section curves, raw samples coloured by turn (glass blue, trim dark, unscored grey), one plot per group: across the roof
 * (each cut 12 cm over the last), along it, the pillar cuts in plan (left side), the rear bumper and lip cuts in plan.
 */
function sectionPanel(game, style, regions) {
  const groups = [
    ["roof across (z cuts, raised 12 cm each)", regions.roofEdge.curves.filter((c) => c.group === "roof across"), 0.12],
    ["roof along (x cuts)", regions.roofEdge.curves.filter((c) => c.group === "roof along"), 0],
    ["A-pillar + rear pillar (y cuts, plan, left)", [...regions.aPillar.curves, ...regions.rearPillar.curves], 0],
    ["rear bumper + lower lip (y cuts, plan)", [...(regions.bumper?.curves ?? []), ...(regions.lowerLip?.curves ?? [])], 0],
  ];
  const [PW, PH] = [440, 300];
  const canvas = game.createCanvas(PW * groups.length + 10 * (groups.length - 1), PH + 24);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [g, [title, curves, lift]] of groups.entries()) {
    const ox = g * (PW + 10);
    ctx.fillStyle = "#f6f7f8";
    ctx.fillRect(ox, 22, PW, PH);
    ctx.fillStyle = "#000";
    ctx.font = "13px sans-serif";
    ctx.fillText(`${style}: ${title}`, ox + 4, 16);
    // The pillar plot keeps the greenhouse's side, the rear plot what is behind the rear arch: the parts the regions score.
    const pts = curves.flatMap((c, i) =>
      c.samples.filter((p) => !p.miss && (c.axis !== 1 || p.u > -0.05)).map((p) => {
        const [h, v] = PLOT_AXES[c.axis](p);
        return { h, v: v + i * lift, p };
      }),
    );
    if (!pts.length) continue;
    const keep = g === 3 ? pts.filter((q) => q.h > Math.max(...pts.map((x) => x.h)) - 0.9) : g === 2 ? pts.filter((q) => q.p.u > 0.2) : pts;
    const [h0, h1] = [Math.min(...keep.map((q) => q.h)), Math.max(...keep.map((q) => q.h))];
    const [v0, v1] = [Math.min(...keep.map((q) => q.v)), Math.max(...keep.map((q) => q.v))];
    const k = Math.min((PW - 20) / Math.max(h1 - h0, 1e-3), (PH - 20) / Math.max(v1 - v0, 1e-3));
    for (const q of keep) {
      ctx.fillStyle = sampleColour(q.p);
      ctx.fillRect(ox + 10 + (q.h - h0) * k - 1, 22 + PH - 10 - (q.v - v0) * k - 1, 2.5, 2.5);
    }
    ctx.fillStyle = "#000";
    ctx.fillText(`10 cm = ${Math.round(0.1 * k)} px`, ox + 4, 22 + PH - 4);
  }
  return canvas;
}

function scoreLines(style, regions) {
  const r = regions;
  const f = (x, unit = "") => (x === null || x === undefined ? "n/a" : `${x}${unit}`);
  return [
    `roofEdge   turn across ${f(r.roofEdge.score.turnAcross, "°")} along ${f(r.roofEdge.score.turnAlong, "°")}  ledge ${f(r.roofEdge.score.ledgeMm, " mm")}  shelf ${f(r.roofEdge.score.shelfMm, " mm")}  crown ${f(r.roofEdge.score.crownMm, " mm")}`,
    `aPillar    width ${r.aPillar.score.widthMm.map((w) => f(w)).join("/")} mm  spread ${f(r.aPillar.score.spreadPct, "%")}  jump ${f(r.aPillar.score.jumpMm, " mm")}  lean ${f(r.aPillar.score.leanDeg, "°")}  turn ${f(r.aPillar.score.turn, "°")}`,
    `rearPillar width ${r.rearPillar.score.widthMm.map((w) => f(w)).join("/")} mm  spread ${f(r.rearPillar.score.spreadPct, "%")}  jump ${f(r.rearPillar.score.jumpMm, " mm")}  lean ${f(r.rearPillar.score.leanDeg, "°")}  turn ${f(r.rearPillar.score.turn, "°")}`,
    `bumper     turn ${f(r.bumper?.score.turn, "°")}  projSpread ${f(r.bumper?.score.projSpreadMm, " mm")}  step ${f(r.bumper?.score.stepMm, " mm")}`,
    `lowerLip   turn ${f(r.lowerLip?.score.turn, "°")}  projSpread ${f(r.lowerLip?.score.projSpreadMm, " mm")}  step ${f(r.lowerLip?.score.stepMm, " mm")}`,
    "rings: yellow mild (turn ≥ 25° in 4 cm, band ≥ 15 % over median), orange bad (≥ 45°, ≥ 30 %), red the region's worst",
  ];
}

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    car: { type: "string" },
    all: { type: "boolean", default: false },
    png: { type: "string" },
    sheet: { type: "string" },
    curves: { type: "string" },
  },
});

/** `canvases` stacked into one PNG at `out`. */
async function stack(canvases, out) {
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
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await sheet.encode("png"));
}

const game = await openGame(values.root);
const styles = values.all ? game.CAR_STYLE_IDS : [values.car ?? "sedan"];
const stage = new CarStage(game, PAINT);
const port = values.png || values.sheet ? new ViewPort(game, SHOT[0], SHOT[1]) : null;
const panels = [];
const plots = [];
for (const style of styles) {
  stage.build(style, game.STYLE_CLASS[style]);
  const regions = contourOf(stage);
  console.log(JSON.stringify({ car: style, ...Object.fromEntries(Object.entries(regions).map(([k, r]) => [k, r?.score ?? null])) }));
  const plot = values.curves || values.sheet ? sectionPanel(game, style, regions) : null;
  if (values.curves) plots.push(plot);
  if (port) {
    const canvas = await panel(game, stage, port, style, regions);
    if (values.png) {
      mkdirSync(dirname(values.png), { recursive: true });
      writeFileSync(values.png, await canvas.encode("png"));
    }
    panels.push(canvas, plot);
  }
}
if (values.sheet && panels.length) await stack(panels, values.sheet);
if (values.curves && plots.length) await stack(plots, values.curves);
process.exit(0);
