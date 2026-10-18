import * as THREE from "three";
import { FountainSystem } from "../present/engine-fx.ts";
import type { FxTier } from "../present/engine-post.ts";
import {
  APPROACH_RUN_S,
  FOUNTAIN_TIER,
  LINE_POWER,
  ROAD_MARGIN,
  ROW_GAP,
  ROW_POWER,
  RUNUP_ROWS,
  RUNUP_ROW_GAP,
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

const _spot = new THREE.Vector3();

/**
 * The celebration fountains, which lead the watched car up to its big moment: a race's finish line (its last lap) and the Range's lip or
 * barrier (the plain Range and each minigame). Rows stand along both sides of the way in, the big pair at the line or the lip and the
 * others back from it, and each starts so it is in full spray as the car passes it (`approachDue`); none stands past the line or the
 * lip, and none starts once the car is by. Cosmetic: it reads the race and the car and writes only the `FountainSystem`.
 * What a tier throws is `FOUNTAIN_TIER`; the jets, their pool and their fade are `FountainSystem`'s.
 */
export class Fountains {
  readonly jets: FountainSystem;
  private pairs = 0;
  /** Bit k: row k (0 = the line's or the lip's) has been started this run; one start each, so a slow approach never re-fires them. A run start clears them. */
  private started = 0;

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
   * Once a frame in a race: start each pair of jets the watched car `car` (at `speed` m/s) is within `APPROACH_LEAD_S` of, on its last lap.
   * The farther back a pair stands the sooner the car is due at it, so the rows light one after the other down the run-in.
   */
  raceFrame(race: RaceField, car: number, speed: number): void {
    if (this.pairs === 0) return;
    const left = race.lastLapLeft(car);
    if (Number.isNaN(left)) return;
    for (let k = 0; k < this.pairs; k++) {
      if (this.started & (1 << k) || !approachDue(left - k * ROW_GAP, speed)) continue;
      this.started |= 1 << k;
      for (const side of SIDES) {
        if (race.roadsideAt(k * ROW_GAP, side, ROAD_MARGIN, _spot)) this.jets.jet(_spot.x, _spot.y, _spot.z, 0, APPROACH_RUN_S, k === 0 ? LINE_POWER : ROW_POWER);
      }
    }
  }

  /**
   * Once a frame at the Range (`mode`: the minigame, null for the plain Range): start each pair along the run-up that the car, at world
   * x `carX` going `speed` m/s along +x, is within `APPROACH_LEAD_S` of. The lip's pair (the barrier's, in the Long jump) stands on the lane's
   * edge at the lip itself and the rows behind it `RUNUP_ROW_GAP` m apart on the ramp, each on the floor there; they run through the launch.
   */
  runUpFrame(mode: MinigameMode | null, carX: number, speed: number): void {
    const rows = Math.min(this.pairs, RUNUP_ROWS);
    const origin = mode === null ? RANGE_ORIGIN : STATION_ANCHORS[mode];
    const edge = runUpEdge(mode);
    for (let k = 0; k < rows; k++) {
      const back = -k * RUNUP_ROW_GAP;
      if (this.started & (1 << k) || !approachDue(origin.x + back - carX, speed)) continue;
      this.started |= 1 << k;
      const y = mode === null ? LANDING_HEIGHT : floorHeightAt(mode, back, 0);
      for (const side of SIDES) this.jets.jet(origin.x + back, y, origin.z + side * edge, 0, APPROACH_RUN_S, k === 0 ? LINE_POWER : ROW_POWER);
    }
  }

  update(dt: number): void {
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
