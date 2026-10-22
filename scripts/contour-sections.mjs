#!/usr/bin/env node
/**
 * Surface contour sections (geometry only, never airflow): the built car's drawn meshes cut by planes at fixed stations, scored per
 * region the owner marks (roof edge, A-pillar, rear pillar, rear bumper, lower lip), never as one smoothness score.
 *
 *   CAP=4G /home/aphix/crash-wt/slot-run /home/aphix/crash-wt/capped node --disable-warning=ExperimentalWarning \
 *     scripts/contour-sections.mjs --root <tree> --car <style> [--png <out.png>]
 *   ... scripts/contour-sections.mjs --root <tree> --all --sheet <out.png>     (the five bodies: one JSON line each, one sheet)
 *
 * The surface: the body, lids, door skins, bumpers, glass panes and window trim as drawn (`lookMeshes`, `glassPanes`), less the style's
 * small fittings (`smallFittings`: exhaust tips, tow hitch); no wheels, lamps or batched parts. Each station cuts every triangle with a
 * plane (exact, no renderer) and a fan of rays in that plane, from outside toward a centre, keeps the outermost hit: the section's
 * outer contour, a raw sample every 0.25°, never smoothed. A ray that hits nothing is a miss and splits the contour; so does a jump
 * over STEP_M between neighbouring hits (a ledge or an overhang the fan cannot see under), whose length is reported as a step.
 *
 * `turn`: the direction change (degrees) across ARC_M of contour centred on a sample (the chords to the samples ARC_M/2 behind and ahead):
 * a corner of radius r turns ARC_M / r radians there, so 45° is a radius of about 5 cm and 25° about 9 cm. A window that crosses a
 * mesh change (glass to body, bumper to body: a seam or an intended crisp edge) is not scored.
 *
 * Regions and what each number catches:
 * - roofEdge (cuts across the roof at 25/50/75 % of `roofZ` and along it at 0, ±20 % and ±32 % of the body's width; the body
 *   above the side glass's top, less the style's intended edges, `intendedEdges`: its spoiler and rails): `turnAcross` the hardest
 *   shoulder roll, `turnAlong` the hardest roof end, `ledgeMm` the largest step above the side glass (a roof cap overhanging what is
 *   under it), `offRoofMm` that step under an intended part (a spoiler off the roof), `hoodBaseStepMm` the widest open seam round
 *   the hood's rear edge and the windshield base, `shelfMm` how far the roof skin stands out past the side glass top below it,
 *   `crownMm` the roof's rise from 70 % of its half-width to the centre.
 * - aPillar / rearPillar (horizontal cuts at six heights through the side glass): the body run between the windshield (rear glass)
 *   and the side glass, each side. `widthMm` per height (the visible band, arc length glass edge to glass edge), `spreadPct` its
 *   (max − min) / median (a swollen or pinched band), `jumpMm` the largest change between neighbouring heights, `leanDeg` the band's
 *   lean from vertical, `turn` the hardest facet inside the band.
 * - bumper / lowerLip (horizontal cuts through the rear bumper's height: 35-80 % and its bottom 4-22 %; the contour behind the rear
 *   arch): `turn` the squarest wrap corner, `projSpreadMm` how much the bumper's outset over the face above it (the tail panel for
 *   the bumper, the bumper's middle for the lip) changes round the wrap (5th to 95th percentile of the rays), `stepMm` the largest
 *   change between neighbouring heights' contours.
 *
 * Prints one JSON line per car, with its exterior `gaps` and `zfight` (`contour-defects.mjs`), then a `{"kind":"suggest"}` line per
 * fix certain enough to print. `--curves <png>`: every car's section curves, raw samples coloured by turn. `--png`: the car in game
 * shading from the rear and the front three-quarters (its left side), rings at the flagged samples: yellow mild, orange bad, red the
 * region's worst, cyan a gap or stand-off, magenta z-fighting; scores under it. `--sheet`: every car's panel and its curves, stacked.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import * as THREE from "three";
import { CarStage, ViewPort, openGame } from "./trace-core.mjs";
import { GLASS, K, boxOf, cut, deg, dropBoxes, intendedAt, intendedEdges, mm, r1, sampleColour, smallFittings, stackCanvases, surfaceOf, threeQuarter, world } from "./contour-core.mjs";
import { defectsOf } from "./contour-defects.mjs";

/** Fan ray spacing (degrees), the turn window (m) and the neighbour jump (m) that splits a contour as a step. */
const FAN_STEP = 0.25;
const ARC_M = 0.04;
const STEP_M = 0.05;
/** A pillar band wider than this (m) is not a pillar: the cut missed a glass edge at that height. */
const BAND_MAX_M = 0.6;
/** A pillar band's samples stand at least this far (m) out on their own side: one past it is the far side, seen through the near. */
const NEAR_SIDE = 0.3;
/** A jump between neighbouring lengthwise samples round the hood's rear edge and the windshield base over this (m) is an open seam. */
const HOOD_STEP_M = 0.012;
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
/** Defect rings: a gap or stand-off cyan, z-fighting magenta (bigger rings, bolder when bad). */
const DEFECT_RING = { gap: "rgba(0,200,255,0.95)", zfight: "rgba(255,0,220,0.95)" };

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
 * glass top: the fan passing under a roof cap that overhangs what is below it. The style's intended edges (`intendedEdges`: its roof
 * spoiler and rails) are fittings, not the roof: no turn or ledge on them is scored.
 */
