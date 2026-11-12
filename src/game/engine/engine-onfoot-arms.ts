import { PLAYER_PUNCH_COOLDOWN, PLAYER_PUNCH_LAND } from "../ai/civilians/civilian-constants.ts";
import { PAD_BUTTON, type PadState, type TouchPad } from "../vehicle/gamepad.ts";

type WeaponId = "fists" | "pistol" | "shotgun" | "rifle" | "hook";
/** A gun: its name, the speed (m/s) a hit adds to the part it lands on (a showcase click is 6), its range (m), rays a shot, the half-angle (rad) they scatter in, seconds between shots, whether a held fire repeats, the push (N·s) a ray gives a car and the speed (m/s) it knocks a prop at. */
export type Gun = { name: string; speed: number; range: number; rays: number; cone: number; every: number; auto: boolean; kick: number; prop: number };
export const WEAPONS: Record<Exclude<WeaponId, "fists" | "hook">, Gun> = {
  pistol: { name: "Pistol", speed: 6, range: 120, rays: 1, cone: 0.005, every: 0.25, auto: false, kick: 150, prop: 5 },
  shotgun: { name: "Shotgun", speed: 3.5, range: 40, rays: 8, cone: 0.04, every: 0.9, auto: false, kick: 37.5, prop: 8 },
  rifle: { name: "Rifle", speed: 9, range: 250, rays: 1, cone: 0.0013, every: 0.12, auto: true, kick: 250, prop: 7 },
};
/** The weapons in the order LB / RB step through them, the key that takes each, and the name the HUD shows. */
const WEAPON_ORDER: readonly WeaponId[] = ["fists", "pistol", "shotgun", "rifle", "hook"];
const WEAPON_KEYS: Record<string, WeaponId> = { Digit1: "fists", Digit2: "pistol", Digit3: "shotgun", Digit4: "rifle", Digit0: "hook" };
const WEAPON_NAMES: Record<WeaponId, string> = { fists: "Fists", pistol: "Pistol", shotgun: "Shotgun", rifle: "Rifle", hook: "Hook" };

/** A ray whose level part is under this is straight up or down: it has no heading. */
export const STRAIGHT_UP = 1e-6;

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
  /** One shot of `gun`, all its rays. */
  shoot(gun: Gun): void;
  /** Fire with the hook in hand: one end is placed. */
  hook(): void;
};

/** A trigger past this is pulled. */
const TRIGGER_PULLED = 0.5;

/** Fire and aim on foot: the mouse buttons, the pad's triggers, and what fire does with the weapon in hand (fists: a punch). */
export class OnFootArms {
  /** Aim is held. */
  aiming = false;
  weapon: WeaponId = "fists";
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
    const fire = live && (pad.rt > Math.max(TRIGGER_PULLED, touch.gas, -touch.y) || (pad.held & (1 << PAD_BUTTON.l3)) !== 0);
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
      this.weapon = "fists";
      this.firing = false;
      this.landIn = -1;
      if (this.aiming) this.aim(false);
      return;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.firing && this.weapon !== "fists" && this.weapon !== "hook" && WEAPONS[this.weapon].auto && (this.aiming || this.host.captured())) this.fire();
    if (this.landIn >= 0) {
      this.landIn -= dt;
      if (this.landIn < 0) this.host.land();
    }
  }

  /** A weapon key: true when it was one of ours. */
  key(code: string): boolean {
    const weapon = WEAPON_KEYS[code];
    if (weapon === undefined) return false;
    this.weapon = weapon;
    return true;
  }

  /** LB / RB: the weapon before or after the one in hand, wrapping. */
  cycle(by: number): void {
    const at = WEAPON_ORDER.indexOf(this.weapon);
    this.weapon = WEAPON_ORDER[(at + by + WEAPON_ORDER.length) % WEAPON_ORDER.length]!;
  }

  /** What the HUD shows of the arms. */
  hud(): { slot: number; name: string } | null {
    return this.host.armed() ? { slot: WEAPON_ORDER.indexOf(this.weapon), name: WEAPON_NAMES[this.weapon] } : null;
  }

  /** One shot of the weapon in hand. Fists: a punch, when the last one is done. */
  private fire(): void {
    if (this.cooldown > 0) return;
    if (this.weapon === "fists") {
      if (!this.host.punch()) return;
      this.cooldown = PLAYER_PUNCH_COOLDOWN;
      this.landIn = PLAYER_PUNCH_LAND;
      return;
    }
    if (this.weapon === "hook") {
      this.host.hook();
      return;
    }
    const gun = WEAPONS[this.weapon];
    this.cooldown = gun.every;
    this.host.shoot(gun);
  }
}
