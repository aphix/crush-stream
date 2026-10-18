import * as THREE from "three";
import { FountainSystem } from "../present/engine-fx.ts";
import type { FxTier } from "../present/engine-post.ts";
import {
  FOUNTAIN_TIER,
  LINE_POWER,
  RACE_RUN_S,
  RANGE_POWER,
  RANGE_ROWS,
  RANGE_RUN_S,
  RANGE_STAGGER_S,
  ROAD_MARGIN,
  ROW_GAP,
  ROW_POWER,
  raceJetDue,
  rangeEdge,
  rangeRowX,
} from "../present/fountain-plan.ts";
import { LANDING_HEIGHT, STATION_ANCHORS, type MinigameMode } from "../scenes/minigame-constants.ts";
import type { RaceField } from "./engine-race-field.ts";

/** The two sides of the road or the field: a jet stands on each of a pair. */
const SIDES = [-1, 1] as const;

/** Where the plain Range's throw starts (its wall is the world origin); a minigame's is its station's anchor. */
const RANGE_ORIGIN = { x: 0, z: 0 };

const _spot = new THREE.Vector3();

/**
 * The celebration fountains: the finish line's (a race's last lap, started as the watched car nears the line) and the Range's (its
 * ragdoll's launch, here and in the minigames). Cosmetic: it reads the race and the throw and writes only the `FountainSystem`.
 * What a tier throws is `FOUNTAIN_TIER`; the jets, their pool and their fade are `FountainSystem`'s.
 */
export class Fountains {
  readonly jets: FountainSystem;
  private pairs = 0;
  /** Bit k: the race's pair k (0 = the line's) has been started this race; one start each, so a slow last lap never re-fires them. */
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
   * Once a frame in a race: start each pair of jets the watched car `car` (at `speed` m/s) is within `RACE_LEAD_S` of, on its last lap.
   * The farther back a pair stands the sooner the car is due at it, so the rows light one after the other down the run-in.
   */
  raceFrame(race: RaceField, car: number, speed: number): void {
    if (this.pairs === 0) return;
    const left = race.lastLapLeft(car);
    if (Number.isNaN(left)) return;
    for (let k = 0; k < this.pairs; k++) {
      if (this.started & (1 << k) || !raceJetDue(left - k * ROW_GAP, speed)) continue;
      this.started |= 1 << k;
      for (const side of SIDES) {
        if (race.roadsideAt(k * ROW_GAP, side, ROAD_MARGIN, _spot)) this.jets.jet(_spot.x, _spot.y, _spot.z, 0, RACE_RUN_S, k === 0 ? LINE_POWER : ROW_POWER);
      }
    }
  }

  /** The Range's ragdoll was launched (`mode`: the minigame, null for the plain Range): rows of pairs down the field's edges, each row a beat after the last. */
  rangeThrow(mode: MinigameMode | null): void {
    const rows = Math.min(this.pairs, RANGE_ROWS);
    const origin = mode === null ? RANGE_ORIGIN : STATION_ANCHORS[mode];
    const edge = rangeEdge(mode);
    for (let row = 0; row < rows; row++) {
      for (const side of SIDES) this.jets.jet(origin.x + rangeRowX(row, rows), LANDING_HEIGHT, origin.z + side * edge, row * RANGE_STAGGER_S, RANGE_RUN_S, RANGE_POWER);
    }
  }

  update(dt: number): void {
    this.jets.update(dt);
  }

  /** A run starts: the jets stop, their sparks go, and the race's pairs may start again. */
  reset(): void {
    this.jets.reset();
    this.started = 0;
  }

  dispose(): void {
    this.jets.dispose();
  }
}
