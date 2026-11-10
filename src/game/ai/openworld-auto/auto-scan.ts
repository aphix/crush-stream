import { detAtan2, detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import type { DeformableCar } from "../../vehicle/car.ts";
import { PLATFORM_CAMERA } from "../../vehicle/car-styles/platform.ts";
import { tickAt } from "../civilians/civilian-clock.ts";
import { CENTIMETRES_PER_METRE, EVENT_KIND, EVENT_TRIPLE, FLAG, RESIDENT_INT, RESIDENT_INT_STRIDE } from "../civilians/civilian-constants.ts";
import type { CivilianCrowd } from "../civilians/civilian-crowd.ts";
import type { LookText } from "../civilians/civilian-look.ts";
import { buildingLines, civilianLine, historyLines, moodOf } from "../civilians/civilian-mood.ts";
import type { CrowdPoses } from "../civilians/crowd-poses.ts";
import { ACTIVITY, activityLine } from "../civilians/civilian-activity.ts";
import { AMBULANCE } from "../openworld-traffic/ambulance.ts";
import { CRIMINAL_INTEREST, PERSON_SHOT, SPOT_SHOT, WANTED_INTEREST } from "./auto-constants.ts";
import { type AutoCandidates, SUBJECT, type SubjectKind } from "./auto-director.ts";
import { activityInterest, ambulanceInterest, copInterest, driverInterest, eventInterest, moodInterest } from "./auto-interest.ts";

/** What the scan reads of the open world; each is null (or empty) where the thing is not there. */
export type AutoWorld = {
  crowd(): CivilianCrowd | null;
  /** The foot cops' poses (`CrimeScene.copPoses`). */
  cops(): CrowdPoses | null;
  /** The resident at the wheel of engine car `carIndex`; -1 for none or a kerb car. */
  residentAt(carIndex: number): number;
  cars(): readonly DeformableCar[];
  /** The engine's index of the ambulance's car (-1 when none is out) and where its call is (`AMBULANCE`). */
  ambulanceCar(): number;
  ambulanceState(): number;
  /** Engine car `carIndex` is a viewer's own (a seated player's car), never followed. */
  isPlayerCar(carIndex: number): boolean;
};

/** Where the camera stands round a subject: its spot on the ground, the way it faces, how fast it moves, and the shot (m behind, over its feet, aimed over them). */
export type AutoPose = { x: number; y: number; z: number; yaw: number; speed: number; back: number; height: number; aimUp: number };

export function newAutoPose(): AutoPose {
  return { x: 0, y: 0, z: 0, yaw: 0, speed: 0, back: 0, height: 0, aimUp: 0 };
}

/**
 * The open world as the Auto director sees it: every civilian, foot cop and driver worth a look and why (`fill`), whether one can still be watched,
 * where to stand round one (`poseOf`) and what the look-at bubble says of it (`textOf`). The same bubble the panel shows when the eye is close.
 */
export class OpenWorldScan {
  private readonly world: AutoWorld;
  /** Per resident, the hottest event in progress that names them: written afresh each scan. */
  private readonly heat: Float32Array;

  constructor(world: AutoWorld, residents: number) {
    this.world = world;
    this.heat = new Float32Array(residents);
  }

  fill(table: AutoCandidates): void {
    const crowd = this.world.crowd();
    if (crowd !== null) this.fillCrowd(table, crowd);
    const cops = this.world.cops();
    if (cops !== null) this.fillCops(table, cops);
    this.fillDrivers(table);
  }

  watchable(kind: SubjectKind, id: number): boolean {
    const crowd = this.world.crowd();
    switch (kind) {
      case SUBJECT.civilian:
        return crowd !== null && crowd.poses.shown[id] === 1;
      case SUBJECT.cop: {
        const cops = this.world.cops();
        return cops !== null && cops.shown[id] === 1;
      }
      case SUBJECT.driver:
        return this.watchableCar(id);
      default:
        return crowd !== null;
    }
  }

  /** Where the camera stands for the subject, into `out`; false when it has none (it has gone). */
  poseOf(kind: SubjectKind, id: number, out: AutoPose): boolean {
    const crowd = this.world.crowd();
    if (kind === SUBJECT.driver) return this.carPose(id, out);
    if (kind === SUBJECT.cop) return this.world.cops() !== null && this.personPose(this.world.cops()!, id, out);
    if (crowd === null) return false;
    if (kind === SUBJECT.civilian) return this.personPose(crowd.poses, id, out);
    return kind === SUBJECT.wreck ? this.wreckPose(crowd, id, out) : this.knockPose(crowd, id, out);
  }

  /** The bubble for the subject: a civilian's or a driver's own line and life log, a cop's, a wrecked building's; null when it has gone. */
  textOf(kind: SubjectKind, id: number): LookText | null {
    const crowd = this.world.crowd();
    if (crowd === null) return null;
    const tick = tickAt(crowd.crowdSeconds);
    if (kind === SUBJECT.civilian || kind === SUBJECT.knock) return this.civilianText(crowd, id, tick);
    if (kind === SUBJECT.wreck) return buildingLines(crowd.state, id, tick);
    if (kind === SUBJECT.cop) return this.copText(id);
    return this.driverText(crowd, id, tick);
  }

  private fillCrowd(table: AutoCandidates, crowd: CivilianCrowd): void {
    const poses = crowd.poses;
    const state = crowd.state;
    const tick = tickAt(crowd.crowdSeconds);
    this.heat.fill(0);
    this.heatFromLog(table, crowd);
    for (let resident = 0; resident < poses.count; resident++) {
      if (poses.shown[resident] === 0) continue;
      const flags = state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.flags]!;
      let interest = Math.max(this.heat[resident]!, activityInterest(poses.activity[resident]!), moodInterest(moodOf(state, resident, tick)));
      if ((flags & FLAG.wanted) !== 0) interest = Math.max(interest, WANTED_INTEREST);
      else if ((flags & FLAG.criminal) !== 0) interest = Math.max(interest, CRIMINAL_INTEREST);
      table.add(SUBJECT.civilian, resident, interest);
    }
  }

  /** The log's events in progress: a civilian they name gets their heat; a wreck, a knock and an ambulance call (where the one run down lies) are spots of their own. */
  private heatFromLog(table: AutoCandidates, crowd: CivilianCrowd): void {
    const log = crowd.eventLog();
    const now = crowd.crowdSeconds;
    for (let at = 0; at + EVENT_TRIPLE <= log.length; at += EVENT_TRIPLE) {
      const kind = log[at]!;
      const subject = log[at + 1]!;
      const interest = eventInterest(kind, now - log[at + 2]!);
      if (interest === 0) continue;
      if (kind === EVENT_KIND.wreck) table.add(SUBJECT.wreck, subject, interest);
      else if (kind === EVENT_KIND.knock || kind === EVENT_KIND.ambulance) table.add(SUBJECT.knock, subject, interest);
      else if (kind !== EVENT_KIND.copDown) this.warm(subject, interest);
      if ((kind === EVENT_KIND.push || kind === EVENT_KIND.fight) && log[at + EVENT_TRIPLE] === EVENT_KIND.alongside) this.warm(log[at + EVENT_TRIPLE + 1]!, interest);
    }
  }

  private warm(resident: number, interest: number): void {
    if (resident >= 0 && resident < this.heat.length) this.heat[resident] = Math.max(this.heat[resident]!, interest);
  }

  private fillCops(table: AutoCandidates, cops: CrowdPoses): void {
    for (let cop = 0; cop < cops.count; cop++) {
      if (cops.shown[cop] === 0) continue;
      table.add(SUBJECT.cop, cop, copInterest(cops.activity[cop]!, cops.speed[cop]!));
    }
  }

  private fillDrivers(table: AutoCandidates): void {
    const cars = this.world.cars();
    for (let index = 0; index < cars.length; index++) {
      if (!this.watchableCar(index)) continue;
      const car = cars[index]!;
      table.add(SUBJECT.driver, index, index === this.world.ambulanceCar() ? ambulanceInterest(this.world.ambulanceState()) : driverInterest(hypot2(car.velocity.x, car.velocity.z), car.sirens));
    }
  }

  /** A car in play with a driver: a resident's, a police car (the patrol's) or the ambulance (a client has no traffic to name its drivers, but is told its car); not a player's own, not put away. */
  private watchableCar(index: number): boolean {
    const car = this.world.cars()[index];
    if (car === undefined || car.stored || car.vaporized || !car.group.visible || this.world.isPlayerCar(index)) return false;
    return this.world.residentAt(index) >= 0 || car.style.id === "police" || index === this.world.ambulanceCar();
  }

  private personPose(poses: CrowdPoses, index: number, out: AutoPose): boolean {
    if (index >= poses.count || poses.shown[index] === 0) return false;
    out.x = poses.x[index]!;
    out.y = poses.feetY[index]!;
    out.z = poses.z[index]!;
    out.yaw = poses.yaw[index]!;
    out.speed = poses.speed[index]!;
    out.back = PERSON_SHOT.back;
    out.height = PERSON_SHOT.height;
    out.aimUp = PERSON_SHOT.aimUp;
    return true;
  }

  private carPose(index: number, out: AutoPose): boolean {
    const car = this.world.cars()[index];
    if (car === undefined || !this.watchableCar(index)) return false;
    const shot = (car.style.camera ?? PLATFORM_CAMERA).third;
    out.x = car.group.position.x;
    out.y = car.group.position.y;
    out.z = car.group.position.z;
    out.yaw = detAtan2(car.fwdFlat.x, car.fwdFlat.z);
    out.speed = hypot2(car.velocity.x, car.velocity.z);
    out.back = shot.dist;
    out.height = shot.height;
    out.aimUp = shot.aimUp;
    return true;
  }

  /** The wrecked place: its front wall's middle, "facing" into the building (the camera stands out in the street behind that heading). */
  private wreckPose(crowd: CivilianCrowd, place: number, out: AutoPose): boolean {
    const entry = crowd.state.map.places[place];
    if (entry === undefined) return false;
    out.x = entry.x + detCos(entry.yaw) * (entry.depth / 2);
    out.z = entry.z - detSin(entry.yaw) * (entry.depth / 2);
    out.y = 0;
    out.yaw = detAtan2(-detCos(entry.yaw), detSin(entry.yaw));
    out.speed = 0;
    this.spotShot(out);
    return true;
  }

  private knockPose(crowd: CivilianCrowd, resident: number, out: AutoPose): boolean {
    const base = resident * RESIDENT_INT_STRIDE;
    out.x = crowd.state.ints[base + RESIDENT_INT.knockX]! / CENTIMETRES_PER_METRE;
    out.z = crowd.state.ints[base + RESIDENT_INT.knockZ]! / CENTIMETRES_PER_METRE;
    out.y = 0;
    out.yaw = crowd.poses.yaw[resident]!;
    out.speed = 0;
    this.spotShot(out);
    return true;
  }

  private spotShot(out: AutoPose): void {
    out.back = SPOT_SHOT.back;
    out.height = SPOT_SHOT.height;
    out.aimUp = SPOT_SHOT.aimUp;
  }

  private copText(cop: number): LookText | null {
    const cops = this.world.cops();
    if (cops === null || cops.shown[cop] === 0) return null;
    const activity = cops.activity[cop]!;
    const doing = activity === ACTIVITY.arresting || activity === ACTIVITY.cuffing ? "making an arrest" : activity === ACTIVITY.escorting ? "leading a suspect away" : cops.speed[cop]! > 0 ? "on the move" : "on his beat";
    return { title: `Officer ${cop + 1} - ${doing}`, lines: [] };
  }

  /** A civilian's line, then what he is doing when the line does not say it, then his life log. */
  private civilianText(crowd: CivilianCrowd, resident: number, tick: number): LookText {
    const doing = crowd.poses.shown[resident] === 1 ? activityLine(crowd.poses.activity[resident]!) : null;
    const history = historyLines(crowd.state, resident);
    return { title: civilianLine(crowd.state, resident, tick), lines: doing === null ? history : [doing, ...history] };
  }

  private ambulanceText(): LookText {
    const state = this.world.ambulanceState();
    if (state === AMBULANCE.loading) return { title: "Ambulance - paramedics at the scene", lines: ["loading a patient"] };
    return { title: state === AMBULANCE.leaving ? "Ambulance - driving off" : "Ambulance - answering a call", lines: ["lights on"] };
  }

  private driverText(crowd: CivilianCrowd, carIndex: number, tick: number): LookText | null {
    const car = this.world.cars()[carIndex];
    if (car === undefined) return null;
    const resident = this.world.residentAt(carIndex);
    if (resident >= 0) return { title: civilianLine(crowd.state, resident, tick), lines: ["at the wheel", ...historyLines(crowd.state, resident)] };
    if (carIndex === this.world.ambulanceCar()) return this.ambulanceText();
    return { title: `Patrol car - officer at the wheel`, lines: [car.sirens ? "siren on, answering a call" : "on patrol"] };
  }
}
