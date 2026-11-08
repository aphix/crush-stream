import { blankProjection, sampleAt, projectPath, type Track, type TrackPath } from "./track.ts";
import { placeProps, propColliders, solidsOf } from "./placements.ts";
import { wallColliders } from "./track-sections.ts";

/** Circular distance (m) between two arc lengths on a loop of length `L`. */
const ring = (a: number, b: number, L: number): number => {
  const d = Math.abs(a - b) % L;
  return Math.min(d, L - d);
};

/** Arc length on the main loop of every shortcut's mouth and exit. */
export function mouthsOf(t: Track): { id: string; s: number; end: "mouth" | "exit" }[] {
  const pr = blankProjection();
  return t.shortcuts.flatMap((sc) =>
    ([["mouth", 0], ["exit", sc.path.count - 1]] as const).map(([end, i]) => ({ id: sc.id, s: projectPath(t.path, sc.path.x[i]!, sc.path.z[i]!, -1, pr).s, end })),
  );
}

/** Smallest and largest gap (m) between consecutive main gates round the loop, the last gate to the line included. */
export function gateSpacing(t: Track): { min: number; max: number } {
  let min = Infinity;
  let max = 0;
  for (let i = 0; i < t.gates.length; i++) {
    const gap = (i + 1 < t.gates.length ? t.gates[i + 1]!.s : t.length) - t.gates[i]!.s;
    min = Math.min(min, gap);
    max = Math.max(max, gap);
  }
  return { min, max };
}

/** Largest |curvature| (1/m) within `reach` m either side of any main gate, and that gate's index. */
export function gateCurvature(t: Track, reach: number): { max: number; gate: number } {
  const p = t.path;
  const span = Math.round(reach / (t.length / p.count));
  let max = 0;
  let gate = -1;
  for (const [i, g] of t.gates.entries()) {
    const k0 = sampleAt(p, g.s);
    for (let d = -span; d <= span; d++) {
      const c = Math.abs(p.curv[(k0 + d + p.count) % p.count]!);
      if (c > max) [max, gate] = [c, i];
    }
  }
  return { max, gate };
}

/** Closest (m) any main gate comes to a shortcut's mouth or exit. */
export function mouthClearance(t: Track): { min: number; what: string } {
  let min = Infinity;
  let what = "none";
  for (const m of mouthsOf(t)) {
    for (const [i, g] of t.gates.entries()) {
      const d = ring(g.s, m.s, t.length);
      if (d < min) [min, what] = [d, `gate ${i} to ${m.id} ${m.end}`];
    }
  }
  return { min, what };
}

/** Angle (deg) between the loop's tangent at its last sample and at its first. */
export function seamDegrees(t: Track): number {
  const p = t.path;
  const n = p.count - 1;
  return (Math.acos(Math.min(1, p.tx[n]! * p.tx[0]! + p.tz[n]! * p.tz[0]!)) * 180) / Math.PI;
}

/** Widest s-gap (m) between consecutive gates of any shortcut. */
export function shortcutGateGap(t: Track): { max: number; id: string } {
  let max = 0;
  let id = "none";
  for (const sc of t.shortcuts) {
    for (let i = 1; i < sc.gates.length; i++) {
      const gap = sc.gates[i]!.s - sc.gates[i - 1]!.s;
      if (gap > max) [max, id] = [gap, sc.id];
    }
  }
  return { max, id };
}

/** Per unordered shortcut: its length and the main-loop span (m) between its `from` and `to` gates. */
export function shortcutSpans(t: Track): { id: string; length: number; span: number }[] {
  return t.shortcuts
    .filter((sc) => !sc.ordered)
    .map((sc) => {
      const end = sc.to === 0 ? t.length : t.gates[sc.to]!.s;
      return { id: sc.id, length: sc.path.length, span: end - t.gates[sc.from]!.s };
    });
}

/** Samples of the main loop whose turn radius is under `max(1.5 x width, 20 m)`: how many, and the tightest radius (m) and its arc length. */
export function narrowTurns(t: Track): { count: number; radius: number; s: number } {
  const p = t.path;
  const ds = t.length / p.count;
  let count = 0;
  let radius = Infinity;
  let s = 0;
  for (let k = 0; k < p.count; k++) {
    const c = Math.abs(p.curv[k]!);
    if (c < 1e-6) continue;
    const r = 1 / c;
    if (r >= Math.max(3 * p.half[k]!, 20)) continue;
    count++;
    if (r < radius) [radius, s] = [r, k * ds];
  }
  return { count, radius, s };
}

/** Main-loop samples with |curvature| above this (1/m) are corners. */
const CORNER = 1 / 150;
/** The outward walk's step and its longest reach (m); a walk that finds nothing reports `WALK_MAX`. */
const WALK_STEP = 1;
export const WALK_MAX = 800;
/** The walk is a car wide: a solid within this many metres of its line stops it. */
const CAR_HALF = 0.5;
/** Samples of the loop this near (m of arc) to a corner sample are its own road, never "another road". */
const OWN_ARC = 80;
const CELL = 16;

type Corridors = { cells: Map<number, number[]>; paths: TrackPath[]; reach: number };

/** Every sample of every path in a hash of `CELL` m cells, the list holding path and sample index packed. */
function corridorsOf(t: Track): Corridors {
  const cells = new Map<number, number[]>();
  const paths = t.paths();
  let reach = 0;
  for (const [pi, p] of paths.entries()) {
    for (let k = 0; k < p.count; k++) {
      reach = Math.max(reach, p.half[k]! + Math.max(p.runL[k]!, p.runR[k]!));
      const key = Math.floor(p.x[k]! / CELL) * 65536 + Math.floor(p.z[k]! / CELL);
      let list = cells.get(key);
      if (!list) cells.set(key, (list = []));
      list.push(pi * 1e6 + k);
    }
  }
  return { cells, paths, reach };
}

