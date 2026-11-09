import { MAX_CARS } from "../scenes/fleet.ts";
import { DETAIL_LEVELS, type CarDetail } from "./car-detail.ts";
import { HIDE_GRACE, type SightField } from "./openworld-sight.ts";

/** Rungs nearer than the match ladder's: the streets are 11 m wide between three-storey fronts, so a car past 40 m is a few pixels. */
const RUNGS_NEARER = 3;
/** The sphere (m) a car is asked about: the engine's skin-LoD radius, the car and its roof's shadow. */
const CAR_RADIUS_M = 3.5;
/** A car this near (m) to a player's car is never phased out: it is in the host's sim reach and may be entered. */
const KEEP_NEAR_M = 40;
const NO_RUNG = -1;

/** What the switch reads and writes of a car: a `DeformableCar` is one. */
export type LodCar = { readonly group: { readonly position: { readonly x: number; readonly z: number }; visible: boolean } };

/**
 * The open world's cars: the distance detail on a nearer rung of the ladder (small parts cut at 20 m, all but the body at 40 m on a
 * desktop), and a car no eye has seen for `HIDE_GRACE` s and no player is near taken off the draw (`group.visible`, which every batch
 * of wheels, lamps, parts and drivers honours), shown again the frame it is seen. It never touches a car it did not hide, nor the
 * followed one; the sim reads nothing it changes beyond a car's own door reach, which `KEEP_NEAR_M` covers.
 */
export class OpenWorldCarLod {
  private readonly sight: SightField;
  private readonly detail: Pick<CarDetail, "level" | "setLevel">;
  private readonly phasedOut = new Array<LodCar | null>(MAX_CARS).fill(null);
  private firstId = 0;
  private hasIds = false;
  private rungBefore = NO_RUNG;
  private rung = 0;

  constructor(sight: SightField, detail: Pick<CarDetail, "level" | "setLevel">) {
    this.sight = sight;
    this.detail = detail;
  }

  /** One frame: the open world's rung is in force, and every car is asked of the sight field. A replay owns every car's visibility: nothing is hidden while one plays. */
  frame(cars: readonly LodCar[], followed: LodCar | null, replaying: boolean): void {
    if (replaying) {
      this.showAll(cars);
      return;
    }
    if (this.rungBefore === NO_RUNG) this.start();
    if (this.detail.level !== this.rung) this.detail.setLevel(this.rung);
    const known = Math.min(cars.length, MAX_CARS);
    for (let at = 0; at < known; at++) this.judge(at, cars[at]!, followed);
  }

  /** Culling is off for now: the cars come back and the ladder's own rung with them; the next `frame` starts over. */
  release(cars: readonly LodCar[]): void {
    if (this.rungBefore === NO_RUNG) return;
    this.showAll(cars);
    this.detail.setLevel(this.rungBefore);
    this.rungBefore = NO_RUNG;
  }

  /** The open world ended: released, and the ids go back with the field's clear. */
  stop(cars: readonly LodCar[]): void {
    this.release(cars);
    this.hasIds = false;
  }

  private start(): void {
    if (!this.hasIds) this.firstId = this.sight.claim(MAX_CARS);
    this.hasIds = true;
    this.rungBefore = Math.max(0, this.detail.level);
    this.rung = Math.min(DETAIL_LEVELS.length - 1, this.rungBefore + RUNGS_NEARER);
  }

  private judge(at: number, car: LodCar, followed: LodCar | null): void {
    const id = this.firstId + at;
    const hiddenByUs = this.phasedOut[at] === car && !car.group.visible;
    if (!hiddenByUs && this.phasedOut[at] !== null) {
      this.phasedOut[at] = null;
      this.sight.reset(id);
    }
    if (!hiddenByUs && !car.group.visible) {
      this.sight.reset(id);
      return;
    }
    const position = car.group.position;
    const probe = this.sight.probe;
    probe.x = position.x;
    probe.z = position.z;
    probe.radius = CAR_RADIUS_M;
    const seen = this.sight.observeAtProbe(id);
    probe.radius = KEEP_NEAR_M;
    const needed = seen || car === followed || this.sight.nearProbe();
    if (hiddenByUs) {
      if (!needed) return;
      car.group.visible = true;
      this.phasedOut[at] = null;
      return;
    }
    if (needed || this.sight.unseenFor(id) < HIDE_GRACE) return;
    car.group.visible = false;
    this.phasedOut[at] = car;
  }

  /** Every car this hid that is still where it was in the live list is drawn again. */
  private showAll(cars: readonly LodCar[]): void {
    for (let at = 0; at < MAX_CARS; at++) {
      const car = this.phasedOut[at];
      if (!car) continue;
      this.phasedOut[at] = null;
      if (cars[at] === car) car.group.visible = true;
    }
  }
}
