import type { DamageStage, VehicleClassId } from "../vehicle/vehicle-classes.ts";

/**
 * One class's voice layers on top of the generator (the worklet's `motor-layers.js` reads these by name): the block's firing-locked thump,
 * the load-driven shaping of exhaust and intake, induction whine, off-load pops and the gear-shift thump.
 */
export interface DspTone {
  /** Filled from the class's tuning: cylinders, idle and redline rpm. */
  cylinders: number;
  idleRpm: number;
  redlineRpm: number;
  /** The thump struck at every firing: its pitch (Hz), the share it starts above it, its decay (s), level, and how unevenly the cylinders fire (0..1). */
  bodyHz: number;
  bodyDrop: number;
  bodyTauS: number;
  bodyGain: number;
  lope: number;
  /** Exhaust and intake: gain and saturation drive at no load, and what a full pedal adds to each. */
  exhaustGain: number;
  exhaustGainLoad: number;
  exhaustDrive: number;
  exhaustDriveLoad: number;
  intakeGain: number;
  intakeGainLoad: number;
  intakeDrive: number;
  intakeDriveLoad: number;
  /** The block channel (generator vibration, body thump and shift thump) through the same shaping: the thump's harmonics are the engine's growl. */
  blockDrive: number;
  blockDriveLoad: number;
  /** The intake's breath noise at full load. */
  suckGain: number;
  /** The exhaust's crack at every firing, harder on the pedal: its level and the pitch of its ring (Hz). */
  barkGain: number;
  barkHz: number;
  /** Induction: whine pitch (Hz) at no boost, what full boost adds, the multiple of the crank's frequency it adds, its level, boost lag (s) rising and falling, the blow-off hiss level. */
  whineHz: number;
  whineSpan: number;
  whineCrank: number;
  whineGain: number;
  boostRiseS: number;
  boostFallS: number;
  blowoffGain: number;
  /** Off-load pops: pops a second at full overrun, level, the pitch they ring at (Hz), and how many more a lift-off brings (times). */
  burbleRate: number;
  popGain: number;
  popHz: number;
  liftPops: number;
  /** The gear-shift thump: pitch (Hz), decay (s), level and the click's level. */
  shiftHz: number;
  shiftTauS: number;
  shiftGain: number;
  clickGain: number;
}

type ClassDsp = Omit<DspTone, "cylinders" | "idleRpm" | "redlineRpm">;

/** A plain engine: a modest body thump, a little saturation under load, a faint pop, no induction. */
const BASE: ClassDsp = {
  bodyHz: 75,
  bodyDrop: 0.45,
  bodyTauS: 0.05,
  bodyGain: 4.5,
  blockDrive: 1,
  blockDriveLoad: 1.2,
  lope: 0.15,
  exhaustGain: 1,
  exhaustGainLoad: 0.3,
  exhaustDrive: 1,
  exhaustDriveLoad: 1.4,
  intakeGain: 1,
  intakeGainLoad: 0.2,
  intakeDrive: 1,
  intakeDriveLoad: 0.5,
  suckGain: 0.5,
  barkGain: 1.2,
  barkHz: 650,
  whineHz: 0,
  whineSpan: 0,
  whineCrank: 0,
  whineGain: 0,
  boostRiseS: 0.3,
  boostFallS: 0.25,
  blowoffGain: 0,
  burbleRate: 0.6,
  popGain: 0.35,
  popHz: 900,
  liftPops: 1.5,
  shiftHz: 80,
  shiftTauS: 0.08,
  shiftGain: 5,
  clickGain: 0.7,
};

