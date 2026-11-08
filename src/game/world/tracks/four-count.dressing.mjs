// base props: 4
// base zones: 0
// base plateaus: 0
// base paint: 0
import { detCos, detSin } from "../../kernel/physics-core.js";
import { BIOME, PREFAB } from "../constants.ts";
import { boxClear, mulberry32 } from "../placements.ts";
import { blankPoint } from "../track.ts";

const BOWL = { x: -280, z: 480 };
const CITY = { x0: 300, z0: 190, x1: 880, z1: 580 };
const CANYON = { x0: 380, z0: -170, x1: 880, z1: 189 };
const WOODS = [
  [-455, -170, -180, 295],
  [-180, -170, 300, 50],
  [-150, 105, 150, 330],
];

/** Buildings are 12 m: a 19 m lot leaves a 7 m alley, and a street of STREET m every BLOCK lots. */
const LOT = 19;
const BLOCK = 3;
const STREET = 21;
/** Beyond the 3.6 m sidewalk the city biome lays, so a facade never stands on the pavement. */
const CITY_SETBACK = 7;
/** Share of the woods' edge-row props that are rocks. */
const ROCK_SHARE = 1 / 6;
/** Edge (m) of the terrain mesh's blocks, `BLOCK` in present/track-mesh.ts (a world file does not import it). */
const MESH_BLOCK = 8;

/** Long gentle flanks: a flank across whole 8 m mesh blocks is a plane the terrain mesh draws as one quad each (far too), where a short steep one is split cells all over. */
const PLATEAU = { run: 20, round: 4, margin: 6, gap: 6, top: 20, topMin: 4, height: [10, 17] };

/** The largest square half-width (m, up to `top`) of a plateau at (x, z) whose foot stays `margin` m off every road, in steps of 1 m. @param {import("../../../../scripts/course-dressing.mjs").Dressing} d @param {number} x @param {number} z */
function roadFit(d, x, z) {
  const reach = PLATEAU.run + PLATEAU.round;
  let half = PLATEAU.top;
  while (half >= PLATEAU.topMin) {
    const foot = half + reach;
    if (d.track.paths().every((path) => boxClear(path, x, z, 0, foot, foot) >= PLATEAU.margin)) return half;
    half -= 1;
  }
  return 0;
}

/** Mesas packed greedily, biggest first, over a lattice in `box`: every foot clear of the roads and `gap` m from the others'. @param {import("../../../../scripts/course-dressing.mjs").Dressing} d @param {{ x0: number, z0: number, x1: number, z1: number }} box @param {number} step @param {number} seed */
function mesas(d, box, step, seed) {
  const rng = mulberry32(seed);
  const reach = PLATEAU.run + PLATEAU.round;
  /** @type {{ x: number, z: number, half: number }[]} */
  const spots = [];
  for (let x = box.x0; x <= box.x1; x += step) {
    for (let z = box.z0; z <= box.z1; z += step) {
      const sx = x + (rng() - 0.5) * step * 0.6;
      const sz = z + (rng() - 0.5) * step * 0.6;
      const half = roadFit(d, sx, sz);
      if (half >= PLATEAU.topMin) spots.push({ x: sx, z: sz, half });
    }
  }
  /** @type {{ x: number, z: number, half: number }[]} */
  const feet = [];
  const free = (/** @type {{ x: number, z: number }} */ s, /** @type {number} */ half) => feet.every((f) => Math.abs(s.x - f.x) > half + reach + f.half + reach + PLATEAU.gap || Math.abs(s.z - f.z) > half + reach + f.half + reach + PLATEAU.gap);
  for (;;) {
    /** @type {{ x: number, z: number, half: number } | null} */
    let best = null;
    for (const s of spots) {
      let half = s.half;
      while (half >= PLATEAU.topMin && !free(s, half)) half -= 1;
      if (half >= PLATEAU.topMin && (best === null || half > best.half)) best = { x: s.x, z: s.z, half };
    }
    if (best === null) return feet;
    feet.push(best);
    const [lo, hi] = PLATEAU.height;
    d.plateau({ x: Math.round(best.x), z: Math.round(best.z), halfX: best.half, halfZ: best.half, height: Math.round(lo + rng() * (hi - lo)), run: [PLATEAU.run, PLATEAU.run, PLATEAU.run, PLATEAU.run], round: PLATEAU.round, top: "gravel" });
  }
}

