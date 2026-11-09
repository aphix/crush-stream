import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { MAT } from "../kernel/material-ids.ts";
import { TIME_OF_DAY } from "../match/types.ts";
import { MARBLE, PREFABS } from "../world/catalog.ts";
import { PREFAB, ROOFLINE, TRACK_ID } from "../world/constants.ts";
import { isOpenStyle, shopGroundOf } from "../world/openworld/facade-windows.ts";
import { BLOCK_HEIGHT, buildingHeight, CORNICE_DEPTH, DEFAULT_STOREYS } from "../world/openworld/interior-kinds.ts";
import { placeCourse } from "../world/placements.ts";
import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { WorldStage } from "./engine-world.ts";
import { FACADE, FACADE_GLOW, FACADE_LAYERS, FACADE_DARK_AT, FACADE_DARK_MAX, FACADE_OPEN_AT, FACADE_OPEN_MAX, FACADE_OPEN_SLOT_FLOATS, facadeOpenLoop, setDarkFacades, setOpenFacades, facadeDepth, facadeMapUrl, facadeStyle, type FacadeStyle, LAYER, makeFacadeMaterials, placedFacadeStyle, ROOF_LAYER, SLAB_STYLE } from "./facades.ts";
import type { PrefabMaterials } from "./prefab-pieces.ts";
import { disposePrefabMaterials, makePrefabMaterials, prefabParts, raceTextures } from "./prefabs.ts";
import { setReliefDevice, setReliefTier } from "./surface-relief.ts";
import { TrackArt } from "./track-art.ts";
import { drawCell } from "./track-mesh.ts";
import { publicWebpSize, webpSize } from "./webp-size.test-util.ts";

const STYLES = Object.keys(FACADE) as FacadeStyle[];

/** Where `count` × `count` buildings 17 m apart (the course rows' spacing) stand. */
function lattice(count: number): [number, number][] {
  return Array.from({ length: count * count }, (_, i): [number, number] => [(i % count) * 17, Math.floor(i / count) * 17]);
}

/** Which styles `prefab` takes across a lattice of spots in `biome`. */
function stylesAcross(biome: "city" | "desert"): Set<FacadeStyle | null> {
  return new Set(lattice(20).map(([x, z]) => facadeStyle(PREFAB.building, x, z, biome)));
}

describe("given the buildings of a course in a biome", () => {
  it("when buildings stand across a city, then every style the city mixes appears", () => {
    expect([...stylesAcross("city")].sort()).toEqual(["baroque", "dc", "glass", "havana", "prague", "rowhouse", "shops"]);
  });

  it("when buildings stand across a desert, then they are adobe, havana and stucco, never a city's", () => {
    expect([...stylesAcross("desert")].sort()).toEqual(["adobe", "havana", "stucco"]);
  });

  it("when the same spot is asked twice, then it has the same style, and a spot's style does not depend on another's", () => {
    for (const [x, z] of lattice(8)) expect(facadeStyle(PREFAB.building, x, z, "city"), `${x},${z}`).toBe(facadeStyle(PREFAB.building, x, z, "city"));
  });

  it("when a stucco block or a prop that is no building is asked, then the block is stucco in any biome and the prop has no style", () => {
    expect(facadeStyle(PREFAB.stucco, 3, 4, "desert")).toBe("stucco");
    expect(facadeStyle(PREFAB.tree, 3, 4, "city")).toBeNull();
  });

  // mutation: sed -i 's/span >= SLAB_MIN_SPAN \&\& height >= SLAB_MIN_HEIGHT/span >= 0 \&\& height >= 0/' src/game/present/facades.ts
  it("when a marble block is asked, then a wide tall one is a slab in the DC limestone style and a narrow, a low or an unsized one has no style", () => {
    expect(facadeStyle(PREFAB.marble, 0, 0, "none", 240, 24)).toBe(SLAB_STYLE);
    expect(SLAB_STYLE, "limestone, no corner stones to stretch").toBe("federal");
    expect(facadeStyle(PREFAB.marble, 0, 0, "none", 20, 24), "a narrow block").toBeNull();
    expect(facadeStyle(PREFAB.marble, 0, 0, "none", 240, 5), "a low block").toBeNull();
    expect(facadeStyle(PREFAB.marble, 0, 0, "none"), "no size given").toBeNull();
  });
});