function roofEdge(s, style, belt, glassTop, width, intended) {
  const [zr, zf] = style.roofZ;
  const flags = [];
  const turns = [];
  const shelves = [];
  const crowns = [];
  const ledges = [];
  const offRoof = [];
  const hoodSteps = [];
  const curves = [];
  const wsBase = style.windshield.base[1];
  const scoreCut = (axis, value, cu, cv, label, group) => {
    const samples = fan(cut(s, axis, value), cu, cv, 3, 0, 180);
    const { runs, steps } = runsOf(samples);
    for (const run of runs) scoreTurns(run);
    // The roof: body above the side glass top, off the intended edges; lengthwise, within a quarter metre of the roof's ends.
    const free = (p) => intendedAt(intended, world(axis, value, p)) === null;
    const roof = samples.filter((p) => !p.miss && !GLASS.has(p.kind) && p.kind !== K.trim && p.v > glassTop - 0.03 && (axis === 2 || (p.u > zr - 0.25 && p.u < zf + 0.25)));
    const region = roof.filter((p) => p.turn !== null && free(p));
    turns.push({ axis, turn: maxOf(region.map((p) => p.turn)) });
    flags.push(...turnFlags(region, axis, value));
    for (const st of steps) {
      if (st.a.v < glassTop - 0.1 || st.b.v < glassTop - 0.1) continue;
      // On an intended edge (a spoiler) the step is the fan passing under it: the part stands off the roof, a gap you see into.
      if (free(st.a) && free(st.b)) ledges.push({ len: st.len, p: world(axis, value, st.a) });
      else offRoof.push({ len: st.len, p: world(axis, value, st.a) });
    }
    // Lengthwise: a step between neighbouring samples round the hood's rear edge and the windshield's base (an open seam you see into).
    if (axis === 0) {
      for (let i = 1; i < samples.length; i++) {
        const [a, b] = [samples[i - 1], samples[i]];
        const inZone = (p) => !p.miss && p.u > wsBase - 0.35 && p.u < wsBase + 0.15 && p.v > belt - 0.4;
        if (!inZone(a) || !inZone(b)) continue;
        // The seam's width: how far apart the two sides are (an open seam is a few cm; the fan crossing onto another face is not a seam).
        const jump = Math.hypot(a.u - b.u, a.v - b.v);
        if (jump > HOOD_STEP_M && jump < 0.1) hoodSteps.push({ len: jump, p: world(axis, value, a.r < b.r ? a : b) });
      }
    }
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
  const off = offRoof.reduce((a, st) => (a === null || st.len > a.len ? st : a), null);
  if (off) flags.push({ p: off.p, level: 2, score: 400 + off.len * 1000, colour: "gap" });
  const hood = hoodSteps.reduce((a, st) => (a === null || st.len > a.len ? st : a), null);
  if (hood) flags.push({ p: hood.p, level: hood.len >= 2 * HOOD_STEP_M ? 2 : 1, score: 400 + hood.len * 1000, colour: "gap" });
  return {
    score: {
      turnAcross: r1(maxOf(turns.filter((t) => t.axis === 2).map((t) => t.turn))),
      turnAlong: r1(maxOf(turns.filter((t) => t.axis === 0).map((t) => t.turn))),
      turnPerCut: turns.map((t) => r1(t.turn)),
      ledgeMm: mm(ledge?.len ?? 0),
      offRoofMm: mm(off?.len ?? 0),
      hoodBaseStepMm: mm(hood?.len ?? 0),
      shelfMm: mm(maxOf(shelves)),
      crownMm: mm(crowns.length ? Math.min(...crowns) : null),
    },
    flags: worstOf(flags),
    curves,
  };
}

/**
 * Pillars: horizontal cuts through the side glass's height, the body band between the windshield (rear glass) and the side glass. The
 * fans stand on `zc`, the hubs' midpoint: a centre no glass edit moves, so where its samples land on a pillar's crease (and the turn
 * read there) changes only with the pillar.
 */
function pillars(s, glassBox, front, zc) {
  const stations = [];
  const flagsTurn = [];
  /** Why a height's band reads n/a, counted over both sides: no glass edge there, the cut sees through to the far side, wider than BAND_MAX_M. */
  const reasons = { noGlass: 0, seeThrough: 0, tooWide: 0 };
  const curves = [];
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
      // In sweep order (misses kept), on this side of the car (side × x over NEAR_SIDE): front, the first side glass sample and the last
      // windshield sample before it; rear, the first rear glass sample and the last side glass sample before it. The band between must
      // stay on this side (a sample past it is the cut seeing through to the far side: `seeThrough`), unbroken and under BAND_MAX_M.
      const near = (p) => !p.miss && side * p.u > NEAR_SIDE;
      const first = samples.findIndex((p) => near(p) && p.kind === (front ? K.side : K.rear));
      let last = -1;
      for (let i = 0; i < first; i++) if (near(samples[i]) && samples[i].kind === (front ? K.windshield : K.side)) last = i;
      const band = first < 0 || last < 0 ? [] : samples.slice(last, first + 1);
      if (!band.length || band.some((p) => p.miss)) {
        perSide.push(null);
        reasons.noGlass++;
        continue;
      }
      if (band.some((p) => !near(p))) {
        perSide.push(null);
        reasons.seeThrough++;
        continue;
      }
      let width = 0;
      for (let i = 1; i < band.length; i++) width += Math.hypot(band[i].u - band[i - 1].u, band[i].v - band[i - 1].v);
      if (width > BAND_MAX_M) {
        perSide.push(null);
        reasons.tooWide++;
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
      naReasons: reasons,
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

/** Every region's scores and flags for the stage's built car, and its exterior defects (`contour-defects.mjs`). */
export function contourOf(stage, styleId, probe = null) {
  const car = stage.car;
  const style = car.style;
  const lift = stage.game.CLASSES[stage.game.STYLE_CLASS[styleId]].lift;
  const whole = surfaceOf(car);
  const bumper = boxOf(whole, [K.bumper], -1);
  // The small fittings (exhaust tips, tow hitch) are fine as they are: no score reads them.
  const s = dropBoxes(whole, smallFittings(style, bumper, lift));
  const glass = boxOf(s, [K.side]);
  const hubs = car.wheels.map((w) => w.getWorldPosition(new THREE.Vector3()));
  const hubZ = Math.min(...hubs.map((h) => h.z));
  const radius = Math.max(...car.wheels.map((w) => new THREE.Box3().setFromObject(w).getSize(new THREE.Vector3()).y / 2), 0.3);
  const behindZ = hubZ - radius * 1.05;
  const bodyBox = boxOf(s, [K.body]);
  const width = bodyBox.max.x - bodyBox.min.x;
  const regions = {
    roofEdge: roofEdge(s, style, glass.min.y, glass.max.y, width, intendedEdges(style, lift)),
    aPillar: pillars(s, glass, true, (Math.max(...hubs.map((h) => h.z)) + hubZ) / 2),
    rearPillar: pillars(s, glass, false, (Math.max(...hubs.map((h) => h.z)) + hubZ) / 2),
    bumper: bumper.isEmpty() ? null : rearBand(s, bumper, BUMPER_AT, bumper.max.y + TAIL_ABOVE, behindZ, hubZ, "rear bumper"),
    lowerLip: bumper.isEmpty() ? null : rearBand(s, bumper, LIP_AT, bumper.min.y + 0.5 * (bumper.max.y - bumper.min.y), behindZ, hubZ, "lower lip"),
  };
  return { regions, defects: defectsOf(stage, style, lift, bumper, glass.min.y, probe) };
}

/** The car's panel: rear and front three-quarter views in game shading with the flags as rings, its scores in lines under them. */
async function panel(game, stage, port, style, { regions, defects }) {
  const [W, H] = SHOT;
  const box = new THREE.Box3().setFromObject(stage.car.group);
  const lines = scoreLines(style, regions, defects);
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
    const all = [...Object.values(regions).flatMap((r) => r?.flags ?? []), ...defects.flags];
    for (const level of [1, 2, 3]) {
      for (const f of all) {
        // The left side's rings (the shot shows it), and every defect ring on the centre line.
        if (f.level !== level || f.p[0] < -0.05) continue;
        v.fromArray(f.p).project(cam);
        const [u, w] = [ox + ((v.x + 1) / 2) * W, 22 + ((1 - v.y) / 2) * H];
        ctx.strokeStyle = f.colour ? DEFECT_RING[f.colour] : RING[level];
        ctx.lineWidth = level >= 2 ? 3 : 2;
        ctx.beginPath();
        ctx.arc(u, w, f.colour ? 7 + level * 2 : level === 3 ? 8 : 5, 0, Math.PI * 2);
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

function scoreLines(style, regions, defects) {
  const r = regions;
  const f = (x, unit = "") => (x === null || x === undefined ? "n/a" : `${x}${unit}`);
  const top = (list, fmt) => [...list].sort((a, b) => b.level - a.level || b.score - a.score).slice(0, 4).map(fmt).join("; ") || "none";
  const gaps = defects.gaps.map((g) => ({ ...g, score: g.mm }));
  const zf = defects.zfight.map((z) => ({ ...z, score: z.areaCm2 }));
  const na = (p) => (p.score.widthMm.some((w) => w === null) ? `  n/a: ${Object.entries(p.score.naReasons).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ")}` : "");
  return [
    `roofEdge   turn across ${f(r.roofEdge.score.turnAcross, "°")} along ${f(r.roofEdge.score.turnAlong, "°")}  ledge ${f(r.roofEdge.score.ledgeMm, " mm")}  shelf ${f(r.roofEdge.score.shelfMm, " mm")}  crown ${f(r.roofEdge.score.crownMm, " mm")}  spoiler off roof ${f(r.roofEdge.score.offRoofMm, " mm")}  hood/windshield seam ${f(r.roofEdge.score.hoodBaseStepMm, " mm")}`,
    `aPillar    width ${r.aPillar.score.widthMm.map((w) => f(w)).join("/")} mm  spread ${f(r.aPillar.score.spreadPct, "%")}  jump ${f(r.aPillar.score.jumpMm, " mm")}  lean ${f(r.aPillar.score.leanDeg, "°")}  turn ${f(r.aPillar.score.turn, "°")}${na(r.aPillar)}`,
    `rearPillar width ${r.rearPillar.score.widthMm.map((w) => f(w)).join("/")} mm  spread ${f(r.rearPillar.score.spreadPct, "%")}  jump ${f(r.rearPillar.score.jumpMm, " mm")}  lean ${f(r.rearPillar.score.leanDeg, "°")}  turn ${f(r.rearPillar.score.turn, "°")}${na(r.rearPillar)}`,
    `bumper     turn ${f(r.bumper?.score.turn, "°")}  projSpread ${f(r.bumper?.score.projSpreadMm, " mm")}  step ${f(r.bumper?.score.stepMm, " mm")}`,
    `lowerLip   turn ${f(r.lowerLip?.score.turn, "°")}  projSpread ${f(r.lowerLip?.score.projSpreadMm, " mm")}  step ${f(r.lowerLip?.score.stepMm, " mm")}   (skipped: ${defects.skipped.join(", ") || "none"})`,
    `gaps (cyan) ${defects.gaps.length}: ${top(gaps, (g) => `${g.kind} ${g.mm} mm ${g.region}`)}`,
    `z-fight (magenta) ${defects.zfight.length}: ${top(zf, (z) => `${z.areaCm2} cm² ${z.region} (${z.parts.slice(0, 2).join(" / ")})`)}`,
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
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await stackCanvases(game, canvases).encode("png"));
}

const game = await openGame(values.root);
// The police car is the sedan's body and the monster the pickup's: `--all` draws the five bodies; `--car` takes any style.
const styles = values.all ? ["sedan", "hatchback", "wagon", "coupe", "pickup"] : [values.car ?? "sedan"];
const stage = new CarStage(game, PAINT);
const port = values.png || values.sheet ? new ViewPort(game, SHOT[0], SHOT[1]) : null;
// The z-fighting offset measure's window (`offsetNeeded`): its own small canvas, so the shots' frame is not drawn over.
const probe = { game, port: new ViewPort(game, 128, 128), crossing: game.crossing };
const panels = [];
const plots = [];
for (const style of styles) {
  stage.build(style, game.STYLE_CLASS[style]);
  const found = contourOf(stage, style, probe);
  const { regions, defects } = found;
  console.log(JSON.stringify({ car: style, ...Object.fromEntries(Object.entries(regions).map(([k, r]) => [k, r?.score ?? null])), gaps: defects.gaps, zfight: defects.zfight, skipped: defects.skipped }));
  for (const s of defects.suggest) console.log(JSON.stringify({ kind: "suggest", car: style, ...s }));
  const plot = values.curves || values.sheet ? sectionPanel(game, style, regions) : null;
  if (values.curves) plots.push(plot);
  if (port) {
    const canvas = await panel(game, stage, port, style, found);
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
