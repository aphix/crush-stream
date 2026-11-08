import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import { PREFABS, type PrefabId } from "./catalog.ts";
import { BIOME, BIOME_IDS, PREFAB, SCENERY_RULES, type BiomeId } from "./constants.ts";
import type { Placed } from "./placements.ts";
import { ISLAND_CHANCE_MAX, ISLANDS, LAMP_SPACING, SLAB_WIDTH, VERGE, VERGE_CHANCE_MAX, VERGE_REACH, defaultBiome, noGenOf, pickKind, zoneAt, zonesOf, type Zone } from "./scenery-biome.ts";
import { OCC_PAD, Occupancy, SEG_COVERED, blankNear, buildField, hashString, mix, nearest, unit, type Near, type RoadField } from "./scenery-field.ts";
import { OPEN_REACH, type Track, type TrackPath } from "./track.ts";
import { NO_FLOOR } from "./ground.ts";

/**
 * The scenery service: dresses a course from its geometry alone, deterministically, with no per-course editing. `placeScenery` reads the
 * compiled track (every road's wall line, which wall stands, the surfaces, the terrain) and the props already placed (`placeProps`'s
 * hand props, `along` rows and scatter) and returns what to add, in two lists:
 *   - `solid`: props a car can reach (within `OPEN_REACH` of a road edge whose wall is down): colliders, appended to the course's
 *     props after its chevrons, so no existing index moves;
 *   - `drawn`: everything else (behind a wall, the sidewalks, the bushes and flower beds a car drives through): art only.
 * A point's value depends on its own cell (`mix` of the course id, the rule and the cell), never on the points before it; the
 * course's `scenery.off`, `clear` and `noGen` only remove from the finished list, so raising `clear` always yields a subset.
 * Rules (`SCENERY_RULES`): paving along a city's roads and a circuit's; the frontage's lamps (spacing by biome, a city's from its building
 * bays; none where a hand lamp row already lights) and a city's street trees; the verge; flower beds and bushes inside loops;
 * circuit tyre and cone runs outside tight bends.
 */

type Scenery = { solid: Placed[]; drawn: Placed[] };

const [RULE_PAVING, RULE_FRONTAGE, RULE_VERGE, RULE_ISLANDS, RULE_TRACKSIDE] = [0, 1, 2, 3, 4] as const;

