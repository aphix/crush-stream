import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import { PREFABS, type PrefabId } from "./catalog.ts";
import { BIOME, BIOME_IDS, PREFAB, SCENERY_RULES, type BiomeId } from "./constants.ts";
import type { Placed } from "./placements.ts";
import { SCENERY_ASSETS } from "./scenery-assets/index.ts";
import { LATTICE_RULES, assetPrefab, assetScale, hasAssets, pickAsset, sceneryRule, standsIn, type AssetMode, type LatticeRule } from "./scenery-assets/pick.ts";
import type { AssetRule, SceneryAsset } from "./scenery-assets/types.ts";
import { ASSET_LATTICE, FRONTAGE_SPACING, ISLAND_CHANCE_MAX, ISLANDS, LAMP_SPACING, PATCH_LATTICE, SLAB_WIDTH, VERGE, VERGE_CHANCE_MAX, VERGE_REACH, defaultBiome, noGenOf, pickKind, zoneAt, zonesOf, type Zone } from "./scenery-biome.ts";
import { ROAD_DECAL, ROAD_DECAL_ASSET, type RoadDecalName } from "./scenery-assets/types.ts";
import { OCC_PAD, Occupancy, SEG_COVERED, blankNear, buildField, crossGap, hashString, mix, nearest, unit, type Near, type RoadField } from "./scenery-field.ts";
import type { Track, TrackPath } from "./track.ts";
import { NO_FLOOR } from "./ground.ts";

/**
 * The scenery service: dresses a course from its geometry alone, deterministically, with no per-course editing. `placeScenery` reads the
 * compiled track (every road's wall line, which wall stands, the surfaces, the terrain) and the props already placed (`placeProps`'s
 * hand props, `along` rows and scatter) and returns what to add, in two lists:
 *   - `solid`: props with a body (tree, rock, palm, lamp, tyre stack, cone) wherever a road edge whose wall is down lies within `SOLID_REACH`: a car leaving the
 *     road there drives on across the terrain. Colliders, appended to the course's props after its chevrons, so no existing index moves;
 *   - `drawn`: everything else (behind a wall, the sidewalks, the bushes and flower beds a car drives through): art only.
 * A point's value depends on its own cell (`mix` of the course id, the rule and the cell), never on the points before it; the
 * course's `scenery.off`, `clear` and `noGen` only remove from the finished list, so raising `clear` always yields a subset.
 * Rules (`SCENERY_RULES`): paving along a city's roads and a circuit's; the frontage's lamps (spacing by biome, a city's from its building
 * bays; none where a hand lamp row already lights) and a city's street trees; the verge; flower beds and bushes inside loops;
 * circuit tyre and cone runs outside tight bends.
 * Last of all `assets` stands the generated sprite assets (`SCENERY_ASSETS`) by their own rules and kinds: on lattices, in rows and at
 * stations along the wall lines, flat on the road surface and on car park slabs.
 */

type Scenery = { solid: Placed[]; drawn: Placed[] };

const [RULE_PAVING, RULE_FRONTAGE, RULE_VERGE, RULE_ISLANDS, RULE_TRACKSIDE] = [0, 1, 2, 3, 4] as const;

/** Clear ground (m) between a generated footprint and any road's wall line. */
const ROAD_STANDOFF = 0.4;
/** A prop with a body is solid wherever a road edge whose wall is down lies within this far (m): the widest verge band, as far as a car that leaves the road through an opening drives on and meets the authored scatter's trees. */
const SOLID_REACH = VERGE_REACH;
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
/** Spacing (m) of a city's street trees (formal rows run 7 to 10 m, .extraResearch/perplexity/2026-11-08-*.md), and their scale range (a young plane tree under the lamps' 4.4 m). */
const TREE_SPACING = 10;
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
/** Assets: a sprite stands at its own size times a factor from `ASSET_SCALE` over `ASSET_SCALE_SPAN`, so a row of one asset is not a row of copies. */
const ASSET_SCALE = 0.85;
const ASSET_SCALE_SPAN = 0.3;
/** A card or box on a lattice turns this far (rad) either way from square-on to the road: a field's fence is never ruler-straight. */
const FACE_JITTER = 0.3;
/** Frontage assets: the chance a station holds one, and the clear gap (m) between its footprint circle and the wall line (`FRONT_GAP` over a span of `FRONT_GAP_SPAN`). */
const FRONT_CHANCE = 0.55;
const FRONT_GAP = 1;
const FRONT_GAP_SPAN = 1.5;
/** Islands: the share of the loop's own prop chance an asset cell holds, and the most assets a loop takes. */
const ISLAND_ASSET_SHARE = 0.5;
const ISLAND_ASSET_MAX = 90;
/** Trackside rows on the race loop's outside: metres between row starts, the chance a start holds a row, the most assets in a row, the gap (m) between neighbours, the clear gap (m) from the wall line, and how far out (m) the probe tests the loop's inside. */
const ROW_SPACING = 40;
const ROW_CHANCE = 0.7;
const ROW_MAX = 4;
const ROW_GAP = 0.8;
const ROW_OFFSET = 1.2;
const ROW_PROBE = 3;
/**
 * Road paint a course opts into (`scenery.roadDecals`): metres between stations along a road (a manhole cover every 90 to 120 m, a kerb stripe every 40; a crosswalk and an arrow
 * are looked for every 3 m on the way to a junction), and how far a spacing wanders either way (a share of it).
 */
