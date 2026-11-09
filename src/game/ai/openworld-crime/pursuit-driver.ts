import { detAtan2, hypot2 } from "../../kernel/physics-core.js";
import { clamp, wrapPi } from "../../kernel/scalar.ts";
import type { DriveInput } from "../../vehicle/car-drive.ts";
import { classStats } from "../../vehicle/vehicle-classes.ts";
import { SURFACES } from "../../world/catalog.ts";
import { Backoff, pursuitSteer } from "../cop-brain.ts";
import type { AiCar } from "../derby-ai.ts";
import type { Obstacles } from "../obstacles.ts";
import { Pedals } from "../pedals.ts";
import { arcSpeed, brakeOver, turnRate } from "../race-ai.ts";
import { AVOID_TURN_COST, AVOID_TURNS, CAR_LEAD_SECONDS, CAR_STOP_DECEL, MAX_PATROL_CARS } from "./crime-constants.ts";

const PATROL_CLASS = classStats("sedan");
const GROUND = SURFACES.asphalt;
/** Metres of clear road the heading search looks along, from a speed-scaled reach: the hunters' own. */
const LOOK_BASE = 8;
const LOOK_PER_SPEED = 1.1;
const LOOK_MIN = 12;
const LOOK_MAX = 34;
/** Pure pursuit looks this share of the speed ahead, between these reaches (m). */
const REACH_PER_SPEED = 0.8;
const REACH_MIN = 8;
const REACH_MAX = 24;
/** A car this slow (m/s) that wants to stand still is held on the brake. */
const STANDING_SPEED = 1;

/** The police's open-ground pursuit for one car at a time of `MAX_PATROL_CARS`: pure pursuit (`pursuitSteer`) at where the aim will be, bent round the course's solids when `obstacles` are given, held to the speed its turn allows (`arcSpeed`) and brought to a stop short of the aim on request, with the wedge back-off the police share (`Backoff`). */
export class PursuitDriver {
  private readonly obstacles: Obstacles | null;
  private readonly pedals = new Pedals();
  private readonly backoff = new Backoff(MAX_PATROL_CARS);
  private readonly side = new Int8Array(MAX_PATROL_CARS).fill(1);

  constructor(obstacles: Obstacles | null) {
    this.obstacles = obstacles;
  }

  /** Writes into `out` what car `self` (patrol slot `slot`) does over `dt` s to drive at (aimX, aimZ) moving at (aimVx, aimVz); it stops `stopGap` m short of the aim (0: never stops). */
  drive(slot: number, self: AiCar, aimX: number, aimZ: number, aimVx: number, aimVz: number, stopGap: number, dt: number, out: DriveInput): void {
    out.throttle = 0;
    out.steer = 0;
    out.brake = 0;
    out.ebrake = false;
    out.boost = false;
    if (this.backoff.backing(slot, dt, out)) {
      this.pedals.follow(self.id, out);
      return;
    }
    const speed = hypot2(self.vx, self.vz);
    const distance = hypot2(aimX - self.x, aimZ - self.z);
    const lead = Math.min(CAR_LEAD_SECONDS, distance / Math.max(LOOK_BASE, speed));
    const leadX = aimX + aimVx * lead;
    const leadZ = aimZ + aimVz * lead;
    const leadDistance = hypot2(leadX - self.x, leadZ - self.z);
    const heading = this.openHeading(slot, self, detAtan2(leadX - self.x, leadZ - self.z), speed, leadDistance);
    const alpha = wrapPi(heading - self.yaw);
    out.steer = pursuitSteer(alpha, Math.min(leadDistance, clamp(speed * REACH_PER_SPEED, REACH_MIN, REACH_MAX)), speed, turnRate(PATROL_CLASS, speed, GROUND));
    const turnSpeed = arcSpeed(PATROL_CLASS, Math.max(4, leadDistance), Math.min(Math.abs(alpha), Math.PI / 2), GROUND);
    const stopSpeed = stopGap > 0 ? Math.sqrt(2 * CAR_STOP_DECEL * Math.max(0, distance - stopGap)) : Infinity;
    const wanted = Math.min(turnSpeed, stopSpeed);
    const brake = brakeOver(this.pedals, self.id, speed - wanted);
    if (brake > 0) out.brake = brake;
    else out.throttle = Math.min(1, wanted / PATROL_CLASS.topSpeed);
    if (stopSpeed === 0 && speed < STANDING_SPEED) out.brake = 1;
    this.pedals.shape(self.id, out, dt);
    this.backoff.watch(slot, self.x, self.z, dt, out);
  }

  /** The heading nearest `want` whose way is clear of solids for the next stretch; the one with the longest clear run when none is, each radian of bend costing `AVOID_TURN_COST` m. */
  private openHeading(slot: number, self: AiCar, want: number, speed: number, aimDistance: number): number {
    const obstacles = this.obstacles;
    if (obstacles === null) return want;
    const length = Math.min(aimDistance, clamp(speed * LOOK_PER_SPEED + LOOK_BASE, LOOK_MIN, LOOK_MAX));
    let best = want;
    let bestScore = obstacles.run(self.x, self.z, want, length);
    if (bestScore >= length) return want;
    const preferred = this.side[slot]!;
    for (let at = 0; at < AVOID_TURNS.length; at++) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const side = attempt === 0 ? preferred : -preferred;
        const heading = want + side * AVOID_TURNS[at]!;
        const run = obstacles.run(self.x, self.z, heading, length);
        const score = run >= length ? Infinity : run - AVOID_TURNS[at]! * AVOID_TURN_COST;
        if (score <= bestScore) continue;
        bestScore = score;
        best = heading;
        this.side[slot] = side;
        if (run >= length) return heading;
      }
    }
    return best;
  }
}
