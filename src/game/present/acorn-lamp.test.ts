import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { PREFABS } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import { PARK_LAMP } from "../world/openworld/openworld-park.ts";
import { LAMP_FROM_CURB, LAYOUT } from "../world/openworld/openworld-constants.ts";
import { ACORN_LAMP } from "../world/street-kit.ts";
import { plainMaterials } from "./prefab-materials.test-util.ts";
import { prefabParts } from "./prefabs.ts";

/** Slack (m) on a drawn extent: float rounding of the fitted vertices. */
const SLACK = 1e-5;
/** A lamp's arm hangs its head at least this far (m) off its post (0.13 m measured): the acorn lamp's globe stands over its post. */
const ARM_OFFSET = 0.1;

/** The prefab's parts: the pole in vertex colours, then the globe and the light pool on the scene's own shared lamp materials. */
function partsOf(id: typeof PREFAB.lamp | typeof PREFAB.acornLamp): { pole: THREE.BufferGeometry; globe: THREE.BufferGeometry; pool: THREE.BufferGeometry; shared: THREE.Material[] } {
  const parts = prefabParts(id, plainMaterials(new THREE.MeshBasicMaterial()));
  expect(parts.length, `${id}'s parts: pole, head, pool`).toBe(3);
  return { pole: parts[0]!.geometry, globe: parts[1]!.geometry, pool: parts[2]!.geometry, shared: [parts[1]!.material, parts[2]!.material] };
}

function boundsOf(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox();
  return geometry.boundingBox!;
}

/** Where a head's middle stands off its post along x (m): the arm of a lamp, whichever way the fit turns it. */
function offsetOf(geometry: THREE.BufferGeometry): number {
  const bounds = boundsOf(geometry);
  return (bounds.min.x + bounds.max.x) / 2;
}

