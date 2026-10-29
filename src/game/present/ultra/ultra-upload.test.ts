import { beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { element, stubBrowser } from "../../engine/engine-headless.test-util.ts";
import { servePublic } from "../../engine/page-files.test-util.ts";
import { PageWorker } from "../../engine/page-worker.test-util.ts";
import { tagSurface } from "./surface-tag.ts";
import { Ultra } from "./ultra.ts";

/** Three roles, three pictures each. */
const PHOTOS = 9;
/** The desktop set's mip chain: 1024² down to 1². */
const MIP_LEVELS = 11;

let uploads = 0;
let mipmapRuns = 0;

stubBrowser();
servePublic();
Object.assign(globalThis, { Worker: PageWorker });

const stub = element().getContext("webgl2")!;
/**
 * The headless context, with every upload of a mip and every mipmap build counted. It exposes no compressed formats, so the transcoder answers
 * RGBA32 mips; three stores a texture once and uploads each mip by `texSubImage2D` (whole-image calls are the sky's and its 1x1 placeholders).
 */
const gl = new Proxy(stub, {
  get: (target, key) => {
    if (key === "texSubImage2D" || key === "compressedTexSubImage2D") return () => void uploads++;
    if (key === "generateMipmap") return () => void mipmapRuns++;
    return Reflect.get(target, key);
  },
});

describe("given Ultra's nine photographs, KTX2 files transcoded by three's Basis transcoder", () => {
  const renderer = new THREE.WebGLRenderer({ canvas: element(), context: gl });
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight();
  let ultra: Ultra;
  beforeAll(async () => {
    ultra = await Ultra.create({ renderer, scene, stage: { sun, envGain: 1, envIntensity: 1, setUltraShadow() {} }, queueWarm() {}, alive: () => true, phone: false });
  });

  it("when Ultra loads, then each photograph's mips are uploaded once and dropped after, so no transcoded copy stays in memory", () => {
    const textures = Object.values(ultra["sets"]).flatMap((s) => [s.diff, s.nor, s.arm]);
    const spaces = [THREE.SRGBColorSpace, THREE.LinearSRGBColorSpace, THREE.LinearSRGBColorSpace];
    assert.equal(textures.length, PHOTOS);
    assert.equal(uploads, PHOTOS * MIP_LEVELS, "mip uploads");
    assert.equal(textures.filter((t) => t.mipmaps.length === 0 && t.source.dataReady === false).length, PHOTOS, "photographs with their mips dropped");
    assert.equal(textures.map((t) => t.colorSpace).join(), [...spaces, ...spaces, ...spaces].join(), "colour spaces");
  });

  it("when a course's surface is dressed after the drop and its textures are bound as a draw binds them, then its tiling sets up from the uploaded photographs without uploading or building mips again", () => {
    const material = new THREE.MeshStandardMaterial({ map: tagSurface(new THREE.CanvasTexture(element()), "asphalt", 4) });
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material));
    ultra.enable();
    ultra.dress();
    const uploadsBefore = uploads;
    const mipmapsBefore = mipmapRuns;
    // The headless context reports no active uniforms, so a draw binds no sampler: bind them the way its uniform setters do.
    for (const tex of new Set([material.map!, material.normalMap!, material.aoMap!, material.roughnessMap!])) renderer.initTexture(tex);
    assert.ok(material.map!.source === ultra["sets"].asphalt.diff.source, "the surface wears the asphalt photograph");
    assert.equal(uploads - uploadsBefore, 0, "uploads by the bind");
    assert.equal(mipmapRuns - mipmapsBefore, 0, "mip builds by the bind");
  });
});

describe("given three's Basis transcoder in public/basis/", () => {
  const digest = async (url: URL): Promise<string> => createHash("sha256").update(await readFile(url)).digest("hex");
  it("when its two files are read, then each is the same bytes as three's own copy, so a three upgrade that changes the transcoder fails here until it is copied again", async () => {
    for (const name of ["basis_transcoder.js", "basis_transcoder.wasm"]) {
      const ours = await digest(new URL(`../../../../public/basis/${name}`, import.meta.url));
      const threes = await digest(new URL(`../../../../node_modules/three/examples/jsm/libs/basis/${name}`, import.meta.url));
      assert.equal(ours, threes, name);
    }
  });
});