/** Clear ground (m) between a generated footprint and any road's wall line. */
const ROAD_STANDOFF = 0.4;
/** Clear ground (m) between two footprints. */
const PROP_STANDOFF = 0.6;
/** A point where the ground's top layer stands this far (m) over its lowest is under a bridge or on a plateau: nothing stands there. */
const ELEVATED = 0.5;
/** A slab's inner corners may sit this far (m) over the wall line. */
const EDGE_TOLERANCE = 0.05;
/** Lateral offset (m) of a lamp from the wall line: clear of `ROAD_STANDOFF` and the pole's radius, inside the hand lamp rows' 0.4 to 1.5. */
const LAMP_OFFSET = 0.8;
/** Share of a lamp spacing within which an existing lamp already lights the stretch. */
const LIT_SHARE = 0.7;
/** Re-test distance (m) along a road where a station found no biome to dress. */
const RETRY_STEP = 8;
/** Spacing (m) of a city's street trees, and their scale range (a young plane tree under the lamps' 4.4 m). */
const TREE_SPACING = 16;
const TREE_SCALE = 0.55;
const TREE_SCALE_SPAN = 0.2;
/** Station spacing jitter: a share of the spacing either way. */
const SPACING_JITTER = 0.1;
/** Frontage buildings within this far (m) of a wall line set a city's lamp spacing; at least `BAY_MIN` of them on the road. */
const BAY_REACH = 14;
const BAY_MIN = 3;
/** A city's lamp spacing is two building bays, within these bounds (m): about 25 to 30 m in town. */
const BAY_LAMPS_MIN = 24;
const BAY_LAMPS_MAX = 30;
/** Lattice cell (m) of the verge and the share of the scale range its props take (0.8 to 1.3). */
const VERGE_CELL = 14;
const PROP_SCALE = 0.8;
const PROP_SCALE_SPAN = 0.5;
/** Islands: lattice cell (m), the clear ground (m) kept from every wall line, the most props per loop, and the polygon's samples. */
const ISLAND_CELL = 10;
const ISLAND_MARGIN = 4;
const ISLAND_MAX = 160;
const ISLAND_POLY = 200;
/** Circuit bends: a bend tighter than this radius (m) gets a lining of `TYRE_RUN` tyre stacks `TYRE_GAP` m apart, and `CONE_RUN` cones `CONE_GAP` m apart leading into it. */
const BEND_RADIUS = 60;
const TYRE_RUN = 8;
const TYRE_GAP = 1;
const CONE_RUN = 3;
const CONE_GAP = 3;
/** A small flower bed's scale and its distance (m) inboard of the bend's inner wall line. */
const BED_SCALE = 1.6;
const BED_OFFSET = 9;
/** Samples (about m) of straighter road that still belong to one bend: an arc's curvature wavers round the threshold. */
const BEND_MERGE = 24;
/** Standoff (m) of the bend's tyres and cones from the wall line. */
const BEND_OFFSET = 1.2;
/** The first lamp of a road stands within this far (m) of its start (a hash picks), so rows on two roads do not start together. */
const LAMP_PHASE = 24;
/** Lattice cell (m) of the lamp lookup. */
const LAMP_CELL = 32;
/** A circuit's car park behind a grandstand: the gap (m) from the stand's back, the paved patch's depth, the rows' distance from its middle and the cars' pitch along it, the cars' core radius against other props, and the share left empty. */
const CAR_PARK_GAP = 2;
const CAR_PARK_DEPTH = 14;
const CAR_ROW = 3.5;
const CAR_PITCH = 2.6;
const CAR_CORE = 0.9;
const CAR_SKIP = 0.25;
/** A circuit's infield: the big bed's scale and the ring of bushes round it (count, radius m), and the hedge along the inner road edge (offset from the wall line m, spacing m). */
const FOCAL_SCALE = 3.2;
const FOCAL_RING = 6;
const FOCAL_RADIUS = 6.5;
const HEDGE_OFFSET = 1.6;
const HEDGE_GAP = 2.4;
/** The verge thins toward the road and thickens away from it: the share of its chance at the near edge and at the far edge (mean 1). */
const VERGE_RAMP_MIN = 0.2;
const VERGE_RAMP_MAX = 1.8;

/** A point to put a prop at beside a road. */
type Spot = { x: number; z: number; yaw: number; w: number };

type Meta = { rule: number; dc: number };

type Ctx = {
  track: Track;
  field: RoadField;
  occ: Occupancy;
  /** The authored props (`placeProps`'s, before any scenery). */
  base: readonly Placed[];
  seed: number;
  zones: Zone[];
  /** The course's blanket biome (`scenery.biome`), null when each stretch is classified. */
  course: BiomeId | null;
  off: boolean[];
  density: number[];
  clear: number | null;
  blocked: (x: number, z: number) => boolean;
  near: Near;
  /** Scratch for `roadside`. */
  spot: Spot;
  /** Hand lamps: positions by `LAMP_CELL` cell, as x, z pairs. */
  lamps: Map<number, number[]>;
  /** Per path: the mean width along the street (m) of the frontage buildings, 0 with fewer than `BAY_MIN`. */
  bay: Float64Array;
  solid: Placed[];
  solidMeta: Meta[];
  drawn: Placed[];
  drawnMeta: Meta[];
};

function lampKey(i: number, j: number): number {
  return i * 65536 + j;
}