/** Each class's character on top of `BASE`: the sporty ones pop and whine, the heavy ones are deeper, slower and lumpier. */
const CLASS_DSP: Readonly<Record<VehicleClassId, Partial<ClassDsp>>> = {
  sedan: {},
  police: { barkGain: 1.4, barkHz: 600, bodyHz: 70, bodyTauS: 0.055, bodyGain: 5, lope: 0.25, blockDriveLoad: 1.4, exhaustDriveLoad: 1.8, burbleRate: 2, popGain: 0.5, liftPops: 2, shiftHz: 70, shiftTauS: 0.09, shiftGain: 5.5, clickGain: 0.8 },
  muscle: {
    bodyHz: 58,
    barkGain: 2.2,
    barkHz: 450,
    bodyDrop: 0.55,
    bodyTauS: 0.07,
    bodyGain: 6,
    blockDrive: 1.2,
    blockDriveLoad: 2,
    lope: 0.55,
    exhaustGainLoad: 0.5,
    exhaustDrive: 1.4,
    exhaustDriveLoad: 2.6,
    intakeDrive: 1.2,
    intakeDriveLoad: 1,
    suckGain: 0.9,
    whineCrank: 5.5,
    whineGain: 0.35,
    boostRiseS: 0.25,
    boostFallS: 0.2,
    burbleRate: 9,
    popGain: 0.9,
    popHz: 700,
    liftPops: 3,
    shiftHz: 62,
    shiftTauS: 0.09,
    shiftGain: 7,
    clickGain: 1,
  },
  truck: {
    bodyHz: 46,
    barkGain: 1.8,
    barkHz: 320,
    bodyDrop: 0.4,
    bodyTauS: 0.09,
    bodyGain: 6.5,
    blockDriveLoad: 1.6,
    lope: 0.35,
    exhaustDriveLoad: 1.4,
    suckGain: 0.7,
    whineHz: 700,
    whineSpan: 900,
    whineGain: 0.12,
    boostRiseS: 0.6,
    boostFallS: 0.5,
    burbleRate: 0,
    shiftHz: 50,
    shiftTauS: 0.14,
    shiftGain: 9,
    clickGain: 1.1,
  },
  monster: {
    bodyHz: 38,
    barkGain: 1.4,
    barkHz: 260,
    bodyDrop: 0.5,
    bodyTauS: 0.11,
    bodyGain: 7,
    blockDrive: 2.2,
    blockDriveLoad: 1,
    lope: 0.6,
    exhaustGainLoad: 0.1,
    exhaustDrive: 2.5,
    exhaustDriveLoad: 1,
    suckGain: 3,
    whineCrank: 4,
    whineGain: 0.5,
    boostRiseS: 0.4,
    boostFallS: 0.3,
    burbleRate: 3.5,
    popGain: 1.2,
    popHz: 350,
    liftPops: 2,
    shiftHz: 42,
    shiftTauS: 0.16,
    shiftGain: 10,
    clickGain: 0.9,
  },
  hatch: {
    bodyHz: 95,
    barkGain: 1,
    barkHz: 1000,
    bodyDrop: 0.4,
    bodyTauS: 0.035,
    bodyGain: 3.5,
    blockDriveLoad: 1.4,
    lope: 0.1,
    exhaustDriveLoad: 1.6,
    whineHz: 1200,
    whineSpan: 2600,
    whineGain: 0.22,
    boostRiseS: 0.45,
    boostFallS: 0.3,
    blowoffGain: 0.55,
    burbleRate: 6,
    popGain: 0.5,
    popHz: 1300,
    liftPops: 3,
    shiftHz: 100,
    shiftTauS: 0.06,
    shiftGain: 3.5,
    clickGain: 0.8,
  },
  suv: { bodyHz: 60, bodyTauS: 0.06, bodyGain: 5, exhaustDriveLoad: 1, burbleRate: 0, shiftHz: 58, shiftTauS: 0.1, shiftGain: 6, clickGain: 0.6 },
};

/** A damaged engine's induction is hurt (a split turbo whines less) and it backfires more; a stalled one is silent anyway. */
const STAGE_SHARES: Readonly<Record<DamageStage, { whine: number; pops: number }>> = {
  healthy: { whine: 1, pops: 1 },
  dented: { whine: 1, pops: 1 },
  damaged: { whine: 0.5, pops: 1.5 },
  limping: { whine: 0.2, pops: 2 },
  dead: { whine: 0, pops: 0 },
};

/** The class's layers at a damage stage; the generator tuning's cylinders and revs come from the caller. */
export function dspTone(cls: VehicleClassId, stage: DamageStage, cylinders: number, idleRpm: number, redlineRpm: number): DspTone {
  const share = STAGE_SHARES[stage];
  const c = { ...BASE, ...CLASS_DSP[cls] };
  return { cylinders, idleRpm, redlineRpm, ...c, whineGain: c.whineGain * share.whine, blowoffGain: c.blowoffGain * share.whine, burbleRate: c.burbleRate * share.pops };
}

