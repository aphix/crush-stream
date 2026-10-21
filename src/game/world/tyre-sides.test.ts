import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { strike, strikeSink } from "./solid-parity.test-util.ts";
import { BARRIER_HALF, BARRIER_TOP } from "../contact/sat.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { SPRINGS } from "../vehicle/car-suspension.ts";
import { STEP_MAX } from "./surfaces.ts";

/**
 * Main, ruling (a) of the car overhaul: a tyre meets a solid's side faces, for every car. A monster stands on 1.23 m tyres with its
 * body's keel over the range's 0.81 m slab, so the slab never meets its body (`JerseyBarrier.over`) and only its tyres can: driven
 * square into it, it stops or climbs, no tyre stands in the slab deeper than its tyre and suspension give (`readTyreSides`' stroke), and
 * the body never pops up onto it (a tyre that only met floors read the slab's top as its ground and set the body 0.5 m up it in one
 * frame, on its way over at 29 m/s).
 */

/** Deepest a tyre may stand inside the slab (m): its stroke, and a centimetre of the slice that meets its end. */
const TYRE_IN = SPRINGS.monster.travel + 0.01;
/** Most the body may rise in a frame past what its own vertical speed carries it (m): a tyre mounting what it may (`STEP_MAX` over its hub), not a teleport. */
const POP = STEP_MAX;
const SPEEDS = [5, 15, 30];

const _hub = new THREE.Vector3();

/**
 * How deep (m) the deepest of `car`'s tyres stands inside the held slab (x in ±`BARRIER_HALF.x`, up to `BARRIER_TOP`, the car coming from
 * +x): each tyre's disc in the x-y plane against the slab's section, by the least of its depth past the struck face, past the far face
 * and below the top (its chord across the top where the hub is over it). Negative: no tyre is in it.
 */
function tyreIn(car: DeformableCar): number {
  let deepest = -Infinity;
  for (const wheel of car.wheels) {
    wheel.getWorldPosition(_hub);
    const r = car.frame.rig.tyre.r * wheel.scale.x;
    const over = _hub.y - BARRIER_TOP;
    if (over >= r || Math.abs(_hub.z) > BARRIER_HALF.z) continue;
    const reach = over > 0 ? Math.sqrt(r * r - over * over) : r;
    deepest = Math.max(deepest, Math.min(BARRIER_HALF.x - (_hub.x - reach), _hub.x + reach + BARRIER_HALF.x, BARRIER_TOP - (_hub.y - r)));
  }
  return deepest;
}

describe("given a monster driven square into the range's slab, its body's keel over the slab's top", () => {
  for (const speed of SPEEDS) {
    it(`when it meets the slab at ${speed} m/s, then its tyres meet the slab's face: it stops or climbs, no tyre stands more than ${TYRE_IN * 100} cm inside the slab, and the body never rises ${POP * 100} cm past its own climb in a frame`, () => {
      let deepest = -Infinity;
      let frame = -1;
      let pop = -Infinity;
      let y = 0;
      let vy = 0;
      strikeSink("barrier", "monster", speed, 0, (f, _sink, car) => {
        const d = tyreIn(car);
        if (d > deepest) {
          deepest = d;
          frame = f;
        }
        const p = car.group.position;
        if (f > 0) pop = Math.max(pop, p.y - y - Math.max(0, vy, car.velocity.y) / FRAME_HZ);
        y = p.y;
        vy = car.velocity.y;
      });
      assert.ok(deepest <= TYRE_IN, `${speed} m/s: a tyre stood ${(deepest * 100).toFixed(1)} cm inside the slab at frame ${frame}`);
      assert.ok(pop <= POP, `${speed} m/s: the body rose ${(pop * 100).toFixed(1)} cm past its own climb in a frame`);
    });
  }
});

/** How far apart (drivetrain health, 0 … 1) two hits of the same equivalent barrier speed may end: `solid-parity.test.ts`'s band for a solid's crush against the slab's. */
const HEALTH_BAND = 0.2;

/**
 * A tyre's side hit goes through the car's one crash path (`collectCrush` → `applyImpact`): the hub pops by the arch's own rule (`HUB_POP_MPS`
 * of equivalent barrier speed, once the struck corner has crushed onto the wheel), and the drivetrain takes the hit as it takes a body's front
 * hit of the same speed (`energyTravel`: the block travel is the hit's energy's, its running gear under the nose's crush).
 */
describe("given a monster whose tyres alone meet the range's slab", () => {
  it("when it meets the slab at 15 m/s, under the hit that pops a hub, then every wheel stays on and the drivetrain lives", () => {
    const [hit] = strike("barrier", "monster", 15);
    assert.ok(hit!.wheels === 4 && hit!.alive, JSON.stringify(hit));
  });

  it("when it meets the slab at 30 m/s, over the hit that pops a hub, then a wheel comes off", () => {
    const [hit] = strike("barrier", "monster", 30);
    assert.ok(hit!.wheels < 4, JSON.stringify(hit));
  });

  it(`when it meets the slab at 55 m/s, then its drivetrain ends within ${HEALTH_BAND} of where its body's own hit on a wall at 55 m/s leaves it, and the driver is thrown alike`, () => {
    const [tyre] = strike("barrier", "monster", 55);
    const [body] = strike("stucco", "monster", 55);
    assert.ok(Math.abs(tyre!.health - body!.health) <= HEALTH_BAND && tyre!.ejected === body!.ejected, `tyre hit ${JSON.stringify(tyre)} against the body hit ${JSON.stringify(body)}`);
  });
});