function newCtx(track: Track, base: readonly Placed[]): Ctx {
  const spec = track.json.scenery;
  const field = buildField(track);
  const c: Ctx = {
    track,
    field,
    occ: new Occupancy(),
    base,
    seed: hashString(track.id),
    zones: zonesOf(track),
    course: spec?.biome ?? null,
    off: SCENERY_RULES.map((r) => spec?.off.includes(r) ?? false),
    density: SCENERY_RULES.map((r) => spec?.density[r] ?? 1),
    clear: spec?.clear ?? null,
    blocked: noGenOf(track),
    near: blankNear(),
    spot: { x: 0, z: 0, yaw: 0, w: 0 },
    lamps: new Map(),
    bay: new Float64Array(field.paths.length),
    solid: [],
    solidMeta: [],
    drawn: [],
    drawnMeta: [],
  };
  const bays = new Float64Array(field.paths.length);
  const counts = new Int32Array(field.paths.length);
  for (const p of base) {
    const size = PREFABS[p.prefab].size;
    const yaw = p.yaw;
    c.occ.add(p.x, p.z, detCos(yaw), detSin(yaw), (size[0] * p.sx) / 2, (size[2] * p.sz) / 2);
    if (p.prefab === PREFAB.lamp) {
      const key = lampKey(Math.floor(p.x / LAMP_CELL), Math.floor(p.z / LAMP_CELL));
      const list = c.lamps.get(key);
      if (list) list.push(p.x, p.z);
      else c.lamps.set(key, [p.x, p.z]);
    } else if (p.prefab === PREFAB.building || p.prefab === PREFAB.stucco) {
      nearest(field, p.x, p.z, c.near);
      if (c.near.seg >= 0 && c.near.gap < BAY_REACH) {
        const pi = field.path[c.near.seg]!;
        bays[pi] = bays[pi]! + size[2] * p.sz;
        counts[pi] = counts[pi]! + 1;
      }
    }
  }
  for (let pi = 0; pi < bays.length; pi++) c.bay[pi] = counts[pi]! >= BAY_MIN ? bays[pi]! / counts[pi]! : 0;
  return c;
}

/** The biome at (x, z) whose nearest road segment is `seg`: a zone's, else the course's, else the stretch's own. */
function biomeAt(c: Ctx, x: number, z: number, seg: number): BiomeId {
  return zoneAt(c.zones, x, z) ?? c.course ?? BIOME_IDS[c.field.biome[seg]!]!;
}

/** Whether a lamp already stands within `radius` of (x, z). */
function lit(c: Ctx, x: number, z: number, radius: number): boolean {
  for (let i = Math.floor((x - radius) / LAMP_CELL); i <= Math.floor((x + radius) / LAMP_CELL); i++) {
    for (let j = Math.floor((z - radius) / LAMP_CELL); j <= Math.floor((z + radius) / LAMP_CELL); j++) {
      const list = c.lamps.get(lampKey(i, j));
      if (!list) continue;
      for (let n = 0; n < list.length; n += 2) if (hypot2(list[n]! - x, list[n + 1]! - z) < radius) return true;
    }
  }
  return false;
}

/** Height (m) a prop stands at (x, z), or null where the ground is absent or a bridge or plateau covers it. */
function standAt(c: Ctx, x: number, z: number): number | null {
  const ground = c.track.ground();
  const low = ground.heightAt(x, z, -1e9);
  if (low === NO_FLOOR || ground.heightAt(x, z) - low >= ELEVATED) return null;
  return low;
}

function record(c: Ctx, solid: boolean, p: Placed, rule: number, dc: number): void {
  (solid ? c.solid : c.drawn).push(p);
  (solid ? c.solidMeta : c.drawnMeta).push({ rule, dc });
}

/**
 * Stand `prefab` at (x, z) if its footprint clears every road's wall line and every footprint standing, on level ground that no
 * bridge covers. It goes in `solid` when it has a body, a car can leave the road toward it (the wall is down within `OPEN_SPAN`
 * on that side) and it is within `OPEN_REACH` of the wall line; else in `drawn`. A `core` radius (m) tests that circle alone, with
 * no margin, and leaves no footprint: parked cars, which stand close in rows, clear what stands but not each other.
 */