/** Which ear the voice is heard from: another car at a distance, the followed car from behind, or from inside its cabin. */
type Perspective = "other" | "chase" | "cabin";

/** Per perspective: multipliers on the class's intake, block and outlet channel gains, the cabin boom's boost (dB) and the most the lowpass opens (Hz). */
interface PerspectiveMix {
  intake: number;
  block: number;
  outlet: number;
  boomDb: number;
  openHz: number;
}

/** The chase view hears the exhaust's weight; the cabin hears the block and the intake through glass and a boomy shell, the exhaust far behind. */
export const PERSPECTIVES: Readonly<Record<Perspective, PerspectiveMix>> = {
  other: { intake: 1, block: 0.9, outlet: 1.15, boomDb: 0, openHz: 20000 },
  chase: { intake: 0.8, block: 1.15, outlet: 1.35, boomDb: 0, openHz: 20000 },
  cabin: { intake: 1.25, block: 1.7, outlet: 0.45, boomDb: 5, openHz: 2400 },
};

/** The cabin's boom sits here (Hz), where a sedan's shell resonates. */
export const CABIN_BOOM_HZ = 105;

/** The perspectives by index (what `perspectiveFor` returns). */
export const PERSPECTIVE_NAMES: readonly Perspective[] = ["other", "chase", "cabin"];

/** The perspective index of a voice: any car but the followed one is `other`; the followed one is `cabin` in the first-person view (the eye is in it), else `chase`. */
export function perspectiveFor(isPriority: boolean, firstPerson: boolean): number {
  if (!isPriority) return 0;
  return firstPerson ? 2 : 1;
}

/** Air takes the highs off a far car: the lowpass opens to this share of 20 kHz at each doubling of distance past `AIR_REF_M`, never under `AIR_FLOOR_HZ`. */
const AIR_FALLOFF_PER_DOUBLING = 0.62;
const AIR_REF_M = 8;
const AIR_FLOOR_HZ = 1600;

/** The lowpass ceiling (Hz) for a car `distance` m from the listener. */
export function distanceCutoff(distance: number): number {
  const doublings = Math.log2(Math.max(distance, AIR_REF_M) / AIR_REF_M);
  return Math.max(AIR_FLOOR_HZ, 20000 * AIR_FALLOFF_PER_DOUBLING ** doublings);
}

/** `out` as the class's channel gains times the perspective's multipliers. */
export function perspectiveGains(out: Float64Array, gains: ArrayLike<number>, view: Perspective): void {
  const mix = PERSPECTIVES[view];
  out[0] = gains[0]! * mix.intake;
  out[1] = gains[1]! * mix.block;
  out[2] = gains[2]! * mix.outlet;
}

/** A gear change only thumps after this long (s) since the last one, so a speed hovering at a bucket's edge does not chatter. */
export const SHIFT_GAP_S = 0.35;
/** The torque cut of a shift: the load is this share of itself for this long (s), and the revs fall at the slower time constant (s). */
export const SHIFT_CUT_SHARE = 0.15;
export const SHIFT_CUT_S = 0.14;
export const SHIFT_RPM_TAU_S = 0.1;
/** The shift trigger stays up this long (s), and the thump lands this share of the torque cut after the shift (the clutch comes back in). */
export const SHIFT_PULSE_S = 0.03;
export const SHIFT_THUMP_AT = 0.6;

/** The thump's strength (0..1) for a shift at `load`: a hard upshift is heavy, a downshift a blip's worth. */
export function shiftStrength(load: number, up: boolean): number {
  return up ? 0.4 + 0.6 * load : 0.3 + 0.2 * load;
}

/** What a change of gear (`previous` to `gear`, 0 is reverse or a standstill) is to the sound: 1 an upshift, -1 a downshift, 0 nothing (no change, reverse, a jump of more than one gear (a respawn), or one inside `SHIFT_GAP_S` of the last). */
export function shiftKind(previous: number, gear: number, sinceShiftS: number): number {
  if (Math.abs(gear - previous) !== 1 || gear === 0 || previous === 0 || sinceShiftS < SHIFT_GAP_S) return 0;
  return gear > previous ? 1 : -1;
}