const ROAD_DECAL_SPACING: Record<RoadDecalName, number> = { manhole: 105, crosswalk: 3, arrow: 3, kerb: 40 };
const ROAD_DECAL_SPAN = 1 / 7;
/** A cover's centre lies this far (m) from the centre line (a lane boundary, between two cars' wheel tracks), or this far inside the edge line (the gutter side, on alternating sides), wavering by this much (m) in all. */
const MANHOLE_DASH_OFFSET = 0.9;
const MANHOLE_EDGE_CLEAR = 1.5;
const MANHOLE_WOBBLE = 0.3;
/** Manholes and kerb stripes keep this far (m) from another road's wall line (a junction), and a loop's start line this far (m). */
const JUNCTION_CLEAR = 12;
const START_LINE_CLEAR = 6;
/** A crosswalk is laid where a road comes within these gaps (m) of another's wall line, an arrow on the way to a junction within these; each is not laid again for the next metres. */
const CROSSWALK_GAP: readonly [number, number] = [10, 14];
const ARROW_GAP: readonly [number, number] = [12, 25];
const CROSSWALK_REST = 20;
const ARROW_REST = 30;
/** How far (m) ahead along the road an arrow looks to tell whether it is on the way to a junction. */
const LOOK_AHEAD = 4;
/** The one road paint a course without `roadDecals` has, and the one biome it lies in: a manhole cover on a city's roads. */
const DEFAULT_ROAD_DECAL: RoadDecalName = ROAD_DECAL.manhole;
/** Car park paint: metres between slots along the slab, the chance a slot holds one, and the lanes across it (the aisle and the two rows of bays). */
const LOT_PITCH = 7;
const LOT_CHANCE = 0.4;
const LOT_LANES = 3;

/** A point to put a prop at beside a road. */
type Spot = { x: number; z: number; yaw: number; w: number };

type Meta = { rule: number; dc: number };

/** A car park slab `carParks` laid: its middle, the unit vectors along its length and across its depth, and its length (m). */
type Lot = { x: number; z: number; ax: number; az: number; fx: number; fz: number; length: number };

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
  lots: Lot[];
  /** The road paint laid, each with the one biome it is limited to (null: wherever its row stands). */
  roadDecals: { name: RoadDecalName; only: BiomeId | null }[];
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
    density: SCENERY_RULES.map(() => 1),
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
    lots: [],
    roadDecals: spec?.roadDecals?.map((name) => ({ name, only: null })) ?? [{ name: DEFAULT_ROAD_DECAL, only: BIOME.city }],
  };
  c.density[RULE_FRONTAGE] = spec?.density.frontage ?? 1;
  c.density[RULE_VERGE] = spec?.density.verge ?? 1;
  c.density[RULE_ISLANDS] = spec?.density.islands ?? 1;
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

/** Whether any rule can dress (x, z): not where the course's biome is `none` and no zone holds it (no table has an entry for `none`). */
function dressable(c: Ctx, x: number, z: number): boolean {
  return c.course !== BIOME.none || zoneAt(c.zones, x, z) !== null;
}

/** The ground a lattice sweep covers, as [x0, x1, z0, z1]: the course's bounds grown by `reach` m, or on a course whose biome is `none` the zones' own box (nothing else is dressed). */
function sweepBox(c: Ctx, reach: number): [number, number, number, number] {
  const b = c.track.bounds;
  if (c.course !== BIOME.none) return [b.minX - reach, b.maxX + reach, b.minZ - reach, b.maxZ + reach];
  return [Math.min(...c.zones.map((z) => z.x0)), Math.max(...c.zones.map((z) => z.x1)), Math.min(...c.zones.map((z) => z.z0)), Math.max(...c.zones.map((z) => z.z1))];
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
 * bridge covers. It goes in `solid` when it has a body and a road edge whose wall is down (within `OPEN_SPAN` of the segment) lies within
 * `SOLID_REACH` of it; else in `drawn`. A `core` radius (m) tests that circle alone, with
 * no margin, and leaves no footprint: parked cars, which stand close in rows, clear what stands but not each other.
 */
function place(c: Ctx, rule: number, prefab: PrefabId, x: number, z: number, yaw: number, scale: number, core?: number): boolean {
  return stand(c, rule, prefab, x, z, yaw, scale, scale, scale, core);
}

/**
 * Whether the footprint (half extents `hx`, `hz`, turned `yaw`) comes within `margin` of one standing: one circle round it when that fits
 * the occupancy pad, else (a mesa card, a tree crown) a grid of circles that each fit it.
 */
function crowded(c: Ctx, x: number, z: number, yaw: number, hx: number, hz: number, margin: number): boolean {
  const r = hypot2(hx, hz);
  if (r + margin <= OCC_PAD) return c.occ.hits(x, z, r, margin);
  const room = OCC_PAD - margin;
  const nx = Math.max(1, Math.ceil((hx * Math.SQRT2) / room));
  const nz = Math.max(1, Math.ceil((hz * Math.SQRT2) / room));
  const cx = hx / nx;
  const cz = hz / nz;
  const cos = detCos(yaw);
  const sin = detSin(yaw);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const u = (2 * i + 1) * cx - hx;
      const v = (2 * j + 1) * cz - hz;
      if (c.occ.hits(x + u * cos + v * sin, z - u * sin + v * cos, hypot2(cx, cz), margin)) return true;
    }
  }
  return false;
}

