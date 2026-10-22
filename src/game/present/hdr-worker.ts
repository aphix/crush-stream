import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import type { HdrPixels } from "./look-env.ts";

/**
 * Decodes one Radiance RGBE file (`loadHdrEnv` posts its bytes) to half floats off the main thread, rows reversed here to top first:
 * HDRLoader asks for `flipY` on its typed-array texture, which Firefox deprecates on a non-DOM upload.
 */
self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  const { data, width, height } = new HDRLoader().parse(event.data);
  if (!(data instanceof Uint16Array) || width === undefined || height === undefined) throw new Error("HDRLoader answered no half-float pixels");
  flipRows(data, width, height);
  const pixels: HdrPixels = { data, width, height };
  self.postMessage(pixels, { transfer: [data.buffer] });
};

function flipRows(data: Uint16Array, width: number, height: number): void {
  const stride = width * 4;
  const row = data.slice(0, stride);
  for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
    row.set(data.subarray(top * stride, (top + 1) * stride));
    data.copyWithin(top * stride, bottom * stride, (bottom + 1) * stride);
    data.set(row, bottom * stride);
  }
}