function place(c: Ctx, rule: number, prefab: PrefabId, x: number, z: number, yaw: number, scale: number, core?: number): boolean {
  const near = nearest(c.field, x, z, c.near);
  if (near.seg >= 0 && (c.field.flags[near.seg]! & SEG_COVERED) !== 0) return false;
  const size = PREFABS[prefab].size;
  const hx = (size[0] * scale) / 2;
  const hz = (size[2] * scale) / 2;
  const r = core ?? hypot2(hx, hz);
  const margin = core === undefined ? PROP_STANDOFF : 0;
  if (r + margin > OCC_PAD) throw new Error(`scenery: ${prefab} at scale ${scale} is wider than the occupancy pad`);
  if (near.gap < r + ROAD_STANDOFF || c.occ.hits(x, z, r, margin)) return false;
  const y = standAt(c, x, z);
  if (y === null) return false;
  if (core === undefined) c.occ.add(x, z, detCos(yaw), detSin(yaw), hx, hz);
  record(c, PREFABS[prefab].body !== "none" && near.openGap < OPEN_REACH, { prefab, x, y, z, yaw, sx: scale, sy: scale, sz: scale }, rule, near.dc);
  return true;
}

/** The spot `off` m beyond the wall line on `side` (+1 left, −1 right) of sample `k` of `p`, facing the road. */
function roadside(p: TrackPath, k: number, side: 1 | -1, off: number, out: Spot): Spot {
  out.w = side > 0 ? p.half[k]! + p.runL[k]! : p.half[k]! + p.runR[k]!;
  const lat = side * (out.w + off);
  out.x = p.x[k]! + p.tz[k]! * lat;
  out.z = p.z[k]! - p.tx[k]! * lat;
  out.yaw = detAtan2(p.tx[k]!, p.tz[k]!) + (side > 0 ? Math.PI : 0);
  return out;
}

/** Walk path `pi`: `visit(seg, k)` at the first station `first` m along and then wherever it says (the metres to the next). */
function march(c: Ctx, pi: number, first: number, visit: (seg: number, k: number) => number): void {
  const f = c.field;
  const base = f.base[pi]!;
  const segs = f.base[pi + 1]! - base;
  let arc = 0;
  let next = first;
  for (let k = 0; k < segs; k++) {
    if (arc >= next) next = arc + visit(base + k, k);
    arc += f.len[base + k]!;
  }
}

function stationUnit(c: Ctx, rule: number, seg: number, side: number, n: number): number {
  return unit(mix(mix(c.seed, rule), mix(seg * 2 + (side > 0 ? 1 : 0), n)));
}

/** Rule 1: a city's roads edged with sidewalk slabs and a circuit's with a wider apron, drawn only, from the wall line out; none where a crossing road would be paved over. */
function sidewalks(c: Ctx): void {
  const [width, , length] = PREFABS[PREFAB.sidewalk].size;
  for (let pi = 0; pi < c.field.paths.length; pi++) {
    const p = c.field.paths[pi]!;
    for (const side of [1, -1] as const) {
      march(c, pi, 0, (seg, k) => {
        const probe = roadside(p, k, side, width / 2, c.spot);
        const wide = SLAB_WIDTH[biomeAt(c, probe.x, probe.z, seg)];
        if (wide === undefined) return RETRY_STEP;
        const spot = roadside(p, k, side, (width * wide) / 2, c.spot);
        slab(c, spot, p.tx[k]!, p.tz[k]!, wide, RULE_PAVING);
        return length;
      });
    }
  }
}

/** A slab (`PREFABS.sidewalk`, `wide` times its width) centred on `spot` with its length along (tx, tz), if all four corners are off every road. */
function slab(c: Ctx, spot: Spot, tx: number, tz: number, wide: number, rule: number, longer = 1): boolean {
  const [width, , length] = PREFABS[PREFAB.sidewalk].size;
  const hw = (width * wide) / 2;
  const hl = (length * longer) / 2;
  const centre = nearest(c.field, spot.x, spot.z, c.near);
  const dc = centre.dc;
  if (centre.seg < 0 || (c.field.flags[centre.seg]! & SEG_COVERED) !== 0) return false;
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      const cx = spot.x + a * tx * hl + b * tz * hw;
      const cz = spot.z + a * tz * hl - b * tx * hw;
      if (nearest(c.field, cx, cz, c.near).gap < -EDGE_TOLERANCE) return false;
    }
  }
  const y = standAt(c, spot.x, spot.z);
  if (y === null) return false;
  record(c, false, { prefab: PREFAB.sidewalk, x: spot.x, y, z: spot.z, yaw: detAtan2(tx, tz), sx: wide, sy: 1, sz: longer }, rule, dc);
  return true;
}

