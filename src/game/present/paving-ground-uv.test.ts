import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { pavingVertex } from "./ground-relief.ts";
import { makePrefabMaterials, raceTextures } from "./prefabs.ts";

/** A slab's length (m): one paving flag square, the ground metres to one unit of the paving's uv. */
const SLAB_LENGTH = "3.20";

describe("given the sidewalk slabs' paving, which overlapping slabs (a bend's neighbours, two streets' strips at a block corner) draw over one point", () => {
  // mutation: sed -i 's/return vertexShader.replace("#include <uv_vertex>", PAVING_UV_VERTEX);/return vertexShader;/' src/game/present/ground-relief.ts
  it("when its vertex shader is built, then a slab's top takes its colour and relief uv from the ground point under it, after the slab's own uv", () => {
    const built = pavingVertex(THREE.ShaderLib.standard.vertexShader);
    const stock = built.indexOf("#include <uv_vertex>");
    const ground = built.indexOf(`vec2 pavingUv = ( modelMatrix * pavingPoint ).xz / ${SLAB_LENGTH};`);
    expect(stock, "the slab's own uv is computed first").toBeGreaterThan(-1);
    expect(ground, "the ground point's uv, a slab's length to the unit").toBeGreaterThan(stock);
    expect(built.indexOf("pavingPoint = instanceMatrix * pavingPoint;"), "each slab placed by its instance matrix").toBeGreaterThan(stock);
    expect(built.indexOf("vMapUv = ( mapTransform * vec3( pavingUv, 1 ) ).xy;"), "the colour map's uv is the ground's").toBeGreaterThan(ground);
    expect(built.indexOf("vNormalMapUv = ( normalMapTransform * vec3( pavingUv, 1 ) ).xy;"), "the relief's uv is the ground's").toBeGreaterThan(ground);
  });

  // mutation: sed -i 's/  material.customProgramCacheKey = () => `${key.call(material)}|paving`;//' src/game/present/ground-relief.ts
  it("when the slabs' material is made, then its program is the paving's, keyed apart from the plain concrete's", () => {
    stubBrowser();
    const materials = makePrefabMaterials(raceTextures());
    expect(materials.paving.customProgramCacheKey(), "the paving's program key").toContain("|paving");
    expect(materials.concrete.customProgramCacheKey(), "the plain concrete's program key").not.toContain("|paving");
  });
});