describe("given the acorn lamp the open world stands on its streets and in its park", () => {
  stubBrowser();
  const acorn = partsOf(PREFAB.acornLamp);
  const arm = partsOf(PREFAB.lamp);

  it("when it is built, then it is a slim post under an acorn globe, ACORN_LAMP tall, with no arm", () => {
    const whole = boundsOf(acorn.pole).clone().union(boundsOf(acorn.globe));
    expect(whole.max.y, "its height (m)").toBeCloseTo(ACORN_LAMP.height, 5);
    expect(whole.min.y, "its foot (m)").toBeGreaterThanOrEqual(-SLACK);
    expect(Math.max(-whole.min.x, whole.max.x, -whole.min.z, whole.max.z), "its reach from the post (m)").toBeLessThanOrEqual(ACORN_LAMP.globeRadius + SLACK);
    expect(boundsOf(acorn.globe).min.y, "the globe hangs over the collar (m)").toBeGreaterThan(ACORN_LAMP.collarBottom);
    expect(Math.abs(offsetOf(acorn.globe)), "the acorn globe stands over its post (m)").toBeLessThan(SLACK);
    expect(Math.abs(offsetOf(arm.globe)), "the other courses' lamp keeps its arm: its head hangs off the post (m)").toBeGreaterThan(ARM_OFFSET);
  });

  it("when its light is read, then it is the lamp's own: the same lit head and pool materials, the pool under the post's middle", () => {
    expect(acorn.shared[0], "the lit head's material").toBe(arm.shared[0]);
    expect(acorn.shared[1], "the light pool's material").toBe(arm.shared[1]);
    const pool = boundsOf(acorn.pool);
    expect((pool.min.x + pool.max.x) / 2, "the pool's middle along x (m)").toBeCloseTo(0, 5);
    expect((pool.min.z + pool.max.z) / 2, "the pool's middle along z (m)").toBeCloseTo(0, 5);
  });

  /** Each triangle of `geometry`: its middle's x and y, its corners' least and greatest y, and its area on the ground (m²). */
  function triangles(geometry: THREE.BufferGeometry): { x: number; y0: number; y1: number; area: number }[] {
    const p = geometry.getAttribute("position");
    const index = geometry.index!.array;
    const out: { x: number; y0: number; y1: number; area: number }[] = [];
    for (let at = 0; at < index.length; at += 3) {
      const [a, b, c] = [index[at]!, index[at + 1]!, index[at + 2]!];
      const ys = [p.getY(a), p.getY(b), p.getY(c)];
      const area = Math.abs((p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a)) - (p.getX(c) - p.getX(a)) * (p.getZ(b) - p.getZ(a))) / 2;
      out.push({ x: (p.getX(a) + p.getX(b) + p.getX(c)) / 3, y0: Math.min(...ys), y1: Math.max(...ys), area });
    }
    return out;
  }

  it("when the pools are read, then the acorn lamp's lies on the slab's top over its sidewalk and on the ground over the road and the lot, whole, and a race lamp's stays on the ground", () => {
    const slabTop = PREFABS[PREFAB.sidewalk].size[1];
    const back = LAMP_FROM_CURB - LAYOUT.sidewalk;
    let onSlab = 0;
    let whole = 0;
    for (const t of triangles(acorn.pool)) {
      whole += t.area;
      if (t.area < SLACK) continue;
      if (t.x > back && t.x < LAMP_FROM_CURB) {
        onSlab += t.area;
        expect(t.y0, `over the sidewalk at x ${t.x.toFixed(2)}: on the slab`).toBeGreaterThan(slabTop);
      } else expect(t.y1, `over the ${t.x > 0 ? "road" : "lot"} at x ${t.x.toFixed(2)}: under a slab's height`).toBeLessThan(slabTop);
    }
    expect(onSlab, "the pool's area over the sidewalk (m²)").toBeCloseTo(LAYOUT.sidewalk * 9, 3);
    expect(whole, "the pool's whole area (m²)").toBeCloseTo(81, 3);
    expect(boundsOf(arm.pool).max.y, "the race lamp's pool under a slab's height").toBeLessThan(slabTop);
  });

  it("when the street pool is cut at the kerb and the lot, then every corner reads the light picture where the whole pool would: its uv the park lamp's uncut pool's at that point", () => {
    const park = prefabParts(PREFAB.acornLamp, plainMaterials(new THREE.MeshBasicMaterial()), PARK_LAMP)[2]!.geometry;
    const whole = park.getAttribute("position");
    const wholeUv = park.getAttribute("uv");
    const bounds = boundsOf(park);
    const uvAt = (x: number, z: number): [number, number] => {
      const corner = (cx: number, cz: number): number => [0, 1, 2, 3].find((at) => Math.abs(whole.getX(at) - cx) < SLACK && Math.abs(whole.getZ(at) - cz) < SLACK)!;
      const [a, b, c] = [corner(bounds.min.x, bounds.min.z), corner(bounds.max.x, bounds.min.z), corner(bounds.min.x, bounds.max.z)];
      const s = (x - bounds.min.x) / (bounds.max.x - bounds.min.x);
      const t = (z - bounds.min.z) / (bounds.max.z - bounds.min.z);
      return [0, 1].map((k) => wholeUv.getComponent(a, k) + (wholeUv.getComponent(b, k) - wholeUv.getComponent(a, k)) * s + (wholeUv.getComponent(c, k) - wholeUv.getComponent(a, k)) * t) as [number, number];
    };
    const p = acorn.pool.getAttribute("position");
    const uv = acorn.pool.getAttribute("uv");
    expect(p.count, "three bands of four corners").toBe(12);
    for (let at = 0; at < p.count; at++) {
      const [u, v] = uvAt(p.getX(at), p.getZ(at));
      expect(uv.getX(at), `corner ${at}'s u`).toBeCloseTo(u, 5);
      expect(uv.getY(at), `corner ${at}'s v`).toBeCloseTo(v, 5);
    }
  });

  it("when a race course's lamp is built, then its pool is the one uncut square it always was: four corners, two triangles, every corner at the pool's height over the ground, its uv the whole picture", () => {
    const fit = 4.4 / 5.2;
    const p = arm.pool.getAttribute("position");
    const uv = arm.pool.getAttribute("uv");
    expect(p.count, "corners").toBe(4);
    expect(arm.pool.index!.count / 3, "triangles").toBe(2);
    const bounds = boundsOf(arm.pool);
    expect(bounds.max.x - bounds.min.x, "its side along x (m)").toBeCloseTo(9 * fit, 5);
    expect(bounds.max.z - bounds.min.z, "its side along z (m)").toBeCloseTo(9 * fit, 5);
    const corners = new Set<string>();
    for (let at = 0; at < p.count; at++) {
      expect(p.getY(at), `corner ${at}'s height over the ground (m): makeLamp's 0.025 at the race fit`).toBeCloseTo(0.025 * fit, 6);
      expect([0, 1].includes(uv.getX(at)) && [0, 1].includes(uv.getY(at)), `corner ${at}'s uv ${uv.getX(at)}, ${uv.getY(at)}: a corner of the picture`).toBe(true);
      corners.add(`${uv.getX(at)},${uv.getY(at)}`);
    }
    expect(corners.size, "the picture's four corners, one each").toBe(4);
  });

  it("when a park's lamp is built, then it stands on the ground with no slab, so its pool lies under a slab's height, as a race lamp's does", () => {
    const park = prefabParts(PREFAB.acornLamp, plainMaterials(new THREE.MeshBasicMaterial()), PARK_LAMP);
    expect(boundsOf(park[2]!.geometry).max.y, "the park lamp's pool over its foot (m)").toBeLessThan(PREFABS[PREFAB.sidewalk].size[1]);
    expect(boundsOf(park[0]!.geometry).max.y, "its post as tall as a street's (m)").toBeCloseTo(boundsOf(acorn.pole).max.y, 5);
  });
});