/** Whether (x, z) lies in the road + runoff of a path sample other than the main loop's own stretch within `OWN_ARC` of `k0`. */
function inOtherRoad(c: Corridors, t: Track, k0: number, x: number, z: number): boolean {
  const span = Math.ceil(c.reach / CELL);
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  const ownSamples = OWN_ARC / (t.length / t.path.count);
  for (let i = cx - span; i <= cx + span; i++) {
    for (let j = cz - span; j <= cz + span; j++) {
      for (const packed of c.cells.get(i * 65536 + j) ?? []) {
        const pi = Math.floor(packed / 1e6);
        const k = packed - pi * 1e6;
        const p = c.paths[pi]!;
        if (pi === 0) {
          const d = Math.abs(k - k0);
          if (Math.min(d, p.count - d) < ownSamples) continue;
        }
        const r = p.half[k]! + Math.max(p.runL[k]!, p.runR[k]!);
        if ((p.x[k]! - x) ** 2 + (p.z[k]! - z) ** 2 < r * r) return true;
      }
    }
  }
  return false;
}

/**
 * For each main-loop corner sample whose outside has no wall: how far (m) a `CAR_HALF`-wide walk along the outward normal, from the
 * edge of the road and runoff, goes before it meets a solid prop, a wall piece or another road. Returns the longest such run, and how
 * many walks met nothing within `WALK_MAX` (`unbounded`): a course whose longest run is the cap is pinned by that count.
 */
export function outsideExposure(t: Track): { worst: number; s: number; x: number; z: number; corners: number; unbounded: number } {
  const p = t.path;
  const ds = t.length / p.count;
  const out = { worst: 0, s: 0, x: 0, z: 0, corners: 0, unbounded: 0 };
  const open: number[] = [];
  for (let k = 0; k < p.count; k++) {
    const curv = p.curv[k]!;
    if (Math.abs(curv) > CORNER && !(curv < 0 ? p.wallL[k] : p.wallR[k])) open.push(k);
  }
  out.corners = open.length;
  if (open.length === 0) return out;
  // Placing a course's scenery is its dominant cost, so a course with no open corner never does.
  const walls = wallColliders(t);
  const props = propColliders(placeProps(t));
  const solids = solidsOf(walls, props);
  const roads = corridorsOf(t);
  const hit = (x: number, z: number): boolean => {
    const n = solids.prismsNear(x, z, CAR_HALF);
    for (let q = 0; q < n; q++) {
      const i = solids.nearList[q]!;
      const c = i < walls.length ? walls[i]! : props[i - walls.length]!;
      if (c.body === "knock") continue;
      const dx = x - c.x;
      const dz = z - c.z;
      if (c.kind === "circle") {
        if (Math.hypot(dx, dz) <= c.hx + CAR_HALF) return true;
        continue;
      }
      const cos = Math.cos(c.yaw);
      const sin = Math.sin(c.yaw);
      if (Math.abs(dx * cos - dz * sin) <= c.hx + CAR_HALF && Math.abs(dx * sin + dz * cos) <= c.hz + CAR_HALF) return true;
    }
    return false;
  };
  for (const k of open) {
    const left = p.curv[k]! < 0;
    // Left of travel is (tz, -tx); a right turn has its outside on the left.
    const side = left ? 1 : -1;
    const nx = side * p.tz[k]!;
    const nz = -side * p.tx[k]!;
    const edge = p.half[k]! + (left ? p.runL[k]! : p.runR[k]!);
    let run = 0;
    while (run < WALK_MAX) {
      const x = p.x[k]! + nx * (edge + run);
      const z = p.z[k]! + nz * (edge + run);
      if (hit(x, z) || inOtherRoad(roads, t, k, x, z)) break;
      run += WALK_STEP;
    }
    if (run >= WALK_MAX) out.unbounded++;
    if (run > out.worst) Object.assign(out, { worst: run, s: k * ds, x: p.x[k]! + nx * edge, z: p.z[k]! + nz * edge });
  }
  return out;
}

/** Declared mouths' reach (m): an opening in a wall line this near a shortcut's mouth or exit is the mouth's own. */
const MOUTH_SLACK = 30;

/** Gaps in the main loop's wall lines (an open run with wall at both ends) that no shortcut mouth or exit explains: side, start s, length (m). */
export function undeclaredWallGaps(t: Track): { side: "left" | "right"; s: number; length: number }[] {
  const p = t.path;
  const n = p.count;
  const ds = t.length / n;
  const mouths = mouthsOf(t);
  const out: { side: "left" | "right"; s: number; length: number }[] = [];
  for (const [side, flag] of [["left", p.wallL], ["right", p.wallR]] as const) {
    const first = flag.findIndex((f) => f === 1);
    if (first < 0) continue;
    for (let i = 0; i < n; i++) {
      const a = (first + i) % n;
      if (flag[a] === 1 || flag[(a - 1 + n) % n] === 0) continue;
      let len = 0;
      while (flag[(a + len) % n] === 0) len++;
      const s0 = a * ds;
      const s1 = (a + len) * ds;
      if (!mouths.some((m) => ring(m.s, (s0 + s1) / 2, t.length) <= (s1 - s0) / 2 + MOUTH_SLACK)) out.push({ side, s: s0, length: len * ds });
    }
  }
  return out;
}
