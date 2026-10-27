/**
 * How a phone drives: the control schemes of the on-screen pad, and the one place their numbers live (docs/CONTROLS.md,
 * "Touch screens"). The HUD (`touch-controls.tsx`) renders what `schemeLayout` says and writes the pad's `TouchPad` from it;
 * nothing here knows about the DOM.
 */

import { hypot2 } from "../kernel/physics-core.js";
import { BOOST } from "../vehicle/car-drive.ts";
import { PAD_BUTTON, PAD_DEAD, type TouchPad } from "../vehicle/gamepad.ts";

export const TOUCH_SCHEMES = ["stick", "pedals", "autogas", "tilt"] as const;
export type TouchScheme = (typeof TOUCH_SCHEMES)[number];

/**
 * The driving disc is what a phone opens with (the owner's pick: forward, back and a little of either are all one thumb on one thing).
 * Every other scheme gives each thumb one region: the left steers, the right holds the pedals (Pedals: a strip from brake through coast to gas
 * and a Boost cap; Easy: automatic gas, a Brake pad and a Boost tap; Tilt: the phone steers, the left thumb holds the e-brake, the right the strip).
 */
export const DEFAULT_TOUCH_SCHEME: TouchScheme = TOUCH_SCHEMES[0];

/** localStorage keys (through `useStoredString`). */
export const TOUCH_SCHEME_KEY = "crush.touch.scheme";
export const TOUCH_MIRROR_KEY = "crush.touch.mirror";
export const TILT_FULL_LOCK_KEY = "crush.touch.tilt.fullLock";
export const TILT_DEAD_ZONE_KEY = "crush.touch.tilt.deadZone";

export const TOUCH_SCHEME_LABEL: Readonly<Record<TouchScheme, string>> = { autogas: "Easy", pedals: "Pedals", stick: "Disc", tilt: "Tilt" };

/** One line under each scheme in the Controls section. */
export const TOUCH_SCHEME_HINT: Readonly<Record<TouchScheme, string>> = {
  autogas: "Left thumb: slide to steer, pull down for the e-brake. Right thumb: gas is automatic; hold Brake to slow and reverse, tap Boost.",
  pedals: "Left thumb: slide to steer, pull down for the e-brake. Right thumb: one strip, slide down to brake, up to coast, gas, then Boost.",
  stick: "One disc under the thumb: push up to go (a little or a lot), down to brake and then reverse, sideways to steer.",
  tilt: "Tilt the phone like a wheel. Left thumb: E-brake pad. Right thumb: one strip, slide down to brake, up to coast, gas, then Boost.",
};

/** What a scheme draws: what steers, what the right thumb holds, where the e-brake is, and whether the gas is automatic. */
export type SchemeLayout = {
  /** What steers: the sliding bar, the 2-axis stick, or the phone's tilt (a level bar shows it). */
  steer: "slider" | "stick" | "tilt";
  /** The right thumb's control: the pedal strip, a Brake pad over automatic gas, or the Boost and Handbrake buttons (the disc's). */
  right: "strip" | "brake" | "buttons";
  /** The e-brake: pulled down on the steering bar, a pad under the left thumb, or the right thumb's Handbrake button (the disc's). */
  ebrake: "pull" | "pad" | "button";
  /** Gas is on whenever Brake is not held. */
  autoGas: boolean;
};

const LAYOUT: Readonly<Record<TouchScheme, SchemeLayout>> = {
  autogas: { steer: "slider", right: "brake", ebrake: "pull", autoGas: true },
  pedals: { steer: "slider", right: "strip", ebrake: "pull", autoGas: false },
  stick: { steer: "stick", right: "buttons", ebrake: "button", autoGas: false },
  tilt: { steer: "tilt", right: "strip", ebrake: "pad", autoGas: false },
};

export function schemeLayout(scheme: TouchScheme): SchemeLayout {
  return LAYOUT[scheme];
}

const PEDALS: TouchScheme = TOUCH_SCHEMES[1];

/** The scheme the controls draw: on foot the strip is the walk's forward axis, so Easy (automatic gas, no strip) draws Pedals', which steers alike. */
export function drawnScheme(scheme: TouchScheme, onFoot: boolean): TouchScheme {
  return onFoot && LAYOUT[scheme].autoGas ? PEDALS : scheme;
}

/** The stored value as a scheme: anything unknown (and the server render's empty string) is the default. */
export function parseTouchScheme(stored: string): TouchScheme {
  return TOUCH_SCHEMES.find((scheme) => scheme === stored) ?? DEFAULT_TOUCH_SCHEME;
}

/** Left-handed: the steering side and the pedal side swap. Stored as "1". */
export function parseMirror(stored: string): boolean {
  return stored === "1";
}

