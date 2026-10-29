import { describe, expect, it } from "vitest";
import { REV_IDLE, VEHICLE_CLASS_IDS, type DamageStage, type VehicleClassId } from "../vehicle/vehicle-classes.ts";
import { voiceLevels, type Level } from "./motor-level.test-util.ts";

const STAGES: readonly DamageStage[] = ["healthy", "damaged", "limping"];
const REVS = [REV_IDLE, 0.4, 0.6, 0.8, 1] as const;
/** Every voice's loudest moment, any class, stage or rev: at most -6 dBFS (the old output clipped the unscaled sum, which swings to +-9, at +-1). */
const VOICE_PEAK_LIMIT = 0.5;
/** A redline's peak sits in this band (-18 to -8 dBFS) around the -12 of the player's engine at the default slider; the generator's noise moves a peak by a few dB run to run. */
const REDLINE_PEAK_MIN = 0.12;
const REDLINE_PEAK_MAX = 0.4;
/** A voice is never inaudibly thin: its RMS at any rev stays above -34 dBFS. */
const VOICE_RMS_MIN = 0.02;
/** The voice output of `cls` tuned to `stage`, per rev of `REVS`. */
function revLevels(cls: VehicleClassId, stage: DamageStage): Promise<Level[]> {
  return voiceLevels(cls, stage, REVS);
}

describe("given each vehicle class's voice, rendered by the shipped worklet at every damage stage", () => {
  for (const cls of VEHICLE_CLASS_IDS) {
    for (const stage of STAGES) {
      it(`when the ${cls} runs ${stage} from idle to redline, then no moment passes -6 dBFS and it is never thin`, async () => {
        const levels = await revLevels(cls, stage);
        expect(Math.max(...levels.map((l) => l.peak)), `${cls} ${stage} peaks ${levels.map((l) => l.peak.toFixed(3)).join(" ")}`).toBeLessThanOrEqual(VOICE_PEAK_LIMIT);
        expect(Math.min(...levels.map((l) => l.rms)), `${cls} ${stage} rms ${levels.map((l) => l.rms.toFixed(3)).join(" ")}`).toBeGreaterThanOrEqual(VOICE_RMS_MIN);
      });
    }
    it(`when the ${cls} is at its redline healthy, then its peak sits in the -18 to -8 dBFS band around -12`, async () => {
      const redline = (await revLevels(cls, "healthy")).at(-1)!;
      expect(redline.peak >= REDLINE_PEAK_MIN && redline.peak <= REDLINE_PEAK_MAX, `${cls} redline peak ${redline.peak.toFixed(3)}`).toBeTruthy();
    });
  }
});
