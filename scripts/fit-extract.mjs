/**
 * Reference → BodyStyle tables for `fit-car.mjs`: the side view's outline, wheels and daylight opening and the top view's plan and
 * glass, measured in car space (metres, +z forward, ground y = 0 under the class lift, origin midway between the axles), as the
 * style files' own fields.
 */
import { columnEdges, maskBox, round, rowEdges } from "./trace-metrics.mjs";

/** Outline points within this (m) of the simplified line drop out: the stations land where the edge bends. */
const SIMPLIFY_TOL = 0.01;
/** The glass sill is a running median over this half-window (m), then simplified to SILL_TOL: pillar feet and frames drop out. */
const SILL_MEDIAN_HALF = 0.1;
const SILL_TOL = 0.015;
/** Stations closer than this (m) merge. */
const MIN_STATION_GAP = 0.06;
/** The loft's end stations stand this far (m) inside the silhouette's ends: the bumper fascia covers the rest. */
const END_INSET = 0.06;
/** Plan half-widths are a running median over this half-window (m): a mirror head narrower than it drops out. */
const PLAN_MEDIAN_HALF = 0.15;
/** Share of the opening's height its top and bottom rows take for the pillar ends. */
const EDGE_BAND = 0.2;
/** A glass run along the top view's centreline at least this long (m) is a pane; its widths are read this share in from its ends. */
const MIN_PANE = 0.1;
const PANE_AT = 0.25;
/** Under this share of the way from belt to crown a station is no greenhouse; over 1 minus it, all roof. */
const CABIN_EPS = 0.02;
/** The builders lift a greenhouse to at least this share of its height (`max(cabin, .25)`). */
export const CABIN_MIN = 0.25;
/** The underside is read clear of each tyre by this many radii. */
const TYRE_CLEAR = 1.1;
/** The door skin stands this far (m) proud of the body side; the hinge sits on the plan less that. */
const DOOR_PROUD = 0.003;
/** A mirror is looked for within this far (m) of the door's hinge z. */
const MIRROR_WINDOW = 0.35;
/** The builders' bumper corner: its section shrinks by this share of its lip at the end of its span (car-mesh's wrap). */
const WRAP_SHRINK = 0.228;
/** The wrap's straight run is searched in steps of this (m); end rows set back more than WRAP_MAX_SETBACK (m) are fender, not bumper. */
const WRAP_STEP = 0.01;
const WRAP_MAX_SETBACK = 0.35;
/** A mirror shows when its tip stands at least this far (m) past the plan's median half-width. */
const MIRROR_MIN = 0.03;

/** The reference's mirror tip half-width (m) near hinge z `z`, or null where no mirror stands MIRROR_MIN past the plan. */
export function refMirrorTip(top, z) {
  const tip = mirrorTip(top.rawHalf, z);
  return tip - at(top.half, z) >= MIRROR_MIN ? tip : null;
}

/** `table` (rows [h, ...], ascending h) at h in column `k`: linear between rows, held past the ends. */
export function at(table, h, k = 1) {
  if (h <= table[0][0]) return table[0][k];
  for (let i = 1; i < table.length; i++) {
    if (h > table[i][0]) continue;
    const t = (h - table[i - 1][0]) / (table[i][0] - table[i - 1][0] || 1);
    return table[i - 1][k] + t * (table[i][k] - table[i - 1][k]);
  }
  return table.at(-1)[k];
}

/** Per column of `mask`, ascending h: [h, top g, bottom g] (m). */
export function outlineOf(frame, mask) {
  const { top, bottom } = columnEdges(mask, frame.W, frame.H);
  const out = [];
  for (let u = 0; u < frame.W; u++) if (top[u] >= 0) out.push([frame.h(u + 0.5), frame.g(top[u]), frame.g(bottom[u] + 1)]);
  return out.sort((a, b) => a[0] - b[0]);
}