/** `place` at scales (`sx`, `sy`, `sz`), as an asset's own size is (`asset`: its index in `SCENERY_ASSETS`, none for a built-in prefab). */
function stand(c: Ctx, rule: number, prefab: PrefabId, x: number, z: number, yaw: number, sx: number, sy: number, sz: number, core?: number, asset?: number): boolean {
  const near = nearest(c.field, x, z, c.near);
  if (near.seg >= 0 && (c.field.flags[near.seg]! & SEG_COVERED) !== 0) return false;
  const size = PREFABS[prefab].size;
  const hx = (size[0] * sx) / 2;
  const hz = (size[2] * sz) / 2;
  const r = core ?? hypot2(hx, hz);
  const margin = core === undefined ? PROP_STANDOFF : 0;
  if (core !== undefined && core > OCC_PAD) throw new Error(`scenery: ${prefab} core ${core} is wider than the occupancy pad`);
  if (near.gap < r + ROAD_STANDOFF || (core === undefined ? crowded(c, x, z, yaw, hx, hz, margin) : c.occ.hits(x, z, core, margin))) return false;
  const y = standAt(c, x, z);
  if (y === null) return false;
  if (core === undefined) c.occ.add(x, z, detCos(yaw), detSin(yaw), hx, hz);
  const p: Placed = { prefab, x, y, z, yaw, sx, sy, sz };
  if (asset !== undefined) p.asset = asset;
  record(c, PREFABS[prefab].body !== "none" && near.openGap < SOLID_REACH, p, rule, near.dc);
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

/** One road sample's sidewalk station on one side: the sample, its wall-line point, its slab's far-edge point, and the slab's width in sidewalk widths. */
type Station = { k: number; wx: number; wz: number; fx: number; fz: number; wide: number };

function stationAt(c: Ctx, p: TrackPath, k: number, side: 1 | -1, wide: number): Station {
  const wall = roadside(p, k, side, 0, c.spot);
  const [wx, wz] = [wall.x, wall.z];
  const far = roadside(p, k, side, PREFABS[PREFAB.sidewalk].size[0] * wide, c.spot);
  return { k, wx, wz, fx: far.x, fz: far.z, wide };
}

/**
 * The slab between two neighbouring stations of a road side (path `p`), from the wall line out. Its longer edge (the far edge outside a
 * bend, the wall line inside one) is the chord between the stations, so neighbours share corners there and overlap on the shorter edge, and
 * the pavement has no gap at any curvature or sample spacing. Where the wall line between the stations bulges past the road-side edge, the slab is pushed out by the most it does.
 */
function strip(c: Ctx, p: TrackPath, a: Station, b: Station, side: 1 | -1): void {
  const [width, , length] = PREFABS[PREFAB.sidewalk].size;
  const across = width * a.wide;
  const wallLen = hypot2(b.wx - a.wx, b.wz - a.wz);
  const farLen = hypot2(b.fx - a.fx, b.fz - a.fz);
  const far = farLen > wallLen;
  const len = far ? farLen : wallLen;
  if (len === 0) return;
  const [ax, az, bx, bz] = far ? [a.fx, a.fz, b.fx, b.fz] : [a.wx, a.wz, b.wx, b.wz];
  const tx = (bx - ax) / len;
  const tz = (bz - az) / len;
  // Away from the road: roadside's lateral direction for this side.
  const nx = side * tz;
  const nz = -side * tx;
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const edge = far ? -across : 0;
  let bulge = 0;
  for (let i = 0, steps = (b.k - a.k + p.count) % p.count; i <= steps; i++) {
    const wall = roadside(p, (a.k + i) % p.count, side, 0, c.spot);
    bulge = Math.max(bulge, (wall.x - mx) * nx + (wall.z - mz) * nz - edge);
  }
  const lift = (far ? -across / 2 : across / 2) + bulge;
  c.spot.x = mx + nx * lift;
  c.spot.z = mz + nz * lift;
  slab(c, c.spot, tx, tz, a.wide, RULE_PAVING, len / length);
}

/**
 * Rule 1: a city's roads edged with sidewalk slabs and a circuit's with a wider apron, drawn only, from the wall line out; none where a
 * crossing road would be paved over. A station stands wherever the longer of the wall line and the slab's far edge has run a slab's
 * length since the last (so a bend's far edge is not stretched), and each slab joins two neighbouring stations (`strip`): no gap between them.
 */
function sidewalks(c: Ctx): void {
  const [width, , length] = PREFABS[PREFAB.sidewalk].size;
  for (let pi = 0; pi < c.field.paths.length; pi++) {
    const p = c.field.paths[pi]!;
    const base = c.field.base[pi]!;
    const segs = c.field.base[pi + 1]! - base;
    for (const side of [1, -1] as const) {
      let first: Station | null = null;
      let last: Station | null = null;
      let before: Station | null = null;
      let reach = 0;
      let broken = false;
      for (let k = 0; k < segs; k++) {
        const probe = roadside(p, k, side, width / 2, c.spot);
        const wide = SLAB_WIDTH[biomeAt(c, probe.x, probe.z, base + k)];
        if (wide === undefined) {
          last = null;
          before = null;
          broken = true;
          continue;
        }
        const here = stationAt(c, p, k, side, wide);
        if (last === null || before === null || last.wide !== wide) {
          broken = broken || first !== null;
          first ??= here;
          last = here;
          before = here;
          reach = 0;
          continue;
        }
        reach += Math.max(hypot2(here.wx - before.wx, here.wz - before.wz), hypot2(here.fx - before.fx, here.fz - before.fz));
        before = here;
        if (reach >= length) {
          strip(c, p, last, here, side);
          last = here;
          reach = 0;
        }
      }
      if (p.closed && !broken && first !== null && last !== null && last !== first) strip(c, p, last, first, side);
    }
  }
}

/** A slab (`PREFABS.sidewalk`, `wide` times its width) centred on `spot` with its length along (tx, tz), if its centre and four corners are off every road. */
function slab(c: Ctx, spot: Spot, tx: number, tz: number, wide: number, rule: number, longer = 1): boolean {
  const [width, , length] = PREFABS[PREFAB.sidewalk].size;
  const hw = (width * wide) / 2;
  const hl = (length * longer) / 2;
  const centre = nearest(c.field, spot.x, spot.z, c.near);
  const dc = centre.dc;
  if (centre.seg < 0 || (c.field.flags[centre.seg]! & SEG_COVERED) !== 0 || centre.gap < -EDGE_TOLERANCE) return false;
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
        const spot = roadside(p, k, side, crown + ROAD_STANDOFF, c.spot);
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
  const [x0, x1, z0, z1] = sweepBox(c, VERGE_REACH);
  const rule = mix(c.seed, RULE_VERGE);
  for (let i = Math.floor(x0 / VERGE_CELL); i <= Math.ceil(x1 / VERGE_CELL); i++) {
    for (let j = Math.floor(z0 / VERGE_CELL); j <= Math.ceil(z1 / VERGE_CELL); j++) {
      const seed = mix(rule, mix(i, j));
      const roll = unit(mix(seed, 0));
      if (roll >= VERGE_CHANCE_MAX * VERGE_RAMP_MAX * density) continue;
      const x = (i + unit(mix(seed, 1))) * VERGE_CELL;
      const z = (j + unit(mix(seed, 2))) * VERGE_CELL;
      if (!dressable(c, x, z)) continue;
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
        if (!dressable(c, x, z) || !inside(px, pz, x, z)) continue;
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
    c.lots.push({ x: mx, z: mz, ax, az, fx, fz, length });
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

/** Radius (m) of the circle round an asset's footprint at size factor `scale`. */
function radiusOf(a: SceneryAsset, scale: number): number {
  const [sx, , sz] = assetScale(a, scale);
  return hypot2(sx, sz) / 2;
}

/** The size factor a hash `h` (in [0, 1)) picks. */
function sizeOf(h: number): number {
  return ASSET_SCALE + ASSET_SCALE_SPAN * h;
}

/** The salt of one asset pass: a point's hashes in it depend on the course, the pass and the point alone. */
function saltOf(c: Ctx, mode: AssetMode, rule: AssetRule): number {
  return mix(c.seed, hashString(`${mode}:${rule}`));
}

/** An upright card or box takes `faceYaw`, turned up to `jitter` either way by a hash `h`; a cross, decal or tile takes any yaw. */
function yawOf(a: SceneryAsset, faceYaw: number, h: number, jitter: number): number {
  return a.kind === "card" || a.kind === "box" ? faceYaw + (h - 0.5) * 2 * jitter : h * 2 * Math.PI;
}

/** Yaw that runs a flat asset's local x (`xAlong`) or its local z along the direction (tx, tz). */
function alongYaw(xAlong: boolean, tx: number, tz: number): number {
  return xAlong ? detAtan2(-tz, tx) : detAtan2(tx, tz);
}

/** Yaw that turns a prop's local +x toward the point of road segment `seg` nearest (x, z). */
function facing(c: Ctx, seg: number, x: number, z: number): number {
  const f = c.field;
  const len2 = f.len[seg]! * f.len[seg]!;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - f.ax[seg]!) * f.ex[seg]! + (z - f.az[seg]!) * f.ez[seg]!) / len2)) : 0;
  return detAtan2(z - (f.az[seg]! + f.ez[seg]! * t), f.ax[seg]! + f.ex[seg]! * t - x);
}

