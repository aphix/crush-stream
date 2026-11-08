import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { MAT } from "../kernel/material-ids.ts";
import { TIME_OF_DAY } from "../match/types.ts";
import { MARBLE, PREFABS } from "../world/catalog.ts";
import { PREFAB, TRACK_ID } from "../world/constants.ts";
import { placeCourse } from "../world/placements.ts";
import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { WorldStage } from "./engine-world.ts";
import { FACADE, FACADE_GLOW, FACADE_LAYERS, facadeDepth, facadeMapUrl, facadeStyle, type FacadeStyle, LAYER, makeFacadeMaterials, ROOF_LAYER, ROOFLINE, SLAB_STYLE } from "./facades.ts";
import type { PrefabMaterials } from "./prefab-pieces.ts";
import { disposePrefabMaterials, makePrefabMaterials, prefabParts, raceTextures } from "./prefabs.ts";
import { TrackArt } from "./track-art.ts";
import { drawCell } from "./track-mesh.ts";
import { publicWebpSize } from "./webp-size.test-util.ts";

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
      expect(corniceTop - corniceBottom, "cornice height").toBeCloseTo(metres.cornice, 5);
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
    let reach = 0;
    for (let i = 0; i < region.count; i++) {
      const roofTop = klass.getX(i) === MAT.BUILDING_ROOF;
      const parapet = !roofTop && position.getY(i) > ROOFLINE - 0.3;
      expect(region.getZ(i), `vertex ${i}: ${roofTop ? "roof top" : parapet ? "parapet" : "wall"}`).toBe(parapet ? 0 : 1);
      if (!roofTop && !parapet && normal.getZ(i) > 0.5) grounds.add(region.getX(i));
      reach = Math.max(reach, Math.abs(position.getX(i)), Math.abs(position.getZ(i)));
    }
    expect(grounds.has(LAYER.ground), "the long face has the ground band").toBe(true);
    expect(reach, "the footprint of the marble body").toBeCloseTo(MARBLE.body.half, 3);
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
