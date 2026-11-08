import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { TRACK_ID } from "../world/constants.ts";
import { placeCourse } from "../world/placements.ts";
import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { WorldStage } from "./engine-world.ts";
import type { FxTier } from "./engine-post.ts";
import { reliefForTier, setReliefTier } from "./surface-relief.ts";
import { TrackArt } from "./track-art.ts";

/** The picture a webp file holds: its edge sizes from the RIFF header (lossy, lossless or extended). */
function webpSize(b: Uint8Array): { width: number; height: number } {
  const kind = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (kind === "VP8 ") return { width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
  if (kind === "VP8L") {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
}

const requested: string[] = [];
const realFetch = globalThis.fetch;
const realCreateImageBitmap = Reflect.get(globalThis, "createImageBitmap");

/** Serves the page's files from public/ and decodes them to their real size, as the browser would. */
function stubFiles(): void {
  Object.assign(globalThis, {
    fetch: async (url: string) => {
      requested.push(String(url));
      const bytes = readFileSync(new URL(`../../../public${String(url)}`, import.meta.url));
      return { ok: true, status: 200, blob: async () => new Blob([bytes]) };
    },
    createImageBitmap: async (blob: Blob) => ({ ...webpSize(new Uint8Array(await blob.arrayBuffer())), close() {} }),
  });
}

/** A few turns of the loop: every started load (fetch, decode, texture) finishes. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await yieldToLoop();
}

const isRelief = (url: string): boolean => url.includes("-normal.webp");

describe("given the FX tiers and the device", () => {
  const cases: { tier: FxTier; phone: boolean; on: boolean }[] = [
    { tier: "ultra", phone: false, on: true },
    { tier: "high", phone: false, on: true },
    { tier: "low", phone: false, on: false },
    { tier: "minimal", phone: false, on: false },
    { tier: "off", phone: false, on: false },
    { tier: "high", phone: true, on: false },
    { tier: "ultra", phone: true, on: false },
  ];
  for (const c of cases) {
    it(`when the tier is ${c.tier} on a ${c.phone ? "phone" : "desktop"}, then the relief is ${c.on ? "on" : "off"}`, () => {
      expect(reliefForTier(c.tier, c.phone)).toBe(c.on);
    });
  }
});

/** Every normal map the City's art draws with: its materials' own, and the roof atlas's through a facade material's compiled uniform. */
function normalMaps(art: TrackArt): Set<THREE.Texture> {
  const found = new Set<THREE.Texture>();
  const { vertexShader, fragmentShader } = THREE.ShaderLib.standard;
  art.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return;
    const material: unknown = o.material;
    if (!(material instanceof THREE.MeshStandardMaterial)) return;
    if (material.normalMap) found.add(material.normalMap);
    if (material.userData.facadeStyle === undefined) return;
    const shader = { uniforms: {}, vertexShader, fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    const roofs: THREE.IUniform<THREE.Texture> = shader.uniforms.facadeRoofNormal;
    found.add(roofs.value);
  });
  return found;
}

const MIP_CHAIN = 4 / 3;

/** A map's picture: the decoded bitmap, or the flat stand-in's data. */
type Picture = { width: number; height: number };
const pictureOf = (tex: THREE.Texture): Picture => tex.image as Picture;

/** Bytes the maps take on the GPU (RGBA8 with mips); the 1x1 flat map counts its 4 bytes. */
function bytesOf(maps: Iterable<THREE.Texture>): number {
  let bytes = 0;
  for (const tex of maps) bytes += pictureOf(tex).width * pictureOf(tex).height * 4 * MIP_CHAIN;
  return bytes;
}

/** The City's materials that draw a normal map, by version: a program relink bumps a material's version. */
function versions(art: TrackArt): Map<THREE.MeshStandardMaterial, number> {
  const out = new Map<THREE.MeshStandardMaterial, number>();
  art.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return;
    const material: unknown = o.material;
    if (material instanceof THREE.MeshStandardMaterial && material.normalMap) out.set(material, material.version);
  });
  return out;
}

/** The relief budget on the City: normals bound with the tier on, over the ground, buildings, roofs and sidewalks it draws. */
const CITY_RELIEF_BUDGET_BYTES = 24 * 1024 * 1024;

describe("given the City's art built and the relief tier switched", () => {
  let art: TrackArt;
  beforeAll(() => {
    stubBrowser();
    stubFiles();
    setReliefTier(false);
    const track = new Track(TRACKS.find((json) => parseTrack(json).id === TRACK_ID.city)!);
    const course = placeCourse(track);
    art = new TrackArt(track, course.placed, new WorldStage(new THREE.Scene()), course.drawn);
  });
  afterAll(() => {
    Object.assign(globalThis, { fetch: realFetch, createImageBitmap: realCreateImageBitmap });
  });

  it("when the relief is off, then nothing normal is fetched and every normal map is the flat 1x1 at strength 0", async () => {
    await settle();
    expect(requested.filter(isRelief), "normal maps fetched").toEqual([]);
    expect(versions(art).size, "materials drawing a normal map").toBeGreaterThan(3);
    for (const tex of normalMaps(art)) expect(pictureOf(tex).width, "flat").toBe(1);
    for (const material of versions(art).keys()) expect(material.normalScale.x, "strength").toBe(0);
  });

  it("when the relief comes on, then the surfaces and styles the City draws load their maps, bound at full strength, within the City's budget", async () => {
    const flatBytes = bytesOf(normalMaps(art));
    const before = versions(art);
    setReliefTier(true);
    await settle();
    const bound = normalMaps(art);
    const bytes = bytesOf(bound);
    expect(bytes, `${(bytes / 1048576).toFixed(1)} MB bound (flat ${flatBytes} B)`).toBeLessThan(CITY_RELIEF_BUDGET_BYTES);
    expect(bound.size, "distinct maps bound").toBeGreaterThan(8);
    expect(bytes, "real maps replaced the flat ones").toBeGreaterThan(1048576);
    for (const [material, version] of before) expect(material.version, "no program relink").toBe(version);
  });

  it("when the relief goes off again, then every map is flat once more, with no new fetch and no relink", async () => {
    const fetched = requested.length;
    const before = versions(art);
    setReliefTier(false);
    for (const tex of normalMaps(art)) expect(pictureOf(tex).width, "flat").toBe(1);
    expect(requested.length, "fetches").toBe(fetched);
    for (const [material, version] of before) expect(material.version, "no program relink").toBe(version);
  });

  it("when another owner has taken a material's normal map, then a relief switch leaves it", () => {
    const [ground] = versions(art).keys();
    const photograph = new THREE.Texture();
    ground!.normalMap = photograph;
    setReliefTier(true);
    expect(ground!.normalMap, "the photograph stays").toBe(photograph);
    setReliefTier(false);
  });
});