/**
 * Stand asset `i` (an index into `SCENERY_ASSETS`) at (x, z) at size factor `scale`, in a biome its row lists. An upright goes through
 * `stand` (and one with no body stays out of a car's reach); a decal or tile is a circle of its own radius that blocks nothing.
 */
function put(c: Ctx, rule: number, i: number, x: number, z: number, yaw: number, scale: number): boolean {
  const a = SCENERY_ASSETS[i]!;
  const near = nearest(c.field, x, z, c.near);
  if (near.seg < 0 || !standsIn(a, biomeAt(c, x, z, near.seg))) return false;
  const [sx, sy, sz] = assetScale(a, scale);
  const flat = a.kind === "decal" || a.kind === "tile";
  if (!flat && (a.body === "none" || a.body === "knock") && near.openGap < SOLID_REACH) return false;
  return stand(c, rule, assetPrefab(a), x, z, yaw, sx, sy, sz, flat ? Math.min(hypot2(sx, sz) / 2, OCC_PAD) : undefined, i);
}

/** Lay flat asset `i` on the ground at (x, z), `lift` m up, with no footprint and no road standoff: paint on a road or a car park slab, where `stand` would find the road in the way. */
function paint(c: Ctx, rule: number, i: number, x: number, z: number, yaw: number, scale: number, lift = 0): boolean {
  const a = SCENERY_ASSETS[i]!;
  const near = nearest(c.field, x, z, c.near);
  if (near.seg < 0 || (c.field.flags[near.seg]! & SEG_COVERED) !== 0 || !standsIn(a, biomeAt(c, x, z, near.seg))) return false;
  const y = standAt(c, x, z);
  if (y === null) return false;
  const [sx, sy, sz] = assetScale(a, scale);
  record(c, false, { prefab: assetPrefab(a), x, y: y + lift, z, yaw, sx, sy, sz, asset: i }, rule, near.dc);
  return true;
}