describe("given the packed layers of every facade style", () => {
  it("when the layer data is read, then it names exactly the styles, each with 3 or 4 layers, positive bands and a bare patch inside the picture", () => {
    expect(Object.keys(FACADE_LAYERS).sort().join(), "styles with layer data").toBe([...STYLES].sort().join());
    for (const style of STYLES) {
      const { layers, metres, plain } = FACADE_LAYERS[style];
      expect([3, 4], `${style} layers`).toContain(layers);
      for (const band of [metres.cornice, metres.floor, metres.ground]) expect(band, `${style} band`).toBeGreaterThan(0.3);
      expect(metres.cornice + metres.ground, `${style}: a storey fits between`).toBeLessThan(ROOFLINE - metres.floor / 2);
      for (const at of plain) expect(at, `${style} patch`).toBeGreaterThan(0);
    }
  });

  it("when each style's strips are listed, then albedo and normal are one 256 texel layer a layer, the glow half of it, and the whole set stays in its file budget", () => {
    for (const style of STYLES) {
      const { layers } = FACADE_LAYERS[style];
      const sizes = (kind: "albedo" | "normal" | "glow"): string => JSON.stringify(publicWebpSize(facadeMapUrl(style, kind)));
      expect(sizes("albedo"), `${style} albedo`).toBe(JSON.stringify({ width: 256, height: 256 * layers }));
      expect(sizes("normal"), `${style} normal`).toBe(JSON.stringify({ width: 256, height: 256 * layers }));
      expect(sizes("glow"), `${style} glow`).toBe(JSON.stringify({ width: 128, height: 128 * layers }));
    }
  });
});

/** The triangles a block may take: street face 6 quads, three walls of 5, the slab 12 (a 4-layer style; a 3-layer one has fewer). */
const BUILDING_TRIANGLES = 56;

describe("given a building built in each facade style", () => {
  let materials: PrefabMaterials;
  beforeAll(() => {
    stubBrowser();
    materials = makePrefabMaterials(raceTextures());
  });

  // mutation: sed -i 's/  const corniceFoot = block(lines\[storeys\]!);/  const corniceFoot = block(lines[storeys]!) - 0.5;/' src/game/world/openworld/facade-windows.ts
  for (const style of STYLES) {
    it(`when a ${style} building is built, then each face reads its regions: the street face its ground layer, the cornice at the roofline, the stones where the style has them, a roof top`, () => {
      const [part] = prefabParts(PREFAB.building, materials, style);
      const geometry = part!.geometry;
      const region = geometry.getAttribute("surfaceRegion");
      const position = geometry.getAttribute("position");
      const normal = geometry.getAttribute("normal");
      const klass = geometry.getAttribute("materialClass");
      const { layers, metres } = FACADE_LAYERS[style];
      const onStreet = new Set<number>();
      const onSide = new Set<number>();
      let corniceBottom = Infinity;
      let corniceTop = -Infinity;
      for (let i = 0; i < region.count; i++) {
        const layer = region.getX(i);
        if (klass.getX(i) === MAT.BUILDING_ROOF) {
          expect(layer, "the roof top's layer").toBe(ROOF_LAYER);
          expect(position.getY(i), "the roof top's height").toBeCloseTo(14, 5);
          continue;
        }
        expect(layer, "a layer the style has").toBeLessThan(layers);
        if (normal.getX(i) > 0.5) onStreet.add(layer);
        else if (normal.getZ(i) > 0.5) onSide.add(layer);
        if (layer === LAYER.cornice) {
          corniceBottom = Math.min(corniceBottom, position.getY(i));
          corniceTop = Math.max(corniceTop, position.getY(i));
        }
      }
      expect(onStreet.has(LAYER.ground), "the street face has its ground band").toBe(true);
      expect(onSide.has(LAYER.ground), "a side wall runs its storeys to the ground").toBe(false);
      expect(onStreet.has(LAYER.quoin), "corner stones where the style has them").toBe(layers > LAYER.quoin);
      expect(corniceTop, "cornice top at the roofline").toBeCloseTo(ROOFLINE, 5);
      // An open style's cornice is the interior's own depth in the block's metres (the table lays the bands by the storeys), where the others' is the packed picture's.
      const corniceMetres = isOpenStyle(style) ? (CORNICE_DEPTH * BLOCK_HEIGHT) / buildingHeight(DEFAULT_STOREYS, shopGroundOf(style)) : metres.cornice;
      expect(corniceTop - corniceBottom, "cornice height").toBeCloseTo(corniceMetres, 5);
      expect(position.count / 3, `${position.count / 3} triangles`).toBeLessThanOrEqual(BUILDING_TRIANGLES);
      expect(part!.material, "its style's shared material").toBe(materials.facades[style]);
    });
  }

  // mutation: sed -i 's/\[LAYER.floor, 1, 0\]\], \[top/[LAYER.floor, 1, 1]], [top/' src/game/present/facade-mesh.ts
  it("when a marble slab is built, then every wall and the roof top are laid in the instance's metres but the parapet's bare patch is not, on the marble body's footprint, and a plain marble block stays plain", () => {
    const [slab] = prefabParts(PREFAB.marble, materials, SLAB_STYLE);
    const [block] = prefabParts(PREFAB.building, materials, SLAB_STYLE);
    const region = slab!.geometry.getAttribute("surfaceRegion");
    const position = slab!.geometry.getAttribute("position");
    const normal = slab!.geometry.getAttribute("normal");
    const klass = slab!.geometry.getAttribute("materialClass");
    const grounds = new Set<number>();
    let wallReach = 0;
    let parapetReach = 0;
    for (let i = 0; i < region.count; i++) {
      const roofTop = klass.getX(i) === MAT.BUILDING_ROOF;
      // The cornice's top edge is at the roofline too: the parapet is the roof slab's sides, the floor layer's bare patch above it.
      const parapet = !roofTop && region.getX(i) === LAYER.floor && position.getY(i) > ROOFLINE - 0.3;
      expect(region.getZ(i), `vertex ${i}: ${roofTop ? "roof top" : parapet ? "parapet" : "wall"}`).toBe(parapet ? 0 : 1);
      if (!roofTop && !parapet && normal.getZ(i) > 0.5) grounds.add(region.getX(i));
      const reach = Math.max(Math.abs(position.getX(i)), Math.abs(position.getZ(i)));
      if (parapet) parapetReach = Math.max(parapetReach, reach);
      else if (!roofTop) wallReach = Math.max(wallReach, reach);
    }
    expect(grounds.has(LAYER.ground), "the long face has the ground band").toBe(true);
    expect(wallReach, "the walls stand on the marble body's footprint").toBeCloseTo(MARBLE.body.half, 3);
    // The parapet overhangs the wall by a real 0.1 m (the roof slab is 12 m on an 11.8 m block); the collider's cornice course, 6.3 m, covers it.
    expect(parapetReach, "the parapet's overhang stays inside the collider's cornice").toBeLessThanOrEqual(MARBLE.cornice.half);
    const blockRegion = block!.geometry.getAttribute("surfaceRegion");
    for (let i = 0; i < blockRegion.count; i++) expect(blockRegion.getZ(i), "a building keeps the block's uv").toBe(0);
    expect(prefabParts(PREFAB.marble, materials)[0]!.material, "no style, the plain block").toBe(materials.plain);
  });

  it("when a block's storeys are measured, then a storey layer spans its own metres: the band's v is a whole number of storeys, and a side wall's relief is half the street's", () => {
    const [part] = prefabParts(PREFAB.building, materials, "dc");
    const geometry = part!.geometry;
    const region = geometry.getAttribute("surfaceRegion");
    const uv = geometry.getAttribute("uv");
    const normal = geometry.getAttribute("normal");
    const position = geometry.getAttribute("position");
    let storeys = 0;
    const reliefs = new Set<number>();
    for (let i = 0; i < region.count; i++) {
      if (region.getX(i) === LAYER.floor && normal.getX(i) > 0.5) storeys = Math.max(storeys, uv.getY(i));
      // The roof slab's sides (above the roofline less a cornice) also read the floor layer, at full relief: only the wall's own band counts.
      if (region.getX(i) === LAYER.floor && normal.getX(i) < -0.5 && position.getY(i) < ROOFLINE - 0.3) reliefs.add(region.getY(i));
    }
    expect(storeys, "street storeys").toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(storeys), `v ${storeys}`).toBe(true);
    expect([...reliefs], "a back wall's relief").toEqual([0.5]);
  });
});

