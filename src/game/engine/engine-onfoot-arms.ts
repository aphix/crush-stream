import { PLAYER_PUNCH_COOLDOWN, PLAYER_PUNCH_LAND } from "../ai/civilians/civilian-constants.ts";
import type { PadState, TouchPad } from "../vehicle/gamepad.ts";

/** What the arms need of the on-foot director and the engine. */
type ArmsHost = {
  armed(): boolean;
  /** Starts the walker's punch; false when he cannot (not standing, or one is under way). */
  punch(): boolean;
  /** The punch in flight lands now. */
  land(): void;
  /** Mouse capture as the `;` key drives it: whether it is on, and turning it on or off. */
  captured(): boolean;
  capture(on: boolean): void;
};

/** A trigger past this is pulled. */
const TRIGGER_PULLED = 0.5;

/** Fire and aim on foot: the mouse buttons, the pad's triggers, and what fire does with the weapon in hand (fists: a punch). */
export class OnFootArms {
  /** Aim is held. */
  aiming = false;
  private readonly host: ArmsHost;
  private firing = false;
  private tookCapture = false;
  private cooldown = 0;
  private landIn = -1;
  private padFire = false;
  private padAim = false;

  constructor(host: ArmsHost) {
    this.host = host;
  }

  /** Fire goes down: a left press with the mouse captured, a click with it free, the right trigger, the touch button. */
  press(): void {
    if (!this.host.armed()) return;
    this.firing = true;
    this.fire();
  }

  /** Fire comes up. */
  release(): void {
    this.firing = false;
  }

  /** Aim goes down or up (right mouse button, left trigger). Aiming with a free mouse captures it until aim is let go. */
  aim(on: boolean): void {
    const aiming = on && this.host.armed();
    if (aiming === this.aiming) return;
    this.aiming = aiming;
    if (aiming && !this.host.captured()) {
      this.host.capture(true);
      this.tookCapture = true;
    } else if (!aiming && this.tookCapture) {
      this.host.capture(false);
      this.tookCapture = false;
    }
  }

  /** The pad's triggers this frame. The poll merges the touch stick (up: RT, down: LT) and the pedals (gas: RT, brake: LT) into `pad.rt` and `pad.lt`, so a trigger counts only when it is above what the touch layout alone puts there. */
  pad(pad: PadState | null, touch: TouchPad): void {
    const live = pad !== null && pad.connected;
    const fire = live && pad.rt > Math.max(TRIGGER_PULLED, touch.gas, -touch.y);
    if (fire && !this.padFire) this.press();
    if (!fire && this.padFire) this.release();
    this.padFire = fire;
    const aim = live && pad.lt > Math.max(TRIGGER_PULLED, touch.brake, touch.y);
    if (aim !== this.padAim) {
      this.padAim = aim;
      this.aim(aim);
    }
  }

  /** Once a frame: cooldowns run, a punch in flight lands, and everything is let go when the arms are no longer his. */
  frame(dt: number): void {
    if (!this.host.armed()) {
      this.firing = false;
      this.landIn = -1;
      if (this.aiming) this.aim(false);
      return;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.landIn >= 0) {
      this.landIn -= dt;
      if (this.landIn < 0) this.host.land();
    }
  }

  /** One shot of the weapon in hand. Fists: a punch, when the last one is done. */
  private fire(): void {
    if (this.cooldown > 0 || !this.host.punch()) return;
    this.cooldown = PLAYER_PUNCH_COOLDOWN;
    this.landIn = PLAYER_PUNCH_LAND;
  }
}
