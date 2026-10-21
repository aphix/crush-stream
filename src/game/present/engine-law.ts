import { REV_IDLE, type VehicleClassId } from "../vehicle/vehicle-classes.ts";
import { approach } from "./audio-mix.ts";

/**
 * How loud an engine is as the gauge's revs and the pedal's load change: BMW M5 Active Sound Design's shape (load is the dominant
 * control: quiet at idle and cruise, a steep rise past half load, a plateau at full), at spans compressed for play. The level is in dB
 * under a redline at full load, which is the voice's `MOTOR_OUTPUT_GAIN` peak (-12 dBFS).
 */

/** Full load over coast at the same rpm. Real cars run 10-16 dB; games compress it (8 dB keeps a lifted engine audible beside the music). */
const LOAD_SPAN_DB = 8;
/** The M5 load curve, as shares of the span: nothing under `LOAD_KNEE`, `LOAD_MID_SHARE` (8 of the M5's 22 dB) at half load, all of it at 1. */
const LOAD_KNEE = 0.15;
const LOAD_MID = 0.5;
const LOAD_MID_SHARE = 8 / 22;
/**
 * dB per doubling of rpm. Real cars gain about 6 (a 30 dB idle-to-redline span), which left idle inaudible at the default slider; 3.3 over
 * the 3 doublings from idle (about 12% of the redline's rpm) plus the load span puts idle coast at -18 dB, the top of the M5's idle range.
 */
const RPM_DB_PER_DOUBLING = 3.3;
const IDLE_RPM_SHARE = 0.12;
/** The load term eases in with this time constant (s) when the pedal goes down (the M5's 50-150 ms attack) and out with this one when it lifts. */
const ATTACK_TAU_S = 0.1;
const RELEASE_TAU_S = 0.3;

/**
 * Each class's generator output (RMS, dBFS at `MOTOR_OUTPUT_GAIN`) at 9 evenly spaced revs from `REV_IDLE` to 1, healthy, measured
 * by `motor-level-harness.ts`. The generator's resonances swing it +-4 dB with rpm and ignore the worklet's throttle parameter, so the
 * law's correction is a function of rev and class only. A damaged engine reads within 2 dB of this.
 */
const NATURAL_DB: Readonly<Record<VehicleClassId, readonly number[]>> = {
  sedan: [-24.5, -24.1, -22.2, -21.4, -24.5, -26.0, -27.8, -29.2, -27.0],
  police: [-23.8, -22.7, -20.1, -23.3, -26.2, -28.8, -26.3, -24.8, -24.0],
  muscle: [-23.8, -22.7, -19.7, -22.6, -26.7, -27.8, -25.6, -24.5, -24.5],
  truck: [-23.1, -22.7, -20.6, -22.1, -26.5, -28.7, -26.4, -24.3, -24.0],
  monster: [-25.3, -26.2, -25.2, -28.9, -29.1, -27.7, -27.0, -25.2, -27.1],
  hatch: [-24.8, -24.1, -22.6, -21.2, -23.0, -25.1, -25.8, -27.6, -29.2],
  suv: [-26.2, -26.5, -25.3, -26.7, -28.7, -29.7, -30.5, -29.9, -28.6],
};

/** The target level (dB, <= 0) at the dial's `rpmFrac` (`REV_IDLE`..1, as `motorRev`) and `load` (0..1), under a redline at full load. */
export function engineLawDb(rpmFrac: number, load: number): number {
  const x = Math.min(1, Math.max(REV_IDLE, rpmFrac));
  const rpmShare = IDLE_RPM_SHARE + ((1 - IDLE_RPM_SHARE) * (x - REV_IDLE)) / (1 - REV_IDLE);
  const l = Math.min(1, Math.max(0, load));
  const loadShare = l <= LOAD_KNEE ? 0 : l <= LOAD_MID ? (LOAD_MID_SHARE * (l - LOAD_KNEE)) / (LOAD_MID - LOAD_KNEE) : LOAD_MID_SHARE + ((1 - LOAD_MID_SHARE) * (l - LOAD_MID)) / (1 - LOAD_MID);
  return RPM_DB_PER_DOUBLING * Math.log2(rpmShare) - LOAD_SPAN_DB * (1 - loadShare);
}

/** The class generator's own level (dB) at `rpmFrac`, relative to its level at the redline: the grid, linearly interpolated. */
export function naturalDb(cls: VehicleClassId, rpmFrac: number): number {
  const grid = NATURAL_DB[cls];
  const last = grid.length - 1;
  const at = (Math.min(1, Math.max(REV_IDLE, rpmFrac)) - REV_IDLE) / (1 - REV_IDLE) * last;
  const i = Math.min(last - 1, Math.floor(at));
  return grid[i]! + (grid[i + 1]! - grid[i]!) * (at - i) - grid[last]!;
}

/** The linear gain on the voice's `MOTOR_OUTPUT_GAIN` that makes its output follow `engineLawDb`: law minus the generator's natural level (`shaped` false for the flat oscillator fallback). */
export function engineLawGain(cls: VehicleClassId, rpmFrac: number, load: number, shaped: boolean): number {
  return 10 ** ((engineLawDb(rpmFrac, load) - (shaped ? naturalDb(cls, rpmFrac) : 0)) / 20);
}

/** `current` load moved toward `target` by `dt` seconds: fast when the pedal goes down, slower on a lift. */
export function easeLoad(current: number, target: number, dt: number): number {
  return approach(current, target, dt, target > current ? ATTACK_TAU_S : RELEASE_TAU_S);
}
