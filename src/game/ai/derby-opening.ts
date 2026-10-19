import { hypot2, detSin, detCos } from "../kernel/physics-core.js";
import { MAX_CARS } from "../scenes/fleet.ts";
import type { DriveInput } from "../vehicle/car-drive.ts";
import type { AiCar } from "./derby-ai.ts";

/**
 * Opening caution (owner 10-04): until `OPEN_S` s into a heat or this car's own first aggressive hit, a driver does not
 * drive its nose into a rival at a high closing speed: it lifts and brakes, so the first meetings are glancing or
 * rear-first (the tail-first strikes and sideswipes still run) and not a nose trade. Wheels off now cost steering, thrust
 * and brakes (`wheelLoss`), so a car that loses one in a 40 m/s head-on is crippled: derby seed 17 lost an engine at 7.1 s.
 */
const OPEN_S = 8;
/** Closing speed (m/s) the nose is held to off a rival ahead. */
const OPEN_CLOSING = 7;
/** Only a rival this close (m) is worth lifting for. */
const OPEN_RANGE = 24;
/** A rival counts as "ahead" within this cosine of the nose (about 60 degrees). */
const OPEN_CONE = 0.5;
/** Brake held while it closes too fast. */
const OPEN_BRAKE = 0.7;
/** Width (m/s) of the band round `OPEN_CLOSING` the lift and brake switch on above and off below: on the line alone the closing speed crossed it at the step rate and brake and gas swapped every step. */
const OPEN_BAND = 1;

/** The fastest `self`'s nose closes on a live rival in range ahead of it (m/s); 0 when it closes on none. */
function aheadClosing(self: AiCar, others: readonly AiCar[]): number {
  const fx = detSin(self.yaw);
  const fz = detCos(self.yaw);
  let most = 0;
  for (const o of others) {
    if (o.id === self.id || !o.alive) continue;
    const dx = o.x - self.x;
    const dz = o.z - self.z;
    const d = hypot2(dx, dz);
    if (d > OPEN_RANGE || d < 1e-3) continue;
    if ((fx * dx + fz * dz) / d < OPEN_CONE) continue;
    // Range rate alone is blind to a crossing rival (its centre line turns as the cars close, so a 3 m/s range rate meets
    // at 7 m/s along the contact normal): take the nose's own relative speed too.
    const noseClosing = (self.vx - o.vx) * fx + (self.vz - o.vz) * fz;
    most = Math.max(most, -((o.vx - self.vx) * dx + (o.vz - self.vz) * dz) / d, noseClosing);
  }
  return most;
}

/** Per driver: whether it has landed its first aggressive hit (`self.idle` dropped), which ends its opening caution. */
export class OpeningWatch {
  private readonly idleWas = new Float64Array(MAX_CARS);
  private readonly hitOnce = new Uint8Array(MAX_CARS);
  /** Per driver: its lift and brake are on (`OPEN_BAND`). */
  private readonly braking = new Uint8Array(MAX_CARS);

  reset(): void {
    this.idleWas.fill(0);
    this.hitOnce.fill(0);
    this.braking.fill(0);
  }

  /** Track `self`'s hit state; lift and brake `out` in place while its nose closes too fast on a live rival (`OPEN_BAND`); no-op once the opening is over (`seconds` is the driver's age in the heat). */
  apply(out: DriveInput, self: AiCar, others: readonly AiCar[], seconds: number): void {
    const i = self.id;
    if (self.idle < this.idleWas[i]!) this.hitOnce[i] = 1;
    this.idleWas[i] = self.idle;
    if (this.hitOnce[i] === 1 || seconds >= OPEN_S || out.throttle <= 0) {
      this.braking[i] = 0;
      return;
    }
    const closing = aheadClosing(self, others);
    if (closing > OPEN_CLOSING + OPEN_BAND / 2) this.braking[i] = 1;
    else if (closing < OPEN_CLOSING - OPEN_BAND / 2) this.braking[i] = 0;
    if (this.braking[i] === 0) return;
    out.throttle = 0;
    out.brake = OPEN_BRAKE;
    out.boost = false;
  }
}