/** The pedals a scheme writes to `TouchPad` (`gas`, `brake`: 0..1), from what the right thumb reads; `drivable` is false while the car is not the player's to drive (watching), when nothing is pressed. */
export function pedalsFor(scheme: TouchScheme, thumb: { gas: number; brake: number }, drivable: boolean): { gas: number; brake: number } {
  const layout = schemeLayout(scheme);
  if (!drivable || layout.right === "buttons") return { gas: 0, brake: 0 };
  if (layout.autoGas) return thumb.brake > 0 ? { gas: 0, brake: thumb.brake } : { gas: 1, brake: 0 };
  return thumb.brake > 0 ? { gas: 0, brake: thumb.brake } : { gas: thumb.gas, brake: 0 };
}

/** The pedal strip's zones as shares of its height from the bottom: full brake at the foot easing to none at `brakeTop`, coast to `coastTop`, gas ramping to full at `gasTop`, the Boost cap above. */
export const STRIP = { brakeTop: 0.28, coastTop: 0.4, gasTop: 0.8 } as const;

/** The strip's reading for the thumb's height `position` (0 at the foot, 1 at the top): one thumb covers brake, coast, gas and Boost. */
export function stripReading(position: number): { gas: number; brake: number; boost: boolean } {
  const at = Math.max(0, Math.min(1, position));
  if (at < STRIP.brakeTop) return { gas: 0, brake: 1 - at / STRIP.brakeTop, boost: false };
  if (at < STRIP.coastTop) return { gas: 0, brake: 0, boost: false };
  return { gas: Math.min(1, (at - STRIP.coastTop) / (STRIP.gasTop - STRIP.coastTop)), brake: 0, boost: at >= STRIP.gasTop };
}

/** How far (px) the steering thumb pulls down past the bar's middle to take the e-brake, and how far it must come back up to let go (the gap keeps a shaky thumb from flickering it). */
export const EBRAKE_PULL = { on: 40, off: 24 } as const;

/**
 * Whether the steering thumb is holding the e-brake: it is pulled `EBRAKE_PULL` below `referenceY`, the bar's middle (or the landing if the thumb landed higher),
 * so a thumb resting low in the bar never takes it by accident, and `held` gives the pull its hysteresis.
 */
export function pulledDown(held: boolean, fingerY: number, referenceY: number): boolean {
  return fingerY - referenceY > (held ? EBRAKE_PULL.off : EBRAKE_PULL.on);
}

/** A Boost tap holds the Boost button for one full meter's burn (seconds): a tap is a burst, the meter says when it is over. */
export const BOOST_TAP_SECONDS = BOOST.full;

/** The Out / In tap: the pad's B for one poll, never held, so one tap is one get out or get in. */
export function tapOnFoot(touch: TouchPad): void {
  touch.tapped |= 1 << PAD_BUTTON.east;
}

/** How far (a fraction of the disc's radius) the knob must move before the disc reads anything: a resting thumb is not a nudge. */
const DISC_DEAD = 0.04;

/**
 * The driving disc's reading for a knob offset (`x`, `y`: fractions of its radius), as the pad's stick value. The pad's own stick curve
 * (a deadzone and a power curve, `stickScale`) is made for a controller's sprung stick and swallows a small push of a thumb, so the offset is
 * warped to the stick value that curve turns back into the offset itself: a quarter of the way is a quarter of the gas, the brake, the wheel.
 * Only a resting thumb (`DISC_DEAD`) reads zero.
 */
export function discReading(x: number, y: number): { x: number; y: number } {
  const offset = hypot2(x, y);
  if (offset < DISC_DEAD) return { x: 0, y: 0 };
  const warped = PAD_DEAD.stick + (1 - PAD_DEAD.stick) * Math.pow(Math.min(1, offset), 1 / PAD_DEAD.curve);
  return { x: (x / offset) * warped, y: (y / offset) * warped };
}

/**
 * The steering slider's reading: the finger's offset from the bar's centre as a share of half its length, clamped to -1..1
 * (negative is left, as the pad's stick). Linear on purpose: the pad's own `stickScale` adds the dead zone and the fine-steering
 * curve, so a second set here would double them.
 */
export function sliderSteer(offset: number, halfLength: number): number {
  if (halfLength <= 0) return 0;
  return Math.max(-1, Math.min(1, offset / halfLength));
}

/** The steering slider's drawn size, in CSS px: long enough for a thumb sweep, deep enough to hold with a loosely placed thumb; `ebrakeTab` is the room under it for the e-brake pull, `tiltLevel` the Tilt scheme's level bar. */
export const STEER_SLIDER = { length: 176, height: 72, ebrakeTab: 40, tiltLevel: 48 } as const;
