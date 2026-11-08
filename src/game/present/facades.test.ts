import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, statSync } from "node:fs";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { MAT } from "../kernel/material-ids.ts";
import { TIME_OF_DAY } from "../match/types.ts";
import { PREFAB, TRACK_ID } from "../world/constants.ts";
import { placeCourse } from "../world/placements.ts";
import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { WorldStage } from "./engine-world.ts";
import { FACADE, FACADE_GLOW, facadeMapUrl, facadeStyle, type FacadeStyle, makeFacadeMaterials } from "./facades.ts";
import type { PrefabMaterials } from "./prefab-pieces.ts";
import { makePrefabMaterials, prefabParts, raceTextures } from "./prefabs.ts";
import { TrackArt } from "./track-art.ts";

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
    expect([...stylesAcross("city")].sort()).toEqual(["dc", "glass", "prague", "stucco"]);
  });

  it("when buildings stand across a desert, then they are adobe and stucco, never a city's", () => {
    expect([...stylesAcross("desert")].sort()).toEqual(["adobe", "stucco"]);
  });

  it("when the same spot is asked twice, then it has the same style, and a spot's style does not depend on another's", () => {
    for (const [x, z] of lattice(8)) expect(facadeStyle(PREFAB.building, x, z, "city"), `${x},${z}`).toBe(facadeStyle(PREFAB.building, x, z, "city"));
  });

  it("when a stucco block or a prop that is no building is asked, then the block is stucco in any biome and the prop has no style", () => {
    expect(facadeStyle(PREFAB.stucco, 3, 4, "desert")).toBe("stucco");
    expect(facadeStyle(PREFAB.tree, 3, 4, "city")).toBeNull();
  });
});

describe("given a building built in each facade style", () => {
  let materials: PrefabMaterials;
  beforeAll(() => {
    stubBrowser();
    materials = makePrefabMaterials(raceTextures());
  });

  for (const style of STYLES) {
    it(`when a ${style} building is built, then its faces repeat the tile ${FACADE[style].bays} times across, reach the roofline, and the roof samples the style's bare wall`, () => {
      const [part] = prefabParts(PREFAB.building, materials, style);
      const geometry = part!.geometry;
      const uv = geometry.getAttribute("uv");
      const klass = geometry.getAttribute("materialClass");
      let facadeU = 0;
      let facadeV = 0;
      for (let i = 0; i < uv.count; i++) {
        if (klass.getX(i) === MAT.BUILDING_ROOF) {
          expect(uv.getX(i), "roof u").toBeCloseTo(FACADE[style].plain[0], 5);
          expect(uv.getY(i), "roof v").toBeCloseTo(FACADE[style].plain[1], 5);
        } else {
          facadeU = Math.max(facadeU, uv.getX(i));
          facadeV = Math.max(facadeV, uv.getY(i));
        }
      }
      expect(facadeU, "tiles across a face").toBeCloseTo(FACADE[style].bays, 5);
      expect(facadeV, "the tile's top meets the roof slab").toBeCloseTo(1, 5);
      expect(part!.material, "its style's shared material").toBe(materials.facades[style]);
    });
  }
});

describe("given the facade materials", () => {
  it("when they are made, then each style has its own material with its albedo, normal and glow maps", () => {
    const made = makeFacadeMaterials();
    expect(new Set(Object.values(made)).size, "one material a style").toBe(STYLES.length);
    for (const style of STYLES) {
      expect(made[style].map && made[style].normalMap && made[style].emissiveMap, `${style} maps`).toBeTruthy();
      expect(made[style].userData.materialClass, `${style} class`).toBe(MAT.CONCRETE);
    }
  });

  it("when a style's material is compiled, then its windows light from the one glow uniform every style shares", () => {
    const { vertexShader, fragmentShader } = THREE.ShaderLib.standard;
    const shader = { uniforms: {}, vertexShader, fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
    makeFacadeMaterials().prague.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.facadeGlow, "the shared uniform").toBe(FACADE_GLOW);
    expect(shader.fragmentShader, "windows lit by their threshold").toContain("facadeGlow");
    expect(shader.fragmentShader, "the plain emissive map step is replaced").not.toContain("#include <emissivemap_fragment>");
  });

  it("when every style's maps are listed, then each is a file under public/facades and the whole set stays under its size budget", () => {
    const kinds = ["albedo", "normal", "glow"] as const;
    let bytes = 0;
    for (const style of STYLES) {
      for (const kind of kinds) {
        const file = new URL(`../../../public${facadeMapUrl(style, kind)}`, import.meta.url);
        expect(existsSync(file), file.pathname).toBe(true);
        bytes += statSync(file).size;
      }
    }
    expect(bytes, `${bytes} B`).toBeLessThan(640_000);
  });
});

/** Meshes the Mall's 971 buildings draw (27 draw cells, 4 styles): measured 96; a style the city mix adds takes them past it. */
const MALL_BUILDING_MESHES = 100;

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
