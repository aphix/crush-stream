import { BARRIER_HALF } from "../contact/sat.ts";
import { Ground, STEP_UP } from "../world/ground.ts";

/**
 * The ejection range, FlatOut's driver-flinging event: car A runs up `RANGE.run` m at `RANGE.kph` straight into the
 * jersey barrier (hood height) at the origin over a low kicker (`RANGE.lip`), its driver flies over it down +x into a
 * sand field with a distance sign every `RANGE.signStep` m, and the camera watches him until he lies still. Distances
 * count from the wall's centre line (x = 0).
 */
export const RANGE = {
  /** Run-up (m back from the wall) and speed: set by eye, a FlatOut-like hit that throws on every run. */
  run: 40,
  kph: 100,
  /** The field past the wall (m): length down +x and half-width; signs every `signStep` m, `signs` of them. */
  length: 110,
  halfWidth: 10,
  signStep: 10,
  signs: 11,
  /** The kicker against the wall's face (m): it rocks the nose up as it hits, so the driver leaves climbing and lands further (owner, 2026-10-20: tiny, a lip not a ramp). 20 cm stands over the drawn bumpers of the sedan, coupe and cruiser (17-19 cm), so it meets the nose and not only the tyres. */
  lip: { height: 0.2, length: 2, halfWidth: BARRIER_HALF.z },
} as const;

/** x (m) of the lip's foot: its top edge stands against the wall's face. */
export const RANGE_LIP_FOOT = -BARRIER_HALF.x - RANGE.lip.length;

/** The range's ground: the flat plane with the lip on it, rising toward the wall. */
export const RANGE_GROUND = new Ground();
RANGE_GROUND.addPlane(0, -1e7, 1e7, -1e7, 1e7, Infinity);
RANGE_GROUND.addFace(RANGE_LIP_FOOT, -RANGE.lip.halfWidth, 0, RANGE.lip.length, 2 * RANGE.lip.halfWidth, 0, RANGE.lip.height, 0, RANGE.lip.height, STEP_UP);

/** Wall seconds the landing stays on screen before a looping range runs again. */
const SHOW_LANDING = 3;

/** One range run's throw: the distance so far, the landing, and when to run again. */
export class RangeRun {
  /** Metres past the wall to his torso while he is out (a settled dummy can still topple onto his back); null before the throw. */
  distance: number | null = null;
  landed = false;
  private shown = 0;

  reset(): void {
    this.distance = null;
    this.landed = false;
    this.shown = 0;
  }

  /**
   * One frame: `out` while the thrown driver is out, `settled` once he lies settled on the ground (`RagdollSystem`'s
   * own landing), `x` his torso's x. True once the landing has been shown long enough for the next run.
   */
  step(out: boolean, settled: boolean, x: number, wallDt: number): boolean {
    if (!out) return false;
    this.distance = x;
    if (settled) this.landed = true;
    if (this.landed) this.shown += wallDt;
    return this.shown > SHOW_LANDING;
  }
}
