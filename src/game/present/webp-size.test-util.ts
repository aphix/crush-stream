import { readFileSync } from "node:fs";

/** A webp's picture size from its RIFF header (lossy, lossless or extended). */
export function webpSize(bytes: Uint8Array): { width: number; height: number } {
  const kind = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (kind === "VP8 ") return { width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff, height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff };
  if (kind === "VP8L") {
    const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return { width: 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)), height: 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) };
}

/** The size of a file under `public/` (`url` as the page serves it, e.g. `/facades/dc-albedo.webp`). */
export function publicWebpSize(url: string): { width: number; height: number } {
  return webpSize(readFileSync(new URL(`../../../public${url}`, import.meta.url)));
}
