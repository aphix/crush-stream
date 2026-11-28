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
 * Each class's voice output (RMS, dBFS at `MOTOR_OUTPUT_GAIN`) at 9 evenly spaced revs from `REV_IDLE` to 1, healthy, at half load, measured
 * by `motor-level.test-util.ts`. The generator's resonances swing it +-4 dB with rpm and ignore the worklet's throttle parameter; the voice layers
 * (saturation, thump, breath) move it under 2 dB between no load and full, so the law's correction is a function of rev and class only. A damaged engine reads within 2 dB of this.
 */
const NATURAL_DB: Readonly<Record<VehicleClassId, readonly number[]>> = {
  sedan: [-22.7, -22.6, -21.5, -20.8, -22.6, -23.5, -24.1, -24.1, -24.2],
  police: [-21.3, -21.0, -19.5, -21.0, -22.6, -23.2, -23.0, -22.7, -22.1],
  muscle: [-21.1, -21.0, -19.6, -21.0, -23.0, -23.5, -22.8, -23.2, -23.6],
  truck: [-20.8, -20.2, -19.5, -20.4, -22.1, -22.2, -21.2, -21.7, -21.4],
  monster: [-21.6, -21.7, -21.7, -22.6, -23.9, -24.1, -24.3, -23.2, -24.0],
  hatch: [-23.3, -23.6, -22.6, -20.9, -21.8, -23.6, -24.0, -24.7, -24.9],
  suv: [-21.9, -21.9, -21.4, -22.3, -22.9, -22.6, -22.9, -23.3, -23.3],
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
