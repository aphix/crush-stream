import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { loadEpicenter } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { setGround, activeGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { makeEngine } from "./fleet-rest.test-util.ts";

/**
 * The owner's fleet capture on jitter seed 6 (`fleet-rest.test-util.ts`): the pickup's front bumper and front-left arch are torn and its nose crushed back, and while it still slides
 * (1.4 to 1.8 s, 0.2 to 0.7 m/s) the drawn body's front-left underside corner (a loft vertex at the arch's front leg, z 1.755 at rest) stands 21 to 47 mm in the ground.
 * Measured: the cage there skins 3 cm higher than the drawn mesh (the same rest vertex and tables, cage (-0.362, 0.270, 0.953) against drawn (-0.371, 0.239, 0.959)), and a
 * ground point sinks about 1.2 cm before it holds, so a cage ground point at that corner (tried: the drawn arch feet's corners as sill samples) leaves it at -44 mm.
 * Closing it takes the cage's crush skin following the drawn skin there, not more points.
 */
const SEED = 6;
const FROM_S = 1.4;
const TO_S = 3.5;
const PICKUP = 4;
/** How far (m) a wreck's drawn body may stand in the ground (`wreck-rest.test.ts`' bar). */
const IN_GROUND_M = 0.03;

let engine: CrashEngine | undefined;

describe("given the fleet capture on jitter seed 6, its pickup's nose crushed back and its front bumper and arch torn off", () => {
  after(() => {
    setGround(null);
    engine?.dispose();
  });
  it(
    "when the pickup slides on, then its drawn body never stands more than 3 cm in the ground",
    { todo: "after the plan: the cage's crush skin follows the drawn skin at the nose underside (3 cm apart), and a ground point holds without sinking 1.2 cm" },
    async () => {
      const fresh = (engine = await makeEngine());
      loadEpicenter(EPICENTER_AT_LOAD);
      fresh.setCarCount(5);
      fresh.setSpeedRange(10, 32);
      fresh.setSquash(0.32);
      fresh.setBuckle(0.45);
      fresh.setRealism(0.25);
      fresh["pinnedSeed"] = 12641919;
      fresh.reset();
      Object.assign(fresh.pace, { now: () => 0, pin: false });
      const pickup = fresh["live"]()[PICKUP]!;
      const body = pickup["body"] as THREE.Mesh;
      const point = new THREE.Vector3();
      let deepest = { depth: 0, sim: 0 };
      const original = fresh["slice"];
      Reflect.set(fresh, "slice", (h: number) => {
        original(h);
        const t = fresh["elapsedSim"];
        if (t < FROM_S || t > TO_S) return;
        pickup.group.updateMatrixWorld(true);
        const ground = activeGround();
        const positions = body.geometry.getAttribute("position");
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i).applyMatrix4(body.matrixWorld);
          const depth = ground.heightAt(point.x, point.z, point.y) - point.y;
          if (depth > deepest.depth) deepest = { depth, sim: t };
        }
      });
      let state = SEED >>> 0;
      const random = (): number => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
      try {
        while (fresh["elapsedSim"] < TO_S + 0.01) {
          const dt = (1 / FRAME_HZ) * (1 + 0.4 * (random() * 2 - 1));
          fresh.advance(dt, { frameDt: dt });
        }
      } finally {
        Reflect.set(fresh, "slice", original);
      }
      assert.ok(deepest.depth <= IN_GROUND_M, `${(deepest.depth * 1000).toFixed(0)} mm in the ground at sim ${deepest.sim.toFixed(2)} s`);
    },
  );
});
