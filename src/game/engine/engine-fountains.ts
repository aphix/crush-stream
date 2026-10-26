import * as THREE from "three";
import { FountainSystem } from "../present/fountain-system.ts";
import type { FxTier } from "../present/engine-post.ts";
import {
  APPROACH_RUN_S,
  FOUNTAIN_TIER,
  LINE_POWER,
  RACE_ROW_GAP,
  RANGE_ROW_GAP,
  ROAD_MARGIN,
  ROW_POWER,
  ROW_STAGGER_S,
  RUNUP_ROWS,
  STATION_ROW_GAP,
  approachDue,
  runUpEdge,
} from "../present/fountain-plan.ts";
import { LANDING_HEIGHT, STATION_ANCHORS, type MinigameMode } from "../scenes/minigame-constants.ts";
import { floorHeightAt } from "../scenes/minigame-profile.ts";
import type { RaceField } from "./engine-race-field.ts";

/** The two sides of the road or the run-up: a jet stands on each of a pair. */
const SIDES = [-1, 1] as const;

/** Where the plain Range's run-up ends (its wall is the world origin); a minigame's is its station's anchor (the lip). */
const RANGE_ORIGIN = { x: 0, z: 0 };

/** The most rows any tier lights: the size of the per-row start times. */
const MAX_ROWS = Math.max(...Object.values(FOUNTAIN_TIER).map((look) => look.pairs));

const _spot = new THREE.Vector3();

/**
 * The celebration fountains: rows of jets along both sides of the way in to a race's finish line or the Range's lip, lit back to front
 * as the watched car comes (none past the line or the lip, none once the car is by). Cosmetic: writes only the `FountainSystem`.
 */
export class Fountains {
  readonly jets: FountainSystem;
  private pairs = 0;
  /** Bit k: row k (0 = the line's or the lip's) has been started this run; one start each, so a slow approach never re-fires them. A run start clears them. */
  private started = 0;
  /** Seconds of fountain time (`update`'s), and when each row was started on it. */
  private clock = 0;
  private readonly startedAt = new Float64Array(MAX_ROWS);

  constructor(scene: THREE.Scene) {
    this.jets = new FountainSystem(scene);
  }

  /** The FX tier's pairs and spray, thinned or thickened by the density knob; call when either changes (every frame is fine). */
  setLook(tier: FxTier, density: number): void {
    const look = FOUNTAIN_TIER[tier];
    this.pairs = look.pairs;
    this.jets.density = look.spray * density;
  }

  /**
   * Row k of `rows` starts once the car (`toGo` m short of it, `behind` m short of the row behind) is within its lead and that row behind
   * has burned `ROW_STAGGER_S`, or was passed unlit: the rows light strictly back to front.
   */
  private due(k: number, rows: number, toGo: number, behind: number, speed: number): boolean {
    if (this.started & (1 << k) || !approachDue(toGo, speed)) return false;
    if (k === rows - 1) return true;
    if ((this.started & (1 << (k + 1))) === 0) return behind < 0;
    return this.clock - this.startedAt[k + 1]! >= ROW_STAGGER_S;
  }

  private markStarted(k: number): void {
    this.started |= 1 << k;
    this.startedAt[k] = this.clock;
  }

  /** Once a frame in a race: on its last lap, start each row the watched car `car` (at `speed` m/s) is due at, `RACE_ROW_GAP` m apart down the run-in. */
  raceFrame(race: RaceField, car: number, speed: number): void {
    if (this.pairs === 0) return;
    const left = race.lastLapLeft(car);
    if (Number.isNaN(left)) return;
    for (let k = this.pairs - 1; k >= 0; k--) {
      if (!this.due(k, this.pairs, left - k * RACE_ROW_GAP, left - (k + 1) * RACE_ROW_GAP, speed)) continue;
      this.markStarted(k);
      for (const side of SIDES) {
        if (race.roadsideAt(k * RACE_ROW_GAP, side, ROAD_MARGIN, _spot)) this.jets.jet(_spot.x, _spot.y, _spot.z, 0, APPROACH_RUN_S, k === 0 ? LINE_POWER : ROW_POWER);
      }
    }
  }

  /**
   * Once a frame at the Range (`mode`: the minigame, null for the plain Range): start each run-up row the car, at world x `carX` going
   * `speed` m/s along +x, is due at. The lip's pair (the barrier's, in the Long jump) stands at the lip, the others the course's row gap
   * apart back toward the spawn (`STATION_ROW_GAP`, `RANGE_ROW_GAP`), each on the lane's edge on the floor there; they burn through the launch.
   */
  runUpFrame(mode: MinigameMode | null, carX: number, speed: number): void {
    const rows = Math.min(this.pairs, RUNUP_ROWS);
    const origin = mode === null ? RANGE_ORIGIN : STATION_ANCHORS[mode];
    const gap = mode === null ? RANGE_ROW_GAP : STATION_ROW_GAP[mode];
    const edge = runUpEdge(mode);
    for (let k = rows - 1; k >= 0; k--) {
      const back = -k * gap;
      if (!this.due(k, rows, origin.x + back - carX, origin.x + back - gap - carX, speed)) continue;
      this.markStarted(k);
      const y = mode === null ? LANDING_HEIGHT : floorHeightAt(mode, back, 0);
      for (const side of SIDES) this.jets.jet(origin.x + back, y, origin.z + side * edge, 0, APPROACH_RUN_S, k === 0 ? LINE_POWER : ROW_POWER);
    }
  }

  update(dt: number): void {
    this.clock += dt;
    this.jets.update(dt);
  }

  /** A run starts: the jets stop, their sparks go, and the rows may start again. */
  reset(): void {
    this.jets.reset();
    this.started = 0;
  }

  dispose(): void {
    this.jets.dispose();
  }
}