describe("given the facade materials", () => {
  it("when they are made, then each style has its own concrete material wearing the placeholder maps three keeps its paths for", () => {
    const made = makeFacadeMaterials();
    expect(new Set(Object.values(made)).size, "one material a style").toBe(STYLES.length);
    for (const style of STYLES) {
      expect(made[style].map && made[style].normalMap && made[style].emissiveMap, `${style} maps`).toBeTruthy();
      expect(made[style].userData.materialClass, `${style} class`).toBe(MAT.CONCRETE);
    }
  });

  it("when a style's material is compiled, then colour, normal and glow are read from layered textures by layer, and its windows light from the one glow uniform every style shares", () => {
    const { vertexShader, fragmentShader } = THREE.ShaderLib.standard;
    const shader = { uniforms: {}, vertexShader, fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
    makeFacadeMaterials().prague.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.facadeGlow, "the shared uniform").toBe(FACADE_GLOW);
    for (const name of ["facadeAlbedo", "facadeNormalMap", "facadeGlowMap", "facadeRoofAlbedo", "facadeRoofNormal"]) expect(shader.uniforms[name], name).toBeTruthy();
    expect(shader.fragmentShader, "colour by layer").toContain("texture(facadeAlbedo, vec3(vMapUv, vFacadeRegion.x))");
    expect(shader.fragmentShader, "normal by layer, with the region's relief").toContain("facadeNormalTexel()");
    expect(shader.fragmentShader, "the relief share of the region").toContain("normalScale * vFacadeRegion.y");
    expect(shader.fragmentShader, "no plain normal read left").not.toContain("texture2D( normalMap");
    expect(shader.fragmentShader, "the plain emissive map step is replaced").not.toContain("#include <emissivemap_fragment>");
    expect(shader.vertexShader, "the region attribute, its third number the slab's metres").toContain("attribute vec3 surfaceRegion");
    expect(shader.uniforms.facadeBays!.value, "a face's bays, for a slab's whole number of them").toBe(FACADE_LAYERS.prague.bays);
    expect(shader.vertexShader, "a slab's uv laid in the instance's scale").toContain("surfaceRegion.z > 0.5");
  });
});

