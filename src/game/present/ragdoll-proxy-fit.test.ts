import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import type { RayColliderHit } from "@dimforge/rapier3d-simd";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { BODIES, carInState, drawnField, gapsOver, STATES, TOP_P95_M, TOP_PARTS, TOP_WORST_M, topGapsOff, topParts } from "../vehicle/drawn-body.test-util.ts";
import { RagdollSystem } from "./engine-ragdoll.ts";
import { BOX_FLOATS } from "./ragdoll-proxy.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

/**
 * docs/UNIFIED_CONTACT.md stage 3: the dummies' world sees each car as its drawn body (its proxies "fed from the cage"). A
 * dummy lies 3 m from the car so that the car's proxies are in the world; a ray fired down at the world point of each drawn
 * top cell meets the car's colliding proxies (the lower box and the glass slabs) at some height, held against the drawn top
 * with the same tolerance as the surface other cars stand on. The collider audit (local://collider-audit.md rows 14, 15, 20,
 * 21): the lower box top 0.85 m stood 0.34-0.59 m over the hood and deck and 0.5 m under a deck of a pickup; the cabin box
 * did not follow the crushed roof.
 */
const FRAME = 1 / FRAME_HZ;
const RAY_FROM_M = 3;
const RAY_LENGTH_M = 8;

/**
 * Rows whose cabin the proxy cannot hold within the bars because the cage cannot: the proxy's roof leaf follows the cage's top to
 * 0.5 cm (cabin p95 0.056 m on 42 of 340 cells, the three rows at z 0.38-0.48 over the windshield's foot), and the drawn
 * interior (its headliner stands 1.09 m over the origin and does not follow the roof mass) pokes up through the roof the drop
 * crushed (flat 1.170 m drawn against the cage's 1.112-1.118 m there): the cause `car-top-fit.test.ts` names for the cage's own
 * rolled cabin rows (p95 0.062-0.064).
 */
const interiorThroughRoof =
  "cabin p95 0.06 m against the 0.05 m bar on the pickup and monster rolled rows: the proxy's roof leaf is within 0.5 cm of the cage's top, which is 5.6 cm under the drawn headliner (standing 1.09 m over the origin, it does not follow the roof mass and pokes up through the roof the drop crushed) on the three rows over the windshield's foot; after the plan: make the drawn interior follow the roof's crush";

/**
 * Rows whose hood the proxy cannot hold since the cage keeps the crushed nose (its nose cap never collapses, `car-cage.ts`): the
 * cage's top now reaches the two rows of the crushed nose's front (z 1.70-1.75 on the sedan, 0.50 and 0.47 m against the hood's
 * 0.60), which lie in the rim and 0.098 m under their neighbour, under `CLIFF`, so they are the edge rolling away; a cut never splits
 * rim rows off a leaf with an inside (`ProxyFitter.cut`), and the leaf over z 1.65-1.75 stands 6.6 cm over the drawn nose face.
 */
const noseFaceUnderLeaf =
  "hood p95 0.06 m against the 0.05 m bar on the wagon and pickup head-on rows (the sedan's reads 0.036 and is a plain row): the cage reaches the crushed nose's front rows (0.10 m under the hood in one node, under CLIFF, in the rim), which no cut splits off a leaf with an inside, so the leaf over them stands 6.6 cm over the drawn nose face; after the plan (Stage 5): the proxy fitter takes the crushed nose's front as a surface of its own";

/** The pickup's airborne deck row (25°): the fitter's one leaf over the bed floor and the cab's rear wall, a cut or leaf budget, not the cage. */
const bedFrontLeaf =
  "CarRig: a dummy-proxy leaf spans the bed floor (0.80) and the cab's rear wall at the bed front, airborne 25°: deck worst +0.12 m at (0.43, -1.08..-1.18), up .072 before the door/C-post step; the fitter's cut or leaf budget, not the door data";
const todoCause: Record<string, string> = { cabin: interiorThroughRoof, hood: noseFaceUnderLeaf };

