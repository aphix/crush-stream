import { RANGE } from "../scenes/range.ts";
import { STATION_HALF_WIDTH, type MinigameMode } from "../scenes/minigame-constants.ts";
import type { FxTier } from "./engine-post.ts";

/**
 * Where and when the celebration fountains (`FountainSystem`) go: pure numbers, no scene. A pair is one jet each side of the road (a
 * race) or of the run-up (the Range and its minigames); the rows lead up to the finish line or the lip and none stands past it. The tier
 * says how many pairs and how thick a spray: `off` throws none, `minimal` a single thin pair, `ultra` the full show; the density knob
 * scales the spray on top.
 */
export const FOUNTAIN_TIER: Readonly<Record<FxTier, { pairs: number; spray: number }>> = {
  off: { pairs: 0, spray: 0 },
  minimal: { pairs: 1, spray: 0.4 },
  low: { pairs: 2, spray: 0.6 },
  high: { pairs: 3, spray: 0.85 },
  ultra: { pairs: 4, spray: 1 },
};

/** The big pair stands at the finish line or the lip (`LINE_POWER`); each further pair (`ROW_POWER`) stands back from it on the way in. */
export const LINE_POWER = 1.5;
export const ROW_POWER = 1;
export const ROW_GAP = 22;

/** Metres a race jet stands outside the road's edge (the wall is 1.5 m thick: the nozzle clears it). */
export const ROAD_MARGIN = 2;

/**
 * Seconds before the watched car reaches a row that it starts: a spark's flight is about 2 s, so the column stands in full spray as the
 * car passes it. It runs `AFTER_S` more seconds past the car's arrival (a race's celebration after the line, a throw's flight).
 */
export const APPROACH_LEAD_S = 2.2;
const AFTER_S = 5;
/** Seconds a jet throws for once started: the lead, the arrival and `AFTER_S`. */
export const APPROACH_RUN_S = APPROACH_LEAD_S + AFTER_S;

/** The speed (m/s) an approach is timed at at the least: a car crawling or stopped far from a row does not start it. */
const MIN_SPEED = 8;

/** Whether a row `toGo` m ahead of a car at `speed` m/s is within `APPROACH_LEAD_S` of it: a row the car has passed never starts (nothing fires once it is by). */
export function approachDue(toGo: number, speed: number): boolean {
  return toGo >= 0 && toGo / Math.max(speed, MIN_SPEED) <= APPROACH_LEAD_S;
}

/** The Range's run-up: at most this many rows (2 or 3 is the look; the tier cuts them), the first at the lip (or the barrier), `RUNUP_ROW_GAP` m apart back down the ramp. */
export const RUNUP_ROWS = 3;
export const RUNUP_ROW_GAP = 9;
/** Metres the plain Range's jets stand outside its field's half-width; a station's stand on its lane's edge (`STATION_HALF_WIDTH`), the ramp's side. */
const RANGE_MARGIN = 1;

/** The run-up's edge (m from the lane's middle) a jet stands at: the plain Range's, or the station's (`mode`). */
export function runUpEdge(mode: MinigameMode | null): number {
  return mode === null ? RANGE.halfWidth + RANGE_MARGIN : STATION_HALF_WIDTH;
}
