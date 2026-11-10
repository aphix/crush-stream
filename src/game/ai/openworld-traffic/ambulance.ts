import { hypot2 } from "../../kernel/physics-core.js";
import { nearestFreeSpot } from "../../world/openworld/openworld-parking.ts";
import { AMBULANCE_DEPOT_METRES, AMBULANCE_LOAD_SECONDS, AMBULANCE_QUEUE } from "./traffic-constants.ts";
import { LEASE, type DrivenCar, type MoverFleet } from "./mover-fleet.ts";
import { spotUnseen, type TrafficContext } from "./traffic-ports.ts";

/** Where a call is: nothing out, on its way to the scene, loading at it, or driving off. */
export const AMBULANCE = { idle: 0, coming: 1, loading: 2, leaving: 3 } as const;
type AmbulanceState = (typeof AMBULANCE)[keyof typeof AMBULANCE];

/**
 * The open world's ambulance: one call at a time, the others wait their turn (`AMBULANCE_QUEUE`). `call` sends an ambulance (a white police body with its lights on, leased from the movers) from a space at the edge of the district along the streets to the space nearest the scene,
 * where it stands `AMBULANCE_LOAD_SECONDS` with its lights on, then drives to another far space and is put away once it gets there (or at once when no eye sees it and none is near).
 */
export class AmbulanceService {
  state: AmbulanceState = AMBULANCE.idle;
  /** The space the ambulance stands at while it loads, -1 when none is out. */
  scene = -1;
  /** Where the call it is out on was for (x, z: where the one run down lies), and who is down there (-1: unknown); meaningless while none is out. */
  sceneX = 0;
  sceneZ = 0;
  victim = -1;
  /** Called with the victim (-1: unknown) when the ambulance has loaded and is about to leave: whoever holds their body lets it go. */
  onLoaded: ((victim: number) => void) | null = null;
  private readonly queueX = new Float64Array(AMBULANCE_QUEUE);
  private readonly queueZ = new Float64Array(AMBULANCE_QUEUE);
  private readonly queueVictim = new Int32Array(AMBULANCE_QUEUE);
  private queued = 0;
  private handle: DrivenCar | null = null;
  private since = 0;
  private readonly context: TrafficContext;
  private readonly fleet: MoverFleet;

  constructor(context: TrafficContext, fleet: MoverFleet) {
    this.context = context;
    this.fleet = fleet;
  }

  /**
   * A call for someone down at (x, z), `victim` (-1: unknown), at crowd second `seconds`: the ambulance goes to the free space nearest, or when one is out already the call waits its turn. False when none is in the pool, there is no way,
   * or the queue is full.
   */
  call(x: number, z: number, seconds: number, victim = -1): boolean {
    if (this.state !== AMBULANCE.idle) {
      if (this.queued >= AMBULANCE_QUEUE) return false;
      this.queueX[this.queued] = x;
      this.queueZ[this.queued] = z;
      this.queueVictim[this.queued++] = victim;
      return true;
    }
    return this.start(x, z, seconds, victim);
  }

  private start(x: number, z: number, seconds: number, victim: number): boolean {
    const scene = nearestFreeSpot(this.context.spots, x, z, this.context.taken);
    if (scene < 0) return false;
    const depot = this.farSpot(scene);
    if (depot < 0) return false;
    const handle = this.fleet.spawn(-1, depot, scene, LEASE.ambulance, Infinity);
    if (handle === null) return false;
    this.handle = handle;
    this.scene = scene;
    this.sceneX = x;
    this.sceneZ = z;
    this.victim = victim;
    this.state = AMBULANCE.coming;
    this.since = seconds;
    return true;
  }

  /** The oldest waiting call goes now if it can; it keeps its turn when it cannot (no car, no space). */
  private startNext(seconds: number): void {
    if (this.queued === 0 || !this.start(this.queueX[0]!, this.queueZ[0]!, seconds, this.queueVictim[0]!)) return;
    this.queueX.copyWithin(0, 1, this.queued);
    this.queueZ.copyWithin(0, 1, this.queued);
    this.queueVictim.copyWithin(0, 1, this.queued);
    this.queued--;
  }

  /** The engine's index of the ambulance's car, -1 while none is out. */
  get carIndex(): number {
    return this.handle === null ? -1 : this.handle.index;
  }

  step(seconds: number): void {
    const handle = this.handle;
    if (handle === null) {
      this.startNext(seconds);
      return;
    }
    if (handle.lost) {
      this.end();
    } else if (this.state === AMBULANCE.coming && handle.arrived) {
      this.state = AMBULANCE.loading;
      this.since = seconds;
    } else if (this.state === AMBULANCE.loading && seconds - this.since >= AMBULANCE_LOAD_SECONDS) {
      this.state = AMBULANCE.leaving;
      this.since = seconds;
      this.onLoaded?.(this.victim);
      if (!this.fleet.redirect(handle, this.farSpot(this.scene))) this.release(handle);
    } else if (this.state === AMBULANCE.leaving && (handle.arrived || this.unseenAndFar(handle))) this.release(handle);
  }

  private release(handle: DrivenCar): void {
    this.fleet.despawn(handle);
    this.end();
  }

  private end(): void {
    this.handle = null;
    this.scene = -1;
    this.victim = -1;
    this.state = AMBULANCE.idle;
  }

  private unseenAndFar(handle: DrivenCar): boolean {
    const { sight, sightBase } = this.context;
    const car = handle.car;
    return !sight.near(car.group.position.x, car.group.position.z, AMBULANCE_DEPOT_METRES / 2) && sight.unseenFor(sightBase + handle.index - this.fleet.first) >= sight.hideGrace;
  }

  /** The free space farthest from space `from` and at least `AMBULANCE_DEPOT_METRES` from it, one no eye sees before one some eye does; -1 when there is none. */
  private farSpot(from: number): number {
    const { spots, taken } = this.context;
    if (from < 0) return -1;
    let best = -1;
    let bestUnseen = false;
    let bestDistance = 0;
    for (let spot = 0; spot < spots.count; spot++) {
      if (spots.stays[spot] === 1 || taken[spot] === 1) continue;
      const distance = hypot2(spots.x[spot]! - spots.x[from]!, spots.z[spot]! - spots.z[from]!);
      if (distance < AMBULANCE_DEPOT_METRES) continue;
      const unseen = spotUnseen(this.context, spot);
      const better = best < 0 || (unseen && !bestUnseen) || (unseen === bestUnseen && distance > bestDistance);
      if (!better) continue;
      best = spot;
      bestUnseen = unseen;
      bestDistance = distance;
    }
    return best;
  }
}