/** Per column of a top view's `mask`, ascending z: [z, half-width] (m), a running median over PLAN_MEDIAN_HALF either side. */
export function planOf(frame, mask) {
  return runningMedian(
    outlineOf(frame, mask).map(([z, a, b]) => [z, Math.abs(b - a) / 2]),
    PLAN_MEDIAN_HALF,
  );
}

/** [h, g] rows with g the median of the rows within `half` (m) either side. */
function runningMedian(rows, half) {
  return rows.map(([h], i) => {
    const near = [];
    for (let j = i; j >= 0 && h - rows[j][0] <= half; j--) near.push(rows[j][1]);
    for (let j = i + 1; j < rows.length && rows[j][0] - h <= half; j++) near.push(rows[j][1]);
    near.sort((a, b) => a - b);
    return [h, near[near.length >> 1]];
  });
}

/** Douglas–Peucker: the points of `pts` ([h, g]) kept so the line through them stays within `tol` (m) of every dropped one. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop();
    let worst = -1;
    let far = tol;
    for (let i = a + 1; i < b; i++) {
      const d = lineDistance(pts[i], pts[a], pts[b]);
      if (d <= far) continue;
      far = d;
      worst = i;
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push([a, worst], [worst, b]);
  }
  return pts.filter((_, i) => keep[i]);
}

function lineDistance([x, y], [x0, y0], [x1, y1]) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  return len === 0 ? Math.hypot(x - x0, y - y0) : Math.abs((y1 - y0) * (x - x0) - (x1 - x0) * (y - y0)) / len;
}

/** The top view: nose and tail z, the plan half-widths (median and raw), each row's front and rear z, and the windshield and rear glass. */
export function extractTop(frame, sil, glass) {
  const half = planOf(frame, sil);
  const panes = centrePanes(frame, glass).sort((a, b) => a.zMid - b.zMid);
  const windshield = panes.length > 1 || panes[0]?.zMid > 0 ? panes.at(-1) : null;
  const rear = panes.length > 1 || panes[0]?.zMid <= 0 ? panes[0] : null;
  return { nose: half.at(-1)[0], tail: half[0][0], half, rawHalf: rawHalfOf(frame, sil), ends: endsOf(frame, sil), windshield, rear };
}

/** Per column of a top view's `mask`, ascending z: [z, half-width] (m), unfiltered (mirrors kept). */
export function rawHalfOf(frame, mask) {
  return outlineOf(frame, mask).map(([z, a, b]) => [z, Math.abs(b - a) / 2]);
}

/** Per row of a top view's `mask`: [|x|, front z, rear z] (m). */
function endsOf(frame, mask) {
  const { left, right } = rowEdges(mask, frame.W, frame.H);
  const out = [];
  for (let v = 0; v < frame.H; v++) if (left[v] >= 0) out.push([Math.abs(frame.g(v + 0.5)), frame.h(left[v]), frame.h(right[v] + 1)]);
  return out;
}

/** The widest raw half-width (m) within MIRROR_WINDOW of `z`: a mirror's tip when one stands there. */
export function mirrorTip(rawHalf, z) {
  return Math.max(...rawHalf.filter(([pz]) => Math.abs(pz - z) <= MIRROR_WINDOW).map((p) => p[1]));
}

/** The bumper's lip: how far (m) past its seat its fascia reaches, its outermost point at the centre. */
function lip(bumper) {
  return Math.max(...bumper.fascia.map((p) => p[1]));
}

/**
 * `bumper` seated so its lip meets the reference's end `tip` (m from the middle), its plan corner (`wrap`) fitted to the end's
 * setback per lateral x: straight out to `from`, then back linearly to `span` (the builders' sweep, the section shrinking
 * WRAP_SHRINK of its lip). `setbacks`: [|x|, m behind the tip].
 */