/** Meshes the Mall's 971 buildings draw (27 draw cells, 8 styles over its two biomes): measured 126; a style a biome mix adds takes them past it. */
const MALL_BUILDING_MESHES = 130;

describe("given the National Mall's art", () => {
  it("when its buildings are drawn, then they make at most one mesh per style and draw cell, within the Mall's building budget", () => {
    stubBrowser();
    const track = new Track(TRACKS.find((json) => parseTrack(json).id === TRACK_ID.nationalMall)!);
    const course = placeCourse(track);
    const art = new TrackArt(track, course.placed, new WorldStage(new THREE.Scene()), course.drawn);
    const meshes: THREE.Object3D[] = [];
    art.group.traverse((o) => {
      if (o.name === `prop:${PREFAB.building}`) meshes.push(o);
    });
    expect(meshes.length, `${meshes.length} building meshes`).toBeLessThanOrEqual(MALL_BUILDING_MESHES);
    for (const mesh of meshes) {
      if (mesh instanceof THREE.Mesh && mesh.castShadow) expect(mesh.customDepthMaterial?.customProgramCacheKey(), "a building's shadow is drawn with the lift").toBe("facade-depth");
    }
  });

  // mutation: sed -i 's/SLAB_MIN_SPAN = 25/SLAB_MIN_SPAN = 1e9/' src/game/present/facades.ts
  it("when its marble blocks are drawn, then every museum slab stands in one federal mesh per draw cell", () => {
    stubBrowser();
    const track = new Track(TRACKS.find((json) => parseTrack(json).id === TRACK_ID.nationalMall)!);
    const course = placeCourse(track);
    const art = new TrackArt(track, course.placed, new WorldStage(new THREE.Scene()), course.drawn);
    const [width, height] = PREFABS.marble.size;
    const slabs = course.placed.filter((p) => p.prefab === PREFAB.marble && facadeStyle(p.prefab, p.x, p.z, "none", Math.max(p.sx, p.sz) * width!, p.sy * height!) === SLAB_STYLE);
    expect(slabs.length, "the Mall's museum slabs").toBeGreaterThan(20);
    const cells = new Set(slabs.map((p) => drawCell(p.x, p.z)));
    let drawn = 0;
    let meshes = 0;
    art.group.traverse((o) => {
      if (o.name !== `prop:${PREFAB.marble}` || !(o instanceof THREE.InstancedMesh) || o.material.userData.facadeStyle !== SLAB_STYLE) return;
      meshes++;
      drawn += o.count;
    });
    expect(drawn, "every slab an instance of a federal mesh").toBe(slabs.length);
    expect(meshes, "one mesh per draw cell the slabs stand in").toBe(cells.size);
  });
});

