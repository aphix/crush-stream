import { MAX_CARS } from "../scenes/fleet.ts";
import { sampleAt, type TrackPath } from "../world/track.ts";

/** Total heading change (rad) of the road ahead past which a driver sees nothing further: what lies beyond a bend this sharp is behind the buildings. */
const SIGHT_TURN = Math.PI / 3;
/** Step (m) the road ahead is walked in, and the farthest (m) a driver reads another car. */
const SIGHT_STEP = 3;
export const SIGHT_MAX = 150;
/** Every car this near (m) is in view whatever the road does (side window, junction apron). */
export const SEEN_NEAR = 12;
/** Cars this far behind (m) are in the mirrors; a car off the road's corridor is seen only this near (m): side streets are walled in by buildings. */
export const SEEN_BEHIND = 40;
export const SEEN_OFFROAD = 45;
/** Sideways reach (m) past the road's edge that still counts as on its corridor. */
export const SEEN_CORRIDOR = 8;
/** What a pair stands at when nothing is known of it (a new race, a teleport): longer than any reaction, so only a car that comes into view after being hidden is reacted to late. */
const NOTICED_S = 1e6;

/** Arc length (m) of the road a driver at `s` on `path` sees going `dir` (+1 with the arc, -1 against it): to where its heading has changed `SIGHT_TURN`, the path's end, or `SIGHT_MAX`. */
export function visibleStretch(path: TrackPath, s: number, dir: number): number {
  let turned = 0;
  for (let d = 0; d < SIGHT_MAX; d += SIGHT_STEP) {
    const at = s + dir * d;
    if (!path.closed && (at < 0 || at > path.length)) return d;
    turned += Math.abs(path.curv[sampleAt(path, at)]!) * SIGHT_STEP;
    if (turned > SIGHT_TURN) return d;
  }
  return SIGHT_MAX;
}

/** How far (m) a driver looks for a car it closes on at `closing` m/s: `seconds` of it, never under `floor`, never past the road it can see (`visible`). */
export function lookDistance(closing: number, seconds: number, floor: number, visible: number): number {
  return Math.min(Math.max(floor, closing * seconds), visible);
}

/** The speed (m/s) at which the observer and a car `dx`, `dz` m away (`dist` m) close on each other: 0 when they part. */
export function closingSpeed(selfVx: number, selfVz: number, otherVx: number, otherVz: number, dx: number, dz: number, dist: number): number {
  return Math.max(0, -((otherVx - selfVx) * dx + (otherVz - selfVz) * dz) / Math.max(dist, 1e-3));
}

/** Per observer and car: how long it has been in view. A driver reacts to a car only once it has been in view for the driver's reaction time. */
export class Sighting {
  private readonly inViewFor = new Float32Array(MAX_CARS * MAX_CARS).fill(NOTICED_S);

  reset(): void {
    this.inViewFor.fill(NOTICED_S);
  }

  /** A teleport (respawn, put-away) clears everything `id` saw and everyone's sight of it. */
  forget(id: number): void {
    for (let k = 0; k < MAX_CARS; k++) {
      this.inViewFor[id * MAX_CARS + k] = NOTICED_S;
      this.inViewFor[k * MAX_CARS + id] = NOTICED_S;
    }
  }

  /** `age` s passed for `observer`: `other` in view or not now; whether the observer has had it in view for `reaction` s. */
  reacts(observer: number, other: number, inView: boolean, age: number, reaction: number): boolean {
    const slot = observer * MAX_CARS + other;
    this.inViewFor[slot] = inView ? this.inViewFor[slot]! + age : 0;
    return this.inViewFor[slot]! >= reaction;
  }
}
