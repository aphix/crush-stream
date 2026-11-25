import { hypot2 } from "../../kernel/physics-core.js";
import type { DeformableCar } from "../../vehicle/car.ts";
import { tickAt } from "./civilian-clock.ts";
import { EVENT_KIND, NO_PLACE } from "./civilian-constants.ts";
import { comingAt } from "./civilian-contact.ts";
import { AMBULANCE_DELAY_SECONDS, AMBULANCE_RETRIES, AMBULANCE_RETRY_SECONDS, DANGER_CONFIRM_SECONDS, DANGER_LOCKOUT_SECONDS, DANGER_SHARED_SECONDS } from "./civilian-crowd-constants.ts";
import type { CityState } from "./civilian-state.ts";
import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import { ambulanceCaller } from "./society-alarm.ts";
import type { CrowdEventLog } from "./crowd-event-log.ts";
import { nearestNode } from "./crowd-places.ts";
import type { CrowdPoses } from "./crowd-poses.ts";

/** What comes of a car coming at civilians: who is in danger of it, and who is down and waited for an ambulance. */
export class CrowdAftermath {
  /** Called on the host when someone run down has stayed down long enough to call an ambulance for: where they lie, when it was called and who they are. */
  onAmbulanceCall: ((x: number, z: number, seconds: number, victim: number) => void) | null = null;
  /** Per resident: when a car was first seen coming at them (-Infinity: none), when they may next be in danger, and when an ambulance is due for them and where they lie (Infinity: none). */
  private readonly dangerSince: Float64Array;
  private readonly dangerCar: Int16Array;
  private readonly dangerUntil: Float64Array;
  private readonly ambulanceDue: Float64Array;
  /** Times each one down has been looked for a caller for. */
  private readonly ambulanceTries: Uint8Array;
  private readonly ambulanceX: Float32Array;
  private readonly ambulanceZ: Float32Array;
  private lastDangerSeconds = -Infinity;

  constructor(capacity: number) {
    this.dangerSince = new Float64Array(capacity).fill(-Infinity);
    this.dangerCar = new Int16Array(capacity);
    this.dangerUntil = new Float64Array(capacity).fill(-Infinity);
    this.ambulanceDue = new Float64Array(capacity).fill(Infinity);
    this.ambulanceTries = new Uint8Array(capacity);
    this.ambulanceX = new Float32Array(capacity);
    this.ambulanceZ = new Float32Array(capacity);
  }

  /** `resident` was knocked down at crowd second `seconds`, where `poses` has her: an ambulance is due for her, but never for a run-down animal. */
  knockedDown(resident: number, seconds: number, animal: boolean, poses: CrowdPoses): void {
    this.ambulanceDue[resident] = animal ? Infinity : seconds + AMBULANCE_DELAY_SECONDS;
    this.ambulanceTries[resident] = 0;
    this.ambulanceX[resident] = poses.x[resident]!;
    this.ambulanceZ[resident] = poses.z[resident]!;
  }

  /** Car `carIndex` (velocity (vx, vz), `carSpeed`) coming at the civilian (toX, toZ from it) is noted for `raiseDangers` (`comingAt`: a car driving down the street is not). */
  watchApproach(resident: number, carIndex: number, toX: number, toZ: number, vx: number, vz: number, carSpeed: number, seconds: number): void {
    if (!comingAt(toX, toZ, vx, vz, carSpeed)) return;
    if (this.dangerSince[resident] !== -Infinity || seconds < this.dangerUntil[resident]!) return;
    this.dangerSince[resident] = seconds;
    this.dangerCar[resident] = carIndex;
  }

  /** Those a car came at who, `DANGER_CONFIRM_SECONDS` on, are still on their feet with it still coming at them (it did not brake or swerve) are in danger, seen by whoever is about; those it ran down are not (their knock is the news). */
  raiseDangers(seconds: number, cars: readonly DeformableCar[], poses: CrowdPoses, map: OpenWorldMap, events: CrowdEventLog): void {
    const { x, z, shown } = poses;
    for (let resident = 0; resident < this.dangerSince.length; resident++) {
      const since = this.dangerSince[resident]!;
      if (since === -Infinity || seconds - since < DANGER_CONFIRM_SECONDS) continue;
      this.dangerSince[resident] = -Infinity;
      const car = cars[this.dangerCar[resident]!];
      if (car === undefined || shown[resident] === 0 || seconds - this.lastDangerSeconds < DANGER_SHARED_SECONDS) continue;
      const vx = car.velocity.x;
      const vz = car.velocity.z;
      if (!comingAt(x[resident]! - car.group.position.x, z[resident]! - car.group.position.z, vx, vz, hypot2(vx, vz))) continue;
      const node = nearestNode(map, x[resident]!, z[resident]!);
      if (node === NO_PLACE) continue;
      this.dangerUntil[resident] = seconds + DANGER_LOCKOUT_SECONDS;
      this.lastDangerSeconds = seconds;
      events.logHostEvent(EVENT_KIND.danger, node, seconds);
    }
  }

  /** Someone run down `AMBULANCE_DELAY_SECONDS` ago is still down: the call is made (it is in the log for every peer) and whoever sends the ambulance hears of it. */
  raiseAmbulanceCalls(seconds: number, state: CityState, events: CrowdEventLog): void {
    for (let resident = 0; resident < this.ambulanceDue.length; resident++) {
      // Read only for a row that is due: a loop body V8 has no feedback for keeps `due` tagged, boxing every row's load every frame.
      if (!(this.ambulanceDue[resident]! <= seconds)) continue;
      let due = this.ambulanceDue[resident]!;
      while (due <= seconds) {
        if (ambulanceCaller(state, resident, tickAt(due)) !== NO_PLACE) {
          events.logHostEvent(EVENT_KIND.ambulance, resident, due);
          this.onAmbulanceCall?.(this.ambulanceX[resident]!, this.ambulanceZ[resident]!, due, resident);
          due = Infinity;
        } else if (this.ambulanceTries[resident]!++ < AMBULANCE_RETRIES) due += AMBULANCE_RETRY_SECONDS;
        else due = Infinity;
      }
      this.ambulanceDue[resident] = due;
    }
  }
}