const proxyCases = BODIES.flatMap((b) =>
  STATES.map((s) => ({
    it: `when a ray from above meets the car's collision shapes in the dummies' world over its hood, cabin and deck, then it meets them within ${TOP_P95_M * 100} cm of the drawn top (95th percentile) and ${TOP_WORST_M * 100} cm at worst, and over the drawn part`,
    body: b.body,
    style: b.style,
    cls: b.cls,
    state: s.id,
    stateText: s.text,
    /** The parts of this row held to the bars as a todo (`todoCause`, or the row's own `todoCauses`), the others as plain tests. */
    todoParts: [
      ...(s.id === "rolled" && (b.style === "pickup" || b.style === "monster") ? ["cabin"] : s.id === "headon" && b.cls !== "monster" && b.style !== "sedan" ? ["hood"] : []),
      ...(s.id === "airborne" && b.style === "pickup" ? ["deck"] : []),
    ],
    todoCauses: {
      ...(b.style === "pickup" && s.id === "airborne" ? { deck: bedFrontLeaf } : {}),
    } as Partial<Record<string, string>>,
  })),
);

type ProxyCase = (typeof proxyCases)[number];

/** The bars each part of the car's top is off by, as `topGapsOff` words them: the ray fired down at every drawn top cell of the part, against the proxies in the dummies' world. */
async function proxyGaps(t: TestContext, testCase: ProxyCase): Promise<Record<string, string[]>> {
  const car = carInState(testCase.state, testCase.style, testCase.cls);
  const field = drawnField(car);
  const ragdolls = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
  await ragdolls.preload();
  ragdolls.update(FRAME, [], true, true, null);
  ragdolls["spawn"]({ car: 3, p: new THREE.Vector3(3, 1.2, 0), q: new THREE.Quaternion(), v: new THREE.Vector3(), w: new THREE.Vector3(), age: 0, cop: false, rides: true });
  for (let f = 0; f < 3; f++) ragdolls.update(FRAME, [car], true, true, null);
  // The world holds only the leaves and slabs a dummy is near (`cull`); the fit is held over the whole car, in the world after one step (the rays read its scene queries).
  ragdolls["proxies"].cull(0, [], true, FRAME);
  ragdolls["world"]!.step();
  const world = ragdolls["world"]!;
  const R = ragdolls["R"]!;
  const body = ragdolls["proxies"].carBodies[0]!;
  const down = { x: 0, y: -1, z: 0 };
  const off: Record<string, string[]> = {};
  let hit: RayColliderHit | null = null;
  for (const [part, region] of Object.entries(topParts(testCase.style))) {
    const g = gapsOver(
      car,
      field,
      region,
      (x, y, z) => {
        hit = world.castRay(new R.Ray({ x, y: y + RAY_FROM_M, z }, down), RAY_LENGTH_M, true, undefined, undefined, undefined, undefined, (c) => c.parent() === body && c.collisionGroups() !== 0);
        return hit === null ? NaN : y + RAY_FROM_M - hit.timeOfImpact;
      },
      () => {
        if (hit === null) return "";
        const shape = hit.collider.shapeType();
        return String(R.ShapeType[shape] ?? shape);
      },
    );
    t.diagnostic(`${part}: cells ${g.cells} p95 ${g.p95.toFixed(3)} up ${g.worstUp.toFixed(3)} down ${g.worstDown.toFixed(3)} missing ${g.missing}`);
    off[part] = topGapsOff(part, g);
  }
  return off;
}

for (const testCase of proxyCases) {
  describe(`given a dummy lying 3 m from a ${testCase.body} body ${testCase.stateText}`, () => {
    it(testCase.it, async (t) => {
      const off = await proxyGaps(t, testCase);
      assert.deepEqual(
        Object.entries(off).flatMap(([part, wrong]) => (testCase.todoParts.includes(part) ? [] : wrong)),
        [],
      );
    });
    for (const part of testCase.todoParts) {
      it(`${testCase.it}, over its ${part}`, { todo: testCase.todoCauses[part] ?? todoCause[part] }, async (t) => {
        assert.deepEqual((await proxyGaps(t, testCase))[part], []);
      });
    }
  });
}

