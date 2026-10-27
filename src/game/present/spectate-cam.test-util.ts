import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { setGround } from "../world/ground.ts";
import { placeProps, propColliders, type Placed, type PropCollider } from "../world/placements.ts";
import { course, FRAME, makeWorld, stepFrame } from "../world/race-world.test-util.ts";
import { blankPoint, blankProjection, projectPath, type Track } from "../world/track.ts";
import { levelAt } from "../world/track-sections.ts";
import { AutoCam, type AutoScene } from "./auto-cam.ts";
import { CINE, CineCam, raceSight } from "./spectate-cam.ts";

/** Side (m) of a cell of the solids' grid, the stride of the cell keys, and their origin: a coordinate's cell is `floor(m / CELL_M)` + the origin. */
const CELL_M = 8;
const CELL_STRIDE = 1 << 20;
const CELL_ORIGIN = 1 << 19;
/** Added to a solid's bounding radius (m) so no rounding of its corner test can put a point it holds outside its cells. */
const REACH_PAD_M = 1e-6;
const NO_SOLIDS: readonly number[] = [];

const cellOf = (m: number): number => Math.floor(m / CELL_M) + CELL_ORIGIN;

/** The solids of one course by grid cell: each is listed in every cell its bounding square covers, in `cols` order, so a point tried only against its own cell's list names the same first solid a scan of all of `cols` would. */
class SolidGrid {
  readonly cos: Float64Array;
  readonly sin: Float64Array;
  private readonly cells = new Map<number, number[]>();

  constructor(cols: readonly PropCollider[]) {
    this.cos = Float64Array.from(cols, (c) => Math.cos(c.yaw));
    this.sin = Float64Array.from(cols, (c) => Math.sin(c.yaw));
    for (const [i, c] of cols.entries()) {
      const reach = c.r + REACH_PAD_M;
      for (let ix = cellOf(c.x - reach); ix <= cellOf(c.x + reach); ix++) {
        for (let iz = cellOf(c.z - reach); iz <= cellOf(c.z + reach); iz++) {
          const key = ix * CELL_STRIDE + iz;
          const list = this.cells.get(key);
          if (list) list.push(i);
          else this.cells.set(key, [i]);
        }
      }
    }
  }

  near(x: number, z: number): readonly number[] {
    return this.cells.get(cellOf(x) * CELL_STRIDE + cellOf(z)) ?? NO_SOLIDS;
  }
}

const grids = new WeakMap<readonly PropCollider[], SolidGrid>();
function gridOf(cols: readonly PropCollider[]): SolidGrid {
  let grid = grids.get(cols);
  if (!grid) {
    grid = new SolidGrid(cols);
    grids.set(cols, grid);
  }
  return grid;
}

/**
 * Oracle for the trackside eye, independent of `solid`: the cars' own collision footprints (props, `propContact`), each piece over its own
 * heights, the wall's 0.6 m body on the wall line (`wallColliders`' pieces), and the ground.
 */
function blocked(track: Track, cols: readonly PropCollider[], x: number, y: number, z: number): string | null {
  const ground = track.ground();
  if (y <= ground.heightAt(x, z, y)) return "under the ground";
  const grid = gridOf(cols);
  for (const i of grid.near(x, z)) {
    const c = cols[i]!;
    if (y < c.base || y > c.top) continue;
    const ex = x - c.x;
    const ez = z - c.z;
    const cos = grid.cos[i]!;
    const sin = grid.sin[i]!;
    const inside = c.kind === "circle" ? ex * ex + ez * ez < c.r * c.r : Math.abs(ex * cos - ez * sin) < c.hx && Math.abs(ex * sin + ez * cos) < c.hz;
    if (inside) return `in ${c.prefab} #${c.index}`;
  }
  const path = track.path;
  const pr = projectPath(path, x, z, -1, blankProjection());
  const left = pr.lateral > 0;
  const over = Math.abs(pr.lateral) - path.half[pr.k]! - (left ? path.runL[pr.k]! : path.runR[pr.k]!);
  if ((left ? path.wallL[pr.k] : path.wallR[pr.k]) && over > 0 && over < 0.6 && y < levelAt(path, pr.k, pr.lateral) + track.json.road.wallHeight) return "in the wall";
  return null;
}

/** What the oracle finds wrong with a camera at `e` filming the car at `p`: inside a solid, a blocked sight line (10 cm steps up to the car's `stop` margin), or a solid within 1.9 m flat (a spot may stand beside a bank, so not the ground). */
export function eyeProblems(track: Track, cols: readonly PropCollider[], e: THREE.Vector3, p: THREE.Vector3): string[] {
  const bad: string[] = [];
  const at = blocked(track, cols, e.x, e.y, e.z);
  if (at) bad.push(`eye (${e.x.toFixed(1)}, ${e.y.toFixed(1)}, ${e.z.toFixed(1)}) ${at}`);
  const len = e.distanceTo(p);
  for (let d = 0.1; d < len - CINE.stop; d += 0.1) {
    const f = d / len;
    const why = blocked(track, cols, e.x + (p.x - e.x) * f, e.y + (p.y + CINE.aimUp - e.y) * f, e.z + (p.z - e.z) * f);
    if (why) {
      bad.push(`sight line ${why} at ${d.toFixed(1)} m of ${len.toFixed(1)}`);
      break;
    }
  }
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const why = blocked(track, cols, e.x + 1.9 * Math.cos(a), e.y, e.z + 1.9 * Math.sin(a));
    if (why && why !== "under the ground") bad.push(`${why} within 1.9 m of the eye`);
  }
  return bad;
}

