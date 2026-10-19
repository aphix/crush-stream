import type * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { makeCarFrame, type CarFrame } from "../net/codec.ts";
import { carLayout } from "../net/car-pose.ts";
import type { DeformMode } from "../deform/deform-rig.ts";
import { computeNormalsFast } from "../deform/fast-normals.ts";

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
  /** The drawn body and bonnet as they stood when read (`readDrawn`), the tyre hold included. */
  private drawnBody: Float32Array | null = null;
  private drawnHood: Float32Array | null = null;

  /** The car's damage now (the first read sizes the record from the car's layout; later reads reuse it). */
  read(car: DeformableCar): void {
    const f = (this.frame ??= makeCarFrame(carLayout(car)));
    car.deform.readNetState(f.deform);
    car.readPartNetState(f.parts);
    this.crashed = car.crashed;
    ({ squash: this.squash, buckle: this.buckle, mode: this.mode } = car.deform);
  }

  /** The car's drawn body and bonnet now (`drawOn` puts them back): the race's last frame, as the player saw it. */
  readDrawn(car: DeformableCar): void {
    // Read before the frame draws the car: its skin is brought up to this step first, as the frame's draw would.
    car.updateSkin();
    const { body, hood } = car.lookMeshes();
    this.drawnBody = copyOf(body.geometry.getAttribute("position").array as Float32Array, this.drawnBody);
    this.drawnHood = copyOf(hood.geometry.getAttribute("position").array as Float32Array, this.drawnHood);
  }

  /** The drawn body and bonnet `readDrawn` kept, on `car` (a car of the same body): it is drawn as it finished, not re-held over its own wheels. */
  drawOn(car: DeformableCar): void {
    const { body, hood } = car.lookMeshes();
    drawInto(body, this.drawnBody);
    drawInto(hood, this.drawnHood);
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

/** `from` copied into `into` when it fits, else into a new array. */
function copyOf(from: Float32Array, into: Float32Array | null): Float32Array {
  if (into?.length !== from.length) return Float32Array.from(from);
  into.set(from);
  return into;
}

/** `drawn` as the positions of `mesh`, when it fits. */
function drawInto(mesh: THREE.Mesh, drawn: Float32Array | null): void {
  const attr = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  if (!drawn || attr.array.length !== drawn.length) return;
  (attr.array as Float32Array).set(drawn);
  attr.needsUpdate = true;
  computeNormalsFast(mesh.geometry);
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
    for (let i = 0; i < racers && i < cars.length; i++) {
      const damage = (this.cars[i] ??= new CarDamage());
      damage.read(cars[i]!);
      damage.readDrawn(cars[i]!);
    }
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
