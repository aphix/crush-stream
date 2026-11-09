import { detAtan2, detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import type { WalkGraph } from "../../world/openworld/walk-graph.ts";
import { ARREST } from "../civilians/civilian-activity.ts";
import { SUBJECT_MODE, type CaseTable } from "./case-table.ts";
import { CRIME_STEP_SECONDS, ESCORT_AHEAD_DISTANCE, ESCORT_ARRIVE, ESCORT_MIN_DISTANCE, ESCORT_SECONDS, FOOT_COP_COUNT } from "./crime-constants.ts";
import type { FootCops } from "./foot-cops.ts";
import type { FootWalkers } from "./foot-walkers.ts";

/**
 * An arrest as the drawing acts it (`ARREST`): the cop takes hold from behind the suspect, both facing her way, while the cuffs go on; then he leads her at his right side, at a walk, to the
 * case's patrol car or along the street, and she is gone from it.
 */
export class Arrests {
  private readonly walkers: FootWalkers;
  private readonly cops: FootCops;
  private readonly table: CaseTable;
  private readonly graph: WalkGraph;

  constructor(walkers: FootWalkers, cops: FootCops, table: CaseTable, graph: WalkGraph) {
    this.graph = graph;
    this.walkers = walkers;
    this.cops = cops;
    this.table = table;
  }

  /** Cop `cop` takes hold of the suspect in subject slot `slot`: she turns her back to him and he steps in `ARREST.cuffBehind` behind her. */
  grip(slot: number, cop: number, seconds: number): void {
    const { walkers, table } = this;
    const walker = FOOT_COP_COUNT + slot;
    table.mode[slot] = SUBJECT_MODE.gripped;
    table.since[slot] = seconds;
    table.holder[slot] = cop;
    walkers.halt(walker);
    walkers.speed[walker] = 0;
    const gap = hypot2(walkers.x[walker]! - walkers.x[cop]!, walkers.z[walker]! - walkers.z[cop]!);
    const yaw = gap > 0 ? detAtan2(walkers.x[walker]! - walkers.x[cop]!, walkers.z[walker]! - walkers.z[cop]!) : walkers.yaw[cop]!;
    walkers.yaw[walker] = yaw;
    this.cops.grip(cop);
    walkers.place(cop, walkers.x[walker]! - detSin(yaw) * ARREST.cuffBehind, walkers.z[walker]! - detCos(yaw) * ARREST.cuffBehind);
    walkers.yaw[cop] = yaw;
    this.cops.aimX[cop] = walkers.x[walker]!;
    this.cops.aimZ[cop] = walkers.z[walker]!;
  }

  /** The cuffs are on: her cop leads her to the case's patrol car when it has come, else to the sidewalk node at least `ESCORT_MIN_DISTANCE` m off that is nearest a point `ESCORT_AHEAD_DISTANCE` m ahead of him. */
  escort(caseIndex: number, slot: number, seconds: number): void {
    const { table } = this;
    const cop = table.holder[slot]!;
    table.mode[slot] = SUBJECT_MODE.escorted;
    table.since[slot] = seconds;
    if (table.carHere[caseIndex] === 1) {
      this.cops.escort(cop, table.carX[caseIndex]!, table.carZ[caseIndex]!);
      return;
    }
    const node = this.nodeAhead(cop);
    this.cops.escort(cop, this.graph.nodeX[node]!, this.graph.nodeZ[node]!);
  }

  /** Once a grid step, after the cops moved: each led-away suspect walks at her cop's right; at the place he leads her, or after `ESCORT_SECONDS`, she is gone from the street and he runs on for the case. */
  step(seconds: number): void {
    const { walkers, table } = this;
    for (let slot = 0; slot < table.mode.length; slot++) {
      if (table.mode[slot] !== SUBJECT_MODE.escorted) continue;
      const cop = table.holder[slot]!;
      const walker = FOOT_COP_COUNT + slot;
      const yaw = walkers.yaw[cop]!;
      const cos = detCos(yaw);
      const sin = detSin(yaw);
      // Her spot is body (-escortAcross, escortAhead) in the cop's frame.
      walkers.x[walker] = walkers.x[cop]! - ARREST.escortAcross * cos + ARREST.escortAhead * sin;
      walkers.z[walker] = walkers.z[cop]! + ARREST.escortAcross * sin + ARREST.escortAhead * cos;
      walkers.yaw[walker] = yaw;
      walkers.speed[walker] = walkers.speed[cop]!;
      walkers.walked[walker]! += walkers.speed[cop]! * CRIME_STEP_SECONDS;
      if (this.cops.gapTo(cop, this.cops.aimX[cop]!, this.cops.aimZ[cop]!) > ESCORT_ARRIVE && seconds - table.since[slot]! < ESCORT_SECONDS) continue;
      table.hold(table.resident[slot]!, seconds);
      table.free(slot);
      this.cops.resume(cop);
    }
  }

  /** The node at least `ESCORT_MIN_DISTANCE` m from cop `cop` nearest the point `ESCORT_AHEAD_DISTANCE` m ahead of him, the lowest on a tie (any node when none is that far). */
  private nodeAhead(cop: number): number {
    const { nodeX, nodeZ } = this.graph;
    const x = this.walkers.x[cop]!;
    const z = this.walkers.z[cop]!;
    const aheadX = x + detSin(this.walkers.yaw[cop]!) * ESCORT_AHEAD_DISTANCE;
    const aheadZ = z + detCos(this.walkers.yaw[cop]!) * ESCORT_AHEAD_DISTANCE;
    let best = 0;
    let bestGap = Infinity;
    for (let node = 0; node < nodeX.length; node++) {
      const gap = hypot2(nodeX[node]! - aheadX, nodeZ[node]! - aheadZ);
      if (gap >= bestGap || hypot2(nodeX[node]! - x, nodeZ[node]! - z) < ESCORT_MIN_DISTANCE) continue;
      bestGap = gap;
      best = node;
    }
    return best;
  }
}
