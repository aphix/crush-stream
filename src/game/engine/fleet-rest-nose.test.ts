import { afterAll, describe, expect } from "vitest";
import { todoRow } from "../kernel/todo-row.test-util.ts";
import * as THREE from "three";
import { setGround, activeGround } from "../world/ground.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import type { CrashEngine } from "./engine.ts";
import { makeEngine, replay } from "./fleet-rest.test-util.ts";

/**
 * The owner's fleet capture on jitter seed 6 (`fleet-rest.test-util.ts`): the pickup's front bumper and front-left arch are torn and its nose crushed back, and while it still slides
 * (1.4 to 1.8 s, 0.2 to 0.7 m/s) the drawn body's front-left underside corner (a loft vertex at the arch's front leg, z 1.755 at rest) stands 21 to 47 mm in the ground.
 * Measured: the cage there skins 3 cm higher than the drawn mesh (the same rest vertex and tables, cage (-0.362, 0.270, 0.953) against drawn (-0.371, 0.239, 0.959)), and a
 * ground point sinks about 1.2 cm before it holds, so a cage ground point at that corner (tried: the drawn arch feet's corners as sill samples) leaves it at -44 mm.
 * Closing it takes the cage's crush skin following the drawn skin there, not more points.
 */
const SEED = 6;
const PICKUP = 4;
/** How far (m) a wreck's drawn body may stand in the ground (`wreck-rest.test.ts`' bar). */
const IN_GROUND_M = 0.03;

let engine: CrashEngine | undefined;

describe("given the fleet capture on jitter seed 6, its pickup's nose crushed back and its front bumper and arch torn off", () => {
  afterAll(() => {
    setGround(null);
    engine?.dispose();
  });
  todoRow(
    "when the pickup slides on, then its drawn body never stands more than 3 cm in the ground", "after the plan: the cage's crush skin follows the drawn skin at the nose underside (3 cm apart), and a ground point holds without sinking 1.2 cm",
    async () => {
      const fresh = (engine = await makeEngine());
      const point = new THREE.Vector3();
      let deepest = { depth: 0, sim: 0 };
      let pickup: DeformableCar | undefined;
      await replay(fresh, SEED, (t) => {
        // The replay's reset makes the fleet: the pickup and its body as they stood after it.
        pickup ??= fresh["live"]()[PICKUP]!;
        const body = pickup["body"] as THREE.Mesh;
        pickup.group.updateMatrixWorld(true);
        const ground = activeGround();
        const positions = body.geometry.getAttribute("position");
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i).applyMatrix4(body.matrixWorld);
          const depth = ground.heightAt(point.x, point.z, point.y) - point.y;
          if (depth > deepest.depth) deepest = { depth, sim: t };
        }
      });
      expect(deepest.depth, `${(deepest.depth * 1000).toFixed(0)} mm in the ground at sim ${deepest.sim.toFixed(2)} s`).toBeLessThanOrEqual(IN_GROUND_M);
    },
  );
});
