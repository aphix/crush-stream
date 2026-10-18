import type { DeformableCar } from "../vehicle/car.ts";
import { makeCarFrame, type CarFrame } from "../net/codec.ts";
import { carLayout } from "../net/car-pose.ts";
import type { DeformMode } from "../deform/deform-rig.ts";

/**
 * One car's damage as it stood when read: the dents and the packed engine block, the parts torn off, the lost wheels, the broken lamps and glass, the engine's travel
 * (`DeformableCar.writeNetState` takes them as a netplay client takes the host's, over a fresh car). A held reset reads it to lay it on the car it puts back on the road
 * (`RaceField.placeKeeping`), and the podium reads every racer's when the race ends to show the cars as the race left them.
 */
export class CarDamage {
  private frame: CarFrame | null = null;
  private crashed = false;
  /** The car's crumple settings when read: the net state carries none, and a respawn between the read and `lay` re-dresses the car with the engine's. */
  private squash = 0;
  private buckle = 0;
  private mode: DeformMode = "lattice";

  /** The car's damage now (the first read sizes the record from the car's layout; later reads reuse it). */
  read(car: DeformableCar): void {
    const f = (this.frame ??= makeCarFrame(carLayout(car)));
    car.deform.readNetState(f.deform);
    car.readPartNetState(f.parts);
    this.crashed = car.crashed;
    ({ squash: this.squash, buckle: this.buckle, mode: this.mode } = car.deform);
  }

  /**
   * The read damage on `car`, which stands where it should at rest (`spawnFacing`, undamaged, or already carrying this damage). A wreck stays one (the net state's `massActive`): its masses run again from where
   * the car stands, at rest, before the net state lays its dents on them (the net state sets the flag alone, and a wreck's rigid step and contact rows over masses never armed read NaN). The net state carries
   * no crumple settings: the ones the car had when read come back.
   */
  lay(car: DeformableCar): void {
    const f = this.frame;
    if (!f) return;
    car.crashed = this.crashed;
    if ((f.deform.flags & 1) !== 0) car.deform.armMasses(car.group, car.velocity, car.angular);
    car.writeNetState(f.deform, f.parts);
    car.deform.squash = this.squash;
    car.deform.buckle = this.buckle;
    car.deform.setMode(this.mode);
  }
}

/**
 * Every racer's damage as the race ended, read once a race (the first frame that sees it finished): the cars go on moving afterwards and the results reel respawns them, so the podium
 * (docs/PODIUM.md) shows the cars from this, not from what the field's cars look like when it opens.
 */
export class FinalDamage {
  private readonly cars: CarDamage[] = [];
  private taken = false;

  /** Read `racers` cars' damage, once until `clear`. */
  take(cars: readonly DeformableCar[], racers: number): void {
    if (this.taken) return;
    this.taken = true;
    for (let i = 0; i < racers && i < cars.length; i++) (this.cars[i] ??= new CarDamage()).read(cars[i]!);
  }

  /** Racer `id`'s damage as the race ended; null before one has ended since `clear`. */
  of(id: number): CarDamage | null {
    return this.taken ? (this.cars[id] ?? null) : null;
  }

  /** A race starts: the last one's damage no longer counts. */
  clear(): void {
    this.taken = false;
  }
}
