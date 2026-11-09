import { EVENT_KIND, EVENT_TRIPLE } from "../ai/civilians/civilian-constants.ts";
import type { CivilianCrowd } from "../ai/civilians/civilian-crowd.ts";
import { AMBULANCE } from "../ai/openworld-traffic/ambulance.ts";

/** A stage's subject is its car index times this plus its state (`AMBULANCE`, 0 to 3): it fits the log's u16 subject and tells a client both. */
const STATES = 4;
/** No ambulance car: its index on a peer with none out. */
const NO_CAR = -1;

/** The log subject for the ambulance's car `car` in `state`. */
function stageSubject(car: number, state: number): number {
  return car * STATES + state;
}

/**
 * Where the open world's ambulance is, told through the crowd's event log so a client has it too (it has no traffic): the host notes each change of state or car as an `ambulanceStage` event, and a peer
 * reads the newest one. The brain drops the kind (it names no resident), as it does a foot cop's knock.
 */
export class AmbulanceStages {
  /** What the host last noted, or the newest stage a client heard: the state (`AMBULANCE`) and the ambulance's car index (-1 for none). */
  state: number = AMBULANCE.idle;
  car = NO_CAR;

  /** Host and solo, once a sim step: the traffic's ambulance is noted in the log when its state or car is not what was last noted. */
  note(crowd: CivilianCrowd, state: number, car: number): void {
    const carNow = state === AMBULANCE.idle ? NO_CAR : car;
    if (state === this.state && carNow === this.car) return;
    this.state = state;
    this.car = carNow;
    crowd.raiseEvent(EVENT_KIND.ambulanceStage, stageSubject(Math.max(carNow, 0), state));
  }

  /** A client, once a frame: the newest stage in the host's log (none heard: no ambulance out). */
  hear(log: Float64Array): void {
    this.state = AMBULANCE.idle;
    this.car = NO_CAR;
    for (let at = log.length - EVENT_TRIPLE; at >= 0; at -= EVENT_TRIPLE) {
      if (log[at] !== EVENT_KIND.ambulanceStage) continue;
      const subject = log[at + 1]!;
      this.state = subject % STATES;
      this.car = this.state === AMBULANCE.idle ? NO_CAR : Math.floor(subject / STATES);
      return;
    }
  }

  /** The open world is left, or its crowd made anew: nothing is out. */
  reset(): void {
    this.state = AMBULANCE.idle;
    this.car = NO_CAR;
  }
}

/** The resident the newest ambulance call in `log` is for, -1 for none: the person down, whose spot the ambulance is sent to. */
export function newestCalled(log: Float64Array): number {
  for (let at = log.length - EVENT_TRIPLE; at >= 0; at -= EVENT_TRIPLE) if (log[at] === EVENT_KIND.ambulance) return log[at + 1]!;
  return -1;
}
