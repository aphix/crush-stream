import { detAtan2, detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import { clamp, wrapPi } from "../../kernel/scalar.ts";
import { clearDrive, DRIVE, idleDrive, type DriveInput } from "../../vehicle/car-drive.ts";
import type { ClassStats } from "../../vehicle/vehicle-classes.ts";
import { SURFACES } from "../../world/catalog.ts";
import { SURFACE } from "../../world/constants.ts";
import type { RoadNetwork } from "../../world/openworld/openworld-roads.ts";
import { MAX_CARS } from "../../scenes/fleet.ts";
import { Backoff } from "../cop-brain.ts";
import type { AiCar } from "../derby-ai.ts";
import { Pedals } from "../pedals.ts";
import { arcSpeed, LINE_W, turnRate } from "../race-ai.ts";
import {
  ARRIVED_DISTANCE,
  ARRIVED_SPEED,
  BOX_BLOCKING_SPEED,
  BOX_MARGIN,
  BOX_PATIENCE,
  BRAKE_OFF,
  BRAKE_ON,
  BRAKE_SPAN,
  CAP_WINDOW,
  CHASER_MARGIN,
  FLEE_CORNER_SCALE,
  FLEE_SPEED,
  SWERVE_BEHIND,
  SWERVE_LEFT,
  SWERVE_RIGHT,
  CRUISE_SPEED,
  FOLLOW_BRAKE,
  FOLLOW_GAP,
  LOOK_MINIMUM,
  LOOK_SECONDS,
  NOSE_OVERHANG,
  PATH_REACH,
  PATH_SAMPLE_STEP,
  PURSUIT_LONG,
  PURSUIT_SHORT,
  STOP_BRAKE,
  STOP_BRAKE_YELLOW,
  STOP_COMMIT,
  STOP_MARGIN,
  HELD_TARGET,
  URGENT_SPEED,
} from "./traffic-constants.ts";
import { LIGHT, lightState } from "./traffic-lights.ts";
import { blankRouteProjection, pointAtArc, projectOnRoute, type TripRoute } from "./trip-route.ts";

/** A route point and the unit direction there. */
type RoutePoint = { x: number; z: number; tx: number; tz: number };

/**
 * Drives a car along its `TripRoute`: pure pursuit on the route's points, the speed the lowest of the cruise, the turns' caps, the signal ahead (a red, or a yellow it can stop for, holds it
 * short of the bar; a box another car blocks holds it too), the car ahead on the route, and the end of the route (a stop). State per car id; allocates nothing after construction.
 */
export class TrafficDriver {
  private readonly network: RoadNetwork;
  private readonly out: DriveInput = idleDrive();
  private readonly pedals = new Pedals();
  private readonly wedge = new Backoff(MAX_CARS);
  private readonly projection = blankRouteProjection();
  private readonly aim: RoutePoint = { x: 0, z: 0, tx: 0, tz: 0 };
  private readonly sample: RoutePoint = { x: 0, z: 0, tx: 0, tz: 0 };
  private readonly segment = new Int32Array(MAX_CARS);
  private readonly aimSegment = new Int32Array(MAX_CARS);
  private readonly sampleSegment = new Int32Array(MAX_CARS);
  /** Per car: the next signal on its route it has not passed, the seconds it has waited on a blocked box and the signal whose box wait ran out (-1: none). */
  private readonly signal = new Int32Array(MAX_CARS);
  private readonly boxWaited = new Float64Array(MAX_CARS);
  private readonly boxGivenUp = new Int32Array(MAX_CARS).fill(-1);
  /** Per car: the signal it decided to stop at (-1: none). A decision to stop holds until the light is green, so a yellow it could stop for is not run once its own braking has made the stop harder. */
  private readonly stopLatched = new Int32Array(MAX_CARS).fill(-1);
  private readonly arc = new Float64Array(MAX_CARS);

  constructor(network: RoadNetwork) {
    this.network = network;
  }

  /** Car `id` starts a new route (or was put somewhere new): it has no history on it. */
  forget(id: number): void {
    this.segment[id] = 0;
    this.aimSegment[id] = 0;
    this.sampleSegment[id] = 0;
    this.signal[id] = 0;
    this.boxWaited[id] = 0;
    this.boxGivenUp[id] = -1;
    this.stopLatched[id] = -1;
    this.arc[id] = 0;
    this.pedals.forget(id);
    this.wedge.reset(id);
  }

  /** Whether car `id`, going `speed` m/s, has come to the end of `route` and stopped. */
  arrived(id: number, route: TripRoute, speed: number): boolean {
    return route.length - this.arc[id]! < ARRIVED_DISTANCE && speed < ARRIVED_SPEED;
  }

  /** How far (m) of `route` car `id` has left to drive, as of its last step. */
  remaining(id: number, route: TripRoute): number {
    return route.length - this.arc[id]!;
  }

  /**
   * One step for car `self` on `route` (`seconds` the crowd clock, which the signals read). `urgent`: no signal holds it, and it drives faster. `chaser`: the patrol car after it, and it drives as a racer evades one
   * (`RaceBrain`): gas on, no signal held, the corners taken harder (`arcSpeed`), and the line swung a car width clear of the chaser's when it is close behind.
   */
  think(self: AiCar, route: TripRoute, cls: ClassStats, others: readonly AiCar[], seconds: number, dt: number, urgent: boolean, chaser: AiCar | null = null): DriveInput {
    const out = clearDrive(this.out);
    const id = self.id;
    if (!self.alive) return out;
    if (self.crashed) {
      out.brake = 1;
      return out;
    }
    if (this.wedge.backing(id, dt, out)) {
      this.pedals.follow(id, out);
      return out;
    }
    projectOnRoute(route, self.x, self.z, this.segment[id]!, this.projection);
    this.segment[id] = this.projection.segment;
    const arc = this.projection.arc;
    this.arc[id] = arc;
    const speed = hypot2(self.vx, self.vz);
    const along = self.vx * detSin(self.yaw) + self.vz * detCos(self.yaw);
    const reach = clamp(4 + 0.5 * speed, PURSUIT_SHORT, PURSUIT_LONG);
    this.aimSegment[id] = pointAtArc(route, arc + reach, this.aimSegment[id]!, this.aim);
    const swing = chaser === null ? 0 : this.swerveShift(self, chaser);
    const alpha = wrapPi(detAtan2(this.aim.x + detCos(self.yaw) * swing - self.x, this.aim.z - detSin(self.yaw) * swing - self.z) - self.yaw);
    const surface = SURFACES[SURFACE.asphalt];
    const turnMax = turnRate(cls, speed, surface);
    out.steer = clamp((2 * Math.max(speed, 3) * detSin(alpha)) / reach / Math.max(0.2, turnMax), -1, 1);
    let target = chaser !== null ? Math.min(FLEE_SPEED, cls.topSpeed) : urgent ? URGENT_SPEED : CRUISE_SPEED;
    target = Math.min(target, this.turnLimit(route, arc, chaser !== null ? FLEE_CORNER_SCALE : 1));
    if (chaser !== null) target = Math.min(target, arcSpeed(cls, reach, alpha, surface));
    if (!urgent && chaser === null) target = Math.min(target, this.signalLimit(self, route, arc, along, seconds, dt, others));
    target = Math.min(target, this.leadLimit(self, route, arc, speed, others));
    target = Math.min(target, Math.sqrt(2 * STOP_BRAKE * Math.max(0, route.length - arc)));
    const stop = target < HELD_TARGET;
    if (this.pedals.latch(id, stop ? Infinity : along - target, BRAKE_ON, BRAKE_OFF)) out.brake = stop ? 1 : clamp((along - target + BRAKE_OFF) / BRAKE_SPAN, 0, 1);
    else out.throttle = clamp(target / DRIVE.maxFwd + (target - along) * 0.15, 0, 1);
    this.pedals.shape(id, out, dt);
    this.wedge.watch(id, self.x, self.z, dt, out);
    return out;
  }

  /** The speed (m/s) the caps of the route points ahead allow here: each point's cap, reachable by braking at `STOP_BRAKE` from the distance; `scale` raises the caps and the braking (an evading driver takes turns harder). */
  private turnLimit(route: TripRoute, arc: number, scale: number): number {
    let limit = Infinity;
    for (let point = this.projection.segment + 1; point < route.count && route.arc[point]! - arc <= CAP_WINDOW; point++) {
      const cap = route.cap[point]! * scale;
      limit = Math.min(limit, Math.sqrt(cap * cap + 2 * STOP_BRAKE * scale * Math.max(0, route.arc[point]! - arc)));
    }
    return limit;
  }

  /** How far (m) to the left (+) the aim swings off the lane's line to keep `LINE_W` and `CHASER_MARGIN` clear of a chaser close behind and in the car's lane (race-ai's rule); 0 when it is not. */
  private swerveShift(self: AiCar, chaser: AiCar): number {
    const forwardX = detSin(self.yaw);
    const forwardZ = detCos(self.yaw);
    const dx = chaser.x - self.x;
    const dz = chaser.z - self.z;
    const ahead = dx * forwardX + dz * forwardZ;
    const side = dx * forwardZ - dz * forwardX;
    if (ahead > 0 || ahead < -SWERVE_BEHIND || Math.abs(side) > LINE_W) return 0;
    const away = side >= 0 ? -1 : 1;
    const clear = LINE_W + CHASER_MARGIN;
    let to = side + away * clear;
    if (to > SWERVE_LEFT || to < -SWERVE_RIGHT) to = side - away * clear;
    return clamp(to, -SWERVE_RIGHT, SWERVE_LEFT);
  }

  /** The speed (m/s) the next signal allows: unlimited on green, a stop at the bar on red, on yellow a stop when braking at `STOP_BRAKE_YELLOW` still makes it. */
  private signalLimit(self: AiCar, route: TripRoute, arc: number, along: number, seconds: number, dt: number, others: readonly AiCar[]): number {
    const id = self.id;
    let signal = this.signal[id]!;
    while (signal < route.signalCount && arc > this.stopArc(route, signal) + STOP_COMMIT) signal++;
    this.signal[id] = signal;
    if (signal >= route.signalCount) return Infinity;
    const distance = this.stopArc(route, signal) - arc;
    const state = lightState(route.signalJunction[signal]!, route.signalPhase[signal]!, seconds);
    if (state === LIGHT.green) this.stopLatched[id] = -1;
    let hold = this.stopLatched[id] === signal;
    if (!hold && (state === LIGHT.red || (state === LIGHT.yellow && along * along < 2 * STOP_BRAKE_YELLOW * Math.max(0, distance)))) {
      hold = true;
      this.stopLatched[id] = signal;
    }
    if (!hold && this.boxGivenUp[id] !== signal && distance < CAP_WINDOW && this.boxBlocked(self, route.signalJunction[signal]!, others)) {
      hold = true;
      this.boxWaited[id]! += along < 1 ? dt : 0;
      if (this.boxWaited[id]! > BOX_PATIENCE) {
        this.boxGivenUp[id] = signal;
        this.boxWaited[id] = 0;
      }
    }
    if (!hold) return Infinity;
    return distance <= 0 ? 0 : Math.sqrt(2 * STOP_BRAKE * distance);
  }

  /** Where (arc, m) the centre of a car stops for signal `signal`: its nose short of the bar. */
  private stopArc(route: TripRoute, signal: number): number {
    return route.barArc[signal]! - NOSE_OVERHANG - STOP_MARGIN;
  }

  /** Another car standing in junction `junction`'s box, slow enough to be blocking it. */
  private boxBlocked(self: AiCar, junction: number, others: readonly AiCar[]): boolean {
    const half = this.network.boxHalf + BOX_MARGIN;
    const centreX = this.network.junctionX[junction]!;
    const centreZ = this.network.junctionZ[junction]!;
    for (let index = 0; index < others.length; index++) {
      const other = others[index]!;
      if (other.id === self.id || !other.alive) continue;
      if (Math.abs(other.x - centreX) < half && Math.abs(other.z - centreZ) < half && hypot2(other.vx, other.vz) < BOX_BLOCKING_SPEED) return true;
    }
    return false;
  }

  /** The speed (m/s) that keeps `FOLLOW_GAP` behind the nearest car on the route ahead, sampled every `PATH_SAMPLE_STEP` m out to what a driver at this speed looks. */
  private leadLimit(self: AiCar, route: TripRoute, arc: number, speed: number, others: readonly AiCar[]): number {
    const id = self.id;
    const look = Math.max(LOOK_MINIMUM, LOOK_SECONDS * speed);
    const sample = this.sample;
    this.sampleSegment[id] = this.segment[id]!;
    for (let ahead = PATH_SAMPLE_STEP; ahead <= look && arc + ahead <= route.length; ahead += PATH_SAMPLE_STEP) {
      this.sampleSegment[id] = pointAtArc(route, arc + ahead, this.sampleSegment[id]!, sample);
      for (let index = 0; index < others.length; index++) {
        const other = others[index]!;
        if (other.id === id || !other.alive) continue;
        const dx = other.x - sample.x;
        const dz = other.z - sample.z;
        if (Math.abs(dx) > PATH_REACH || Math.abs(dz) > PATH_REACH || hypot2(dx, dz) > PATH_REACH) continue;
        const leadSpeed = Math.max(0, other.vx * sample.tx + other.vz * sample.tz);
        return leadSpeed + Math.sqrt(2 * FOLLOW_BRAKE * Math.max(0, ahead - FOLLOW_GAP));
      }
    }
    return Infinity;
  }
}
