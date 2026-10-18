/**
 * How a phone drives: the control schemes of the on-screen pad, and the one place their numbers live (docs/CONTROLS.md,
 * "Touch screens"). The HUD (`touch-controls.tsx`) renders what `schemeLayout` says and writes the pad's `TouchPad` from it;
 * nothing here knows about the DOM.
 */

import { PAD_DEAD } from "../vehicle/gamepad.ts";

export const TOUCH_SCHEMES = ["stick", "pedals", "autogas", "tilt"] as const;
export type TouchScheme = (typeof TOUCH_SCHEMES)[number];

/**
 * The driving disc is what a phone opens with (the owner's pick, after trying a slider with pedals and one with auto-gas: with a disc, forward, back
 * and a little of either are all one thumb on one thing). Pedals (a slider, a Gas and a Brake), Easy (id `autogas`: one thumb steers and the car pulls
 * by itself, an "Auto gas" light says so; Real Racing 3 Tilt A, Asphalt TouchDrive, GRID Arrow Touch) and Tilt are options in Controls.
 */
export const DEFAULT_TOUCH_SCHEME: TouchScheme = TOUCH_SCHEMES[0];

/** localStorage keys (through `useStoredString`). */
export const TOUCH_SCHEME_KEY = "crush.touch.scheme";
export const TOUCH_MIRROR_KEY = "crush.touch.mirror";
export const TILT_FULL_LOCK_KEY = "crush.touch.tilt.fullLock";
export const TILT_DEAD_ZONE_KEY = "crush.touch.tilt.deadZone";

export const TOUCH_SCHEME_LABEL: Readonly<Record<TouchScheme, string>> = { autogas: "Easy", pedals: "Pedals", stick: "Stick", tilt: "Tilt" };

/** One line under each scheme in the Controls section. */
export const TOUCH_SCHEME_HINT: Readonly<Record<TouchScheme, string>> = {
  autogas: "Slide to steer. Gas is automatic (the green Auto gas light); hold Brake to slow and reverse.",
  pedals: "Slide to steer, with a Gas and a Brake pedal of your own.",
  stick: "One disc under the thumb: push up to go (a little or a lot), down to brake and then reverse, sideways to steer.",
  tilt: "Tilt the phone like a wheel. Gas is automatic (the green Auto gas light); hold Brake to slow and reverse.",
};

/** What a scheme draws and what it drives for itself. */
export type SchemeLayout = {
  /** What steers: the sliding bar, the 2-axis stick, or the phone's tilt (nothing is drawn for tilt but a small level marker). */
  steer: "slider" | "stick" | "tilt";
  /** The Gas pedal is drawn and held by a finger. */
  gasPedal: boolean;
  /** The Brake pedal is drawn and held by a finger (the stick brakes by itself). */
  brakePedal: boolean;
  /** Gas is on whenever the Brake pedal is not. */
  autoGas: boolean;
};

const LAYOUT: Readonly<Record<TouchScheme, SchemeLayout>> = {
  autogas: { steer: "slider", gasPedal: false, brakePedal: true, autoGas: true },
  pedals: { steer: "slider", gasPedal: true, brakePedal: true, autoGas: false },
  stick: { steer: "stick", gasPedal: false, brakePedal: false, autoGas: false },
  tilt: { steer: "tilt", gasPedal: false, brakePedal: true, autoGas: true },
};

export function schemeLayout(scheme: TouchScheme): SchemeLayout {
  return LAYOUT[scheme];
}

/** The stored value as a scheme: anything unknown (and the server render's empty string) is the default. */
export function parseTouchScheme(stored: string): TouchScheme {
  return TOUCH_SCHEMES.find((scheme) => scheme === stored) ?? DEFAULT_TOUCH_SCHEME;
}

/** Left-handed: the steering side and the pedal side swap. Stored as "1". */
export function parseMirror(stored: string): boolean {
  return stored === "1";
}

/** The pedals a scheme writes to `TouchPad` (`gas`, `brake`: 0 or 1), from the fingers on the two pedals; `drivable` is false while the car is not the player's to drive (watching), when nothing is pressed. */
export function pedalsFor(scheme: TouchScheme, fingers: { gas: boolean; brake: boolean }, drivable: boolean): { gas: number; brake: number } {
  const layout = schemeLayout(scheme);
  if (!drivable || layout.steer === "stick") return { gas: 0, brake: 0 };
  const brake = layout.brakePedal && fingers.brake ? 1 : 0;
  if (layout.autoGas) return { gas: brake === 1 ? 0 : 1, brake };
  return { gas: layout.gasPedal && fingers.gas && brake === 0 ? 1 : 0, brake };
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
  const offset = Math.hypot(x, y);
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

/** The steering slider's drawn size, in CSS px: long enough for a thumb sweep, deep enough to hold with a loosely placed thumb. */
export const STEER_SLIDER = { length: 176, height: 72 } as const;
