import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { element, stubBrowser } from "../engine/engine-headless.test-util.ts";
import { PageWorker } from "../engine/page-worker.test-util.ts";
import { loadHdrEnv, STUDIO_ENV_URL } from "./look-env.ts";

/** The page's files: the URL asked for is root-relative (`BASE_URL` is "/" in node). */
const PUBLIC = new URL("../../../public/", import.meta.url);

stubBrowser();
Object.assign(globalThis, {
  Worker: PageWorker,
  fetch: async (url: string) => new Response(await readFile(new URL(url.slice(1), PUBLIC))),
});

const sha1 = (px: Uint16Array): string => createHash("sha1").update(px).digest("hex");

/** HDRLoader's pixels with the rows reversed: it stores them bottom first and asks the upload to flip; the page uploads them top first. */
function uprightPixels(file: Buffer): string {
  const { data, width, height } = new HDRLoader().parse(new Uint8Array(file).buffer);
  if (!(data instanceof Uint16Array) || width === undefined || height === undefined) throw new Error("HDRLoader answered no half-float pixels");
  const stride = width * 4;
  const upright = new Uint16Array(data.length);
  for (let row = 0; row < height; row++) upright.set(data.subarray((height - 1 - row) * stride, (height - row) * stride), row * stride);
  return sha1(upright);
}

describe("given the studio environment's RGBE file", () => {
  it("when the page loads it, then the main thread never parses it, and the environment map it prefilters holds the file's decoded pixels with the rows top first", async () => {
    const want = uprightPixels(await readFile(new URL(STUDIO_ENV_URL.slice(1), PUBLIC)));
    const prefiltered: string[] = [];
    const fromEquirectangular = THREE.PMREMGenerator.prototype.fromEquirectangular;
    THREE.PMREMGenerator.prototype.fromEquirectangular = function (this: THREE.PMREMGenerator, equirect: THREE.Texture, target?: THREE.WebGLRenderTarget | null) {
      const pixels = equirect instanceof THREE.DataTexture ? equirect.image.data : null;
      prefiltered.push(pixels instanceof Uint16Array && !equirect.flipY ? sha1(pixels) : "not upright half floats");
      return fromEquirectangular.call(this, equirect, target);
    };
    let mainThreadParses = 0;
    const parse = HDRLoader.prototype.parse;
    HDRLoader.prototype.parse = function (this: HDRLoader, buffer: ArrayBuffer) {
      mainThreadParses++;
      return parse.call(this, buffer);
    };
    const env = await loadHdrEnv(new THREE.WebGLRenderer({ canvas: element() }));
    HDRLoader.prototype.parse = parse;
    THREE.PMREMGenerator.prototype.fromEquirectangular = fromEquirectangular;
    expect(env, "an environment came back").not.toBe(null);
    expect(mainThreadParses, "parses on the main thread").toBe(0);
    expect(prefiltered.join(","), "equirect pixels prefiltered").toBe(want);
  });
});
