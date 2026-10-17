/**
 * Tilt steering: the phone's attitude (`DeviceOrientationEvent` beta / gamma / the screen's rotation) as a wheel angle and then
 * as the pad's steering value. Pure, so the sign conventions are tested; `use-tilt.ts` only listens and calls these.
 *
 * Calibration knobs (the owner tunes them on his phone; every one has its reason here and a bound):
 */
export const TILT = {
  /** Wheel angle that is full lock by default. A phone held in two hands turns about 25 degrees comfortably without moving the thumbs. */
  fullLockDegrees: { default: 25, min: 12, max: 45 },
  /** Hand tremor and the resting angle's drift: the first degrees are ignored. Wreckfest players report their dead zone as the first thing to cut, so the default is small; the pad's own `stickScale` adds its radial dead zone on top. */
  deadZoneDegrees: { default: 2, min: 0, max: 8 },
} as const;

export type TiltSettings = { fullLockDegrees: number; deadZoneDegrees: number };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** The stored strings as settings: a missing or unreadable value is the default, an out-of-range one the nearest bound. */
export function parseTiltSettings(fullLock: string, deadZone: string): TiltSettings {
  const read = (text: string, knob: { default: number; min: number; max: number }): number => {
    const value = Number.parseFloat(text);
    return Number.isFinite(value) ? clamp(value, knob.min, knob.max) : knob.default;
  };
  return { fullLockDegrees: read(fullLock, TILT.fullLockDegrees), deadZoneDegrees: read(deadZone, TILT.deadZoneDegrees) };
}

const DEGREES = 180 / Math.PI;

/** The screen's right and up directions in device coordinates for each `screen.orientation.angle` (the phone turned counter-clockwise by it). */
const SCREEN_AXES: Readonly<Record<number, { right: readonly [number, number]; up: readonly [number, number] }>> = {
  0: { right: [1, 0], up: [0, 1] },
  90: { right: [0, -1], up: [1, 0] },
  180: { right: [-1, 0], up: [0, -1] },
  270: { right: [0, 1], up: [-1, 0] },
};

/**
 * The wheel angle in degrees (positive: the screen's right side down, a clockwise turn, steer right; -180..180) from the
 * orientation event's `beta` and `gamma` and the screen's rotation. World down in the device's frame is
 * (cos b sin g, -sin b, -cos b cos g) for the spec's Z-X'-Y'' angles; the angle is how far it leans from the screen's down toward its
 * right, so it needs neither `alpha` (a compass, unreliable) nor a portrait / landscape special case.
 */
export function wheelAngle(betaDegrees: number, gammaDegrees: number, screenAngle: number): number {
  const beta = betaDegrees / DEGREES;
  const gamma = gammaDegrees / DEGREES;
  const downX = Math.cos(beta) * Math.sin(gamma);
  const downY = -Math.sin(beta);
  const axes = SCREEN_AXES[((Math.round(screenAngle / 90) % 4) + 4) % 4 * 90]!;
  const alongRight = downX * axes.right[0] + downY * axes.right[1];
  const alongUp = downX * axes.up[0] + downY * axes.up[1];
  return Math.atan2(alongRight, -alongUp) * DEGREES;
}

/** `angle` less the centre it was calibrated at, wrapped to -180..180. */
export function aroundCentre(angleDegrees: number, centreDegrees: number): number {
  const turned = (angleDegrees - centreDegrees) % 360;
  if (turned > 180) return turned - 360;
  if (turned < -180) return turned + 360;
  return turned;
}

/** The pad's steering value (-1 left .. 1 right, as the stick) for a wheel angle relative to the centre: dead zone, then linear to full lock. */
export function tiltSteer(angleDegrees: number, settings: TiltSettings): number {
  const past = Math.abs(angleDegrees) - settings.deadZoneDegrees;
  if (past <= 0) return 0;
  const share = Math.min(1, past / (settings.fullLockDegrees - settings.deadZoneDegrees));
  return Math.sign(angleDegrees) * share;
}