/**
 * The hood's and deck's regions (`TOP_PARTS`): on a truck, its hood and its open bed, where the proxy stands columns from under the
 * ground, never a cabin's roof slab (a car's deck region reaches under its rear glass and, on the wagon, its roof).
 */
const LOW_PARTS = [TOP_PARTS.hood, TOP_PARTS.deck] as const;

for (const b of BODIES.filter((body) => body.style === "pickup" || body.style === "monster")) {
  describe(`given a dummy lying 3 m from a ${b.body} body untouched`, () => {
    it("when its proxy's leaves are read, then each one over its hood and bed is a column from under the ground, none a roof slab hung over them", async () => {
      const car = carInState("untouched", b.style, b.cls);
      const ragdolls = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
      await ragdolls.preload();
      ragdolls.update(FRAME, [], true, true, null);
      ragdolls["spawn"]({ car: 3, p: new THREE.Vector3(3, 1.2, 0), q: new THREE.Quaternion(), v: new THREE.Vector3(), w: new THREE.Vector3(), age: 0, cop: false, rides: true });
      for (let f = 0; f < 3; f++) ragdolls.update(FRAME, [car], true, true, null);
      const proxies = ragdolls["proxies"];
      const fits = proxies["leafFits"];
      const slabs: string[] = [];
      // A leaf's floats: its centre (x, y, z), half sizes, turn; the first is the lower box under the cabin.
      for (let k = 1; k < proxies["shapeN"][0]!; k++) {
        const o = k * BOX_FLOATS;
        const [x, y, z, hy] = [fits[o]!, fits[o + 1]!, fits[o + 2]!, fits[o + 4]!];
        if (!LOW_PARTS.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1)) continue;
        if (y - hy > 0) slabs.push(`leaf at x ${x.toFixed(2)} z ${z.toFixed(2)}: ${(y - hy).toFixed(2)}-${(y + hy).toFixed(2)} m`);
      }
      assert.deepEqual(slabs, []);
    });
  });
}

describe("given a dummy lying 3 m from a sedan whose cage refits every frame", () => {
  it("when its proxy's leaves are resized 50 times, then each takes its fitted size and no Rapier RawVector is left for the finalizer to free", async () => {
    const car = carInState("untouched", "sedan", "sedan");
    const ragdolls = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
    await ragdolls.preload();
    ragdolls.update(FRAME, [], true, true, null);
    ragdolls["spawn"]({ car: 3, p: new THREE.Vector3(3, 1.2, 0), q: new THREE.Quaternion(), v: new THREE.Vector3(), w: new THREE.Vector3(), age: 0, cop: false, rides: true });
    for (let f = 0; f < 3; f++) ragdolls.update(FRAME, [car], true, true, null);
    const proxies = ragdolls["proxies"];
    proxies.cull(0, [], true, FRAME);
    // A wasm-bindgen object freed by hand unregisters itself; one left to the finalizer stays registered.
    const pending = new Set<object>();
    const proto = FinalizationRegistry.prototype;
    const { register, unregister } = proto;
    proto.register = function (this: FinalizationRegistry<unknown>, target: object, held: unknown, token?: object) {
      if (target.constructor.name === "RawVector") pending.add(target);
      return register.call(this, target, held, token);
    };
    proto.unregister = function (this: FinalizationRegistry<unknown>, token: object) {
      pending.delete(token);
      return unregister.call(this, token);
    };
    try {
      for (let k = 0; k < 50; k++) {
        proxies["serial"][0] = -1;
        proxies.fitProxy(0, car);
      }
    } finally {
      proto.register = register;
      proto.unregister = unregister;
    }
    const shapes = proxies["shapes"];
    const fits = proxies["leafFits"];
    let resized = 0;
    for (let k = 0; k < proxies["shapeN"][0]!; k++) {
      const c = shapes[k];
      if (!c) continue;
      const h = c.halfExtents();
      const o = k * BOX_FLOATS;
      assert.equal(h.x, Math.fround(fits[o + 3]!));
      assert.equal(h.y, Math.fround(fits[o + 4]!));
      assert.equal(h.z, Math.fround(fits[o + 5]!));
      resized++;
    }
    assert.ok(resized > 0);
    assert.equal(pending.size, 0);
  });
});