function fitBumper(bumper, tip, setbacks) {
  const out = lip(bumper);
  const near = setbacks.filter(([x, s]) => x <= bumper.span && s <= WRAP_MAX_SETBACK);
  let best = { sse: Infinity, from: bumper.wrap.from, k: 0 };
  for (let from = 0; from < bumper.span; from += WRAP_STEP) {
    let sd = 0;
    let dd = 0;
    for (const [x, s] of near) {
      const d = Math.max(0, x - from);
      sd += s * d;
      dd += d * d;
    }
    const k = dd > 0 ? sd / dd : 0;
    let sse = 0;
    for (const [x, s] of near) sse += (s - k * Math.max(0, x - from)) ** 2;
    if (sse < best.sse) best = { sse, from, k };
  }
  const back = near.length === 0 ? bumper.wrap.back : Math.max(0, best.k * (bumper.span - best.from) - WRAP_SHRINK * out);
  return { ...bumper, seat: { ...bumper.seat, z: tip - out }, wrap: { from: near.length === 0 ? bumper.wrap.from : best.from, back } };
}

/** The front and rear bumpers fitted to the top view's ends, and the door's hinge on the plan at its z. */
function hardpoints(top, style) {
  const zFront = Math.max(...top.ends.map((e) => e[1]));
  const zRear = Math.min(...top.ends.map((e) => e[2]));
  return {
    door: { ...style.door, hingeX: at(top.half, style.door.hingeZ) - DOOR_PROUD },
    bumpers: {
      front: fitBumper(style.bumpers.front, zFront, top.ends.map(([x, f]) => [x, zFront - f])),
      rear: fitBumper(style.bumpers.rear, -zRear, top.ends.map(([x, , r]) => [x, r - zRear])),
    },
  };
}

/** The glass runs along the top view's centreline (MIN_PANE long or more): front and rear z, and the widths just inside them. */
function centrePanes(frame, glass) {
  const { W, H } = frame;
  const v = Math.round(frame.v(0));
  const widthAt = (u0, u1, share) => width(Math.round(u0 + share * (u1 - u0)));
  const width = (u) => {
    let a = v;
    let b = v;
    while (a > 0 && glass[(a - 1) * W + u]) a--;
    while (b < H - 1 && glass[(b + 1) * W + u]) b++;
    return (b + 1 - a) / frame.ppm;
  };
  const panes = [];
  let start = -1;
  for (let u = 0; u <= W; u++) {
    const on = u < W && glass[v * W + u] === 1;
    if (on && start < 0) start = u;
    if (on || start < 0) continue;
    if ((u - start) / frame.ppm >= MIN_PANE) {
      const [u0, u1] = [start, u - 1];
      panes.push({ front: frame.h(u0), rear: frame.h(u1 + 1), wFront: widthAt(u0, u1, PANE_AT), wRear: widthAt(u0, u1, 1 - PANE_AT), zMid: frame.h((u0 + u1 + 1) / 2) });
    }
    start = -1;
  }
  return panes;
}

/** The z range the greenhouse glass may stand in: rear glass foot to windshield foot (the top view's, else `style`'s). */
export function glassZone(top, style) {
  return [top.rear?.rear ?? style.rearGlass.base[1], top.windshield?.front ?? style.windshield.base[1]];
}

/**
 * The side view in car space: nose and tail z, crown y, the top outline [z, y], the underside clear of the tyres, the reference's
 * hubs, and its daylight opening within `zone` (null without glass). Heights drop the class `lift` (the tables are the body's).
 */
export function extractSide(frame, sil, glass, hubs, lift, zone) {
  const outline = outlineOf(frame, sil).map(([z, t, b]) => [z, t - lift, b - lift]);
  const inZone = glass.map((on, i) => {
    const z = frame.h((i % frame.W) + 0.5);
    return on && z >= zone[0] && z <= zone[1] ? 1 : 0;
  });
  const dlo = outlineOf(frame, inZone).map(([z, t, b]) => [z, t - lift, b - lift]);
  const clear = (z) => [hubs.front, hubs.rear].every((w) => Math.abs(z - w.z) > TYRE_CLEAR * (w.radius ?? 0));
  return {
    nose: outline.at(-1)[0],
    tail: outline[0][0],
    crown: Math.max(...outline.map((p) => p[1])),
    top: outline.map(([z, t]) => [z, t]),
    underside: simplify(outline.filter(([z]) => clear(z)).map(([z, , b]) => [z, b]), SIMPLIFY_TOL),
    hubs,
    zone,
    dlo: dlo.length === 0 ? null : opening(frame, inZone, dlo),
  };
}

