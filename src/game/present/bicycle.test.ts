import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { must } from "../kernel/must.test-util.ts";
import { PREFAB } from "../world/constants.ts";
import { plainMaterials } from "./prefab-materials.test-util.ts";
import { prefabParts } from "./prefabs.ts";

import { detCos, detSin } from "../kernel/physics-core.js";
/** The bicycle's frame in the rack's frame (m), as the test reads it from the drawing's plan: the middle plane, the axles' height and their distance from the middle. */
const LANE = 0.1;
const AXLE_HEIGHT = 0.34;
const AXLE_OFFSET = 0.52;
/** A ray starts this far (m) from the bicycle. */
const RAY_START = 2;
/** A tube's hit lies within this (m) of its middle plane's side: the thickest rod's radius and a little. */
const TUBE_REACH = 0.05;
/** The wheel's probes: this far (m) from the axle, inside the tyre's ring, where a disc would be and a ring is not. */
const PROBE_RADIUS = 0.18;
/** The spokes' circle in the texture: its radius (a share of the texture's), and the rim and hub's. */
const SPOKE_CIRCLE = 0.5;
const HUB_SAMPLE = 0.05;
const RIM_SAMPLE = 0.95;
const CIRCLE_SAMPLES = 720;
/** The bicycle's wheels carry this many spokes each in the texture. */
const SPOKES_EACH_WHEEL = 18;
const OPAQUE = 128;

