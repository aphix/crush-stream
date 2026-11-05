import * as THREE from "three";
import { EPICENTER, epicenterValues, loadEpicenter } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import { layOnGround } from "../vehicle/car-air-points.ts";
import { FREEWHEEL, launch, makeCar, makeWorld, Probe, run } from "./crash-scenarios.test-util.ts";

/** How far (m, plan, world) the staged far hub is planted off its pin, and the near one: a spinning wreck's hubs stand up to 1.5 m off (derby seed 7, 13.2 s); a quiet one's 2 cm. */
export const FAR = 1;
export const NEAR = 0.1;

/**
 * The slice a freeze starts in, staged: a wreck frozen by the epicenter (as `wreck()` in epicenter-thaw.test.ts, 1.5 s after a wall hit) put back to `frozen && !frozenReady`, with one hub planted
 * `FAR` and another `NEAR` off where the world holds them, then one `Car.integrate` slice (the whole-path `integrateWreck` that caches it). Returns how far (m, in the car frame, plan) each hub's `local`
 * stands from its pin (`local` before the slice), and whether the slice cached the freeze: the far hub's pin must be kept (`jump` 0), the near one re-derived from its world place (`jump` about `NEAR`).
 */
export function freezeStartJumps(): { far: number; near: number; ready: boolean } {
  const saved = epicenterValues();
  try {
    loadEpicenter(EPICENTER_AT_LOAD);
    EPICENTER.on = 1;
    const car = makeCar("shape");
    launch(car, 6.2, 0, -Math.PI / 2, -50 / 3.6, 0);
    layOnGround(car);
    const w = makeWorld([car], true, false, FREEWHEEL);
    run(w, [new Probe(car, car.velocity)], 1.5);
    const d = car.deform;
    if (!d.frozen) throw new Error("the wreck did not freeze");
    d.frozenReady = false;
    car.wake();
    const [far, near] = d.masses.filter((m) => m.hub && !m.popped);
    far!.world.x += FAR;
    near!.world.x += NEAR;
    const pins = [far!, near!].map((m) => new THREE.Vector2(m.local.x, m.local.z));
    car.integrate(1 / FINE_HZ);
    const jump = (i: number): number => Math.hypot([far!, near!][i]!.local.x - pins[i]!.x, [far!, near!][i]!.local.z - pins[i]!.y);
    return { far: jump(0), near: jump(1), ready: d.frozenReady };
  } finally {
    loadEpicenter(saved);
  }
}