/** The side daylight opening: its sill line and its pillars' ends. */
function opening(frame, glass, dlo) {
  const { left, right } = rowEdges(glass, frame.W, frame.H);
  const box = maskBox(glass, frame.W, frame.H);
  const band = Math.max(1, Math.round(EDGE_BAND * (box.v1 - box.v0)));
  const meanZ = (v0, v1, edge, shift) => {
    const zs = [];
    for (let v = v0; v <= v1; v++) if (edge[v] >= 0) zs.push(frame.h(edge[v] + shift));
    return zs.reduce((a, b) => a + b, 0) / zs.length;
  };
  return {
    sill: simplify(runningMedian(dlo.map(([z, , b]) => [z, b]), SILL_MEDIAN_HALF), SILL_TOL),
    frontTopZ: meanZ(box.v0, box.v0 + band, left, 0),
    rearTopZ: meanZ(box.v0, box.v0 + band, right, 1),
    rearBotZ: dlo[0][0],
  };
}

/**
 * The style fields the references give, over `style`'s (kept where a reference shows nothing): dims, profile stations, the glass
 * hardpoints, the belt and the underside. `wheelScale` turns the drawn tyre back into the spec's.
 */
export function tableFrom(side, top, style, wheelScale) {
  const { hubs, dlo } = side;
  const ws = top.windshield;
  const rg = top.rear;
  const y = (z) => at(side.top, z);
  const windshieldTop = ws ? [y(ws.rear), ws.rear] : dlo ? [y(dlo.frontTopZ), dlo.frontTopZ] : style.windshieldTop;
  const sill = dlo?.sill ?? style.belt.y;
  const radii = [hubs.front.radius, hubs.rear.radius].filter((r) => r !== null);
  return {
    dims: {
      ...style.dims,
      wheelbase: hubs.front.z - hubs.rear.z,
      overhang: { front: side.nose - hubs.front.z, rear: hubs.rear.z - side.tail },
      width: 2 * Math.max(...top.half.map((p) => p[1])),
      height: side.crown,
      wheel: { ...style.dims.wheel, radius: radii.length === 0 ? style.dims.wheel.radius : radii.reduce((a, b) => a + b, 0) / radii.length / wheelScale },
    },
    profile: stations(side, top, sill, style),
    roofZ: [rg ? rg.front : style.roofZ[0], windshieldTop[1]],
    // ponytail: a pane's top is read no wider than its base; from above, the side glass joins the panes near the roof. A shaped DLO field fixes it.
    windshield: ws ? { base: [y(ws.front), ws.front], wBase: ws.wFront, wTop: Math.min(ws.wRear, ws.wFront) } : style.windshield,
    windshieldTop,
    rearGlass: rg ? { base: [y(rg.rear), rg.rear], top: [y(rg.front), rg.front], wBase: rg.wRear, wTop: Math.min(rg.wFront, rg.wRear) } : style.rearGlass,
    quarter: dlo ? { zRearBot: dlo.rearBotZ, zRearTop: dlo.rearTopZ } : style.quarter,
    belt: { x: style.belt.x, y: sill },
    underside: side.underside,
    ...hardpoints(top, style),
  };
}

