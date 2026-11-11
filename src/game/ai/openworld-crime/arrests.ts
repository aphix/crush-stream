import { detAtan2, detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import type { OpenWorldMap, WalkGraph } from "../../world/openworld/walk-graph.ts";
import { PLACE_NAMES } from "../../world/openworld/openworld-programme.ts";
import { ACTIVITY, ACTIVITY_SECONDS, ARREST } from "../civilians/civilian-activity.ts";
import { CAR_DOOR, carDoorOpenness, type DoorSpot } from "../civilians/civilian-car-door.ts";
import { ESCORT_TO, SUBJECT_MODE, type CaseTable } from "./case-table.ts";
import { BESIDE_COP, BOARD_REACH, CAR_BOARD_SECONDS, COPS_PER_CASE, DOOR_APPROACH, CRIME_STEP_SECONDS, ESCORT_AHEAD_DISTANCE, ESCORT_ARRIVE, ESCORT_MIN_DISTANCE, ESCORT_SECONDS, FOOT_COP_COUNT, STATION_ESCORT_SECONDS, SUBJECTS_PER_CASE } from "./crime-constants.ts";
import { COP_MODE, type FootCops } from "./foot-cops.ts";
import type { PatrolCars } from "./patrol-cars.ts";
import type { FootWalkers } from "./foot-walkers.ts";

/** The police station's door, where the law takes the arrested. */
type Station = { readonly x: number; readonly z: number };

/** The map's police station, null when it has none (a fixture's map): the arrested are then led a few metres along the street. */
export function stationOf(map: OpenWorldMap): Station | null {
  const place = map.places.find((candidate) => candidate.name === PLACE_NAMES.policeStation && candidate.doorNode >= 0);
  return place === undefined ? null : { x: map.graph.nodeX[place.doorNode]!, z: map.graph.nodeZ[place.doorNode]! };
}

/** The patrol car side of an arrest: the host's `PatrolCars`, or a client's view of the cars the host has them in (`ArrestRides`). */
export type ArrestCars = Pick<PatrolCars, "carForArrest" | "doorSpot" | "isStill" | "openDoor" | "convey" | "finishRide" | "carIndexOf">;

/** What an arrest asks of the law around it. */
interface ArrestHooks {
  /** The suspect of subject slot `slot` of case `caseIndex` is at the station: the host's arrest of her. */
  raise(caseIndex: number, slot: number): void;
  /** The law's cars for an arrest; null when it has none. */
  cars(): ArrestCars | null;
  /** The suspect of subject slot `slot` and her cop have got into car `carIndex` of the engine's list, which drives off. */
  rode(slot: number, carIndex: number): void;
  /** The car `carIndex` is at the station and the suspect of subject slot `slot` gets out of it. */
  alighted(slot: number, carIndex: number): void;
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
  private readonly door: DoorSpot = { x: 0, z: 0, yaw: 0, feetY: 0, surfaceY: 0 };

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

  /** A client heard the host's pair board car `carIndex`: the suspect `resident`, if she is being led away here, and her cop are in it (off the street) till `alight`. False when she is not led away or the car has no door here. */
  rideHeard(resident: number, carIndex: number, seconds: number): boolean {
    const { table } = this;
    const slot = table.subjectOf[resident] ?? -1;
    if (slot < 0 || table.mode[slot] !== SUBJECT_MODE.escorted || !this.hooks.cars()?.doorSpot(carIndex, this.door)) return false;
    table.carOf[slot] = carIndex;
    table.mode[slot] = SUBJECT_MODE.conveyed;
    table.since[slot] = seconds;
    const cop = table.holder[slot]!;
    this.cops.ride(cop);
    this.sendOtherCopsBack(Math.floor(slot / SUBJECTS_PER_CASE), cop);
    return true;
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

  /** The cuffs are on: with a station, her cop leads her to a patrol car (the case's at its scene, else his own, called to them), they get in, he drives her to the station and they walk in at its door (on foot all the way when no car can be had); else he leads her to the sidewalk node at least `ESCORT_MIN_DISTANCE` m off that is nearest a point `ESCORT_AHEAD_DISTANCE` m ahead of him. */
  escort(caseIndex: number, slot: number, seconds: number): void {
    const { table, walkers, cops } = this;
    const cop = table.holder[slot]!;
    table.mode[slot] = SUBJECT_MODE.escorted;
    table.since[slot] = seconds;
    if (this.station === null) {
      this.leadAlongStreet(caseIndex, slot, cop);
      return;
    }
    this.sendOtherCopsBack(caseIndex, cop);
    const cars = this.hooks.cars();
    const car = cars === null ? -1 : cars.carForArrest(caseIndex, cop, walkers.x[cop]!, walkers.z[cop]!, seconds);
    if (cars === null || car < 0 || !cars.doorSpot(car, this.door)) {
      this.walkToStation(slot, cop, seconds, this.station);
      return;
    }
    table.carOf[slot] = car;
    this.leadTo(slot, cop, ESCORT_TO.car, this.door.x, this.door.z);
    cops.leaveSidewalkFor(cop, DOOR_APPROACH);
  }

  /** Once a grid step, after the cops moved: each led-away suspect walks at her cop's right; where he has led her she is gone from the street (or in the car, or at the station's door) and he runs on for the case. */
  step(seconds: number): void {
    const { table } = this;
    for (let slot = 0; slot < table.mode.length; slot++) {
      const mode = table.mode[slot]!;
      if (mode === SUBJECT_MODE.escorted) this.stepEscort(slot, seconds);
      else if (mode === SUBJECT_MODE.boarding || mode === SUBJECT_MODE.alighting) this.stepDoor(slot, mode, seconds);
    }
  }

  private stepEscort(slot: number, seconds: number): void {
    const { walkers, table } = this;
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

  private finishEscort(slot: number, cop: number, seconds: number): void {
    const { table, cops, station } = this;
    const caseIndex = Math.floor(slot / SUBJECTS_PER_CASE);
    const elapsed = seconds - table.since[slot]!;
    const to = table.escortTo[slot];
    if (to === ESCORT_TO.car) {
      this.stepToCar(slot, cop, seconds);
      return;
    }
    const arrived = cops.gapTo(cop, cops.aimX[cop]!, cops.aimZ[cop]!) <= ESCORT_ARRIVE;
    if (!arrived && elapsed < (to === ESCORT_TO.station ? STATION_ESCORT_SECONDS : ESCORT_SECONDS)) return;
    if ((to === ESCORT_TO.station && station !== null) || table.isPlayerSlot(slot)) this.hooks.raise(caseIndex, slot);
    this.finishCustody(slot, cop, seconds);
  }

  /** She is let out of the cop's hands: the crowd keeps her off the street till her next walk, and he runs on for his case. */
  private finishCustody(slot: number, cop: number, seconds: number): void {
    this.table.hold(this.table.resident[slot]!, seconds);
    this.table.free(slot);
    this.cops.resume(cop);
  }

  /** Led to the car's driver's door, which follows the car while it is still coming: at the door, standing, they get in; not there in `CAR_BOARD_SECONDS`, or the car gone, they walk. */
  private stepToCar(slot: number, cop: number, seconds: number): void {
    const { table, cops, station } = this;
    const cars = this.hooks.cars();
    const car = table.carOf[slot]!;
    if (cars === null || station === null || !cars.doorSpot(car, this.door)) {
      table.carOf[slot] = -1;
      if (station !== null) this.walkToStation(slot, cop, seconds, station);
      return;
    }
    cops.aimX[cop] = this.door.x;
    cops.aimZ[cop] = this.door.z;
    if (cops.gapTo(cop, this.door.x, this.door.z) <= BOARD_REACH && cars.isStill(car)) {
      this.takeToDoor(slot, cop, seconds, SUBJECT_MODE.boarding);
      return;
    }
    if (seconds - table.since[slot]! < CAR_BOARD_SECONDS) return;
    table.carOf[slot] = -1;
    this.walkToStation(slot, cop, seconds, station);
  }

  /** The cop and his suspect stand at the car's driver's door (`this.door`, beside each other), doing `mode`'s clip. */
  private takeToDoor(slot: number, cop: number, seconds: number, mode: number): void {
    const { table, walkers } = this;
    const walker = FOOT_COP_COUNT + slot;
    table.mode[slot] = mode;
    table.since[slot] = seconds;
    this.cops.grip(cop);
    walkers.place(cop, this.door.x, this.door.z);
    walkers.place(walker, this.door.x + detCos(this.door.yaw) * BESIDE_COP, this.door.z - detSin(this.door.yaw) * BESIDE_COP);
    walkers.yaw[cop] = this.door.yaw;
    walkers.yaw[walker] = this.door.yaw;
    walkers.speed[walker] = 0;
  }

  /** In or out of the car: the door swings with the clip, and when it is over they are in (off the street, the car driving off) or out (led on to the station's door). */
  private stepDoor(slot: number, mode: number, seconds: number): void {
    const { table, cops, station } = this;
    const cars = this.hooks.cars();
    const car = table.carOf[slot]!;
    const cop = table.holder[slot]!;
    const getting = mode === SUBJECT_MODE.boarding ? "carIn" : "carOut";
    const clock = seconds - table.since[slot]!;
    if (cars === null || station === null) return;
    cars.openDoor(car, CAR_DOOR.openRad * carDoorOpenness(ACTIVITY[getting], clock));
    if (clock < ACTIVITY_SECONDS[getting]) return;
    cars.openDoor(car, 0);
    if (mode === SUBJECT_MODE.boarding && cars.convey(car, station.x, station.z, seconds)) {
      table.mode[slot] = SUBJECT_MODE.conveyed;
      table.since[slot] = seconds;
      cops.ride(cop);
      this.hooks.rode(slot, cars.carIndexOf(car));
      this.sendOtherCopsBack(Math.floor(slot / SUBJECTS_PER_CASE), cop);
      return;
    }
    table.carOf[slot] = -1;
    cars.finishRide(car, seconds);
    if (mode === SUBJECT_MODE.alighting && table.isPlayerSlot(slot)) {
      this.hooks.raise(Math.floor(slot / SUBJECTS_PER_CASE), slot);
      this.finishCustody(slot, cop, seconds);
      return;
    }
    this.walkToStation(slot, cop, seconds, station);
  }

  /** Car `carSlot` has come to the station: the suspects it carries get out at its door with their cops. */
  alight(carSlot: number, seconds: number): void {
    const { table } = this;
    const cars = this.hooks.cars();
    if (cars === null) return;
    for (let slot = 0; slot < table.mode.length; slot++) {
      if (table.mode[slot] !== SUBJECT_MODE.conveyed || table.carOf[slot] !== carSlot || !cars.doorSpot(carSlot, this.door)) continue;
      this.takeToDoor(slot, table.holder[slot]!, seconds, SUBJECT_MODE.alighting);
      this.hooks.alighted(slot, cars.carIndexOf(carSlot));
    }
  }

  private walkToStation(slot: number, cop: number, seconds: number, station: Station): void {
    this.table.since[slot] = seconds;
    this.table.mode[slot] = SUBJECT_MODE.escorted;
    this.leadTo(slot, cop, ESCORT_TO.station, station.x, station.z);
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
    if (!this.table.allCaught(caseIndex)) return;
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
