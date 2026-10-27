import type { DeformableCar } from "../vehicle/car.ts";
import type { PropHits } from "../contact/prop-contact.ts";
import { newWorld, type World } from "../engine/world-step.ts";
import { setGround } from "../world/ground.ts";
import { DERBY_RADIUS } from "./derby-arena.ts";
import { DERBY_FREE_PROPS, DerbyGround } from "./derby-ground.ts";
import { layoutDerby } from "./fleet.ts";

const NO_HITS: PropHits = { knock() {}, fx() {}, wall() {} };

/** The derby arena as the engine wires it for `cars`: its ground active, its prisms met at the end of every slice. `setGround(null)` puts the flat plane back. */
export function arenaWorld(cars: readonly DeformableCar[], hits: PropHits = NO_HITS): { world: World; ground: DerbyGround } {
  const ground = new DerbyGround();
  setGround(ground);
  const world = newWorld(cars);
  world.collide = (car, index, dt) => ground.contact(car, index, hits, dt);
  return { world, ground };
}

/** Spawns `cars` on the derby layout drawn from a Lehmer generator seeded `seed`, facing their slots at `speed` m/s. */
export function placeDerby(cars: readonly DeformableCar[], seed: number, speed = 0): void {
  let s = seed;
  const rng = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const slots = layoutDerby(cars.length, DERBY_RADIUS, rng, DERBY_FREE_PROPS);
  for (const [i, c] of cars.entries()) c.spawnFacing(slots[i]!.x, slots[i]!.z, slots[i]!.yaw, speed);
}