/** A road's lamp spacing (m) in `biome`: a city's two building bays of the street when it has a frontage (within the 24 to 30 m a town's lamps keep), else the biome's own; 0 where the biome has none. */
function lampSpacing(c: Ctx, biome: BiomeId, pi: number): number {
  const bay = c.bay[pi]!;
  if (biome === BIOME.city && bay > 0) return Math.min(BAY_LAMPS_MAX, Math.max(BAY_LAMPS_MIN, 2 * bay));
  return LAMP_SPACING[biome] ?? 0;
}

/** Rule 2: lamps along every road's wall line, skipping a stretch a hand lamp row already lights, then a city's street trees. */
function frontage(c: Ctx): void {
  if (c.density[RULE_FRONTAGE]! <= 0) return;
  const [tw, , td] = PREFABS[PREFAB.tree].size;
  for (let pi = 0; pi < c.field.paths.length; pi++) {
    const p = c.field.paths[pi]!;
    for (const side of [1, -1] as const) {
      march(c, pi, stationUnit(c, RULE_FRONTAGE, c.field.base[pi]!, side, 0) * LAMP_PHASE + (side < 0 ? LAMP_PHASE : 0), (seg, k) => {
        const spot = roadside(p, k, side, LAMP_OFFSET, c.spot);
        const biome = biomeAt(c, spot.x, spot.z, seg);
        const spacing = lampSpacing(c, biome, pi);
        if (spacing <= 0) return RETRY_STEP;
        if (!lit(c, spot.x, spot.z, spacing * LIT_SHARE)) place(c, RULE_FRONTAGE, PREFAB.lamp, spot.x, spot.z, spot.yaw, 1);
        const jitter = 1 + (stationUnit(c, RULE_FRONTAGE, seg, side, 1) - 0.5) * 2 * SPACING_JITTER;
        // Beyond town the two sides take alternate lamps: one row's spacing in all.
        return (spacing * jitter * (biome === BIOME.city ? 1 : 2)) / c.density[RULE_FRONTAGE]!;
      });
      march(c, pi, stationUnit(c, RULE_FRONTAGE, c.field.base[pi]!, side, 2) * TREE_SPACING, (seg, k) => {
        const scale = TREE_SCALE + TREE_SCALE_SPAN * stationUnit(c, RULE_FRONTAGE, seg, side, 3);
        const crown = hypot2(tw * scale, td * scale) / 2;
        const spot = roadside(p, k, side, crown + ROAD_STANDOFF + PROP_STANDOFF, c.spot);
        if (biomeAt(c, spot.x, spot.z, seg) !== BIOME.city) return RETRY_STEP;
        place(c, RULE_FRONTAGE, PREFAB.tree, spot.x, spot.z, stationUnit(c, RULE_FRONTAGE, seg, side, 4) * 2 * Math.PI, scale);
        return TREE_SPACING / c.density[RULE_FRONTAGE]!;
      });
    }
  }
}

