import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { element, stubBrowser } from "../../engine/engine-headless.test-util.ts";
import { PageWorker } from "../../engine/page-worker.test-util.ts";
import { tagSurface } from "./surface-tag.ts";
import { Ultra } from "./ultra.ts";

/** The page's files: every URL the loads ask for is root-relative (`BASE_URL` is "/" in node). */
const PUBLIC = new URL("../../../../public/", import.meta.url);
/** The desktop set's edge (px). */
const PHOTO_EDGE = 1024;
/** Three roles, three pictures each. */
const PHOTOS = 9;
/** A dressed surface's tiling: its colour, normal and ARM clones. */
const TILING_TEXTURES = 3;

/** A decoded picture that reads 0 x 0 once closed, as a browser's `ImageBitmap` does. */
type FakeBitmap = { width: number; height: number; closed: boolean; close(): void };

const bitmaps: FakeBitmap[] = [];
const uploads: { bitmap: FakeBitmap; open: boolean }[] = [];
let mipmapRuns = 0;

stubBrowser();
Object.assign(globalThis, {
  Worker: PageWorker,
  fetch: async (url: string) => new Response(await readFile(new URL(url.slice(1), PUBLIC))),
  createImageBitmap: async () => {
    const bitmap: FakeBitmap = {
      width: PHOTO_EDGE,
      height: PHOTO_EDGE,
      closed: false,
      close() {
        bitmap.width = bitmap.height = 0;
        bitmap.closed = true;
      },
    };
    bitmaps.push(bitmap);
    return bitmap;
  },
});

const stub = element().getContext("webgl2")!;
/** The headless context, with every picture upload and mipmap build logged. */
const gl = new Proxy(stub, {
  get: (target, key) => {
    if (key === "texSubImage2D" || key === "texImage2D")
      return (...args: unknown[]) => {
        const bitmap = bitmaps.find((b) => b === args.at(-1));
        if (bitmap !== undefined) uploads.push({ bitmap, open: !bitmap.closed });
      };
    if (key === "generateMipmap") return () => void mipmapRuns++;
    return Reflect.get(target, key);
  },
});

describe("given Ultra's nine photographs, decoded as ImageBitmaps", () => {
  const renderer = new THREE.WebGLRenderer({ canvas: element(), context: gl });
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight();
  let ultra: Ultra;
  before(async () => {
    ultra = await Ultra.create({ renderer, scene, stage: { sun, envGain: 1, envIntensity: 1, setUltraShadow() {} }, queueWarm() {}, alive: () => true, phone: false });
  });

  it("when Ultra loads, then each picture is uploaded once while open and closed after it, so no decoded copy stays in memory", () => {
    assert.equal(bitmaps.length, PHOTOS, "pictures decoded");
    assert.equal(bitmaps.filter((b) => b.closed).length, PHOTOS, "pictures closed");
    assert.equal(uploads.filter((u) => u.open).length, PHOTOS, "uploads of an open picture");
    assert.equal(new Set(uploads.map((u) => u.bitmap)).size, PHOTOS, "pictures uploaded");
  });

  it("when a course's surface is dressed after the close and its textures are bound as a draw binds them, then its tiling sets up from the uploaded photographs without reading a closed picture", () => {
    const material = new THREE.MeshStandardMaterial({ map: tagSurface(new THREE.CanvasTexture(element()), "asphalt", 4) });
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material));
    ultra.enable();
    ultra.dress();
    const mipmapsBefore = mipmapRuns;
    // The headless context reports no active uniforms, so a draw binds no sampler: bind them the way its uniform setters do.
    for (const tex of new Set([material.map!, material.normalMap!, material.aoMap!, material.roughnessMap!])) renderer.initTexture(tex);
    assert.ok(bitmaps.some((b) => b === material.map!.image), "the surface wears a photograph");
    assert.equal(mipmapRuns - mipmapsBefore, TILING_TEXTURES, "tiling textures set up by the bind");
    assert.equal(uploads.filter((u) => !u.open).length, 0, "uploads of a closed picture");
  });
});
