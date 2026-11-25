import { hypot2 } from "../../kernel/physics-core.js";
import { blankStrike, fell, felled, type FigureStrike } from "../../scenes/figure-strike.ts";
import type { DeformableCar } from "../../vehicle/car.ts";
import { activeGround } from "../../world/ground.ts";
import { EVENT_KIND, EVENT_TRIPLE } from "./civilian-constants.ts";
import { HEARD_KNOCK_LATE_SECONDS, HEARD_KNOCK_QUEUE } from "./civilian-crowd-constants.ts";
import { LegPose, legPose } from "./civilian-leg.ts";
import type { CityState } from "./civilian-state.ts";
import type { CrowdPoses } from "./crowd-poses.ts";

/** Where a throw of `resident` starts at (x, z): the stoop step she was last drawn on (`feetY`, a world height), the ground's where it is higher, as the bodies read it, so she is not thrown from inside the steps. */
export function groundUnder(poses: CrowdPoses, resident: number, x: number, z: number): number {
  return Math.max(activeGround().heightAt(x, z), poses.feetY[resident]!);
}

/** `out` as the blow of `striker` felling `victim`: along the line from his drawn spot to hers, from the ground under her. */
export function felledBy(poses: CrowdPoses, victim: number, striker: number, out: FigureStrike): FigureStrike {
  const { x, z } = poses;
  const dx = x[victim]! - x[striker]!;
  const dz = z[victim]! - z[striker]!;
  const far = hypot2(dx, dz);
  return felled(victim, x[victim]!, groundUnder(poses, victim, x[victim]!, z[victim]!), z[victim]!, far > 0 ? dx / far : 0, far > 0 ? dz / far : 1, out);
}

/** The knocks a client has heard from the host and has yet to throw: they wait for its clock to reach them (it runs behind the host's). */
export class HeardKnocks {
  private readonly heardKnockResident = new Int32Array(HEARD_KNOCK_QUEUE);
  private readonly heardKnockSeconds = new Float64Array(HEARD_KNOCK_QUEUE);
  private heardKnocks = 0;
  private readonly heardKnockBy = new Int32Array(HEARD_KNOCK_QUEUE).fill(-1);
  private readonly pose = new LegPose();

  /** The host's log entry `at` of `events` (kind, subject, `seconds`) is heard: a knock of a civilian of `poses` is kept to be thrown. */
  hear(events: Float64Array, at: number, kind: number, subject: number, seconds: number, poses: CrowdPoses): void {
    if (kind === EVENT_KIND.knock && this.heardKnocks < HEARD_KNOCK_QUEUE && subject >= 0 && subject < poses.count) {
      // A knock that names its striker is followed by her push and an `alongside` triple at the same second.
      const pushed = at + EVENT_TRIPLE;
      const alongside = pushed + EVENT_TRIPLE;
      const named = alongside + EVENT_TRIPLE <= events.length && events[pushed] === EVENT_KIND.push && events[pushed + 1] === subject && events[pushed + 2] === seconds && events[alongside] === EVENT_KIND.alongside && events[alongside + 2] === seconds;
      this.heardKnockBy[this.heardKnocks] = named ? events[alongside + 1]! : -1;
      this.heardKnockResident[this.heardKnocks] = subject;
      this.heardKnockSeconds[this.heardKnocks++] = seconds;
    }
  }

  /** A knock heard from the host, once this clock (`now`) reaches its time (the cars are drawn at that time): the civilian is thrown by the car nearest where they were, as that car's own hit would have thrown them, into `struck`. */
  throwDue(now: number, state: CityState, cars: readonly DeformableCar[], poses: CrowdPoses, struck: FigureStrike[]): void {
    let waiting = 0;
    for (let knock = 0; knock < this.heardKnocks; knock++) {
      const resident = this.heardKnockResident[knock]!;
      const at = this.heardKnockSeconds[knock]!;
      if (at > now) {
        this.heardKnockBy[waiting] = this.heardKnockBy[knock]!;
        this.heardKnockResident[waiting] = resident;
        this.heardKnockSeconds[waiting++] = at;
        continue;
      }
      if (now - at > HEARD_KNOCK_LATE_SECONDS) continue;
      const by = this.heardKnockBy[knock]!;
      if (by >= 0) {
        struck.push(felledBy(poses, resident, by, blankStrike()));
        continue;
      }
      if (!legPose(state, resident, at, this.pose)) continue;
      let nearest = -1;
      let nearestDistance = Infinity;
      for (let carIndex = 0; carIndex < cars.length; carIndex++) {
        const distance = hypot2(cars[carIndex]!.group.position.x - this.pose.x, cars[carIndex]!.group.position.z - this.pose.z);
        if (distance >= nearestDistance) continue;
        nearestDistance = distance;
        nearest = carIndex;
      }
      if (nearest < 0) continue;
      struck.push(fell(cars[nearest]!, nearest, resident, this.pose.x, groundUnder(poses, resident, this.pose.x, this.pose.z), this.pose.z, this.pose.dirX, this.pose.dirZ, blankStrike()));
    }
    this.heardKnocks = waiting;
  }
}