/** Rule 3: one jittered prop per lattice cell at most, in the biome's band beyond the wall line. */
function verge(c: Ctx): void {
  const density = c.density[RULE_VERGE]!;
  if (density <= 0) return;
  const b = c.track.bounds;
  const rule = mix(c.seed, RULE_VERGE);
  for (let i = Math.floor((b.minX - VERGE_REACH) / VERGE_CELL); i <= Math.ceil((b.maxX + VERGE_REACH) / VERGE_CELL); i++) {
    for (let j = Math.floor((b.minZ - VERGE_REACH) / VERGE_CELL); j <= Math.ceil((b.maxZ + VERGE_REACH) / VERGE_CELL); j++) {
      const seed = mix(rule, mix(i, j));
      const roll = unit(mix(seed, 0));
      if (roll >= VERGE_CHANCE_MAX * VERGE_RAMP_MAX * density) continue;
      const x = (i + unit(mix(seed, 1))) * VERGE_CELL;
      const z = (j + unit(mix(seed, 2))) * VERGE_CELL;
      const near = nearest(c.field, x, z, c.near);
      if (near.seg < 0) continue;
      const spec = VERGE[biomeAt(c, x, z, near.seg)];
      if (!spec || near.gap < spec.inner || near.gap > spec.outer) continue;
      const ramp = VERGE_RAMP_MIN + ((VERGE_RAMP_MAX - VERGE_RAMP_MIN) * (near.gap - spec.inner)) / (spec.outer - spec.inner);
      if (roll >= spec.chance * ramp * density) continue;
      place(c, RULE_VERGE, pickKind(spec.kinds, unit(mix(seed, 3))), x, z, unit(mix(seed, 4)) * 2 * Math.PI, PROP_SCALE + PROP_SCALE_SPAN * unit(mix(seed, 5)));
    }
  }
}

/** Whether (x, z) is inside the polygon (`px`, `pz`), by the even-odd rule (a figure-8's two lobes are two islands). */
function inside(px: readonly number[], pz: readonly number[], x: number, z: number): boolean {
  let in_ = false;
  for (let a = 0, b = px.length - 1; a < px.length; b = a++) {
    if (pz[a]! > z !== pz[b]! > z && x < ((px[b]! - px[a]!) * (z - pz[a]!)) / (pz[b]! - pz[a]!) + px[a]!) in_ = !in_;
  }
  return in_;
}

/** A closed path's outline as polygon vectors of at most `ISLAND_POLY` samples. */
function outline(p: TrackPath): { px: number[]; pz: number[] } {
  const stride = Math.max(1, Math.ceil(p.count / ISLAND_POLY));
  const px: number[] = [];
  const pz: number[] = [];
  for (let k = 0; k < p.count; k += stride) {
    px.push(p.x[k]!);
    pz.push(p.z[k]!);
  }
  return { px, pz };
}

/** Rule 4: flower beds and bushes on the ground a closed road (the loop, a roundabout) encloses, clear of every road. */
function islands(c: Ctx): void {
  const density = c.density[RULE_ISLANDS]!;
  if (density <= 0) return;
  for (let pi = 0; pi < c.field.paths.length; pi++) {
    const p = c.field.paths[pi]!;
    if (!p.closed) continue;
    const { px, pz } = outline(p);
    const rule = mix(mix(c.seed, RULE_ISLANDS), pi);
    let standing = 0;
    for (let i = Math.floor(Math.min(...px) / ISLAND_CELL); i <= Math.ceil(Math.max(...px) / ISLAND_CELL) && standing < ISLAND_MAX; i++) {
      for (let j = Math.floor(Math.min(...pz) / ISLAND_CELL); j <= Math.ceil(Math.max(...pz) / ISLAND_CELL) && standing < ISLAND_MAX; j++) {
        const seed = mix(rule, mix(i, j));
        const roll = unit(mix(seed, 0));
        if (roll >= ISLAND_CHANCE_MAX * density) continue;
        const x = (i + unit(mix(seed, 1))) * ISLAND_CELL;
        const z = (j + unit(mix(seed, 2))) * ISLAND_CELL;
        if (!inside(px, pz, x, z)) continue;
        const near = nearest(c.field, x, z, c.near);
        if (near.seg < 0 || near.gap < ISLAND_MARGIN) continue;
        const spec = ISLANDS[biomeAt(c, x, z, near.seg)];
        if (!spec || roll >= spec.chance * density) continue;
        if (place(c, RULE_ISLANDS, pickKind(spec.kinds, unit(mix(seed, 3))), x, z, unit(mix(seed, 4)) * 2 * Math.PI, PROP_SCALE + PROP_SCALE_SPAN * unit(mix(seed, 5)))) standing++;
      }
    }
  }
}