/** A shipped course with its placed props and their footprints. */
export interface CourseSolids {
  track: Track;
  placed: Placed[];
  cols: PropCollider[];
}

const solidsByCourse = new Map<string, CourseSolids>();

/** The course `id`, built once per process (`course`) with its props placed once: the lap sweep and the race sweep of a course read the same. */
export function courseSolids(id: string): CourseSolids {
  let solids = solidsByCourse.get(id);
  if (!solids) {
    const track = course(id);
    const placed = placeProps(track);
    solids = { track, placed, cols: propColliders(placed) };
    solidsByCourse.set(id, solids);
  }
  return solids;
}

/** Metres along the course between the spots of a lap sweep. */
const LAP_STEP_M = 8;
/** The speed (m/s) the watched car drives past each spot of a lap sweep. */
const LAP_SPEED = 30;
/** AI rivals on the watched race's grid. */
const WATCHED_AI = 4;
/** The seed the watched race's field is rolled with. */
const WATCHED_SEED = 3;

/** What a lap sweep found: the spots tried and the ones that found an eye, the time a pick took (ms, mean and worst), and every fault the oracle named. */
export interface LapReport {
  spots: number;
  found: number;
  meanMs: number;
  worstMs: number;
  bad: string[];
}

const lapScene = new THREE.Scene();

/** The cinematic camera picks a spot for a car driving past every `LAP_STEP_M` of the course: every eye it finds is held to the oracle and to the camera's own highest rung. */
export function pickLap({ track, placed, cols }: CourseSolids): LapReport {
  const sight = raceSight(track, placed);
  const ground = track.ground();
  setGround(ground);
  try {
    const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: "watched" }, lapScene, null);
    const cine = new CineCam();
    const pt = blankPoint();
    const report: LapReport = { spots: 0, found: 0, meanMs: 0, worstMs: 0, bad: [] };
    let totalMs = 0;
    for (let s = 0; s < track.length; s += LAP_STEP_M) {
      track.pointAt(s, pt);
      car.spawnFacing(pt.x, pt.z, Math.atan2(pt.tx, pt.tz), LAP_SPEED);
      car.group.position.y = ground.heightAt(pt.x, pt.z, pt.y + 0.5);
      report.spots++;
      const began = performance.now();
      const picked = cine.pick(sight, car) === "found";
      const ms = performance.now() - began;
      report.worstMs = Math.max(report.worstMs, ms);
      totalMs += ms;
      if (!picked) continue;
      report.found++;
      const e = cine.eye;
      for (const why of eyeProblems(track, cols, e, car.group.position)) report.bad.push(`s ${s}: ${why}`);
      if (e.y - ground.heightAt(e.x, e.z, e.y) > CINE.heights.at(-1)! + 0.01) report.bad.push(`s ${s}: eye ${e.y.toFixed(1)} m too high`);
    }
    report.meanMs = totalMs / report.spots;
    return report;
  } finally {
    setGround(null);
  }
}

/** What a watched race showed: the shots cut to, their kinds, how many of them stood on a searched spot, and every fault the oracle named. */
export interface RaceReport {
  cuts: number;
  kinds: Set<string>;
  checked: number;
  bad: string[];
}

/** One lap of `WATCHED_AI` AI rivals on course `id`, watched by the Auto camera for `seconds`: every trackside or high cut is held to the oracle. */
export function watchRace(id: string, { track, cols }: CourseSolids, seconds: number): RaceReport {
  const w = makeWorld();
  try {
    w.race.enter();
    w.race.command({ type: "options", options: { trackId: id, laps: 1, aiCount: WATCHED_AI, spectate: true } });
    w.race.reseed(WATCHED_SEED);
    w.race.command({ type: "start" });
    const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 900);
    const auto = new AutoCam();
    const scene: AutoScene = { sight: () => w.race.courseSight()!, rivals: () => w.live(), cut: (car) => car };
    const state = { acc: 0 };
    const report: RaceReport = { cuts: 0, kinds: new Set(), checked: 0, bad: [] };
    let playing: typeof auto.shot = null;
    for (let n = 0; n < seconds / FRAME; n++) {
      // The camera reads where the cars are, never how their skins are drawn.
      stepFrame(w, state);
      w.race.frame(FRAME);
      const car = w.cars[w.seat.carIndex]!;
      auto.update(camera, car, scene, FRAME);
      if (auto.shot === playing) continue;
      playing = auto.shot;
      report.cuts++;
      const kind = auto.shot!.kind;
      report.kinds.add(kind);
      // A wheel mount rides the car and a chase pose has no spot to find: only the searched spots promise room and sight.
      if (kind === "chase" || kind === "dutch" || !auto.cam.found) continue;
      report.checked++;
      for (const why of eyeProblems(track, cols, camera.position, car.group.position)) report.bad.push(`cut ${report.cuts} (${kind}) at ${(n * FRAME).toFixed(1)} s: ${why}`);
    }
    return report;
  } finally {
    w.race.exit();
    setGround(null);
  }
}