/** A box as a four-corner paint polygon with its sides snapped outward to the terrain mesh's 8 m blocks: a block whose corners are not one colour is drawn in split cells even far away, so a side off the lattice (or a ragged one) costs a row of them. @param {number[]} box x0, z0, x1, z1 @returns {number[][]} */
function latticePolygon([x0, z0, x1, z1]) {
  const lo = (/** @type {number} */ v) => Math.floor(v / MESH_BLOCK) * MESH_BLOCK;
  const hi = (/** @type {number} */ v) => Math.ceil(v / MESH_BLOCK) * MESH_BLOCK;
  return [[lo(x0), lo(z0)], [hi(x1), lo(z0)], [hi(x1), hi(z1)], [lo(x0), hi(z1)]];
}

/** Trees (and the odd rock) one row `lane` m left of the centreline from node `from` to `to`, one every `every` m: the left is the open side there. @param {import("../../../../scripts/course-dressing.mjs").Dressing} d @param {number} from @param {number} to @param {number} lane @param {number} every @param {number} seed */
function edgeRow(d, from, to, lane, every, seed) {
  const rng = mulberry32(seed);
  const pt = blankPoint();
  for (let s = d.track.nodeS[from]; s < d.track.nodeS[to]; s += every) {
    d.track.pointAt(s + (rng() - 0.5) * every * 0.5, pt);
    const rock = rng() < ROCK_SHARE;
    d.prop(rock ? PREFAB.rock : PREFAB.tree, pt.x + pt.tz * lane, pt.z - pt.tx * lane, { scale: rock ? 1 + rng() : 0.8 + rng() * 0.9 });
  }
}

/** @param {import("../../../../scripts/course-dressing.mjs").Dressing} d */
export default (d) => {
  d.zone(-425, 300, -155, 625, BIOME.circuit);
  // The city's fringe outside the middle 512 m draw cell (x 256..768, z 256..768) takes the circuit biome's three facade styles, not the city's seven: a draw per style per cell.
  d.zone(768, CITY.z0, CITY.x1, CITY.z1, BIOME.circuit);
  d.zone(CITY.x0, CITY.z0, 768, 256, BIOME.circuit);
  d.zone(CITY.x0, CITY.z0, CITY.x1, CITY.z1, BIOME.city);
  d.zone(CANYON.x0, CANYON.z0, CANYON.x1, CANYON.z1, BIOME.desert);
  for (const [x0, z0, x1, z1] of WOODS) d.zone(x0, z0, x1, z1, BIOME.park);

  d.paint("concrete", latticePolygon([-450, 300, -150, 650]));
  d.paint("asphalt", latticePolygon([CITY.x0, CITY.z0, CITY.x1, CITY.z1]));
  d.paint("dirt", latticePolygon([CANYON.x0, CANYON.z0, CANYON.x1, CANYON.z1]));

  // The bowl's stands face the track from the infield: two rings round the semicircle and a row down the west straight.
  const ring = (/** @type {number} */ radius, /** @type {number} */ count) => {
    for (let k = 0; k < count; k++) {
      const a = (Math.PI * (k + 0.5)) / count;
      d.prop(PREFAB.grandstand, BOWL.x + radius * detCos(a), BOWL.z + radius * detSin(a), { yaw: -a });
    }
  };
  ring(80, 6);
  ring(44, 3);
  for (let z = 330; z <= 450; z += 40) d.prop(PREFAB.grandstand, -362, z, { yaw: Math.PI });

  // The city: a lattice of lots, a street every BLOCK lots, rejected where a road or an earlier building is in the way.
  const lots = { prefab: PREFAB.building, scale: [0.85, 1] };
  for (let i = 0; ; i++) {
    const x = CITY.x0 + 8 + i * LOT + Math.floor(i / BLOCK) * STREET;
    if (x > CITY.x1 - 8) break;
    for (let j = 0; ; j++) {
      const z = CITY.z0 + 8 + j * LOT + Math.floor(j / BLOCK) * STREET;
      if (z > CITY.z1 - 8) break;
      d.fill([x - 0.5, z - 0.5, x + 0.5, z + 0.5], lots, { near: CITY_SETBACK, count: 1, minProp: 1.5, yaw: 0, seed: i * 131 + j });
    }
  }

  // The woods' solid edge: the open side of the dirt road and the west ramp, where a car can leave the road; the rest of the forest is the scenery service's.
  edgeRow(d, 169, 244, 22, 20, 21);
  edgeRow(d, 169, 244, 25, 60, 22);

  // The canyon: mesas between the roads, boulders in the gaps.
  const feet = mesas(d, { x0: 300, z0: -110, x1: 800, z1: 170 }, 22, 11);
  const reach = PLATEAU.run + PLATEAU.round;
  d.fill([CANYON.x0, CANYON.z0, CANYON.x1, CANYON.z1], { prefab: PREFAB.rock, scale: [1.8, 3.4] }, { near: 14, density: 0.4, minProp: 2, noGo: feet.map((f) => [f.x - f.half - reach, f.z - f.half - reach, f.x + f.half + reach, f.z + f.half + reach]) });
};