/** Rule 4 on a circuit's loop: one big flower bed with a ring of bushes at the middle of the infield, and a low hedge of bushes along the inner road edge. */
function infield(c: Ctx): void {
  const p = c.track.path;
  if (c.density[RULE_ISLANDS]! <= 0 || biomeAt(c, p.x[0]!, p.z[0]!, c.field.base[0]!) !== BIOME.circuit) return;
  const { px, pz } = outline(p);
  const cx = px.reduce((a, b) => a + b, 0) / px.length;
  const cz = pz.reduce((a, b) => a + b, 0) / pz.length;
  if (inside(px, pz, cx, cz) && place(c, RULE_ISLANDS, PREFAB.flowers, cx, cz, 0, FOCAL_SCALE)) {
    for (let n = 0; n < FOCAL_RING; n++) {
      const a = (n / FOCAL_RING) * 2 * Math.PI;
      place(c, RULE_ISLANDS, PREFAB.bush, cx + FOCAL_RADIUS * detSin(a), cz + FOCAL_RADIUS * detCos(a), a, 1);
    }
  }
  const probe = roadside(p, 0, 1, HEDGE_OFFSET, c.spot);
  const side = inside(px, pz, probe.x, probe.z) ? 1 : -1;
  march(c, 0, 0, (seg, k) => {
    const spot = roadside(p, k, side, HEDGE_OFFSET, c.spot);
    if (biomeAt(c, spot.x, spot.z, seg) === BIOME.circuit) place(c, RULE_ISLANDS, PREFAB.bush, spot.x, spot.z, spot.yaw, 1);
    return HEDGE_GAP;
  });
}

/** Rules 1 and 5: behind each of a circuit's grandstands a paved car park (paving) with two rows of parked cars (trackside; the junked shells, tinted), clear of every road. */
function carParks(c: Ctx): void {
  const [sw, , sd] = PREFABS[PREFAB.grandstand].size;
  const [pw, , pl] = PREFABS[PREFAB.sidewalk].size;
  for (const g of c.base) {
    if (g.prefab !== PREFAB.grandstand) continue;
    const at = nearest(c.field, g.x, g.z, c.near);
    if (at.seg < 0 || biomeAt(c, g.x, g.z, at.seg) !== BIOME.circuit) continue;
    // The stand's front is its local x, its length its local z.
    const fx = detCos(g.yaw);
    const fz = -detSin(g.yaw);
    const ax = detSin(g.yaw);
    const az = detCos(g.yaw);
    const length = sd * g.sz;
    const back = (sw * g.sx) / 2 + CAR_PARK_GAP + CAR_PARK_DEPTH / 2;
    const mx = g.x - fx * back;
    const mz = g.z - fz * back;
    c.spot.x = mx;
    c.spot.z = mz;
    if (!slab(c, c.spot, ax, az, CAR_PARK_DEPTH / pw, RULE_PAVING, length / pl)) continue;
    for (const row of [-CAR_ROW, CAR_ROW]) {
      for (let n = 0; n < Math.floor(length / CAR_PITCH); n++) {
        const t = (n + 0.5) * CAR_PITCH - length / 2;
        if (unit(mix(mix(c.seed, RULE_TRACKSIDE), mix(Math.round(g.x * 8) + n, Math.round(g.z * 8) + (row > 0 ? 1 : 0)))) < CAR_SKIP) continue;
        place(c, RULE_TRACKSIDE, PREFAB.wreck, mx + fx * row + ax * t, mz + fz * row + az * t, g.yaw + Math.PI / 2, 1, CAR_CORE);
      }
    }
    c.occ.add(mx, mz, detCos(g.yaw), detSin(g.yaw), CAR_PARK_DEPTH / 2, length / 2);
  }
}

