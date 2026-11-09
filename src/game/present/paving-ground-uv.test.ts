import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { must } from "../kernel/must.test-util.ts";
import { PAVING, PREFAB } from "../world/constants.ts";
import { OPENWORLD_ID } from "../world/openworld/openworld-constants.ts";
import { placeCourse } from "../world/placements.ts";
import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import { OFF_MENU } from "../world/tracks/index.ts";
import { WorldStage } from "./engine-world.ts";
import { layBrick, pavingVertex } from "./ground-relief.ts";
import { makePrefabMaterials, raceTextures } from "./prefabs.ts";
import { TrackArt } from "./track-art.ts";

/** A slab's length (m): one paving flag square, the ground metres to one unit of the paving's uv. */
const SLAB_LENGTH = "3.20";

describe("given the sidewalk slabs' paving, which overlapping slabs (a bend's neighbours, two streets' strips at a block corner) draw over one point", () => {
  // mutation: sed -i 's/return vertexShader.replace("#include <uv_vertex>", PAVING_UV_VERTEX);/return vertexShader;/' src/game/present/ground-relief.ts
  it("when its vertex shader is built, then a slab's top takes its colour and relief uv from the ground point under it, after the slab's own uv", () => {
    const built = pavingVertex(THREE.ShaderLib.standard.vertexShader);
    const stock = built.indexOf("#include <uv_vertex>");
    const ground = built.indexOf(`vec2 pavingUv = vPavingGround / ${SLAB_LENGTH};`);
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

describe("given the sidewalk slabs of a course laid in brick", () => {
  // mutation: sed -i 's/  material.defines = { ...material.defines, PAVING_BRICK: "" };//' src/game/present/ground-relief.ts
  it("when the paving material is laid in brick, then its program carries the brick and its shader makes a running bond of bricks and joints on the ground, fading to their mean where they are finer than a pixel", () => {
    stubBrowser();
    const paving = makePrefabMaterials(raceTextures()).paving;
    must(paving instanceof THREE.MeshStandardMaterial, "a standard material");
    expect(paving.defines?.PAVING_BRICK, "concrete flags until laid in brick").toBeUndefined();
    layBrick(paving);
    expect(paving.defines?.PAVING_BRICK, "the brick define").toBe("");
    const { vertexShader, fragmentShader } = THREE.ShaderLib.standard;
    const shader = { uniforms: {}, vertexShader, fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
    paving.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    const brick = shader.fragmentShader.indexOf("#ifdef PAVING_BRICK");
    expect(brick, "the bond is behind the define").toBeGreaterThan(shader.fragmentShader.indexOf("#include <color_fragment>"));
    for (const line of ["bond.x += 0.5 * floor( bond.y );", "float joint = 1.0 - step(", "vec2 spread = fwidth( bond );", "diffuseColor.rgb = mix( mix( brickColour,"]) expect(shader.fragmentShader.indexOf(line), line).toBeGreaterThan(brick);
    expect(shader.vertexShader, "the ground point reaches the fragment").toContain("vPavingGround = ( modelMatrix * pavingPoint ).xz;");
  });

  // mutation: sed -i 's/, roadDecals: \[\], paving: PAVING.brick }/, roadDecals: [] }/' src/game/world/openworld/openworld-course.ts
  it("when the open world's art is built, then its sidewalk slabs are drawn in a material laid in brick", () => {
    stubBrowser();
    const track = new Track(OFF_MENU.find((json) => parseTrack(json).id === OPENWORLD_ID)!);
    expect(track.json.scenery?.paving, "the course's paving").toBe(PAVING.brick);
    const course = placeCourse(track);
    const art = new TrackArt(track, course.placed, new WorldStage(new THREE.Scene()), course.drawn);
    const slabs: THREE.Mesh[] = [];
    art.group.traverse((object) => {
      if (object instanceof THREE.Mesh && object.userData.race?.prefab === PREFAB.sidewalk) slabs.push(object);
    });
    expect(slabs.length, "slab meshes").toBeGreaterThan(0);
    for (const slab of slabs) expect((slab.material as THREE.MeshStandardMaterial).defines?.PAVING_BRICK, "brick laid").toBe("");
    art.dispose();
  });
});
