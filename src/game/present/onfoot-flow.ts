/** Where the player is in the get out, walk, get in cycle. */
export type OnFootPhase = "inCar" | "exiting" | "onFoot" | "entering";
export type OnFootRefusal = "tooFast" | "doorBlocked" | "noCarInReach" | "busy";
/** What one press or tick changed, for the engine to act on. */
export type OnFootStep = "none" | "exitStarted" | "standing" | "enterStarted" | "seated" | "refused";

/** What the world says when the control is pressed: the car in question (the one driven, or the one in reach on foot; -1 none), its speed, and whether its driver door has room to open. */
export interface OnFootSense {
  car: number;
  speed: number;
  doorBlocked: boolean;
}

/** A car rolling faster than this (m/s) is not stepped out of or into. */
const EXIT_MAX_SPEED = 3;
const ENTER_MAX_SPEED = 3;
/** How long the climb out and the climb in take (s). */
const EXIT_SECONDS = 0.8;
const ENTER_SECONDS = 0.6;

/** The get out, walk, get in cycle: one control, four phases, and the refusals that keep it from being pressed at the wrong time. */
export class OnFootFlow {
  phase: OnFootPhase = "inCar";
  /** The car being left, entered or just refused in; -1 once he sits in it, and after a refusal on foot. */
  car = -1;
  /** Why the last press was refused; null after one that was taken. */
  refusal: OnFootRefusal | null = null;
  private seconds = 0;

  get active(): boolean {
    return this.phase !== "inCar";
  }

  press(sense: OnFootSense): OnFootStep {
    this.refusal = null;
    if (this.phase === "exiting" || this.phase === "entering") return this.refuse("busy");
    if (this.phase === "inCar") return this.pressInCar(sense);
    return this.pressOnFoot(sense);
  }

  /** `dt` s pass: a climb out or in that has run its course ends. */
  tick(dt: number): OnFootStep {
    if (this.phase !== "exiting" && this.phase !== "entering") return "none";
    this.seconds += dt;
    if (this.phase === "exiting" && this.seconds >= EXIT_SECONDS) {
      this.phase = "onFoot";
      return "standing";
    }
    if (this.phase === "entering" && this.seconds >= ENTER_SECONDS) {
      this.phase = "inCar";
      this.car = -1;
      return "seated";
    }
    return "none";
  }

  /** Back in the seat, as after a scene reset. */
  reset(): void {
    this.phase = "inCar";
    this.car = -1;
    this.refusal = null;
    this.seconds = 0;
  }

  private pressInCar(sense: OnFootSense): OnFootStep {
    if (sense.speed > EXIT_MAX_SPEED) return this.refuse("tooFast");
    if (sense.doorBlocked) return this.refuse("doorBlocked");
    return this.begin("exiting", sense.car, "exitStarted");
  }

  private pressOnFoot(sense: OnFootSense): OnFootStep {
    if (sense.car < 0) return this.refuse("noCarInReach");
    if (sense.speed > ENTER_MAX_SPEED) return this.refuse("tooFast");
    return this.begin("entering", sense.car, "enterStarted");
  }

  private begin(phase: OnFootPhase, car: number, step: OnFootStep): OnFootStep {
    this.phase = phase;
    this.car = car;
    this.seconds = 0;
    return step;
  }

  private refuse(why: OnFootRefusal): OnFootStep {
    this.refusal = why;
    return "refused";
  }
}
