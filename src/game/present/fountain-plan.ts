import { RANGE } from "../scenes/range.ts";
import { STATION_HALF_WIDTH, type MinigameMode } from "../scenes/minigame-constants.ts";
import type { FxTier } from "./engine-post.ts";

/**
 * Where and when the celebration fountains (`FountainSystem`) go: pure numbers, no scene. A pair is one jet each side of the road (a
 * race) or of the field (the Range and its minigames). The tier says how many pairs and how thick a spray: `off` throws none,
 * `minimal` a single thin pair, `ultra` the full show; the density knob scales the spray on top.
 */
export const FOUNTAIN_TIER: Readonly<Record<FxTier, { pairs: number; spray: number }>> = {
  off: { pairs: 0, spray: 0 },
  minimal: { pairs: 1, spray: 0.4 },
  low: { pairs: 2, spray: 0.6 },
  high: { pairs: 3, spray: 0.85 },
  ultra: { pairs: 4, spray: 1 },
};

/** A race: the pair at the finish line is the big one (`LINE_POWER`); each further pair (`ROW_POWER`) stands `ROW_GAP` m further back on the run-in. */
export const LINE_POWER = 1.5;
export const ROW_POWER = 1;
export const ROW_GAP = 22;

/** Metres a race jet stands outside the road's edge (the wall is 1.5 m thick: the nozzle clears it). */
export const ROAD_MARGIN = 2;

/**
 * Seconds before the player reaches a jet that it starts: a spark's flight is about 2 s, so the column stands in full spray as he arrives.
 * It runs `RACE_AFTER_S` more seconds past his arrival (the celebration after the line).
 */
export const RACE_LEAD_S = 2.2;
export const RACE_AFTER_S = 5;
/** Seconds a race jet throws for once started: the lead, the arrival and `RACE_AFTER_S`. */
export const RACE_RUN_S = RACE_LEAD_S + RACE_AFTER_S;

/** The speed (m/s) a run-in is timed at at the least: a car crawling or stopped far from the line does not start the show. */
const MIN_SPEED = 8;

/** Whether a car `toGo` m from a jet, at `speed` m/s, is within `RACE_LEAD_S` of it (at or past the jet: yes). */
export function raceJetDue(toGo: number, speed: number): boolean {
  return toGo / Math.max(speed, MIN_SPEED) <= RACE_LEAD_S;
}

/** The Range: rows of pairs along the field, at most this many (2 or 3 rows is the look; the tier cuts them). */
export const RANGE_ROWS = 3;
/** Seconds between one row's start and the next's: the first fires with the launch, the last while the dummy is still in the air. */
export const RANGE_STAGGER_S = 0.55;
export const RANGE_RUN_S = 4;
export const RANGE_POWER = 1.25;
/** Metres a Range jet stands outside the field's edge. */
const RANGE_MARGIN = 1;

/** World x of Range row `row` of `rows`: evenly spread down the field. */
export function rangeRowX(row: number, rows: number): number {
  return (RANGE.length * (row + 1)) / (rows + 1);
}

/** The field's edge (m from the lane's middle) a Range jet stands at: the plain Range's, or the station's (`mode`). */
export function rangeEdge(mode: MinigameMode | null): number {
  return (mode === null ? RANGE.halfWidth : STATION_HALF_WIDTH) + RANGE_MARGIN;
}
