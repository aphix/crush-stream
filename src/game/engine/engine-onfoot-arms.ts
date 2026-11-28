import { PLAYER_PUNCH_COOLDOWN, PLAYER_PUNCH_LAND } from "../ai/civilians/civilian-constants.ts";
import { detAtan2, hypot2 } from "../kernel/physics-core.js";
import { PAD_BUTTON, type PadState, type TouchPad } from "../vehicle/gamepad.ts";

export type WeaponId = "fists" | "pistol" | "shotgun" | "rifle" | "hook";
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
/** The weapon wheel's spokes, in `WEAPON_ORDER`: what the HUD draws. */
const WEAPON_LABELS: readonly string[] = WEAPON_ORDER.map((weapon) => WEAPON_NAMES[weapon]);

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
  /** The weapon in hand or the wheel changed: the HUD is told at once. */
  changed(): void;
};

/** A trigger past this is pulled. */
const TRIGGER_PULLED = 0.5;
/** The wheel control (LB, Tab) held this long (s) opens the weapon wheel; a shorter press is a tap. */
const WHEEL_HOLD_S = 0.2;
/** The stick, or the mouse travel, must reach this far (0 to 1) from the wheel's middle to pick a spoke. */
const WHEEL_PICK_PUSH = 0.5;
/** Mouse travel (px) that is a full push of the wheel. */
const WHEEL_MOUSE_PX = 100;
/** Scroll pixels that step one weapon: a notch of a mouse wheel. */
const SCROLL_STEP_PX = 100;

/** Fire and aim on foot: the mouse buttons, the pad's triggers, and what fire does with the weapon in hand (fists: a punch). */
export class OnFootArms {
  /** Aim is held. */
  aiming = false;
  weapon: WeaponId = "fists";
  /** The wheel is open; the spoke picked (-1: none yet), as a `WEAPON_ORDER` slot. */
  wheelOpen = false;
  wheelPick = -1;
  /** The last weapon taken out: the one a tap of the wheel control draws again after putting it away. */
  private lastOut: WeaponId = "pistol";
  private wheelDown = false;
  private wheelFor = 0;
  private wheelX = 0;
  private wheelY = 0;
  private scrollPx = 0;
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
    if (!this.host.armed() || this.wheelOpen) return;
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

  /** The pad's triggers this frame (`offered`: the game offers the walk; false while paused). The poll merges the touch stick (up: RT, down: LT) and the pedals (gas: RT, brake: LT) into `pad.rt` and `pad.lt`, so a trigger counts only when it is above what the touch layout alone puts there. */
  pad(pad: PadState | null, touch: TouchPad, wheelKey = false, offered = true): void {
    const live = pad !== null && pad.connected;
    const fire = live && (pad.rt > Math.max(TRIGGER_PULLED, touch.gas, -touch.y) || (touch.held & (1 << PAD_BUTTON.rt)) !== 0);
    if (fire && !this.padFire) this.press();
    if (!fire && this.padFire) this.release();
    this.padFire = fire;
    const aim = live && pad.lt > Math.max(TRIGGER_PULLED, touch.brake, touch.y);
    if (aim !== this.padAim) {
      this.padAim = aim;
      this.aim(aim);
    }
    if (!offered) this.shutWheel();
    else this.wheelHeld(this.host.armed() && (wheelKey || (live && (pad.held & (1 << PAD_BUTTON.lb)) !== 0)));
    if (this.wheelOpen && live) {
      this.wheelAim(pad.rx, pad.ry);
      // The stick picks; the camera must not turn with it.
      pad.rx = 0;
      pad.ry = 0;
    }
  }

  /** Once a frame: cooldowns run, a punch in flight lands, and everything is let go when the arms are no longer his. */
  frame(dt: number): void {
    if (!this.host.armed()) {
      this.weapon = "fists";
      this.wheelOpen = false;
      this.wheelDown = false;
      this.firing = false;
      this.landIn = -1;
      if (this.aiming) this.aim(false);
      return;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.wheelDown && !this.wheelOpen) {
      this.wheelFor += dt;
      if (this.wheelFor >= WHEEL_HOLD_S) this.openWheel();
    }
    if (this.firing && this.weapon !== "fists" && this.weapon !== "hook" && WEAPONS[this.weapon].auto && !this.wheelOpen && (this.aiming || this.host.captured())) this.fire();
    if (this.landIn >= 0) {
      this.landIn -= dt;
      if (this.landIn < 0) this.host.land();
    }
  }

  /** A weapon key: true when it was one of ours. */
  key(code: string): boolean {
    const weapon = WEAPON_KEYS[code];
    if (weapon === undefined) return false;
    this.take(weapon);
    return true;
  }

  /** The weapon before or after the one in hand, wrapping. */
  cycle(by: number): void {
    this.take(WEAPON_ORDER[(WEAPON_ORDER.indexOf(this.weapon) + by + WEAPON_ORDER.length) % WEAPON_ORDER.length]!);
  }

