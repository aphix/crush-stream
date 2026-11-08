// base props: 4
// base zones: 0
// base plateaus: 0
// base paint: 0
import { detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
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

const PLATEAU = { run: 11, round: 3, margin: 10, gap: 8, top: 24, topMin: 5, height: [10, 17] };

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

/** A box's outline with each edge ragged by up to `jag` m, so painted ground does not end in a ruled line. @param {number[]} box x0, z0, x1, z1 @param {number} jag @param {number} seed @returns {number[][]} */
function ragged([x0, z0, x1, z1], jag, seed) {
  const rng = mulberry32(seed);
  const step = 30;
  /** @type {number[][]} */
  const out = [];
  const edge = (/** @type {number} */ ax, /** @type {number} */ az, /** @type {number} */ bx, /** @type {number} */ bz, /** @type {number} */ nx, /** @type {number} */ nz) => {
    const n = Math.max(1, Math.round(hypot2(bx - ax, bz - az) / step));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const j = (rng() * 2 - 1) * jag;
      out.push([Math.round(ax + (bx - ax) * t + nx * j), Math.round(az + (bz - az) * t + nz * j)]);
    }
  };
  edge(x0, z0, x1, z0, 0, -1);
  edge(x1, z0, x1, z1, 1, 0);
  edge(x1, z1, x0, z1, 0, 1);
  edge(x0, z1, x0, z0, -1, 0);
  return out;
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

  d.paint("concrete", ragged([-450, 300, -150, 650], 12, 3));
  d.paint("asphalt", ragged([CITY.x0, CITY.z0, CITY.x1, CITY.z1], 10, 5));
  d.paint("dirt", ragged([CANYON.x0, CANYON.z0, CANYON.x1, CANYON.z1], 14, 7));

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
