import * as THREE from "three";
import { once } from "../kernel/scalar.ts";

/**
 * Layered textures (WebGL2 `sampler2DArray`) from one picture: the layers stacked top to bottom in a webp strip, each layer its own
 * image with its own mip chain and native repeat, so a surface tiles by real metres without a seam or a bleed from its neighbour layer.
 * The building facades, roofs and the scenery's ground tiles load through here. A material reads a layer with `texture(array, vec3(uv, layer))`.
 */

/** A picture as RGBA bytes, top row first. */
type Pixels = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

/** A strip of `layers` equal pictures, the colour space the picture is in (colours: sRGB, normals and masks: none), and whether each layer is kept at half its edge (2 x 2 texels averaged: a quarter of the memory, for a phone). */
type StripSpec = { url: string; layers: number; colorSpace: THREE.ColorSpace; anisotropy: number; halve?: boolean };

/** Made at the first strip asked for: three's loader warns on construction where `createImageBitmap` is missing (node). A bitmap is decoded as stored (top row first, no colour conversion). */
const loader = once(() => new THREE.ImageBitmapLoader().setOptions({ premultiplyAlpha: "none", colorSpaceConversion: "none" }));

/** The bytes of a decoded picture: an `ImageData` (headless) is its own; a bitmap is drawn on a canvas and read back. */
function pixelsOf(picture: ImageBitmap | ImageData): Pixels {
  if ("data" in picture) return picture;
  const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(picture.width, picture.height) : Object.assign(document.createElement("canvas"), { width: picture.width, height: picture.height });
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.drawImage(picture, 0, 0);
  return ctx.getImageData(0, 0, picture.width, picture.height);
}

/**
 * A strip's layers as one array texture: layer i is the strip's rows [i h, (i + 1) h), put in GL's order (a layer's bottom row first, so v = 1 is
 * its top as drawn). Linear filtering with mips, repeat on both axes.
 */
function layersFromStrip(strip: Pixels, spec: Omit<StripSpec, "url">): THREE.DataArrayTexture {
  const { layers } = spec;
  const srcH = Math.floor(strip.height / layers);
  const step = spec.halve ? 2 : 1;
  const w = strip.width / step;
  const h = srcH / step;
  const rowBytes = w * 4;
  const data = new Uint8Array(rowBytes * h * layers);
  for (let layer = 0; layer < layers; layer++) {
    for (let row = 0; row < h; row++) {
      const dst = (layer * h + row) * rowBytes;
      // GL's row 0 is the layer's bottom: source row (srcH - 1 - step * row), and for a halved layer the row above it.
      const top = (layer * srcH + (srcH - step * (row + 1))) * strip.width * 4;
      if (step === 1) {
        data.set(strip.data.subarray(top, top + rowBytes), dst);
        continue;
      }
      const next = top + strip.width * 4;
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 4; c++) data[dst + x * 4 + c] = (strip.data[top + x * 8 + c]! + strip.data[top + x * 8 + 4 + c]! + strip.data[next + x * 8 + c]! + strip.data[next + x * 8 + 4 + c]!) / 4;
      }
    }
  }
  const tex = new THREE.DataArrayTexture(data, w, h, layers);
  tex.colorSpace = spec.colorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = spec.anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/** Fetch and decode a strip into its array texture. */
export async function loadLayers(spec: StripSpec): Promise<THREE.DataArrayTexture> {
  return layersFromStrip(pixelsOf(await loader().loadAsync(spec.url)), spec);
}

/** A 1 x 1 x 1 array of one colour (r, g, b, a bytes): the stand-in a layered texture shows until its strip arrives (any layer index reads it). DOM-free. */
export function flatLayers(rgba: readonly [number, number, number, number], colorSpace: THREE.ColorSpace): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(new Uint8Array(rgba), 1, 1, 1);
  tex.colorSpace = colorSpace;
  tex.needsUpdate = true;
  return tex;
}