/** One lattice cell of `rule`'s assets: at most one, jittered, in the biome's `VERGE` band and thinning toward the road as the verge does. */
function latticeCell(c: Ctx, mode: AssetMode, rule: LatticeRule, salt: number, cell: number, share: number, i: number, j: number): void {
  const seed = mix(salt, mix(i, j));
  const dice = unit(mix(seed, 0));
  if (dice >= VERGE_CHANCE_MAX * share * VERGE_RAMP_MAX) return;
  const x = (i + unit(mix(seed, 1))) * cell;
  const z = (j + unit(mix(seed, 2))) * cell;
  const near = nearest(c.field, x, z, c.near);
  if (near.seg < 0) return;
  const biome = biomeAt(c, x, z, near.seg);
  const spec = VERGE[biome];
  if (!spec || near.gap < spec.inner || near.gap > spec.outer) return;
  const ramp = VERGE_RAMP_MIN + ((VERGE_RAMP_MAX - VERGE_RAMP_MIN) * (near.gap - spec.inner)) / (spec.outer - spec.inner);
  if (dice >= spec.chance * share * ramp) return;
  const asset = pickAsset(mode, rule, biome, unit(mix(seed, 3)));
  if (asset < 0) return;
  const yaw = yawOf(SCENERY_ASSETS[asset]!, facing(c, near.seg, x, z), unit(mix(seed, 4)), FACE_JITTER);
  put(c, sceneryRule(rule), asset, x, z, yaw, sizeOf(unit(mix(seed, 5))));
}

/** Rule 3 for assets: a lattice for each asset rule (cell and share in `ASSET_LATTICE`), and a coarser one for tiles. */
function lattices(c: Ctx): void {
  const b = c.track.bounds;
  for (const mode of ["lattice", "patch"] as const) {
    for (const rule of LATTICE_RULES) {
      const density = c.density[sceneryRule(rule)]!;
      if (density <= 0 || !hasAssets(mode, rule)) continue;
      const { cell, share } = mode === "lattice" ? ASSET_LATTICE[rule] : PATCH_LATTICE;
      const salt = saltOf(c, mode, rule);
      for (let i = Math.floor((b.minX - VERGE_REACH) / cell); i <= Math.ceil((b.maxX + VERGE_REACH) / cell); i++) {
        for (let j = Math.floor((b.minZ - VERGE_REACH) / cell); j <= Math.ceil((b.maxZ + VERGE_REACH) / cell); j++) latticeCell(c, mode, rule, salt, cell, share * density, i, j);
      }
    }
  }
}