describe("given the parapet lift of a lifted building", () => {
  const { vertexShader, fragmentShader } = THREE.ShaderLib.standard;
  const compile = (material: THREE.Material): THREE.WebGLProgramParametersWithUniforms => {
    const shader = { uniforms: {}, vertexShader, fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    return shader;
  };

  it("when a facade material's vertex shader is compiled, then the lift comes before the class tag's grain point, so the grain follows the raised parapet", () => {
    const vertex = compile(makeFacadeMaterials().dc).vertexShader;
    expect(vertex.indexOf("facadeLifts"), "lift in the shader").toBeGreaterThan(-1);
    expect(vertex.indexOf("facadeLifts"), "lift before the grain point").toBeLessThan(vertex.indexOf("vMaterialPoint = "));
  });

  it("when the sun's shadow material of a facade mesh is asked, then it is the one lifted depth material, and a plain material has none", () => {
    const dc = makeFacadeMaterials().dc;
    const depth = facadeDepth(dc);
    expect(depth, "a facade's depth").toBeTruthy();
    expect(facadeDepth(makeFacadeMaterials().prague), "one for every style").toBe(depth);
    expect(compile(depth!).vertexShader, "the lift in the shadow pass").toContain("facadeLifts");
    expect(facadeDepth(new THREE.MeshStandardMaterial()), "a plain material").toBeNull();
  });
});

describe("given the paving material of a prefab record", () => {
  it("when it is read twice and disposed, then it is one material made on first read, and a record that never read it makes none to dispose", () => {
    stubBrowser();
    const read = makePrefabMaterials(raceTextures());
    expect(read.paving, "one material").toBe(read.paving);
    let disposed = 0;
    read.paving.addEventListener("dispose", () => disposed++);
    disposePrefabMaterials(read);
    expect(disposed, "the read paving is disposed").toBe(1);
    const unread = makePrefabMaterials(raceTextures());
    disposePrefabMaterials(unread);
    let later = 0;
    unread.paving.addEventListener("dispose", () => later++);
    expect(later, "a paving first read after the disposal is live").toBe(0);
  });
});

describe("given the world stage's time of day", () => {
  it("when the day goes to sunset and to night, then the windows' glow rises from 0 through a part to 1", () => {
    stubBrowser();
    const stage = new WorldStage(new THREE.Scene());
    stage.setTime(TIME_OF_DAY.day);
    expect(FACADE_GLOW.value, "day").toBe(0);
    stage.setTime(TIME_OF_DAY.sunset);
    expect(FACADE_GLOW.value, "sunset").toBeGreaterThan(0);
    expect(FACADE_GLOW.value, "sunset").toBeLessThan(1);
    stage.setTime(TIME_OF_DAY.night);
    expect(FACADE_GLOW.value, "night").toBe(1);
  });
});

describe("given the roof coverings", () => {
  it("when the roof strips are listed, then both are five 256 texel layers", () => {
    for (const kind of ["albedo", "normal"] as const) expect(JSON.stringify(publicWebpSize(`/facades/roofs-${kind}.webp`)), kind).toBe(JSON.stringify({ width: 256, height: 256 * 5 }));
  });

  it("when a style's material is compiled, then its roof switch points rise to at most 1 and the roof strips are read for the roof layer", () => {
    const { vertexShader, fragmentShader } = THREE.ShaderLib.standard;
    const made = makeFacadeMaterials();
    for (const style of STYLES) {
      const shader = { uniforms: {}, vertexShader, fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
      made[style].onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      const edges: number[] = shader.uniforms.facadeRoofMix.value;
      expect(edges.length, style).toBe(4);
      for (let i = 1; i < edges.length; i++) expect(edges[i]!, `${style} edge ${i}`).toBeGreaterThanOrEqual(edges[i - 1]!);
      expect(edges[3]!, `${style} last edge`).toBeLessThanOrEqual(1);
      expect(shader.fragmentShader, `${style} roof colour`).toContain("texture(facadeRoofAlbedo");
    }
    const adobe = { uniforms: {}, vertexShader, fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
    made.adobe.onBeforeCompile(adobe, {} as THREE.WebGLRenderer);
    expect(adobe.uniforms.facadeRoofMix.value, "an adobe roof is all tar").toEqual([1, 1, 1, 1]);
  });
});

/** A style's layer data with extra strips named for the length of `run` (a fixture: the shipped data names none on an old style). */
async function withStrips<T>(style: FacadeStyle, strips: { height?: true; roughness?: true; neon?: true }, run: () => Promise<T> | T): Promise<T> {
  const spec = FACADE_LAYERS[style];
  Object.assign(spec, strips);
  try {
    return await run();
  } finally {
    for (const name of Object.keys(strips)) delete spec[name as keyof typeof strips];
  }
}

const compileFacade = (material: THREE.Material): THREE.WebGLProgramParametersWithUniforms => {
  const { vertexShader, fragmentShader } = THREE.ShaderLib.standard;
  const shader = { uniforms: {}, vertexShader, fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
};

const RELIEF_UNIFORMS = ["facadeHeightMap", "facadeReliefDepth", "facadeRoughnessMap", "facadeRoughnessMix"];
/** The relief shader's marks: the parallax function, its shift and the screen derivatives the reads take their mip level from. */
const RELIEF_MARKS = ["facadeParallax", "facadeShift", "facadeDx"];

describe("given a style whose layer data names no relief strips", () => {
  // mutation: sed -i 's/${extras.open ? "|open" : ""}//' src/game/present/facades.ts (an open style keeps the base key, so it shares a program that has no discard)
  it("when a style with doorways cut in its ground band is compiled, then its program is the base facade program plus the discard, under its own cache key (the open variant is the last the key names)", () => {
    const made = makeFacadeMaterials();
    const open = STYLES.filter((style) => FACADE_LAYERS[style].open === true);
    expect(open.length, "open styles").toBeGreaterThan(0);
    for (const style of open) {
      const shader = compileFacade(made[style]);
      expect(shader.fragmentShader, `${style} discards its doorway`).toContain("discard");
      expect(made[style].customProgramCacheKey().endsWith("|open"), `${style} key ${made[style].customProgramCacheKey()}`).toBe(true);
    }
  });

  // mutation: sed -i 's/  if (extras.open) shader.uniforms.facadeOpenAt = FACADE_OPEN_AT;//' src/game/present/facades.ts
  it("when a style with windows cut in it is compiled, then its vertex shader tells each instance whether its room is built against the shared list, its fragment shader cuts its windows on that, and a style without them knows nothing of it", () => {
    const made = makeFacadeMaterials();
    for (const style of STYLES) {
      const shader = compileFacade(made[style]);
      const open = FACADE_LAYERS[style].open === true;
      expect(shader.uniforms.facadeOpenAt, `${style} list of built buildings`).toBe(open ? FACADE_OPEN_AT : undefined);
      expect(shader.vertexShader.includes("vFacadeOpen"), `${style} vertex`).toBe(open);
      expect(shader.vertexShader.includes("facadeOpenAt[i].z"), `${style} vertex weighs each listed building by how far open it is`).toBe(open);
      expect(shader.fragmentShader.includes("facadeCuts(vFacadeOpen)"), `${style} fragment`).toBe(open);
      expect(shader.fragmentShader.includes("facadeGlowMap, vec3(vMapUv, vFacadeRegion.x)).r > 0.5"), `${style} cuts the glass of a window, not its frame`).toBe(open);
    }
  });

  // mutation: sed -i 's/    slots\[FACADE_OPEN_SLOT_FLOATS \* slot\] = slot < used ? at\[FACADE_OPEN_SLOT_FLOATS \* slot\]! : OPEN_AT_NOWHERE;/    slots[FACADE_OPEN_SLOT_FLOATS * slot] = at[FACADE_OPEN_SLOT_FLOATS * slot]!;/' src/game/present/facades.ts
  it("when the built buildings are listed, then the list holds them with how far open each is, at most its capacity of them, and the slots left over are far away and shut", () => {
    const stride = FACADE_OPEN_SLOT_FLOATS;
    const slots = FACADE_OPEN_AT.value;
    const positions = Float32Array.from({ length: stride * (FACADE_OPEN_MAX + 3) }, (_, at) => at + 1);
    setOpenFacades(positions, 2);
    for (let at = 0; at < 2 * stride; at++) expect(slots[at], `the first two, float ${at}`).toBe(at + 1);
    for (let slot = 2; slot < FACADE_OPEN_MAX; slot++) {
      expect(Math.abs(slots[stride * slot]!), `unused slot ${slot}`).toBeGreaterThan(1e5);
      expect(slots[stride * slot + 2], `unused slot ${slot} is shut`).toBe(0);
    }
    setOpenFacades(positions, FACADE_OPEN_MAX + 3);
    expect(slots[stride * (FACADE_OPEN_MAX - 1)], "the last slot").toBe(stride * (FACADE_OPEN_MAX - 1) + 1);
    expect(slots[stride * (FACADE_OPEN_MAX - 1) + 2], "the last slot's openness").toBe(stride * (FACADE_OPEN_MAX - 1) + 3);
    setOpenFacades(positions, 0);
    expect(Math.abs(slots[0]!), "emptied").toBeGreaterThan(1e5);
    expect(slots[2], "emptied: shut").toBe(0);
  });

  // mutation: sed -i 's/  if (extras.open) shader.uniforms.facadeDarkAt = FACADE_DARK_AT;//' src/game/present/facades.ts; sed -i 's/ \* (1.0 - vFacadeDark \* step(/ * (1.0 - 0.0 * vFacadeDark * step(/' src/game/present/facades.ts
  it("when a style with windows cut in it is compiled, then its windows light unless its building is on the list of shut shops, in the ground band alone, and a style without them knows nothing of the list", () => {
    const made = makeFacadeMaterials();
    for (const style of STYLES) {
      const shader = compileFacade(made[style]);
      const open = FACADE_LAYERS[style].open === true;
      expect(shader.uniforms.facadeDarkAt, `${style} list of shut shops`).toBe(open ? FACADE_DARK_AT : undefined);
      expect(shader.fragmentShader.includes("* (1.0 - vFacadeDark * step(2.0, vFacadeRegion.x)"), `${style} lights its windows by the list`).toBe(open);
    }
  });

  // mutation: sed -i 's/    slots\[DARK_SLOT_FLOATS \* slot + 1\] = slot < used ? at\[DARK_SLOT_FLOATS \* slot + 1\]! : OPEN_AT_NOWHERE;/    slots[DARK_SLOT_FLOATS * slot + 1] = at[DARK_SLOT_FLOATS * slot + 1]!;/' src/game/present/facades.ts
  it("when the shut shops are listed, then the list holds them, at most its capacity of them, and the slots left over are far away", () => {
    const slots = FACADE_DARK_AT.value;
    const positions = Float32Array.from({ length: 2 * (FACADE_DARK_MAX + 2) }, (_, at) => at + 1);
    setDarkFacades(positions, 2);
    for (let at = 0; at < 4; at++) expect(slots[at], `the first two, float ${at}`).toBe(at + 1);
    for (let slot = 2; slot < FACADE_DARK_MAX; slot++) expect(Math.abs(slots[2 * slot + 1]!), `unused slot ${slot}`).toBeGreaterThan(1e5);
    setDarkFacades(positions, FACADE_DARK_MAX + 2);
    expect(slots[2 * (FACADE_DARK_MAX - 1)], "the last slot").toBe(2 * (FACADE_DARK_MAX - 1) + 1);
    setDarkFacades(positions, 0);
    expect(Math.abs(slots[0]!), "emptied").toBeGreaterThan(1e5);
  });

  // mutation: sed -i 's/ \* facadeOpenAt\[i\].z);/);/' src/game/present/facades.ts (a listed building is wholly open the moment it is listed)
  it("when a building's openness is asked of the list, then the loop answers with it: a half open building is half open", () => {
    const loop = facadeOpenLoop("amount", "where");
    expect(loop, "the loop weighs the match by the openness").toContain("* facadeOpenAt[i].z");
    expect(loop, "the loop matches on the position").toContain("facadeOpenAt[i].xy");
  });

  it("when it is compiled, then its program is the base facade program: no relief uniform, no parallax, the base cache key", () => {
    const made = makeFacadeMaterials();
    for (const style of STYLES.filter((name) => FACADE_LAYERS[name].open !== true)) {
      const material = made[style];
      const shader = compileFacade(material);
      for (const name of RELIEF_UNIFORMS) expect(shader.uniforms[name], `${style} ${name}`).toBeUndefined();
      for (const mark of RELIEF_MARKS) expect(shader.fragmentShader, `${style} ${mark}`).not.toContain(mark);
      expect(shader.fragmentShader, `${style} sign colour`).not.toContain("facadeSign");
      expect(material.customProgramCacheKey().endsWith("|facade"), `${style} key ${material.customProgramCacheKey()}`).toBe(true);
    }
  });
});

describe("given a style whose layer data names height, roughness and neon strips", () => {
  it("when it is compiled on a desktop, then it reads the strips through its own program: parallax over the height, the roughness strip, the sign colour", async () => {
    await withStrips("dc", { height: true, roughness: true, neon: true }, () => {
      const material = makeFacadeMaterials().dc;
      const shader = compileFacade(material);
      for (const name of RELIEF_UNIFORMS) expect(shader.uniforms[name], name).toBeTruthy();
      expect(shader.uniforms.facadeReliefDepth!.value, "depth is 0 until the relief tier loads the strip").toBe(0);
      expect(shader.uniforms.facadeRoughnessMix!.value, "roughness share is 0 until the strip loads").toBe(0);
      for (const mark of [...RELIEF_MARKS, "void facadeParallax(float layer)", "facadeRoughnessMap", "facadeSign"]) expect(shader.fragmentShader, mark).toContain(mark);
      expect(shader.fragmentShader, "colour read through the shifted uv").toContain("textureGrad(facadeAlbedo, vec3(vMapUv + facadeShift, vFacadeRegion.x)");
      expect(material.customProgramCacheKey().endsWith("|facade|height|roughness|neon"), material.customProgramCacheKey()).toBe(true);
    });
  });

  it("when it is compiled on a phone, then the relief strips are not in its program, and the sign colour, which every tier draws, is", async () => {
    setReliefDevice(false);
    try {
      await withStrips("dc", { height: true, roughness: true, neon: true }, () => {
        const material = makeFacadeMaterials().dc;
        const shader = compileFacade(material);
        for (const name of RELIEF_UNIFORMS) expect(shader.uniforms[name], name).toBeUndefined();
        for (const mark of RELIEF_MARKS) expect(shader.fragmentShader, mark).not.toContain(mark);
        expect(shader.fragmentShader, "sign colour").toContain("facadeSign");
        expect(material.customProgramCacheKey().endsWith("|facade|neon"), material.customProgramCacheKey()).toBe(true);
      });
    } finally {
      setReliefDevice(true);
    }
  });
});

describe("given a style with relief strips and the relief tier switched", () => {
  const requested: string[] = [];
  const realFetch = globalThis.fetch;
  const realCreateImageBitmap = Reflect.get(globalThis, "createImageBitmap");
  const DEFAULT_STRIP = { width: 256, height: 1024 };

  /** Serves any facade strip at its real size where the file exists (else a 256-wide four-layer strip), decoded to blank texels. */
  function stubStrips(): void {
    Object.assign(globalThis, {
      fetch: async (url: string) => {
        requested.push(String(url));
        return { ok: true, status: 200, blob: async () => new Blob([String(url)]) };
      },
      createImageBitmap: async (blob: Blob) => {
        const url = await blob.text();
        const file = new URL(`../../../public${url}`, import.meta.url);
        // A fixture strip has no file: the default size.
        const size = existsSync(file) ? webpSize(new Uint8Array(readFileSync(file))) : DEFAULT_STRIP;
        return { data: new Uint8ClampedArray(size.width * size.height * 4), width: size.width, height: size.height, close() {} };
      },
    });
  }
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 6; turn++) await yieldToLoop();
  };
  const reliefStrips = (): string[] => requested.filter((url) => url.includes("dc-height") || url.includes("dc-roughness"));
  afterAll(() => {
    Object.assign(globalThis, { fetch: realFetch, createImageBitmap: realCreateImageBitmap });
    setReliefTier(false);
  });

  // mutation: in facades.ts makeFacadeMaterial, replace `if (extras.height) {\n    stops.push(` so the height strip is followed whatever the style names (e.g. `if (true) {`), and the style without strips fetches it
  it("when the tier is off, then no height or roughness strip is fetched and the strips' depth and share stay 0; when it comes on, then both are fetched once, at full strength, and off again they return to 0 without a new fetch", async () => {
    stubBrowser();
    stubStrips();
    setReliefTier(false);
    await withStrips("dc", { height: true, roughness: true }, async () => {
      const shader = compileFacade(makeFacadeMaterials().dc);
      await settle();
      expect(reliefStrips(), "strips fetched with the tier off").toEqual([]);
      setReliefTier(true);
      await settle();
      expect(reliefStrips().sort(), "strips fetched with the tier on").toEqual(["/facades/dc-height.webp", "/facades/dc-roughness.webp"]);
      expect(shader.uniforms.facadeReliefDepth!.value, "parallax depth (m) with the strip loaded").toBeGreaterThan(0);
      expect(shader.uniforms.facadeRoughnessMix!.value, "roughness share with the strip loaded").toBe(1);
      setReliefTier(false);
      expect(shader.uniforms.facadeReliefDepth!.value, "parallax off").toBe(0);
      expect(shader.uniforms.facadeRoughnessMix!.value, "roughness off").toBe(0);
      expect(reliefStrips().length, "no new fetch").toBe(2);
    });
  });

  it("when the device is a phone, then the relief tier fetches none of them", async () => {
    const before = reliefStrips().length;
    setReliefDevice(false);
    try {
      await withStrips("dc", { height: true, roughness: true }, async () => {
        compileFacade(makeFacadeMaterials().dc);
        setReliefTier(true);
        await settle();
        expect(reliefStrips().length, "strips fetched on a phone").toBe(before);
      });
    } finally {
      setReliefDevice(true);
      setReliefTier(false);
    }
  });
});

describe("given a placement that names a facade style", () => {
  it("when the style is a facade's, then it wins over the hash pick for a building, an unknown name falls back to the pick, and a prop with no facade stays plain", () => {
    const picked = facadeStyle(PREFAB.building, 3, 4, "city");
    expect(picked, "the pick differs from the named style, or the row proves nothing").not.toBe("adobe");
    expect(placedFacadeStyle(PREFAB.building, "adobe", 3, 4, "city"), "named").toBe("adobe");
    expect(placedFacadeStyle(PREFAB.building, "nonesuch", 3, 4, "city"), "unknown name").toBe(picked);
    expect(placedFacadeStyle(PREFAB.building, "toString", 3, 4, "city"), "an object's own name is no style").toBe(picked);
    expect(placedFacadeStyle(PREFAB.building, undefined, 3, 4, "city"), "no name").toBe(picked);
    expect(placedFacadeStyle(PREFAB.tree, "adobe", 3, 4, "city"), "a tree has no facade").toBeNull();
  });

  // mutation: in facades.ts placedFacadeStyle, `return picked !== null && isFacadeStyle(named) ? named : picked;` -> `return picked;`
  it("when a course places buildings with a named style, then they draw with that style's material, and the one with an unknown name draws as the hash picks", () => {
    stubBrowser();
    const track = new Track(TRACKS.find((json) => parseTrack(json).id === TRACK_ID.city)!);
    const placed = [
      { prefab: PREFAB.building, x: 3, y: 0, z: 4, yaw: 0, sx: 1, sy: 1, sz: 1, style: "adobe" },
      { prefab: PREFAB.building, x: 80, y: 0, z: 90, yaw: 0, sx: 1, sy: 1, sz: 1, style: "nonesuch" },
    ];
    const art = new TrackArt(track, placed, new WorldStage(new THREE.Scene()), []);
    const styles: unknown[] = [];
    art.group.traverse((o) => {
      if (o.name === `prop:${PREFAB.building}` && o instanceof THREE.InstancedMesh) styles.push(o.material.userData.facadeStyle);
    });
    expect(styles.length, "one mesh per style and draw cell").toBe(2);
    expect(styles, "the named style's material, and the pick's for the unknown name").toContain("adobe");
    expect(styles.filter((style) => style !== "adobe").length, "the unknown name drew as a hash pick, not adobe").toBe(1);
  });
});

/** The digests of the shipped layer data of each style that predates the open world's: re-packing the facades must leave them as they are. */
const SHIPPED_ENTRY_DIGESTS: Record<string, string> = {
  prague: "0747ae4184",
  dc: "1c6d51bb13",
  stucco: "4b7fd97c0e",
  glass: "c75b474c2c",
  adobe: "f084f8099e",
  shops: "bd40a7770c",
  baroque: "3ea941430d",
  havana: "e2d1004049",
  federal: "768b9e1c05",
  warehouse: "129e255458",
  farm: "1ef3cbb51c",
  rowhouse: "deeeee0310",
};

describe("given the facade layer data of the styles that were shipped first", () => {
  // mutation: in facade-layers.json change a value of an old style, e.g. prague's "floor": 3.79 to 3.8
  it("when each old style's entry is digested, then it is as shipped", () => {
    for (const [style, digest] of Object.entries(SHIPPED_ENTRY_DIGESTS)) {
      const entry = FACADE_LAYERS[style as FacadeStyle];
      expect(createHash("sha1").update(JSON.stringify(entry)).digest("hex").slice(0, 10), style).toBe(digest);
    }
  });
});