/** Rule 5: on a circuit's tight bends of the race loop, a lining of tyre stacks at the apex on the outside, cones leading into it and a small flower bed inboard. */
function circuitBends(c: Ctx): void {
  const f = c.field;
  const p = c.track.path;
  const segs = f.base[1]! - f.base[0]!;
  const tight = 1 / BEND_RADIUS;
  const stride = (gap: number): number => Math.max(1, Math.round(gap / (p.length / segs)));
  for (let k = 0; k < segs; k++) {
    if (Math.abs(p.curv[k]!) <= tight) continue;
    let end = k;
    let apex = k;
    for (let ahead = end + 1; ahead < segs && ahead <= end + BEND_MERGE; ahead++) {
      if (Math.abs(p.curv[ahead]!) <= tight) continue;
      end = ahead;
      if (Math.abs(p.curv[end]!) > Math.abs(p.curv[apex]!)) apex = end;
    }
    const side = p.curv[apex]! > 0 ? -1 : 1;
    const lay = (prefab: PrefabId, at: number, off: number, scale: number): void => {
      const s = ((at % segs) + segs) % segs;
      const spot = roadside(p, s, side, off, c.spot);
      if (biomeAt(c, spot.x, spot.z, s) !== BIOME.circuit) return;
      place(c, RULE_TRACKSIDE, prefab, spot.x, spot.z, stationUnit(c, RULE_TRACKSIDE, s, side, 0) * 2 * Math.PI, scale);
    };
    for (let n = 0; n < TYRE_RUN; n++) lay(PREFAB.tyreStack, apex + Math.round((n - (TYRE_RUN - 1) / 2) * stride(TYRE_GAP)), BEND_OFFSET, 1);
    for (let n = 1; n <= CONE_RUN; n++) lay(PREFAB.cone, apex - Math.round(TYRE_RUN / 2) * stride(TYRE_GAP) - n * stride(CONE_GAP), BEND_OFFSET, 1);
    const bed = roadside(p, apex, side > 0 ? -1 : 1, BED_OFFSET, c.spot);
    if (biomeAt(c, bed.x, bed.z, apex) === BIOME.circuit) place(c, RULE_TRACKSIDE, PREFAB.flowers, bed.x, bed.z, bed.yaw, BED_SCALE);
    k = end;
  }
}

/** `list` less what the course's `scenery` block takes out: switched-off rules, `noGen` ground, and anything nearer a centreline than `clear`. */
function kept(c: Ctx, list: readonly Placed[], meta: readonly Meta[]): Placed[] {
  const out: Placed[] = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i]!;
    const m = meta[i]!;
    if (c.off[m.rule] || c.blocked(p.x, p.z) || (c.clear !== null && m.dc < c.clear)) continue;
    out.push(p);
  }
  return out;
}

/**
 * What the course's geometry says to add to `base` (`placeProps`'s hand props, `along` rows, scatter and chevrons, in order): the
 * solid props to append to it, and the drawn-only ones. Pure in (track, base).
 */
export function placeScenery(track: Track, base: readonly Placed[]): Scenery {
  const c = newCtx(track, base);
  if (c.course === BIOME.none && c.zones.length === 0) return { solid: [], drawn: [] };
  sidewalks(c);
  frontage(c);
  circuitBends(c);
  carParks(c);
  infield(c);
  verge(c);
  islands(c);
  return { solid: kept(c, c.solid, c.solidMeta), drawn: kept(c, c.drawn, c.drawnMeta) };
}

/** The share `keep` (0 to 1) of `drawn` a lower effects tier draws, by a hash of each prop's spot: every lower share is a subset of the higher. */
export function thinScenery(drawn: readonly Placed[], keep: number): Placed[] {
  return drawn.filter((p) => unit(mix(Math.round(p.x * 16), Math.round(p.z * 16))) < keep);
}

/** The biome at any world point, as the rules read it: a zone's, else the course's `scenery.biome`, else the nearest road stretch's (a point past every road takes the course's own road and terrain). */
export function biomeLookup(track: Track): (x: number, z: number) => BiomeId {
  const field = buildField(track);
  const zones = zonesOf(track);
  const near = blankNear();
  const road = track.json.road;
  const open = track.json.scenery?.biome ?? defaultBiome(track.json.environment.terrain, road.surface, road.runoffSurface);
  return (x, z) => {
    const seg = nearest(field, x, z, near).seg;
    return zoneAt(zones, x, z) ?? (seg < 0 ? open : (track.json.scenery?.biome ?? BIOME_IDS[field.biome[seg]!]!));
  };
}