/** Rule 4 for assets: on the ground a closed road encloses, `ISLAND_ASSET_SHARE` of the loop's own prop chance and at most `ISLAND_ASSET_MAX` a loop. */
function islandAssets(c: Ctx): void {
  const density = c.density[RULE_ISLANDS]!;
  if (density <= 0) return;
  for (let pi = 0; pi < c.field.paths.length; pi++) {
    const p = c.field.paths[pi]!;
    if (!p.closed) continue;
    const { px, pz } = outline(p);
    const salt = mix(saltOf(c, "islands", "islands"), pi);
    let standing = 0;
    for (let i = Math.floor(Math.min(...px) / ISLAND_CELL); i <= Math.ceil(Math.max(...px) / ISLAND_CELL) && standing < ISLAND_ASSET_MAX; i++) {
      for (let j = Math.floor(Math.min(...pz) / ISLAND_CELL); j <= Math.ceil(Math.max(...pz) / ISLAND_CELL) && standing < ISLAND_ASSET_MAX; j++) {
        const seed = mix(salt, mix(i, j));
        const dice = unit(mix(seed, 0));
        if (dice >= ISLAND_CHANCE_MAX * ISLAND_ASSET_SHARE * density) continue;
        const x = (i + unit(mix(seed, 1))) * ISLAND_CELL;
        const z = (j + unit(mix(seed, 2))) * ISLAND_CELL;
        if (!inside(px, pz, x, z)) continue;
        const near = nearest(c.field, x, z, c.near);
        if (near.seg < 0 || near.gap < ISLAND_MARGIN) continue;
        const biome = biomeAt(c, x, z, near.seg);
        const spec = ISLANDS[biome];
        if (!spec || dice >= spec.chance * ISLAND_ASSET_SHARE * density) continue;
        const asset = pickAsset("islands", "islands", biome, unit(mix(seed, 3)));
        if (asset < 0) continue;
        const yaw = yawOf(SCENERY_ASSETS[asset]!, facing(c, near.seg, x, z), unit(mix(seed, 4)), FACE_JITTER);
        if (put(c, RULE_ISLANDS, asset, x, z, yaw, sizeOf(unit(mix(seed, 5))))) standing++;
      }
    }
  }
}

/** Rule 2 for assets: along every road's wall line one asset per station by chance, spaced by biome (`FRONTAGE_SPACING`), its footprint `FRONT_GAP` to `FRONT_GAP + FRONT_GAP_SPAN` m clear of the wall line, facing the road. */
function frontageAssets(c: Ctx): void {
  const density = c.density[RULE_FRONTAGE]!;
  if (density <= 0) return;
  const salt = saltOf(c, "frontage", "frontage");
  for (let pi = 0; pi < c.field.paths.length; pi++) {
    const p = c.field.paths[pi]!;
    for (const side of [1, -1] as const) {
      march(c, pi, stationUnit(c, salt, c.field.base[pi]!, side, 0) * LAMP_PHASE, (seg, k) => {
        const biome = biomeAt(c, p.x[k]!, p.z[k]!, seg);
        const spacing = FRONTAGE_SPACING[biome];
        if (spacing === undefined) return RETRY_STEP;
        const asset = pickAsset("frontage", "frontage", biome, stationUnit(c, salt, seg, side, 1));
        if (asset < 0) return RETRY_STEP;
        if (stationUnit(c, salt, seg, side, 2) < FRONT_CHANCE * density) {
          const a = SCENERY_ASSETS[asset]!;
          const scale = sizeOf(stationUnit(c, salt, seg, side, 3));
          const spot = roadside(p, k, side, radiusOf(a, scale) + FRONT_GAP + FRONT_GAP_SPAN * stationUnit(c, salt, seg, side, 4), c.spot);
          put(c, RULE_FRONTAGE, asset, spot.x, spot.z, yawOf(a, spot.yaw, stationUnit(c, salt, seg, side, 5), 0), scale);
        }
        return spacing * (1 + (stationUnit(c, salt, seg, side, 6) - 0.5) * 2 * SPACING_JITTER);
      });
    }
  }
}

/** A row of one to `ROW_MAX` of asset `asset` along the wall line from sample `k` on `side` of `p`, an asset's width and `ROW_GAP` apart. */
function tracksideRow(c: Ctx, p: TrackPath, k: number, side: 1 | -1, seg: number, salt: number, asset: number): void {
  const a = SCENERY_ASSETS[asset]!;
  const scale = sizeOf(stationUnit(c, salt, seg, side, 3));
  const off = radiusOf(a, scale) + ROW_OFFSET;
  const copies = 1 + Math.floor(stationUnit(c, salt, seg, side, 4) * ROW_MAX);
  const step = Math.max(1, Math.ceil(((a.size[0] * scale + ROW_GAP) * p.count) / p.length));
  for (let n = 0; n < copies; n++) {
    const at = k + n * step;
    if (!p.closed && at >= p.count) return;
    const spot = roadside(p, at % p.count, side, off, c.spot);
    put(c, RULE_TRACKSIDE, asset, spot.x, spot.z, yawOf(a, spot.yaw, stationUnit(c, salt, seg, side, 5 + n), 0), scale);
  }
}

