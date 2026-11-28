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
 * Each class's voice output (RMS, dBFS at `MOTOR_OUTPUT_GAIN`) at 9 evenly spaced revs from `REV_IDLE` to 1, healthy, with the engine at no load and at
 * full load, measured by `motor-level.test-util.ts`. The generator's resonances swing it +-4 dB with rpm and ignore the worklet's throttle parameter, but the
 * voice layers (saturation, thump, bark, breath) answer to it, so the correction is a function of rev, load and class. A damaged engine reads within 2 dB of this.
 */
const NATURAL_DB: Readonly<Record<VehicleClassId, readonly [readonly number[], readonly number[]]>> = {
  sedan: [[-24.1, -23.6, -22.5, -21.9, -23.8, -24.5, -25.1, -25.0, -24.5], [-22.3, -22.6, -21.3, -20.7, -22.3, -23.3, -23.8, -23.8, -24.3]],
  police: [[-22.7, -22.0, -20.5, -22.3, -23.7, -24.3, -23.4, -22.6, -22.2], [-21.2, -21.1, -19.6, -21.1, -22.5, -23.0, -23.0, -22.9, -22.3]],
  muscle: [[-22.1, -21.4, -20.0, -21.7, -23.6, -24.0, -22.8, -22.5, -22.6], [-21.3, -21.2, -19.9, -21.1, -22.7, -23.2, -22.2, -22.9, -23.0]],
  truck: [[-21.8, -20.6, -20.2, -20.6, -22.3, -22.3, -21.2, -20.9, -20.7], [-21.1, -20.5, -19.7, -20.7, -22.3, -22.3, -21.2, -22.1, -21.9]],
  monster: [[-21.7, -21.7, -22.0, -22.7, -23.7, -23.6, -23.9, -23.0, -23.8], [-21.7, -21.8, -21.5, -22.5, -23.5, -23.7, -23.6, -22.5, -23.0]],
  hatch: [[-25.0, -25.0, -23.6, -21.9, -23.1, -25.0, -25.2, -26.0, -26.3], [-22.9, -23.3, -22.3, -20.8, -21.5, -23.2, -23.7, -24.3, -24.4]],
  suv: [[-23.5, -23.4, -22.6, -23.3, -23.4, -22.9, -22.8, -23.0, -23.0], [-21.9, -21.9, -21.6, -22.3, -23.1, -23.1, -23.4, -24.0, -23.9]],
};

/** The target level (dB, <= 0) at the dial's `rpmFrac` (`REV_IDLE`..1, as `motorRev`) and `load` (0..1), under a redline at full load. */
export function engineLawDb(rpmFrac: number, load: number): number {
  const x = Math.min(1, Math.max(REV_IDLE, rpmFrac));
  const rpmShare = IDLE_RPM_SHARE + ((1 - IDLE_RPM_SHARE) * (x - REV_IDLE)) / (1 - REV_IDLE);
  const l = Math.min(1, Math.max(0, load));
  const loadShare = l <= LOAD_KNEE ? 0 : l <= LOAD_MID ? (LOAD_MID_SHARE * (l - LOAD_KNEE)) / (LOAD_MID - LOAD_KNEE) : LOAD_MID_SHARE + ((1 - LOAD_MID_SHARE) * (l - LOAD_MID)) / (1 - LOAD_MID);
  return RPM_DB_PER_DOUBLING * Math.log2(rpmShare) - LOAD_SPAN_DB * (1 - loadShare);
}

/** The grid of `cls` at `rpmFrac`, linearly interpolated between its revs: `full` picks the full-load grid. */
function gridDb(cls: VehicleClassId, rpmFrac: number, full: boolean): number {
  const grid = NATURAL_DB[cls][full ? 1 : 0];
  const last = grid.length - 1;
  const at = ((Math.min(1, Math.max(REV_IDLE, rpmFrac)) - REV_IDLE) / (1 - REV_IDLE)) * last;
  const i = Math.min(last - 1, Math.floor(at));
  return grid[i]! + (grid[i + 1]! - grid[i]!) * (at - i);
}

/** The class voice's own level (dB) at `rpmFrac` and `load` (0..1, interpolated between the no-load and full-load grids), relative to its level at the redline at full load. */
export function naturalDb(cls: VehicleClassId, rpmFrac: number, load: number): number {
  const l = Math.min(1, Math.max(0, load));
  return gridDb(cls, rpmFrac, false) * (1 - l) + gridDb(cls, rpmFrac, true) * l - gridDb(cls, 1, true);
}

/** The linear gain on the voice's `MOTOR_OUTPUT_GAIN` that makes its output follow `engineLawDb`: law minus the voice's natural level at that load (`shaped` false for the flat oscillator fallback). */
export function engineLawGain(cls: VehicleClassId, rpmFrac: number, load: number, shaped: boolean): number {
  return 10 ** ((engineLawDb(rpmFrac, load) - (shaped ? naturalDb(cls, rpmFrac, load) : 0)) / 20);
}

/** `current` load moved toward `target` by `dt` seconds: fast when the pedal goes down, slower on a lift. */
export function easeLoad(current: number, target: number, dt: number): number {
  return approach(current, target, dt, target > current ? ATTACK_TAU_S : RELEASE_TAU_S);
}