  /** The mouse wheel, `px` scrolled: steps a weapon a notch at a time. False while aiming (the camera's zoom) or when the arms are not his. */
  scroll(px: number): boolean {
    if (!this.host.armed() || this.aiming) return false;
    if (this.wheelOpen) return true;
    if (px * this.scrollPx < 0) this.scrollPx = 0;
    this.scrollPx += px;
    while (Math.abs(this.scrollPx) >= SCROLL_STEP_PX) {
      this.cycle(this.scrollPx > 0 ? 1 : -1);
      this.scrollPx -= Math.sign(this.scrollPx) * SCROLL_STEP_PX;
    }
    return true;
  }

  /** The wheel control (LB, Tab) is down or up this frame. Held, the wheel opens; let go, it equips the spoke picked; a tap puts the weapon away or draws the last one again. */
  wheelHeld(down: boolean): void {
    if (down === this.wheelDown) return;
    this.wheelDown = down;
    if (down) {
      this.wheelFor = 0;
    } else if (this.wheelOpen) {
      this.wheelOpen = false;
      if (this.wheelPick >= 0) this.take(WEAPON_ORDER[this.wheelPick]!);
      this.host.changed();
    } else this.take(this.weapon === "fists" ? this.lastOut : "fists");
  }

  /** The wheel's pick from a push (x right, y down) of the stick or the mouse: the spoke it points at, once it is past `WHEEL_PICK_PUSH`. */
  wheelAim(x: number, y: number): void {
    if (!this.wheelOpen || hypot2(x, y) < WHEEL_PICK_PUSH) return;
    const spokes = WEAPON_ORDER.length;
    const pick = (Math.round((detAtan2(x, -y) / (2 * Math.PI)) * spokes) + spokes) % spokes;
    if (pick === this.wheelPick) return;
    this.wheelPick = pick;
    this.host.changed();
  }

  /** Mouse travel while the wheel is open picks like a stick does. True when the wheel took it (the camera must not). */
  wheelMove(dx: number, dy: number): boolean {
    if (!this.wheelOpen) return false;
    this.wheelX += dx / WHEEL_MOUSE_PX;
    this.wheelY += dy / WHEEL_MOUSE_PX;
    const reach = hypot2(this.wheelX, this.wheelY);
    if (reach > 1) {
      this.wheelX /= reach;
      this.wheelY /= reach;
    }
    this.wheelAim(this.wheelX, this.wheelY);
    return true;
  }

  /** The game stopped offering the walk (a pause): the wheel is dropped without equipping its pick. */
  private shutWheel(): void {
    if (!this.wheelOpen && !this.wheelDown) return;
    this.wheelOpen = false;
    this.wheelDown = false;
    this.host.changed();
  }

  private openWheel(): void {
    this.wheelOpen = true;
    this.wheelPick = WEAPON_ORDER.indexOf(this.weapon);
    this.wheelX = 0;
    this.wheelY = 0;
    this.host.changed();
  }

  private take(weapon: WeaponId): void {
    this.weapon = weapon;
    if (weapon !== "fists") this.lastOut = weapon;
    this.host.changed();
  }

  /** What the HUD shows of the arms. */
  hud(): { slot: number; name: string } | null {
    return this.host.armed() ? { slot: WEAPON_ORDER.indexOf(this.weapon), name: WEAPON_NAMES[this.weapon] } : null;
  }

  /** The open wheel's picked spoke, null while it is shut. */
  wheelHud(): { pick: number; spokes: readonly string[] } | null {
    return this.wheelOpen ? { pick: this.wheelPick, spokes: WEAPON_LABELS } : null;
  }

  /** Something is held out in his hand: a gun or the hook's launcher (not fists). */
  heldOut(): boolean {
    return this.weapon !== "fists";
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

/** The gun in weapon slot `slot` of `WEAPON_ORDER` (what `MSG.act`'s shot carries as its argument); null for fists, the hook or a slot past the list. */
export function gunAt(slot: number): Gun | null {
  const weapon = WEAPON_ORDER[slot];
  return weapon === undefined || weapon === "fists" || weapon === "hook" ? null : WEAPONS[weapon];
}

/** The weapon slot of `gun` in `WEAPON_ORDER`, -1 for a gun this build does not list. */
export function slotOfGun(gun: Gun): number {
  for (let slot = 0; slot < WEAPON_ORDER.length; slot++) {
    const weapon = WEAPON_ORDER[slot]!;
    if (weapon !== "fists" && weapon !== "hook" && WEAPONS[weapon] === gun) return slot;
  }
  return -1;
}

/** The weapon slot of `weapon` in `WEAPON_ORDER`: what a player's record carries. */
export function slotOfWeapon(weapon: WeaponId): number {
  return WEAPON_ORDER.indexOf(weapon);
}

/** The weapon in weapon slot `slot`; fists for a slot past the list. */
export function weaponAt(slot: number): WeaponId {
  return WEAPON_ORDER[slot] ?? "fists";
}