const parts = prefabParts(PREFAB.bikeRack, plainMaterials(new THREE.MeshBasicMaterial()));
const shape = new THREE.Mesh(parts[0]!.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
shape.updateMatrixWorld(true);
const caster = new THREE.Raycaster();

/** The first hit of the shape by a ray from `from` along `along` (unit), or null. */
function firstHit(from: THREE.Vector3, along: THREE.Vector3): THREE.Vector3 | null {
  caster.set(from, along);
  return caster.intersectObject(shape, false)[0]?.point ?? null;
}

/** A ray along -x at height `y`, depth `z`, from the street side. */
const acrossX = (y: number, z: number): THREE.Vector3 | null => firstHit(new THREE.Vector3(RAY_START, y, z), new THREE.Vector3(-1, 0, 0));
/** A ray straight down at `x`, `z`. */
const downAt = (x: number, z: number): THREE.Vector3 | null => firstHit(new THREE.Vector3(x, RAY_START, z), new THREE.Vector3(0, -1, 0));
/** A ray straight up at `x`, `z`, from under the ground. */
const upAt = (x: number, z: number): THREE.Vector3 | null => firstHit(new THREE.Vector3(x, -RAY_START, z), new THREE.Vector3(0, 1, 0));

describe("given the bicycle locked to the street's bike rack", () => {
  // mutation: sed -i 's/tyreRadius: 0.31, tyreTube: 0.022/tyreRadius: 0.31, tyreTube: 0.3/' src/game/present/bicycle.ts
  it("when its wheels are probed inside their tyres, then nothing fills them (a ring, not a disc), and the tyres themselves are there", () => {
    for (const z of [-AXLE_OFFSET, AXLE_OFFSET]) {
      for (const degrees of [-90, -45, 45, 180]) {
        const turn = (degrees * Math.PI) / 180;
        const hit = acrossX(AXLE_HEIGHT + PROBE_RADIUS * detSin(turn), z + PROBE_RADIUS * detCos(turn));
        expect(hit, `a hit inside the wheel at z ${z}, ${degrees} degrees round the axle`).toBeNull();
      }
      const tyre = acrossX(AXLE_HEIGHT + 0.31, z);
      expect(tyre?.x, `the tyre's top at z ${z} (x)`).toBeGreaterThan(LANE - TUBE_REACH);
      expect(tyre?.x, `the tyre's top at z ${z} (x)`).toBeLessThan(LANE + TUBE_REACH);
    }
  });

  // mutation: sed -i '/name: "top tube"/d' src/game/present/bicycle.ts
  // mutation: sed -i '/name: "down tube"/d' src/game/present/bicycle.ts
  // mutation: sed -i '/name: "seat tube"/d' src/game/present/bicycle.ts
  it("when its frame is probed, then the diamond is there: top tube, down tube, seat tube, stays, fork, head tube, bars and seat post", () => {
    const probes: { name: string; hit: THREE.Vector3 | null; x: number }[] = [
      { name: "top tube", hit: downAt(LANE, 0.015), x: LANE },
      { name: "down tube", hit: acrossX(0.475, 0.105), x: LANE },
      { name: "seat tube", hit: acrossX(0.54, -0.175), x: LANE },
      { name: "chain stay", hit: upAt(LANE + 0.045, -0.31), x: LANE + 0.045 },
      { name: "seat stay", hit: acrossX(0.565, -0.385), x: LANE + 0.03 },
      { name: "fork", hit: acrossX(0.5, 0.415), x: LANE + 0.04 },
      { name: "head tube", hit: acrossX(0.725, 0.295), x: LANE },
      { name: "handlebar", hit: downAt(LANE, 0.31), x: LANE },
      { name: "seat post", hit: acrossX(0.825, -0.26), x: LANE },
    ];
    for (const probe of probes) {
      must(probe.hit, `the ${probe.name} was hit`);
      expect(Math.abs(probe.hit.x - probe.x), `the ${probe.name}'s hit is on its own plane (m)`).toBeLessThan(TUBE_REACH);
    }
  });

  // mutation: sed -i 's/const SPOKES = 18;/const SPOKES = 6;/' src/game/present/bicycle.ts
  // mutation: sed -i 's/alphaTest: ALPHA_CUTOFF, //' src/game/present/bicycle.ts
  // mutation: sed -i 's/ side: THREE.DoubleSide,//' src/game/present/bicycle.ts
  it("when its spokes are read, then each wheel is a sprite quad on an alpha-cut double-sided material whose texture has a hub, a rim and the spokes between", () => {
    expect(parts.length, "the shape and the spokes").toBe(2);
    const sprite = parts[1]!;
    const material = sprite.material;
    must(material instanceof THREE.MeshStandardMaterial, "a standard material");
    expect(material.alphaTest, "the alpha cut").toBeGreaterThan(0);
    expect(material.side, "both faces").toBe(THREE.DoubleSide);
    expect(sprite.shadow, "no depth shadow of a whole rectangle").toBe(false);
    expect(sprite.geometry.getAttribute("position").count, "two quads, one a wheel").toBe(8);
    sprite.geometry.computeBoundingBox();
    const bounds = sprite.geometry.boundingBox!;
    expect((bounds.max.z - bounds.min.z) / 2, "the quads reach both wheels' far edges (m)").toBeCloseTo(AXLE_OFFSET + 0.31 - 0.011, 5);
    expect(bounds.max.y - AXLE_HEIGHT, "a quad's half height is the tyre's inner edge (m)").toBeCloseTo(0.31 - 0.011, 5);
    const image = material.map!.image as { data: Uint8Array; width: number };
    const alphaAt = (x: number, y: number): number => image.data[(Math.floor(image.width / 2 + (y * image.width) / 2) * image.width + Math.floor(image.width / 2 + (x * image.width) / 2)) * 4 + 3]!;
    expect(alphaAt(0, 0), "the hub").toBe(255);
    expect(alphaAt(RIM_SAMPLE, 0), "the rim").toBe(255);
    expect(alphaAt(HUB_SAMPLE, 0), "the hub, near its edge").toBe(255);
    let runs = 0;
    let wasOpaque = alphaAt(SPOKE_CIRCLE, 0) >= OPAQUE;
    for (let step = 1; step <= CIRCLE_SAMPLES; step++) {
      const turn = (step * 2 * Math.PI) / CIRCLE_SAMPLES;
      const opaque = alphaAt(SPOKE_CIRCLE * detCos(turn), SPOKE_CIRCLE * detSin(turn)) >= OPAQUE;
      if (opaque && !wasOpaque) runs++;
      wasOpaque = opaque;
    }
    expect(runs, "spokes round a circle half way out").toBe(SPOKES_EACH_WHEEL);
  });
});