/** Profile stations where the top outline, the plan or the glass zone bends, rear to front, inside the loft's ends. */
function stations(side, top, sill, style) {
  const [zLo, zHi] = side.zone;
  const ends = [side.tail + END_INSET, side.nose - END_INSET];
  const marks = [...simplify(side.top, SIMPLIFY_TOL), ...simplify(top.half, SIMPLIFY_TOL)].map((p) => p[0]).concat(zLo, zHi, ends);
  const zs = marks.filter((z) => z >= ends[0] && z <= ends[1]).sort((a, b) => a - b);
  const kept = [zs[0]];
  for (const z of zs.slice(1, -1)) if (z - kept.at(-1) >= MIN_STATION_GAP) kept.push(z);
  if (ends[1] - kept.at(-1) < MIN_STATION_GAP) kept.pop();
  kept.push(ends[1]);
  const cabinHw = style.profile.map((s) => [s.z, s.cabinHw]);
  return kept.map((z) => {
    const hw = at(top.half, z);
    const yTop = at(side.top, z);
    const flat = { z, hw, yBelt: yTop, yRoof: yTop, cabinHw: at(cabinHw, z), cabin: 0 };
    if (z <= zLo || z >= zHi) return flat;
    const belt = at(sill, z);
    const c = (yTop - belt) / (side.crown - belt);
    if (c <= CABIN_EPS) return flat;
    if (c >= 1 - CABIN_EPS) return { ...flat, yBelt: belt, cabin: 1 };
    if (c < CABIN_MIN) return { ...flat, yBelt: belt, yRoof: belt + (yTop - belt) / CABIN_MIN, cabin: CABIN_MIN };
    return { ...flat, yBelt: belt, yRoof: side.crown, cabin: c };
  });
}

/** The table as TS a style file pastes over its own fields (3 decimals). */
export function formatTable(t) {
  const n = (x) => String(round(x));
  const pair = ([a, b]) => `[${n(a)}, ${n(b)}]`;
  const pairs = (list) => `[${list.map(pair).join(", ")}]`;
  const st = (s) => (s.cabin === 0 ? `st(${[s.z, s.hw, s.yBelt].map(n).join(", ")})` : `st(${[s.z, s.hw, s.yBelt, s.yRoof, s.cabinHw, s.cabin].map(n).join(", ")})`);
  const { dims: d } = t;
  return [
    `  dims: { wheelbase: ${n(d.wheelbase)}, overhang: { front: ${n(d.overhang.front)}, rear: ${n(d.overhang.rear)} }, track: ${n(d.track)}, width: ${n(d.width)}, height: ${n(d.height)}, rideHeight: ${n(d.rideHeight)}, wheel: { radius: ${n(d.wheel.radius)}, width: ${n(d.wheel.width)} } },`,
    `  profile: [`,
    ...t.profile.map((s) => `    ${st(s)},`),
    `  ],`,
    `  roofZ: ${pair(t.roofZ)},`,
    `  windshield: { base: ${pair(t.windshield.base)}, wBase: ${n(t.windshield.wBase)}, wTop: ${n(t.windshield.wTop)} },`,
    `  windshieldTop: ${pair(t.windshieldTop)},`,
    `  rearGlass: { base: ${pair(t.rearGlass.base)}, top: ${pair(t.rearGlass.top)}, wBase: ${n(t.rearGlass.wBase)}, wTop: ${n(t.rearGlass.wTop)} },`,
    `  quarter: { zRearBot: ${n(t.quarter.zRearBot)}, zRearTop: ${n(t.quarter.zRearTop)} },`,
    `  belt: { x: ${typeof t.belt.x === "number" ? n(t.belt.x) : pairs(t.belt.x)}, y: ${pairs(t.belt.y)} },`,
    `  underside: ${pairs(t.underside)},`,
    `  door: { ${["hingeX", "hingeY", "hingeZ", "length", "halfHeight", "mirrorY", "mirrorReach", "mirrorHalfDepth"].map((k) => `${k}: ${n(t.door[k])}`).join(", ")}, aperture: ${pair(t.door.aperture)} },`,
    `  bumpers: { front: ${bumper(t.bumpers.front)}, rear: ${bumper(t.bumpers.rear)} },`,
  ].join("\n");

  function bumper(b) {
    return `{ seat: { y: ${n(b.seat.y)}, z: ${n(b.seat.z)} }, fascia: ${pairs(b.fascia)}, span: ${n(b.span)}, wrap: { from: ${n(b.wrap.from)}, back: ${n(b.wrap.back)} } }`;
  }
}
