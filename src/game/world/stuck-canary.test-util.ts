import type { DeformableCar } from "../vehicle/car.ts";

/**
 * The owner's bar (2026-10-09): a car "goes" (can be driven) rather than sits; being stuck for more than 10–20 s is the un-fun
 * case, whatever it sits against (a wall, a kerb, a prop, another car, its own roof). The watch: no live car whose driver asks for
 * drive moves less than `MOVE` m in any `WINDOW` s, unless it is in a pile (`PILE` or more other cars touching it through the whole
 * window). What makes it hold is staged where it is decided: a race's AI car the director respawns (`race-stall.test.ts`), a cop it
 * puts away (`police.test.ts`), a hunter that backs off a wedge (`hunter.test.ts`), a derby car's wedge and pocket breakers
 * (`match/derby.test.ts`, `ai/derby-ai.test.ts`). The watch itself is pinned in `stuck-watch.test.ts`; `survival-chase.ai-long-run.ts` reads it.
 *
 * What the watch reads: the pedals the sim ran (`car.drive.throttle`, which `applyDrive` idles while a car is dead or has no
 * wheel down, plus `car.airThrottle`, the gas winding the wheels of a car in the air or on its roof), the body's position, and
 * the slice's first-pass pair contacts. A placement (`car.placements`: a respawn, a wake, a start) ends the window, so a car the
 * race reset after its stall (`STALL_WINDOW`) is judged from where it was put. A car counts as driven when its mean |throttle|
 * over the window is `DRIVE` or more: a rocking car (forward, reverse, forward) is as stuck as one with its foot down.
 */
const WINDOW = 10;
const MOVE = 0.5;
const DRIVE = 0.5;
const PILE = 2;
/** Samples per window: the window is judged every `SAMPLE` s. */
const SAMPLE = 0.5;
const SAMPLES = WINDOW / SAMPLE;

type Sample = { t: number; x: number; z: number; drive: number; partners: number };

/** One field's cars watched for stuck windows: feed `pair` for every contact and `step` after every physics step. */
export class StuckWatch {
  readonly episodes: string[] = [];
  private readonly rings: Sample[][];
  private readonly driveSum: Float64Array;
  private readonly timeSum: Float64Array;
  private readonly partners: Set<number>[];
  private readonly placements: Int32Array;
  private readonly nextSample: Float64Array;
  private readonly label: string;

  constructor(label: string, n: number) {
    this.label = label;
    this.rings = Array.from({ length: n }, () => []);
    this.driveSum = new Float64Array(n);
    this.timeSum = new Float64Array(n);
    this.partners = Array.from({ length: n }, () => new Set<number>());
    this.placements = new Int32Array(n).fill(-1);
    this.nextSample = new Float64Array(n).fill(NaN);
  }

  pair(a: number, b: number): void {
    this.partners[a]?.add(b);
    this.partners[b]?.add(a);
  }

  /** The cars after a step of `dt` s ending at scenario time `t` (s); `alive(i)` says whether car i is a live, driven car of the field. */
  step(cars: readonly DeformableCar[], t: number, dt: number, alive: (i: number) => boolean): void {
    for (let i = 0; i < cars.length && i < this.rings.length; i++) {
      const car = cars[i]!;
      const ring = this.rings[i]!;
      if (!alive(i) || car.placements !== this.placements[i]) {
        this.placements[i] = car.placements;
        this.clear(i, t);
        if (!alive(i)) continue;
      }
      const throttle = Math.max(Math.abs(car.drive.throttle), Math.abs(car.airThrottle));
      this.driveSum[i] += throttle * dt;
      this.timeSum[i] += dt;
      if (t < this.nextSample[i]!) continue;
      ring.push({ t, x: car.group.position.x, z: car.group.position.z, drive: this.driveSum[i]! / this.timeSum[i]!, partners: this.partners[i]!.size });
      this.driveSum[i] = 0;
      this.timeSum[i] = 0;
      this.partners[i]!.clear();
      this.nextSample[i] = t + SAMPLE;
      if (ring.length < SAMPLES) continue;
      const first = ring[0]!;
      let moved = 0;
      let drive = 0;
      let fewest = Infinity;
      for (const s of ring) {
        moved = Math.max(moved, Math.hypot(s.x - first.x, s.z - first.z));
        drive += s.drive / ring.length;
        fewest = Math.min(fewest, s.partners);
      }
      if (drive >= DRIVE && moved < MOVE && fewest < PILE) {
        this.episodes.push(`${this.label}: car ${i} from t=${first.t.toFixed(1)} s at (${first.x.toFixed(1)}, ${first.z.toFixed(1)}) moved ${moved.toFixed(2)} m in ${WINDOW} s with mean throttle ${drive.toFixed(2)}, fewest cars touching ${fewest}`);
        ring.length = 0;
      } else ring.shift();
    }
  }

  private clear(i: number, t: number): void {
    this.rings[i]!.length = 0;
    this.driveSum[i] = 0;
    this.timeSum[i] = 0;
    this.partners[i]!.clear();
    this.nextSample[i] = t + SAMPLE;
  }
}
