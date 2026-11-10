import { detAtan2, detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import type { OpenWorldMap, WalkGraph } from "../../world/openworld/walk-graph.ts";
import { PLACE_NAMES } from "../../world/openworld/openworld-programme.ts";
import { ARREST } from "../civilians/civilian-activity.ts";
import { ESCORT_TO, SUBJECT_MODE, type CaseTable } from "./case-table.ts";
import { CAR_BOARD_SECONDS, COPS_PER_CASE, CRIME_STEP_SECONDS, ESCORT_AHEAD_DISTANCE, ESCORT_ARRIVE, ESCORT_MIN_DISTANCE, ESCORT_SECONDS, FOOT_COP_COUNT, STATION_ESCORT_SECONDS, SUBJECTS_PER_CASE } from "./crime-constants.ts";
import { COP_MODE, type FootCops } from "./foot-cops.ts";
import type { FootWalkers } from "./foot-walkers.ts";

/** The police station's door, where the law takes the arrested. */
type Station = { readonly x: number; readonly z: number };

/** The map's police station, null when it has none (a fixture's map): the arrested are then led a few metres along the street. */
export function stationOf(map: OpenWorldMap): Station | null {
  const place = map.places.find((candidate) => candidate.name === PLACE_NAMES.policeStation && candidate.doorNode >= 0);
  return place === undefined ? null : { x: map.graph.nodeX[place.doorNode]!, z: map.graph.nodeZ[place.doorNode]! };
}

/** What an arrest asks of the law around it. */
interface ArrestHooks {
  /** The suspect of subject slot `slot` of case `caseIndex` is at the station: the host's arrest of her. */
  raise(caseIndex: number, slot: number): void;
  /** Case `caseIndex` has no more use for its patrol car. */
  carFree(caseIndex: number): void;
  /** Case `caseIndex`'s patrol car, at the scene, drives to (x, z) with the suspect aboard; false when it cannot. */
  carry(caseIndex: number, x: number, z: number): boolean;
}

/**
 * An arrest as the drawing acts it (`ARREST`): the cop takes hold from behind the suspect, both facing her way, while the cuffs go on; then he leads her at his right side, at a walk, to the case's patrol car, which
 * drives her to the police station, or all the way to its door on foot, and she is gone from the street there. A map with no station has him lead her along the street.
 */
export class Arrests {
  private readonly walkers: FootWalkers;
  private readonly cops: FootCops;
  private readonly table: CaseTable;
  private readonly graph: WalkGraph;
  private readonly station: Station | null;
  private readonly hooks: ArrestHooks;

  constructor(walkers: FootWalkers, cops: FootCops, table: CaseTable, graph: WalkGraph, station: Station | null, hooks: ArrestHooks) {
    this.graph = graph;
    this.walkers = walkers;
    this.cops = cops;
    this.table = table;
    this.station = station;
    this.hooks = hooks;
  }

  /** Whether an arrest ends at a police station (so the host's arrest is raised there, not at the cuffs). */
  get endsAtStation(): boolean {
    return this.station !== null;
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

  /** The cuffs are on: her cop leads her to the case's patrol car when it has come, else (with a station) to its door, else to the sidewalk node at least `ESCORT_MIN_DISTANCE` m off that is nearest a point `ESCORT_AHEAD_DISTANCE` m ahead of him. */
  escort(caseIndex: number, slot: number, seconds: number): void {
    const { table } = this;
    const cop = table.holder[slot]!;
    table.mode[slot] = SUBJECT_MODE.escorted;
    table.since[slot] = seconds;
    if (this.station === null) {
      this.leadAlongStreet(caseIndex, slot, cop);
      return;
    }
    this.sendOtherCopsBack(caseIndex, cop);
    if (table.carHere[caseIndex] === 1) this.leadTo(slot, cop, ESCORT_TO.car, table.carX[caseIndex]!, table.carZ[caseIndex]!);
    else this.walkToStation(caseIndex, slot, cop, seconds, this.station);
  }

  /** Once a grid step, after the cops moved: each led-away suspect walks at her cop's right; where he has led her she is gone from the street and he runs on for the case. */
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
      walkers.carry(walker, walkers.speed[cop]! * CRIME_STEP_SECONDS, CRIME_STEP_SECONDS);
      this.finishEscort(slot, cop, seconds);
    }
  }

  private finishEscort(slot: number, cop: number, seconds: number): void {
    const { table, cops, station } = this;
    const caseIndex = Math.floor(slot / SUBJECTS_PER_CASE);
    const arrived = cops.gapTo(cop, cops.aimX[cop]!, cops.aimZ[cop]!) <= ESCORT_ARRIVE;
    const elapsed = seconds - table.since[slot]!;
    const to = table.escortTo[slot];
    if (to === ESCORT_TO.car) {
      if (!arrived && elapsed < CAR_BOARD_SECONDS) return;
      if (station === null) return;
      if (arrived && this.hooks.carry(caseIndex, station.x, station.z)) this.board(caseIndex, slot, cop, seconds);
      else this.walkToStation(caseIndex, slot, cop, seconds, station);
      return;
    }
    if (!arrived && elapsed < (to === ESCORT_TO.station ? STATION_ESCORT_SECONDS : ESCORT_SECONDS)) return;
    if (to === ESCORT_TO.station) this.hooks.raise(caseIndex, slot);
    table.hold(table.resident[slot]!, seconds);
    table.free(slot);
    cops.resume(cop);
  }

  /** She is in the patrol car, which drives off; her cop goes back to his beat (or his seat in the car). */
  private board(caseIndex: number, slot: number, cop: number, seconds: number): void {
    this.table.mode[slot] = SUBJECT_MODE.conveyed;
    this.table.since[slot] = seconds;
    this.sendCopBack(caseIndex, cop);
  }

  private walkToStation(caseIndex: number, slot: number, cop: number, seconds: number, station: Station): void {
    this.table.since[slot] = seconds;
    this.leadTo(slot, cop, ESCORT_TO.station, station.x, station.z);
    this.hooks.carFree(caseIndex);
  }

  private leadTo(slot: number, cop: number, to: number, x: number, z: number): void {
    this.table.escortTo[slot] = to;
    this.cops.escort(cop, x, z);
  }

  private leadAlongStreet(caseIndex: number, slot: number, cop: number): void {
    const { table, graph } = this;
    if (table.carHere[caseIndex] === 1) {
      this.leadTo(slot, cop, ESCORT_TO.street, table.carX[caseIndex]!, table.carZ[caseIndex]!);
      return;
    }
    const node = this.nodeAhead(cop);
    this.leadTo(slot, cop, ESCORT_TO.street, graph.nodeX[node]!, graph.nodeZ[node]!);
  }

  /** The cops of a case whose suspects are all caught go back to patrol, but the one holding her and any other with a suspect in hand. */
  private sendOtherCopsBack(caseIndex: number, holder: number): void {
    if (this.table.hasSuspectToCatch(caseIndex)) return;
    for (let index = 0; index < COPS_PER_CASE; index++) {
      const cop = this.table.copAt(caseIndex, index);
      if (cop < 0 || cop === holder || this.cops.mode[cop] === COP_MODE.grip || this.cops.mode[cop] === COP_MODE.escort) continue;
      this.sendCopBack(caseIndex, cop);
    }
  }

  private sendCopBack(caseIndex: number, cop: number): void {
    this.cops.release(cop);
    for (let index = 0; index < COPS_PER_CASE; index++) if (this.table.copAt(caseIndex, index) === cop) this.table.setCop(caseIndex, index, -1);
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