/** Rule 5 for assets: along the race loop's outside (both sides of an open road), a row of one asset every `ROW_SPACING` m by chance. */
function tracksideAssets(c: Ctx): void {
  const density = c.density[RULE_TRACKSIDE]!;
  if (density <= 0) return;
  const p = c.track.path;
  const loop = p.closed ? outline(p) : null;
  const salt = saltOf(c, "trackside", "trackside");
  for (const side of [1, -1] as const) {
    march(c, 0, stationUnit(c, salt, 0, side, 0) * ROW_SPACING, (seg, k) => {
      const probe = roadside(p, k, side, ROW_PROBE, c.spot);
      if (loop && inside(loop.px, loop.pz, probe.x, probe.z)) return ROW_SPACING;
      const asset = pickAsset("trackside", "trackside", biomeAt(c, probe.x, probe.z, seg), stationUnit(c, salt, seg, side, 1));
      if (asset < 0) return RETRY_STEP;
      if (stationUnit(c, salt, seg, side, 2) < ROW_CHANCE * density) tracksideRow(c, p, k, side, seg, salt, asset);
      return ROW_SPACING;
    });
  }
}

/** The lateral offset (m, + left) at which road paint `name` lies at sample `k` of `p`, `across` m half its width; null where it does not fit. `n` counts the paint laid so far on this road. */
function roadLateral(c: Ctx, name: RoadDecalName, p: TrackPath, k: number, seg: number, salt: number, n: number, across: number): number | null {
  const half = p.half[k]!;
  if (across > half) return null;
  switch (name) {
    case ROAD_DECAL.manhole: {
      const wobble = (stationUnit(c, salt, seg, 1, 3) - 0.5) * MANHOLE_WOBBLE;
      const gutter = half - MANHOLE_EDGE_CLEAR;
      if (stationUnit(c, salt, seg, 1, 1) < 0.5 && gutter > MANHOLE_DASH_OFFSET + 2 * across) return (n % 2 === 0 ? 1 : -1) * (gutter + wobble);
      return (stationUnit(c, salt, seg, 1, 2) < 0.5 ? 1 : -1) * (MANHOLE_DASH_OFFSET + wobble);
    }
    case ROAD_DECAL.arrow:
      return -half / 2;
    case ROAD_DECAL.kerb:
      return (stationUnit(c, salt, seg, 1, 5) < 0.5 ? 1 : -1) * (half - across);
    default:
      return 0;
  }
}

/** Lay road paint `asset` (kind `name`) at sample `k` of `p`: a round cover turned at random, the rest with their longer extent running with the road. Whether it was laid. */
function paintRoad(c: Ctx, name: RoadDecalName, p: TrackPath, k: number, seg: number, salt: number, n: number, asset: number): boolean {
  const a = SCENERY_ASSETS[asset]!;
  const scale = sizeOf(stationUnit(c, salt, seg, 1, 4));
  const [sx, , sz] = assetScale(a, scale);
  const xAlong = sx >= sz;
  const lat = roadLateral(c, name, p, k, seg, salt, n, (xAlong ? sz : sx) / 2);
  if (lat === null) return false;
  const yaw = name === ROAD_DECAL.manhole ? 2 * Math.PI * stationUnit(c, salt, seg, 1, 6) : alongYaw(xAlong, p.tx[k]!, p.tz[k]!);
  return paint(c, sceneryRule(a.rule), asset, p.x[k]! + p.tz[k]! * lat, p.z[k]! - p.tx[k]! * lat, yaw, scale);
}

/** Whether road paint `name` is wanted where the nearest other road is `gap` m off (`ahead`: the same a few metres on) at sample `k` of path `pi`. */
function roadWants(name: RoadDecalName, gap: number, ahead: number, pi: number, p: TrackPath, k: number): boolean {
  const along = (k * p.length) / p.count;
  if (pi === 0 && (along < START_LINE_CLEAR || (p.closed && p.length - along < START_LINE_CLEAR))) return false;
  switch (name) {
    case ROAD_DECAL.crosswalk:
      return gap >= CROSSWALK_GAP[0] && gap < CROSSWALK_GAP[1];
    case ROAD_DECAL.arrow:
      return gap >= ARROW_GAP[0] && gap <= ARROW_GAP[1] && ahead < gap;
    default:
      return gap >= JUNCTION_CLEAR;
  }
}

/**
 * Rules 1, 5 and 3 for assets: the road paint the course opts into (`roadDecals`) on every road's surface (not under a bridge or roof), each kind at its own spacing; nothing else
 * generated lies on a road. None lies at a junction (a manhole and a kerb stripe keep `JUNCTION_CLEAR` from another road) or on a loop's start line; a crosswalk is laid only beside one and
 * an arrow only on the way to one.
 */
