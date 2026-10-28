import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { drawnLamp } from "./part-variants.ts";
import { type BodyStyle, CAR_STYLE_IDS, CAR_STYLES } from "./car-variants.ts";
import { lampEmissiveMap } from "./car-materials.ts";
import { headGlowOf } from "./lamp-glow.test-util.ts";

/** The lit share of a head lamp's drawn area the old-style hatchback shows is the yardstick: the slim sedan and wagon lamps lit only a DRL strip (under a tenth of theirs). */
const MIN_LIT_SHARE_OF_OLD_STYLE = 0.6;
/** How far (m) a head lamp's seat (where its glow and beam start) may lie from the centre of the lens a viewer from ahead sees lit: the hatchback's 30 mm is the widest of the cars that read right. */
const MAX_SEAT_TO_LIT_CENTRE = 0.035;

/** What the right head lamp of `style` lights, read off its drawn geometry (lamp space: the seat is the origin): the lit share of its triangle area, and the centre (x, y) of its lit area weighted by how squarely it faces ahead. */
function litLens(style: BodyStyle): { share: number; centreX: number; centreY: number } {
  const map = lampEmissiveMap().image.data as Float32Array;
  const geometry = drawnLamp(style, "head", 1).geometry;
  const [position, uv, index] = [geometry.getAttribute("position"), geometry.getAttribute("uv"), geometry.index!];
  const emits = (i: number): boolean => {
    const at = (Math.floor(uv.getY(i) * 2) * 2 + Math.floor(uv.getX(i) * 2)) * 4;
    return map[at]! + map[at + 1]! + map[at + 2]! > 0;
  };
  const [triangle, normal, middle] = [new THREE.Triangle(), new THREE.Vector3(), new THREE.Vector3()];
  let [lit, all, facing, x, y] = [0, 0, 0, 0, 0];
  for (let t = 0; t < index.count; t += 3) {
    const corners = [index.getX(t), index.getX(t + 1), index.getX(t + 2)] as const;
    triangle.setFromAttributeAndIndices(position, ...corners);
    all += triangle.getArea();
    if (!corners.every(emits)) continue;
    const weight = triangle.getArea() * Math.abs(triangle.getNormal(normal).z);
    triangle.getMidpoint(middle);
    lit += triangle.getArea();
    facing += weight;
    x += middle.x * weight;
    y += middle.y * weight;
  }
  return { share: lit / all, centreX: x / facing, centreY: y / facing };
}

describe("given the slim modern head lamps (the sedan's and the wagon's) beside the old-style hatchback's", () => {
  const slimStyles = ["sedan", "wagon"] as const;

  for (const id of slimStyles) {
    it(`when the ${id}'s head lens is drawn, then its lit lens covers at least ${MIN_LIT_SHARE_OF_OLD_STYLE} of the hatchback's share of its lamp, not a DRL strip alone`, () => {
      const [slim, old] = [litLens(CAR_STYLES[id]).share, litLens(CAR_STYLES.hatchback).share];
      assert.ok(slim >= MIN_LIT_SHARE_OF_OLD_STYLE * old, `${id} lit share ${slim.toFixed(3)}, hatchback ${old.toFixed(3)}`);
    });

    it(`when the pool lights the ${id} at night, then its head glow is as bright as the hatchback's at the same view (the bulbs tint it, so the three channels are summed)`, () => {
      const brightness = (rgb: ArrayLike<number>): number => rgb[0]! + rgb[1]! + rgb[2]!;
      const [slim, old] = [brightness(headGlowOf(CAR_STYLES[id]).rgb), brightness(headGlowOf(CAR_STYLES.hatchback).rgb)];
      assert.ok(slim >= 0.9 * old, `${id} head L glow ${slim.toFixed(3)}, hatchback ${old.toFixed(3)}`);
    });
  }
});

describe("given every style's head lamp, whose seat is where its glow sprite and its beam start", () => {
  for (const id of CAR_STYLE_IDS) {
    it(`when the ${id}'s lens is drawn, then its seat lies within ${MAX_SEAT_TO_LIT_CENTRE * 1000} mm of the centre of the lens lit as seen from ahead`, () => {
      const { centreX, centreY } = litLens(CAR_STYLES[id]);
      const off = Math.hypot(centreX, centreY);
      assert.ok(off <= MAX_SEAT_TO_LIT_CENTRE, `${id} seat is ${(off * 1000).toFixed(0)} mm from the lit centre (x ${(centreX * 1000).toFixed(0)}, y ${(centreY * 1000).toFixed(0)} mm)`);
    });
  }
});
