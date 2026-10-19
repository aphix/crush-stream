import { applyDrive, idleDrive, type DriveInput } from "../vehicle/car-drive.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { FEEL } from "../vehicle/drive-input.ts";
import { MAX_CARS } from "../scenes/fleet.ts";
import { clamp } from "../kernel/scalar.ts";
import { copyDrive } from "./race-ai.ts";

/**
 * Seconds each pedal of an AI driver takes to fade (first-order lag) toward what the driver asks. A driver that thinks every step and corrects what it just did
 * swings wheel and pedals at the step rate, a limit cycle of the loop, not a decision; hands move over tenths of a second. Tuned on the bench strip's racer (`ai-hands.test.ts`):
 * the wheel quiet at 0.05 s, the pedals quick so a stop is not late and the pace holds.
 */
export const FADE_S = { steer: 0.05, throttle: 0.06, brake: 0.03 };
/** Every fade is at full time constant from this speed (m/s) up and a share of it below, none at a standstill: a car crawling, turning round or backing out needs its hands now. */
const FADE_SPEED = 15;
/** Seconds the handbrake or boost button must be asked for (or let go) before it changes: a button held a step or two is a flicker of the loop, not a press. */
const BUTTON_HOLD_S = 0.1;

/** The racing AI's hands: every input a race brain hands the drive passes through here, per car slot, before `applyAiDrive`. The player's and a peer's inputs do not. */
export class InputFade {
  private readonly steer = new Float64Array(MAX_CARS);
  private readonly throttle = new Float64Array(MAX_CARS);
  private readonly brake = new Float64Array(MAX_CARS);
  private readonly ebrake = new Uint8Array(MAX_CARS);
  private readonly boost = new Uint8Array(MAX_CARS);
  private readonly ebrakeAsked = new Float64Array(MAX_CARS);
  private readonly boostAsked = new Float64Array(MAX_CARS);
  /** Per slot: the car's `placements` count the hands last saw; a new count (`DeformableCar.placeAt`) restarts the hands at what the driver asks. */
  private readonly placed = new Int32Array(MAX_CARS);
  /** The faded input of the last `fade`: scratch, apply it before the next call. */
  private readonly out: DriveInput = idleDrive();

  /** `input` as car `slot`'s hands make of it over a step of `dt` s, the car doing `speed` m/s. */
  fade(slot: number, input: DriveInput, dt: number, speed: number, placements = 0): DriveInput {
    if (placements !== this.placed[slot]) {
      this.placed[slot] = placements;
      this.follow(slot, input);
    }
    const out = this.out;
    const share = Math.min(1, speed / FADE_SPEED);
    this.steer[slot] = lag(this.steer[slot]!, input.steer, dt, FADE_S.steer * share);
    this.throttle[slot] = lag(this.throttle[slot]!, input.throttle, dt, FADE_S.throttle * share);
    this.brake[slot] = lag(this.brake[slot]!, input.brake, dt, FADE_S.brake * share);
    out.steer = this.steer[slot]!;
    out.throttle = this.throttle[slot]!;
    out.brake = this.brake[slot]!;
    out.ebrake = press(this.ebrake, this.ebrakeAsked, slot, input.ebrake, dt, BUTTON_HOLD_S * share);
    out.boost = press(this.boost, this.boostAsked, slot, input.boost, dt, BUTTON_HOLD_S * share);
    out.neutral = input.neutral === true;
    return out;
  }

  /** Car `slot` is driven by something else this step (a hold, a coast, a person): its hands are where `input` has them. */
  follow(slot: number, input: DriveInput): void {
    this.steer[slot] = input.steer;
    this.throttle[slot] = input.throttle;
    this.brake[slot] = input.brake;
    this.ebrake[slot] = input.ebrake ? 1 : 0;
    this.boost[slot] = input.boost ? 1 : 0;
    this.ebrakeAsked[slot] = 0;
    this.boostAsked[slot] = 0;
  }
}

function lag(value: number, target: number, dt: number, tau: number): number {
  if (tau <= 0) return target;
  return value + (target - value) * (1 - Math.exp(-dt / tau));
}

/** A button's state after `dt` s of `asked`: it changes once the other state has been asked for `hold` s. */
function press(state: Uint8Array, asked: Float64Array, slot: number, ask: boolean, dt: number, hold: number): boolean {
  if ((state[slot] === 1) === ask) {
    asked[slot] = 0;
    return ask;
  }
  asked[slot]! += dt;
  if (asked[slot]! >= hold) {
    state[slot] = ask ? 1 : 0;
    asked[slot] = 0;
  }
  return state[slot] === 1;
}

const _limited: DriveInput = idleDrive();

/**
 * How every AI driver drives its car (racers, traffic, police, hunters, the derby, after their guards): `applyDrive` with the wheel turned toward the ask no faster than
 * a pad player's (`FEEL.steerPad` of lock a second), from the wheel the car ran last step (`drive.steer`; straight on a car put on a spot since, as at a race's start).
 * The player's and a peer's inputs do not pass here.
 */
export function applyAiDrive(car: DeformableCar, input: DriveInput, dt: number, topScale = 1): void {
  copyDrive(input, _limited);
  const reach = FEEL.steerPad * dt;
  const was = car.aiPlacements === car.placements ? car.drive.steer : 0;
  car.aiPlacements = car.placements;
  _limited.steer = clamp(input.steer, was - reach, was + reach);
  applyDrive(car, _limited, dt, topScale);
}