function roadAssets(c: Ctx): void {
  for (const { name, only } of c.roadDecals) {
    const asset = SCENERY_ASSETS.findIndex((a) => a.id === ROAD_DECAL_ASSET[name]);
    if (asset < 0) continue;
    const a = SCENERY_ASSETS[asset]!;
    const spacing = ROAD_DECAL_SPACING[name];
    const rest = name === ROAD_DECAL.crosswalk ? CROSSWALK_REST : name === ROAD_DECAL.arrow ? ARROW_REST : 0;
    const salt = mix(saltOf(c, "road", a.rule), asset);
    for (let pi = 0; pi < c.field.paths.length; pi++) {
      const p = c.field.paths[pi]!;
      let laid = 0;
      march(c, pi, stationUnit(c, salt, c.field.base[pi]!, 1, 0) * spacing, (seg, k) => {
        const biome = biomeAt(c, p.x[k]!, p.z[k]!, seg);
        if (!standsIn(a, biome) || (only !== null && biome !== only)) return RETRY_STEP;
        const gap = crossGap(c.field, pi, k, p.x[k]!, p.z[k]!);
        const ahead = name === ROAD_DECAL.arrow ? crossGap(c.field, pi, k, p.x[k]! + p.tx[k]! * LOOK_AHEAD, p.z[k]! + p.tz[k]! * LOOK_AHEAD) : gap;
        if (!roadWants(name, gap, ahead, pi, p, k)) return rest > 0 ? spacing : RETRY_STEP;
        if (paintRoad(c, name, p, k, seg, salt, laid, asset)) laid++;
        return rest > 0 ? rest : spacing * (1 + (stationUnit(c, salt, seg, 1, 8) - 0.5) * 2 * ROAD_DECAL_SPAN);
      });
    }
  }
}

/** Rule 5 for assets on each car park slab `carParks` laid: paint (oil stains, arrows) in the aisle and the bays, inside the slab, its longer extent along the aisle. */
function lotAssets(c: Ctx): void {
  const density = c.density[RULE_TRACKSIDE]!;
  if (density <= 0) return;
  const salt = saltOf(c, "lot", "carpark");
  const slabTop = PREFABS[PREFAB.sidewalk].size[1];
  for (const lot of c.lots) {
    const seg = nearest(c.field, lot.x, lot.z, c.near).seg;
    if (seg < 0) continue;
    const biome = biomeAt(c, lot.x, lot.z, seg);
    const slots = Math.floor(lot.length / LOT_PITCH);
    for (let n = 0; n < slots; n++) {
      const seed = mix(salt, mix(Math.round(lot.x * 8) + n, Math.round(lot.z * 8)));
      if (unit(mix(seed, 0)) >= LOT_CHANCE * density) continue;
      const asset = pickAsset("lot", "carpark", biome, unit(mix(seed, 1)));
      if (asset < 0) continue;
      const scale = sizeOf(unit(mix(seed, 2)));
      const [sx, , sz] = assetScale(SCENERY_ASSETS[asset]!, scale);
      const xAlong = sx >= sz;
      const t = (n + 0.5 - slots / 2) * LOT_PITCH;
      const across = (Math.floor(unit(mix(seed, 3)) * LOT_LANES) - 1) * CAR_ROW;
      if (Math.abs(t) + (xAlong ? sx : sz) / 2 > lot.length / 2 || Math.abs(across) + (xAlong ? sz : sx) / 2 > CAR_PARK_DEPTH / 2) continue;
      const yaw = alongYaw(xAlong, lot.ax, lot.az) + (unit(mix(seed, 4)) < 0.5 ? 0 : Math.PI);
      paint(c, RULE_TRACKSIDE, asset, lot.x + lot.ax * t + lot.fx * across, lot.z + lot.az * t + lot.fz * across, yaw, scale, slabTop);
    }
  }
}

/** Rules 1 to 5 once more with the generated sprite assets, after every built-in rule so no earlier placement moves: uprights first (they take footprints), paint last. */
function assets(c: Ctx): void {
  frontageAssets(c);
  tracksideAssets(c);
  islandAssets(c);
  lattices(c);
  roadAssets(c);
  lotAssets(c);
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
  assets(c);
  return { solid: kept(c, c.solid, c.solidMeta), drawn: kept(c, c.drawn, c.drawnMeta) };
}

/**
 * The share `keep` (0 to 1) of `drawn` a lower effects tier draws, by a hash of each prop's spot: every lower share is a subset of the
 * higher. The sidewalk slabs always stay: they abut to make one apron, and thinned they read as dotted tiles (the owner saw it at Auto).
 */
export function thinScenery(drawn: readonly Placed[], keep: number): Placed[] {
  return drawn.filter((p) => p.prefab === PREFAB.sidewalk || unit(mix(Math.round(p.x * 16), Math.round(p.z * 16))) < keep);
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
