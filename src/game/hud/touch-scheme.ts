/**
 * How a phone drives: the control schemes of the on-screen pad, and the one place their numbers live (docs/CONTROLS.md,
 * "Touch screens"). The HUD (`touch-controls.tsx`) renders what `schemeLayout` says and writes the pad's `TouchPad` from it;
 * nothing here knows about the DOM.
 */

export const TOUCH_SCHEMES = ["easy", "pedals", "stick", "tilt"] as const;
export type TouchScheme = (typeof TOUCH_SCHEMES)[number];

/** Easy: one thumb steers and the car pulls by itself; the other brakes, boosts and handbrakes. The research's common first scheme (Real Racing 3 Tilt A, Asphalt TouchDrive, GRID Arrow Touch). */
export const DEFAULT_TOUCH_SCHEME: TouchScheme = "easy";

/** localStorage keys (through `useStoredString`). */
export const TOUCH_SCHEME_KEY = "crush.touch.scheme";
export const TOUCH_MIRROR_KEY = "crush.touch.mirror";
export const TILT_FULL_LOCK_KEY = "crush.touch.tilt.fullLock";
export const TILT_DEAD_ZONE_KEY = "crush.touch.tilt.deadZone";

export const TOUCH_SCHEME_LABEL: Readonly<Record<TouchScheme, string>> = { easy: "Easy", pedals: "Pedals", stick: "Stick", tilt: "Tilt" };

/** One line under each scheme in the Controls section. */
export const TOUCH_SCHEME_HINT: Readonly<Record<TouchScheme, string>> = {
  easy: "Slide to steer. The car drives itself; hold Brake to slow and reverse.",
  pedals: "Slide to steer, with a Gas and a Brake pedal of your own.",
  stick: "One stick: up is gas, down brakes, left and right steer.",
  tilt: "Tilt the phone like a wheel. The car drives itself; hold Brake to slow and reverse.",
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
  easy: { steer: "slider", gasPedal: false, brakePedal: true, autoGas: true },
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
