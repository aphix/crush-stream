/** Quantities every context shares (kernel: no imports). The sim is SI; readouts, specs and bars speak km/h. */

/** km/h per m/s. */
export const KPH_PER_MS = 3.6;
/** The sim's gravity (m/s²): every fall, toss and debris arc uses it. */
export const GRAVITY = 9.6;

/**
 * The sim's step rates (Hz). Two independent inputs, `FINE_HZ` and `SLICES_PER_STEP`; what follows from them is computed in code,
 * never a constant of its own (a slice is `1 / FINE_HZ`, a quiet step `1 / QUIET_HZ`). Going to a 120 Hz quiet step is
 * `SLICES_PER_STEP = 2`, and the step can never stop dividing the fine floor. Source: the owner's call, moved by measurement
 * (`docs/CONTACT_PARITY.md`, "The physics step").
 */
/** The fine floor: the finest slice (s⁻¹) the sim solves contact in, and the pacer's step on a device that keeps up. */
export const FINE_HZ = 240;
/** Fine slices in one quiet step, and in a step cut for contact: the quiet step is this many fine slices long. */
export const SLICES_PER_STEP = 3;
/** The quiet step's rate: how often the sim steps with nothing in contact (`SimPacer`'s coarse floor, `stepWorld`'s one-slice step). */
export const QUIET_HZ = FINE_HZ / SLICES_PER_STEP;
/** The display frame the engine's clock and the tests advance with. */
export const FRAME_HZ = 60;

/** Cables alive at once; the oldest goes for one more. */
export const MAX_TETHERS = 6;
/** The winch's reeling speed (m/s), in the sim's cables and the dummies' world's ropes alike: a sedan 40 m out is within 4.5 m of its anchor in about 1.7 s (`tether.test.ts`). */
export const WINCH_SPEED = 28;
/** The shortest (m) a winch reels a cable to: a cable already shorter than this is left as it is. */
export const WINCH_MIN_LENGTH = 3;
